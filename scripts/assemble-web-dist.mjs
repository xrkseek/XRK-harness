/**
 * Assemble product shell under apps/web/dist for xrk-harness serve.
 *
 * Prerequisites:
 *   pnpm --filter @xrkseek/web-frontend run build
 *   pnpm client:bundle
 *
 * Copies client plugin bundles from packages/client/<name>/lib/client.js
 * and Face wire shims from packages/stubs (typert-registry, api-gateway,
 * api-remotes). Writes boot.json from each package.json xrk.client
 * metadata. If a UI client.js is missing, set XRK_UI_SRC to a compare
 * checkout that already has matching lib/client.js artifacts.
 *
 *   pnpm web:assemble
 */
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(ROOT, "apps", "web", "dist");
const CLIENT_SRC = path.join(ROOT, "packages", "client");
const STUBS_SRC = path.join(ROOT, "packages", "stubs");
const UI_SRC = process.env.XRK_UI_SRC?.trim()
  ? path.resolve(process.env.XRK_UI_SRC.trim())
  : "";

// Historical Cordis UI / runner ids (no longer in-tree) plus HMR and the
// native picker — still filtered so overlays cannot reintroduce them.
const OMIT = new Set([
  "@xrkseek/client-ui-cordis",
  "@xrkseek/xrk-cordis-client-runner",
  "@xrkseek/client-hmr",
  // Web uses in-app browse. Native OS chooser fights the same single slot
  // and throws at boot ("already has a registration at priority 0").
  "@xrkseek/client-ui-directory-picker-native",
]);

const WELCOME_VERSION_XRK = "2026-08-23.1";
const WELCOME_BODY_ZH_XRK =
  "XRK-Harness 是本仓库的 Agent 宿主与产品壳：Session 可重建、工具可走策略，社区 DSH 插件经 dsh-compat 兼容器接入（不嵌入 Cordis Host）。\\n\\n0.1.0 是首个公开发版，CLI 与 serve 主路径可用；真 IM 隧道、Cordis fiber 子进程等缺口见 docs/status。欢迎通过 GitHub 反馈与共建。";
const WELCOME_BODY_EN_XRK =
  "XRK-Harness is this repo’s agent host and product shell: durable sessions, policy-aware tools, and DSH community plugins through the dsh-compat layer (no Cordis Host embed).\\n\\n0.1.0 is the first public release with a usable CLI and serve path; see docs/status for honest gaps (live IM tunnels, Cordis fiber subprocess, etc.). Feedback and contributions welcome on GitHub.";
const WELCOME_BODY_ZH_DSH =
  "DeepSeek Harness 目前的 0.1 版本仍处在面向 Harness 开发者进行测试的阶段，还有许多地方需要持续改进和打磨，希望听取广大开发者的反馈建议。预计 DeepSeek Harness 的核心插件以及基础 API 都会在接下来的一段时间内快速迭代、持续演化。\\n\\n我们期待与全球开发者一起，在开源、开放、可复用、可组合的基础设施之上，共同探索智能上限。欢迎全球 Harness 开发者加入 DSH 插件生态。";
const WELCOME_BODY_EN_DSH =
  "DeepSeek Harness 0.1 remains in testing for Harness developers. Many areas need further improvement, and we welcome feedback from the developer community. DeepSeek Harness's core plugins and foundational APIs will continue to evolve rapidly over the coming months.\\n\\nWe look forward to exploring the limits of intelligence with developers around the world, building on open-source, open, reusable, and composable infrastructure. We welcome Harness developers everywhere to join the DSH plugin ecosystem.";

function replaceAllLiteral(haystack, needle, replacement) {
  if (!needle || !haystack.includes(needle)) return haystack;
  return haystack.split(needle).join(replacement);
}

function brandWelcomeJs(js) {
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
      "The XRK search provider.",
    ),
    "DeepSeek 搜索提供方。",
    "XRK 搜索提供方。",
  );
}

function readPkg(dir) {
  const pj = path.join(dir, "package.json");
  if (!existsSync(pj)) return null;
  return JSON.parse(readFileSync(pj, "utf8").replace(/^\uFEFF/, ""));
}

function listPackagesIn(root) {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => {
      const dir = path.join(root, d.name);
      const pkg = readPkg(dir);
      return pkg ? { dir, name: d.name, pkg } : null;
    })
    .filter(Boolean);
}

