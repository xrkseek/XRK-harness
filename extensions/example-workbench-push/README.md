# example-workbench-push

> **读者**：插件作者（XRK Plug · client 金样）

演示浮动工作台如何用 **`ctx.layout.reserveSide` / `reserveBottom`** 让壳让位（整框 `margin-right` + 对话列 `padding-bottom`），**不改 Host、不依赖社区 `layout.css`**。

```bash
xrkh plugin add ./extensions/example-workbench-push
```

Settings → 插件 → **重载**。会话头点 **Yield on** / **Yield off**，确认对话与概况没有被右侧条盖住。

契约：[open-platform.md](../../docs/open-platform.md) · [sidebar-workbench.md](../../docs/sidebar-workbench.md)。

---

# example-workbench-push

> **Audience**: Plugin authors (XRK Plug · client gold sample)

Shows how a floating workbench yields the shell with **`ctx.layout.reserveSide` / `reserveBottom`** (frame `margin-right` + conversation `padding-bottom`) — **no Host patch, no community `layout.css`**.

```bash
xrkh plugin add ./extensions/example-workbench-push
```

Settings → Plugins → **Reload**. Toggle **Yield on** / **Yield off** in the session header and confirm chat / Overview are not covered.

Contract: [open-platform.md](../../docs/open-platform.md) · [sidebar-workbench.md](../../docs/sidebar-workbench.md).
