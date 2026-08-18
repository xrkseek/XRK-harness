export type RpcId = string;

export interface FaceRpcRequest<P = unknown> {
  readonly rpcId: RpcId;
  readonly payload: P;
}

/** Handler-side fail. Wire always gets `details` via `errResponse`. */
export type FaceRpcFail = {
  readonly code: string;
  readonly message: string;
  readonly details?: Record<string, unknown>;
};

/** DSH Web Zod 要求：线上错误必须有 `details`。 */
export type FaceRpcError = {
  readonly code: string;
  readonly message: string;
  readonly details: Record<string, unknown>;
};

export type FaceRpcResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: FaceRpcFail };

/** Unary response — DeepSeek `type: server-response`. */
export interface FaceRpcResponse<T = unknown> {
  readonly type: "server-response";
  readonly rpcId: RpcId;
  readonly result:
    | { readonly ok: true; readonly value: T }
    | { readonly ok: false; readonly error: FaceRpcError };
}

/** DSH `POST /api/respond` 回执。 */
export type FaceRpcReceipt =
  | { readonly accepted: true }
  | {
      readonly accepted: false;
      readonly reason: "not-pending" | "bad-response";
    };

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
  /** DSH `session/jobs` — whole-set snapshot; omit baseline when empty. */
  | {
      readonly type: "session/jobs";
      readonly sessionId: string;
      readonly jobs: readonly unknown[];
    }
  /** DSH Web 可应答审批（稳定 rpcId 在 server-request 信封上）。 */
  | {
      readonly type: "approval/requested";
      readonly sessionId: string;
      readonly approvalId: string;
      readonly toolName: string;
      readonly callId?: string;
      readonly reason?: string;
    }
  | {
      readonly type: "approval/resolved";
      readonly sessionId: string;
      readonly approvalId: string;
      readonly outcome: "allowed-once" | "rejected" | "cancelled" | "unavailable";
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
