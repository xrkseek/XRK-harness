# AGENTS.md — XRK-Harness

面向**克隆本仓、改代码 / 写测 / 同步规格**的开发者与 Coding Agent。  
产品介绍与安装路径见根 [README.md](./README.md)；契约真源见 [docs/](./docs/README.md)。

文档 / skill 与实现冲突时以**代码**为准；能力是否可依赖以 [docs/status.md](./docs/status.md) 为准。

---

## 角色边界

| 你是谁 | 改哪里 | 不要做 |
|--------|--------|--------|
| **集成试用** | 本地 env · workspace · 扩展插件目录 | 为「先跑起来」改内核契约；勿把密钥提交进仓 |
| **能力叶作者** | `packages/exec-*` · `packages/mcp` · `packages/llm-*` · `packages/workspace` · `packages/policy` 等 | 从 `apps/*` 反向依赖；在 preset 里写业务逻辑 |
| **内核维护者** | `packages/kernel` · `protocol` · `compose` · `core-*` | `kernel` → `compose`；引入 Go / 多语言宿主树；全局 Proxy / 裸名上帝对象 |
| **Host / Face** | `packages/server/*` · Face wire | server → 具体 llm 适配实现；把 Cordis Host 嵌进内核 |
| **产品壳** | `apps/web` · `packages/client/*` · 品牌 `apps/web/public` | 当 GitHub Fork 向上游 deepseek-ai 提 PR；vendor / 捕获目录；用裸 Vite 当产品入口 |
| **Preset** | `presets/minimal\|harness\|server` | 业务逻辑、密钥、绕过 policy 的默认放行 |
| **进程插件** | `extensions/*`（`kind: tools\|prompt\|commands`） | 依赖 `apps` 内部私有路径 |
| **文档 / 发布** | `docs/*` · `CONTRIBUTING` · `publishing` | 把未实现写成规格；本机绝对路径 / 代理端口进仓库文档 |
| **Coding Agent** | 用户指定切片 | 擅自 commit / push；带 Cursor co-author trailer；跳过 `pnpm check` |

---

## 栈与启动

- **Node ≥ 26** · 包管理仅 **pnpm 9**（`packageManager`）
- 构建：`pnpm install` → `pnpm build`（或 `pnpm check`）
- CLI：`node apps/cli/dist/bin.js run|serve|web|doctor|dump-config`
- 首读（按任务）：

| 任务 | 先读 |
|------|------|
| 任意改动 | [docs/status.md](./docs/status.md) · 本文件角色表 |
| Session / 事件 | [docs/session.md](./docs/session.md) · [protocol-events](./docs/protocol-events.md) |
| 工具 | [docs/tool-pipeline.md](./docs/tool-pipeline.md) · [seams](./docs/seams.md) |
| Host / Face | [docs/host-face.md](./docs/host-face.md) · [http-api](./docs/http-api.md) |
| MCP | [docs/modules/mcp.md](./docs/modules/mcp.md) · [policy](./docs/policy.md) |
| 壳 UI | [docs/host-face.md](./docs/host-face.md) · `apps/web` · `packages/client` |
| 包落点 | [docs/modules/](./docs/modules/README.md) |
| 门禁 | [docs/testing.md](./docs/testing.md) · [CONTRIBUTING.md](./CONTRIBUTING.md) |

全索引：[docs/README.md](./docs/README.md)。

---

## 目录真源

以本仓树与 [docs/architecture.md](./docs/architecture.md) 为准。**改路径先改规格再改代码。**

```text
apps/          → sdk | server | presets
presets/sdk/server → core* | llm | mcp | attachment | exec* | workspace | policy | compose
core* / 能力叶 → kernel | protocol | compose
compose        → 零或薄依赖（禁止 kernel → compose）
```

禁止边（摘要）：

- `server` → 具体 llm 适配包
- `core-agent` → 具体 exec 实现
- `extensions` → `apps` 内部
- presets 写业务逻辑

---

## 按域放码

