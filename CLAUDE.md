# CLAUDE.md

Claude Code plugin providing Obsidian publishing, Excalidraw export, R2 upload, and Feishu integration skills. Version: **1.1.0**.

## Architecture

Skills are exposed through the single `yiyang-skills` plugin in `.claude-plugin/marketplace.json`.

Each skill contains `SKILL.md` (YAML frontmatter + docs), optional `scripts/`, `references/`.

## Skill Conventions

### Naming

- All skill names start with `yiyang-` (kebab-case)

### Directory Layout

```
skills/yiyang-<name>/
├── SKILL.md                     # Skill definition (required)
├── scripts/
│   └── <main>.ts                # TypeScript, runs with bun
└── references/
    └── config/
        └── first-time-setup.md  # First-time setup instructions
```

### Configuration Architecture

Two types of config, stored separately:

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
name: yiyang-<name>
description: <what it does>. Use when user asks to "<trigger phrases>".
---
```

Descriptions should be slightly "pushy" to improve triggering. Include both English and Chinese trigger phrases where appropriate.

### First-Time Setup Pattern

- Located at `references/config/first-time-setup.md`
- Check if config exists (EXTEND.md and/or .env)
- If not found -> BLOCKING: run first-time setup before any work
- Use `AskUserQuestion` with ALL questions in ONE call
- Separate secrets (.env) from preferences (EXTEND.md)

## Skills Reference

| Skill | Purpose | Config Keys |
|-------|---------|-------------|
| `yiyang-r2-upload` | Upload to Cloudflare R2 with SHA-256 hash dedup | EXTEND: `r2_bucket_name`, `r2_public_url`, `default_prefix` / ENV: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` |
| `yiyang-excalidraw-export` | Export .excalidraw/.excalidraw.md to PNG | EXTEND: `export_output_dir` |
| `yiyang-obsidian-image-resolver` | Resolve Obsidian wiki-links to CDN URLs | EXTEND: `vault_path` |
| `yiyang-feishu-publish` | Publish markdown to Feishu docs via lark-cli | EXTEND: `default_folder`, `default_wiki_space` |
| `yiyang-package-check` | Scan for specific npm package versions across caches and node_modules | None |
| `yiyang-video-gen` | Generate videos via Volcengine Ark (Seedance) API | EXTEND: `model`, `output_dir` / ENV: `ARK_API_KEY` |

### Composability

Skills are atomic and composable. The typical publishing pipeline:

```
Obsidian note --> yiyang-obsidian-image-resolver --> clean markdown with CDN URLs
                    |-> yiyang-excalidraw-export (for .excalidraw files)
                    |-> yiyang-r2-upload (for all images)
                        --> yiyang-feishu-publish (to Feishu)
                        --> or any other publishing target
```

## Adding New Skills

1. Follow naming: `yiyang-<name>`
2. Copy shared config utilities from the reference above
3. Create `SKILL.md`, `scripts/`, `references/config/first-time-setup.md`
4. Add the skill path to `.claude-plugin/marketplace.json`
5. Bump the version in `marketplace.json`

## Release Process

Bump version in `.claude-plugin/marketplace.json`, commit, tag, push.
