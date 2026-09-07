/**
 * Native Host Face bridge contract for `/sidebar/*`.
 * Implementation: `@xrkseek/server-host` (`createSidebarFaceBridgeFromFace`).
 * Client: `xrkh-better-sidebar` (kind: client only).
 */
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
    beforeSeq: number,
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
