---
name: first-time-setup
description: First-time setup for obsidian-image-resolver — collects Obsidian vault path and R2 settings via EXTEND.md
---

# First-Time Setup

## Triggered When

No EXTEND.md found for `obsidian-image-resolver` (and no legacy `.env` either).

## Pre-requisite

Uploads go through the [cf CLI](https://developers.cloudflare.com/cloudflare-cli/). Ensure it is installed and authenticated:

```bash
npm i -g cf
cf auth login
```

The user needs an R2 bucket with public access (a custom domain or the r2.dev subdomain enabled).

## Setup Flow

Use AskUserQuestion with ALL questions in ONE call. Use the user's input language.

### Question 1: Obsidian Vault Path

```yaml
header: "Obsidian Vault Path"
question: "Where is your Obsidian vault? (absolute path to the vault root directory)"
```

Hint: On macOS, vaults are typically at `~/Documents/<vault-name>` or `~/Obsidian/<vault-name>`.

### Question 2: R2 Bucket Name

```yaml
header: "R2 Bucket Name"
question: "Which R2 bucket should images be uploaded to?"
```

### Question 3: R2 Public URL

```yaml
header: "R2 Public URL"
question: "What is the public base URL of the bucket? (custom domain or https://pub-xxx.r2.dev)"
```

### Question 4: Key Prefix (optional)

```yaml
header: "R2 Key Prefix"
question: "Optional prefix for uploaded object keys (e.g. blog/). Leave empty for none."
default: ""
```

## Save EXTEND.md

1. Create directory:
   ```bash
   mkdir -p "$HOME/.yiyang-skills/obsidian-image-resolver"
   ```

2. Write `EXTEND.md` to `~/.yiyang-skills/obsidian-image-resolver/EXTEND.md`:
   ```markdown
   ---
   vault_path: <value>
   r2_bucket_name: <value>
   r2_public_url: <value>
   r2_key_prefix: <value>
   ---
   ```

3. Confirm: "Configuration saved to ~/.yiyang-skills/obsidian-image-resolver/EXTEND.md"

## Config Resolution

EXTEND.md files are resolved recursively from cwd upward to `~/`:

1. `<cwd>/.yiyang-skills/obsidian-image-resolver/EXTEND.md`
2. `<parent-of-cwd>/.yiyang-skills/obsidian-image-resolver/EXTEND.md`
3. ... (walk up directory tree)
4. `~/.yiyang-skills/obsidian-image-resolver/EXTEND.md`

Nearest config wins. This allows per-project vault or bucket overrides if needed.

4. Continue with the export task.
