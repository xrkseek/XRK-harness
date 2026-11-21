# 插件开发

> **读者**：集成者 · 贡献者

在 XRK-Harness 上扩展能力，认 **XRK Plug**（`@xrkseek/plug`）：优先 **进程插件**（`tools` / `prompt` / `commands`），再由 Host discover → preset 接线。开放面总览：[open-platform.md](./open-platform.md)。客户端壳叠加见文末「Client 叠加」与 [client-plugin-development.md](./client-plugin-development.md)。表面分级：[plugin-surface-map.md](./plugin-surface-map.md)。

契约 API 细节：[plugin-loader.md](./plugin-loader.md)。选型：[profiles.md](./profiles.md)。

## 你要做哪一种

| 目标 | kind | 金样 | 结果 |
|------|------|------|------|
| 给模型新工具 | `tools` | `example-tools` | `ToolDefinition[]` → ToolRegistry |
| 往 system 追加段落 | `prompt` | `example-prompt` | `promptSections[]` → SystemPromptAssembler |
| 斜杠 / 命令面 | `commands` | `example-commands` | Face `commands/list` + `commands/execute` |
| 策略规则 | `policy` | `example-policy` | `policyRules[]` → Host policy engine |
| 工具前后钩子 | `hooks` | `example-hooks` | `hooks.onPre` / `onPost` → ToolPipeline |
| LLM brand | `llm` | `example-llm` | `llmBrands[]` → ProviderRegistry |
| 通道描述 | `channel` | `example-channel` | `channels[]` → `processChannels/list` |
| 改产品壳 UI | `xrk.client`（client 包） | `example-composer-action` · `example-theme-tokens` · **`example-workbench-push`** | `~/.xrk/plugins/web/` 叠加，**不是**进程 kind；见 [client-plugin-development.md](./client-plugin-development.md) · [open-platform.md](./open-platform.md) |

### 信任边界（必读）

进程插件经 `import()` **进入 Host 同进程**，权限等同本机 Host（可读密钥、跑工具、挂 HTTP），**不是**沙箱。只装你信任的来源。可选在 `xrk.plugin.json` 声明：

```json
{
  "trust": {
    "note": "Process plugin — same privileges as the Host.",
    "capabilities": ["tools"]
  }
}
```

Settings → 插件列表会提示同进程全权。细节见 [security-checklist.md](./security-checklist.md)。

本仓只 discover **`kind: cordis` 进程包**、不自动 `apply`（写它请放 extensions/）。装 **社区 client / `host.mjs` 包**见 [community-plugins.md](./community-plugins.md) · [plugin-loader.md](./plugin-loader.md)。

## 最小进程插件（推荐路径）

目录：

```text
my-plugin/
  xrk.plugin.json     # id / kind / entry
  plugin.mjs          # export createPlugin()
```

`xrk.plugin.json`：

```json
{
  "id": "my-plugin",
  "kind": "tools",
  "entry": "./plugin.mjs"
}
```

`plugin.mjs`：

```js
export function createPlugin() {
  return {
    id: "my-plugin",
    kind: "tools",
    tools: [
      {
        name: "my_ping",
        description: "Returns pong",
        parameters: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
        async execute() {
          return { content: "pong" };
        },
      },
    ],
  };
}
```

仓内金样：[extensions/example-tools](../extensions/example-tools/)。

### 本机试跑

```bash
# 源码仓
XRK_PLUGINS_DIR=./extensions node apps/cli/dist/bin.js web --workspace .

# 或装到用户插件根
xrkh plugin add ./extensions/example-tools
```

`plugin list` / `plugin path` 看 `~/.xrk/plugins`（可用 `XRK_HOME` / `XRK_PLUGINS_DIR` 改）。

- **进程半部**（本例）：Settings 启停 / 重载会 live reconcile；改 `plugin.mjs` 后可用 Settings **重载**或 `xrkh restart`。
- **Client 半部**：见 [client-plugin-development.md](./client-plugin-development.md)「作者开发循环」——Settings soft remount，一般不必先 `restart`。

