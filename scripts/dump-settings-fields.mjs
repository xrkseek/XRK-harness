#!/usr/bin/env node
/**
 * Generate `docs/settings-fields.md` from the one source of truth:
 * `packages/server/face/src/settings-schemas.ts`.
 *
 * Why a generator instead of hand-written docs: every namespace card, the
 * `settings_get` / `settings_mutate` tools and the CLI all read these schemas,
 * so a field the doc forgets is a field an agent will guess at — and a field
 * the schema drops is a value the user saves that never lands (see the proxy
 * field that was written but stripped). Re-run this after touching a schema:
 *
 *   node scripts/dump-settings-fields.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const schemaFile = path.join(root, "packages/server/face/src/settings-schemas.ts");
const outFile = path.join(root, "docs/settings-fields.md");

const source = readFileSync(schemaFile, "utf8");

/** Body of a balanced `{ ... }` starting at `open` (index of the brace). */
function blockAt(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(open + 1, i);
    }
  }
  return "";
}

/** Body of the object literal that contains `idx` (the namespace spec). */
function specBody(text, idx) {
  const open = text.lastIndexOf("{", idx);
  return open < 0 ? "" : blockAt(text, open);
}

/** Field rows of one `Schema.object({ ... })` body. */
function parseFields(body) {
  const rows = [];
  const lines = body.split("\n");
  let doc = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("/**")) {
      doc = [];
      const inline = trimmed.replace(/^\/\*\*|\*\/$/g, "").trim();
      if (inline !== "") doc.push(inline);
      continue;
    }
    if (trimmed.startsWith("*/")) continue;
    if (trimmed.startsWith("*")) {
      const text = trimmed.replace(/^\*\s?/, "").trim();
      if (text !== "" && !text.startsWith("@")) doc.push(text);
      continue;
    }
    const field = /^([A-Za-z_$][\w$]*)\s*:\s*(.+?),?$/.exec(trimmed);
    if (field === null) {
      if (trimmed !== "" && !trimmed.startsWith("//")) doc = [];
      continue;
    }
    rows.push({
      name: field[1],
      expr: field[2].replace(/,\s*$/, ""),
      doc: doc.join(" ").trim(),
    });
    doc = [];
  }
  return rows;
}

