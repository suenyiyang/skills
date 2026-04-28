#!/usr/bin/env bun

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, rmSync } from "fs";
import { dirname, join, resolve } from "path";
import { homedir } from "os";
import { parseArgs } from "util";

// ---------------------------------------------------------------------------
// Skill identity + config resolution (recursive walk from cwd to ~)
// See <repo>/CLAUDE.md for the full convention.
// ---------------------------------------------------------------------------

const SKILL_NAME = "yiyang-find-bqb";
const MANIFEST_URL = "https://raw.githubusercontent.com/zhaoolee/ChineseBQB/master/chinesebqb_github.json";
const MANIFEST_TTL_SECONDS = 7 * 24 * 60 * 60;
const DEFAULT_TMP_ROOT = "/tmp/yiyang-find-bqb";
const DEFAULT_RETENTION_DAYS = 7;
const DEFAULT_TOP = 6;
const TOP_CAP = 20;

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

// ---------------------------------------------------------------------------
// Output types
// ---------------------------------------------------------------------------

type Candidate = {
  name: string;
  category: string;
  path: string;
  url: string;
  score: number;
};

type JsonOk = {
  success: true;
  out_dir: string;
  keywords: string[];
  candidates: Candidate[];
  total_matches: number;
  manifest_age_seconds: number;
  manifest_total_images: number;
  cleanup: { removed_dirs: number; retention_days: number; skipped: boolean };
  dry_run?: boolean;
};

type JsonError = { success: false; error: string; hint?: string };

function emitOk(payload: JsonOk): never {
  process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
  process.exit(0);
}

