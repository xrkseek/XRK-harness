import type { AgentHandle } from "@xrkseek/core-agent";
import type { SessionRecord, SessionStore } from "@xrkseek/core-session";
import type { ProviderRegistry } from "@xrkseek/llm-registry";
import type { PolicyEngine } from "@xrkseek/policy";
import type { FaceBus } from "./bus.js";
import type { FaceSeqClock } from "./seq.js";
import type {
  FaceProjectionRegistry,
  FaceTitleController,
} from "./projections/index.js";
import type { SlashRecipesLoader } from "./slash.js";
import { FACE_AGENT_PRESET_IDS } from "./presets-catalog.js";
import type {
  FaceCredentialVault,
  FaceHostPublicSettings,
  FaceSettingsNamespaces,
  FaceUiSettings,
} from "./settings-credentials.js";
import type { FaceApprovalBroker } from "./approvals.js";
import type { FaceWorkspaceRegistry } from "./workspace-registry.js";
import type { FaceWireIdMaps } from "./adapt/wire-ids.js";
import type { FaceInboxWireMaps } from "./adapt/inbox-wire.js";

/** @deprecated use FACE_AGENT_PRESET_IDS */
export const U1_AGENT_PRESETS = FACE_AGENT_PRESET_IDS;

export interface FaceDrain {
  wake(sessionId: string): void;
  cancel(sessionId: string): Promise<void>;
  isActive(sessionId: string): boolean;
}

export interface FaceRuntime {
  readonly store: SessionStore;
  ensureSession(id?: string): string;
  resolveAgent(sessionId: string): Promise<AgentHandle>;
  readonly drain: FaceDrain;
  readonly registry: ProviderRegistry;
  readonly workspaceRoot: string;
  /** Product inject dir; default `{workspaceRoot}/.xrk`. */
  readonly productDir?: string;
  /**
   * Named seed templates for `workspace.syncSeeds({ template })`.
   * Values are absolute directories (e.g. office-agent template path).
   */
  readonly seedTemplateDirs?: Readonly<Record<string, string>>;
  readonly version: string;
  readonly defaultAgentPreset?: string;
  readonly bus: FaceBus;
  readonly seq: FaceSeqClock;
  readonly projections: FaceProjectionRegistry;
  readonly titles: FaceTitleController;
  /** rpcId (unary) → admitId */
  readonly rpcAdmitMap: Map<string, string>;
  /** admitId → rpcId (reverse for queue / stamp) */
  readonly admitRpcMap: Map<string, string>;
  /** Next user/message for session should carry this rpcId */
  readonly pendingUserRpc: Map<string, string>;
  readonly sessionModels: Map<string, { provider: string; model: string }>;
  /** sessionId → agentPreset id */
  readonly sessionAgentPresets: Map<string, string>;
  /** sessionId → project cwd (DSH session.list / blank reuse). */
  readonly sessionCwds: Map<string, string>;
  /** DeepSeek workspace registry (in-memory). */
  readonly workspaces: FaceWorkspaceRegistry;
  /** Session-scoped turn/step numbers for DSH wire events. */
  readonly wireIds: FaceWireIdMaps;
  /** Session-scoped inbox splice projectors for live mux. */
  readonly inboxWire: FaceInboxWireMaps;
  readonly loadSlashRecipes?: SlashRecipesLoader;
  /** Mutable UI prefs (theme/locale) — not secrets. */
  readonly uiSettings: FaceUiSettings;
  /** Read-only host public snapshot (from host spawn). */
  readonly hostPublic?: FaceHostPublicSettings;
  /** In-memory credential overrides — never session-logged. */
  readonly credentials: FaceCredentialVault;
  /** DeepSeek-compatible settings namespaces (welcome notice, etc.). */
  readonly settingsNamespaces: FaceSettingsNamespaces;
  /** Bootstrap Host API key from env/config (before vault override). */
  readonly bootstrapApiKey?: string;
  /** Optional policy engine (e.g. from XRK_POLICY_FILE) for provider.use gates. */
  readonly policy?: PolicyEngine;
  /** Human approval waiters (tool policy `ask`). */
  readonly approvals: FaceApprovalBroker;
  /** Drop cached agent when preset changes (host wires). May be async (compose dispose). */
  invalidateAgent?(sessionId: string): void | Promise<void>;
  /** Publish store appends as mux session/event. */
  watchSession(sessionId: string): void;
  publishQueue(sessionId: string): void;
  publishApprovals(sessionId: string): void;
  /**
   * Copy parent log into a new session without inventing title/fallback rows
   * (replay path).
   */
  forkSession(
    sourceId: string,
    boundaryIndex?: number,
    childId?: string,
  ): SessionRecord;
}
