export { ProjectionStore, type ProjectionRow, type ProjectionsBaseline } from "./projection-store.js";
export { GenerationGuard } from "./generation-guard.js";
export {
  BootGate,
  type BootEntryState,
  type BootGatePhase,
  type BootGateSnapshot,
} from "./boot-gate.js";
export {
  ChunkFold,
  type ChunkFoldSnapshot,
  type TrajectoryNode,
} from "./chunk-fold.js";
export {
  SlotRegistry,
  type ChainSelect,
  type LiveSlotNode,
  type LiveSlotOccupant,
  type SlotEntry,
  type SlotKind,
  type SlotRegisterOptions,
  type SlotScope,
  type SlotSpec,
} from "./slot-registry.js";
export type {
  FaceHistoryPayload,
  FaceMuxFrame,
  FaceQueueItemView,
} from "./face-session-view.js";
export { FaceSessionView } from "./face-session-view.js";
