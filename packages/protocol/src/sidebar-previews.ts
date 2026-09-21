/**
 * Sidebar preview seams (Office / URL embed / subagent / plan).
 * Contract-first: types + Host/Face ownership. Product details tabs read
 * `plan.preview` and `/office` connection.status without new payload fields.
 *
 * Ownership (DSH-aligned):
 * - URL / HTML / open.external → Host `/sidebar/*` (native, not dsh-compat)
 * - Subagent live / preview → Host sidebar + Face `subagent.*` (history stays Face)
 * - Plan chip → Face `plan` projection; sidebar reads summary only
 * - Office connector → dsh-compat `/office` (`office-harness.v1`); sidebar
 *   may show {@link OfficePreviewStatus} but must not re-host `/office` under
 *   `/sidebar`
 *
 * Policy subjects (when Host gates are wired): `host.open` · `sidebar.embed` ·
 * `sidebar.fs` · `office.connect` — see `@xrkseek/policy`.
 */

/** Cap assistant snippet length on subagent sidebar cards. */
export const SUBAGENT_PREVIEW_TEXT_MAX = 512;

/** AI Office connector protocol id (dsh-im / harness bridge). */
export const OFFICE_HARNESS_PROTOCOL = "office-harness.v1" as const;

/** Host `POST /sidebar/api/browser.probe` — embeddability probe, not a proxy. */
export interface BrowserEmbedProbe {
  readonly url?: string;
  readonly reachable: boolean;
  readonly supported: boolean;
  readonly reason?:
    | "empty-url"
    | "invalid-url"
    | "unsupported-scheme"
    | string;
  readonly xFrameOptions?: string;
  readonly frameAncestors?: readonly string[];
}

/** One running / recent child for sidebar cards (`subagents.preview`). */
export interface SubagentPreviewSummary {
  readonly childSessionId: string;
  readonly label?: string;
  readonly mode: "one-shot" | "continuable";
  readonly activity: "running" | "inactive";
  readonly live?: {
    readonly text?: string;
    readonly tool?: { readonly name: string; readonly args: string };
  };
  /** Bounded last-assistant text; omit when empty. */
  readonly lastAssistantPreview?: string;
}

/**
 * Plan sidebar chip. Full plan markdown stays in session / workspace;
 * do not duplicate bodies onto every Host RPC.
 */
export interface PlanPreviewSummary {
  readonly active: boolean;
  readonly pending: boolean;
  /** Optional durable pointer when an artifact exists (phase 2). */
  readonly artifactRef?: {
    readonly kind: "session-event" | "workspace-path";
    readonly id: string;
  };
}

/**
 * Office connector health for a sidebar badge / panel.
 * Source of truth remains `POST /office/connection.status` (dsh-compat).
 */
export interface OfficePreviewStatus {
  readonly protocolVersion: typeof OFFICE_HARNESS_PROTOCOL;
  readonly configured: boolean;
  readonly connected: boolean;
  readonly state: string;
}

/** Declared Host/Face RPC names for preview tabs (implement incrementally). */
export const SIDEBAR_PREVIEW_RPC = {
  /** Existing — typed as {@link BrowserEmbedProbe}. */
  browserProbe: "browser.probe",
  /** Existing — policy subject `host.open`. */
  openExternal: "open.external",
  /** Existing — live lines only. */
  subagentsLive: "subagents.live",
  /** Host `/sidebar/api/subagents.preview` — batch {@link SubagentPreviewSummary}. */
  subagentsPreview: "subagents.preview",
  /** Host `/sidebar/api/plan.preview` — {@link PlanPreviewSummary} from Face `plan`. */
  planPreview: "plan.preview",
  /** Existing outside sidebar — Office status. */
  officeConnectionStatus: "office/connection.status",
} as const;