function listClientPackages() {
  return [...listPackagesIn(CLIENT_SRC), ...listPackagesIn(STUBS_SRC)];
}

function pluginLibDir(dir, name, uiSrc) {
  const local = path.join(dir, "lib");
  if (existsSync(path.join(local, "client.js"))) return local;
  if (uiSrc && dir.startsWith(CLIENT_SRC)) {
    const remote = path.join(uiSrc, "packages", "client", name, "lib");
    if (existsSync(path.join(remote, "client.js"))) return remote;
  }
  return "";
}

function buildBoot(packages) {
  const entries = [];
  for (const { pkg } of packages) {
    const client = pkg.xrk?.client;
    if (!client || typeof client !== "object") continue;
    const id = pkg.name;
    if (typeof id !== "string" || OMIT.has(id)) continue;
    const inject = Array.isArray(client.inject)
      ? client.inject.filter((x) => typeof x === "string" && !OMIT.has(x))
      : [];
    entries.push({
      id,
      url: `/plugins/${id}/client.js`,
      rev: typeof pkg.version === "string" ? pkg.version : "0.0.0",
      inject,
      ...(client.immediately === true ? { immediately: true } : {}),
    });
  }
  entries.sort((a, b) => a.id.localeCompare(b.id));
  return { rev: `xrk-web-${Date.now()}`, entries };
}

function copyPlugins(packages, uiSrc) {
  const pluginsRoot = path.join(DIST, "plugins");
  if (existsSync(pluginsRoot)) rmSync(pluginsRoot, { recursive: true, force: true });
  mkdirSync(pluginsRoot, { recursive: true });

  let copied = 0;
  let missing = 0;
  for (const { dir, name, pkg } of packages) {
    if (!pkg.xrk?.client) continue;
    const id = pkg.name;
    if (OMIT.has(id)) continue;
    const libDir = pluginLibDir(dir, name, uiSrc);
    if (!libDir) {
      process.stdout.write(`skip ${id} (no lib/client.js)\n`);
      missing += 1;
      continue;
    }
    const destDir = path.join(pluginsRoot, ...id.split("/"));
    mkdirSync(destDir, { recursive: true });
    copyFileSync(path.join(libDir, "client.js"), path.join(destDir, "client.js"));
    const styles = path.join(libDir, "styles");
    if (existsSync(styles)) {
      cpSync(styles, path.join(destDir, "styles"), { recursive: true });
    }
    copied += 1;
    process.stdout.write(`plugin ${id}\n`);
  }
  return { copied, missing };
}

function brandPlugins() {
  const models = path.join(
    DIST,
    "plugins",
    "@xrkseek",
    "client-ui-settings-models",
    "client.js",
  );
  if (existsSync(models)) {
    writeFileSync(models, brandWelcomeJs(readFileSync(models, "utf8")));
  }
  const plugins = path.join(
    DIST,
    "plugins",
    "@xrkseek",
    "client-ui-settings-plugins",
    "client.js",
  );
  if (existsSync(plugins)) {
    writeFileSync(plugins, brandSettingsPluginsJs(readFileSync(plugins, "utf8")));
  }
}

function main() {
  if (!existsSync(path.join(DIST, "index.html"))) {
    throw new Error(
      "missing apps/web/dist/index.html — run: pnpm web:build",
    );
  }

  const packages = listClientPackages();
  const needed = packages.filter(
    (p) => p.pkg.xrk?.client && !OMIT.has(p.pkg.name),
  );
  const unresolved = needed.filter((p) => !pluginLibDir(p.dir, p.name, UI_SRC));
  if (unresolved.length) {
    const hint = UI_SRC
      ? "build client libs in XRK_UI_SRC"
      : "set XRK_UI_SRC to a DSH checkout with packages/client/*/lib/client.js";
    throw new Error(
      `missing lib/client.js for ${unresolved.map((p) => p.pkg.name).join(", ")} — ${hint}`,
    );
  }

  const { copied } = copyPlugins(packages, UI_SRC);
  brandPlugins();
  const boot = buildBoot(packages);
  writeFileSync(path.join(DIST, "boot.json"), `${JSON.stringify(boot, null, 2)}\n`);
  process.stdout.write(
    `assembled ${DIST}: plugins=${copied} boot.entries=${boot.entries.length} rev=${boot.rev}\n`,
  );
}

main();
