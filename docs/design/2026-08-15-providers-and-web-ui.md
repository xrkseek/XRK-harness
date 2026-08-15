# Design: providers + DeepSeek Web UI（最强轨）

日期：2026-08-15  
状态：**最强轨锁定 · 实现未开**（用户否决薄实现）  
依据：「全要经典供应商 + DeepSeek UI + 完整学习 + 不要薄实现，要优越最强」

## 目标

1. **供应商：** AGT 级 **Provider Registry**（builtin 协议包 / compat 工厂 / 品牌条目）；非散落 preset 常量。  
2. **Web UI：** MIT 下使用 DeepSeek **完整 client 壳**；本仓实现 **Host Face**（`RpcMethodMap` + 双 WS），UI 尽量不改。  
3. **纪律：** learn 闸门勾选 → 规格 → 计划 → 编码；假适配 / 薄壳禁止。

## 已否决

- 短期薄 React 壳接 REST  
- 逐个改 ui-* 适配 XRK REST  
- 无 `resolve` 单路径的「预设表即产品」  
- Cordis 并入 agent/kernel  

## 方案（锁定）

### UI — 方案 C

```text
Browser: AppWebEntry + Cordis + 全 ui-*  (npm/@deepseek-ai 或 MIT 归因)
    │  POST /api/<rpc>  +  WS events.mux / events.host
    ▼
XRK Host Face  (@xrkseek/… 新包，规格待写)
    │  投影 session_event / latch / tools
    ▼
XRK session + presets + Provider Registry
```

分期 U0→U4：见 [learn/deepseek-web-ui.md](../learn/deepseek-web-ui.md) §4 —— **完整壳始终在**；Face 按契约覆盖加宽。

### 供应商 — Registry

见 [learn/provider-registry.md](../learn/provider-registry.md)。  
BrandEntries 初表仍记在 [llm-provider-presets.md](../llm-provider-presets.md)，但从属 R0，不是薄终点。

## ADR

[ADR-0002](../adr/0002-no-embed-upstream.md) 附录：MIT UI / npm；Cordis 仅浏览器组合；禁第二 agent 内核。

## 成功标准

- UI：完整壳可 settle；主路径对话真接 session；NOTICE/Logo 合规。  
- Face：RpcMethodMap 有显式实现或显式未实现错误（无静默假成功）。  
- Registry：单 `resolve`→`create`；测例锁品牌 URL；官方协议有独立包与 mock。  
- `pnpm check` 绿；契约文档同步。

## 学习闸门（编码前）

- [x] lc17 深读（最强轨）  
- [x] lc18 Provider Registry 深读  
- [x] U0：prompt/mux ↔ session（[learn/u0-prompt-mux-map.md](../learn/u0-prompt-mux-map.md)）  
- [x] 规格：[host-face.md](../host-face.md) · [llm-provider-registry.md](../llm-provider-registry.md)  
- [x] 实现计划：  
  - [Registry R0](../superpowers/plans/2026-08-15-llm-provider-registry-r0.md)  
  - [Host Face U1](../superpowers/plans/2026-08-15-host-face-u1.md)  

## 执行

用户确认后按计划编码。建议顺序：**Registry R0 → Host Face U1**（Face Task 6 依赖 Registry）；Face Task 1–5 可与 Registry 并行。
