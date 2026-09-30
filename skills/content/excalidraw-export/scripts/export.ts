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

const skillConfig = loadSkillConfig("excalidraw-export");

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
// Main: Use @excalidraw/excalidraw's exportToSvg via headless browser + esm.sh
// This properly handles CJK font loading and text measurement.
// ---------------------------------------------------------------------------

try {
  const data = await parseExcalidrawFile(inputPath);

  await mkdir(dirname(outputPath), { recursive: true });

  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: scale,
  });
  const page = await context.newPage();

  // Use a minimal HTML page — we only need a DOM environment to run exportToSvg
  await page.setContent(`<!DOCTYPE html><html><body><div id="container"></div></body></html>`);

  // Import @excalidraw/excalidraw from esm.sh and call exportToSvg
  const svgMarkup = await page.evaluate(async (drawingData) => {
    // Dynamically import the Excalidraw library from esm.sh CDN
    const { exportToSvg } = await import(
      // @ts-ignore
      "https://esm.sh/@excalidraw/excalidraw@latest"
    );

    const elements = drawingData.elements || [];
    const appState = drawingData.appState || {};
    const files = drawingData.files || {};

    // Call exportToSvg with the drawing data
    const svg: SVGSVGElement = await exportToSvg({
      elements,
      appState: {
        ...appState,
        exportWithDarkMode: false,
        exportBackground: true,
        viewBackgroundColor: appState.viewBackgroundColor || "#ffffff",
      },
      files,
    });

    // Wait for all fonts to be loaded
    await document.fonts.ready;

    // Insert SVG into DOM so fonts render
    const container = document.getElementById("container")!;
    container.appendChild(svg);

    // Give browser a moment to render fonts
    await new Promise((r) => setTimeout(r, 2000));

    return new XMLSerializer().serializeToString(svg);
  }, data);

  // Now screenshot the SVG element
  const svgElement = page.locator("#container > svg");
  await svgElement.waitFor({ state: "visible", timeout: 10_000 });

  // Wait a bit more for font rendering
  await page.waitForTimeout(1000);

  // Screenshot the SVG element directly to PNG
  await svgElement.screenshot({ path: outputPath, type: "png" });

  await browser.close();

  console.log(JSON.stringify({
    output: outputPath,
    source: inputPath,
    format: inputPath.endsWith(".excalidraw.md") ? "excalidraw.md" : "excalidraw",
    method: "exportToSvg-esm",
    success: true,
  }));
} catch (e: any) {
  console.error(JSON.stringify({ error: e.message, success: false }));
  process.exit(1);
}
