/**
 * Local offline rollout-trace reducer (Codex-style evidence graph).
 * Session events + subagent links → nodes/edges for debug replay.
 * Not OTLP, not upload — debug-only sidecar next to session export.
 */
import type { SessionEvent } from "@xrkseek/protocol";

export type RolloutTraceEdgeKind = "spawn" | "message" | "tool";

export type RolloutTraceNodeKind =
  | "session"
  | "turn"
  | "tool_call"
  | "message";

export interface RolloutTraceNode {
  readonly id: string;
  readonly kind: RolloutTraceNodeKind;
  readonly sessionId: string;
  readonly label?: string;
  readonly turnId?: string;
  readonly toolName?: string;
}

export interface RolloutTraceEdge {
  readonly id: string;
  readonly kind: RolloutTraceEdgeKind;
  readonly from: string;
  readonly to: string;
  readonly label?: string;
}

export interface RolloutTraceLink {
  readonly parentSessionId: string;
  readonly childSessionId: string;
  readonly mode?: string;
  readonly label?: string;
}

export interface RolloutTraceState {
  readonly version: 1;
  /** Local debug only — never treat as telemetry upload payload. */
  readonly purpose: "local-debug";
  readonly rootSessionId: string;
  readonly sessions: readonly string[];
  readonly nodes: readonly RolloutTraceNode[];
  readonly edges: readonly RolloutTraceEdge[];
  readonly counts: {
    readonly nodes: number;
    readonly edges: number;
    readonly spawn: number;
    readonly message: number;
    readonly tool: number;
  };
}

export interface BuildRolloutTraceInput {
  readonly rootSessionId: string;
  /** Session id → append-only events (order preserved). */
  readonly eventsBySession: Readonly<Record<string, readonly SessionEvent[]>>;
  /** Parent→child registry (Face subagents); drives spawn edges. */
  readonly links?: readonly RolloutTraceLink[];
}

function nodeId(kind: RolloutTraceNodeKind, ...parts: string[]): string {
  return `${kind}:${parts.join(":")}`;
}

/**
 * Reduce session events + subagent links into a local debug graph.
 * Edges: spawn (registry), message (user/assistant turns), tool (call→result).
 */
