# @xrkseek/web-runtime

客户端算法（纯 TS）：

| Module | Rule |
|--------|------|
| `ProjectionStore` | higher-seq-wins |
| `GenerationGuard` | stale async drop |
| `BootGate` | all-active settle / fail-loud |
| `ChunkFold` | `SessionEvent` → UI trajectory |
| `SlotRegistry` | single/list/keyed/chain · cascade dispose |
| `FaceSessionView` | mux/history → fold + projections |
| `coerceSessionEvent` | Face/DSH wire envelope → SessionEvent |

规格入口：[docs/host-face.md](../../docs/host-face.md) · [docs/status.md](../../docs/status.md)。本包是 `apps/console` 验证台算法，**不是**产品聊天壳（壳源码 `apps/web` + `packages/client`；serve 用 `apps/web-static` 捕获）。
