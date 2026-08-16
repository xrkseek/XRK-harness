# @xrkseek/server-face

**Host Face**：Unary RPC + 双 WebSocket（`/api/face/*` 与原生 `/api/<method>`，method 须含 `.`）。

- 规格：[docs/host-face.md](../../../docs/host-face.md)
- 与 REST `/api/sessions` 并行，共用 session 真源

```ts
import { createFaceRuntime, tryHandleFaceHttp, attachFaceUpgrades } from "@xrkseek/server-face";
```
