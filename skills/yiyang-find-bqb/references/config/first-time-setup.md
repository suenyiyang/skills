# First-time setup — yiyang-find-bqb

This skill works out of the box. No secrets, no required config — just `bun` (or `npx -y bun`) on PATH and network access to `raw.githubusercontent.com`.

## What gets created automatically

| Path | Purpose |
|------|---------|
| `~/.yiyang-skills/yiyang-find-bqb/cache/manifest.json` | Cached copy of the ChineseBQB manifest (~1.3 MB). Auto-refreshed every 7 days, or with `--refresh-manifest`. |
| `/tmp/yiyang-find-bqb/<label>/` | One subfolder per search, holding the downloaded candidate images. Auto-pruned on every run by mtime. |

## Optional preferences

If the defaults don't suit you, write `EXTEND.md`:

```markdown
---
retention_days: 14
tmp_root: /tmp/yiyang-find-bqb
---
```

| Key | Default | Meaning |
|-----|---------|---------|
| `retention_days` | `7` | Subfolders older than this many days are deleted at the start of each run. Set to `0` to keep nothing across runs, or to a large number to disable pruning practically. |
| `tmp_root` | `/tmp/yiyang-find-bqb` | Where downloaded images live. Stay under `/tmp` unless you have a reason — files there are expected to be ephemeral, which is the whole point of the cleanup mechanism. |

### Where to write EXTEND.md

| Scope | Path |
|-------|------|
| Per-project | `<project>/.yiyang-skills/yiyang-find-bqb/EXTEND.md` |
| Global | `~/.yiyang-skills/yiyang-find-bqb/EXTEND.md` |

Resolution: nearest wins (recursive walk from cwd to `~/`), then global, then built-in default.

## When to offer setup

Almost never. Only ask the user about config if they explicitly mention:
- Wanting to keep the candidates around longer than a week (→ `retention_days`)
- Wanting downloads somewhere other than `/tmp` (→ `tmp_root`)

For the typical case, run the script with built-in defaults and skip the config dance.
