/**
 * Expand one install (kind:host) into sibling tools + prompt plugins on disk,
 * and stage the Settings client half under web/plugins (no Host source edits).
 * Loader applies one kind per plugin — same pattern as guest xrk-mobile*.
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PHONE_TOOL_CATALOG } from "./lib/catalog.mjs";
import { getPhoneBridge } from "./lib/runtime.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

export const TOOLS_ID = "xrk-phone-bridge-tools";
export const PROMPT_ID = "xrk-phone-bridge-prompt";
export const CLIENT_ID = "xrk-phone-bridge";
export const CLIENT_VERSION = "0.8.9";
export const CLIENT_INJECT = Object.freeze(["@xrkseek/client-runtime"]);
export const SKILL_ID = "xrk-phone";

/** npm `name` when published scoped (`@xrkseek/xrk-phone-bridge`); else CLIENT_ID. */
function packageInstallName() {
  try {
    const pkg = JSON.parse(readFileSync(join(HERE, "package.json"), "utf8"));
    if (pkg && typeof pkg.name === "string" && pkg.name.trim()) {
      return pkg.name.trim();
    }
  } catch {
    // fall through
  }
  return CLIENT_ID;
}

/**
 * Drop a phantom unscoped client row left over from older materialize + scoped
 * `plugin add` (double ModuleLoader / settings.section registration).
 */
function prunePhantomClientHalf(pluginsRoot, phantomId) {
  const invPath = join(pluginsRoot, ".xrk-plugins.json");
  if (existsSync(invPath)) {
    try {
      const raw = JSON.parse(readFileSync(invPath, "utf8"));
      if (raw?.packages && typeof raw.packages === "object" && phantomId in raw.packages) {
        const packages = { ...raw.packages };
        delete packages[phantomId];
        writeFileSync(
          invPath,
          JSON.stringify(
            { rev: typeof raw.rev === "number" ? raw.rev : 1, packages },
            null,
            2,
          ) + "\n",
          "utf8",
        );
      }
    } catch {
      // leave inventory alone
    }
  }
  const bootPath = join(pluginsRoot, "web", "boot.json");
  if (existsSync(bootPath)) {
    try {
      const boot = JSON.parse(readFileSync(bootPath, "utf8"));
      if (Array.isArray(boot.entries)) {
        const entries = boot.entries.filter((e) => e && e.id !== phantomId);
        if (entries.length !== boot.entries.length) {
          writeFileSync(
            bootPath,
            JSON.stringify({ ...boot, entries }, null, 2) + "\n",
            "utf8",
          );
        }
      }
    } catch {
      // leave boot alone
    }
  }
  rmSync(join(pluginsRoot, "web", "plugins", phantomId), {
    recursive: true,
    force: true,
  });
}

/** Same binder guest uses: skill first, then phone_*. Only shown while a phone is online. */
const PROMPT_SECTION = [
  "## 手机操控",
  "",
  "- 已桥接远程手机：`phone_*` 可用（与本机 guest 同一套工具与 skill）。",
  "- 操作前先 `skill` 加载 **`xrk-phone`**，再 `phone_screen`；闹钟 / 导航等优先 `phone_intent`。",
  "- 多机在线且未绑定时工具会报错 —— 保持目标手机 App 会话打开。",
  "",
].join("\n");

