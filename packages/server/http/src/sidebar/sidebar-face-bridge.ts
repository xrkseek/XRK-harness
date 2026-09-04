/**
 * Native Host Face bridge contract for `/sidebar/*`.
 * Implementation: `@xrkseek/server-host` (`createSidebarFaceBridgeFromFace`).
 * Client: `xrkh-better-sidebar` (kind: client only).
 */
export type SidebarSubagentLiveActivity = {
  readonly text?: string;
  readonly tool?: { readonly name: string; readonly args: string };
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
}