function emitError(error: string, hint?: string): never {
  const payload: JsonError = { success: false, error, ...(hint ? { hint } : {}) };
  process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Manifest cache
// ---------------------------------------------------------------------------

type ManifestEntry = { name: string; category: string; url: string };
type Manifest = { status: number; info: string; data: ManifestEntry[] };

function manifestCachePath(): string {
  return join(homedir(), ".yiyang-skills", SKILL_NAME, "cache", "manifest.json");
}

async function loadManifest(forceRefresh: boolean): Promise<{ entries: ManifestEntry[]; ageSeconds: number }> {
  const cachePath = manifestCachePath();
  let needFetch = forceRefresh || !existsSync(cachePath);
  let ageSeconds = 0;
  if (existsSync(cachePath)) {
    const mtimeMs = statSync(cachePath).mtimeMs;
    ageSeconds = Math.floor((Date.now() - mtimeMs) / 1000);
    if (ageSeconds > MANIFEST_TTL_SECONDS) needFetch = true;
  }

  if (needFetch) {
    try {
      const res = await fetch(MANIFEST_URL);
      if (!res.ok) emitError(`failed to fetch manifest: HTTP ${res.status}`, "check network connectivity to raw.githubusercontent.com");
      const text = await res.text();
      // Validate JSON before writing.
      const parsed = JSON.parse(text) as Manifest;
      if (!parsed?.data || !Array.isArray(parsed.data)) {
        emitError("manifest JSON missing `data` array", "the upstream repo format may have changed");
      }
      mkdirSync(dirname(cachePath), { recursive: true });
      writeFileSync(cachePath, text, "utf-8");
      ageSeconds = 0;
    } catch (err) {
      // If we have a stale copy, fall back to it rather than fail outright.
      if (!existsSync(cachePath)) {
        emitError(
          `failed to download manifest: ${(err as Error).message}`,
          "first run requires network; retry once you have connectivity"
        );
      }
    }
  }

  const text = readFileSync(cachePath, "utf-8");
  const parsed = JSON.parse(text) as Manifest;
  return { entries: parsed.data, ageSeconds };
}

// ---------------------------------------------------------------------------
// Keyword matching + scoring
// ---------------------------------------------------------------------------

function scoreEntry(entry: ManifestEntry, keywords: string[]): number {
  // Earlier keywords matter more — the model puts its best guess first.
  // Use a geometric weighting so the first keyword dominates ties.
  const haystack = `${entry.name} ${entry.category}`.toLowerCase();
  let score = 0;
  for (let i = 0; i < keywords.length; i++) {
    const kw = keywords[i].toLowerCase();
    if (!kw) continue;
    if (haystack.includes(kw)) {
      score += 1 / (i + 1);
    }
  }
  return score;
}

function rankAndDiversify(
  entries: ManifestEntry[],
  keywords: string[],
  top: number
): { totalMatches: number; topEntries: Array<ManifestEntry & { score: number }> } {
  const scored: Array<ManifestEntry & { score: number }> = [];
  for (const e of entries) {
    const s = scoreEntry(e, keywords);
    if (s > 0) scored.push({ ...e, score: s });
  }
  scored.sort((a, b) => b.score - a.score);

  const perCategoryCap = Math.max(2, Math.ceil(top / 2));
  const seenCount = new Map<string, number>();
  const diversified: Array<ManifestEntry & { score: number }> = [];
  for (const e of scored) {
    const used = seenCount.get(e.category) ?? 0;
    if (used >= perCategoryCap) continue;
    diversified.push(e);
    seenCount.set(e.category, used + 1);
    if (diversified.length >= top) break;
  }
  if (diversified.length < top) {
    const seen = new Set(diversified.map((e) => e.url));
    for (const e of scored) {
      if (diversified.length >= top) break;
      if (!seen.has(e.url)) diversified.push(e);
    }
  }
  return { totalMatches: scored.length, topEntries: diversified };
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

function cleanupOldSubdirs(tmpRoot: string, retentionDays: number): number {
  if (!existsSync(tmpRoot)) return 0;
  const cutoffMs = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  let removed = 0;
  for (const entry of readdirSync(tmpRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const full = join(tmpRoot, entry.name);
    try {
      const st = statSync(full);
      if (st.mtimeMs < cutoffMs) {
        rmSync(full, { recursive: true, force: true });
        removed++;
      }
    } catch {
      // ignore individual failures; cleanup is best-effort
    }
  }
  return removed;
}

// ---------------------------------------------------------------------------
// Download
// ---------------------------------------------------------------------------

async function downloadOne(url: string, dest: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(dest, buf);
}

function sanitizeLabel(label: string): string {
  // Allow CJK + ASCII alphanumerics + dash/underscore; collapse everything else to '-'.
  const out = label
    .normalize("NFKC")
    .replace(/[^\p{Letter}\p{Number}_-]/gu, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return out || "search";
}

function timestampLabel(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

// Filename collisions inside one search are real (same name in different categories).
function uniquePath(dir: string, name: string): string {
  let candidate = join(dir, name);
  if (!existsSync(candidate)) return candidate;
  const dot = name.lastIndexOf(".");
  const stem = dot === -1 ? name : name.slice(0, dot);
  const ext = dot === -1 ? "" : name.slice(dot);
  let i = 2;
  while (existsSync(join(dir, `${stem}-${i}${ext}`))) i++;
  return join(dir, `${stem}-${i}${ext}`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      keywords: { type: "string" },
      top: { type: "string" },
      label: { type: "string" },
      "retention-days": { type: "string" },
      "no-cleanup": { type: "boolean", default: false },
      "refresh-manifest": { type: "boolean", default: false },
      "dry-run": { type: "boolean", default: false },
      help: { type: "boolean", default: false },
    },
    strict: true,
    allowPositionals: false,
  });

  if (values.help) {
    process.stdout.write(
      "Usage: bun find.ts --keywords <a,b,c> [--top N] [--label slug] [--retention-days N] [--no-cleanup] [--refresh-manifest] [--dry-run]\n"
    );
    process.exit(0);
  }

  if (!values.keywords || !values.keywords.trim()) {
    emitError("missing --keywords", "pass a comma-separated list of Chinese keywords, e.g. --keywords '得意,假笑,滑稽'");
  }

  const config = loadSkillConfig(SKILL_NAME);

  const tmpRoot = resolve(config.tmp_root || DEFAULT_TMP_ROOT);
  const retentionDays = (() => {
    const cli = values["retention-days"];
    if (cli) {
      const n = Number(cli);
      if (!Number.isFinite(n) || n < 0) emitError(`invalid --retention-days: ${cli}`);
      return n;
    }
    if (config.retention_days) {
      const n = Number(config.retention_days);
      if (Number.isFinite(n) && n >= 0) return n;
    }
    return DEFAULT_RETENTION_DAYS;
  })();

  const top = (() => {
    if (!values.top) return DEFAULT_TOP;
    const n = Number(values.top);
    if (!Number.isFinite(n) || n < 1) emitError(`invalid --top: ${values.top}`);
    return Math.min(Math.floor(n), TOP_CAP);
  })();

  const keywords = values
    .keywords!.split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (keywords.length === 0) emitError("no usable keywords after parsing", "ensure --keywords contains non-empty comma-separated values");

  // Cleanup first so disk pressure doesn't block the new download.
  let removed = 0;
  const skipCleanup = values["no-cleanup"] === true;
  if (!skipCleanup) {
    removed = cleanupOldSubdirs(tmpRoot, retentionDays);
  }

  // Load manifest.
  const { entries, ageSeconds } = await loadManifest(values["refresh-manifest"] === true);

  // Score + diversify.
  const { totalMatches, topEntries } = rankAndDiversify(entries, keywords, top);

  if (topEntries.length === 0) {
    emitError(
      `no matches for keywords: ${keywords.join(", ")}`,
      "try broader Chinese keywords (single characters like '笑' '哭' or iconic categories like '蘑菇头' '奥特曼' '白色小人')"
    );
  }

  // Prepare output dir.
  const labelRaw = values.label && values.label.trim() ? values.label.trim() : timestampLabel();
  const label = sanitizeLabel(labelRaw);
  const outDir = join(tmpRoot, label);

  if (values["dry-run"]) {
    const candidates: Candidate[] = topEntries.map((e) => ({
      name: e.name,
      category: e.category,
      path: join(outDir, e.name),
      url: e.url,
      score: Number(e.score.toFixed(4)),
    }));
    emitOk({
      success: true,
      out_dir: outDir,
      keywords,
      candidates,
      total_matches: totalMatches,
      manifest_age_seconds: ageSeconds,
      manifest_total_images: entries.length,
      cleanup: { removed_dirs: removed, retention_days: retentionDays, skipped: skipCleanup },
      dry_run: true,
    });
  }

  mkdirSync(outDir, { recursive: true });

  const candidates: Candidate[] = [];
  const failed: Array<{ url: string; error: string }> = [];
  await Promise.all(
    topEntries.map(async (e) => {
      const dest = uniquePath(outDir, e.name);
      try {
        await downloadOne(e.url, dest);
        candidates.push({
          name: e.name,
          category: e.category,
          path: dest,
          url: e.url,
          score: Number(e.score.toFixed(4)),
        });
      } catch (err) {
        failed.push({ url: e.url, error: (err as Error).message });
      }
    })
  );

  if (candidates.length === 0) {
    emitError(
      `all ${topEntries.length} downloads failed`,
      `last error: ${failed[failed.length - 1]?.error ?? "unknown"}. check network connectivity to raw.githubusercontent.com`
    );
  }

  // Sort candidates back into score order (Promise.all resolution order is non-deterministic).
  candidates.sort((a, b) => b.score - a.score);

  emitOk({
    success: true,
    out_dir: outDir,
    keywords,
    candidates,
    total_matches: totalMatches,
    manifest_age_seconds: ageSeconds,
    manifest_total_images: entries.length,
    cleanup: { removed_dirs: removed, retention_days: retentionDays, skipped: skipCleanup },
  });
}

main().catch((err) => {
  emitError(`unhandled error: ${(err as Error).message ?? String(err)}`);
});
