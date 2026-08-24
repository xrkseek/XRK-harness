# `@xrkseek/compose`

> **读者 / Audience**：贡献者 · 维护者 / Contributors · Maintainers

时空可组合叶包：可逆 effect、依赖声明、卸序（Ordering）、isolate 域。无 Proxy、无第三方组合运行时依赖。

A composable leaf package for reversible effects, dependency declaration, unload Ordering, and isolate realms. No Proxy and no third-party composition runtime.

## 状态 / Status

- **C0** 叶包 + 不变量测试 / Leaf package + invariant tests  
- **C1** Host `createHostAgentCache`（agent 失效 / stop 走 Ordering） / Host agent cache (invalidate / stop via Ordering)  
- **C2** `interceptInject` + `openSubagentRealm` **能跑**（DI 层；不 spawn、不写 session） / **Working** at the DI layer (does not spawn or write session)  
- Host：子会话 `resolve(..., { parentSessionId })` 打开 `subagent:{id}` realm；父 scope 在缓存中时嵌在父下（invalidate 父会卸子）；Face 登记仍走 `subagents.json`  

Host opens a `subagent:{id}` realm via `resolve(..., { parentSessionId })`. When the parent scope is cached, the child nests under it (invalidating the parent unloads children). Face registration still uses `subagents.json`.

## 公共面 / Public surface

- `createRootScope` · `Scope.depend` / `activate` / `whenReady`
- `provide` / `inject` / `tryInject` · `effect` · `child` · `dispose`
- `interceptInject` · `openSubagentRealm`
- `bindDisposable`

包 README / Package README：[packages/compose/README.md](../packages/compose/README.md) · 决策 / Decision：[ADR-0005](./adr/0005-compose-leaf.md)

## 纪律 / Discipline

- `kernel` 保持更薄，不依赖 `compose` / Keep `kernel` thinner; it must not depend on `compose`
- Host / Face / plugin **另接** compose / Host, Face, and plugins wire compose separately
- session 事件真源不迁入本包 / Session event source of truth does not move into this package
