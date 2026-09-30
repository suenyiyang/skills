# AGENTS.md

Personal agent skills for content creation and publishing. Install with `npx skills add suenyiyang/skills`, or symlink for local development with `scripts/link-skills.sh`.

## Repository Layout

Skills are organized into bucket folders under `skills/`:

- `content/` — the content creation pipeline (WeChat import, Obsidian image resolution, Excalidraw export, Feishu publishing)
- `tools/` — standalone utilities not tied to the pipeline

Every skill must have an entry in the top-level `README.md` and in its bucket's `README.md`. Each entry links the skill name to its `SKILL.md`.

To (re)link every skill into the local agent skill directory (`~/.agents/skills`), run `scripts/link-skills.sh`. Each entry is a symlink into this repo, so a `git pull` keeps installed skills current. Re-run the script after adding, removing, or renaming a skill.

## Skill Conventions

### Naming

- Skill names are plain kebab-case, no prefix: `feishu-publish`, not `yiyang-feishu-publish`

### Directory Layout

```
skills/<bucket>/<skill-name>/
├── SKILL.md                     # Skill definition (required)
├── scripts/
│   └── <main>.ts                # TypeScript, runs with bun
└── references/
    └── config/
        └── first-time-setup.md  # First-time setup instructions
```

### Configuration Architecture

Two types of config, stored outside this repo:

| Type | Where | Resolution |
|------|-------|------------|
| **Preferences** | `.yiyang-skills/<skill-name>/EXTEND.md` | Recursive: cwd -> parent -> ... -> `~/` (nearest wins) |
| **Secrets** | `~/.yiyang-skills/<skill-name>/.env` | Home directory only (NOT recursive, for security) |

Priority chain: `CLI flag > EXTEND.md (nearest) > .env (home) > built-in default`

**EXTEND.md format:**
```markdown
---
key1: value1
key2: value2
---
```

**Secrets (.env):** Standard `KEY=value` format, home directory only.

Note: the config root stays `.yiyang-skills/` even though skill names dropped the prefix. Existing user configs live there.

### Script Conventions

- Runtime: TypeScript via `bun` (fallback: `npx -y bun`)
- All scripts output JSON to stdout (`{ "success": true, ... }` or `{ "success": false, "error": "..." }`)
- Missing config -> JSON error with `hint` field
- `--dry-run` flag where applicable

### Shared Config Utilities

Every script that needs config should include `findExtendMd`, `parseExtendMd`, and `loadSkillConfig` functions. Reference implementation:

```typescript
import { existsSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";

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
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const result: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf(":");
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    let val = trimmed.slice(idx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'")))
      val = val.slice(1, -1);
    result[key] = val;
  }
  return result;
}

function loadSkillConfig(skillName: string): Record<string, string> {
  const path = findExtendMd(skillName);
  return path ? parseExtendMd(path) : {};
}
```

### SKILL.md Conventions

```yaml
---
name: <skill-name>
description: <what it does>. Use when user asks to "<trigger phrases>".
---
```

Descriptions should be slightly "pushy" to improve triggering. Include both English and Chinese trigger phrases where appropriate.

### First-Time Setup Pattern

- Located at `references/config/first-time-setup.md`
- Check if config exists (EXTEND.md and/or .env)
- If not found -> BLOCKING: run first-time setup before any work
- Ask the user for all required values in one message, not one question per message
- Separate secrets (.env) from preferences (EXTEND.md)

## Skills Reference

| Skill | Bucket | Purpose | Config Keys |
|-------|--------|---------|-------------|
| `wechat-to-markdown` | content | WeChat article URL -> local markdown + watermarked PNGs | EXTEND: `watermark` (on/off) |
| `obsidian-image-resolver` | content | Resolve Obsidian wiki-links, upload images to R2 via cf CLI | EXTEND: `vault_path`, `r2_bucket_name`, `r2_public_url`, `r2_key_prefix` |
| `excalidraw-export` | content | Export .excalidraw/.excalidraw.md to PNG | EXTEND: `export_output_dir` |
| `feishu-publish` | content | Publish markdown to Feishu docs via lark-cli | EXTEND: `default_folder`, `default_wiki_space` |
| `video-gen` | tools | Generate videos via Volcengine Ark (Seedance) API | EXTEND: `model`, `output_dir` / ENV: `ARK_API_KEY` |

### External CLIs

- **R2 uploads** go through the [cf CLI](https://developers.cloudflare.com/cloudflare-cli/) (`cf r2 objects put`), authenticated via `cf auth login`. Do not resurrect a bespoke R2 upload skill or store R2 tokens in `.env`.
- **Feishu publishing** goes through `lark-cli` (`lark-cli docs +create`), authenticated via `lark-cli auth login`.

### Composability

Skills are atomic and composable. The typical publishing pipeline:

```
Obsidian note --> obsidian-image-resolver --> clean markdown with CDN URLs
                    |-> excalidraw-export (for .excalidraw files)
                    |-> cf CLI (for image upload to R2)
                        --> feishu-publish (to Feishu)
                        --> or any other publishing target
```

## Adding New Skills

1. Pick a bucket (`content/` or `tools/`), name the skill in plain kebab-case
2. Copy shared config utilities from the reference above
3. Create `SKILL.md`, `scripts/`, `references/config/first-time-setup.md`
4. Add the skill to the bucket `README.md` and the top-level `README.md`
