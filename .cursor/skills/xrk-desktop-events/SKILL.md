---
name: xrk-desktop-events
description: >-
  Web vs Desktop Face event carriers (mux/host SSE·WS). Use when fixing
  stale Settings/MCP badges, subagent header/Overview lag, host/remote-event,
  or editing WebApiClient / connection on xrk-app://.
disable-model-invocation: true
user-invocable: false
---

# 笔记 · Web / Desktop 事件通道

教科书：[docs/host-face.md](../../../docs/host-face.md)「Web / Desktop 载波」。  
红线：`.cursor/rules/xrk-desktop-events.mdc`。

## 两路总线（Face 真源，壳无关）

| 总线 | 路径 | 典型帧 | 壳消费 |
|------|------|--------|--------|
| **mux** | `/api/events.mux` | `session/event` · `session/projection` · `session/jobs` · approvals/questions | SessionManager 对话轨 |
| **host** | `/api/events.host` | `host/session-added|status|removed` · workspace-* · **`host/remote-event`** | Session/Workspace + `ctx.remote.$dispatch` |

`host/remote-event` 白名单见 Face `publishRemoteEvent`（含 `settings/document-updated` · `credentials/updated` · `agent-preset/selected` …）。  
Runtime 桥：`packages/client/runtime` `onHostEnvelope` → `$dispatch(event, args)`。

## 载波怎么开（壳有关）

| 壳 | Unary | mux | host |
|----|-------|-----|------|
| **Web**（http/https） | `fetch` 同源 | **WebSocket** | **WebSocket** |
| **Desktop**（`xrk-app:`） | `fetch` → `xrk-app://app` | **SSE** → `xrk-app://stream` | **SSE** → `xrk-app://stream` |

实现：`packages/client/connection/src/client/web-api-client.ts`  
- `resolveStreamBase()` → Desktop 用 `xrk-app://stream`（与 unary `app` **分 Chromium 连接池**）  
- `describeBeforeStreams`：Desktop 默认先 unary `host.describe` 再开 SSE（`connection/index.ts`）  
- **禁止**把 host 换成空 placeholder：会吞掉全部 host 帧

## 症状 → 根因

| 症状（仅 Desktop / 刷新才好） | 常见根因 |
|------------------------------|----------|
| MCP「连接中」卡住；Settings 不跟 overlay | `settings/document-updated` 未到 → host SSE 断 / 被 stub |
| 子代理顶栏 chip / Overview 要切会话才更新 | `host/session-added` · `host/session-status` 未到 |
| 会话列表 / workspace 帧延迟 | 同上 host 总线 |

mux 正常 ≠ host 正常。改 Desktop 载波时两路都要测。

## 改码清单

1. 动 `WebApiClient.openHost` / `openMux` / `resolveStreamBase` → 同步改 `web-api-desktop.test.ts` · `face-transport.regression`（mux **与** host SSE + unary 并存）。  
2. 动 `host/remote-event` 白名单 → Face `remote-event.ts` + 壳 `$on` 订阅方。  
3. Settings 热更新依赖 host 事件触发 `SettingsScope.load()`；overlay 风暴靠 scope coalesce（勿再 stub host）。  
4. 乐观 `handleRunning(true)` 只补 turn 竞态，**不能**替代 host/session-* 做目录/Overview。

## 勿做

- Desktop `openHost` 返回永不 yield 帧的 placeholder  
- 把 host 帧硬塞进 mux（除非另开 ADR）  
- 在教科书写 Cursor helper / 本机盘符  
- 用「切会话 / 刷新」当产品方案掩盖断流  

## 测

- `packages/client/connection/tests/web-api-desktop.test.ts`  
- `apps/desktop-host/tests/face-transport.regression.test.ts`（mux **与** host SSE + unary）  
- `apps/desktop/scripts/smoke-packaged-host.mjs`（打包门禁：双 SSE 并存不饿死 `host.describe`）  
- `packages/client/runtime/tests/wire-events.client.spec.ts`（`$dispatch` 桥）  
- 手工：Desktop 安装包开 Settings MCP 连线 + 开子代理看顶栏/Overview **无需刷新**
