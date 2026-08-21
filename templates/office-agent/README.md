# office-agent

产品种子模板：注入到 workspace 的 `.xrk` / 人格与 recipes。

**办公办事**用本模板；**写 XRK 进程插件**用 [templates/xrk-harness](../xrk-harness/)。

## Files

| File | Role |
|------|------|
| `SOUL.md` | Persona / principles |
| `USER.md` | User preferences |
| `IDENTITY.md` | Display identity |
| `AGENTS.md` | Product workspace rules（非仓库根 AGENTS.md） |
| `TOOLS.md` | Local notes |
| `assistant.md` / `rules.md` / `subagents.md` | Injector inputs |
| `recipes/*.yaml` | Slash recipes |

## Sync

```ts
import { createWorkspaceInjector } from "@xrkseek/workspace";
import path from "node:path";

const inj = createWorkspaceInjector({
  root: process.cwd(),
  productDir: path.join(process.cwd(), ".xrk"),
});
await inj.syncSeeds(path.join("templates", "office-agent"));
```

见 [docs/workspace-inject.md](../../docs/workspace-inject.md) · [docs/profiles.md](../../docs/profiles.md)。
