# @xrkseek/compose

可逆 effect · 依赖 inject · Ordering · isolate — 显式 TS 叶包（无 Proxy）。

## Public API

- `createRootScope`
- `Scope.depend` / `activate` / `whenReady`
- `provide` / `inject` / `tryInject`
- `interceptInject` · `openSubagentRealm`
- `effect` · `child` · `dispose`
- `bindDisposable`

## Host（C1）

`createHostAgentCache`：session agent 依赖 `host.plugins`；`invalidate` / `stop` 按 Ordering 卸装。

## Status

- C0 叶包 · C1 Host agent-cache：**能跑**
- C2 intercept + `openSubagentRealm`：**能跑**；Host 对子会话打开 realm（不负责 Face 登记）

## Non-goals

- Proxy 上帝对象 · HMR  
- session / agent-loop 语义（由 core* 拥有）

## Spec

[docs/compose.md](../../docs/compose.md) · [ADR-0005](../../docs/adr/0005-compose-leaf.md)
