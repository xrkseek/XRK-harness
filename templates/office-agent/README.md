# office-agent

Minimal product seed migrated from AGT `agents/workspace/` (desensitized).

## Files

| File | Role |
|------|------|
| `SOUL.md` | Persona / principles |
| `USER.md` | User preferences |
| `IDENTITY.md` | Display identity |
| `AGENTS.md` | Product workspace rules (not repo AGENTS.md) |
| `TOOLS.md` | Local notes |
| `assistant.md` / `rules.md` / `subagents.md` | Injector inputs |
| `recipes/*.yaml` | Slash recipes |

## Sync into a workspace

```ts
import { createWorkspaceInjector } from "@xrkseek/workspace";
import path from "node:path";

const inj = createWorkspaceInjector({
  root: process.cwd(),
  productDir: path.join(process.cwd(), ".xrk"),
});
await inj.syncSeeds(path.join("templates", "office-agent"));
```

See `docs/migrate-from-agt.md`.
