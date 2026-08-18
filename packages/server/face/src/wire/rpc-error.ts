/**
 * XRK Face 错误码 → DSH Web 闭集 RpcError（必含 details）。
 */

import type { FaceRpcError } from "../types.js";

/** DSH 浏览器客户端接受的 code（RpcErrorDetailsMap 键）。 */
export const DSH_RPC_ERROR_CODES = [
  "bad-request",
  "cancelled",
  "session-not-found",
  "model-unavailable",
  "session-conflict",
  "invalid-time-zone",
  "workspace-attach-failed",
  "workspace-not-found",
  "workspace-invalid-path",
  "workspace-name-conflict",
  "workspace-move-invalid",
  "directory-unreadable",
  "directory-exists",
  "directory-create-failed",
  "directory-picker-unavailable",
  "agent-preset-read-only",
  "agent-preset-locked",
  "agent-preset-conflict",
  "agent-preset-not-found",
  "agent-preset-invalid",
  "agent-busy",
  "attachment-error",
  "queue-item-not-found",
  "steer-unavailable",
  "command-error",
  "unknown-command",
  "settings-rejected",
  "settings-conflict",
  "credential-rejected",
  "model-discovery-failed",
  "title-invalid",
  "fork-unavailable",
  "subagent-parent-unavailable",
  "subagent-not-found",
  "subagent-catalog-diagnostic",
  "subagent-not-resumable",
  "subagent-unauthorized",
  "subagent-delivery-unavailable",
  "internal",
] as const;

export type DshRpcErrorCode = (typeof DSH_RPC_ERROR_CODES)[number];

const DSH_CODES = new Set<string>(DSH_RPC_ERROR_CODES);

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
}

/**
 * 把 handler 错误归一成 DSH 可解析的 RpcError。
 * 未知 / 仅 XRK 的 code 折到最近 DSH 码或 `internal`。
 */
export function mapFaceRpcError(
  code: string,
  message: string,
  details?: unknown,
): FaceRpcError {
  const hint = asRecord(details);

  switch (code) {
    case "invalid-payload":
    case "invalid-mode":
      return {
        code: "bad-request",
        message: `${code}: ${message}`,
        details: { issues: hint?.issues ?? [] },
      };

    case "not-found":
      return {
        code: "session-not-found",
        message,
        details: {
          sessionId:
            typeof hint?.sessionId === "string" ? hint.sessionId : message,
        },
      };

    case "unsupported-modality":
    case "unsupported-image-type":
    case "attachment-unavailable":
      return {
        code: "attachment-error",
        message: `${code}: ${message}`,
        details: { reason: message },
      };

    case "path-escape":
    case "seed-dir-not-found":
      return {
        code: "workspace-invalid-path",
        message,
        details: { path: typeof hint?.path === "string" ? hint.path : message },
      };

    case "session-exists":
      return {
        code: "session-conflict",
        message,
        details: {
          sessionId:
            typeof hint?.sessionId === "string" ? hint.sessionId : message,
          requestedCwd:
            typeof hint?.requestedCwd === "string" ? hint.requestedCwd : "",
        },
      };

    case "provider-not-found":
    case "policy-denied":
      return {
        code: "model-unavailable",
        message: `${code}: ${message}`,
        details: {
          provider: typeof hint?.provider === "string" ? hint.provider : "",
          model: typeof hint?.model === "string" ? hint.model : message,
        },
      };

    case "seed-template-not-found":
      return {
        code: "workspace-not-found",
        message,
        details: {
          workspaceId:
            typeof hint?.workspaceId === "string" ? hint.workspaceId : message,
        },
      };

    case "approval-not-found":
    case "approval-session-mismatch":
      return {
        code: "bad-request",
        message: `${code}: ${message}`,
        details: { issues: [] },
      };

    case "settings-scope-not-found":
    case "settings-readonly":
    case "settings-invalid":
      return {
        code: "settings-rejected",
        message,
        details: { ns: typeof hint?.ns === "string" ? hint.ns : message },
      };

    case "credentials-too-large":
    case "credentials-slot-not-found":
      return {
        code: "credential-rejected",
        message,
        details: { ref: typeof hint?.ref === "string" ? hint.ref : message },
      };

    case "not-implemented":
      return { code: "internal", message, details: {} };

    case "session-not-found":
      return {
        code: "session-not-found",
        message,
        details: {
          sessionId:
            typeof hint?.sessionId === "string" ? hint.sessionId : message,
        },
      };

    case "workspace-not-found":
      return {
        code: "workspace-not-found",
        message,
        details: {
          workspaceId:
            typeof hint?.workspaceId === "string"
              ? hint.workspaceId
              : message,
        },
      };

    case "directory-unreadable":
    case "directory-exists":
    case "directory-create-failed":
      return {
        code,
        message,
        details: {
          path: typeof hint?.path === "string" ? hint.path : message,
        },
      };

    case "attachment-error":
      return {
        code: "attachment-error",
        message,
        details: {
          reason: typeof hint?.reason === "string" ? hint.reason : message,
        },
      };

    case "agent-preset-not-found":
      return {
        code: "agent-preset-not-found",
        message,
        details: {
          agentPreset:
            typeof hint?.agentPreset === "string"
              ? hint.agentPreset
              : message,
          available: Array.isArray(hint?.available) ? hint.available : [],
        },
      };

    case "agent-preset-read-only":
      return {
        code: "agent-preset-read-only",
        message,
        details: {
          agentPreset:
            typeof hint?.agentPreset === "string"
              ? hint.agentPreset
              : message,
          reason: typeof hint?.reason === "string" ? hint.reason : message,
        },
      };

    case "queue-item-not-found":
      return {
        code: "queue-item-not-found",
        message,
        details: {
          itemId: typeof hint?.itemId === "string" ? hint.itemId : message,
        },
      };

    case "title-invalid":
      return {
        code: "title-invalid",
        message,
        details: {
          sessionId:
            typeof hint?.sessionId === "string" ? hint.sessionId : message,
        },
      };

    case "settings-rejected":
      return {
        code: "settings-rejected",
        message,
        details: {
          ns: typeof hint?.ns === "string" ? hint.ns : "",
        },
      };

    case "settings-conflict":
      return {
        code: "settings-conflict",
        message,
        details: {
          ns: typeof hint?.ns === "string" ? hint.ns : "",
          expected: typeof hint?.expected === "number" ? hint.expected : 0,
          actual: typeof hint?.actual === "number" ? hint.actual : 0,
        },
      };

    case "credential-rejected":
      return {
        code: "credential-rejected",
        message,
        details: {
          ref: typeof hint?.ref === "string" ? hint.ref : message,
        },
      };

    default:
      if (DSH_CODES.has(code)) {
        return {
          code,
          message,
          details: hint ?? {},
        };
      }
      return {
        code: "internal",
        message: `${code}: ${message}`,
        details: {},
      };
  }
}
