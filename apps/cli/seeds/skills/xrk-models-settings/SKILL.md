---
name: xrk-models-settings
description: >-
  Configure XRK-Harness models: add model IDs in Settings, fetch from provider,
  pick/search in the chat chip. Use when the user says 「加模型」「配 API」
  「模型列表」「选不到模型」「模型太多」.
---

# 模型设置

**Settings → Models**；密钥在 **Credentials**。对话切换用模型芯片或 `/model`。

```
- [ ] 1. 提供方 + API 密钥（自定义需 Base URL）
- [ ] 2. 添加模型：优先手填模型 ID；可选「获取可用模型」（默认全选后按需取消）
- [ ] 3. **保存** 卡片（未保存 = 选择器仍空）
- [ ] 4. 对话芯片选择（>5 个可搜索）或 `/model provider/model`
```

## 排障

| 现象 | 处理 |
|------|------|
| 选择器空 | 至少一行模型 ID **且已保存** |
| fetch 失败 | 仍可手填 ID；查密钥 / Base URL / 代理 |
| 列表太长 | 芯片搜索或 `/model` |
| 要的是 MCP 不是模型 | **`xrk-capability-attach`** |

## 反模式

- 把 API key 写进聊天、skill、AGENTS  
- 未保存就反复切换芯片排障  
- 用改工作区文件代替 Settings / Credentials
