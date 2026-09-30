#!/usr/bin/env bun

import { readFile, writeFile, mkdir, readdir, stat } from "fs/promises";
import { resolve, extname, join, dirname, basename, relative } from "path";
import { homedir } from "os";
import { existsSync, readFileSync } from "fs";
import { parseArgs } from "util";
import { execSync } from "child_process";
import { createHash } from "crypto";
import { tmpdir } from "os";

// ---------------------------------------------------------------------------
// .env loader (legacy fallback)
// ---------------------------------------------------------------------------

function loadEnv(envPath: string): Record<string, string> {
  const env: Record<string, string> = {};
  if (!existsSync(envPath)) return env;
  const content = readFileSync(envPath, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    let val = trimmed.slice(idx + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    env[key] = val;
  }
  return env;
}

// ---------------------------------------------------------------------------
// EXTEND.md config resolution (recursive walk from cwd to ~)
// ---------------------------------------------------------------------------

function findExtendMd(skillName: string): string | null {
  const home = homedir();
  let dir = process.cwd();

  while (true) {
    const candidate = join(dir, ".yiyang-skills", skillName, "EXTEND.md");
    if (existsSync(candidate)) return candidate;

    // Stop at home directory
    if (dir === home) break;

    const parent = dirname(dir);
    // Stop at filesystem root
    if (parent === dir) break;
    dir = parent;
  }

  // Final check: home directory (might not have been reached if cwd is outside home)
  const homeCandidate = join(home, ".yiyang-skills", skillName, "EXTEND.md");
  if (existsSync(homeCandidate)) return homeCandidate;

  return null;
}

function parseExtendMd(filePath: string): Record<string, string> {
  const content = readFileSync(filePath, "utf-8");
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!frontmatterMatch) return {};

  const result: Record<string, string> = {};
  for (const line of frontmatterMatch[1].split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf(":");
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    let val = trimmed.slice(idx + 1).trim();
    // Handle quoted values
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    result[key] = val;
  }
  return result;
}

function loadSkillConfig(skillName: string): Record<string, string> {
  const extendPath = findExtendMd(skillName);
  if (!extendPath) return {};
  return parseExtendMd(extendPath);
}

const home = homedir();

// Load EXTEND.md config (recursive)
const skillConfig = loadSkillConfig("obsidian-image-resolver");

// Legacy fallback: load .env if EXTEND.md vault_path not set
const selfEnv = loadEnv(
  join(home, ".yiyang-skills", "obsidian-image-resolver", ".env")
);

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

const { values } = parseArgs({
  options: {
    input: { type: "string" },
    output: { type: "string" },
    vault: { type: "string" },
    "excalidraw-scale": { type: "string", default: "2" },
    "dry-run": { type: "boolean", default: false },
  },
  strict: false,
});

if (!values.input || !values.output) {
  console.error(
    "Usage: resolve.ts --input <note.md> --output <output.md> [--vault <path>] [--excalidraw-scale 2] [--dry-run]"
  );
  process.exit(1);
}

const inputPath = resolve(values.input as string);
const outputPath = resolve(values.output as string);
// Resolve vault path: CLI --vault > EXTEND.md vault_path > legacy .env OBSIDIAN_VAULT_PATH
const rawVaultPath = (values.vault as string) ||
  (skillConfig.vault_path ? skillConfig.vault_path.replace(/^~/, home) : "") ||
  selfEnv.OBSIDIAN_VAULT_PATH || "";
const vaultPath = resolve(rawVaultPath);
const excalidrawScale = values["excalidraw-scale"] || "2";
const dryRun = values["dry-run"] || false;