/** Human type for a schemastery expression. */
function typeOf(expr) {
  if (/Schema\.string\(\)/.test(expr)) return "string";
  if (/Schema\.boolean\(\)/.test(expr)) return "boolean";
  if (/Schema\.number\(\)/.test(expr)) return "number";
  const union = /Schema\.union\(\[([^\]]*)\]\)/.exec(expr);
  if (union !== null) {
    return union[1]
      .split(",")
      .map((v) => v.trim().replace(/^["']|["']$/g, ""))
      .filter(Boolean)
      .join(" \\| ");
  }
  if (/Schema\.array\(/.test(expr)) return "array";
  if (/Schema\.dict\(/.test(expr)) return "object (map)";
  if (/Schema\.object\(/.test(expr)) return "object";
  if (/Schema\.const\(/.test(expr)) return "const";
  return "unknown";
}

/** `default(x)` argument, when present. */
function defaultOf(expr) {
  const m = /\.default\(([^)]*)\)/.exec(expr);
  if (m === null) return "—";
  const raw = m[1].trim();
  if (raw === "") return "—";
  return `\`${raw.replace(/\|/g, "\\|")}\``;
}

const configs = new Map();
const configRe = /const\s+([A-Za-z_$][\w$]*)\s*=\s*Schema\.object\(/g;
for (let m = configRe.exec(source); m !== null; m = configRe.exec(source)) {
  const open = source.indexOf("{", m.index);
  configs.set(m[1], parseFields(blockAt(source, open)));
}

const specs = [];
// `ns:` and `schema:` are not always adjacent — a comment or an extra key can
// sit between them — so walk each `ns:` occurrence and look forward inside the
// same object literal.
const nsRe = /ns:\s*"([^"]+)",/g;
for (let m = nsRe.exec(source); m !== null; m = nsRe.exec(source)) {
  const body = specBody(source, m.index);
  const schema = /schema:\s*([^\n]+?),\s*(?:\/\/[^\n]*)?(?:\n|$)/.exec(body);
  if (schema === null) continue;
  const configName = /^schemasteryJson\(([A-Za-z_$][\w$]*)\)/.exec(schema[1]);
  // `base` may be a literal object or a builder call (`buildPiAiCatalogBase()`),
  // and reading it past the end of this spec is how the previous version
  // attributed bash's defaults to llm-pi-ai.
  const base = /base:\s*([^\n]+?),\s*(?:\/\/[^\n]*)?(?:\n|$)/.exec(body);
  const applies = /applies:\s*"([^"]+)"/.exec(body);
  specs.push({
    ns: m[1],
    config: configName === null ? null : configName[1],
    base: base === null ? "" : base[1].trim(),
    applies: applies === null ? "live" : applies[1],
  });
}

const lines = [
  "# Settings fields（由 schema 生成）",
  "",
  "> 本文由 `node scripts/dump-settings-fields.mjs` 从 `packages/server/face/src/settings-schemas.ts` 生成，不要手改。",
  "> 增删字段先改 schema，再重跑脚本；文档与 `settings_get` / `settings_mutate` / Settings 卡片读的是同一份定义。",
  "",
  `共 ${specs.length} 个 namespace。\`applies=live\` 保存即生效；\`restart\` 需重启 Host。`,
  "",
  "## 快速地图",
  "",
  "| 想做什么 | namespace | 关键字段 |",
  "| --- | --- | --- |",
  "| 接一个 OpenAI 兼容网关 | `llm-pi-ai` | `providers.<id>.baseURL` · `credentialRef` · `models` |",
  "| 换默认模型 / 思考档 | `agent-default-model` | `provider` · `model` · `reasoningEffort` |",
  "| 语音听写 / 朗读 | `asr` · `tts` | `enabled` · `engine` · `baseUrl` · `downloadProxy` · `voice` |",
  "| 浏览器自动化 | `browser` | `mode`（agent-browser / http / cdp）· `cdpUrl` |",
  "| 桌面 GUI | `computer-use` | `mode`（off / agent-desktop / uia / background） |",
  "| 沙箱 / 权限 | `sandbox` · `permission` | `backend` · `defaultPreset` · `extraWritableRoots` |",
  "| 外部 MCP | `mcp` | `servers[]` · `allowConnect` |",
  "| 定时任务 | `cron` | `enabled` |",
  "| 生图 / 生视频 / 看视频 | `image-gen` · `video-gen` · `video-analyze` | `mode` · `baseUrl` · `model` |",
  "| 联网搜索 | `web-search` | `provider` + 各家的 key |",
  "| 界面语言 / 主题 | `locale` · `ui-theme` | `preference` · `fontSize` |",
  "",
];

for (const spec of specs) {
  const rows = spec.config === null ? [] : (configs.get(spec.config) ?? []);
  lines.push(`## \`${spec.ns}\`${spec.applies === "restart" ? " （需重启）" : ""}`, "");
  if (spec.base !== "") lines.push(`默认值：\`${spec.base}\``, "");
  lines.push("| 字段 | 类型 | 默认 | 说明 |", "| --- | --- | --- | --- |");
  for (const row of rows) {
    lines.push(
      `| \`${row.name}\` | ${typeOf(row.expr)} | ${defaultOf(row.expr)} | ${row.doc.replace(/\|/g, "\\|")} |`,
    );
  }
  if (rows.length === 0 && spec.ns === "mcp") {
    lines.push(
      "| `servers` | array | `[]` | MCP server 列表：`{ serverName, command?, url?, args?, cwd?, cwdAllowWorkspace?, env? }`（与 `host-settings.json` 同形） |",
      "| `allowConnect` | boolean | `false` | 允许 Host 主动连接新声明的 server |",
    );
  } else if (rows.length === 0) {
    lines.push("| — | — | — | 见 schema 源码（非 `Schema.object` 平铺） |");
  }
  if (spec.ns === "llm-pi-ai") {
    lines.push(
      "",
      "`providers.<id>`（接一个 OpenAI 兼容网关就填这张表）：",
      "",
      "| 子字段 | 类型 | 说明 |",
      "| --- | --- | --- |",
      "| `baseURL` | string | 网关根地址，例如 `http://127.0.0.1:8788/v1` |",
      "| `apiKeyEnv` | string | 凭据槽名，例如 `WORKBUDDY_API_KEY`（值存在 `.credentials.yaml`，不在 `settings.yaml`） |",
      "| `api` | enum | 协议：`openai-chat` / `openai-responses` / `anthropic` 等 `PI_AI_PROTOCOLS` |",
      "| `displayName` | string | Settings → Models 里显示的名字 |",
      "| `proxy` | string | 该 provider 的出口代理；模型级 `proxy` 优先 |",
      "| `models[]` | array | 每项 `{ id, name, contextWindow, maxTokens, … }`；`id` 必填 |",
      "",
      "顺序：先 `settings_mutate` 声明 provider + `apiKeyEnv`，再经 Settings 密钥框（或 credentials 工具）写该槽的值。手改 `.credentials.yaml` 运行期不重载 —— Host 只在启动时把文件名映射到 provider。",
    );
  }
  lines.push("");
}

lines.push(
  "## 不在 settings.yaml 里的配置",
  "",
  "| 位置 | 内容 | 用什么改 | 注意 |",
  "| --- | --- | --- | --- |",
  "| `{XRK_HOME}/host-settings.json` | LLM provider 定义（`llm.providers`）、MCP server SoT、默认模型 | Settings 卡片 / `settings_mutate` ns `llm-pi-ai` · `mcp` | 与 `settings.yaml` 双源，别手改错文件 |",
  "| `{XRK_HOME}/.credentials.yaml` | 密钥槽（`XRK_VOICE_OPENAI_KEY`、`<PROVIDER>_API_KEY`…） | Settings 的密钥框 / credentials 工具 | **Host 只在启动时映射文件名到 provider**：先声明 provider，再保存密钥；手改文件运行期不重载 |",
  "| `{XRK_HOME}/settings.yaml` | 上述 namespace 的用户层 | `settings_mutate`（推荐）或 Settings UI | 手改后需重载；未知字段会被 schema 丢弃 |",
  "| 环境变量 `XRK_*` | CI / 旁路开关（`XRK_VOICE`、`XRK_HOME`、`XRK_IMAGE_GEN`…） | 启动命令 | 不写盘；与 settings 冲突时按各模块注释的优先级 |",
  "",
);

writeFileSync(outFile, `${lines.join("\n")}\n`, "utf8");
console.log(`wrote ${path.relative(root, outFile)} — ${specs.length} namespaces, ${configs.size} configs`);
