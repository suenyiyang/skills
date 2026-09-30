#!/usr/bin/env bun

import { readFile, writeFile, mkdir } from "fs/promises";
import { resolve, join, extname, basename, dirname } from "path";
import { homedir } from "os";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { parseArgs } from "util";
import { createServer, type Server } from "http";

// ---------------------------------------------------------------------------
// .env loader (secrets — home directory only, NOT recursive)
// ---------------------------------------------------------------------------

function loadEnv(envPath: string): Record<string, string> {
  const env: Record<string, string> = {};
  if (!existsSync(envPath)) return env;
  const content = readFileSync(envPath, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    let val = trimmed.slice(idx + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    env[key] = val;
  }
  return env;
}

// ---------------------------------------------------------------------------
// EXTEND.md config resolution (recursive walk from cwd to ~)
// ---------------------------------------------------------------------------

function findExtendMd(skillName: string): string | null {
  const home = homedir();
  let dir = process.cwd();

  while (true) {
    const candidate = join(dir, ".yiyang-skills", skillName, "EXTEND.md");
    if (existsSync(candidate)) return candidate;
    if (dir === home) break;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  const homeCandidate = join(home, ".yiyang-skills", skillName, "EXTEND.md");
  if (existsSync(homeCandidate)) return homeCandidate;
  return null;
}

function parseExtendMd(filePath: string): Record<string, string> {
  const content = readFileSync(filePath, "utf-8");
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!frontmatterMatch) return {};

  const result: Record<string, string> = {};
  for (const line of frontmatterMatch[1].split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf(":");
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    let val = trimmed.slice(idx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    result[key] = val;
  }
  return result;
}

function loadSkillConfig(skillName: string): Record<string, string> {
  const extendPath = findExtendMd(skillName);
  if (!extendPath) return {};
  return parseExtendMd(extendPath);
}

// Load secrets from .env (home dir only)
const home = homedir();
const envPath = join(home, ".yiyang-skills", "feishu-publish", ".env");
const fileEnv = loadEnv(envPath);

for (const [k, v] of Object.entries(fileEnv)) {
  if (!process.env[k]) process.env[k] = v;
}

// Load preferences from EXTEND.md (recursive)
const skillConfig = loadSkillConfig("feishu-publish");

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const appId = process.env.FEISHU_APP_ID;
const appSecret = process.env.FEISHU_APP_SECRET;
const domain = (skillConfig.feishu_domain || process.env.FEISHU_DOMAIN || "https://open.feishu.cn").replace(
  /\/+$/,
  ""
);
const defaultFolder = skillConfig.default_folder || "";
const tokenCachePath = join(home, ".yiyang-skills", "feishu-publish", ".token");

if (!appId || !appSecret) {
  console.error(
    JSON.stringify({
      error: "Missing Feishu configuration",
      hint: `Create ${envPath} with FEISHU_APP_ID and FEISHU_APP_SECRET`,
    })
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

const { values } = parseArgs({
  options: {
    input: { type: "string" },
    title: { type: "string" },
    folder: { type: "string" },
    "dry-run": { type: "boolean", default: false },
    "auth-mode": { type: "string", default: "user" }, // "user" or "tenant"
    login: { type: "boolean", default: false }, // force re-login
  },
  strict: false,
});

// Handle --login: just do the OAuth flow and exit
if (values.login) {
  const token = await doOAuthLogin();
  console.log(JSON.stringify({ success: true, message: "Login successful, token cached." }));
  process.exit(0);
}

if (!values.input || !values.title) {
  console.error(
    "Usage: publish.ts --input <article.md> --title <title> [--folder <token>] [--dry-run] [--auth-mode user|tenant] [--login]"
  );
  process.exit(1);
}

const inputPath = resolve(values.input as string);
const title = values.title as string;
const folderToken = (values.folder as string | undefined) || defaultFolder || undefined;
const dryRun = values["dry-run"] || false;
const authMode = (values["auth-mode"] as string) || "user";

// ---------------------------------------------------------------------------
// OAuth2 — User access token (personal identity)
// ---------------------------------------------------------------------------

interface TokenCache {
  access_token: string;
  refresh_token: string;
  expires_at: number; // epoch ms
}

function loadTokenCache(): TokenCache | null {
  if (!existsSync(tokenCachePath)) return null;
  try {
    const data = JSON.parse(readFileSync(tokenCachePath, "utf-8"));
    return data as TokenCache;
  } catch {
    return null;
  }
}

function saveTokenCache(cache: TokenCache) {
  const dir = dirname(tokenCachePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(tokenCachePath, JSON.stringify(cache, null, 2));
}

async function doOAuthLogin(): Promise<string> {
  const redirectPort = 19876;
  const redirectUri = `http://localhost:${redirectPort}/callback`;

  // Start local server to capture the OAuth callback
  let resolveCode: (code: string) => void;
  const codePromise = new Promise<string>((res) => { resolveCode = res; });

  const server: Server = createServer((req, resp) => {
    const url = new URL(req.url || "/", `http://localhost:${redirectPort}`);
    if (url.pathname === "/callback") {
      const code = url.searchParams.get("code");
      if (code) {
        resp.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        resp.end("<html><body><h2>Authorization successful! You can close this tab.</h2><h3>授权成功！可以关闭此页面。</h3></body></html>");
        resolveCode(code);
      } else {
        resp.writeHead(400, { "Content-Type": "text/html" });
        resp.end("<html><body><h2>Missing code parameter</h2></body></html>");
      }
    } else {
      resp.writeHead(404);
      resp.end();
    }
  });

  await new Promise<void>((res) => server.listen(redirectPort, "127.0.0.1", () => res()));

  // Open browser for authorization
  // Request scopes matching what's configured in the Feishu app
  const scopes = [
    "docx:document:create",
    "docx:document:readonly",
    "docx:document:write_only",
    "docx:document.block:convert",
  ].join(" ");
  const authUrl = `${domain}/open-apis/authen/v1/authorize?app_id=${appId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scopes)}`;

  console.error(`Opening browser for Feishu login...\n${authUrl}`);

  // Open browser
  const { execSync } = await import("child_process");
  try {
    if (process.platform === "darwin") {
      execSync(`open "${authUrl}"`);
    } else if (process.platform === "linux") {
      execSync(`xdg-open "${authUrl}"`);
    } else {
      execSync(`start "${authUrl}"`);
    }
  } catch {
    console.error(`Please open this URL manually:\n${authUrl}`);
  }

  console.error("Waiting for authorization...");

  // Wait for the callback with the code
  const code = await codePromise;
  server.close();

  // Exchange code for access token
  const tokenResp = await fetch(`${domain}/open-apis/authen/v1/oidc/access_token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${await getAppAccessToken()}`,
    },
    body: JSON.stringify({
      grant_type: "authorization_code",
      code,
    }),
  });

  const tokenData = await tokenResp.json();
  if (tokenData.code !== 0) {
    throw new Error(`OAuth token exchange failed: ${tokenData.msg}`);
  }

  const { access_token, refresh_token, expires_in } = tokenData.data;
  const cache: TokenCache = {
    access_token,
    refresh_token,
    expires_at: Date.now() + expires_in * 1000 - 300_000, // 5 min buffer
  };
  saveTokenCache(cache);

  return access_token;
}

async function getAppAccessToken(): Promise<string> {
  const resp = await fetch(`${domain}/open-apis/auth/v3/app_access_token/internal`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
  });
  const data = await resp.json();
  if (data.code !== 0) throw new Error(`Failed to get app access token: ${data.msg}`);
  return data.app_access_token;
}

async function refreshUserToken(refreshToken: string): Promise<string> {
  const resp = await fetch(`${domain}/open-apis/authen/v1/oidc/refresh_access_token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${await getAppAccessToken()}`,
    },
    body: JSON.stringify({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });
  const data = await resp.json();
  if (data.code !== 0) throw new Error(`Token refresh failed: ${data.msg}`);

  const { access_token, refresh_token, expires_in } = data.data;
  const cache: TokenCache = {
    access_token,
    refresh_token,
    expires_at: Date.now() + expires_in * 1000 - 300_000,
  };
  saveTokenCache(cache);
  return access_token;
}

async function getUserAccessToken(): Promise<string> {
  const cached = loadTokenCache();

  if (cached) {
    if (Date.now() < cached.expires_at) {
      return cached.access_token;
    }
    // Try refresh
    try {
      return await refreshUserToken(cached.refresh_token);
    } catch {
      // Refresh failed, need re-login
    }
  }

  // No valid token — need OAuth login
  return await doOAuthLogin();
}

// ---------------------------------------------------------------------------
// Tenant access token (app identity, fallback)
// ---------------------------------------------------------------------------

let tenantAccessToken: string | null = null;
let tenantTokenExpiresAt = 0;

async function getTenantAccessToken(): Promise<string> {
  if (tenantAccessToken && Date.now() < tenantTokenExpiresAt) {
    return tenantAccessToken;
  }

  const resp = await fetch(
    `${domain}/open-apis/auth/v3/tenant_access_token/internal`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
    }
  );

  const data = await resp.json();
  if (data.code !== 0) {
    throw new Error(`Failed to get tenant access token: ${data.msg}`);
  }

  tenantAccessToken = data.tenant_access_token;
  tenantTokenExpiresAt = Date.now() + (data.expire - 300) * 1000;
  return tenantAccessToken!;
}

// ---------------------------------------------------------------------------
// Unified token getter
// ---------------------------------------------------------------------------

async function getAccessToken(): Promise<string> {
  if (authMode === "tenant") {
    return getTenantAccessToken();
  }
  return getUserAccessToken();
}

// ---------------------------------------------------------------------------
// Feishu API helper
// ---------------------------------------------------------------------------

async function feishuApi(
  path: string,
  options: {
    method?: string;
    body?: any;
    isFormData?: boolean;
  } = {}
): Promise<any> {
  const token = await getAccessToken();
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
  };

  let body: any;
  if (options.isFormData) {
    body = options.body;
  } else {
    headers["Content-Type"] = "application/json";
    body = options.body ? JSON.stringify(options.body) : undefined;
  }

  const resp = await fetch(`${domain}${path}`, {
    method: options.method || (options.body ? "POST" : "GET"),
    headers,
    body,
  });

  const data = await resp.json();
  if (data.code !== 0) {
    throw new Error(`Feishu API error [${path}]: ${data.msg} (code: ${data.code})`);
  }

  return data.data;
}