整 Host 仍用 **`restart`**（pid 锁停自己的 Host）。`--force` 只杀已识别的 XRK 监听；不会误杀 nginx 等。

### 插件开发边界（仓内 `extensions/`）

| 类别 | 落点 | 是否进主仓 git / pnpm workspace |
|------|------|--------------------------------|
| **金样 / 内置适配** | `extensions/example-tools` · `example-channel` · `example-composer-action` · `example-theme-tokens` · `example-shell-*` · **`example-workbench-push`** · `a2a` · `dsh-compat` | **是**（`.gitignore` / `pnpm-workspace` 白名单） |
| **第一方原生产品插件** | `xrk-sunflower-free` · `xrk-phone-bridge` · `xrkh-better-sidebar` · `xrkh-better-sidebar-plugin-office` | 源码可在 `extensions/`；经 **设置 → 插件** / `xrkh plugin add` 装到 `~/.xrk/plugins`；清单见 [client-plugin-development.md](./client-plugin-development.md) |
| **第三方 / 本地工作树** | `extensions/<plugin-id>/`（对标 AGT 本地 Core） | **默认忽略**；联调产物不提交进主仓 |
| **用户全局安装** | `~/.xrk/plugins`（`xrkh plugin add`） | 不在源码仓内 |

边界：

- **产品 Agent / 插件作者**：只写 `extensions/<id>/`；`packages/` · `apps/` · `presets/` 由内核维护者修改。
- **Client 叠加包**（`xrk.client`）：装到 `plugins/web/`，不参与进程 `kind` discover；原生写法见 [client-plugin-development.md](./client-plugin-development.md)；社区 Host 面见 [community-plugins.md](./community-plugins.md)。
- **第一方原生侧栏**（`xrkh-better-sidebar` + `xrkh-better-sidebar-plugin-office`）：**Host 拥有** `/sidebar/*`；插件只挂 client，插件 host 半包不提供 `/sidebar/*` 前缀。
- 热重载边界：进程半部 Settings reconcile / **重载**；client 半部 Settings soft remount（装 / 启 / 更 / 重载）与 soft unload（停用 / 删除）；仍不亮或失败 → 硬刷新；整 Host 用 `xrkh restart`。

### 接线发生在哪

1. Host `loadAll(pluginsDir)` → `RegisteredPlugin[]`
2. Session 工厂按徽章选 `minimal` / `harness` composition
3. Composition 调 `wireCompositionTools` / `wireCompositionPrompts`
4. Face 同一列表做 inventory 与 slash

同名 builtin / 保留 prompt id **不会**被插件覆盖。

## 工作区喂法（让 Agent 会写插件）

本仓自带 **`.agents/`**（增量 `AGENTS.md` · `context/` · 本仓 skills · 本仓 recipes），**无需**把 CLI seeds 再抄一份。会话徽章用 **XRK Harness**（`harness`）。**工作区根即本 monorepo 时**，插件写在 **`extensions/<plugin-id>/`**；Host 注入工作区 `.agents/AGENTS.md`（**不**灌根维护者 `AGENTS.md`），并叠 `~/.xrk/` 站立种子。跨项目人格与产品默认 skill 在 **`~/.xrk/`**。先加载 skill **`xrk-harness-monorepo`**。

### 产品 skills（catalog）

工作区 `.agents/skills/` 与 `{workspace}/.xrk/skills/` 进入 `<available_skills>`（仅 frontmatter `name` + `description`）。本仓 **不**把 `apps/cli/seeds/skills` 再放进 `.agents/skills`（否则与 `~/.xrk/skills` 同名灌两份）。

| Skill | 落点 | 用途 |
|-------|------|------|
| **`xrk-harness-monorepo`** | 本仓 `.agents/skills` | monorepo 总控 |
| `xrk-plugin` | CLI seeds → `~/.xrk/skills`（`skill` 工具） | 选型 / 写插件 / 验证 |

