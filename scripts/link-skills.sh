#!/usr/bin/env bash
set -euo pipefail

# Links all skills in this repository into the local agent skill directory:
#   - ~/.agents/skills: Pi, Codex and other Agent Skills-compatible harnesses
# Each entry is a symlink into this repo, so a `git pull` keeps installed
# skills up to date. Re-run after adding, removing, or renaming a skill.

REPO="$(cd "$(dirname "$0")/.." && pwd)"
DESTS=("$HOME/.agents/skills")

linked=0
skipped=0

while IFS= read -r -d '' skill_md; do
  src="$(dirname "$skill_md")"
  name="$(basename "$src")"
  for dest in "${DESTS[@]}"; do
    mkdir -p "$dest"
    target="$dest/$name"
    if [ -L "$target" ] && [ "$(readlink "$target")" = "$src" ]; then
      skipped=$((skipped + 1))
      continue
    fi
    if [ -e "$target" ] || [ -L "$target" ]; then
      echo "SKIP: $target already exists and is not a symlink to this repo"
      continue
    fi
    ln -s "$src" "$target"
    echo "LINK: $target -> $src"
    linked=$((linked + 1))
  done
done < <(find "$REPO/skills" -name SKILL.md -print0)

echo "Done: $linked linked, $skipped already up to date."
