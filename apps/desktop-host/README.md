# `@xrkseek/harness-desktop-host`

> **读者**：维护者 · 贡献者  
> **Audience**: Maintainers · Contributors

私有 **上游 Node** Desktop Host 子进程入口（workspace `apps/desktop-host`）。**`private: true`**，不进公共 npm。

## 已接线

- 入口：`node dist/index.js <projectDir>`（Electron `DesktopHostProcess` 同源约定）
- 组合：`createHostManager` + `createServerAgentFactory`（`listen: false`，无 TCP 监听）
- 能力位：启动时设 `XRK_NATIVE_OPEN=1`，复用 Face `host.openPath` / `host.pickDirectory`（`host.describe.canOpenPath: true`）
- 数据面：fd 3/4 分帧管道 → `http.fetch`；IPC 仅 `ready` / `fatal` / `shutdown`
- **禁止** Cordis boot / overlay（[ADR-0002](../../docs/adr/0002-no-embed-upstream.md) · [ADR-0008](../../docs/adr/0008-desktop-shell-private-host.md)）

产品 Desktop 在 [status.md](../../docs/status.md) 仍为 **未做**（壳 + Host 入口可测 ≠ Electron 整包可跑）。

---

Private **upstream-Node** Desktop Host child entry (workspace `apps/desktop-host`). **`private: true`** — not on public npm.

## Wired

- Entry: `node dist/index.js <projectDir>` (same contract as Electron `DesktopHostProcess`)
- Composition: `createHostManager` + `createServerAgentFactory` (`listen: false`, no TCP listen)
- Capabilities: sets `XRK_NATIVE_OPEN=1` and reuses Face `host.openPath` / `host.pickDirectory` (`host.describe.canOpenPath: true`)
- Data plane: framed pipes on fds 3/4 → `http.fetch`; IPC is `ready` / `fatal` / `shutdown` only
- **Forbidden:** Cordis boot / overlay ([ADR-0002](../../docs/adr/0002-no-embed-upstream.md) · [ADR-0008](../../docs/adr/0008-desktop-shell-private-host.md))

Product Desktop remains **Not done** in [status.md](../../docs/status.md) (testable Host entry ≠ full Electron package).
