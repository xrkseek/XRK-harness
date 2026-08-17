export type RpcId = string;

export interface FaceRpcRequest<P = unknown> {
  readonly rpcId: RpcId;
  readonly payload: P;
}

export type FaceRpcResult<T> =
  | { readonly ok: true; readonly value: T }
  | {
      readonly ok: false;
      readonly error: { readonly code: string; readonly message: string };
    };

/** Unary response — includes DeepSeek `type: server-response` discriminator. */
export interface FaceRpcResponse<T = unknown> {
  readonly type: "server-response";
  readonly rpcId: RpcId;
  readonly result: FaceRpcResult<T>;
}

export type MuxFrame =
  | {
      readonly type: "session/event";
      readonly sessionId: string;
      readonly event: unknown;
      readonly seq: number;
      /** Host-computed, non-persisted tool card (optional). */
      readonly view?: unknown;
    }
  | {
      readonly type: "session/projection";
      readonly sessionId: string;
      readonly key: string;
      readonly value: unknown;
      readonly seq: number;
    }
  | {
      readonly type: "session/subscribed";
      readonly sessionId: string;
      readonly lastSeq: number;
    }
  | {
      readonly type: "session/queue";
      readonly sessionId: string;
      readonly items: readonly unknown[];
    }
  | {
      readonly type: "session/approvals";
      readonly sessionId: string;
      readonly items: readonly unknown[];
    };

export type HostFrame =
  | {
      readonly type: "host/session-added";
      readonly sessionId: string;
      readonly blank: boolean;
      readonly agentPreset?: string;
      readonly cwd?: string;
    }
  | {
      readonly type: "host/session-status";
      readonly sessionId: string;
      readonly running: boolean;
    }
  | {
      readonly type: "host/agent-error";
      readonly sessionId: string;
      readonly message: string;
    }
  | {
      readonly type: "host/workspace-changed";
      readonly workspace: {
        readonly workspaceId: string;
        readonly path: string;
        readonly title: string;
        readonly sessionIds: readonly string[];
        readonly createdAt: string;
        readonly updatedAt: string;
      };
    }
  | {
      readonly type: "host/archived-sessions-changed";
      readonly archivedSessionIds: readonly string[];
    };
