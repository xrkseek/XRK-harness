/**
 * Capture a built product-web dist + boot graph + /plugins into
 * `apps/web-static` (tracked) for `xrk-harness serve`.
 *
 * Also mirrors to `vendor/web-static` for local-only overrides (gitignored).
 *
 * Expects a local UI source tree at `vendor/ui-src` (gitignore; maintainer link).
 *
 *   pnpm web:ui:build
 *   pnpm web:ui:capture
 */
import { spawn } from "node:child_process";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const UI_SRC = path.join(ROOT, "vendor", "ui-src");
const OUT_TRACKED = path.join(ROOT, "apps", "web-static");
const OUT_LOCAL = path.join(ROOT, "vendor", "web-static");
const DIST = path.join(UI_SRC, "apps", "web", "dist");
const URL_BASE = (process.env.XRK_UI_URL ?? "http://127.0.0.1:3080").replace(
  /\/$/,
  "",
);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} → ${res.status}`);
  return res.text();
}

async function fetchBuf(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} → ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

const WELCOME_VERSION_XRK = "2026-08-17.xrk1";
const WELCOME_BODY_ZH_XRK =
  "XRK Harness Web UI 基于 DeepSeek Harness（MIT）二次修改。当前仍处在面向开发者测试的阶段，还有许多地方需要持续改进。后端契约走本仓 Face / serve；上游归因见 apps/web/NOTICE。\\n\\n欢迎反馈与共建。";
const WELCOME_BODY_EN_XRK =
  "XRK Harness Web UI is a secondary fork of DeepSeek Harness (MIT). It is still under developer testing. The host contract is this repo’s Face / serve; see apps/web/NOTICE for upstream attribution.\\n\\nFeedback welcome.";
const WELCOME_BODY_ZH_DSH =
  "DeepSeek Harness 目前的 0.1 版本仍处在面向 Harness 开发者进行测试的阶段，还有许多地方需要持续改进和打磨，希望听取广大开发者的反馈建议。预计 DeepSeek Harness 的核心插件以及基础 API 都会在接下来的一段时间内快速迭代、持续演化。\\n\\n我们期待与全球开发者一起，在开源、开放、可复用、可组合的基础设施之上，共同探索智能上限。欢迎全球 Harness 开发者加入 DSH 插件生态。";
const WELCOME_BODY_EN_DSH =
  "DeepSeek Harness 0.1 remains in testing for Harness developers. Many areas need further improvement, and we welcome feedback from the developer community. DeepSeek Harness's core plugins and foundational APIs will continue to evolve rapidly over the coming months.\\n\\nWe look forward to exploring the limits of intelligence with developers around the world, building on open-source, open, reusable, and composable infrastructure. We welcome Harness developers everywhere to join the DSH plugin ecosystem.";

function replaceAllLiteral(haystack, needle, replacement) {
  if (!needle || !haystack.includes(needle)) return haystack;
  return haystack.split(needle).join(replacement);
}

function brandWelcomeNoticeJs(js) {
  let out = js.replace(
    /const WELCOME_NOTICE_VERSION = ["'][^"']+["']/,
    `const WELCOME_NOTICE_VERSION = "${WELCOME_VERSION_XRK}"`,
  );
  out = replaceAllLiteral(out, WELCOME_BODY_ZH_DSH, WELCOME_BODY_ZH_XRK);
  out = replaceAllLiteral(out, WELCOME_BODY_EN_DSH, WELCOME_BODY_EN_XRK);
  return out;
}

function brandSettingsPluginsJs(js) {
  return replaceAllLiteral(
    replaceAllLiteral(
      js,
      "The DeepSeek search provider.",
      "Web search provider for this deployment.",
    ),
    "DeepSeek 搜索提供方。",
    "本部署的网页搜索提供方。",
  );
}

function patchPluginFile(filePath, brand) {
  if (!existsSync(filePath)) return;
  const before = readFileSync(filePath, "utf8");
  const after = brand(before);
  if (after !== before) writeFileSync(filePath, after);
}

/** Product chrome that capture must re-apply (DSH dist names the PWA DeepSeek). */
function brandCapturedShell(outDir) {
  const manifestPath = path.join(outDir, "manifest.webmanifest");
  if (existsSync(manifestPath)) {
    const raw = JSON.parse(readFileSync(manifestPath, "utf8"));
    if (raw && typeof raw === "object") {
      raw.name = "XRK Harness";
      raw.short_name = "XRK";
      writeFileSync(manifestPath, `${JSON.stringify(raw, null, 2)}\n`);
    }
  }
  const indexPath = path.join(outDir, "index.html");
  if (existsSync(indexPath)) {
    const html = readFileSync(indexPath, "utf8").replace(
      /<title>[^<]*<\/title>/i,
      "<title>XRK Harness</title>",
    );
    writeFileSync(indexPath, html);
  }
  patchPluginFile(
    path.join(
      outDir,
      "plugins",
      "@deepseek-ai",
      "dsh-client-ui-settings-models",
      "client.js",
    ),
    brandWelcomeNoticeJs,
  );
  patchPluginFile(
    path.join(
      outDir,
      "plugins",
      "@deepseek-ai",
      "dsh-client-ui-settings-plugins",
      "client.js",
    ),
    brandSettingsPluginsJs,
  );
}

function extractBoot(html) {
  const m = html.match(
    /window\.__DSH_BOOT__\s*=\s*(\{[\s\S]*?\})\s*;?\s*<\/script>/,
  );
  if (!m?.[1]) throw new Error("no window.__DSH_BOOT__ in index.html");
  return JSON.parse(m[1]);
}

async function waitReady(timeoutMs = 90_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${URL_BASE}/`);
      if (res.ok) return;
    } catch {
      /* retry */
    }
    await sleep(800);
  }
  throw new Error(`UI not ready at ${URL_BASE}`);
}