维护者改内核见 [maintainer.md](./maintainer.md)。分层说明：[skills-layers.md](./skills-layers.md)。

## Client 叠加（原生主路径）

带 `xrk.client` / `dsh.client` 的包经 `xrkh plugin add` 写入 `plugins/web/`，Host merge 进产品壳 boot。Settings **重载** soft remount client 半部；停用 / 删除 soft unload（失败再硬刷新）。不参与进程 discover（`web/` 被跳过）。详情见 [client-plugin-development.md](./client-plugin-development.md)。

**写输入框控件、读当前模型、叠主题 token**：见 [client-plugin-development.md](./client-plugin-development.md)。金样：`extensions/example-composer-action` · `extensions/example-theme-tokens`。

## 社区 client / Host 包（可选）

与上文「最小进程插件」和原生 client 不同：社区包通常带 **`client.js`**（壳 UI）和可选 **`host.mjs`**（同源 HTTP/RPC），经兼容器接线。兼容器**不是**写原生插件的前置；计划在 **0.9** 迁出为独立 npm `@xrkseek/dsh-compat`。

```bash
xrkh plugin add dsh-wallet
xrkh plugin add @xmanrui/dsh-im
xrkh restart
```

| 文档 | 内容 |
|------|------|
| [client-plugin-development.md](./client-plugin-development.md) | **原生**壳扩展（优先） |
| [community-plugins.md](./community-plugins.md) | 社区 Host 契约 · 已实现 / 待补 · fixture |
| [plugin-loader.md](./plugin-loader.md) | discover · `host.mjs` apply · subprocess |

## 边界

- 热重载 / watch：不支持  
- 未声明入口的任意执行：不支持  
- 插件覆盖同名 builtin：不支持  
- 外部云端满血能力不在本仓实现（见 community-plugins「待补」）

相关：[client-plugin-development.md](./client-plugin-development.md) · [plugin-loader.md](./plugin-loader.md) · [community-plugins.md](./community-plugins.md) · [host-preset.md](./host-preset.md) · [modules/server-loader.md](./modules/server-loader.md)

---

# Plugin Development

> **Audience**: Integrators · Contributors

On XRK-Harness, prefer **process plugins** (`tools` / `prompt` / `commands`), discovered by the Host and wired through presets. Open-platform map: [open-platform.md](./open-platform.md). Client-shell overlays are covered under “Client overlay” below and [client-plugin-development.md](./client-plugin-development.md). Surfaces: [plugin-surface-map.md](./plugin-surface-map.md).

Contract API details: [plugin-loader.md](./plugin-loader.md). Profile selection: [profiles.md](./profiles.md).

## Which kind to choose

| Goal | kind | Sample | Outcome |
|------|------|--------|---------|
| New model tools | `tools` | `example-tools` | `ToolDefinition[]` → ToolRegistry |
| Extra system sections | `prompt` | `example-prompt` | `promptSections[]` → SystemPromptAssembler |
| Slash commands | `commands` | `example-commands` | Face `commands/list` + `commands/execute` |
| Policy rules | `policy` | `example-policy` | `policyRules[]` → Host policy engine |
| Tool pre/post hooks | `hooks` | `example-hooks` | `hooks.onPre` / `onPost` → ToolPipeline |
| LLM brand | `llm` | `example-llm` | `llmBrands[]` → ProviderRegistry |
| Channel descriptors | `channel` | `example-channel` | `channels[]` → `processChannels/list` |
| Product-shell UI | `xrk.client` (client package) | `example-composer-action` · `example-theme-tokens` · **`example-workbench-push`** | Overlay under `~/.xrk/plugins/web/`, **not** a process kind; see [client-plugin-development.md](./client-plugin-development.md) · [open-platform.md](./open-platform.md) |

