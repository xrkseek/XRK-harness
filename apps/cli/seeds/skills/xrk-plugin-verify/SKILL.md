---
name: xrk-plugin-verify
description: >-
  Verify an XRK process plugin is loaded: plugin add, restart, inventory,
  when to reinstall after git pull. Use when the user says 「装好了吗」
  「工具看不到」「plugin list」「restart 了吗」.
---

# 插件验证

进程插件**没有**可靠热重载：改完必须进 Host 的 restart 路径，再查 inventory。

```
- [ ] 1. `xrk.plugin.json` 的 id/kind 与 `createPlugin()` 一致
- [ ] 2. `xrkh plugin add <插件目录>`（若尚未登记）
- [ ] 3. `xrkh restart`（或带 `XRK_PLUGINS_DIR` 的 web/serve 重启）
- [ ] 4. `xrkh plugin list` + 新会话里确认工具名出现
- [ ] 5. 仍没有 → 看徽章 / policy deny / 是否装错目录，不要盲加 `--force` 循环
```

## git pull 之后

| 变了什么 | 做什么 |
|----------|--------|
| 仅插件 JS / manifest | **restart** 即可 |
| lock / package.json 依赖 | 先按项目惯例安装依赖，再 restart |
| 只改了无关文件 | 不必 reinstall |

## 反模式

- 改完不 restart 就说「坏了」  
- MCP 问题却按进程插件路径狂 restart（MCP → Settings 行 / **`xrk-capability-attach`**）  
- 无意义 `--force` 杀进程当排障
