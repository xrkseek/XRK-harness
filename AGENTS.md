# AGENTS.md — XRK-Harness

给 Coding Agent / 维护者的边界说明。

## 产品

TypeScript Agent Harness + Server Kit。宿主 **仅 TypeScript（Node ≥26）**。本仓实现与规格自洽，不 vendor 第三方 agent 运行时源码树。

## 目录真源

以本仓实际树与 [docs/architecture.md](./docs/architecture.md) 为准；**基础 harness 规格原文**在 [docs/upstream/deepseek-harness/](./docs/upstream/deepseek-harness/)（自 XRKbar 照搬）。改路径先改规格再改代码。

## 依赖纪律

- `apps` → `sdk` / `server` / `presets`
- `sdk` / `server` / `presets` → `core*` / `llm` / `mcp` / `exec*` / `workspace` / `policy` / `compose`
- 能力叶与 `core*` → `kernel` / `protocol` / `compose`
- `compose` →（零或薄依赖；禁止 `kernel` → `compose`）
- 禁止：server → 具体 llm 适配；core-agent → exec 实现；extensions → apps 内部

## 红线

- 无 Go / 多语言宿主树
- 无全局 Proxy / 裸名上帝对象
- 模型可见输入必须可从 session 事件重建
- presets 无业务逻辑
- 密钥不入库
- **基础架构/seams/pipeline/写作 skills：以 XRKbar `deepseek-harness`（及 bar 内其它 harness）原文为真源，照搬合并；禁止二次精简创作**（见 [docs/learn.md](./docs/learn.md) · Canvas `xrk-harness-polish-learn`「真源纪律」）

## 完成定义（切片）

代码 + 测试 +（若改契约）docs/规格同步 + `pnpm check` 绿。

## 文档

- 入口：[docs/README.md](./docs/README.md)
- 能力矩阵：[docs/status.md](./docs/status.md)
- 学习 / 合并真源：[docs/learn.md](./docs/learn.md)
- 贡献：[CONTRIBUTING.md](./CONTRIBUTING.md)
- 内部学习 / TODO 板：Cursor Canvas `xrk-harness-internal-docs` · `xrk-harness-polish-learn`（不入库）