function toolsPluginSource() {
  const catalog = JSON.stringify(PHONE_TOOL_CATALOG, null, 2);
  return `/**
 * Auto-written by xrk-phone-bridge (kind:host). Do not edit by hand.
 * Shares runtime via Symbol.for('xrk.phoneBridge.v1').
 */
const KEY = Symbol.for("xrk.phoneBridge.v1");
const CATALOG = ${catalog};

function runtime() {
  return globalThis[KEY] || null;
}

async function admitScreenshot(buf, mime) {
  const home = process.env.XRK_HOME;
  if (!home) {
    return { ok: false, reason: "XRK_HOME missing; cannot store phone screenshot" };
  }
  try {
    const { createLocalAttachmentStore } = await import("@xrkseek/attachment-local");
    const store = createLocalAttachmentStore({ xrkHome: home });
    const ref = await store.saveImage({
      data: buf,
      mediaType: mime,
      name: "phone-screen",
    });
    return { ok: true, ref };
  } catch (e) {
    return { ok: false, reason: String(e && e.message ? e.message : e) };
  }
}

export function createPlugin() {
  return {
    id: ${JSON.stringify(TOOLS_ID)},
    kind: "tools",
    tools: CATALOG.map((t) => ({
      name: \`phone_\${t.name}\`,
      description: t.description,
      parameters: t.inputSchema,
      async execute(args, signal, extras) {
        const rt = runtime();
        if (!rt) {
          return {
            content: "手机桥未就绪：安装 xrk-phone-bridge 后重启 Host。",
            isError: true,
          };
        }
        const out = await rt.invoke(extras?.sessionId, t.name, args, signal);
        const text = out && typeof out.content === "string" ? out.content : "";
        const isError = Boolean(out && out.isError);
        let b64 = out && typeof out.imageBase64 === "string" ? out.imageBase64.trim() : "";
        let mime = out && typeof out.imageMime === "string" ? out.imageMime.trim().toLowerCase() : "";
        if (mime === "image/jpg") mime = "image/jpeg";
        if (!b64 || !mime.startsWith("image/")) {
          return { content: text, isError };
        }
        b64 = b64.replace(/\\s+/g, "");
        const buf = Buffer.from(b64, "base64");
        if (buf.length === 0) {
          return { content: text, isError };
        }
        const admitted = await admitScreenshot(buf, mime);
        if (!admitted.ok) {
          return {
            content: text + "\\n[image unavailable: " + mime + "; " + admitted.reason + "]",
            isError,
          };
        }
        return {
          content: [
            { type: "text", text },
            { type: "image", attachment: admitted.ref },
          ],
          isError,
          meta: { attachmentId: admitted.ref.attachmentId },
        };
      },
    })),
  };
}
`;
}

function promptPluginSource() {
  return `/**
 * Auto-written by xrk-phone-bridge (kind:host). Do not edit by hand.
 */
const KEY = Symbol.for("xrk.phoneBridge.v1");
const SECTION = ${JSON.stringify(PROMPT_SECTION)};

export function createPlugin() {
  return {
    id: ${JSON.stringify(PROMPT_ID)},
    kind: "prompt",
    promptSections: [
      {
        id: "xrk-phone-bridge-remote",
        order: 81,
        content: () => {
          const rt = globalThis[KEY];
          return rt && typeof rt.anyOnline === "function" && rt.anyOnline()
            ? SECTION
            : "";
        },
      },
    ],
  };
}
`;
}

function writePluginDir(pluginsRoot, id, kind, pluginSource) {
  const dir = join(pluginsRoot, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "xrk.plugin.json"),
    JSON.stringify({ id, kind, entry: "./plugin.mjs" }, null, 2) + "\n",
    "utf8",
  );
  writeFileSync(join(dir, "plugin.mjs"), pluginSource, "utf8");
}

/**
 * Install the shared `xrk-phone` playbook into product home skills/
 * so Host `skill xrk-phone` matches guest (same body as seeds/mobile).
 * @param {string | undefined} xrkHome
 */
export function materializePhoneSkill(xrkHome) {
  const home = xrkHome || process.env.XRK_HOME;
  if (!home) return null;
  const src = join(HERE, "skills", SKILL_ID, "SKILL.md");
  if (!existsSync(src)) return null;
  const destDir = join(home, "skills", SKILL_ID);
  mkdirSync(destDir, { recursive: true });
  const dest = join(destDir, "SKILL.md");
  writeFileSync(dest, readFileSync(src, "utf8"), "utf8");
  return dest;
}

/**
 * Stage Settings client.js under web/plugins and register in inventory + boot.
 * Same overlay path community client packages use — no Host patches.
 *
 * When installed as `@xrkseek/xrk-phone-bridge`, Host `plugin add` already
 * stages `xrk.client` under that scoped id. Do not also invent unscoped
 * `xrk-phone-bridge` — that double-loads ModuleLoader + settings.section.
 */
