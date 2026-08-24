/**
 * Underlying primitives for the community Host adapter.
 * Self-contained: extract this folder with zero imports from server-http root.
 */
export {
  dataPath,
  ensureDir,
  readJsonFile,
  writeJsonFile,
} from "./json-store.js";
export {
  createXrkDocStore,
  type XrkDocStore,
} from "./doc-store.js";
export {
  readBody,
  rpcErr,
  rpcOk,
  sendJson,
  type Json,
} from "./http-json.js";
export {
  drainMutatingBody,
  httpMethod,
  isMutatingMethod,
  parseJsonBody,
} from "./http-kit.js";
export {
  applyMobileGateDecision,
  classifyRequestHost,
  effectiveRequestHost,
  evaluateMobileGate,
  hostOnly,
  isMobileGateExemptPath,
  type MobileGateCredentials,
  type MobileGateDecision,
  type MobileGateMode,
  type MobileGateSnapshot,
  type RequestHostClass,
} from "./mobile-gate-kit.js";
export type { PublicRouteHandlerFn } from "./public-handler.js";

/** Module contract for docs (not enforced at runtime). */
export interface DshUnderlyingModule {
  readonly id: string;
  readonly storageParts: readonly (readonly string[])[];
  readonly surfaces: readonly string[];
}
