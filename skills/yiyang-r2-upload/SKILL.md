---
name: yiyang-r2-upload
description: Upload files to Cloudflare R2 object storage with SHA-256 hash-based deduplication. Returns public CDN URL. Use when user asks to upload files to R2, CDN, or cloud storage, or when other skills need to upload images/assets to a remote server. Also triggers when user says "upload to R2", "upload image", "push to CDN", or "upload asset".
---

# R2 Upload

Upload files to Cloudflare R2 with SHA-256 hash deduplication. Uses the S3-compatible API — no wrangler CLI needed.

The core idea: before uploading, compute the file's SHA-256 hash and use it as the object key. If an object with that key already exists in R2, skip the upload — the file is identical. This guarantees no duplicate uploads and gives every file a stable, content-addressed URL.

## Script Directory

1. `{baseDir}` = this SKILL.md file's directory
2. Script path = `{baseDir}/scripts/upload.ts`
3. Resolve `${BUN_X}`: if `bun` is installed → `bun`; if only `npx` is available → `npx -y bun`; otherwise suggest installing bun

## Step 0: Load Configuration — BLOCKING

This step must complete before any upload. Do not skip or defer.

### Secrets (.env) — NOT recursive, home directory only

Check .env existence:

```bash
# macOS / Linux
test -f "$HOME/.yiyang-skills/yiyang-r2-upload/.env" && echo "found"
```

```powershell
# Windows (PowerShell)
if (Test-Path "$HOME\.yiyang-skills\yiyang-r2-upload\.env") { "found" }
```

| Result | Action |
|--------|--------|
| Found | Continue to upload |
| Not found | Run first-time setup ([references/config/first-time-setup.md](references/config/first-time-setup.md)) before proceeding |

### Preferences (EXTEND.md) — recursive from cwd to ~/

The script resolves EXTEND.md recursively from cwd upward to `~/`:

1. `<cwd>/.yiyang-skills/yiyang-r2-upload/EXTEND.md`
2. `<parent-of-cwd>/.yiyang-skills/yiyang-r2-upload/EXTEND.md`
3. ... (walk up directory tree)
4. `~/.yiyang-skills/yiyang-r2-upload/EXTEND.md`

Nearest config wins (overrides parents).

#### EXTEND.md format

```markdown
---
r2_bucket_name: my-bucket
r2_public_url: https://sf-cdn.suenyiyang.com/
default_prefix: images/
---
```

| Key | Description |
|-----|-------------|
| `r2_bucket_name` | R2 bucket name (overrides .env `R2_BUCKET_NAME`) |
| `r2_public_url` | Public URL base (overrides .env `R2_PUBLIC_URL`) |
| `default_prefix` | Default key prefix for uploads |

## Usage

```bash
# Upload a single file
${BUN_X} {baseDir}/scripts/upload.ts --file <path>

# Upload multiple files
${BUN_X} {baseDir}/scripts/upload.ts --file <path1> --file <path2>

# Upload with a key prefix (e.g., for organizing by folder)
${BUN_X} {baseDir}/scripts/upload.ts --file <path> --prefix images/blog/
```

## Output

JSON per file:

```json
{
  "url": "https://sf-cdn.suenyiyang.com/a1b2c3d4e5f6...abcd.png",
  "hash": "a1b2c3d4e5f6...abcd",
  "key": "a1b2c3d4e5f6...abcd.png",
  "uploaded": true,
  "skipped": false,
  "file": "path/to/original.png"
}
```

- `uploaded: true, skipped: false` — new file, uploaded successfully
- `uploaded: false, skipped: true` — file with same hash already in R2, no upload needed
- If an error occurs, the result includes an `error` field instead

## Options

| Option | Description |
|--------|-------------|
| `--file <path>` | File to upload (repeatable for multiple files) |
| `--prefix <prefix>` | Key prefix in R2 bucket (default: none, files go to root) |

## Configuration

### Secrets (.env) — `~/.yiyang-skills/yiyang-r2-upload/.env`

NOT recursive — always loaded from home directory only (for security).

| Variable | Required | Description |
|----------|----------|-------------|
| `R2_ACCOUNT_ID` | Yes | Cloudflare account ID |
| `R2_ACCESS_KEY_ID` | Yes | R2 API token — access key ID |
| `R2_SECRET_ACCESS_KEY` | Yes | R2 API token — secret access key |
| `R2_BUCKET_NAME` | Fallback | R2 bucket name (can be overridden by EXTEND.md `r2_bucket_name`) |
| `R2_PUBLIC_URL` | Fallback | Public URL base (can be overridden by EXTEND.md `r2_public_url`) |

### Preferences (EXTEND.md) — recursive from cwd to ~/

| Key | Description |
|-----|-------------|
| `r2_bucket_name` | R2 bucket name (overrides .env `R2_BUCKET_NAME`) |
| `r2_public_url` | Public URL base, e.g. `https://sf-cdn.suenyiyang.com/` (overrides .env `R2_PUBLIC_URL`) |
| `default_prefix` | Default key prefix for uploads |

To create R2 API tokens: Cloudflare Dashboard → R2 → Overview → Manage R2 API Tokens → Create API Token.
