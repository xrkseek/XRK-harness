# Learn（维护者）

公开树只保留产品规格与完成度。**基础架构/seams/pipeline/写作纪律以 XRKbar 原文为真源，照搬合并，禁止二次精简创作。**

## 已照搬落点

| 真源 | 本仓 |
|------|------|
| `XRKbar/deepseek-harness/docs/*`（architecture · capability-seams · tool-execution-pipeline · agent-lifecycle · api-gateway · cordis-primer · …） | [`docs/upstream/deepseek-harness/`](./upstream/deepseek-harness/) |
| `XRKbar/deepseek-harness/.agents/skills/dsh-*` | [`.agents/skills/`](../.agents/skills/) |
| 本仓 XRK 树 / ADR / 接线三态 | [`architecture.md`](./architecture.md)（落点+指回）· [`status.md`](./status.md) · [`host-face.md`](./host-face.md) |

## 真源路径

`C:\Users\sunflowerss\Desktop\XRKbar\deepseek-harness`

其它 harness（opencode · cline · goose · OpenHands）与 grocery `XRK-AGT`：产品面/契约参考，不替代 DSH 基础规格。

## 运行时

- **Node ≥ 26**（`.nvmrc` · `package.json` engines · CI）

## Canvas

打磨 · 真源纪律 · RPC：`xrk-harness-polish-learn`  
内部板：`xrk-harness-internal-docs`
