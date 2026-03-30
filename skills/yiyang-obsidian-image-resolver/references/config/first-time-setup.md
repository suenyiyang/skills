---
name: first-time-setup
description: First-time setup for yiyang-obsidian-image-resolver — collects Obsidian vault path via EXTEND.md
---

# First-Time Setup

## Triggered When

No EXTEND.md found for `yiyang-obsidian-image-resolver` (and no legacy `.env` either).

## Pre-requisite

Before running this setup, ensure `yiyang-r2-upload` is configured. Check:

```bash
test -f "$HOME/.yiyang-skills/yiyang-r2-upload/.env" && echo "r2 configured"
```

If not configured, run the R2 upload skill's first-time setup first.

## Setup Flow

Use AskUserQuestion. Use the user's input language.

### Question 1: Obsidian Vault Path

```yaml
header: "Obsidian Vault Path"
question: "Where is your Obsidian vault? (absolute path to the vault root directory)"
```

Hint: On macOS, vaults are typically at `~/Documents/<vault-name>` or `~/Obsidian/<vault-name>`.

## Save EXTEND.md

1. Create directory:
   ```bash
   mkdir -p "$HOME/.yiyang-skills/yiyang-obsidian-image-resolver"
   ```

2. Write `EXTEND.md` to `~/.yiyang-skills/yiyang-obsidian-image-resolver/EXTEND.md`:
   ```markdown
   ---
   vault_path: <value>
   ---
   ```

3. Confirm: "Configuration saved to ~/.yiyang-skills/yiyang-obsidian-image-resolver/EXTEND.md"

## Config Resolution

EXTEND.md files are resolved recursively from cwd upward to `~/`:

1. `<cwd>/.yiyang-skills/yiyang-obsidian-image-resolver/EXTEND.md`
2. `<parent-of-cwd>/.yiyang-skills/yiyang-obsidian-image-resolver/EXTEND.md`
3. ... (walk up directory tree)
4. `~/.yiyang-skills/yiyang-obsidian-image-resolver/EXTEND.md`

Nearest config wins. This allows per-project vault overrides if needed.

4. Continue with the export task.
