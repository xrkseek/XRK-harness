# ADR-0002: Do not embed upstream source trees

- **Status:** Accepted（附录 2026-08-15）
- **Summary:** 不并入 Cordis / deepseek-harness / cline / opencode **agent 运行时** 源码树。调研取精华，规格与自研实现进本仓。
- **See:** `AGENTS.md` 参考优先级 · [learn/deepseek-web-ui.md](../learn/deepseek-web-ui.md) · [learn/cordis.md](../learn/cordis.md)（完整学透 · 不并核） · [design/2026-08-15-providers-and-web-ui.md](../design/2026-08-15-providers-and-web-ui.md)

## Appendix A — MIT UI / npm（允许）

在不把上游 **运行时** 当作本仓第二内核的前提下，允许：

1. **归因移植** DeepSeek Harness Web UI（MIT）：本仓 `apps/web` 可复制/改编壳层代码，须保留 Copyright DeepSeek 与许可声明（NOTICE / 文件头）。
2. **npm 依赖** 公开的 `@deepseek-ai/*`（或等价 MIT 包），并在仓库 NOTICE 中列出。
3. 自研 **适配层** 将本仓 HTTP/session 接到上游 UI 期望的协议形状。

仍禁止：

- 无声明整树 vendor 上游 agent/kernel/Cordis，冒充自研内核；
- 让 `core*` / `kernel` 依赖上游运行时包；
- 用「UI 移植」名义把 Host ACP/RPC 整面替换成本仓未规格化的第二协议而不写文档。