async function main() {
  if (!existsSync(path.join(DIST, "index.html"))) {
    throw new Error(`missing ${DIST}/index.html — run pnpm web:ui:build first`);
  }

  let child;
  let startedHere = false;
  try {
    await fetch(`${URL_BASE}/`);
  } catch {
    startedHere = true;
    child = spawn("pnpm", ["dsh", "web"], {
      cwd: UI_SRC,
      shell: true,
      stdio: "ignore",
      detached: false,
    });
    await waitReady();
  }

  try {
    const html = await fetchText(`${URL_BASE}/`);
    const boot = extractBoot(html);

    for (const OUT of [OUT_TRACKED, OUT_LOCAL]) {
      if (existsSync(OUT)) rmSync(OUT, { recursive: true, force: true });
      mkdirSync(OUT, { recursive: true });
      cpSync(DIST, OUT, { recursive: true });

      for (const name of ["favicon.png", "logo.png", "logo-plate.png"]) {
        const src = path.join(UI_SRC, "apps", "web", "public", name);
        if (existsSync(src)) copyFileSync(src, path.join(OUT, name));
      }

      writeFileSync(path.join(OUT, "boot.json"), JSON.stringify(boot, null, 2));

      const pluginsRoot = path.join(OUT, "plugins");
      mkdirSync(pluginsRoot, { recursive: true });
      for (const entry of boot.entries ?? []) {
        const urlPath = String(entry.url ?? "");
        if (!urlPath.startsWith("/plugins/")) continue;
        const clean = urlPath.split("?")[0];
        const dest = path.join(OUT, clean.replace(/^\//, ""));
        mkdirSync(path.dirname(dest), { recursive: true });
        const buf = await fetchBuf(`${URL_BASE}${urlPath}`);
        writeFileSync(dest, buf);
        process.stdout.write(`plugin ${entry.id} → ${clean} (${path.basename(OUT)})\n`);
      }

      brandCapturedShell(OUT);
      process.stdout.write(`wrote ${OUT} (rev=${boot.rev})\n`);
    }
  } finally {
    if (startedHere && child) {
      child.kill("SIGTERM");
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
