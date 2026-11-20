# xrk-sunflower-free

> **读者**：终端用户 · 集成者

产品自带的**免费 LLM** 插件（`kind: llm`）。目录里可出现：

| Brand | 说明 | Bun |
|-------|------|-----|
| `sunflower-free` | OpenCode 匿名池候选 | 需要（本机自装 Bun sidecar） |
| （并入上项） | Kilo 免费 listing | 不需要 |

无 Bun 时 OpenCode 线静默省略；Kilo 仍可进目录。

## Bun

产品包**不**随带 Bun。查找顺序：`XRK_SUNFLOWER_BUN` → 插件旁 `vendor/bun*` → `~/.bun/bin/bun` → `PATH`。

## 安装

随 CLI / Desktop 分发；或：

```bash
xrkh plugin add ./extensions/xrk-sunflower-free
```

Settings → 模型 中选用 `sunflower-free` 候选。

---

# xrk-sunflower-free

> **Audience**: End users · Integrators

Built-in **free LLM** plugin (`kind: llm`). Catalog may include:

| Brand | Notes | Bun |
|-------|-------|-----|
| `sunflower-free` | OpenCode anonymous pool | Required (user-installed Bun sidecar) |
| (merged into above) | Kilo free listing | Not required |

Without Bun, the OpenCode path is omitted; Kilo can still appear.

## Bun

The product does **not** ship Bun. Lookup: `XRK_SUNFLOWER_BUN` → plugin-local `vendor/bun*` → `~/.bun/bin/bun` → `PATH`.

## Install

Shipped with CLI / Desktop; or:

```bash
xrkh plugin add ./extensions/xrk-sunflower-free
```

Pick `sunflower-free` candidates under Settings → Models.
