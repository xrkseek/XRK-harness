/**
 * Host-injected Face bridge for dsh-better-sidebar sidechat / external open.
 * Implementation lives in `@xrkseek/server-host` (keeps http free of face import).
 */
export interface SidebarFaceBridge {
  readonly startSidechat: (
    parentSessionId: string,
    question?: string,
  ) => Promise<{ childId: string }>;
  readonly promptSidechat: (childId: string, text: string) => Promise<{ ok: true }>;
  readonly cancelSidechat: (childId: string) => Promise<{ ok: true }>;
  readonly disposeSidechat: (childId: string) => Promise<{ ok: true }>;
  readonly infoSidechat: (
    childId: string,
  ) => Promise<{ preset?: string; model?: string; provider?: string }>;
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
  /** Live activity lines for dsh-better-sidebar `subagents.live`. */
  readonly listSubagentsLive?: (
    rootSessionId: string,
  ) => Promise<{
    readonly live: Readonly<
      Record<string, { readonly text?: string; readonly tool?: string; readonly args?: string }>
    >;
  }>;
}
