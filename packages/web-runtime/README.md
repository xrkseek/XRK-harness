# @xrkseek/web-runtime

XRK-owned **client algorithms** (not a DeepSeek UI fork):

| Module | Rule |
|--------|------|
| `ProjectionStore` | higher-seq-wins |
| `GenerationGuard` | stale async drop |
| `BootGate` | all-active settle / fail-loud |
| `ChunkFold` | XRK `SessionEvent` → UI trajectory |
| `SlotRegistry` | single/list/keyed/chain · declare · cascade dispose |
| `FaceSessionView` | mux/history → fold + projections |

Learn: [docs/learn/web-client-algorithms.md](../../docs/learn/web-client-algorithms.md).