| 域 | 落点 | 备注 |
|----|------|------|
| CLI | `apps/cli` | bin `xrk-harness` |
| 产品壳 | `apps/web` + `packages/client/*` | serve 用 `apps/web/dist`（gitignore）；组装 `web:build` · `client:bundle` · `web:assemble` |
| Face 验证台 | `apps/console` | 无 dist 时 Host 回退 |
| SDK 表面 | `packages/sdk`（`@xrkseek/harness`） | 对外组合入口 |
| Host 接线 | `packages/server/host` · `face` · `http` · `config` · `loader` | Face 只对接 wire |
| Session / Agent / Tools | `packages/core-*` | 事件可重建；turn 短寿 |
| LLM | `packages/llm-*` · `llm/registry` | 密钥仅运行时；Registry 单路径 |
| MCP | `packages/mcp` | 默认 deny；Host `XRK_MCP_*` 或文件真源热挂载 |
| Exec | `packages/exec-*` | Definition / Provider / Consumer 缝 |
| Preset | `presets/*` | 只 `create*Composition` 接线 |
| 示例插件 | `extensions/example-tools` | `XRK_PLUGINS_DIR` |
| 规格 | `docs/*.md` · `docs/modules/` · `docs/adr/` | 只写已有行为 |
| 本机对照 | Cursor Canvas | **不入库** |

---

## 红线

| 红线 | 含义 |
|------|------|
| 宿主仅 TypeScript | 无 Go / 多语言宿主树（[ADR-0001](./docs/adr/0001-typescript-only-host.md)） |
| Session 长寿 · loop 短寿 | 模型可见输入必须可从 session 事件重建（[ADR-0003](./docs/adr/0003-session-long-loop-short.md)） |
| 无全局 Proxy | 组合用 `@xrkseek/compose`（[ADR-0005](./docs/adr/0005-compose-leaf.md)） |
| 外壳 / 内核 | 壳可二次创作；内核不可让；不对 deepseek-ai 提 PR；无 vendor（[ADR-0002](./docs/adr/0002-no-embed-upstream.md)） |
| presets | 无业务逻辑 |
| 密钥 | 不入库；文档不写真值 |
| 文档诚实 | 未实现 → `status`「未做」；勿写成假 API / 路线清单当规格 |
| 本机泄漏 | 绝对路径、固定代理端口 → Canvas，不进 `docs/` / README |

产品身份细则：`.cursor/rules/xrk-product-identity.mdc`。

---

## 完成定义（切片）

**代码 + 测试 +（若改契约）对应规格同步 + `pnpm check` 绿。**

| 改动 | 必须同步 |
|------|----------|
| SessionEvent / HTTP body | `docs/session*.md` · `http-api.md` · protocol |
| 工具管道 / settle | `docs/tool-*.md` |
| Preset 选项 | `docs/profiles.md` · preset README |
| 新能力是否可依赖 | `docs/status.md` |
| Face / MCP 产品面 | `host-face.md` · `modules/mcp.md` · status |

空壳能力：实现前 **只** 更新 status「未做」。

用户未明确要求时：**不要** `git commit` / `push`。

---

## 常见扩展路径

1. **工具**：`ToolDefinition` + `createToolRegistry`；IO 走 `@xrkseek/exec-*` Provider  
2. **守卫**：`pipeline.onGuard`；可选 `policy` → `createPolicyToolPre`  
3. **Preset**：组合现有包；参考 `presets/minimal/preset.ts`  
4. **进程插件**：`extensions/*` + `kind: tools|prompt|commands`；`XRK_PLUGINS_DIR`  
5. **测例**：`packages/**/tests`；LLM 用 `@xrkseek/llm-replay`；无密钥  

---

## 相关入口

| 读者 | 入口 |
|------|------|
| 所有人（安装 / 产品） | [README.md](./README.md) |
| 贡献者 | [CONTRIBUTING.md](./CONTRIBUTING.md) |
| 规格索引 | [docs/README.md](./docs/README.md) |
| 能力诚实 | [docs/status.md](./docs/status.md) |
| 包地图 | [docs/modules/README.md](./docs/modules/README.md) |
