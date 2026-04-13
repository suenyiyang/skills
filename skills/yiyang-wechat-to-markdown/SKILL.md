---
name: yiyang-wechat-to-markdown
description: Convert a WeChat Official Account (公众号) article URL into clean local markdown plus watermarked PNG images, ready to pipe into publishing skills like yiyang-feishu-publish. Handles WeChat's anti-scraping verification page, extracts the real article title, downloads the original-article 「原创」 watermarked image variants (not the plain images), converts webp→png, and emits a markdown file with local image references. Use whenever the user gives a `mp.weixin.qq.com/s/...` link and asks to "convert wechat article", "抓取公众号文章", "把这篇微信文章转成 markdown", "save wechat article as markdown", "publish this wechat article to feishu/obsidian/notion" — even if they only paste the link without asking explicitly, offer this skill.
---

# WeChat Article → Markdown

Turn a WeChat Official Account article URL into a local `article.md` plus a sibling `images/` directory of watermarked PNGs. The output is plain markdown (`![caption](./images/img-1.png)`) so it composes cleanly with other skills (`yiyang-feishu-publish`, `yiyang-r2-upload`, Obsidian, etc.).

## Why this skill exists

WeChat article scraping is full of surprises. This skill captures the workarounds so Claude doesn't have to re-discover them each time:

1. **Verification page** — `WebFetch` on a raw `mp.weixin.qq.com/s/...` URL often hits "当前环境异常，完成验证后即可继续访问". `defuddle` renders the page in a headless browser and bypasses this.
2. **Title is in `<meta>`, not the body** — `defuddle parse <url> -p title` returns the real title (e.g. `OpenClaw？DeerFlow？Hermes Agent？如何应对层出不穷的 "Agent"`) which isn't an `<h1>` in the body.
3. **Watermarks live at different tokens** — For 「原创」 articles, WeChat stores the watermarked variant of each image under a *different* CDN token. The `data-src` / defuddle-extracted URL is always the *clean* version. The watermarked token is buried inside `watermark_info: { cdn_url: '...' }` blocks in the raw HTML. Appending `&watermark=1&tp=webp` to the clean URL does NOT add a watermark — it just re-encodes the clean image. You must use the watermark token.
4. **WeChat only serves watermarked images as webp** — `tp=webp` is required; `tp=png/jpg` + `watermark=1` returns the clean PNG. Convert webp→png locally with `dwebp` so downstream tools don't have to deal with webp.
5. **Straight quotes `"..."` in defuddle output** — The rendered article uses Chinese curly quotes `"..."`. Defuddle normalizes them to straight quotes. The script restores Chinese quotes in text paragraphs while leaving HTML attribute quotes alone.

## Prerequisites

The script shells out to three tools. If any are missing it exits with a JSON error carrying an install hint:

| Tool | Install |
|------|---------|
| `defuddle` | `npm install -g defuddle-cli` |
| `dwebp` (libwebp) | `brew install webp` |
| `curl` | Preinstalled on macOS |

## Usage

```bash
bun <skill-dir>/scripts/convert.ts \
  --url "https://mp.weixin.qq.com/s/XXXXXXXXXXX" \
  --out "./wechat-article"
```

Flags:

| Flag | Required | Default | Purpose |
|------|----------|---------|---------|
| `--url <url>` | yes | — | WeChat article URL (`mp.weixin.qq.com/s/...`) |
| `--out <dir>` | yes | — | Output directory. Will be created. Writes `article.md` + `images/img-*.png`. |
| `--skip-watermark` | no | false | Fall back to the clean (non-watermarked) image token. Useful for non-「原创」 articles that have no `watermark_info`. |
| `--keep-straight-quotes` | no | false | Disable `"..."` → `"..."` normalization. |
| `--dry-run` | no | false | Print the plan (title, image URLs, output paths) as JSON without writing files. |

## Output

```
<out>/
├── article.md       # with YAML frontmatter: title, source, fetched_at
└── images/
    ├── img-1.png
    ├── img-2.png
    └── ...
```

`article.md` uses local references:

```markdown
---
title: "OpenClaw？DeerFlow？Hermes Agent？如何应对层出不穷的 "Agent""
source: https://mp.weixin.qq.com/s/sokCDTHeQNJsBWmaRfSGYQ
fetched_at: 2026-04-13T15:40:00Z
---

前两天，社交媒体和工作群里，又出现了一个新的概念，Hermes Agent。
...

![Agent、Harness、Framework 之间的关系](./images/img-1.png)
```

The script prints a JSON summary to stdout:

```json
{
  "success": true,
  "out_dir": "./wechat-article",
  "markdown_path": "./wechat-article/article.md",
  "title": "...",
  "image_count": 11,
  "watermarked_image_count": 11,
  "source": "https://mp.weixin.qq.com/s/..."
}
```

## Workflow

Run the script, then compose with other skills. Typical pipelines:

**To Feishu:**
```bash
bun <skill-dir>/scripts/convert.ts --url <url> --out ./tmp/wechat
# then hand ./tmp/wechat/article.md + ./tmp/wechat/images/ to yiyang-feishu-publish
```
`yiyang-feishu-publish` already knows how to rewrite `![alt](path)` → `<image url="..."/>` for remote URLs, and how to call `docs +media-insert` for local image paths. Since WeChat images end up local (`./images/img-*.png`), use the `media-insert` path — or pre-upload them via `yiyang-r2-upload` to get remote URLs.

**To Obsidian:**
Drop `article.md` into the vault and move `images/` alongside. Image references are already relative.

## How it works internally

The script does five things:

1. **Fetch metadata via defuddle** — `defuddle parse <url> --md` (body) and `-p title` (real title). Defuddle runs a headless browser, so it clears the verification page that plain `fetch` / `WebFetch` cannot.
2. **Fetch the raw article HTML** — `curl <url>` with a real User-Agent, so we can grep for `watermark_info` blocks.
3. **Pair watermark tokens with body images** — the HTML contains `cdn_url: '...'` entries in order: `[main_1, wm_1, main_2, wm_2, ...]`. Each body image has exactly one pair. Build watermarked URLs: `https://mmbiz.qpic.cn/(sz_)?mmbiz_png/<wm_token>/640?wx_fmt=png&from=appmsg&watermark=1&tp=webp&wxfrom=5&wx_lazy=1`.
4. **Download + decode** — `curl` each watermarked URL to webp, then `dwebp` to PNG. Fall back to the non-watermarked URL if the `watermark_info` block is missing (non-原创 articles) or `--skip-watermark` is set.
5. **Rewrite image URLs + normalize quotes** — Replace each `![alt](remote_url)` in the defuddle markdown with `![alt](./images/img-N.png)`. For each line outside HTML tags, alternate-toggle `"` → `"` / `"` to restore Chinese curly quotes, but only if the line contains any CJK character (so English prose stays untouched).

## Edge cases handled

- Non-原创 articles (no `watermark_info` → falls back to clean images, emits a warning)
- Image count mismatch between defuddle markdown and watermark pairs (warns, uses the shorter list)
- Http vs https in `cdn_url` (upgrades to https)
- The "profile avatar" and end-of-article logo images in the HTML that aren't in the body (ignored because defuddle doesn't reference them)
- Titles containing `"` or `:` (YAML-escaped in frontmatter)

## When NOT to trigger

- Pure URL shorteners not on `mp.weixin.qq.com` (this skill is WeChat-specific)
- Video-only articles (no images to download; still works but the main output is text)
- Reader-mode exports from non-WeChat sites — use `defuddle parse <url> --md` directly instead
