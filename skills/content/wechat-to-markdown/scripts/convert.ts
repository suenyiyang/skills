#!/usr/bin/env bun

import { mkdir, writeFile } from "fs/promises";
import { dirname, join, resolve } from "path";
import { execFileSync, spawnSync } from "child_process";
import { parseArgs } from "util";
import { existsSync, readFileSync } from "fs";
import { homedir } from "os";

// ---------------------------------------------------------------------------
// EXTEND.md config resolution (recursive walk from cwd to ~)
// See <repo>/AGENTS.md for the full convention.
// ---------------------------------------------------------------------------

const SKILL_NAME = "wechat-to-markdown";

function findExtendMd(skillName: string): string | null {
  const home = homedir();
  let dir = process.cwd();
  while (true) {
    const candidate = join(dir, ".yiyang-skills", skillName, "EXTEND.md");
    if (existsSync(candidate)) return candidate;
    if (dir === home) break;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  const homeCandidate = join(home, ".yiyang-skills", skillName, "EXTEND.md");
  if (existsSync(homeCandidate)) return homeCandidate;
  return null;
}

function parseExtendMd(filePath: string): Record<string, string> {
  const content = readFileSync(filePath, "utf-8");
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const result: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf(":");
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    let val = trimmed.slice(idx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'")))
      val = val.slice(1, -1);
    result[key] = val;
  }
  return result;
}

function loadSkillConfig(skillName: string): Record<string, string> {
  const path = findExtendMd(skillName);
  return path ? parseExtendMd(path) : {};
}

function parseBooleanLike(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  const v = value.trim().toLowerCase();
  if (["on", "true", "yes", "1", "enabled"].includes(v)) return true;
  if (["off", "false", "no", "0", "disabled"].includes(v)) return false;
  return undefined;
}

// ---------------------------------------------------------------------------
// Error helpers: always emit JSON to stdout so the harness can parse failures.
// ---------------------------------------------------------------------------

type JsonError = { success: false; error: string; hint?: string };
type JsonOk = {
  success: true;
  out_dir: string;
  markdown_path: string;
  title: string;
  image_count: number;
  watermarked_image_count: number;
  watermark: { enabled: boolean; source: "cli" | "extend.md" | "default" };
  source: string;
  warnings?: string[];
};

function die(error: string, hint?: string): never {
  const payload: JsonError = { success: false, error };
  if (hint) payload.hint = hint;
  console.log(JSON.stringify(payload, null, 2));
  process.exit(1);
}

function requireBinary(name: string, installHint: string) {
  const found = spawnSync("which", [name]);
  if (found.status !== 0) {
    die(`required binary not found on PATH: ${name}`, installHint);
  }
}

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

const { values } = parseArgs({
  options: {
    url: { type: "string" },
    out: { type: "string" },
    watermark: { type: "string" }, // "on" | "off"; overrides EXTEND.md
    "keep-straight-quotes": { type: "boolean", default: false },
    "dry-run": { type: "boolean", default: false },
  },
  strict: true,
});

if (!values.url) die("missing --url", "pass a WeChat article URL like https://mp.weixin.qq.com/s/XXXX");
if (!values.out) die("missing --out", "pass an output directory, e.g. --out ./wechat-article");

const articleUrl = values.url as string;
const outDir = resolve(values.out as string);
const keepStraightQuotes = values["keep-straight-quotes"] as boolean;
const dryRun = values["dry-run"] as boolean;

// Watermark preference resolution: CLI flag > EXTEND.md > built-in default (on).
const extendCfg = loadSkillConfig(SKILL_NAME);

const cliWatermark = parseBooleanLike(values.watermark as string | undefined);
if (values.watermark !== undefined && cliWatermark === undefined) {
  die(
    `invalid --watermark value: ${JSON.stringify(values.watermark)}`,
    "use --watermark on or --watermark off",
  );
}

const extendWatermark = parseBooleanLike(extendCfg.watermark);
if (extendCfg.watermark !== undefined && extendWatermark === undefined) {
  die(
    `invalid watermark value in EXTEND.md: ${JSON.stringify(extendCfg.watermark)}`,
    "set watermark to on or off",
  );
}

const watermarkEnabled = cliWatermark ?? extendWatermark ?? true;
const skipWatermark = !watermarkEnabled;

if (!/^https?:\/\/mp\.weixin\.qq\.com\/s\//i.test(articleUrl)) {
  // Not fatal, but the watermark extraction assumes WeChat's HTML structure.
  // Emit as a warning instead of a hard error so the script still tries.
}

// ---------------------------------------------------------------------------
// External tools
// ---------------------------------------------------------------------------

requireBinary("defuddle", "npm install -g defuddle-cli");
requireBinary("dwebp", "brew install webp");
requireBinary("curl", "install curl (preinstalled on macOS)");

function run(cmd: string, args: string[], opts: { input?: string } = {}): string {
  try {
    const res = execFileSync(cmd, args, {
      encoding: "utf-8",
      maxBuffer: 64 * 1024 * 1024,
      input: opts.input,
    });
    return res;
  } catch (e: any) {
    die(
      `command failed: ${cmd} ${args.join(" ")}`,
      e?.stderr?.toString?.() || e?.message || "unknown",
    );
  }
}

// ---------------------------------------------------------------------------
// Step 1: defuddle — title + markdown body
// ---------------------------------------------------------------------------

const title = run("defuddle", ["parse", articleUrl, "-p", "title"]).trim();
if (!title) {
  die("defuddle returned an empty title", "the URL may be invalid or blocked by verification");
}

const bodyMarkdown = run("defuddle", ["parse", articleUrl, "--md"]);
if (!bodyMarkdown.trim()) {
  die("defuddle returned empty markdown body", "verification page may not have cleared");
}

// ---------------------------------------------------------------------------
// Step 2: raw HTML for watermark_info tokens
// ---------------------------------------------------------------------------

const html = run("curl", [
  "-sSL",
  "-A",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
  articleUrl,
]);

// ---------------------------------------------------------------------------
// Step 3: extract markdown image references in document order
// ---------------------------------------------------------------------------

type MdImage = { fullMatch: string; alt: string; url: string };

function extractMarkdownImages(md: string): MdImage[] {
  const out: MdImage[] = [];
  // ![alt](url "optional title") — accept anything up to the closing paren.
  const re = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(md)) !== null) {
    out.push({ fullMatch: m[0], alt: m[1], url: m[2] });
  }
  return out;
}

