---
name: xrk-presence-dressing
description: >-
  Generate and import companion costume overlays (hat / glasses / held). Prefer
  built-in kits, then code-drawn transparent SVG (import as sticker) over raster
  image_generate. Use when the user says 装扮、帽子、眼镜、手持、贴图、换装、小花、
  Presence overlay, or asks to draw a costume for the ball.
---

# Presence dressing overlays

Companion 装扮有三槽，**不要混槽**：

| 槽 | 位置 | 内置 | 自定义（贴纸导入） |
|----|------|------|-------------------|
| hat | 头顶 | bow / cap / beanie / visor / halo | 透明 SVG 或 PNG |
| glasses | 眼睛 | specs / specs-rect / specs-cat / specs-sun | 透明 SVG（优先）或 PNG |
| held | 右下 | flower / tea / flag / spark | 透明 SVG 或 PNG |

- 导入只落在**当前点的那一槽**。贴图优先于同槽内置。
- 手持先问内置（小花 / 茶杯 / 小旗 / 火花）。够用 → **设置 → 通用设置 → 装扮** 点对应块，**不要**再生成。

```
- [ ] 1. 确认槽：hat / glasses / held（一句问清，默认 held=内置）
- [ ] 2. 内置能交差就停
- [ ] 3. 自定义：手写 SVG → 导入；再 PNG；最后才 image_generate
- [ ] 4. 眼镜槽：框必须画在 SVG 里（见下）
- [ ] 5. 尺寸：hat 256×256；glasses 96×32（或 512×171）；held 方形；远小于 ~80k data URL
- [ ] 6. 文件落到用户可点路径，点该槽 **+**；禁止把 base64 塞进工具参数
- [ ] 7. 报过大 → 缩小 / 减路径 / 改用内置
```

## 贴纸路径

1. 手写 **SVG**（仅道具、透明底、正确宽高比）→ 点 **+** 导入  
2. 须 PNG：目标通常 &lt; 30KB  
3. 仅「照片级 / 复杂材质」且接受可能超限 → `image_generate`

## 眼镜贴图（易错）

名义框 **96×32**（约 3:1）；引擎裁左右半幅各跟一只眼。

1. **框在 SVG 里**（鼻梁 stub、镜腿 stub、描边）——引擎不补黑杠  
2. 每只镜片约占该半幅 **≥85%**  
3. 左半只画左片、右半只画右片；短内侧 stub，勿指望跨中线长鼻梁被接上  
4. 颜色自带；镜片半透明，眼睛仍可见  

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="512" height="171" viewBox="0 0 96 32">
  <ellipse cx="24" cy="16" rx="20" ry="13"
    fill="rgba(255,180,200,0.28)" stroke="#E89BB0" stroke-width="2.6"/>
  <path d="M42 16 H47" fill="none" stroke="#E89BB0" stroke-width="2.2" stroke-linecap="round"/>
  <path d="M4 16 H1" fill="none" stroke="#E89BB0" stroke-width="2.2" stroke-linecap="round"/>
  <ellipse cx="72" cy="16" rx="20" ry="13"
    fill="rgba(255,180,200,0.28)" stroke="#E89BB0" stroke-width="2.6"/>
  <path d="M54 16 H49" fill="none" stroke="#E89BB0" stroke-width="2.2" stroke-linecap="round"/>
  <path d="M92 16 H95" fill="none" stroke="#E89BB0" stroke-width="2.2" stroke-linecap="round"/>
</svg>
```

帽 / 手持：透明底、主体居中；held 可略偏右下。

## `image_generate`（兜底）

只画**一件道具**，透明底，不要球身/人脸/场景。`n=1`。禁止把 `data:image/…;base64,…` 贴进工具参数。

## 导入

**设置 → 通用设置** 三行 **+**，或 Agent Team 成员编辑同三行。SVG 通常一次过；过大则缩到 128–256、少渐变。

## 反模式

| 反模式 | 正确做法 |
|--------|----------|
| 默认 `image_generate` | 内置 → SVG → PNG → 模型图 |
| 一张图当三槽用 | 只导入指定槽 |
| 工具参数贴 base64 | 落盘 → 用户点 + |
| 手持还生成小花 | 点内置「小花」 |
| 画整个吉祥物 | 只画透明道具 |
| 眼镜方形 / 单片 / 大留白 | 3:1、双片、半幅 ≥85% |
| 指望引擎补黑框 | 框画进 SVG |
| 位置歪了去调 CSS | 重画构图 |