export function buildRolloutTraceState(
  input: BuildRolloutTraceInput,
): RolloutTraceState {
  const nodes = new Map<string, RolloutTraceNode>();
  const edges: RolloutTraceEdge[] = [];
  const sessions = Object.keys(input.eventsBySession);
  if (!sessions.includes(input.rootSessionId)) {
    sessions.unshift(input.rootSessionId);
  }

  const ensureSession = (sessionId: string, label?: string) => {
    const id = nodeId("session", sessionId);
    if (!nodes.has(id)) {
      nodes.set(id, {
        id,
        kind: "session",
        sessionId,
        ...(label ? { label } : { label: sessionId }),
      });
    }
    return id;
  };

  for (const sessionId of sessions) {
    ensureSession(sessionId);
  }

  let edgeSeq = 0;
  const pushEdge = (
    kind: RolloutTraceEdgeKind,
    from: string,
    to: string,
    label?: string,
  ) => {
    edgeSeq += 1;
    edges.push({
      id: `e${edgeSeq}`,
      kind,
      from,
      to,
      ...(label ? { label } : {}),
    });
  };

  for (const link of input.links ?? []) {
    const from = ensureSession(link.parentSessionId);
    const to = ensureSession(
      link.childSessionId,
      link.label?.trim() || link.childSessionId,
    );
    pushEdge(
      "spawn",
      from,
      to,
      link.mode?.trim()
        ? `${link.mode}${link.label ? `:${link.label}` : ""}`
        : link.label,
    );
  }

  for (const sessionId of sessions) {
    const events = input.eventsBySession[sessionId] ?? [];
    const sessionNode = ensureSession(sessionId);
    let openTurn: string | undefined;
    /** tool/call id → node id (awaiting result). */
    const openCalls = new Map<string, string>();
    let lastMessageInTurn: string | undefined;

    for (const event of events) {
      if (event.type === "turn/start") {
        const turnNode = nodeId("turn", sessionId, event.turnId);
        nodes.set(turnNode, {
          id: turnNode,
          kind: "turn",
          sessionId,
          turnId: event.turnId,
          label: event.turnId,
        });
        pushEdge("message", sessionNode, turnNode, "turn/start");
        openTurn = turnNode;
        lastMessageInTurn = undefined;
        openCalls.clear();
        continue;
      }

      if (event.type === "turn/end") {
        openTurn = undefined;
        lastMessageInTurn = undefined;
        openCalls.clear();
        continue;
      }

      if (event.type === "user/message" || event.type === "assistant/message") {
        const turnId = event.turnId;
        const turnNode =
          openTurn ??
          (() => {
            const id = nodeId("turn", sessionId, turnId);
            if (!nodes.has(id)) {
              nodes.set(id, {
                id,
                kind: "turn",
                sessionId,
                turnId,
                label: turnId,
              });
              pushEdge("message", sessionNode, id, "turn");
            }
            return id;
          })();
        const msgId = nodeId(
          "message",
          sessionId,
          turnId,
          event.type === "user/message" ? "user" : "assistant",
          String(event.ts),
        );
        nodes.set(msgId, {
          id: msgId,
          kind: "message",
          sessionId,
          turnId,
          label: event.type === "user/message" ? "user" : "assistant",
        });
        const from = lastMessageInTurn ?? turnNode;
        pushEdge(
          "message",
          from,
          msgId,
          event.type === "user/message" ? "user" : "assistant",
        );
        lastMessageInTurn = msgId;
        continue;
      }

      if (event.type === "tool/call") {
        const turnId = event.turnId;
        const callKey = `${turnId}:${event.call?.id ?? event.stepId ?? event.ts}`;
        const toolName = String(event.call?.name ?? "tool");
        const toolNode = nodeId("tool_call", sessionId, callKey);
        nodes.set(toolNode, {
          id: toolNode,
          kind: "tool_call",
          sessionId,
          turnId,
          toolName,
          label: toolName,
        });
        const from =
          lastMessageInTurn ??
          openTurn ??
          (() => {
            const id = nodeId("turn", sessionId, turnId);
            if (!nodes.has(id)) {
              nodes.set(id, {
                id,
                kind: "turn",
                sessionId,
                turnId,
                label: turnId,
              });
              pushEdge("message", sessionNode, id, "turn");
            }
            return id;
          })();
        pushEdge("tool", from, toolNode, toolName);
        openCalls.set(callKey, toolNode);
        // Also key by call.id alone when present (result may only carry callId).
        if (event.call?.id) openCalls.set(String(event.call.id), toolNode);
        continue;
      }

      if (event.type === "tool/result") {
        const callId = String(event.result?.toolCallId ?? "").trim();
        const turnId = event.turnId;
        const callKey = callId || `${turnId}:${event.stepId}`;
        const toolNode =
          (callId ? openCalls.get(callId) : undefined) ??
          openCalls.get(callKey) ??
          nodeId("tool_call", sessionId, callKey);
        if (!nodes.has(toolNode)) {
          nodes.set(toolNode, {
            id: toolNode,
            kind: "tool_call",
            sessionId,
            turnId,
            toolName: event.result?.name,
            label: event.result?.name ?? "tool",
          });
        }
        const resultNode = nodeId(
          "message",
          sessionId,
          turnId,
          "tool-result",
          String(event.ts),
        );
        nodes.set(resultNode, {
          id: resultNode,
          kind: "message",
          sessionId,
          turnId,
          label: "tool/result",
        });
        pushEdge("tool", toolNode, resultNode, "result");
        lastMessageInTurn = resultNode;
      }
    }
  }

  const edgeList = edges;
  const spawn = edgeList.filter((e) => e.kind === "spawn").length;
  const message = edgeList.filter((e) => e.kind === "message").length;
  const tool = edgeList.filter((e) => e.kind === "tool").length;
  const nodeList = [...nodes.values()];

  return {
    version: 1,
    purpose: "local-debug",
    rootSessionId: input.rootSessionId,
    sessions: [...new Set(sessions)],
    nodes: nodeList,
    edges: edgeList,
    counts: {
      nodes: nodeList.length,
      edges: edgeList.length,
      spawn,
      message,
      tool,
    },
  };
}
