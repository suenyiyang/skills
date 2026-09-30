# yiyang-skills

Personal agent skills for content creation and publishing.

My agent skills that I use every day to turn raw material into published documents — without the manual grunt work.

Publishing content is death by a thousand cuts. Scraping an article means fighting anti-bot pages and watermarked CDN tokens. Exporting notes means untangling Obsidian wiki-links and LZ-String blobs. Getting images online means juggling upload CLIs. Doing it once is annoying. Doing it every week is a process.

These skills capture that process. They're small, composable, and based on real workarounds discovered the hard way. Hack around with them. Make them your own. Enjoy.

## Installation (30-second setup)

```bash
npx skills@latest add suenyiyang/skills
```

Pick the skills you want, and which coding agents to install them on. The installer copies editable skill files into your project — you own them, and nothing updates behind your back. Pull the latest changes whenever you want with `npx skills update`.

### Local development

Symlink every skill into `~/.agents/skills`:

```bash
scripts/link-skills.sh
```

## Why These Skills Exist

I built these skills to fix common failure modes I hit when turning content into published output with coding agents.

### #1: The Agent Got Blocked Scraping An Article

**The Problem**: Point an agent at a WeChat article and it hits a wall — anti-scraping verification pages, titles that live in `<meta>` instead of the body, watermarked images hidden at *different* CDN tokens than the clean ones, watermarks that only exist as webp. Every session, the agent re-discovers the same traps and burns tokens doing it.

**The Fix**: [`wechat-to-markdown`](./skills/content/wechat-to-markdown/SKILL.md) encodes every workaround found the hard way. One URL in, clean markdown plus watermarked PNGs out — ready to pipe straight into publishing.

### #2: My Notes Don't Travel

**The Problem**: Obsidian notes are great to write in and terrible to publish from. `![[wiki-link]]` images don't resolve outside the vault. Excalidraw drawings are markdown files with LZ-String-compressed blobs inside. Uploading images to a CDN by hand is busywork.

**The Fix** is a small pipeline of composable skills:

- [`excalidraw-export`](./skills/content/excalidraw-export/SKILL.md) — `.excalidraw` and `.excalidraw.md` → PNG, compressed data and all
- [`obsidian-image-resolver`](./skills/content/obsidian-image-resolver/SKILL.md) — resolves every wiki-link, uploads to R2 (content-addressed, so unchanged images are skipped), outputs standard markdown with CDN URLs

The original files are never touched. Local notes stay local; the export is a separate artifact.

### #3: Publishing Is The Boring Part I Keep Doing By Hand

**The Problem**: Once the markdown is clean, someone still has to convert it into a Feishu document, upload the images, and get the block structure right. It's mechanical, and the agent gets it subtly wrong often enough that you end up doing it yourself.

**The Fix**: [`feishu-publish`](./skills/content/feishu-publish/SKILL.md) hands the whole job to `lark-cli` — markdown-to-blocks conversion, image download/upload, and document creation, all native.

### Summary

The chain is the point: scrape → export → resolve → publish. Each skill does one job, takes files as input, and produces files as output. Compose them for the full pipeline, or grab the one that fixes your specific annoyance.

## Reference

### Content

The content creation pipeline: raw material in, published documents out.

| Skill | Description |
|-------|-------------|
| **[wechat-to-markdown](./skills/content/wechat-to-markdown/SKILL.md)** | Convert a WeChat Official Account article URL into clean local markdown plus watermarked PNG images. |
| **[obsidian-image-resolver](./skills/content/obsidian-image-resolver/SKILL.md)** | Resolve Obsidian `![[wiki-link]]` images, export Excalidraw drawings, upload to R2 via the cf CLI, output standard markdown with CDN URLs. |
| **[excalidraw-export](./skills/content/excalidraw-export/SKILL.md)** | Export `.excalidraw` / `.excalidraw.md` files to PNG (handles LZ-String compressed data). |
| **[feishu-publish](./skills/content/feishu-publish/SKILL.md)** | Publish markdown to Feishu documents via `lark-cli`. |

### Tools

| Skill | Description |
|-------|-------------|
| **[video-gen](./skills/tools/video-gen/SKILL.md)** | Generate videos with the Volcengine Ark (火山方舟) Seedance API. |

## Configuration

Skills use a two-layer config system, stored outside this repo:

- **Preferences** (`EXTEND.md`) — Non-sensitive settings. Resolved recursively from `cwd` up to `~/`, allowing per-project overrides: `<dir>/.yiyang-skills/<skill-name>/EXTEND.md`.
- **Secrets** (`.env`) — API keys and tokens. Stored only at `~/.yiyang-skills/<skill-name>/.env` (not recursive, for security).

Each skill has a first-time setup flow (`references/config/first-time-setup.md`) that guides you through configuration.

R2 uploads use the [cf CLI](https://developers.cloudflare.com/cloudflare-cli/) (`npm i -g cf`, then `cf auth login`). No R2 API tokens are stored in config.

## Requirements

- [Bun](https://bun.sh/) (or `npx -y bun`)
- [cf](https://developers.cloudflare.com/cloudflare-cli/) (for R2 uploads in `obsidian-image-resolver`)
- [lark-cli](https://www.npmjs.com/package/@larksuite/cli) (for `feishu-publish`)

## License

MIT
