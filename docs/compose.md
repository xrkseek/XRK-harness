# `@xrkseek/compose`

时空可组合叶包：可逆 effect、依赖声明、卸序（Ordering）、isolate 域。无 Proxy、无第三方组合运行时依赖。

## 状态

- **C0** 叶包 + 不变量测试  
- **C1** Host `createHostAgentCache`（agent 失效 / stop 走 Ordering）  
- **C2** `interceptInject` + `openSubagentRealm` **能跑**（DI 层；不 spawn、不写 session）
- Host：子会话 `resolve(..., { parentSessionId })` 打开 `subagent:{id}` realm；父 scope 在缓存中时嵌在父下（invalidate 父会卸子）；Face 登记仍走 `subagents.json`  

## 公共面

- `createRootScope` · `Scope.depend` / `activate` / `whenReady`
- `provide` / `inject` / `tryInject` · `effect` · `child` · `dispose`
- `interceptInject` · `openSubagentRealm`
- `bindDisposable`

包 README：[packages/compose/README.md](../packages/compose/README.md) · 决策：[ADR-0005](./adr/0005-compose-leaf.md)

## 纪律

- `kernel` 保持更薄，不依赖 `compose`
- Host / Face / plugin **另接** compose
- session 事件真源不迁入本包
