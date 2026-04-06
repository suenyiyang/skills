---
name: yiyang-video-gen
description: Generate videos using Volcengine Ark (火山方舟) API with optional reference image. Use when user asks to "generate video", "create video", "text to video", "image to video", "生成视频", "文生视频", "图生视频", "视频生成", "make a video".
---

# Video Generation

Generate videos using Volcengine Ark (火山方舟) Seedance API. Supports text-to-video and image-to-video (with a reference image as first frame).

## Script Directory

1. `{baseDir}` = this SKILL.md file's directory
2. Script path = `{baseDir}/scripts/generate.ts`
3. Resolve `${BUN_X}`: if `bun` is installed -> `bun`; if only `npx` is available -> `npx -y bun`; otherwise suggest installing bun

## Step 0: Load Configuration -- BLOCKING

This step must complete before any generation. Do not skip or defer.

### Secrets (.env) -- NOT recursive, home directory only

Check .env existence:

```bash
# macOS / Linux
test -f "$HOME/.yiyang-skills/yiyang-video-gen/.env" && echo "found"
```

| Result | Action |
|--------|--------|
| Found | Continue to generation |
| Not found | Run first-time setup ([references/config/first-time-setup.md](references/config/first-time-setup.md)) before proceeding |

### Preferences (EXTEND.md) -- recursive from cwd to ~/

The script resolves EXTEND.md recursively from cwd upward to `~/`:

1. `<cwd>/.yiyang-skills/yiyang-video-gen/EXTEND.md`
2. `<parent-of-cwd>/.yiyang-skills/yiyang-video-gen/EXTEND.md`
3. ... (walk up directory tree)
4. `~/.yiyang-skills/yiyang-video-gen/EXTEND.md`

Nearest config wins (overrides parents).

#### EXTEND.md format

```markdown
---
model: ep-20260406171020-6q7bg
output_dir: ~/Downloads
---
```

| Key | Description |
|-----|-------------|
| `model` | Volcengine Ark endpoint ID (required) |
| `output_dir` | Directory to save generated videos (default: current directory) |

## Usage

```bash
# Text-to-video
${BUN_X} {baseDir}/scripts/generate.ts --prompt "A cat playing piano"

# Image-to-video (reference image as first frame)
${BUN_X} {baseDir}/scripts/generate.ts --prompt "The cat starts playing" --image /path/to/cat.png

# With options
${BUN_X} {baseDir}/scripts/generate.ts \
  --prompt "Drone flying through a canyon" \
  --duration 5 \
  --ratio 16:9 \
  --resolution 720p

# Image URL as reference
${BUN_X} {baseDir}/scripts/generate.ts \
  --prompt "The scene comes alive" \
  --image https://example.com/scene.jpg
```

## Output

JSON to stdout:

```json
{
  "success": true,
  "task_id": "cgt-2026xxxx-xxxx",
  "video_url": "https://ark-content-generation-cn-beijing.tos-cn-beijing.volces.com/...",
  "output": "/absolute/path/to/output.mp4",
  "duration": 5,
  "resolution": "720p",
  "ratio": "16:9"
}
```

- `video_url` is the remote URL (expires after 24 hours)
- `output` is the local file path where the video was saved
- If an error occurs, the result includes `"success": false` and an `error` field

## Options

| Option | Description | Default |
|--------|-------------|---------|
| `--prompt <text>` | Text prompt describing the video (required) | -- |
| `--image <path-or-url>` | Reference image path or URL (optional, for image-to-video) | -- |
| `--duration <seconds>` | Video duration in seconds (4-15) | `5` |
| `--ratio <ratio>` | Aspect ratio: `16:9`, `9:16`, `4:3`, `3:4`, `21:9`, `1:1` | `16:9` |
| `--resolution <res>` | Resolution: `480p`, `720p`, `1080p` | `720p` |
| `--output <path>` | Output file path (overrides output_dir) | auto-generated |
| `--no-watermark` | Disable watermark | watermark on |

## Configuration

### Secrets (.env) -- `~/.yiyang-skills/yiyang-video-gen/.env`

NOT recursive -- always loaded from home directory only (for security).

| Variable | Required | Description |
|----------|----------|-------------|
| `ARK_API_KEY` | Yes | Volcengine Ark API key (get from: https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey) |

### Preferences (EXTEND.md) -- recursive from cwd to ~/

| Key | Description |
|-----|-------------|
| `model` | Volcengine Ark endpoint ID, e.g. `ep-20260406171020-6q7bg` |
| `output_dir` | Directory to save generated videos (default: cwd) |