### Trust boundary (required reading)

Process plugins are **`import()`-ed into the Host process** with the same privileges as the Host (secrets, tools, HTTP) — **not** a sandbox. Install only what you trust. Optional `xrk.plugin.json` disclosure:

```json
{
  "trust": {
    "note": "Process plugin — same privileges as the Host.",
    "capabilities": ["tools"]
  }
}
```

Settings → Plugin list surfaces the same-process warning. See [security-checklist.md](./security-checklist.md).

Do not author in-tree **`kind: cordis` process packages** (discover only; no automatic `apply`). For **community client / `host.mjs` packages**, see [community-plugins.md](./community-plugins.md) · [plugin-loader.md](./plugin-loader.md).

## Minimal process plugin (recommended)

Layout:

```text
my-plugin/
  xrk.plugin.json     # id / kind / entry
  plugin.mjs          # export createPlugin()
```

`xrk.plugin.json`:

```json
{
  "id": "my-plugin",
  "kind": "tools",
  "entry": "./plugin.mjs"
}
```

`plugin.mjs`:

```js
export function createPlugin() {
  return {
    id: "my-plugin",
    kind: "tools",
    tools: [
      {
        name: "my_ping",
        description: "Returns pong",
        parameters: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
        async execute() {
          return { content: "pong" };
        },
      },
    ],
  };
}
```

In-repo golden sample: [extensions/example-tools](../extensions/example-tools/).

### Local smoke test

```bash
# From the monorepo
XRK_PLUGINS_DIR=./extensions node apps/cli/dist/bin.js web --workspace .

# Or install into the user plugin root
xrkh plugin add ./extensions/example-tools
```

Use `plugin list` / `plugin path` to inspect `~/.xrk/plugins` (overridable with `XRK_HOME` / `XRK_PLUGINS_DIR`).

- **Process half** (this sample): Settings enable/disable / reload live-reconciles; after editing `plugin.mjs`, Settings **Reload** or `xrkh restart`.
- **Client half**: see [client-plugin-development.md](./client-plugin-development.md) “Author loop” — Settings soft remount; usually no prior `restart`.

Full Host reload still uses **`restart`** (pid lock). `--force` only stops recognized XRK listeners; it will not kill nginx and similar.

### Plugin boundaries (`extensions/` in this monorepo)

| Kind | Location | In main-repo git / pnpm workspace? |
|------|----------|-------------------------------------|
| **Samples / built-in adapter** | `extensions/example-tools` · `example-channel` · `example-composer-action` · `example-theme-tokens` · `example-shell-*` · **`example-workbench-push`** · `a2a` · `dsh-compat` | **Yes** (`.gitignore` / `pnpm-workspace` whitelist) |
| **First-party native product plugins** | `xrk-sunflower-free` · `xrk-phone-bridge` · `xrkh-better-sidebar` · `xrkh-better-sidebar-plugin-office` | Source may live under `extensions/`; install via **Settings → Plugins** / `xrkh plugin add` into `~/.xrk/plugins`; inventory in [client-plugin-development.md](./client-plugin-development.md) |
| **Third-party / local working tree** | `extensions/<plugin-id>/` (AGT-style local Core) | **Ignored by default**; OK for local smoke tests, do not commit into the main repo |
| **User global install** | `~/.xrk/plugins` (`xrkh plugin add`) | Outside the monorepo |

Boundaries:

- **Product Agent / plugin authors**: write only under `extensions/<id>/`; `packages/` · `apps/` · `presets/` are changed by kernel maintainers.
- **Client overlay packages** (`xrk.client`): install under `plugins/web/`; not process `kind` discover; native authoring in [client-plugin-development.md](./client-plugin-development.md); community Host contracts in [community-plugins.md](./community-plugins.md).
- **First-party native sidebar** (`xrkh-better-sidebar` + `xrkh-better-sidebar-plugin-office`): **Host owns** `/sidebar/*`; the package injects client UI only — a plugin host half provides no `/sidebar/*` prefix.
- Hot-reload boundary: process half Settings reconcile / **Reload**; client half Settings soft remount (install / enable / update / reload) and soft unload (disable / delete); still-dark UI or failure → hard refresh; full Host via `xrkh restart`.

