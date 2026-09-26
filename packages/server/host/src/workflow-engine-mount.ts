/**
 * Product Host default WorkflowEngine mount: Isolating Provider + Face
 * createAgent bridge + Code Mode–shaped `await tools.*` subset.
 *
 * Loads `@xrkseek/xrk-workflow` via dynamic import so CLI / npm installs that
 * lack Cordis stub peers (or still resolve a `.ts` entry) soft-skip instead of
 * crashing Host boot (`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`).
 */
import { createRegistryCodeToolBridge } from "@xrkseek/code-runtime";
import { Context } from "@xrkseek/cordis";
import { readSessionEvents } from "@xrkseek/core-session";
import type { FaceRuntime } from "@xrkseek/server-face";
import { dispatchFaceMethod, lastAssistantBodyText } from "@xrkseek/server-face";
import type {
  WorkflowEngine,
  WorkflowStartRequest,
  WorkflowToolBridge,
} from "@xrkseek/xrk-workflow";

const FOREGROUND_WAIT_MS = 10 * 60 * 1000;
const POLL_MS = 50;

/** Nested orchestrators that must not re-enter from workflow scripts. */
const WORKFLOW_TOOL_BLOCKLIST = new Set(["run_code", "workflow", "ralph"]);

export interface HostWorkflowEngineMount {
  readonly provider: "isolating";
  readonly createAgentBridged: true;
  readonly toolsBridged: boolean;
  readonly engine: WorkflowEngine;
  readonly dispose: () => Promise<void>;
}

function parentSessionId(parent: WorkflowStartRequest["parent"]): string | undefined {
  const session = (parent as { session?: { id?: unknown } }).session;
  return typeof session?.id === "string" && session.id.trim() !== ""
    ? session.id
    : undefined;
}

async function waitDrainIdle(
  runtime: FaceRuntime,
  sessionId: string,
  signal?: AbortSignal,
): Promise<void> {
  const run = runtime.drain.run?.bind(runtime.drain);
  if (run) {
    await run(sessionId);
    return;
  }
  const deadline = Date.now() + FOREGROUND_WAIT_MS;
  while (runtime.drain.isActive(sessionId)) {
    if (signal?.aborted) {
      throw new DOMException("aborted", "AbortError");
    }
    if (Date.now() > deadline) {
      throw new Error(`workflow agent timed out waiting for session ${sessionId}`);
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

/**
 * Bridge Isolating `agent()` calls into Face one-shot children under the
 * workflow parent session. Returns structured-cloneable JSON only.
 */
export function createFaceWorkflowCreateAgent(runtime: FaceRuntime) {
  return async (
    request: WorkflowStartRequest,
    call: { label: string; prompt: string; phase?: string },
  ): Promise<{ readonly childId: string; readonly text: string; readonly label: string }> => {
    const parentId = parentSessionId(request.parent);
    if (parentId === undefined) {
      throw new Error("workflow createAgent: parent.session.id is required");
    }
    const created = await dispatchFaceMethod(
      runtime,
      "session.create",
      `wf-agent-${Date.now()}`,
      {
        parentSessionId: parentId,
        label: call.label.slice(0, 120),
        mode: "one-shot",
      },
    );
    if (!created.result.ok) {
      throw new Error(created.result.error.message);
    }
    const childId = String(
      (created.result.value as { sessionId: string }).sessionId,
    );
    const prompted = await dispatchFaceMethod(
      runtime,
      "session.prompt",
      `wf-agent-p-${childId}`,
      {
        sessionId: childId,
        mode: "queue",
        content: [{ type: "text", text: call.prompt }],
      },
    );
    if (!prompted.result.ok) {
      throw new Error(prompted.result.error.message);
    }
    try {
      await waitDrainIdle(runtime, childId, request.signal);
    } catch (err) {
      await dispatchFaceMethod(
        runtime,
        "session.cancel",
        `wf-agent-c-${childId}`,
        { sessionId: childId },
      ).catch(() => undefined);
      throw err;
    }
    const text = lastAssistantBodyText(readSessionEvents(runtime.store, childId));
    return { childId, text, label: call.label };
  };
}

/**
 * Face standing registry → workflow `tools.*` (Code Mode bridge, blocklist applied).
 */
export function createFaceWorkflowToolBridge(
  runtime: FaceRuntime,
): WorkflowToolBridge | undefined {
  const registry = runtime.tools;
  if (!registry) return undefined;
  const inner = createRegistryCodeToolBridge(registry);
  return {
    listNames() {
      return inner.listNames().filter((n) => !WORKFLOW_TOOL_BLOCKLIST.has(n));
    },
    async call(name, args, signal) {
      if (WORKFLOW_TOOL_BLOCKLIST.has(name)) {
        return {
          content: `nested ${name} is not allowed from workflow scripts`,
          isError: true,
        };
      }
      return inner.call(name, args, signal);
    },
  };
}

/**
 * Mount IsolatingWorkflowEngine on a dedicated Cordis Context.
 * Returns `undefined` when the Cordis workflow stub cannot load under Node
 * (missing peers / type-stripping ban under node_modules).
 *
 * @param deps - optional test override for {@link IsolatingWorkflowEngine}
 *   so Vitest can inject the TypeScript source without mocking package exports.
 */
export async function tryMountHostIsolatingWorkflowEngine(
  runtime: FaceRuntime,
  deps?: {
    readonly IsolatingWorkflowEngine?: typeof import("@xrkseek/xrk-workflow").IsolatingWorkflowEngine;
  },
): Promise<HostWorkflowEngineMount | undefined> {
  let IsolatingWorkflowEngine = deps?.IsolatingWorkflowEngine;
  if (IsolatingWorkflowEngine === undefined) {
    try {
      ({ IsolatingWorkflowEngine } = await import("@xrkseek/xrk-workflow"));
    } catch {
      // Missing Cordis peers or Node refusing .ts under node_modules — Host still boots.
      return undefined;
    }
  }
  if (typeof IsolatingWorkflowEngine !== "function") {
    return undefined;
  }
  const ctx = new Context();
  (ctx as { logger?: { warn: (m: string) => void } }).logger = {
    warn: (m) => {
      try {
        console.warn(`[workflowEngine] ${m}`);
      } catch {
        /* ignore */
      }
    },
  };
  const toolBridge = createFaceWorkflowToolBridge(runtime);
  const engine = new IsolatingWorkflowEngine(ctx, {
    createAgent: createFaceWorkflowCreateAgent(runtime),
    ...(toolBridge ? { toolBridge } : {}),
  });
  return {
    provider: "isolating",
    createAgentBridged: true,
    toolsBridged: toolBridge !== undefined,
    engine,
    dispose: async () => {
      try {
        await (ctx as { stop?: () => Promise<void> | void }).stop?.();
      } catch {
        /* Host stop must continue */
      }
    },
  };
}

/** @deprecated Prefer {@link tryMountHostIsolatingWorkflowEngine} (async soft-fail). */
export async function mountHostIsolatingWorkflowEngine(
  runtime: FaceRuntime,
): Promise<HostWorkflowEngineMount> {
  const mount = await tryMountHostIsolatingWorkflowEngine(runtime);
  if (mount === undefined) {
    throw new Error(
      "xrk host: Isolating WorkflowEngine unavailable (Cordis @xrkseek/xrk-workflow failed to load)",
    );
  }
  return mount;
}
