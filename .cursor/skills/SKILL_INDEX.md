# Skill 索引（XRK-Harness 本仓库）

Coding Agent / 克隆本仓改**内核**：根 [`AGENTS.md`](../../AGENTS.md) · rule [`xrk-workspace-mode`](../rules/xrk-workspace-mode.mdc)。  
**本仓作工作区写插件**（对标 AGT 写 Core）：仓库 [`.agents/`](../../.agents/) · skill **`xrk-harness-monorepo`**。

| 读者 | 放哪 | 写什么 |
|------|------|--------|
| **Coding Agent** | `.cursor/skills/xrk-*` · `AGENTS.md` | 改 loader / preset / Face / extensions |
| **产品 Agent** | `.agents/skills/*` · `~/.agents/skills/*` | 写插件、验证、kind 选型 |
| **契约** | `docs/*` | 行为真源；skill 只索引 |

## 一眼锁定（任务 → Skill）

| 你在做什么 | 先读 |
|------------|------|
| **本仓作工作区写插件**（产品 UI） | 产品 **`xrk-harness-monorepo`** → `xrk-plugin-*` |
| **写 / 审进程插件**（Cursor 改金样/loader） | `xrk-plugin-dev` → `xrk-extensions` |
| **kind 选型**（tools / prompt / commands / client） | `xrk-extensions` · 产品 `xrk-plugin-kind` |
| **MCP vs 进程插件** | `xrk-mcp-plugins` · [docs/modules/mcp.md](../../docs/modules/mcp.md) |
| **社区 client / host.mjs / dsh-compat** | `xrk-community-plugins` · [docs/community-plugins.md](../../docs/community-plugins.md) |
| **写产品 SKILL.md** | `xrk-workspace-skills`（对标 Cursor create-skill / create-rule） |
| **改 loader / discover / inventory** | `xrk-plugin-dev` · [docs/plugin-loader.md](../../docs/plugin-loader.md) |
| **改 preset 接线** | `xrk-plugin-dev` · [docs/profiles.md](../../docs/profiles.md) |
| **Settings / 模型 / MCP 设置 UI** | rule `xrk-client-face-ui` |
| Session / meter / compaction | `xrk-meter-session` |
| 写 / 改文档 | `xrk-docs-audience` |
| 发行说明 | `xrk-release-notes` |
| Node ≥26 / 门禁 | rule `xrk-node26` |
| 文档身份 / 双语 | rule `xrk-product-identity` |

## 维护向技能（Coding · `xrk-*`）

| Skill | 用途 |
|-------|------|
| **`xrk-plugin-dev`** | 插件体系总览：loader → preset → Face；改仓内 `extensions/` |
| **`xrk-extensions`** | `tools` / `prompt` / `commands` 契约与金样 |
| **`xrk-mcp-plugins`** | MCP 包 vs 进程插件；policy · 热挂载 |
| **`xrk-community-plugins`** | 社区 client · `xrk.host.json` · dsh-compat 层级 |
| **`xrk-workspace-skills`** | 产品 skill 写法 · frontmatter |
| `xrk-meter-session` | Meter / compaction / TokenUsage |
| `xrk-docs-audience` | 教科书身份与双语 |
| `xrk-release-notes` | `docs/releases/**` 文体 |

## 产品向技能（仓库 `.agents/skills/`）

| Skill | 触发语（写在 description 里） |
|-------|------------------------------|
| **`xrk-harness-monorepo`** | harness 源码仓作工作区、写 extensions 插件、monorepo 总控 |
| **`xrk-harness-architecture`** | 本仓架构总览 |
| **`xrk-plugin-author`** | 写插件、脚手架、`xrk.plugin.json`、`createPlugin` |
| **`xrk-plugin-kind`** | 选 kind、tools 还是 prompt、要不要 MCP |
| **`xrk-plugin-verify`** | `plugin add`、`restart`、工具是否可见 |
| **`xrk-create-skill`** | 写 skill（对标 Cursor create-skill） |
| **`xrk-models-settings`** | 配模型、手动 ID、获取列表、对话搜索 |
| **`xrk-capability-attach`** | 挂 MCP、Settings 粘贴 JSON |

会话徽章用 **XRK Harness**（`harness`）；全局人格可放 `~/.agents/`。见 [`.agents/README.md`](../../.agents/README.md)。

## 与 XRK-AGT 对照

| XRK-AGT | XRK-Harness |
|---------|-------------|
| 工作区写 `core/workspace-Core/` | 工作区写 **`extensions/<plugin-id>/`** |
| `agents/workspace/AGENTS.md` | **`.agents/AGENTS.md`**（**替代**根 AGENTS inject） |
| `agents/rules/workspace-dev.mdc` | `.agents/context/workspace-plugin-dev.md` |
| `agent-core` · `agent-core-dev` | **`xrk-harness-monorepo`** · `xrk-plugin-*` |
| 根 `AGENTS.md`（框架维护） | 根 `AGENTS.md`（Cursor only；Host 跳过） |
| `core/*/plugin/*.js` + PluginBase | `extensions/*` + `createPlugin()` |
