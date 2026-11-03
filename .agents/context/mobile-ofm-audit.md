# 手机 APP 前：事件链 + OFM + UIUX 审计备忘

> **读者**：维护者 · Coding Agent（笔记，不进教科书）  
> **日期**：2026-11-01 · 对照计划 `mobile_ofm_ux_fixes` + 全量再审后切 **0.7.5**

## 闸门结论（一览）

| 块 | 结论 | 改码 |
|----|------|------|
| 事件链「假卡住」 | 「已重试模型请求 (n/30)」= Host `llm/retry`（max 30），非 mux 死线 | **否** |
| OFM Cordis / Face sync | 双车道恒定进 Face；channel-pack 按「已登录且凭据可解析」动态放行 | **是**（0.7.5 · `ofmFaceSyncGate`） |
| 安装后热加载 | Market / Settings install·update 曾只落盘 | **是** → `liveApplyHostPackageByName` / `applyHostHalf` |
| Boot 阻塞 | listen 先；sunflower / OFM poll 在 listen 后 | **否** |
| 添加模型 sheet 空白 | Modal 全屏 sheet + `candidateList` `max-height: 360` 留下空白带 | **是** → 手机改 `calc(100dvh - 14rem)` |
| 键盘贴底 | overlay inset 有 vv 路径；`resizes-content` 缩 clientHeight 时 RO 未观察 scrollport | **是** → RO 观察 scrollport，atBottom 且高度缩则 re-pin |
| qoder 进免费列表 | Face `shouldSyncProvider` = 双车道 + 凭据可解析的 channel-pack provider | **是**（0.7.5） |

---

## 1. 事件链

路径：provider → `invokeLlmWithRetry` → session `llm/retry` → Face projection → mux → 壳 `conversation-nodes/retry`。

- Host 仍 retry → 记上游/策略，不改 mux / 不降 30。
- 未见「`turn/end` 已到而壳永久 retry」钉死证据。

## 2. OFM 底层

- `tryApplyOurFreeModelHost` + `distribution: managed`
- `waitForOfmForwardThenSync` ~10s；超时仍 `requestSync`
- channel-pack HTTP/RPC 可挂；模型进 ModelSelect 的条件 = 账号 `enabled` 且 `credentialRef` 在凭据 store 里有值（`ofmFaceSyncGate`，1s TTL；空车道不进轮询）
- 凭据 store 按**包名**分目录（`community-credentials/<safePkg>/store.json`）；换 scope/改名 = 老 token 全部失联，表现为「账号在列表里但模型为空」
- Registry 同 key 只 compose 一次

## 3. 热加载（本轮代码）

- Settings install/update/enable：`applyCordisHostHalves`（去重）
- Market：`liveApplyHostPackageByName`；**mutate 目标 `pluginsDir` 写入 applyCtx**（避免 ctx 无 pluginsDir → 假 skipped）
- uninstall → `stopHostPackage`；仅 `failed` → `restartRequired`
- `!contribution && !fiber` → `failed`（防空成功）

## 4. Boot 时间线

```text
t0  HTTP listen
t0+ Desktop deferManagedPlugins / 非 desktop 已 await 进程插件
t0+ warmup: sunflower AWAIT_PROBE + prewarmDshCompat + OFM forward poll 0–10s
t+  Face 品牌可能晚到；status GET nudge 至 settled
```

## 5. UIUX（手机 + 常规）

| 项 | 证据 | 处置 |
|----|------|------|
| fetchDialog 空白 | `ModelsSection.module.css` `.candidateList` 360px vs Modal phone `height:100%` | 手机抬高 max-height |
| 键盘 unpin | ChatView RO 只 observe column/composer；shrink clientHeight 无 scrollHeight growth | observe scrollport + shrink re-pin |
| 流式卡住文案 | Host retry chrome | 不改 |
| qoder | Face 白名单已改按凭据动态放行 | 0.7.5 修复 |

桌面宽屏 Modal 仍用 360px 帽，属正常卡片密度，不强制撑满。

## 6. `model "X" not found` = OFM forward 自己拒的（2026-11-01）

- 文案出处 `dsh-our-free-model/src/core/completion.js:37-40`：
  `entry === undefined || !routableModelIds(snapshot).has(entry.id)` → 404。
  **不是上游**，请求没离开本机；上游错误不会带这个形状。
- `routableModelIds` = `membership['our-free-model']` ∪ `membership['our-free-model-region']`
  （`exposeRegionModels !== false` 时）；`computeMembership` 只剔 `unavailable` 和 hidden，
  且 forward 的 `state()` 已把 `hiddenModelIds/hideFreeModels/hideEacModels` 强制关掉
  （"Hiding advertisements must not invalidate requests using a saved id"）。
- 根因是列表/路由漂移：`adapter.listModels` 与 forward 的 `state()` 各算一次 membership，
  catalog 重建（登录落地、aggregate 编辑、探测轮）后两边可能不同步 → 选择器有、调用 404。
- 处置：`our-free-model-host.ts` 每次 Face sync 前读 `/api/our-free-model/summary` 的
  `models`（插件自己的 `publicModelRows()`，与调用同一判断），只发布 forward 能路由的 id；
  读不到（forward 未起 / 名单为空）就不过滤，绝不清空选择器。
- 取证：`curl -s http://127.0.0.1:$port/v1/models -H "Authorization: Bearer $forwardKey"`
  （`port` = `~/.xrk/our-free-model/settings.json` 的 `forward.actualPort`，`forwardKey` 同文件）。
- 别被名字骗：`qfmodel` / `gfmodel` / `dfmodel` / `cmodel` 是 channel-pack 的内部 id
  （Qwen3.8-Flash / GLM-5.3-Flash / DeepSeek-Flash / Cantus），出现在 vendor `pack.js`，
  不在 Host 仓库里 grep 得到。

## 7. 三处 dressing 列表必须一致（2026-11-01）

| 位置 | 常量 | 用途 |
|---|---|---|
| `packages/server/face/src/presence-dressing.ts` | `*_BUILTINS` | Host 白名单（权威） |
| `packages/client/ui-plan/src/presence-settings.ts` | `PRESENCE_*_KITS` | 概况球 runtime（`parseSlotPick` / `resolveEnginePick`） |
| `packages/client/ui-workspace/src/client/dressing-library.ts` | `*_BUILTINS` | 干员团队 picker |

缺一处 = 能选、能显示选中、能存进 Host，但概况球读回时被 `parseSlotPick` 丢成 `none`。
`brand-xrk` 就是这么栽的（20 项 vs 19 项）。守：`apps/web/tests/presence-dressing-parity.test.ts`。

向日葵（`mem_seed_xrkseek`）的外观由 seed 每次覆盖（只有经理 `mem_seed_manager` 是用户可编辑，
见 `isCatalogAppearanceEditableId`），所以改 seed 默认值对所有存量设备立即生效。
