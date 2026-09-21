/**
 * Native Host Face bridge contract for `/sidebar/*`.
 * Implementation: `@xrkseek/server-host` (`createSidebarFaceBridgeFromFace`).
 * Client: `xrkh-better-sidebar` (kind: client only).
 *
 * Preview seams (contract): Office stays on `/office`; plan/subagent full
 * history stay on Face. Optional methods below are for richer sidebar cards
 * without duplicating Face RPCs — wire incrementally.
 */
import type {
  PlanPreviewSummary,
  SubagentPreviewSummary,
} from "@xrkseek/protocol";

export type SidebarSubagentLiveActivity = {
  readonly text?: string;
  readonly tool?: { readonly name: string; readonly args: string };
};

/** One Face-wire session event for the changes tab (`tool/call` · `tool/result`). */
export type SidebarChangesWireEvent = {
  readonly type: string;
  readonly seq: number;
  readonly time: number;
  readonly data: unknown;
  readonly surfaceOp?: string | { readonly op: string; readonly start: number; readonly end: number };
};

export interface SidebarFaceBridge {
  readonly openExternal: (payload: {
    action: "reveal" | "url";
    path?: string;
    url?: string;
  }) => Promise<{ ok: true }>;
  readonly readJobOutput?: (
    jobId: string,
  ) => { text: string; truncated?: boolean };
  readonly killJob?: (
    jobId: string,
    reason?: string,
  ) => Promise<{ ok: boolean; killed: boolean; reason?: string }>;
  readonly forkSessionAt?: (
    sessionId: string,
    atSeq: number,
  ) => Promise<{ sessionId: string }>;
  /**
   * Running-child live lines for `POST /sidebar/api/subagents.live`.
   * Wire: nested `tool` (`LastActivity` / {@link SidebarSubagentLiveActivity}).
   */
  readonly listSubagentsLive?: (
    rootSessionId: string,
  ) => Promise<{
    readonly live: Readonly<Record<string, SidebarSubagentLiveActivity>>;
  }>;
  /**
   * Richer subagent cards for `POST /sidebar/api/subagents.preview`.
   * Full history remains Face `subagent.history`.
   */
  readonly listSubagentPreviews?: (
    rootSessionId: string,
  ) => Promise<{
    readonly previews: readonly SubagentPreviewSummary[];
  }>;
  /**
   * Team graph for `POST /sidebar/api/subagents.graph`.
   * Delegation edges come from the subagent registry; `link` adds a peer edge,
   * `role` overrides one node's role (`delegator` / `worker` / `observer`).
   */
  readonly agentTeamGraph?: (
    rootSessionId: string,
    action?:
      | { op: "link"; from: string; to: string; label?: string }
      | { op: "role"; nodeId: string; role?: string },
  ) => Promise<{
    readonly nodes: readonly {
      id: string;
      label: string;
      role?: "delegator" | "worker" | "observer";
    }[];
    readonly edges: readonly {
      from: string;
      to: string;
      kind: "delegates" | "peer";
      label?: string;
    }[];
  }>;
  /**
   * Plan chip for `POST /sidebar/api/plan.preview`
   * (Face `plan` projection summary — no markdown body).
   */
  readonly getPlanPreview?: (
    sessionId: string,
  ) => Promise<PlanPreviewSummary>;
  /**
   * Session file-tool delta for `POST /sidebar/api/changes.ops`
   * (`tool/call` + `tool/result` past `afterSeq`, Face wire shape).
   */
  readonly listChangesOps?: (
    sessionId: string,
    afterSeq: number,
  ) => {
    readonly events: readonly SidebarChangesWireEvent[];
    readonly lastSeq: number;
  };
}
