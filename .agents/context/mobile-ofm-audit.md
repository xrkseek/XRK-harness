# 手机 APP 前：事件链 + OFM + UIUX 审计备忘

> **读者**：维护者 · Coding Agent（笔记，不进教科书）  
> **日期**：2026-11-01 · 对照计划 `mobile_ofm_ux_fixes` + 全量再审后切 **0.7.5**

## 闸门结论（一览）

| 块 | 结论 | 改码 |
|----|------|------|
| 事件链「假卡住」 | 「已重试模型请求 (n/30)」= Host `llm/retry`（max 30），非 mux 死线 | **否** |
| OFM Cordis / Face sync | 仅双车道进 Face；channel-pack 故意不同步 | **否**（不扩白名单） |
| 安装后热加载 | Market / Settings install·update 曾只落盘 | **是** → `liveApplyHostPackageByName` / `applyHostHalf` |
| Boot 阻塞 | listen 先；sunflower / OFM poll 在 listen 后 | **否** |
| 添加模型 sheet 空白 | Modal 全屏 sheet + `candidateList` `max-height: 360` 留下空白带 | **是** → 手机改 `calc(100dvh - 14rem)` |
| 键盘贴底 | overlay inset 有 vv 路径；`resizes-content` 缩 clientHeight 时 RO 未观察 scrollport | **是** → RO 观察 scrollport，atBottom 且高度缩则 re-pin |
| qoder 进免费列表 | Face `shouldSyncProvider` 仅 OFM 双车道 | **否**（产品设计） |

---

## 1. 事件链

路径：provider → `invokeLlmWithRetry` → session `llm/retry` → Face projection → mux → 壳 `conversation-nodes/retry`。

- Host 仍 retry → 记上游/策略，不改 mux / 不降 30。
- 未见「`turn/end` 已到而壳永久 retry」钉死证据。

## 2. OFM 底层

- `tryApplyOurFreeModelHost` + `distribution: managed`
- `waitForOfmForwardThenSync` ~10s；超时仍 `requestSync`
- channel-pack HTTP/RPC 可挂，不进 ModelSelect
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
| qoder | Face 白名单 | 不改 |

桌面宽屏 Modal 仍用 360px 帽，属正常卡片密度，不强制撑满。
