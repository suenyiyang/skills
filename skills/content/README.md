# Content

Skills for the content creation pipeline: from raw material (WeChat articles, Obsidian notes, Excalidraw drawings) to published documents.

## Skills

- **[wechat-to-markdown](./wechat-to-markdown/SKILL.md)**: Convert a WeChat Official Account article URL into clean local markdown plus watermarked PNG images.
- **[obsidian-image-resolver](./obsidian-image-resolver/SKILL.md)**: Resolve Obsidian `![[wiki-link]]` image references, export Excalidraw drawings, upload images to R2 via the cf CLI, and output standard markdown with CDN URLs.
- **[excalidraw-export](./excalidraw-export/SKILL.md)**: Export `.excalidraw` and `.excalidraw.md` files (including LZ-String compressed data) to PNG.
- **[feishu-publish](./feishu-publish/SKILL.md)**: Publish markdown to Feishu documents via `lark-cli`, with automatic image handling.

## Pipeline

```
WeChat article --(wechat-to-markdown)--> article.md + images/
Obsidian note  --(obsidian-image-resolver)--> clean markdown with CDN URLs
                    |-- excalidraw-export (drawings -> PNG)
                    |-- cf CLI (images -> R2)
                 --(feishu-publish)--> Feishu document
```
