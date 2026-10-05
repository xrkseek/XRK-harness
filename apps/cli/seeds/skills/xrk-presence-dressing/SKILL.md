---
name: xrk-presence-dressing
description: >-
  Generate and import companion costume overlays (hat / glasses / held) with
  image_generate, then the Settings or Agent Team plus tile. Use when the user
  says 装扮、帽子、眼镜、手持、贴图、换装、小花、Presence overlay, or asks to
  draw a costume for the ball.
---

# Presence dressing overlays

Companion 装扮有三层，**不要混槽**：

| 槽 | 位置 | 内置 | 自定义 |
|----|------|------|--------|
| hat | 头顶 | bow / cap / beanie / visor / halo | 透明 PNG 贴图 |
| glasses | 眼睛 | specs / specs-rect / specs-cat / specs-sun | 透明 PNG |
| held | 右下 | flower / tea / flag / spark | 透明 PNG |

导入只落在**当前点的那一槽**。帽子贴图不会出现在眼镜或手持行。

手持先问要不要内置（小花 / 茶杯 / 小旗 / 火花）。够用就让用户在 **设置 → 通用设置 → 装扮** 点对应块，**不要**再生成。

## Checklist

```
- [ ] 1. 确认槽：hat / glasses / held（一句问清，默认 held=内置）
- [ ] 2. 内置能交差就停；自定义才 `image_generate`
- [ ] 3. `size=256x256`（或 512）；禁止把 data URL / base64 塞进工具参数
- [ ] 4. 聊天气泡出图后，让用户把 PNG 存下来，点该槽的 **+** 导入
- [ ] 5. 若 Host 报贴图过大：再生成更小、更少细节的透明贴纸，或改用内置
```

## `image_generate` 提示（自定义贴图）

只画**一件道具**，透明底（或纯色底后期抠），**不要**球身、不要人脸、不要场景。

- hat：顶视偏正面的帽/饰，居中，四周留空
- glasses：一副眼镜，横向居中
- held：单件手持物，主体偏画布右下，左侧留空

示例 prompt：

```
A single small pink flower on a transparent background, sticker, no character, no shadow, centered, PNG overlay for a round mascot, 256x256
```

`n=1`。结果走附件 id；需要再看用 `read_image file_path=sha256:…`。  
**禁止**把 `data:image/…;base64,…` 贴进 `image_generate` / `settings_mutate` 参数（会截断或超过 80k 上限）。

## 导入

1. **设置 → 通用设置**：帽 / 眼镜 / 手持三行，点该行 **+** 选刚才的 PNG  
2. 或 **概况 → 工作区 → Agent Team** 成员编辑里同样的三行 +  

Face 只接受约 **80_000** 字符的 data URL。生成图太大时：缩小到 128–256、去背景、少渐变；或改用内置手持。

不要用 `settings_mutate` 手写整段 base64 `stickers` JSON，除非用户明确要求且图已经很小。

## 反模式

| 反模式 | 正确做法 |
|--------|----------|
| 把生成图当帽/眼镜/手持共用 | 只导入用户指定的那一槽 |
| 工具参数里贴 base64 | 聊天出图 → 用户点 + |
| 手持还去生成小花 | 点内置「小花」 |
| 画整个吉祥物 | 只画透明道具 |
