# @xrkseek/xrk-session-projection

> **读者**：贡献者 · 产品壳客户端。

客户端投影**类型出口**：可声明合并的 `SessionProjectionMap`（以及供 host
声明合并的 `SessionProjectionStateMap`）。本 stub **不**实现 Host 驱动注册表。

## 真源落点

| 层 | 包 |
| --- | --- |
| 驱动注册表 · 双表 · 可选 `wire` | `@xrkseek/session-projection` |
| 默认单元 + mux / history 载体 | `@xrkseek/server-face`（`projections/`） |
| 客户端键类型 | 本 stub + 其它 / apiproxy 的 declare-merge（`turnOutline` · `imageLimits` 等） |

客户端只读 **wire 视图**。Host 折叠状态留在服务端（`stateOf` / checkpoint）。

## 相关

| [docs/modules/session-projection.md](../../../docs/modules/session-projection.md) · [docs/modules/server-face.md](../../../docs/modules/server-face.md) · `@xrkseek/session-projection`
