---
name: first-time-setup
description: First-time Volcengine Ark API key and preference setup flow for yiyang-video-gen
---

# First-Time Setup

## Triggered When

No `.env` file found at `~/.yiyang-skills/yiyang-video-gen/.env`.

## Setup Flow

Use AskUserQuestion with ALL questions in ONE call. Use the user's input language.

### Question 1: Volcengine Ark API Key (secret)

```yaml
header: "Volcengine Ark API Key (火山方舟 API Key)"
question: "Your Volcengine Ark API key (get from: https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey)"
```

### Question 2: Model Endpoint ID (preference)

```yaml
header: "Model Endpoint ID (模型接入点 ID)"
question: "Your Volcengine Ark endpoint ID for video generation (e.g., ep-20260406171020-6q7bg). Create one at: Volcengine Console -> Ark -> Endpoints."
default: "ep-20260406171020-6q7bg"
```

### Question 3: Output Directory (preference, optional)

```yaml
header: "Default Output Directory"
question: "Where to save generated videos? Leave empty to save in the current directory."
default: ""
```

## Save Configuration

After collecting all values, save secrets to `.env` and preferences to `EXTEND.md`:

### 1. Save Secrets (.env)

Secrets are stored at `~/.yiyang-skills/yiyang-video-gen/.env` (NOT recursive -- home directory only, for security).

```bash
mkdir -p "$HOME/.yiyang-skills/yiyang-video-gen"
```

Write `.env` file to `~/.yiyang-skills/yiyang-video-gen/.env`:
```env
ARK_API_KEY=<value>
```

### 2. Save Preferences (EXTEND.md)

Preferences are stored in `EXTEND.md` with YAML frontmatter. These support recursive resolution from cwd upward to `~/`, so per-project overrides are possible.

Write `~/.yiyang-skills/yiyang-video-gen/EXTEND.md`:
```markdown
---
model: <value>
output_dir: <value>
---
```

### 3. Confirm

"Volcengine Ark API key saved to ~/.yiyang-skills/yiyang-video-gen/.env, preferences saved to ~/.yiyang-skills/yiyang-video-gen/EXTEND.md"

## Config Resolution

EXTEND.md files are resolved recursively from cwd upward to `~/`:

1. `<cwd>/.yiyang-skills/yiyang-video-gen/EXTEND.md`
2. `<parent-of-cwd>/.yiyang-skills/yiyang-video-gen/EXTEND.md`
3. ... (walk up directory tree)
4. `~/.yiyang-skills/yiyang-video-gen/EXTEND.md`

Nearest config wins. This allows per-project overrides (e.g., different model endpoint per project).

Secrets (.env) are always loaded from `~/.yiyang-skills/yiyang-video-gen/.env` only.

4. Continue with the original video generation task.