### Where wiring happens

1. Host `loadAll(pluginsDir)` → `RegisteredPlugin[]`
2. Session factory picks `minimal` / `harness` composition by badge
3. Composition calls `wireCompositionTools` / `wireCompositionPrompts`
4. Face uses the same list for inventory and slash

Same-name builtins and reserved prompt ids are **not** overridden by plugins.

## Workspace agent layer (teach agents to author plugins)

This repo ships **`.agents/`** as an overlay (`AGENTS.md` · `context/` · repo-only skills · repo-only recipes) — **do not** copy CLI seeds into it. Use the **XRK Harness** session badge (`harness`). When the workspace root **is this monorepo**, plugins belong under **`extensions/<plugin-id>/`**; Host injects workspace `.agents/AGENTS.md` (skips root maintainer `AGENTS.md`) **on top of** `~/.xrk/` standing seeds. Global persona and default product skills live under **`~/.xrk/`**. Load skill **`xrk-harness-monorepo`** first.

### Product skills (catalog)

Workspace `.agents/skills/` and `{workspace}/.xrk/skills/` enter `<available_skills>` (frontmatter `name` + `description` only). This repo **does not** mirror `apps/cli/seeds/skills` into `.agents/skills` (that would inject the same names twice next to `~/.xrk/skills`).

| Skill | Lives in | Purpose |
|-------|----------|---------|
| **`xrk-harness-monorepo`** | This repo `.agents/skills` | Monorepo router |
| `xrk-plugin` | CLI seeds → `~/.xrk/skills` (`skill` tool) | Kind / author / verify |

Maintainer kernel work: [maintainer.md](./maintainer.md). Layering: [skills-layers.md](./skills-layers.md).

## Client overlay (native main path)

Packages with `xrk.client` / `dsh.client` land under `plugins/web/` via `xrkh plugin add`; the Host merges them into the product-shell boot. Settings **Reload** soft-remounts the client half; disable / delete soft-unloads (hard-refresh only on failure). They are not process-discovered (`web/` is skipped). Details: [client-plugin-development.md](./client-plugin-development.md).

**Composer controls, reading the selected model, theme tokens**: [client-plugin-development.md](./client-plugin-development.md). Samples: `extensions/example-composer-action` · `extensions/example-theme-tokens`.

## Community client and Host packages (optional)

Unlike process plugins and native client packages above, community packages usually ship **`client.js`** (shell UI) and optional **`host.mjs`** (same-origin HTTP/RPC) through the compat bridge. Compat is **not** a prerequisite for native authoring; it is planned to extract at **0.9** as standalone npm `@xrkseek/dsh-compat`.

```bash
xrkh plugin add dsh-wallet
xrkh plugin add @xmanrui/dsh-im
xrkh restart
```

| Doc | Content |
|-----|---------|
| [client-plugin-development.md](./client-plugin-development.md) | **Native** shell extension (preferred) |
| [community-plugins.md](./community-plugins.md) | Community Host contracts · Implemented / Planned · fixtures |
| [plugin-loader.md](./plugin-loader.md) | discover · `host.mjs` apply · subprocess |

## Boundaries

- Hot reload / watch: not supported
- Arbitrary execution without a declared entry: not supported
- Plugins overriding same-name builtins: not supported
- Full external cloud parity is not implemented in-tree (see community-plugins Planned)

Related: [client-plugin-development.md](./client-plugin-development.md) · [plugin-loader.md](./plugin-loader.md) · [community-plugins.md](./community-plugins.md) · [host-preset.md](./host-preset.md) · [modules/server-loader.md](./modules/server-loader.md)
