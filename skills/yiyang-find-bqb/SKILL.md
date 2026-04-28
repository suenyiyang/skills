---
name: yiyang-find-bqb
description: Find Chinese 表情包 (BQB / memes / reaction stickers) from the ChineseBQB collection that match a feeling or thought the user wants to express, and download the top candidates to /tmp so they can pick one. Use whenever the user wants to "send a meme", "find a sticker", "express this feeling with a 表情包", "我想发个表情包", "找个表情包", "斗图", "来个表情", "have a meme for X", "react with a sticker", or describes an emotion/reaction (proud, tired, speechless, awkward, 笑死, 无语, 得意, 摆烂, 哈哈) and wants something visual to represent it. Trigger generously — if the user is venting, hyping, or roasting and a meme would land better than words, offer this even if they didn't say "meme".
---

# Find BQB (表情包)

Pick the right Chinese reaction meme from [zhaoolee/ChineseBQB](https://github.com/zhaoolee/ChineseBQB) — a community-curated set of ~28k images across ~110 themed categories (奥特曼, 滑稽, 摆烂, 白色小人, 北方栖姬, …). The repo ships a manifest (`chinesebqb_github.json`) that maps every image to a category and direct CDN URL, which makes keyword filtering tractable without scraping the repo tree.

Your job is to translate the user's *feeling* into the right Chinese keywords, run the script, and present the candidates — never pick on their behalf. Memes are personal; the user's eye is the final judge.

## How to use

1. **Understand what they want to express.** Read the surrounding conversation, not just the trigger sentence. "I'm so done with this PR review" wants tired/exhausted/摆烂 energy. "I called it" wants smug/得意/早就说了 energy.

2. **Generate Chinese keywords.** This is the most important step. The manifest's `name` and `category` fields are mostly Chinese, so English keywords miss almost everything. Produce **3–8 short Chinese keywords or character fragments** that capture the vibe. Mix:
   - Direct emotion words (`无语`, `得意`, `开心`, `生气`)
   - Common BQB tropes (`滑稽`, `白眼`, `捂脸`, `摊手`, `点赞`)
   - Iconic characters from the collection where they fit (`奥特曼`, `蘑菇头`, `熊猫人`, `小黄脸`, `白色小人`)
   - Internet slang variants (`笑死`, `绝绝子`, `躺平`, `摆烂`)

   Keywords are **OR-matched as substrings** against both filename and category, so single Chinese characters (`笑`, `哭`) cast a wide net while compound words (`假笑`, `委屈`) narrow it. Lead with the specific ones — the script returns matches in keyword priority order.

3. **Run the script.** It downloads the top-N matches into a fresh subfolder under `/tmp/yiyang-find-bqb/`, one per search. Old subfolders are pruned by age on every run (default: 7 days).

   ```bash
   bun {baseDir}/scripts/find.ts --keywords "得意,假笑,早就说了,滑稽" --top 6 --label "smug"
   ```

4. **Present the candidates.** The script prints a JSON list of local paths. Show them to the user — ideally inline if the harness renders images, otherwise as a numbered list of paths with the original Chinese filename so they can `open` whichever ones they like. Don't editorialize ("this one is funniest!"); let them pick.

## Script

Path: `{baseDir}/scripts/find.ts`. Run with `bun` (or `npx -y bun` if `bun` isn't on PATH).

| Flag | Required | Default | Purpose |
|------|----------|---------|---------|
| `--keywords <list>` | yes | — | Comma-separated Chinese keywords. OR-matched as substrings against filename + category. |
| `--top <N>` | no | `6` | How many images to download. Cap is 20. |
| `--label <slug>` | no | timestamp | Subfolder name under `/tmp/yiyang-find-bqb/`. Useful for the user to remember which search was which. Sanitized to `[a-z0-9_-]`. |
| `--retention-days <N>` | no | from EXTEND.md or `7` | Override cleanup threshold for this run. Subfolders older than this are deleted before the new search starts. |
| `--no-cleanup` | no | false | Skip the age-based cleanup pass for this run. |
| `--refresh-manifest` | no | false | Force re-download of the manifest even if the cached copy is fresh. |
| `--dry-run` | no | false | Show top matches and would-be paths without downloading. |

The script:

1. Cleans up old `/tmp/yiyang-find-bqb/<...>/` subfolders (mtime older than `retention_days`).
2. Loads the manifest (cached at `~/.yiyang-skills/yiyang-find-bqb/cache/manifest.json`, refreshed if older than 7 days or `--refresh-manifest`).
3. Scores each entry by how many keywords appear in `name + " " + category`, with earlier-listed keywords weighted higher (so you can put the most-on-target word first).
4. Downloads the top N to `/tmp/yiyang-find-bqb/<label>/`, preserving the original Chinese filename.
5. Emits JSON:

   ```json
   {
     "success": true,
     "out_dir": "/tmp/yiyang-find-bqb/smug",
     "keywords": ["得意", "假笑", "早就说了", "滑稽"],
     "candidates": [
       {
         "name": "假笑男孩00001-拽.jpg",
         "category": "001Funny_滑稽大佬😏BQB",
         "path": "/tmp/yiyang-find-bqb/smug/假笑男孩00001-拽.jpg",
         "url": "https://raw.githubusercontent.com/zhaoolee/ChineseBQB/master/...",
         "score": 3
       }
     ],
     "total_matches": 47,
     "manifest_age_seconds": 234,
     "cleanup": { "removed_dirs": 2, "retention_days": 7 }
   }
   ```

   On failure: `{ "success": false, "error": "...", "hint": "..." }`.

## Configuration

Optional. If the user wants a different cleanup window or a different temp root, write `EXTEND.md`:

```markdown
---
retention_days: 14
tmp_root: /tmp/yiyang-find-bqb
---
```

Resolution order (earlier wins): CLI flag → nearest `EXTEND.md` → built-in default. See `references/config/first-time-setup.md` for setup guidance.

## Picking good keywords — examples

| User says | Keywords to try |
|-----------|-----------------|
| "I'm exhausted, this week is destroying me" | `摆烂,躺平,累,瘫,摸鱼` |
| "I told them this would happen" | `得意,假笑,早就说了,滑稽,我就知道` |
| "I have no words for this" | `无语,白眼,黑人问号,沉默,?` |
| "Let's gooo" | `加油,冲,牛逼,鼓掌,握拳` |
| "Awkward silence" | `尴尬,捂脸,沉默,摸头` |
| "Big agree" | `点赞,赞,认同,握手` |
| "Crying laughing" | `笑死,捂脸笑,哈哈,大笑` |
| "Send help" | `救命,瑟瑟发抖,跪了` |

When unsure, broaden with iconic-character keywords (`蘑菇头`, `熊猫人`, `奥特曼`, `白色小人`) — those categories carry hundreds of images each and tend to cover most emotions.

## Cleanup behavior

The script touches only files under `/tmp/yiyang-find-bqb/` (or whatever `tmp_root` is configured). It deletes immediate subdirectories whose mtime is older than `retention_days`. Loose files at the root and unrelated folders are left alone — this skill never reaches outside its own temp directory.

If the user runs the skill many times in one session, each search gets a fresh subfolder; old ones from earlier today won't be deleted unless they exceed the threshold.

## When NOT to trigger

- The user wants to *create* a meme from scratch (use an image-generation skill instead).
- The user wants Western reaction GIFs (e.g. Giphy, KnowYourMeme content) — this collection is Chinese-only.
- The user is asking about meme *culture* or wants an explanation, not an image.
