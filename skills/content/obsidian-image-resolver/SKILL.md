---
name: obsidian-image-resolver
description: Process Obsidian markdown for export by resolving all wiki-link image references (![[image.png]], ![[drawing.excalidraw]]), uploading images to R2 CDN via the cf CLI, and outputting clean standard markdown with remote URLs. Keeps original local files untouched. Use when user asks to "export obsidian markdown", "resolve obsidian images", "prepare markdown for blog", "export note for publishing", "导出笔记", or when converting Obsidian notes to standard markdown for external publishing.
---

# Obsidian Image Resolver

Process Obsidian markdown for external publishing. Finds all wiki-link image references (`![[...]]`), resolves them to actual files in the vault, exports Excalidraw drawings to PNG, uploads everything to R2, and replaces local references with CDN URLs. The original local files are never modified.

This skill uses:
- **excalidraw-export** — for converting `.excalidraw` files to PNG
- **cf CLI** — for uploading images to Cloudflare R2 (content-addressed keys, so unchanged images are skipped)

## Prerequisites

The [cf CLI](https://developers.cloudflare.com/cloudflare-cli/) must be installed and authenticated:

```bash
npm i -g cf
cf auth login
```

## Script Directory

1. `{baseDir}` = this SKILL.md file's directory
2. Script path = `{baseDir}/scripts/resolve.ts`
3. Resolve `${BUN_X}`: if `bun` is installed → `bun`; if only `npx` is available → `npx -y bun`; otherwise suggest installing bun

## Step 0: Load Configuration — BLOCKING

### Preferences (EXTEND.md) — recursive from cwd to ~/

The script resolves EXTEND.md recursively from cwd upward to `~/`:

1. `<cwd>/.yiyang-skills/obsidian-image-resolver/EXTEND.md`
2. `<parent-of-cwd>/.yiyang-skills/obsidian-image-resolver/EXTEND.md`
3. ... (walk up directory tree)
4. `~/.yiyang-skills/obsidian-image-resolver/EXTEND.md`

Nearest config wins (overrides parents).

#### EXTEND.md format

```markdown
---
vault_path: ~/Documents/MyVault
r2_bucket_name: my-bucket
r2_public_url: https://cdn.example.com
r2_key_prefix: blog/
---
```

| Key | Description |
|-----|-------------|
| `vault_path` | Path to the Obsidian vault root directory |
| `r2_bucket_name` | R2 bucket to upload images to |
| `r2_public_url` | Public base URL of the bucket (custom domain or r2.dev URL) |
| `r2_key_prefix` | Optional key prefix for uploaded objects |

Check config existence (either EXTEND.md or legacy .env):

```bash
# macOS / Linux — check for EXTEND.md at home level
test -f "$HOME/.yiyang-skills/obsidian-image-resolver/EXTEND.md" && echo "found"
```

| Result | Action |
|--------|--------|
| Found | Continue |
| Not found | Run first-time setup ([references/config/first-time-setup.md](references/config/first-time-setup.md)) |

## Usage

```bash
# Resolve images and output clean markdown
${BUN_X} {baseDir}/scripts/resolve.ts --input <note.md> --output <output.md>

# Specify vault root explicitly (overrides .env)
${BUN_X} {baseDir}/scripts/resolve.ts --input <note.md> --output <output.md> --vault <vault-path>

# Export excalidraw with specific scale
${BUN_X} {baseDir}/scripts/resolve.ts --input <note.md> --output <output.md> --excalidraw-scale 2
```

## What It Does

1. **Parse the markdown** — Find all `![[...]]` wiki-link references
2. **Resolve file paths** — Using the Obsidian vault root, resolve each wiki-link to its absolute file path. Obsidian uses shortest-path matching: `![[image.png]]` matches the first `image.png` found in the vault
3. **Handle Excalidraw** — For `![[drawing.excalidraw]]` or `![[drawing.excalidraw.md]]` references:
   - Export to PNG using `excalidraw-export`
   - Save the PNG to a temp directory
4. **Upload to R2** — Upload all resolved images (including exported Excalidraw PNGs) with `cf r2 objects put`
   - Object keys are content-addressed (`<sha256><ext>`), so re-exporting the same note skips unchanged images
5. **Replace references** — Transform wiki-links to standard markdown image syntax:
   - `![[photo.png]]` → `![photo](https://sf-cdn.suenyiyang.com/<hash>.png)`
   - `![[diagram.excalidraw]]` → `![diagram](https://sf-cdn.suenyiyang.com/<hash>.png)`
   - `![[photo.png|caption text]]` → `![caption text](https://sf-cdn.suenyiyang.com/<hash>.png)`
   - `![[photo.png|400]]` → `![photo](https://sf-cdn.suenyiyang.com/<hash>.png)` (size hints are stripped)
6. **Output** — Write the transformed markdown to the output path. Original file is untouched.

## Wiki-Link Patterns Handled

| Pattern | Description |
|---------|-------------|
| `![[image.png]]` | Simple image embed |
| `![[image.png\|alt text]]` | Image with alt text |
| `![[image.png\|400]]` | Image with width (width stripped in output) |
| `![[image.png\|400x300]]` | Image with dimensions (stripped in output) |
| `![[folder/image.png]]` | Image with relative path |
| `![[drawing.excalidraw]]` | Excalidraw drawing (exported to PNG) |
| `![[drawing.excalidraw.md]]` | Excalidraw markdown format (exported to PNG) |
| `![[drawing.excalidraw\|alt]]` | Excalidraw with alt text |

Non-image embeds (e.g., `![[note]]` embedding another markdown note) are left unchanged — they don't make sense in an exported context.

## Output

The script outputs JSON with a summary:

```json
{
  "output": "/path/to/output.md",
  "images_found": 5,
  "images_uploaded": 3,
  "images_skipped": 2,
  "excalidraw_exported": 1,
  "errors": [],
  "success": true
}
```

## Options

| Option | Description |
|--------|-------------|
| `--input <path>` | Input Obsidian markdown file |
| `--output <path>` | Output clean markdown file path |
| `--vault <path>` | Obsidian vault root (overrides .env setting) |
| `--excalidraw-scale <n>` | Excalidraw export scale (default: 2) |
| `--dry-run` | Show what would be done without uploading or writing |

## Configuration

### Preferences (EXTEND.md) — recursive from cwd to ~/

| Key | Description |
|-----|-------------|
| `vault_path` | Path to the Obsidian vault root directory |
| `r2_bucket_name` | R2 bucket to upload images to |
| `r2_public_url` | Public base URL of the bucket (custom domain or r2.dev URL) |
| `r2_key_prefix` | Optional key prefix for uploaded objects |

Uploads go through the cf CLI (`cf r2 objects put`), which uses its own auth (`cf auth login`). No API tokens are stored by this skill.

### Legacy Support

For backward compatibility, the script also checks `~/.yiyang-skills/obsidian-image-resolver/.env` for `OBSIDIAN_VAULT_PATH` if no EXTEND.md `vault_path` is found. New setups should use EXTEND.md.
