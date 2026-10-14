# @xrkseek/exec-computer-use

Desktop computer-use seam: accessibility tree + keyboard/mouse Provider.

Separate from page-level `browser_*` (`@xrkseek/exec-web`).

- **Definition**: `ComputerUseService` (capture AX tree · act · listWindows)
- **Provider**: `createMemoryComputerUseProvider` · `createWindowsUiAutomationProvider` (opt-in `XRK_COMPUTER_USE=1` on Windows) · `createBackgroundInputProvider` + `composeBackgroundWithCapture` (act via helper, capture/list via UIA on Windows) · Host-injected service
- **Consumer**: `createComputerUseTools` → model tool `computer_use`
- **Registry**: one named Provider at a time (DSH exclusive register)

Delivery on Windows UIA is **uia** (Invoke / ValuePattern / SendKeys / ScrollPattern). `mode=background` prefers helper act with UIA capture (DSH background-delivery posture), not cua-driver MCP. Tools stay registered when no Provider is configured; execute fails honestly (same pattern as LSP). Use `browser_*` for web pages; reserve `computer_use` for native desktop apps.

See [docs/computer-use.md](../../../docs/computer-use.md) · [docs/seams.md](../../../docs/seams.md).
