# @xrkseek/compose

可逆 effect · 依赖 inject · Ordering · isolate — 显式 TS 叶包（无 Proxy）。

## Public API

- `createRootScope`
- `Scope.depend` / `activate` / `whenReady`
- `provide` / `inject` / `tryInject`
- `effect` · `child` · `dispose`
- `bindDisposable`

## Host（C1）

`createHostAgentCache`：session agent 依赖 `host.plugins`；`invalidate` / `stop` 按 Ordering 卸装。

## Non-goals

- Proxy 上帝对象 · HMR  
- session / agent-loop 语义（由 core* 拥有）

## Spec

[docs/compose.md](../../docs/compose.md) · [ADR-0005](../../docs/adr/0005-compose-leaf.md)
