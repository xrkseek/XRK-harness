# example-composer-action

> **读者**：插件作者（XRK Plug · client 金样）

在 `conversation.input.right` 挂一颗演示按钮，读取会话标准工具包：

| Prop | 来源 | 用途 |
|------|------|------|
| `useModelSelection` | `@xrkseek/client-ui-model-selection` | 当前 `provider` / `model` |
| `modelSelectionActions` | 同上 | `available` · `select` · `reload` |
| `useInput` / `inputActions` | `@xrkseek/client-ui-conversation` | 读写草稿 |

点击时在草稿前加 `[optimize via <provider>/<model>] `（本地演示，不调模型）。

## 安装

```bash
xrkh plugin add ./extensions/example-composer-action
```

Settings → 插件 → **重载**。

教科书：[docs/client-plugin-development.md](../../docs/client-plugin-development.md)。

---

# example-composer-action

> **Audience**: Plugin authors (XRK Plug · client gold sample)

Registers a demo button on `conversation.input.right` that reads the session standard kit:

| Prop | Source | Use |
|------|--------|-----|
| `useModelSelection` | `@xrkseek/client-ui-model-selection` | Current `provider` / `model` |
| `modelSelectionActions` | same | `available` · `select` · `reload` |
| `useInput` / `inputActions` | `@xrkseek/client-ui-conversation` | Read / write draft |

Click prefixes the draft with `[optimize via <provider>/<model>] ` (local demo only).

## Install

```bash
xrkh plugin add ./extensions/example-composer-action
```

Settings → Plugins → **Reload**.

Textbook: [docs/client-plugin-development.md](../../docs/client-plugin-development.md).