// ---------------------------------------------------------------------------
// Image handling
// ---------------------------------------------------------------------------

async function downloadImage(url: string): Promise<Buffer> {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Failed to download image: ${url}`);
  return Buffer.from(await resp.arrayBuffer());
}

async function uploadImageToFeishu(
  imageBuffer: Buffer,
  fileName: string
): Promise<string> {
  const formData = new FormData();
  formData.append("image_type", "message");
  formData.append(
    "image",
    new Blob([imageBuffer], { type: "application/octet-stream" }),
    fileName
  );

  const data = await feishuApi("/open-apis/im/v1/images", {
    method: "POST",
    body: formData,
    isFormData: true,
  });

  return data.image_key;
}

// ---------------------------------------------------------------------------
// Markdown → Feishu blocks conversion
// ---------------------------------------------------------------------------

async function convertMarkdownToBlocks(
  markdown: string
): Promise<{ blocks: any[] }> {
  const data = await feishuApi(
    "/open-apis/docx/v1/documents/blocks/convert",
    {
      method: "POST",
      body: {
        content_type: "markdown",
        content: markdown,
      },
    }
  );

  return { blocks: data.blocks || [] };
}

// ---------------------------------------------------------------------------
// Process images in markdown
// ---------------------------------------------------------------------------

async function processImagesInMarkdown(
  markdown: string
): Promise<{ markdown: string; imagesUploaded: number }> {
  const imageRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
  const matches = [...markdown.matchAll(imageRegex)];

  let imagesUploaded = 0;
  let result = markdown;

  for (const match of matches) {
    const [fullMatch, alt, src] = match;
    if (src.startsWith("img_")) continue;

    let imageBuffer: Buffer;
    let fileName: string;

    if (src.startsWith("http://") || src.startsWith("https://")) {
      try {
        imageBuffer = await downloadImage(src);
        fileName = basename(new URL(src).pathname) || "image.png";
      } catch (e: any) {
        console.error(`Warning: Failed to download ${src}: ${e.message}`);
        continue;
      }
    } else {
      const absPath = resolve(src);
      if (!existsSync(absPath)) {
        console.error(`Warning: Local image not found: ${absPath}`);
        continue;
      }
      imageBuffer = Buffer.from(await readFile(absPath));
      fileName = basename(absPath);
    }

    if (!dryRun) {
      try {
        const imageKey = await uploadImageToFeishu(imageBuffer, fileName);
        imagesUploaded++;
      } catch (e: any) {
        console.error(`Warning: Failed to upload ${fileName}: ${e.message}`);
      }
    }
  }

  return { markdown: result, imagesUploaded };
}

// ---------------------------------------------------------------------------
// Create document
// ---------------------------------------------------------------------------

async function createDocument(
  docTitle: string,
  folder?: string
): Promise<{ documentId: string; url: string }> {
  const body: any = { title: docTitle };
  if (folder) {
    body.folder_token = folder;
  }

  const data = await feishuApi("/open-apis/docx/v1/documents", {
    method: "POST",
    body,
  });

  const documentId = data.document.document_id;
  const domainBase = domain.includes("larksuite")
    ? "https://larksuite.com"
    : "https://feishu.cn";

  return {
    documentId,
    url: `${domainBase}/docx/${documentId}`,
  };
}

// ---------------------------------------------------------------------------
// Insert blocks into document
// ---------------------------------------------------------------------------

async function insertBlocks(
  documentId: string,
  parentBlockId: string,
  blocks: any[]
): Promise<number> {
  let totalCreated = 0;

  for (let i = 0; i < blocks.length; i += 50) {
    const batch = blocks.slice(i, i + 50);

    await feishuApi(
      `/open-apis/docx/v1/documents/${documentId}/blocks/${parentBlockId}/children`,
      {
        method: "POST",
        body: { children: batch },
      }
    );

    totalCreated += batch.length;

    if (i + 50 < blocks.length) {
      await new Promise((r) => setTimeout(r, 350));
    }
  }

  return totalCreated;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

try {
  const markdown = await readFile(inputPath, "utf-8");

  // Process images
  const { markdown: processedMarkdown, imagesUploaded } =
    await processImagesInMarkdown(markdown);

  if (dryRun) {
    const { blocks } = await convertMarkdownToBlocks(processedMarkdown);
    console.log(
      JSON.stringify(
        {
          title,
          blocks_count: blocks.length,
          images_found: imagesUploaded,
          auth_mode: authMode,
          dry_run: true,
          blocks_preview: blocks.slice(0, 5),
          success: true,
        },
        null,
        2
      )
    );
    process.exit(0);
  }

  // Convert markdown to Feishu blocks
  const { blocks } = await convertMarkdownToBlocks(processedMarkdown);

  if (blocks.length === 0) {
    console.error(
      JSON.stringify({
        error: "Markdown conversion produced no blocks",
        success: false,
      })
    );
    process.exit(1);
  }

  // Create the document
  const { documentId, url } = await createDocument(title, folderToken);

  // Insert blocks
  const blocksCreated = await insertBlocks(documentId, documentId, blocks);

  console.log(
    JSON.stringify(
      {
        document_id: documentId,
        url,
        title,
        blocks_created: blocksCreated,
        images_uploaded: imagesUploaded,
        auth_mode: authMode,
        success: true,
      },
      null,
      2
    )
  );
} catch (e: any) {
  console.error(JSON.stringify({ error: e.message, success: false }));
  process.exit(1);
}
