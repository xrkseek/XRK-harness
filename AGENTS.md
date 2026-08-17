# AGENTS.md — XRK-Harness

给 Coding Agent / 维护者的边界说明。

## 产品

TypeScript Agent Harness + Server Kit。宿主 **仅 TypeScript（Node ≥26）**。本仓实现与规格自洽。

## 目录真源

以本仓实际树与 [docs/architecture.md](./docs/architecture.md) 为准。改路径先改规格再改代码。

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
- **文档只写会进远程的内容**；本机临时路径、未跟踪产物、个人对照笔记放 Canvas，不写进 `docs/` / README
- 学习收获写在 [docs/learn.md](./docs/learn.md)

## 完成定义（切片）

代码 + 测试 +（若改契约）docs/规格同步 + `pnpm check` 绿。

## 文档

- 入口：[docs/README.md](./docs/README.md)
- 能力矩阵：[docs/status.md](./docs/status.md)
- 学习笔记：[docs/learn.md](./docs/learn.md)
- 贡献：[CONTRIBUTING.md](./CONTRIBUTING.md)
