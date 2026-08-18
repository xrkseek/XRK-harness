# AGENTS.md — XRK-Harness

## 产品

TypeScript Agent Harness + Server Kit。宿主 **仅 TypeScript（Node ≥26）**。

## 目录真源

以本仓树与 [docs/architecture.md](./docs/architecture.md) 为准。改路径先改规格再改代码。

## 依赖纪律

- `apps` → `sdk` / `server` / `presets`
- `sdk` / `server` / `presets` → `core*` / `llm` / `mcp` / `attachment` / `exec*` / `workspace` / `policy` / `compose`
- 能力叶与 `core*` → `kernel` / `protocol` / `compose`
- `compose` →（零或薄依赖；禁止 `kernel` → `compose`）
- 禁止：server → 具体 llm 适配；core-agent → exec 实现；extensions → apps 内部

## 红线

- 无 Go / 多语言宿主树
- 无全局 Proxy / 裸名上帝对象
- 模型可见输入必须可从 session 事件重建
- presets 无业务逻辑
- 密钥不入库
- 文档只描述**本仓已有**行为；未实现的不要写成能力或路线清单
- 本机临时路径 / 对照笔记 → Canvas，不进 `docs/` / README
- **外壳可复用、内核不可让**：聊天 UI 二次创作 = `apps/web` + `packages/client`（不是 GitHub Fork，不对 deepseek-ai 提 PR）。Face 验证台 `apps/console`。无 vendor、无捕获目录。session 事件真源 · TS 宿主 · 工具瀑布 · compose/presets 是本仓本质，Face 只对接 wire，不嵌 Cordis Host

## 完成定义（切片）

代码 + 测试 +（若改契约）对应规格同步 + `pnpm check` 绿。

## 文档

- [docs/README.md](./docs/README.md) · [docs/status.md](./docs/status.md) · [docs/learn.md](./docs/learn.md) · [docs/modules/](./docs/modules/README.md) · [CONTRIBUTING.md](./CONTRIBUTING.md)
