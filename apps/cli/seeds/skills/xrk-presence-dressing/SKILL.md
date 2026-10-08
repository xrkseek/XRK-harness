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

| 槽 | 位置 | 内置（引擎 SVG） | 自定义（贴纸导入） |
|----|------|------------------|-------------------|
| hat | 头顶 | bow / cap / beanie / visor / halo | 透明 **SVG 或 PNG** |
| glasses | 眼睛 | specs / specs-rect / specs-cat / specs-sun | 透明 **SVG（优先）或 PNG** |
| held | 右下 | flower / tea / flag / spark | 透明 SVG 或 PNG |

- **内置** = 引擎里画的矢量件（`ball.js`），跟眼球/轮廓锚点逐帧布局，色随球身调色板。
- **导入** = 用户贴纸库（`sticker:stk_…`），同样进 `hatG` / `specsG` / `heldG`，**不是** DOM 绝对定位。
- 导入只落在**当前点的那一槽**。贴图优先于同槽内置件。
- 手持先问要不要内置（小花 / 茶杯 / 小旗 / 火花）。够用就让用户在 **设置 → 通用设置 → 装扮** 点对应块，**不要**再生成。

## Checklist

```
- [ ] 1. 确认槽：hat / glasses / held（一句问清，默认 held=内置）
- [ ] 2. 内置能交差就停（点对应块，勿生成）
- [ ] 3. 自定义：优先手写 SVG → 直接导入（Settings 已接受 SVG）；再栅格 PNG；最后才 image_generate
- [ ] 4. 眼镜槽必读「眼镜贴图构图」；框必须画在 SVG 里
- [ ] 5. 尺寸：hat 256×256；glasses 96×32（或 512×171）；held 方形。文件宜远小于 Face ~80k data URL 上限
- [ ] 6. 把文件落到用户可点的路径，点该槽 **+** 导入；禁止把 data URL / base64 塞进工具参数
- [ ] 7. 若 Host 报贴图过大：再缩小、减路径复杂度，或改用内置
```

## 内置眼镜怎么写（维护者 / 扩容）

内置眼镜**不是资源文件**，是 `apps/web/public/presence/emotion-ball/ball.js` 里的 SVG 节点 + 每帧 `layoutGlasses()`。

### 契约

1. `addSpecsPair(shape)` 往 `specsG` 挂节点，必须带稳定 `data-kit`：
   - `lens-L` / `lens-R`（`data-kit-role="lens"`）— ellipse | rect | path(cat)
   - `bridge`、`temple-L`、`temple-R`（`data-kit-role="frame"`）— **仅内置**调用 `addSpecsFrame()`
2. `layoutGlasses()` 用双眼 slot（`eyeL.slot` / `eyeR.slot`）写几何：镜片跟眼距，鼻梁/镜腿跟两侧。
3. `paintKit()` 按 `data-kit-role` 刷调色板（`frame` / `lens`；`specs-sun` 用 `lensSun`）。
4. 形状入口：`specsShapeOf(kitGlasses)` → `round` | `rect` | `cat`（`specs` 与 `specs-sun` 都是 round，墨镜只换镜片填充）。

### 新增一副内置眼镜（四处同批）

1. `packages/client/ui-plan/src/presence-settings.ts` → `PRESENCE_GLASSES_KITS`（及 Face `GLASSES_BUILTINS` / workspace `GLASSES_BUILTINS`）
2. `PresenceKitMark.tsx` 加 Settings 缩略图
3. `ball.js`：`specsShapeOf` / `addSpecsPair` 支持新 shape（若需要）
4. 同步 `apps/site/public/presence/emotion-ball/ball.js`，bump `PRESENCE_BALL_REV`（`PresenceBall.tsx` + `CompanionBall.tsx`）

帽 / 手持同理：`fillHat` / `fillHeld` 建件，`layoutHat` / `layoutHeld` 锚点；列表在 `PRESENCE_HAT_KITS` / `PRESENCE_HELD_KITS`。

### 与贴纸的分工

| | 内置 | 贴纸导入 |
|--|------|----------|
| 形态 | 引擎 path/ellipse，可跟调色板 | 用户 SVG/PNG，引擎只缩放布局 |
| 扩展 | 改代码发版 | Settings / Team **+** 即时 |
| 眼镜跟眼 | 双镜片分别锚左右眼 | **半幅**分别锚左右眼（同 `layoutSpecsLens`） |
| 鼻梁 / 镜腿 | 引擎 `addSpecsFrame` 画黑杠 | **引擎不画**；必须画在 SVG 里 |

用户说「做一副像自带那样的」→ **先推内置**；要独特造型 → **导 SVG 贴纸**，构图遵守下节。

## 优先：代码生成贴纸（更适配引擎）

引擎贴纸层吃 **data URL**（`image/svg+xml` 或 `image/png` 等）。

**推荐路径**：

1. 手写 **SVG**（仅道具、透明底、正确宽高比）→ 直接点 **+** 导入
2. 若必须 PNG：`rsvg-convert` / Inkscape / 浏览器离屏；目标通常 **&lt; 30KB**
3. 仅当用户要「照片级 / 复杂材质」且接受可能超限时，再走 `image_generate`

## 眼镜贴图构图（最容易画错的一槽）

贴纸眼镜名义框 **96×32**：引擎裁成左右半幅（`viewBox` 左 `0 0 48 32` / 右 `48 0 48 32`），**各跟一只眼**缩放（`STICKER_SPEC_BOOST` 略大于内置）。

> 建议 `viewBox="0 0 96 32"`；`width="512" height="171"` 亦可（同比例）。

