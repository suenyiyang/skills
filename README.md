# yiyang-skills

Claude Code skills for Obsidian publishing, Excalidraw export, Cloudflare R2 upload, Feishu integration, and npm package security scanning.

## Skills

| Skill | Description |
|-------|-------------|
| **yiyang-r2-upload** | Upload files to Cloudflare R2 with SHA-256 hash-based deduplication. Content-addressed URLs, no duplicate uploads. |
| **yiyang-excalidraw-export** | Export Obsidian Excalidraw `.excalidraw` and `.excalidraw.md` files to PNG. Handles LZ-String compressed data. |
| **yiyang-obsidian-image-resolver** | Process Obsidian markdown for external publishing — resolves `![[wiki-links]]`, exports Excalidraw drawings, uploads to R2, outputs clean markdown with CDN URLs. |
| **yiyang-feishu-publish** | Publish markdown to Feishu documents via `lark-cli`. Converts markdown to Feishu blocks with automatic image handling. |
| **yiyang-package-check** | Scan local machine for specific npm package versions across all package manager caches (npm, pnpm, yarn, bun) and node_modules. Useful for supply-chain attack response. |

## Install

```bash
/plugin marketplace add suenyiyang/yiyang-skills
```

Or add to your `~/.claude/settings.json`:

```json
{
  "extraKnownMarketplaces": {
    "yiyang-skills": {
      "source": {
        "source": "github",
        "repo": "suenyiyang/yiyang-skills"
      }
    }
  },
  "enabledPlugins": {
    "yiyang-skills@yiyang-skills": true
  }
}
```

## Configuration

Skills use a two-layer config system:

- **Preferences** (`EXTEND.md`) — Non-sensitive settings. Resolved recursively from `cwd` up to `~/`, allowing per-project overrides.
- **Secrets** (`.env`) — API keys and tokens. Stored only at `~/.yiyang-skills/<skill-name>/.env` (not recursive, for security).

Config is stored in `~/.yiyang-skills/`, not in this repo. Each skill has a first-time setup flow that guides you through configuration.

### Example: Setting up R2 upload

On first use, the skill will prompt you to configure:

```
~/.yiyang-skills/yiyang-r2-upload/.env        # R2 API credentials
~/.yiyang-skills/yiyang-r2-upload/EXTEND.md   # Bucket name, public URL, prefix
```

## Publishing Pipeline

The skills compose into an Obsidian-to-anywhere publishing pipeline:

```
Obsidian note (.md with ![[wiki-links]])
  |
  v
yiyang-obsidian-image-resolver
  |-- resolves ![[image.png]] to vault files
  |-- exports ![[drawing.excalidraw]] to PNG (via yiyang-excalidraw-export)
  |-- uploads all images to R2 CDN (via yiyang-r2-upload)
  |-- outputs clean markdown with remote URLs
  |
  v
yiyang-feishu-publish  (or any other target)
```

## Requirements

- [Bun](https://bun.sh/) (or Node.js with npx)
- [lark-cli](https://www.npmjs.com/package/@larksuite/cli) (for Feishu publishing only)

## License

MIT
