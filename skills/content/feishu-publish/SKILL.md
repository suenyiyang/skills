---
name: feishu-publish
description: Publish markdown content to Feishu (飞书) documents using lark-cli. Converts markdown to Feishu block structure and creates documents. Handles image upload automatically. Use when user asks to "publish to feishu", "发布到飞书", "export to feishu", "飞书文档", "create feishu doc", "发飞书", or when converting markdown/Obsidian notes to Feishu documents.
---

# Feishu Publish

Publish markdown content to Feishu documents using `lark-cli`. The CLI handles markdown-to-blocks conversion, image download/upload, and document creation natively.

## Prerequisites

Requires `lark-cli` installed and configured:
- Install: `npm install -g @larksuite/cli && npx skills add larksuite/cli -y -g`
- Config: `lark-cli config init`
- Auth: `lark-cli auth login --recommend`

## Step 0: Check lark-cli Readiness — BLOCKING

```bash
lark-cli auth status
```

| Result | Action |
|--------|--------|
| Shows authenticated user | Continue |
| Not configured | Run `lark-cli config init --new` in background, extract auth URL, send to user |
| Not logged in | Run `lark-cli auth login --domain docs,drive` in background, extract auth URL, send to user |

**Migrating from .env**: If user has existing credentials in `~/.yiyang-skills/feishu-publish/.env`, they can reuse them:
```bash
# Read App ID from .env, then:
echo "<APP_SECRET>" | lark-cli config init --app-id <APP_ID> --app-secret-stdin --brand feishu
lark-cli auth login --recommend
```

### Preferences (EXTEND.md) — recursive from cwd to ~/

The EXTEND.md mechanism is still used for per-project defaults (e.g., folder tokens). Resolution walks from cwd upward to `~/`:

1. `<cwd>/.yiyang-skills/feishu-publish/EXTEND.md`
2. `<parent-of-cwd>/.yiyang-skills/feishu-publish/EXTEND.md`
3. ... (walk up directory tree)
4. `~/.yiyang-skills/feishu-publish/EXTEND.md`

Nearest config wins. Format:

```markdown
---
default_folder: <folder_token>
default_wiki_space: <wiki_space_id>
---
```

## Step 1: Prepare Markdown

Read the input markdown file. Before passing to lark-cli, convert standard markdown image syntax to Lark-flavored format:

- `![alt text](https://example.com/image.png)` → `<image url="https://example.com/image.png" caption="alt text"/>`

This is required because `lark-cli docs +create` uses Lark-flavored Markdown where images use `<image url="..."/>` tags. The CLI automatically downloads and uploads images from URLs to Feishu's media system.

For local images (file paths), they cannot be embedded inline. Handle them separately in Step 3.

Other Lark-flavored Markdown features that can enhance the document:
- Callouts: `<callout emoji="💡" background-color="light-blue">content</callout>`
- Grids: `<grid cols="2"><column>left</column><column>right</column></grid>`
- Enhanced tables: `<lark-table>...</lark-table>`

See lark-doc skill (`~/.agents/skills/lark-doc/references/lark-doc-create.md`) for full Lark-flavored Markdown reference.

## Step 2: Create Document

```bash
# Basic creation
lark-cli docs +create --title "Document Title" --markdown "$(cat prepared.md)"

# With folder placement
lark-cli docs +create --title "Title" --folder-token <token> --markdown "$(cat prepared.md)"

# In wiki space
lark-cli docs +create --title "Title" --wiki-space my_library --markdown "$(cat prepared.md)"

# Dry run
lark-cli docs +create --title "Title" --markdown "$(cat prepared.md)" --dry-run
```

The command returns JSON with `doc_id` and `doc_url`.

### Long Documents

For documents that may exceed CLI argument limits or API size limits (~10MB), chunk the content:

1. Create with initial content: `lark-cli docs +create --title "Title" --markdown "$(head -200 prepared.md)"`
2. Append remaining chunks: `lark-cli docs +update --doc <doc_id> --mode append --markdown "$(sed -n '201,400p' prepared.md)"`

## Step 3: Handle Local Images (if any)

If the markdown contained local image paths, insert them after document creation:

```bash
lark-cli docs +media-insert --doc <doc_id> --file ./local-image.png --align center --caption "Description"
```

Note: `+media-insert` appends images to the document end. For inline placement, prefer uploading images to a CDN first (e.g., to R2 with the cf CLI), then using `<image url="..."/>` in the markdown.

## Output

Report to user:
- Document URL (`doc_url`)
- Document ID (`doc_id`)
- Number of images processed
- Success/failure status

## Typical Workflow

For exporting an Obsidian note to Feishu:

1. Use `obsidian-image-resolver` to resolve images and get clean markdown with R2 URLs
2. Convert image syntax: `![alt](url)` → `<image url="url" caption="alt"/>`
3. Use `lark-cli docs +create` to publish the document
4. The CLI automatically downloads images from R2 URLs and uploads them to Feishu

## Reference

- **lark-doc skill**: `~/.agents/skills/lark-doc/SKILL.md` — Full document operations reference
- **lark-shared skill**: `~/.agents/skills/lark-shared/SKILL.md` — Auth, identity, and security rules
- **lark-doc-create**: `~/.agents/skills/lark-doc/references/lark-doc-create.md` — Lark-flavored Markdown specification
