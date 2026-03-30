---
name: yiyang-excalidraw-export
description: Export Obsidian Excalidraw `.excalidraw` and `.excalidraw.md` files to PNG images. Handles both legacy JSON format and the Obsidian Excalidraw plugin's markdown format (including LZ-String compressed data). Use when user asks to "export excalidraw", "convert excalidraw to png", "excalidraw to image", or when other skills need to convert .excalidraw files to raster images.
---

# Excalidraw Export

Export `.excalidraw` (pure JSON) and `.excalidraw.md` (Obsidian Excalidraw plugin format) files to PNG.

The Obsidian Excalidraw plugin saves drawings in two formats:
- **`.excalidraw`** — Legacy pure JSON, the same format as excalidraw.com
- **`.excalidraw.md`** — Markdown with embedded Excalidraw JSON (often LZ-String compressed)

This skill handles both. It extracts the drawing data, then renders it to PNG.

## Script Directory

1. `{baseDir}` = this SKILL.md file's directory
2. Script path = `{baseDir}/scripts/export.ts`
3. Resolve `${BUN_X}`: if `bun` is installed → `bun`; if only `npx` is available → `npx -y bun`; otherwise suggest installing bun

## Dependencies

The script auto-installs these via bun/npx on first run:
- `lz-string` — Decompress LZ-String data from `.excalidraw.md` files
- `sharp` — Convert SVG to PNG (uses libvips, fast and reliable)

For the SVG rendering step, the script uses `excalidraw-to-svg` (a Node.js-native Excalidraw renderer, no browser needed).

## Step 0: Load Configuration (optional)

This skill works without any configuration. If the user wants to customize the default output directory, check for an EXTEND.md config:

The script resolves EXTEND.md recursively from cwd upward to `~/`:

1. `<cwd>/.yiyang-skills/yiyang-excalidraw-export/EXTEND.md`
2. `<parent-of-cwd>/.yiyang-skills/yiyang-excalidraw-export/EXTEND.md`
3. ... (walk up directory tree)
4. `~/.yiyang-skills/yiyang-excalidraw-export/EXTEND.md`

Nearest config wins (overrides parents).

### EXTEND.md format

```markdown
---
export_output_dir: ~/Pictures/excalidraw-exports
---
```

| Key | Description |
|-----|-------------|
| `export_output_dir` | Default output directory for exported PNGs. If not set, PNGs are placed next to the source file. |

To set up for the first time, see [references/config/first-time-setup.md](references/config/first-time-setup.md).

## Usage

```bash
# Export a single file (output next to source, or to EXTEND.md export_output_dir)
${BUN_X} {baseDir}/scripts/export.ts -i <input.excalidraw>

# Export with explicit output path (overrides EXTEND.md)
${BUN_X} {baseDir}/scripts/export.ts -i <input.excalidraw> -o <output.png>

# With 2x scale (default)
${BUN_X} {baseDir}/scripts/export.ts -i <input.excalidraw> -o <output.png> --scale 2

# Dark mode
${BUN_X} {baseDir}/scripts/export.ts -i <input.excalidraw> -o <output.png> --dark

# Export .excalidraw.md format
${BUN_X} {baseDir}/scripts/export.ts -i <drawing.excalidraw.md> -o <output.png>
```

## Output Path Resolution

When `-o` is **not** provided, the output path is determined by:

1. **EXTEND.md `export_output_dir`** — if set, PNG is saved to that directory with the same base name as the source file
2. **Next to source file** — fallback: PNG is placed alongside the `.excalidraw` file with a `.png` extension

When `-o` **is** provided, it always takes precedence over EXTEND.md.

## Output

JSON on success:
```json
{
  "output": "/absolute/path/to/output.png",
  "source": "/absolute/path/to/input.excalidraw",
  "format": "excalidraw",
  "success": true
}
```

## Options

| Option | Description |
|--------|-------------|
| `-i, --input <path>` | Input `.excalidraw` or `.excalidraw.md` file |
| `-o, --output <path>` | Output PNG file path (optional — defaults to EXTEND.md `export_output_dir` or next to source) |
| `--scale <number>` | Scale factor (default: 2, for retina-quality output) |
| `--dark` | Export with dark background |

## How It Works

1. **Read the input file** and detect its format
2. **For `.excalidraw` files**: parse directly as JSON
3. **For `.excalidraw.md` files**: find the `# Drawing` or `# Excalidraw Data` section, then either:
   - Parse the JSON from a code block (uncompressed format), or
   - Decompress LZ-String base64 data (compressed format, which is the default in the Obsidian plugin)
4. **Extract embedded files**: Base64-encoded images referenced in the drawing are extracted from the `# Embedded Files` section (for `.excalidraw.md`) or from the `files` object (for `.excalidraw`)
5. **Render to SVG** using excalidraw-to-svg
6. **Convert SVG → PNG** using sharp at the requested scale

## Limitations

- Fonts: The SVG renderer uses system fonts. If the drawing uses a specific font not installed on the system, text may render with a fallback font.
- Complex embeds: Embedded web content or iframes in drawings will not render.
- Hand-drawn style: The output closely matches Excalidraw's rendering but may have minor visual differences compared to in-browser export.