const mdImages = extractMarkdownImages(bodyMarkdown).filter((i) =>
  i.url.includes("mmbiz.qpic.cn"),
);

// ---------------------------------------------------------------------------
// Step 4: extract watermark tokens from the raw HTML
//
// The page source contains one `cdn_url: '...'` per image in alternating form:
//   [main_1, watermark_1, main_2, watermark_2, ...]
// The watermark_info entries are the ones we want — they resolve to the
// pre-composited watermarked image when queried with /640?watermark=1&tp=webp.
// ---------------------------------------------------------------------------

function extractCdnUrls(html: string): string[] {
  const urls: string[] = [];
  const re = /cdn_url:\s*'(https?:\/\/mmbiz\.qpic\.cn\/[^']+?)'/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) urls.push(m[1]);
  return urls;
}

function buildWatermarkDownloadUrl(cdnUrl: string): string {
  // Normalize http→https, and rewrite /0?wx_fmt=png(...) → /640?wx_fmt=png&...watermark flags.
  let u = cdnUrl.replace(/^http:\/\//, "https://");
  u = u.replace(
    /\/0\?wx_fmt=png[^']*$/,
    "/640?wx_fmt=png&from=appmsg&watermark=1&tp=webp&wxfrom=5&wx_lazy=1",
  );
  return u;
}

const allCdnUrls = extractCdnUrls(html);
const watermarkUrls: string[] = [];
for (let i = 1; i < allCdnUrls.length; i += 2) {
  watermarkUrls.push(buildWatermarkDownloadUrl(allCdnUrls[i]));
}

const warnings: string[] = [];

let downloadUrls: string[];
if (skipWatermark || watermarkUrls.length === 0) {
  if (!skipWatermark && watermarkUrls.length === 0) {
    warnings.push(
      "no watermark_info tokens found in page HTML — falling back to non-watermarked images (likely a non-'原创' article)",
    );
  }
  downloadUrls = mdImages.map((i) => i.url);
} else if (watermarkUrls.length !== mdImages.length) {
  warnings.push(
    `image count mismatch: defuddle found ${mdImages.length} body images, HTML had ${watermarkUrls.length} watermark pairs — using whichever is shorter`,
  );
  const n = Math.min(watermarkUrls.length, mdImages.length);
  downloadUrls = watermarkUrls.slice(0, n);
} else {
  downloadUrls = watermarkUrls;
}

// ---------------------------------------------------------------------------
// Dry run short-circuit
// ---------------------------------------------------------------------------

const watermarkSource =
  cliWatermark !== undefined
    ? "cli"
    : extendWatermark !== undefined
      ? "extend.md"
      : "default";

if (dryRun) {
  console.log(
    JSON.stringify(
      {
        success: true,
        dry_run: true,
        title,
        out_dir: outDir,
        image_count: mdImages.length,
        watermarked_image_count: skipWatermark ? 0 : watermarkUrls.length,
        watermark: { enabled: watermarkEnabled, source: watermarkSource },
        download_plan: downloadUrls.map((url, i) => ({
          index: i + 1,
          url,
          local_path: `./images/img-${i + 1}.png`,
        })),
        warnings,
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Step 5: download + decode
// ---------------------------------------------------------------------------

await mkdir(join(outDir, "images"), { recursive: true });

const localPaths: string[] = [];

for (let i = 0; i < downloadUrls.length; i++) {
  const url = downloadUrls[i];
  const isWebp = url.includes("tp=webp");
  const webpPath = join(outDir, "images", `img-${i + 1}.webp`);
  const pngPath = join(outDir, "images", `img-${i + 1}.png`);

  run("curl", ["-sSL", "-o", webpPath, url]);

  if (isWebp) {
    run("dwebp", [webpPath, "-o", pngPath]);
  } else {
    // Already a PNG — just rename.
    run("mv", [webpPath, pngPath]);
  }
  localPaths.push(`./images/img-${i + 1}.png`);
}

// ---------------------------------------------------------------------------
// Step 6: rewrite image URLs in markdown body
// ---------------------------------------------------------------------------

let rewritten = bodyMarkdown;
for (let i = 0; i < Math.min(mdImages.length, localPaths.length); i++) {
  const img = mdImages[i];
  const localPath = localPaths[i];
  // Replace only the first remaining occurrence of the exact match, so repeated
  // URLs in the body don't all collapse to the same file.
  const idx = rewritten.indexOf(img.fullMatch);
  if (idx === -1) continue;
  const replacement = `![${img.alt}](${localPath})`;
  rewritten = rewritten.slice(0, idx) + replacement + rewritten.slice(idx + img.fullMatch.length);
}

// ---------------------------------------------------------------------------
// Step 7: quote normalization — "..." → "..." in CJK text, outside HTML tags
//
// Defuddle collapses curly quotes to straight quotes. We walk each line,
// skip HTML tags, and if the line contains any CJK char we alternate
// opening/closing quotes. HTML attribute quotes are preserved because the
// tag tokens are copied through unchanged.
// ---------------------------------------------------------------------------

function normalizeQuotesLine(line: string): string {
  if (!/[\u4e00-\u9fff]/.test(line)) return line;

  const parts = line.split(/(<[^>]+>)/);
  let isOpen = true;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (part.startsWith("<") && part.endsWith(">")) continue;
    let rebuilt = "";
    for (const ch of part) {
      if (ch === '"') {
        rebuilt += isOpen ? "\u201c" : "\u201d";
        isOpen = !isOpen;
      } else {
        rebuilt += ch;
      }
    }
    parts[i] = rebuilt;
  }
  return parts.join("");
}

if (!keepStraightQuotes) {
  rewritten = rewritten.split("\n").map(normalizeQuotesLine).join("\n");
}

// ---------------------------------------------------------------------------
// Step 7b: strip WeChat UI chrome
//
// Defuddle keeps a few boilerplate lines above and below the body:
//   原创 <author> <author>
//   在小说阅读器读本章
//   去阅读
//   > 字数 NNN，阅读大约需 NN 分钟
//   ...article body...
//   继续滑动看下一个
//   <account name>
//   向上滑动看下一个
//   知道了
//   微信扫一扫
//   使用小程序
//   ： ， ， ... 视频 小程序 赞 ... 在看 ... 分享 留言 收藏 听过
//
// Trim the header by skipping well-known lines until we hit real content;
// trim the footer at "继续滑动看下一个".
// ---------------------------------------------------------------------------

function stripWechatChrome(md: string): string {
  const footerIdx = md.indexOf("继续滑动看下一个");
  if (footerIdx !== -1) md = md.slice(0, footerIdx);

  const lines = md.split("\n");
  let start = 0;
  const headerJunk = [
    /^原创\s+\S+/,
    /^在小说阅读器读本章$/,
    /^去阅读$/,
    /^>\s*字数\s+\d+.*分钟\s*$/,
    /^\s*$/,
  ];
  while (start < lines.length) {
    const line = lines[start];
    if (headerJunk.some((re) => re.test(line))) {
      start++;
      continue;
    }
    break;
  }
  return lines.slice(start).join("\n").trimEnd() + "\n";
}

rewritten = stripWechatChrome(rewritten);

// ---------------------------------------------------------------------------
// Step 8: frontmatter + write
// ---------------------------------------------------------------------------

function yamlEscape(s: string): string {
  // Double-quote and escape embedded double quotes.
  return '"' + s.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
}

const frontmatter = [
  "---",
  `title: ${yamlEscape(title)}`,
  `source: ${articleUrl}`,
  `fetched_at: ${new Date().toISOString()}`,
  "---",
  "",
].join("\n");

const final = frontmatter + rewritten.trim() + "\n";
const markdownPath = join(outDir, "article.md");
await writeFile(markdownPath, final, "utf-8");

// ---------------------------------------------------------------------------
// Clean up intermediate webp files
// ---------------------------------------------------------------------------

for (let i = 0; i < downloadUrls.length; i++) {
  const webpPath = join(outDir, "images", `img-${i + 1}.webp`);
  if (existsSync(webpPath)) {
    try {
      await Bun.file(webpPath).unlink?.();
    } catch {
      run("rm", ["-f", webpPath]);
    }
  }
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

const result: JsonOk = {
  success: true,
  out_dir: outDir,
  markdown_path: markdownPath,
  title,
  image_count: mdImages.length,
  watermarked_image_count: skipWatermark ? 0 : watermarkUrls.length,
  watermark: { enabled: watermarkEnabled, source: watermarkSource },
  source: articleUrl,
};
if (warnings.length) result.warnings = warnings;
console.log(JSON.stringify(result, null, 2));
