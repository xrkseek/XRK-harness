# @xrkseek/server-host

进程内 Host：配置 · session store · drain hub · HTTP · agent factory。

```ts
import { createHostManager } from "@xrkseek/server-host";
import { loadHostConfig } from "@xrkseek/server-config";

const manager = createHostManager();
const instance = await manager.spawn(config, async ({ sessionId, store, workspaceRoot }) => {
  /* return AgentHandle */
});
```

`instance.drain`：`run` / `wake` / `cancel`（[docs/session-latch.md](../../docs/session-latch.md)）。

若配置了 `runtime.pluginsDir`，spawn 时 `loader.loadAll`；见 `loadedPluginIds` / `health().plugins`。

AgentHandle **可缓存绑定，不可当 transcript 真源**（ADR-0003）。
