# @xrkseek/exec-computer-use

Desktop computer-use seam: accessibility tree + keyboard/mouse Provider.

Separate from page-level `browser_*` (`@xrkseek/exec-web`).

- **Definition**: `ComputerUseService` (capture AX tree · act · listWindows)
- **Provider**: `createAgentDesktopProvider` (product default; full CLI: session + cursor-overlay + observe/act/windows/wait) · `createMemoryComputerUseProvider` · `createWindowsUiAutomationProvider` (legacy Windows; shells PowerShell internally) · `createBackgroundInputProvider` + `composeBackgroundWithCapture` · Host-injected service
- **Consumer**: `createComputerUseTools` → model tool `computer_use` (full action enum; no bash/`.ps1` required)
- **Registry**: one named Provider at a time (DSH exclusive register)

Product path is **agent-desktop CLI**. Windows UIA (`delivery=uia`) remains available but is not the default — it cannot cover hollow AX apps without models inventing OS scripts. Prefer `focus_window` → `capture mode=vision|som` → `headed=true` click → `clipboard_*` instead. Use `browser_*` for web pages.

See [docs/computer-use.md](../../../docs/computer-use.md) · [docs/seams.md](../../../docs/seams.md).
