# @xrkseek/server-face

DeepSeek-compatible **Host Face** (U1): unary RPC + dual WS under `/api/face/*`.

- Spec: [docs/host-face.md](../../../docs/host-face.md)
- Does **not** replace REST `/api/sessions` — parallel protocol face
- SPA / `__DSH_BOOT__` not included (follow-on)

```ts
import { createFaceRuntime, createFaceOnlyServer, handleFaceHttpRequest } from "@xrkseek/server-face";
```
