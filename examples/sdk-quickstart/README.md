# sdk-quickstart

```ts
import { makeHarness } from "@xrkseek/testkit";
// or: import { createMinimalComposition } from "@xrkseek/harness";

const h = makeHarness({ preset: "minimal" });
const { text } = await h.run("ping");
console.log(text);
```

HTTP:

```bash
node apps/cli/dist/bin.js serve --preset minimal
```

See `docs/http-api.md`, `docs/code-mode.md`, `templates/office-agent/README.md`.
