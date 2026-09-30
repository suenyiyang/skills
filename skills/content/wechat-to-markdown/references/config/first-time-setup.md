# First-time setup — wechat-to-markdown

This skill has **no required config** — it runs out of the box as long as `defuddle`, `dwebp`, and `curl` are on `PATH`.

The one optional preference is whether to burn the WeChat 「原创」 watermark into exported images. Default is `on`.

## When to offer setup

Before the first run in a given repo, check whether an `EXTEND.md` already exists:

```bash
ls .yiyang-skills/wechat-to-markdown/EXTEND.md 2>/dev/null || \
  ls ~/.yiyang-skills/wechat-to-markdown/EXTEND.md 2>/dev/null
```

If none exists and the user hasn't passed `--watermark` on the CLI, ask a single `AskUserQuestion` with the watermark choice. If they answer, write the preference to `EXTEND.md` so future runs don't need to re-ask. If they decline, proceed with the default (watermark on).

## Question to ask

- **Keep the WeChat 「原创」 watermark on exported images?**
  - Yes — preserves attribution to the original public account. Best for personal wikis, reading notes, and anywhere the source matters.
  - No — cleaner image for re-voicing into internal docs or when the watermark would be visually noisy.
  - Decide per run — skip the config, pass `--watermark on|off` each time.

## Where to write

Ask the user whether the preference is per-project or global:

| Scope | Path |
|-------|------|
| Per-project | `<project>/.yiyang-skills/wechat-to-markdown/EXTEND.md` |
| Global | `~/.yiyang-skills/wechat-to-markdown/EXTEND.md` |

Nearest wins (recursive walk from cwd to `~/`), so a per-project file overrides the global one.

## File format

```markdown
---
watermark: on
---
```

Accepted values (case-insensitive): `on` / `off`, `true` / `false`, `yes` / `no`, `1` / `0`.

## Verifying

The script prints the effective source in its JSON output:

```json
"watermark": { "enabled": false, "source": "extend.md" }
```

`source` is one of:
- `cli` — `--watermark` was passed for this run
- `extend.md` — read from the nearest `EXTEND.md`
- `default` — nothing configured, used the built-in default (`on`)
