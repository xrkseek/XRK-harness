# @xrkseek/context-fragments

Pluggable context-fragment pipeline (Codex-shaped). Layered **apart** from durable workspace inject.

| Phase | When | Wire |
| --- | --- | --- |
| `turn-start` | After workspace inject, before human `user/message` | `appendContextFragments` |
| `user-message` | With each user / steer prepare | `prepareUserContent` contexts |
| `post-tool` | Host may collect after tool settle | optional |

```ts
import {
  createContextFragmentPipeline,
  createStaticAdditionalContextProvider,
  appendContextFragments,
} from "@xrkseek/context-fragments";

const pipeline = createContextFragmentPipeline({ budgetChars: 8_000 });
pipeline.register(
  createStaticAdditionalContextProvider({
    id: "env",
    phase: "turn-start",
    entries: [{ key: "runtime", value: "…" }],
  }),
);
```

See [docs/context-fragments.md](../../../docs/context-fragments.md).