if (!vaultPath || !existsSync(vaultPath)) {
  console.error(
    JSON.stringify({
      error: `Obsidian vault not found at: ${vaultPath}`,
      hint: "Set vault_path in ~/.yiyang-skills/obsidian-image-resolver/EXTEND.md (or legacy: OBSIDIAN_VAULT_PATH in .env)",
      success: false,
    })
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Find the script paths for sibling skills
// ---------------------------------------------------------------------------

// Resolve skill base directory (parent of scripts/). Sibling skills live in
// the same bucket folder (skills/content/).
const skillBaseDir = resolve(dirname(new URL(import.meta.url).pathname), "..");
const skillsRoot = resolve(skillBaseDir, "..");

const excalidrawExportScript = join(
  skillsRoot,
  "excalidraw-export",
  "scripts",
  "export.ts"
);

// ---------------------------------------------------------------------------
// R2 upload via the cf CLI (https://developers.cloudflare.com/cloudflare-cli/)
// ---------------------------------------------------------------------------

// R2 settings come from this skill's own EXTEND.md
const r2Bucket = skillConfig.r2_bucket_name || "";
const r2PublicUrl = (skillConfig.r2_public_url || "").replace(/\/+$/, "");
const r2Prefix = skillConfig.r2_key_prefix || "";

if (!dryRun && (!r2Bucket || !r2PublicUrl)) {
  console.error(
    JSON.stringify({
      error: "R2 is not configured",
      hint: "Set r2_bucket_name and r2_public_url in ~/.yiyang-skills/obsidian-image-resolver/EXTEND.md, and make sure the cf CLI is authenticated (cf auth login)",
      success: false,
    })
  );
  process.exit(1);
}

function runCf(args: string): string {
  try {
    return execSync(`cf ${args}`, { stdio: "pipe", timeout: 120_000 }).toString();
  } catch (e: any) {
    const stderr = e.stderr ? e.stderr.toString() : e.message;
    throw new Error(`cf ${args} failed: ${stderr}`);
  }
}

// Upload with content-addressed keys: skip when the object already exists.
function uploadToR2(filePath: string): { url: string; skipped: boolean } {
  const content = readFileSync(filePath);
  const hash = createHash("sha256").update(content).digest("hex");
  const key = `${r2Prefix}${hash}${extname(filePath).toLowerCase()}`;
  const url = `${r2PublicUrl}/${key}`;

  try {
    runCf(`r2 objects get "${key}" --bucket-name "${r2Bucket}" -q`);
    return { url, skipped: true };
  } catch {
    // not found, upload below
  }

  runCf(
    `r2 objects put "${key}" --bucket-name "${r2Bucket}" --file "${filePath}" -q`
  );
  return { url, skipped: false };
}

// ---------------------------------------------------------------------------
// Build a file index of the vault for wiki-link resolution
// ---------------------------------------------------------------------------

const IMAGE_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".avif", ".bmp", ".ico",
]);

const EXCALIDRAW_EXTENSIONS = [".excalidraw", ".excalidraw.md"];

function isImageFile(filePath: string): boolean {
  return IMAGE_EXTENSIONS.has(extname(filePath).toLowerCase());
}

function isExcalidrawFile(filePath: string): boolean {
  return EXCALIDRAW_EXTENSIONS.some((ext) =>
    filePath.toLowerCase().endsWith(ext)
  );
}

async function buildFileIndex(
  dir: string,
  index: Map<string, string[]> = new Map()
): Promise<Map<string, string[]>> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      // Skip hidden dirs and node_modules
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      await buildFileIndex(fullPath, index);
    } else {
      const name = entry.name;
      if (!index.has(name)) index.set(name, []);
      index.get(name)!.push(fullPath);
    }
  }
  return index;
}

