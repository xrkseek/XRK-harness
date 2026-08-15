# AGENTS.md — XRK-Harness

给 Coding Agent / 维护者的边界说明。

## 产品

TypeScript Agent Harness + Server Kit。宿主 **仅 TypeScript（Node）**。

## 参考优先级（调研 · 取精华 · 自研）

1. DeepSeek Harness（骨架原则）
2. XRK-AGT（产品热路径契约）
3. cline / opencode（分层与 session/tool 形状）
4. 其余 XRKbar agent 项目（专项）

不并入上游源码树；不默认开启 Creator/自指改 runtime。

## 目录真源

以设计板 `xrk-harness-file-structure` 与本仓实际树为准。改路径先改规格再改代码。

## 依赖纪律

- `apps` → `sdk` / `server` / `presets`
- `sdk` / `server` / `presets` → `core*` / `llm` / `mcp` / `exec*` / `workspace` / `policy`
- 能力叶与 `core*` → `kernel` / `protocol`
- 禁止：server → 具体 llm 适配；core-agent → exec 实现；extensions → apps 内部

## 红线

- 无 Go / 多语言宿主树
- 无全局 Proxy / 裸名上帝对象
- 模型可见输入必须可从 session 事件重建
- presets 无业务逻辑
- 密钥不入库

## 完成定义（切片）

代码 + 测试 +（若改契约）docs/规格同步 + `pnpm check` 绿。

## 文档

- 入口：[docs/README.md](./docs/README.md)
- 能力矩阵：[docs/status.md](./docs/status.md)
- 贡献：[CONTRIBUTING.md](./CONTRIBUTING.md)
