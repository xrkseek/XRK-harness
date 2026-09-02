---
name: xrk-models-settings
description: >-
  配置 XRK-Harness 模型：Settings 手动填模型 ID、从提供方获取、对话选模型搜索。
  用户说「加模型」「配 API」「模型列表」「选不到模型」「模型太多」时使用。
---

# 模型设置

**Settings → Models**；密钥在 **Credentials**。

```
- [ ] 1. 提供方 + API 密钥（+ Base URL 若自定义）
- [ ] 2. 添加模型：优先 **添加模型** + ID；可选 **获取可用模型**（默认全选后取消）
- [ ] 3. **保存** 卡片
- [ ] 4. 对话芯片（>5 个有搜索）或 `/model`
```

| 现象 | 处理 |
|------|------|
| 选择器空 | 至少一行模型 ID 且已保存 |
| fetch 失败 | 仍可手填 ID |
| 列表太长 | 芯片搜索 / `/model` |

MCP 工具 → **`xrk-capability-attach`**。