function materializeClientHalf(pluginsRoot) {
  const clientSrc = join(HERE, "client.js");
  if (!existsSync(clientSrc)) return;

  const installName = packageInstallName();
  const hostStaged = join(
    pluginsRoot,
    "web",
    "plugins",
    ...installName.split("/").filter(Boolean),
    "client.js",
  );
  if (installName !== CLIENT_ID && existsSync(hostStaged)) {
    prunePhantomClientHalf(pluginsRoot, CLIENT_ID);
    return;
  }

  const destDir = join(pluginsRoot, "web", "plugins", CLIENT_ID);
  mkdirSync(destDir, { recursive: true });
  copyFileSync(clientSrc, join(destDir, "client.js"));
  writeFileSync(
    join(destDir, "package.json"),
    JSON.stringify(
      {
        name: CLIENT_ID,
        version: CLIENT_VERSION,
        xrk: { client: { inject: [...CLIENT_INJECT] } },
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );

  const invPath = join(pluginsRoot, ".xrk-plugins.json");
  let inv = { rev: 1, packages: {} };
  if (existsSync(invPath)) {
    try {
      const raw = JSON.parse(readFileSync(invPath, "utf8"));
      if (raw && typeof raw === "object") {
        inv = {
          rev: typeof raw.rev === "number" ? raw.rev : 1,
          packages:
            raw.packages && typeof raw.packages === "object" && !Array.isArray(raw.packages)
              ? { ...raw.packages }
              : {},
        };
      }
    } catch {
      // keep empty
    }
  }
  const prev = inv.packages[CLIENT_ID];
  inv.packages[CLIENT_ID] = {
    name: CLIENT_ID,
    version: CLIENT_VERSION,
    kind: "both",
    source: (prev && prev.source) || CLIENT_ID,
    installedAt: (prev && prev.installedAt) || new Date().toISOString(),
    clientInject: [...CLIENT_INJECT],
  };
  writeFileSync(invPath, JSON.stringify(inv, null, 2) + "\n", "utf8");

  const bootPath = join(pluginsRoot, "web", "boot.json");
  let entries = [];
  if (existsSync(bootPath)) {
    try {
      const boot = JSON.parse(readFileSync(bootPath, "utf8"));
      if (Array.isArray(boot.entries)) {
        // Drop self + scoped twin so only one Settings client boots.
        entries = boot.entries.filter(
          (e) => e && e.id !== CLIENT_ID && e.id !== installName,
        );
      }
    } catch {
      entries = [];
    }
  }
  entries.push({
    id: CLIENT_ID,
    url: `/plugins/${CLIENT_ID}/client.js`,
    rev: CLIENT_VERSION,
    inject: [...CLIENT_INJECT],
  });
  entries.sort((a, b) => String(a.id).localeCompare(String(b.id)));
  mkdirSync(join(pluginsRoot, "web"), { recursive: true });
  writeFileSync(
    bootPath,
    JSON.stringify({ rev: `xrk-phone-bridge-${CLIENT_VERSION}`, entries }, null, 2) +
      "\n",
    "utf8",
  );
}

/**
 * Resolve plugins root: HostWireContext.pluginsDir, else parent of this package.
 * @param {string | undefined} pluginsDir
 */
export function resolvePluginsRoot(pluginsDir) {
  if (pluginsDir && existsSync(pluginsDir)) return pluginsDir;
  // Installed as $XRK_HOME/plugins/xrk-phone-bridge → siblings go in plugins/
  return dirname(HERE);
}

/**
 * Ensure tools + prompt siblings + Settings client exist; init shared runtime.
 * @param {{ pluginsDir?: string, xrkHome?: string, syncManagedProcessPlugins?: Function, force?: boolean }} ctx
 */
export async function materializeBridgePlugins(ctx = {}) {
  const home = ctx.xrkHome || process.env.XRK_HOME;
  getPhoneBridge(home);
  const root = resolvePluginsRoot(ctx.pluginsDir);
  writePluginDir(root, TOOLS_ID, "tools", toolsPluginSource());
  writePluginDir(root, PROMPT_ID, "prompt", promptPluginSource());
  materializeClientHalf(root);
  const skillPath = materializePhoneSkill(home);

  const sync = ctx.syncManagedProcessPlugins;
  if (typeof sync === "function") {
    try {
      await sync({ reloadIds: [TOOLS_ID, PROMPT_ID] });
    } catch {
      // Soft: next Host restart still picks them up from disk.
    }
  }
  return {
    pluginsRoot: root,
    toolsId: TOOLS_ID,
    promptId: PROMPT_ID,
    clientId: CLIENT_ID,
    skillId: SKILL_ID,
    skillPath,
  };
}

const DONE = Symbol.for("xrk.phoneBridge.materialized");

export async function materializeOnce(ctx = {}) {
  if (globalThis[DONE] && !ctx.force) return globalThis[DONE];
  const out = await materializeBridgePlugins(ctx);
  globalThis[DONE] = out;
  return out;
}
