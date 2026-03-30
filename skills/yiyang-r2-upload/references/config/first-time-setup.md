---
name: first-time-setup
description: First-time R2 credential and preference setup flow for yiyang-r2-upload
---

# First-Time Setup

## Triggered When

No `.env` file found at `~/.yiyang-skills/yiyang-r2-upload/.env`.

## Setup Flow

Use AskUserQuestion with ALL questions in ONE call. Use the user's input language.

### Question 1: Cloudflare Account ID (secret)

```yaml
header: "Cloudflare Account ID"
question: "Your Cloudflare account ID (found in dashboard URL: dash.cloudflare.com/<account-id>, or on the Overview page)"
```

### Question 2: R2 Access Key ID (secret)

```yaml
header: "R2 Access Key ID"
question: "R2 API token access key ID (create at: Cloudflare Dashboard → R2 → Manage R2 API Tokens → Create API Token)"
```

### Question 3: R2 Secret Access Key (secret)

```yaml
header: "R2 Secret Access Key"
question: "R2 API token secret access key (shown only once when you create the token)"
```

### Question 4: Bucket Name (preference)

```yaml
header: "R2 Bucket Name"
question: "Which R2 bucket to upload to?"
```

### Question 5: Public URL Base (preference)

```yaml
header: "Public URL"
question: "Public URL base for accessing uploaded files"
default: "https://sf-cdn.suenyiyang.com/"
```

### Question 6: Default Prefix (preference, optional)

```yaml
header: "Default Upload Prefix"
question: "Default key prefix for uploaded files (e.g., 'images/blog/'). Leave empty for no prefix."
default: ""
```

## Save Configuration

After collecting all values, save secrets to `.env` and preferences to `EXTEND.md`:

### 1. Save Secrets (.env)

Secrets are stored at `~/.yiyang-skills/yiyang-r2-upload/.env` (NOT recursive — home directory only, for security).

```bash
mkdir -p "$HOME/.yiyang-skills/yiyang-r2-upload"
```

Write `.env` file to `~/.yiyang-skills/yiyang-r2-upload/.env`:
```env
R2_ACCOUNT_ID=<value>
R2_ACCESS_KEY_ID=<value>
R2_SECRET_ACCESS_KEY=<value>
```

### 2. Save Preferences (EXTEND.md)

Preferences are stored in `EXTEND.md` with YAML frontmatter. These support recursive resolution from cwd upward to `~/`, so per-project overrides are possible.

Write `~/.yiyang-skills/yiyang-r2-upload/EXTEND.md`:
```markdown
---
r2_bucket_name: <value>
r2_public_url: <value>
default_prefix: <value>
---
```

### 3. Confirm

"R2 secrets saved to ~/.yiyang-skills/yiyang-r2-upload/.env, preferences saved to ~/.yiyang-skills/yiyang-r2-upload/EXTEND.md"

## Config Resolution

EXTEND.md files are resolved recursively from cwd upward to `~/`:

1. `<cwd>/.yiyang-skills/yiyang-r2-upload/EXTEND.md`
2. `<parent-of-cwd>/.yiyang-skills/yiyang-r2-upload/EXTEND.md`
3. ... (walk up directory tree)
4. `~/.yiyang-skills/yiyang-r2-upload/EXTEND.md`

Nearest config wins. This allows per-project overrides (e.g., different bucket or prefix per project).

Secrets (.env) are always loaded from `~/.yiyang-skills/yiyang-r2-upload/.env` only.

4. Continue with the original upload task.
