#!/usr/bin/env bun

import { execSync } from "child_process";
import { existsSync, readFileSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";

interface Target {
  package: string;
  version: string;
}

interface Finding {
  package: string;
  version: string;
  location: string;
  source: string;
}

interface ScanResult {
  success: boolean;
  targets: string[];
  compromised: Finding[];
  safe: Finding[];
  scanned: Record<string, boolean>;
  errors?: string[];
}

function parseTargets(args: string[]): Target[] {
  return args.map((arg) => {
    const atIdx = arg.lastIndexOf("@");
    if (atIdx <= 0) {
      throw new Error(
        `Invalid format: "${arg}". Expected <package>@<version>`
      );
    }
    return {
      package: arg.slice(0, atIdx),
      version: arg.slice(atIdx + 1),
    };
  });
}

function readPackageVersion(
  pkgJsonPath: string
): { name: string; version: string } | null {
  try {
    const content = JSON.parse(readFileSync(pkgJsonPath, "utf-8"));
    return { name: content.name || "", version: content.version || "" };
  } catch {
    return null;
  }
}

function commandExists(cmd: string): boolean {
  try {
    execSync(`which ${cmd}`, { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

function getCommandOutput(cmd: string, timeout = 30000): string | null {
  try {
    return execSync(cmd, { stdio: "pipe", timeout })
      .toString()
      .trim();
  } catch {
    return null;
  }
}

// Skip directories that can't contain node_modules
const SKIP_DIRS = new Set([
  ".Trash",
  ".git",
  "Library",
  "Applications",
  "Music",
  "Movies",
  "Photos",
  "Pictures",
  ".local",
  ".cargo",
  ".rustup",
  ".pyenv",
  ".rbenv",
  ".sdkman",
]);

// Check a package dir inside node_modules for target matches
function checkPackageDir(
  pkgDir: string,
  packageNames: Set<string>,
  targets: Target[],
  compromised: Finding[],
  safe: Finding[],
  seen: Set<string>,
  source: string
): void {
  const pkgJson = join(pkgDir, "package.json");
  if (seen.has(pkgJson) || !existsSync(pkgJson)) return;
  seen.add(pkgJson);

  const info = readPackageVersion(pkgJson);
  if (!info || !packageNames.has(info.name)) return;

  const finding: Finding = {
    package: info.name,
    version: info.version,
    location: pkgDir,
    source,
  };

  const isTarget = targets.some(
    (t) => t.package === info.name && t.version === info.version
  );
  if (isTarget) {
    compromised.push(finding);
  } else {
    safe.push(finding);
  }
}

// Scan a node_modules directory (including pnpm .pnpm structure)
function scanNodeModulesDir(
  nmDir: string,
  packageNames: Set<string>,
  targets: Target[],
  compromised: Finding[],
  safe: Finding[],
  seen: Set<string>,
  source: string
): void {
  if (!existsSync(nmDir)) return;

  try {
    const entries = readdirSync(nmDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const fullPath = join(nmDir, entry.name);

      if (entry.name === ".pnpm") {
        // pnpm structure: .pnpm/<pkg>@<ver>/node_modules/<pkg>/
        try {
          const pnpmEntries = readdirSync(fullPath, { withFileTypes: true });
          for (const pnpmEntry of pnpmEntries) {
            if (!pnpmEntry.isDirectory()) continue;
            // Check if this dir name starts with a target package name
            const matchesTarget = [...packageNames].some(
              (name) =>
                pnpmEntry.name.startsWith(`${name}@`) ||
                pnpmEntry.name.includes(`+${name.replace("/", "+")}@`)
            );
            if (!matchesTarget) continue;

            const innerNm = join(fullPath, pnpmEntry.name, "node_modules");
            if (!existsSync(innerNm)) continue;

            // Check each package name inside this inner node_modules
            for (const name of packageNames) {
              const parts = name.split("/");
              const pkgDir =
                parts.length > 1
                  ? join(innerNm, parts[0], parts[1])
                  : join(innerNm, name);
              checkPackageDir(
                pkgDir,
                packageNames,
                targets,
                compromised,
                safe,
                seen,
                source
              );
            }
          }
        } catch {}
        continue;
      }

      // Scoped packages (@scope/name)
      if (entry.name.startsWith("@")) {
        try {
          const scopedEntries = readdirSync(fullPath, { withFileTypes: true });
          for (const scopedEntry of scopedEntries) {
            if (!scopedEntry.isDirectory()) continue;
            const scopedName = `${entry.name}/${scopedEntry.name}`;
            if (packageNames.has(scopedName)) {
              checkPackageDir(
                join(fullPath, scopedEntry.name),
                packageNames,
                targets,
                compromised,
                safe,
                seen,
                source
              );
            }
          }
        } catch {}
        continue;
      }

      // Direct match
      if (packageNames.has(entry.name)) {
        checkPackageDir(
          fullPath,
          packageNames,
          targets,
          compromised,
          safe,
          seen,
          source
        );
      }
    }
  } catch {}
}

// Recursively walk the filesystem looking for node_modules directories
function walkForNodeModules(
  dir: string,
  packageNames: Set<string>,
  targets: Target[],
  compromised: Finding[],
  safe: Finding[],
  seen: Set<string>,
  depth: number
): void {
  if (depth <= 0) return;

  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (SKIP_DIRS.has(entry.name)) continue;

      const fullPath = join(dir, entry.name);

      if (entry.name === "node_modules") {
        scanNodeModulesDir(
          fullPath,
          packageNames,
          targets,
          compromised,
          safe,
          seen,
          "node_modules"
        );
        // Don't recurse deeper past node_modules — the scanNodeModulesDir
        // already handles the inner structure
        continue;
      }

      // Recurse into subdirectories that might contain projects
      walkForNodeModules(
        fullPath,
        packageNames,
        targets,
        compromised,
        safe,
        seen,
        depth - 1
      );
    }
  } catch {}
}

function scanNodeModules(
  homeDir: string,
  targets: Target[]
): Finding[][] {
  const packageNames = new Set(targets.map((t) => t.package));
  const compromised: Finding[] = [];
  const safe: Finding[] = [];
  const seen = new Set<string>();

  walkForNodeModules(
    homeDir,
    packageNames,
    targets,
    compromised,
    safe,
    seen,
    12
  );

  return [compromised, safe];
}

function scanNpmCache(targets: Target[]): Finding[][] {
  const compromised: Finding[] = [];
  const safe: Finding[] = [];
  const packageNames = new Set(targets.map((t) => t.package));

  const cacheDir = join(homedir(), ".npm", "_cacache", "index-v5");
  if (!existsSync(cacheDir)) return [compromised, safe];

  try {
    for (const name of packageNames) {
      const cmd = `grep -r "${name}" "${cacheDir}" 2>/dev/null | head -50`;
      const output = getCommandOutput(cmd);
      if (!output) continue;

      for (const line of output.split("\n")) {
        try {
          const jsonPart = line.slice(line.indexOf("{"));
          const entry = JSON.parse(jsonPart);
          const key = entry.key || "";
          for (const target of targets) {
            if (
              target.package === name &&
              key.includes(`${name}-${target.version}.tgz`)
            ) {
              compromised.push({
                package: name,
                version: target.version,
                location: `npm cache (${cacheDir})`,
                source: "npm_cache",
              });
            }
          }
        } catch {}
      }
    }
  } catch {}

  return [compromised, safe];
}

function scanPnpmStore(targets: Target[]): Finding[][] {
  const compromised: Finding[] = [];
  const safe: Finding[] = [];
  const packageNames = new Set(targets.map((t) => t.package));

  const storePath = getCommandOutput("pnpm store path 2>/dev/null");
  if (!storePath || !existsSync(storePath)) return [compromised, safe];

  // pnpm v10 content-addressable store doesn't have named dirs per package.
  // Check if there's a v3 or older layout with package dirs.
  try {
    for (const name of packageNames) {
      const cmd = `find "${storePath}" -maxdepth 6 -path "*/${name}/package.json" 2>/dev/null | head -50`;
      const output = getCommandOutput(cmd, 30000);
      if (!output) continue;

      for (const pkgJsonPath of output.split("\n")) {
        if (!pkgJsonPath.trim()) continue;
        const info = readPackageVersion(pkgJsonPath.trim());
        if (!info) continue;

        const finding: Finding = {
          package: info.name,
          version: info.version,
          location: dirname(pkgJsonPath.trim()),
          source: "pnpm_store",
        };

        const isTarget = targets.some(
          (t) => t.package === info.name && t.version === info.version
        );
        if (isTarget) {
          compromised.push(finding);
        } else if (packageNames.has(info.name)) {
          safe.push(finding);
        }
      }
    }
  } catch {}

  return [compromised, safe];
}

function scanYarnCache(targets: Target[]): Finding[][] {
  const compromised: Finding[] = [];
  const safe: Finding[] = [];
  const packageNames = new Set(targets.map((t) => t.package));

  // Yarn v1 cache
  const yarnCacheDir = getCommandOutput("yarn cache dir 2>/dev/null");
  if (yarnCacheDir && existsSync(yarnCacheDir)) {
    try {
      for (const name of packageNames) {
        const cmd = `find "${yarnCacheDir}" -maxdepth 6 -path "*/${name}/package.json" 2>/dev/null | head -50`;
        const output = getCommandOutput(cmd, 30000);
        if (!output) continue;

        for (const pkgJsonPath of output.split("\n")) {
          if (!pkgJsonPath.trim()) continue;
          const info = readPackageVersion(pkgJsonPath.trim());
          if (!info) continue;

          const finding: Finding = {
            package: info.name,
            version: info.version,
            location: dirname(pkgJsonPath.trim()),
            source: "yarn_cache",
          };

          const isTarget = targets.some(
            (t) => t.package === info.name && t.version === info.version
          );
          if (isTarget) {
            compromised.push(finding);
          } else if (packageNames.has(info.name)) {
            safe.push(finding);
          }
        }
      }
    } catch {}
  }

  // Yarn berry cache
  const berryCache = getCommandOutput(
    "yarn config get cacheFolder 2>/dev/null"
  );
  if (
    berryCache &&
    berryCache !== "undefined" &&
    existsSync(berryCache)
  ) {
    try {
      for (const target of targets) {
        const pattern = `${target.package}-npm-${target.version}`;
        const cmd = `find "${berryCache}" -name "*${pattern}*" 2>/dev/null | head -10`;
        const output = getCommandOutput(cmd);
        if (output && output.trim()) {
          for (const match of output.trim().split("\n")) {
            compromised.push({
              package: target.package,
              version: target.version,
              location: match.trim(),
              source: "yarn_berry_cache",
            });
          }
        }
      }
    } catch {}
  }

  return [compromised, safe];
}

function scanBunCache(targets: Target[]): Finding[][] {
  const compromised: Finding[] = [];
  const safe: Finding[] = [];
  const packageNames = new Set(targets.map((t) => t.package));

  const bunCacheDir = join(homedir(), ".bun", "install", "cache");
  if (!existsSync(bunCacheDir)) return [compromised, safe];

  try {
    for (const name of packageNames) {
      // Bun cache uses dirs like: <package>@<version>@@<hash>
      const entries = readdirSync(bunCacheDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (!entry.name.startsWith(`${name}@`)) continue;

        const pkgJson = join(bunCacheDir, entry.name, "package.json");
        if (!existsSync(pkgJson)) continue;
        const info = readPackageVersion(pkgJson);
        if (!info) continue;

        const finding: Finding = {
          package: info.name,
          version: info.version,
          location: join(bunCacheDir, entry.name),
          source: "bun_cache",
        };

        const isTarget = targets.some(
          (t) => t.package === info.name && t.version === info.version
        );
        if (isTarget) {
          compromised.push(finding);
        } else if (packageNames.has(info.name)) {
          safe.push(finding);
        }
      }
    }
  } catch {}

  return [compromised, safe];
}

// --- Main ---

const args = process.argv.slice(2);

if (args.length === 0) {
  console.log(
    JSON.stringify({
      success: false,
      error:
        "No package targets specified. Usage: check.ts <package>@<version> [...]",
    })
  );
  process.exit(1);
}

let targets: Target[];
try {
  targets = parseTargets(args);
} catch (e: any) {
  console.log(JSON.stringify({ success: false, error: e.message }));
  process.exit(1);
}

const allCompromised: Finding[] = [];
const allSafe: Finding[] = [];
const scanned: Record<string, boolean> = {
  npm_cache: false,
  pnpm_store: false,
  yarn_cache: false,
  bun_cache: false,
  node_modules: false,
};
const errors: string[] = [];

// Scan npm cache
if (commandExists("npm")) {
  scanned.npm_cache = true;
  const [c, s] = scanNpmCache(targets);
  allCompromised.push(...c);
  allSafe.push(...s);
}

// Scan pnpm store
if (commandExists("pnpm")) {
  scanned.pnpm_store = true;
  const [c, s] = scanPnpmStore(targets);
  allCompromised.push(...c);
  allSafe.push(...s);
}

// Scan yarn cache
if (commandExists("yarn")) {
  scanned.yarn_cache = true;
  const [c, s] = scanYarnCache(targets);
  allCompromised.push(...c);
  allSafe.push(...s);
}

// Scan bun cache
if (commandExists("bun")) {
  scanned.bun_cache = true;
  const [c, s] = scanBunCache(targets);
  allCompromised.push(...c);
  allSafe.push(...s);
}

// Scan all node_modules
scanned.node_modules = true;
const [c, s] = scanNodeModules(homedir(), targets);
allCompromised.push(...c);
allSafe.push(...s);

const result: ScanResult = {
  success: true,
  targets: args,
  compromised: allCompromised,
  safe: allSafe,
  scanned,
};

if (errors.length > 0) {
  result.errors = errors;
}

console.log(JSON.stringify(result, null, 2));
