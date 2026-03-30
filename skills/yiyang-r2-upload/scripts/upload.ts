#!/usr/bin/env bun

import {
  S3Client,
  HeadObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { createHash } from "crypto";
import { readFile } from "fs/promises";
import { extname, resolve, join, dirname } from "path";
import { homedir } from "os";
import { existsSync, readFileSync } from "fs";
import { parseArgs } from "util";

// ---------------------------------------------------------------------------
// .env loader (secrets — home directory only, NOT recursive)
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

// Load secrets from .env (home dir only)
const envPath = join(homedir(), ".yiyang-skills", "yiyang-r2-upload", ".env");
const fileEnv = loadEnv(envPath);

for (const [k, v] of Object.entries(fileEnv)) {
  if (!process.env[k]) process.env[k] = v;
}

// Load preferences from EXTEND.md (recursive)
const skillConfig = loadSkillConfig("yiyang-r2-upload");

// ---------------------------------------------------------------------------
// Config — EXTEND.md preferences override .env for non-secret values
// ---------------------------------------------------------------------------

const accountId = process.env.R2_ACCOUNT_ID;
const accessKeyId = process.env.R2_ACCESS_KEY_ID;
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
const bucketName = skillConfig.r2_bucket_name || process.env.R2_BUCKET_NAME;
const publicUrl = (skillConfig.r2_public_url || process.env.R2_PUBLIC_URL || "").replace(/\/+$/, "");
const defaultPrefix = skillConfig.default_prefix || "";

if (!accountId || !accessKeyId || !secretAccessKey || !bucketName || !publicUrl) {
  console.error(
    JSON.stringify({
      error: "Missing R2 configuration",
      hint: `Create ${envPath} with: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME, R2_PUBLIC_URL`,
    })
  );
  process.exit(1);
}

const s3 = new S3Client({
  region: "auto",
  endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId, secretAccessKey },
});

// ---------------------------------------------------------------------------
// MIME type mapping
// ---------------------------------------------------------------------------

const MIME_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".pdf": "application/pdf",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".json": "application/json",
  ".css": "text/css",
  ".js": "text/javascript",
  ".html": "text/html",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
};

function getMimeType(ext: string): string {
  return MIME_TYPES[ext.toLowerCase()] || "application/octet-stream";
}

// ---------------------------------------------------------------------------
// Upload logic
// ---------------------------------------------------------------------------

async function uploadFile(
  filePath: string,
  prefix: string
): Promise<Record<string, unknown>> {
  const absPath = resolve(filePath);
  const content = await readFile(absPath);
  const hash = createHash("sha256").update(content).digest("hex");
  const ext = extname(absPath).toLowerCase();
  // Ensure prefix ends with "/" if non-empty (acts as a folder separator)
  const normalizedPrefix = prefix && !prefix.endsWith("/") ? `${prefix}/` : prefix;
  const key = normalizedPrefix ? `${normalizedPrefix}${hash}${ext}` : `${hash}${ext}`;

  // Check if object already exists (same hash = same content)
  try {
    await s3.send(new HeadObjectCommand({ Bucket: bucketName, Key: key }));
    return {
      url: `${publicUrl}/${key}`,
      hash,
      key,
      uploaded: false,
      skipped: true,
      file: filePath,
    };
  } catch (e: any) {
    // 404 / NotFound means we need to upload — anything else is a real error
    if (e.name !== "NotFound" && e.$metadata?.httpStatusCode !== 404) {
      throw e;
    }
  }

  await s3.send(
    new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      Body: content,
      ContentType: getMimeType(ext),
    })
  );

  return {
    url: `${publicUrl}/${key}`,
    hash,
    key,
    uploaded: true,
    skipped: false,
    file: filePath,
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const { values } = parseArgs({
  options: {
    file: { type: "string", multiple: true },
    prefix: { type: "string", default: "" },
  },
  strict: false,
});

const files = values.file as string[] | undefined;
if (!files || files.length === 0) {
  console.error(
    JSON.stringify({ error: "No files specified. Use --file <path>" })
  );
  process.exit(1);
}

const results: Record<string, unknown>[] = [];
for (const f of files) {
  try {
    results.push(await uploadFile(f, (values.prefix as string) || defaultPrefix));
  } catch (e: any) {
    results.push({ file: f, error: e.message });
  }
}

console.log(JSON.stringify(results.length === 1 ? results[0] : results, null, 2));