### 硬规则（贴纸）

1. **框在 SVG 里**：鼻梁短 stub、镜腿短 stub、镜框描边都画进文件。引擎**不会**再叠黑色 bridge/temple。
2. **半幅铺满**：每只镜片主体约占该半幅 **≥85%** 宽高（少留白）。留白过大会显得「镜片贴在眼睛中间很小」。
3. **中线分工**：左半只画左片（+ 内侧 stub 可贴到 x≈46）；右半只画右片（+ 内侧 stub 从 x≈50）。跨中线的长鼻梁会被裁成两截，**不要指望引擎把它们接起来**——两眼间距由布局决定，用**短内侧 stub + 外缘镜腿**即可，或干脆不要鼻梁、只靠框色统一。
4. **颜色自带**：描边用你想要的颜色（粉框、金框…），不要依赖引擎调色板。
5. **半透明镜片**：眼睛仍要能看清。

### 好构图清单

| 项 | 要求 |
|----|------|
| 构图 | 完整一副，左右各一只镜片各占半幅 |
| 宽高比 | **扁而宽，约 3:1**（`96×32`） |
| 主体 | 每只镜片在半幅内几乎贴边；纵向居中 |
| 鼻梁 | 每半内侧各一小段 stub（同色框），或省略 |
| 镜腿 | 左右外缘各一小段（同色框） |
| 内容 | 只有镜框与镜片（可加点高光/角饰） |
| 禁止 | 方形画布、只画一只镜片、大面积空边、依赖引擎黑杠 |

### 最小可用模板（可直接导入）

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="512" height="171" viewBox="0 0 96 32">
  <!-- LEFT half 0-48: fill most of the half -->
  <ellipse cx="24" cy="16" rx="20" ry="13"
    fill="rgba(255,180,200,0.28)" stroke="#E89BB0" stroke-width="2.6"/>
  <path d="M42 16 H47" fill="none" stroke="#E89BB0" stroke-width="2.2" stroke-linecap="round"/>
  <path d="M4 16 H1" fill="none" stroke="#E89BB0" stroke-width="2.2" stroke-linecap="round"/>
  <!-- RIGHT half 48-96 -->
  <ellipse cx="72" cy="16" rx="20" ry="13"
    fill="rgba(255,180,200,0.28)" stroke="#E89BB0" stroke-width="2.6"/>
  <path d="M54 16 H49" fill="none" stroke="#E89BB0" stroke-width="2.2" stroke-linecap="round"/>
  <path d="M92 16 H95" fill="none" stroke="#E89BB0" stroke-width="2.2" stroke-linecap="round"/>
</svg>
```

帽 / 手持示例保持简洁：透明底、主体居中；held 主体可略偏右下。贴纸手持引擎会略放大。

## `image_generate`（仅复杂贴图兜底）

只画**一件道具**，透明底，**不要**球身、人脸、场景。

- hat：主体居中，四周 ≥15% 空边
- glasses：3:1 扁宽，双镜片，**框色画进图**（引擎不补黑杠）
- held：主体偏右下，主体够大

`n=1`。禁止把 `data:image/…;base64,…` 贴进工具参数。

## 导入

1. **设置 → 通用设置**：帽 / 眼镜 / 手持三行，点该行 **+** 选 **SVG / PNG / WebP / GIF / JPEG**
2. 或 **概况 → 工作区 → Agent Team** 成员编辑里同样的三行 +

Face 只接受约 **80_000** 字符的 data URL。SVG 通常一次过；模型图过大时缩到 128–256、少渐变。

## 反模式

| 反模式 | 正确做法 |
|--------|----------|
| 默认就 `image_generate` | 先内置，再 SVG 贴纸，再 PNG，最后才模型图 |
| 把生成图当帽/眼镜/手持共用 | 只导入用户指定的那一槽 |
| 工具参数里贴 base64 | 落盘 → 用户点 + |
| 手持还去生成小花 | 点内置「小花」 |
| 画整个吉祥物 | 只画透明道具 |
| 眼镜用方形构图 / 只画一只镜片 | 3:1 扁宽，两只镜片都在画布内 |
| 半幅里镜片很小、四周大空边 | 镜片铺满半幅 ≥85% |
| 指望引擎补黑色鼻梁/镜腿 | 贴纸框必须画在 SVG 里 |
| 贴图导入后位置歪了就去调 CSS | 位置由引擎按锚点算；构图不对就重画 |
| 把贴纸当「新内置」写进产品发版 | 贴纸走用户库；新内置走四处同批清单 |

## 引擎契约（改底层时看这里）

- 三槽贴图：`EmotionBall.create(..., { hatImage, glassesImage, heldImage })`，
  或 `ball.setDressing(hat, glasses, held, { hat, glasses, held })`（第四参字符串 = 旧 held）。
- 贴图优先于同槽内置件。
- `ball.setKit('cap')` 会**清空三槽贴图**。
- 三张图分别进 SVG 的 `hatG` / `specsG` / `heldG`，继承 `bodyG` 变换。
- 锚点：`layoutHat()` 轮廓顶边；`layoutGlasses()` 双镜片各跟一只眼（贴纸先裁成左右半幅 data URL，再共用 `layoutSpecsLens`，`STICKER_SPEC_BOOST`）；贴纸**不**调用 `addSpecsFrame`；`layoutHeld()` 右侧约 78% 高（贴纸略放大）。
- 改 `ball.js` / `engine.js` 后同步 `apps/site/public/presence/emotion-ball/`，并 bump `PRESENCE_BALL_REV`。