// Obsidian resolves wiki-links by shortest unique match
function resolveWikiLink(
  linkTarget: string,
  fileIndex: Map<string, string[]>,
  noteDir: string
): string | null {
  // Strip any path separators — Obsidian treats the entire link as a search key
  const fileName = basename(linkTarget);

  // Direct match by filename
  const matches = fileIndex.get(fileName);
  if (matches && matches.length > 0) {
    // If multiple, prefer one closest to the note's directory
    if (matches.length === 1) return matches[0];
    // Sort by proximity to note
    const sorted = [...matches].sort((a, b) => {
      const relA = relative(noteDir, a).split("/").length;
      const relB = relative(noteDir, b).split("/").length;
      return relA - relB;
    });
    return sorted[0];
  }

  // Try with path included (e.g., ![[folder/image.png]])
  if (linkTarget.includes("/")) {
    for (const [, paths] of fileIndex) {
      for (const p of paths) {
        if (p.endsWith(linkTarget) || p.endsWith(`/${linkTarget}`)) {
          return p;
        }
      }
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const markdown = await readFile(inputPath, "utf-8");
const noteDir = dirname(inputPath);

// Build file index
const fileIndex = await buildFileIndex(vaultPath);

// Find all wiki-link image embeds: ![[...]]
const wikiLinkRegex = /!\[\[([^\]]+)\]\]/g;
const matches = [...markdown.matchAll(wikiLinkRegex)];

const stats = {
  images_found: 0,
  images_uploaded: 0,
  images_skipped: 0,
  excalidraw_exported: 0,
  errors: [] as string[],
};

// Process each match and build replacement map
const replacements: Map<string, string> = new Map();
const tmpExportDir = join(tmpdir(), `obsidian-resolve-${Date.now()}`);
await mkdir(tmpExportDir, { recursive: true });

for (const match of matches) {
  const fullMatch = match[0]; // e.g., ![[image.png|alt text]]
  if (replacements.has(fullMatch)) continue; // already processed

  const inner = match[1]; // e.g., "image.png|alt text" or "image.png|400"
  const parts = inner.split("|");
  const linkTarget = parts[0].trim();
  const aliasOrSize = parts[1]?.trim() || "";

  // Determine if this is an image or excalidraw reference
  const isExcalidraw = isExcalidrawFile(linkTarget);
  const isImage = isImageFile(linkTarget) || isExcalidraw;

  if (!isImage) {
    // Not an image embed — leave unchanged (could be note embed)
    continue;
  }

  stats.images_found++;

  // Resolve the file path in vault
  const resolvedPath = resolveWikiLink(linkTarget, fileIndex, noteDir);
  if (!resolvedPath) {
    stats.errors.push(`File not found in vault: ${linkTarget}`);
    continue;
  }

  let fileToUpload = resolvedPath;

  // Handle excalidraw export
  if (isExcalidraw) {
    const pngName = basename(linkTarget).replace(/\.excalidraw(\.md)?$/i, ".png");
    const pngPath = join(tmpExportDir, pngName);

    if (!dryRun) {
      try {
        const result = execSync(
          `bun "${excalidrawExportScript}" -i "${resolvedPath}" -o "${pngPath}" --scale ${excalidrawScale}`,
          { stdio: "pipe", timeout: 120_000 }
        ).toString();
        const parsed = JSON.parse(result);
        if (!parsed.success) throw new Error(parsed.error);
        stats.excalidraw_exported++;
        fileToUpload = pngPath;
      } catch (e: any) {
        stats.errors.push(`Excalidraw export failed for ${linkTarget}: ${e.message}`);
        continue;
      }
    } else {
      fileToUpload = pngPath; // placeholder for dry run
    }
  }

  // Upload to R2
  if (!dryRun) {
    try {
      const { url, skipped } = uploadToR2(fileToUpload);

      if (skipped) {
        stats.images_skipped++;
      } else {
        stats.images_uploaded++;
      }

      // Build alt text
      let altText = basename(linkTarget).replace(/\.[^.]+$/, "");
      if (aliasOrSize && !/^\d+(?:x\d+)?$/.test(aliasOrSize)) {
        // It's alt text, not a size hint
        altText = aliasOrSize;
      }

      replacements.set(fullMatch, `![${altText}](${url})`);
    } catch (e: any) {
      stats.errors.push(`Upload failed for ${linkTarget}: ${e.message}`);
    }
  } else {
    // Dry run: show what would happen
    let altText = basename(linkTarget).replace(/\.[^.]+$/, "");
    if (aliasOrSize && !/^\d+(?:x\d+)?$/.test(aliasOrSize)) {
      altText = aliasOrSize;
    }
    replacements.set(fullMatch, `![${altText}](<R2_URL>)`);
  }
}

// Apply replacements to markdown
let output = markdown;
for (const [original, replacement] of replacements) {
  // Replace all occurrences of this wiki-link
  output = output.split(original).join(replacement);
}

// Write output
if (!dryRun) {
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, output, "utf-8");
}

// Cleanup temp directory
try {
  const { rm } = await import("fs/promises");
  await rm(tmpExportDir, { recursive: true, force: true });
} catch {}

console.log(
  JSON.stringify(
    {
      output: outputPath,
      ...stats,
      dry_run: dryRun,
      success: stats.errors.length === 0,
    },
    null,
    2
  )
);

if (stats.errors.length > 0) {
  process.exit(1);
}
