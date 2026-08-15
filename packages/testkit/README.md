# @xrkseek/testkit

测试夹具：`makeHarness({ preset, llm, workspaceRoot, presentation })`。

```ts
import { makeHarness } from "@xrkseek/testkit";
import { createReplayAdapter } from "@xrkseek/llm-replay";

const h = makeHarness({
  preset: "minimal",
  llm: createReplayAdapter([{ content: "pong" }]),
});
expect((await h.run("ping")).text).toBe("pong");
```

约定见 [docs/testing.md](../../docs/testing.md)。
