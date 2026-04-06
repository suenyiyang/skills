#!/usr/bin/env bun

import { existsSync, readFileSync, mkdirSync } from "fs";
import { readFile, writeFile } from "fs/promises";
import { join, dirname, resolve, basename, extname } from "path";
import { homedir } from "os";
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
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
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

// ---------------------------------------------------------------------------
// Load config
// ---------------------------------------------------------------------------

const SKILL_NAME = "yiyang-video-gen";
const envPath = join(homedir(), ".yiyang-skills", SKILL_NAME, ".env");
const fileEnv = loadEnv(envPath);

for (const [k, v] of Object.entries(fileEnv)) {
  if (!process.env[k]) process.env[k] = v;
}

const skillConfig = loadSkillConfig(SKILL_NAME);

const apiKey = process.env.ARK_API_KEY;
const model = skillConfig.model || process.env.ARK_MODEL;
const outputDir = skillConfig.output_dir || "";

if (!apiKey) {
  console.log(
    JSON.stringify({
      success: false,
      error: "Missing ARK_API_KEY",
      hint: `Create ${envPath} with: ARK_API_KEY=<your-api-key>`,
    })
  );
  process.exit(1);
}

if (!model) {
  console.log(
    JSON.stringify({
      success: false,
      error: "Missing model endpoint ID",
      hint: `Set 'model' in EXTEND.md (e.g., model: ep-20260406171020-6q7bg)`,
    })
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

const { values } = parseArgs({
  options: {
    prompt: { type: "string" },
    image: { type: "string" },
    duration: { type: "string", default: "5" },
    ratio: { type: "string", default: "16:9" },
    resolution: { type: "string", default: "720p" },
    output: { type: "string" },
    "no-watermark": { type: "boolean", default: false },
  },
  strict: false,
});

const prompt = values.prompt as string | undefined;
if (!prompt) {
  console.log(
    JSON.stringify({
      success: false,
      error: "No prompt specified. Use --prompt <text>",
    })
  );
  process.exit(1);
}

const imageInput = values.image as string | undefined;
const duration = parseInt(values.duration as string, 10) || 5;
const ratio = (values.ratio as string) || "16:9";
const resolution = (values.resolution as string) || "720p";
const noWatermark = values["no-watermark"] as boolean;
const outputPath = values.output as string | undefined;

// ---------------------------------------------------------------------------
// Volcengine Ark API
// ---------------------------------------------------------------------------

const ARK_BASE = "https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks";

async function resolveImageUrl(imagePath: string): Promise<string> {
  // Already a URL
  if (imagePath.startsWith("http://") || imagePath.startsWith("https://")) {
    return imagePath;
  }

  // Local file -> base64 data URL
  const absPath = resolve(imagePath);
  if (!existsSync(absPath)) {
    throw new Error(`Image file not found: ${absPath}`);
  }

  const buffer = await readFile(absPath);
  const ext = extname(absPath).toLowerCase();
  const mimeMap: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
  };
  const mime = mimeMap[ext] || "image/png";
  const base64 = buffer.toString("base64");
  return `data:${mime};base64,${base64}`;
}

interface TaskContent {
  type: string;
  text?: string;
  image_url?: { url: string };
}

async function submitTask(): Promise<string> {
  const content: TaskContent[] = [];

  // Text prompt
  content.push({ type: "text", text: prompt! });

  // Optional reference image
  if (imageInput) {
    const imageUrl = await resolveImageUrl(imageInput);
    content.push({ type: "image_url", image_url: { url: imageUrl } });
  }

  const body: Record<string, unknown> = {
    model,
    content,
  };

  // Embed generation parameters into text suffix as the API expects
  // The API reads --duration, --camerafixed, --watermark from the text field
  // But we also set them at the top level if supported
  const paramSuffix: string[] = [];
  if (duration !== 5) paramSuffix.push(`--duration ${duration}`);
  if (!noWatermark) paramSuffix.push("--watermark true");

  if (paramSuffix.length > 0) {
    content[0].text = `${content[0].text}  ${paramSuffix.join(" ")}`;
  }

  const resp = await fetch(ARK_BASE, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Submit failed (${resp.status}): ${errText}`);
  }

  const data = await resp.json();
  if (!data.id) {
    throw new Error(`No task ID in response: ${JSON.stringify(data)}`);
  }
  return data.id;
}

interface PollResult {
  id: string;
  status: string;
  content?: {
    video_url?: string;
  };
  error?: { message?: string };
  resolution?: string;
  ratio?: string;
  duration?: number;
}

async function pollTask(taskId: string): Promise<PollResult> {
  const maxAttempts = 180; // up to ~12 minutes at 4s intervals
  const interval = 4000;

  for (let i = 0; i < maxAttempts; i++) {
    const resp = await fetch(`${ARK_BASE}/${taskId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`Poll failed (${resp.status}): ${errText}`);
    }

    const task: PollResult = await resp.json();

    if (task.status === "succeeded") {
      return task;
    }

    if (["failed", "expired", "cancelled"].includes(task.status)) {
      throw new Error(
        task.error?.message || `Task ${task.status}: ${JSON.stringify(task)}`
      );
    }

    // queued or running — wait and retry
    await new Promise((r) => setTimeout(r, interval));
  }

  throw new Error(`Task timed out after ${maxAttempts * interval / 1000}s`);
}

async function downloadVideo(
  videoUrl: string,
  destPath: string
): Promise<void> {
  const resp = await fetch(videoUrl);
  if (!resp.ok) {
    throw new Error(`Download failed (${resp.status})`);
  }
  const buffer = Buffer.from(await resp.arrayBuffer());
  const dir = dirname(destPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  await writeFile(destPath, buffer);
}

function resolveOutputPath(taskId: string): string {
  if (outputPath) {
    return resolve(outputPath);
  }

  const dir = outputDir
    ? resolve(outputDir.replace(/^~/, homedir()))
    : process.cwd();

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  // Use taskId as filename for uniqueness
  const safeName = taskId.replace(/[^a-zA-Z0-9-]/g, "_");
  return join(dir, `${safeName}.mp4`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  try {
    // Submit
    const taskId = await submitTask();

    // Poll
    const result = await pollTask(taskId);

    const videoUrl = result.content?.video_url;
    if (!videoUrl) {
      throw new Error("No video_url in completed task");
    }

    // Download
    const dest = resolveOutputPath(taskId);
    await downloadVideo(videoUrl, dest);

    console.log(
      JSON.stringify({
        success: true,
        task_id: taskId,
        video_url: videoUrl,
        output: dest,
        duration: result.duration || duration,
        resolution: result.resolution || resolution,
        ratio: result.ratio || ratio,
      })
    );
  } catch (e: any) {
    console.log(
      JSON.stringify({
        success: false,
        error: e.message,
      })
    );
    process.exit(1);
  }
}

main();
