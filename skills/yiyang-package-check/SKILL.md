---
name: yiyang-package-check
description: Scan local machine for specific npm package versions across all package manager caches (npm, pnpm, yarn, bun) and every node_modules directory. Use when user wants to check if a compromised, vulnerable, or supply-chain-attacked package version is installed locally, or asks to "check package", "scan for vulnerable version", "find axios 1.14.1", "check if I have bad version of X", or any variation of auditing locally installed npm packages by version. Also triggers for Chinese phrases like "检查包版本", "扫描本地依赖".
---

# Package Check

Scan the local machine for specific npm package versions. Useful for supply-chain attack response — quickly determine whether a compromised package version exists anywhere on the system.

## Usage

The user provides one or more `<package>@<version>` specifiers. For example:

```
/yiyang-package-check axios@1.14.1 axios@0.30.4
```

## Script Directory

1. `{baseDir}` = this SKILL.md file's directory
2. Script path = `{baseDir}/scripts/check.ts`
3. Resolve `${BUN_X}`: if `bun` is installed -> `bun`; if only `npx` is available -> `npx -y bun`; otherwise suggest installing bun

## How to Run

Parse the user's input into `<package>@<version>` pairs, then run:

```bash
${BUN_X} run {baseDir}/scripts/check.ts <package>@<version> [<package>@<version> ...]
```

Example:

```bash
bun run {baseDir}/scripts/check.ts axios@1.14.1 axios@0.30.4
```

The script outputs JSON to stdout.

## Interpreting Results

The script returns a JSON object:

```json
{
  "success": true,
  "targets": ["axios@1.14.1", "axios@0.30.4"],
  "compromised": [
    {
      "package": "axios",
      "version": "1.14.1",
      "location": "/path/to/node_modules/axios",
      "source": "node_modules"
    }
  ],
  "safe": [
    {
      "package": "axios",
      "version": "1.7.4",
      "location": "/path/to/node_modules/axios",
      "source": "node_modules"
    }
  ],
  "scanned": {
    "npm_cache": true,
    "pnpm_store": true,
    "yarn_cache": true,
    "bun_cache": true,
    "node_modules": true
  }
}
```

## Presenting Results

After running the script, present a clear summary:

1. **If compromised versions found**: Show each match with its full path and source (cache vs node_modules). Recommend immediate removal actions — `rm -rf` for node_modules entries, cache-specific clean commands for caches.
2. **If no compromised versions found**: Confirm the machine is clean. List the safe versions found and which locations were scanned.
3. **Always**: Show a table of scanned locations and whether each package manager was detected on the system.

Keep the tone direct — this is a security-sensitive operation where clarity matters.
