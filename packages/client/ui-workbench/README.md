# @xrkseek/client-ui-workbench

First-party floating workspace workbench: Host `/sidebar/*` file tree + text/image/pdf preview.

## Product cut

| Surface | Owner |
|---------|--------|
| In-flow `details` column | Status (`@xrkseek/client-ui-plan`) |
| Rich explorer / terminal / browser / git | Community **`xrkh-better-sidebar`** |
| Builtin fallback panel | This package (`ctx.workbench` + `shell.overlay`) |

When `ctx.betterSidebar` is present, the builtin panel yields and `workbench.openPath` returns false so chat `openFile` falls through to `workspaces.openPath` (community wrap).

See [docs/sidebar-workbench.md](../../../docs/sidebar-workbench.md).
