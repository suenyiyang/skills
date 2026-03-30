#!/usr/bin/env bun

import { readFile, writeFile, mkdir, rm } from "fs/promises";
import { resolve, extname, dirname, join, basename } from "path";
import { tmpdir, homedir } from "os";
import { parseArgs } from "util";
import { existsSync, readFileSync } from "fs";

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

const skillConfig = loadSkillConfig("yiyang-excalidraw-export");

// ---------------------------------------------------------------------------
// Parse Excalidraw files (extract pure JSON)
// ---------------------------------------------------------------------------

async function parseExcalidrawFile(filePath: string): Promise<any> {
  const content = await readFile(filePath, "utf-8");
  if (filePath.endsWith(".excalidraw") && !filePath.endsWith(".excalidraw.md"))
    return JSON.parse(content);
  if (filePath.endsWith(".excalidraw.md")) return parseExcalidrawMd(content);
  throw new Error(`Unsupported file format: ${extname(filePath)}`);
}

async function parseExcalidrawMd(content: string): Promise<any> {
  const cb = content.match(/# (?:Drawing|Excalidraw Data)\s*\n\s*```(?:json)?\s*\n([\s\S]*?)\n\s*```/);
  if (cb) return JSON.parse(cb[1]);
  const cm = content.match(/# (?:Drawing|Excalidraw Data)\s*\n\s*([\s\S]+?)(?:\n\s*# |\n\s*%%|$)/);
  if (cm) {
    const LZ = await import("lz-string");
    const d = LZ.decompressFromBase64(cm[1].replace(/\s/g, ""));
    if (d) return JSON.parse(d);
  }
  throw new Error("Could not extract Excalidraw data from .excalidraw.md");
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const { values } = parseArgs({
  options: {
    input: { type: "string", short: "i" },
    output: { type: "string", short: "o" },
    scale: { type: "string", default: "2" },
    dark: { type: "boolean", default: false },
  },
  strict: false,
});

if (!values.input) {
  console.error("Usage: export.ts -i <file.excalidraw> [-o <output.png>] [--scale 2] [--dark]");
  process.exit(1);
}

const inputPath = resolve(values.input as string);

// Resolve output path: -o flag > EXTEND.md export_output_dir > next to source file
let outputPath: string;
if (values.output) {
  outputPath = resolve(values.output as string);
} else if (skillConfig.export_output_dir) {
  const outDir = skillConfig.export_output_dir.replace(/^~/, homedir());
  const srcName = basename(inputPath).replace(/\.excalidraw(\.md)?$/i, ".png");
  outputPath = resolve(outDir, srcName);
} else {
  // Default: place PNG next to the source .excalidraw file
  const srcName = basename(inputPath).replace(/\.excalidraw(\.md)?$/i, ".png");
  outputPath = join(dirname(inputPath), srcName);
}
const scale = Math.min(Math.max(parseInt(values.scale as string) || 2, 1), 4);
const dark = values.dark as boolean;

if (!existsSync(inputPath)) {
  console.error(JSON.stringify({ error: `Input file not found: ${inputPath}`, success: false }));
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Main: Load into excalidraw.com via drop event, then export via built-in UI
// ---------------------------------------------------------------------------

try {
  const data = await parseExcalidrawFile(inputPath);
  const jsonStr = JSON.stringify(data);

  await mkdir(dirname(outputPath), { recursive: true });

  // Write to temp file for drag-and-drop
  const tmpDir = join(tmpdir(), `excalidraw-export-${Date.now()}`);
  await mkdir(tmpDir, { recursive: true });
  const tmpFile = join(tmpDir, "drawing.excalidraw");
  await writeFile(tmpFile, jsonStr);

  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: scale,
  });
  const page = await context.newPage();

  // Navigate to excalidraw.com
  await page.goto("https://excalidraw.com/", { waitUntil: "networkidle", timeout: 60_000 });

  // Wait for canvas to appear
  await page.waitForSelector("canvas.interactive", { timeout: 30_000 });
  await page.waitForTimeout(2000);

  // Load the file via simulated drag-and-drop onto the canvas
  const canvas = page.locator("canvas.interactive");

  // Use Playwright's built-in file drop
  const dataTransfer = await page.evaluateHandle((json) => {
    const dt = new DataTransfer();
    const file = new File([json], "drawing.excalidraw", { type: "application/json" });
    dt.items.add(file);
    return dt;
  }, jsonStr);

  await canvas.dispatchEvent("drop", { dataTransfer });

  // Wait for rendering to complete
  await page.waitForTimeout(3000);

  // Use Excalidraw's built-in export via keyboard shortcut
  // Ctrl+Shift+E opens the export dialog, then we capture the export image
  // But a cleaner approach: use "select all" then "copy as PNG" or use the
  // canvas with proper cropping.

  // First, fit all content to view: Ctrl+Shift+1 (zoom to fit)
  await page.keyboard.press("Control+Shift+Digit1");
  await page.waitForTimeout(1000);

  // Select all elements: Ctrl+A
  await page.keyboard.press("Control+a");
  await page.waitForTimeout(500);

  // Get the content bounds from the selection, then crop the canvas
  const pngBase64 = await page.evaluate(async () => {
    // Find the static canvas
    const canvases = document.querySelectorAll("canvas");
    let staticCanvas: HTMLCanvasElement | null = null;
    for (const c of canvases) {
      if (!c.classList.contains("interactive")) {
        staticCanvas = c as HTMLCanvasElement;
        break;
      }
    }
    if (!staticCanvas) staticCanvas = canvases[0] as HTMLCanvasElement;
    if (!staticCanvas) throw new Error("No canvas found");

    // Get canvas image data and find non-white/non-transparent content bounds
    const ctx = staticCanvas.getContext("2d");
    if (!ctx) throw new Error("No 2d context");

    const w = staticCanvas.width;
    const h = staticCanvas.height;
    const imageData = ctx.getImageData(0, 0, w, h);
    const data = imageData.data;

    // The background color (Excalidraw default white: 255,255,255)
    let minX = w, minY = h, maxX = 0, maxY = 0;
    const padding = 40; // padding around content

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const r = data[i], g = data[i+1], b = data[i+2], a = data[i+3];
        // Check if pixel is NOT the background (white with full alpha)
        // Also ignore fully transparent pixels
        if (a > 0 && !(r >= 250 && g >= 250 && b >= 250)) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }

    if (maxX <= minX || maxY <= minY) {
      // No content found — return full canvas
      return staticCanvas.toDataURL("image/png");
    }

    // Add padding
    minX = Math.max(0, minX - padding);
    minY = Math.max(0, minY - padding);
    maxX = Math.min(w - 1, maxX + padding);
    maxY = Math.min(h - 1, maxY + padding);

    const cropW = maxX - minX + 1;
    const cropH = maxY - minY + 1;

    // Create cropped canvas
    const cropCanvas = document.createElement("canvas");
    cropCanvas.width = cropW;
    cropCanvas.height = cropH;
    const cropCtx = cropCanvas.getContext("2d")!;
    // Fill with white background
    cropCtx.fillStyle = "#ffffff";
    cropCtx.fillRect(0, 0, cropW, cropH);
    cropCtx.drawImage(staticCanvas, minX, minY, cropW, cropH, 0, 0, cropW, cropH);

    return cropCanvas.toDataURL("image/png");
  });

  await browser.close();
  await rm(tmpDir, { recursive: true, force: true });

  if (!pngBase64 || pngBase64 === "data:,") {
    throw new Error("Canvas export returned empty image");
  }

  // Save PNG
  const b64 = pngBase64.replace(/^data:image\/png;base64,/, "");
  await writeFile(outputPath, Buffer.from(b64, "base64"));

  console.log(JSON.stringify({
    output: outputPath,
    source: inputPath,
    format: inputPath.endsWith(".excalidraw.md") ? "excalidraw.md" : "excalidraw",
    method: "excalidraw-com-drop",
    success: true,
  }));
} catch (e: any) {
  console.error(JSON.stringify({ error: e.message, success: false }));
  process.exit(1);
}
