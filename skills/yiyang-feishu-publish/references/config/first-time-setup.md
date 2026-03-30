---
name: first-time-setup
description: First-time lark-cli configuration and authentication setup for yiyang-feishu-publish
---

# First-Time Setup

## Triggered When

`lark-cli auth status` shows "Not configured" or "Not logged in".

## Prerequisites

The user needs a Feishu self-built app (自建应用). If they don't have one:

1. Run `lark-cli config init --new` — this opens a browser to create a new app automatically
2. Or manually create at [Feishu Open Platform](https://open.feishu.cn/app):
   - Click "Create App" → choose "Custom App" (自建应用)
   - Add required permissions: `docx:document`, `drive:drive`
   - Publish the app to activate permissions

## Setup Flow

### Option A: New App (Recommended)

Run in background, extract the auth URL from output, and send to user:

```bash
lark-cli config init --new
```

This command blocks until the user completes setup in the browser. It creates a new Feishu app automatically.

### Option B: Existing App

If the user already has an app (e.g., from previous .env setup):

```bash
echo "<APP_SECRET>" | lark-cli config init --app-id <APP_ID> --app-secret-stdin --brand feishu
```

### Option C: Migrate from .env

If `~/.yiyang-skills/yiyang-feishu-publish/.env` exists with `FEISHU_APP_ID` and `FEISHU_APP_SECRET`:

1. Read the .env values
2. Configure lark-cli with those credentials (Option B above)

## Authentication

After config, authenticate:

```bash
lark-cli auth login --recommend
```

Run in background, extract the auth URL from output, and send to user. The command blocks until the user completes authorization in the browser.

## Verify

```bash
lark-cli auth status
```

## Save Preferences (EXTEND.md) — optional

If the user wants per-project defaults (e.g., folder token), save to EXTEND.md:

```markdown
---
default_folder: <folder_token>
default_wiki_space: <wiki_space_id>
---
```

Location: `~/.yiyang-skills/yiyang-feishu-publish/EXTEND.md` (or per-project override).

## Continue

Once `lark-cli auth status` shows success, proceed with the publish task.
