# ADR-0001: 宿主仅 TypeScript

> **读者**：维护者 · 贡献者

- **Status:** Accepted
- **Summary:** 宿主仅 TypeScript（Node）。无 Go gateway、无多语言宿主树。Sidecar 可选且不进 core。`sdks/python` 的 `HarnessClient` 只调 HTTP，不是第二宿主。
- **See:** `AGENTS.md` 红线。

---

# ADR-0001: TypeScript-only host

> **Audience**: Maintainers · Contributors

- **Status:** Accepted
- **Summary:** The host is TypeScript (Node) only. No Go gateway and no multi-language host tree. Sidecars are optional and stay out of core. `HarnessClient` in `sdks/python` only calls HTTP; it is not a second host.
- **See:** `AGENTS.md` red lines.
