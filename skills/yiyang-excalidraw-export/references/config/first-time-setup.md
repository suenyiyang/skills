---
name: first-time-setup
description: First-time EXTEND.md setup for yiyang-excalidraw-export — configures optional export output directory
---

# First-Time Setup

## Triggered When

The user wants to configure a default export output directory for Excalidraw exports, or when the skill detects no EXTEND.md and the user wants to set one up.

Note: This skill works without any configuration — by default, PNGs are placed next to the source `.excalidraw` file. Configuration is only needed to customize the output directory.

## Setup Flow

Use AskUserQuestion. Use the user's input language.

### Question 1: Export Output Directory (optional)

```yaml
header: "Export Output Directory"
question: "Where should exported PNGs be saved by default? Leave empty to place them next to the source file."
default: ""
```

## Save EXTEND.md

If the user provided a directory:

1. Determine the config location. For a per-project config, create it in the project root. For a global default, use `~/.yiyang-skills/yiyang-excalidraw-export/EXTEND.md`.

2. Create directory:
   ```bash
   mkdir -p "$HOME/.yiyang-skills/yiyang-excalidraw-export"
   ```

3. Write `EXTEND.md`:
   ```markdown
   ---
   export_output_dir: <value>
   ---
   ```

4. Confirm: "Configuration saved. Exported PNGs will default to `<value>`."

If left empty, no EXTEND.md is needed — the skill already defaults to placing PNGs next to the source file.

## Config Resolution

EXTEND.md files are resolved recursively from cwd upward to `~/`:

1. `<cwd>/.yiyang-skills/yiyang-excalidraw-export/EXTEND.md`
2. `<parent-of-cwd>/.yiyang-skills/yiyang-excalidraw-export/EXTEND.md`
3. ... (walk up directory tree)
4. `~/.yiyang-skills/yiyang-excalidraw-export/EXTEND.md`

Nearest config wins (overrides parents). This allows per-project overrides of the global default.
