# yiyang-skills

Personal agent skills for content creation and publishing.

## Skills

### [Content](./skills/content/README.md)

The content creation pipeline: raw material in, published documents out.

| Skill | Description |
|-------|-------------|
| **[wechat-to-markdown](./skills/content/wechat-to-markdown/SKILL.md)** | Convert a WeChat Official Account article URL into clean local markdown plus watermarked PNG images. |
| **[obsidian-image-resolver](./skills/content/obsidian-image-resolver/SKILL.md)** | Resolve Obsidian `![[wiki-link]]` images, export Excalidraw drawings, upload to R2 via the cf CLI, output standard markdown with CDN URLs. |
| **[excalidraw-export](./skills/content/excalidraw-export/SKILL.md)** | Export `.excalidraw` / `.excalidraw.md` files to PNG (handles LZ-String compressed data). |
| **[feishu-publish](./skills/content/feishu-publish/SKILL.md)** | Publish markdown to Feishu documents via `lark-cli`. |

### [Tools](./skills/tools/README.md)

| Skill | Description |
|-------|-------------|
| **[video-gen](./skills/tools/video-gen/SKILL.md)** | Generate videos with the Volcengine Ark (火山方舟) Seedance API. |

## Install

```bash
npx skills@latest add suenyiyang/skills
```

### Local development

Symlink every skill into `~/.agents/skills`:

```bash
scripts/link-skills.sh
```

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
