# @xrkseek/client-ui-settings-plugin-inventory

[English](README.md) | 中文

Web / Desktop 设置中的**插件列表**标签页。注册 id 为 `all` 的 `settings.plugins.tab`。激活时不读 Remote；挂载后通过 [`api-remotes`](../../api/remotes/README.md) 懒调用 `ctx.remote.pluginInventory.*`。

本包即产品 **插件 Manager** 面（设置 → 插件 → 插件列表）：安装可选 npm 源 + 结算 `TerminalBlock`、卡片 kind artwork，以及对自定义行 **更新 / 重载 / 停用 / 启用 / 删除 / 打开目录**。搜索与筛选仅本地。注册使用 `ctx.slots.inject()`，跟随 slot 延迟声明与 teardown，无需 import 分区拥有方。

## 模型体验

无。

#### KV Cache 影响

无。

## 已知限制与暂缓事项

- **每次 Settings 挂载或重试一份快照** —— 不订阅 Loader；重新打开 Settings 再读。
- **Client 半部**在安装 / 更新后可能需要硬刷新（有 `needsRestart` 时）。
