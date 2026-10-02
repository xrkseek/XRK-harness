# @xrkseek/context-fragments

Pluggable context-fragment pipeline (Codex-shaped). Layered **apart** from durable workspace inject.

| Phase | When | Wire |
| --- | --- | --- |
| `turn-start` | After workspace inject, before human `user/message` | Harness `appendContextFragments` |
| `user-message` | With each user / steer prepare | `prepareUserContent` contexts |
| `post-tool` | After tool settle, before `step/end` | Harness `afterToolResults` → `appendContextFragments` |

Default providers are pluggable (`createStaticAdditionalContextProvider`,
`createRecapFragment`). Chat UI hides durable `additional_context` rows.
Tool pre-review lives on **auto-review** (Settings → Plugins → Advanced):
classifier tiers heuristic | http | session-llm; session **Auto** = no sandbox +
per-call review — not chat fragment spam.

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
