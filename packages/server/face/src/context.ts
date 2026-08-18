import type { AttachmentStore } from "@xrkseek/attachment";
import type { AgentHandle } from "@xrkseek/core-agent";
import type { SessionRecord, SessionStore } from "@xrkseek/core-session";
import type { ToolDefinition } from "@xrkseek/core-tools";
import type { JobView } from "./adapt/job-view.js";
import type { ProviderRegistry } from "@xrkseek/llm-registry";
import type { PolicyEngine } from "@xrkseek/policy";
import type { FaceBus } from "./bus.js";
import type { FaceSeqClock } from "./seq.js";
import type {
  FaceProjectionRegistry,
  FaceTitleController,
} from "./projections/index.js";
import type {
  FaceProcessPlugin,
  FaceWebPlugin,
} from "./plugin-inventory.js";
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
import type { FaceSubagentRegistry } from "./subagent-registry.js";
import type { FaceMessageFeedbackStore } from "./message-feedback.js";
import type { FaceGoalStore } from "./goal-store.js";
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
  /** Durable image blobs; omit → image prompt / session.attachment unavailable. */
  readonly attachments?: AttachmentStore;
  /**
   * Declared input modalities for Host precheck (DSH-aligned).
   * Default `["text"]` — images rejected before save unless `"image"` is listed.
   */
  readonly inputModalities?: readonly ("text" | "image")[];
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
  /** Direct subagent children (fork / create-with-parent). */
  readonly subagents: FaceSubagentRegistry;
  /** Per-session assistant-message ratings (process-local CAS). */
  readonly messageFeedback: FaceMessageFeedbackStore;
  /** Per-session Goal sidecar (projection key `goal`). */
  readonly goals: FaceGoalStore;
  /** Session-scoped turn/step numbers for DSH wire events. */
  readonly wireIds: FaceWireIdMaps;
  /** Session-scoped inbox splice projectors for live mux. */
  readonly inboxWire: FaceInboxWireMaps;
  readonly loadSlashRecipes?: SlashRecipesLoader;
  /** Process plugins (`XRK_PLUGINS_DIR` / MCP) for inventory + slash. */
  readonly plugins?: readonly FaceProcessPlugin[];
  /** Standing / remembered tool presenters (DSH `ctx.tools.get`). */
  getTool?(
    sessionId: string,
    name: string,
  ): Pick<ToolDefinition, "presentCall" | "presentResult"> | undefined;
  /** Product-shell `boot.json` entries (captured DSH client plugins). */
  readonly webPlugins?: readonly FaceWebPlugin[];
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
  /**
   * Absolute path to a local settings/policy document.
   * Opened by `settings.openDocument` — request carries no filesystem path.
   */
  readonly settingsDocumentPath?: string;
  /** Native opener; default platform `openNativePath`. */
  openNativePath?(target: string): Promise<void>;
  /** Native folder chooser; default platform `pickNativeDirectory`. Cancel → `null`. */
  pickNativeDirectory?(signal: AbortSignal): Promise<string | null>;
  /** Human approval waiters (tool policy `ask`). */
  readonly approvals: FaceApprovalBroker;
  /** Drop cached agent when preset changes (host wires). May be async (compose dispose). */
  invalidateAgent?(sessionId: string): void | Promise<void>;
  /** Publish store appends as mux session/event. */
  watchSession(sessionId: string): void;
  publishQueue(sessionId: string): void;
  publishApprovals(sessionId: string): void;
  /**
   * DSH `session/jobs`. `undefined` = no registry (emit nothing).
   * Empty array is a live set that just cleared (still pushed on change).
   */
  jobViewsFor(sessionId: string): JobView[] | undefined;
  publishJobs(sessionId: string, opts?: { baseline?: boolean }): void;
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
