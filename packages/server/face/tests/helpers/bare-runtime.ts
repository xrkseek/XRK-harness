import {
  admitPrompt,
  createMemorySessionStore,
  type SessionStore,
} from "@xrkseek/core-session";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AgentHandle } from "@xrkseek/core-agent";
import { afterEach } from "vitest";
import {
  createFaceRuntime,
  type CreateFaceRuntimeOptions,
} from "../../src/runtime.js";

/** Temp roots created when callers omit workspaceRoot/productDir. */
const bareTemps: string[] = [];

afterEach(() => {
  for (const d of bareTemps.splice(0)) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      // ignore locked leftovers on Windows
    }
  }
});

/** Shared Face test drain: never busy, never throws. */
export const idleFaceDrain: CreateFaceRuntimeOptions["drain"] = {
  wake() {},
  async cancel() {},
  isActive() {
    return false;
  },
};

export function unusedAgentResolve(): CreateFaceRuntimeOptions["resolveAgent"] {
  return async () => {
    throw new Error("unused");
  };
}

export function admittingAgentResolve(
  store: SessionStore,
): CreateFaceRuntimeOptions["resolveAgent"] {
  return async (sessionId): Promise<AgentHandle> =>
    ({
      admit: (content, opts) => admitPrompt(store, sessionId, content, opts),
      pendingAdmits: () => [],
      danglingPromotedAdmits: () => [],
      hasInboxWork: () => false,
      continueTurn: async () => ({}) as never,
      run: async () => ({}) as never,
      isBusy: () => false,
      abort() {},
      setApprovalHandler() {},
    }) as AgentHandle;
}

export function createBareFaceRuntime(
  options: Omit<
    CreateFaceRuntimeOptions,
    "drain" | "workspaceRoot" | "version" | "resolveAgent"
  > &
    Partial<
      Pick<
        CreateFaceRuntimeOptions,
        "drain" | "workspaceRoot" | "version" | "resolveAgent" | "productDir"
      >
    > & {
      store?: SessionStore;
    } = {},
) {
  const store = options.store ?? createMemorySessionStore();
  let isolated = options.workspaceRoot ?? options.productDir;
  if (!isolated) {
    isolated = mkdtempSync(path.join(tmpdir(), "xrk-face-bare-"));
    bareTemps.push(isolated);
  }
  return createFaceRuntime({
    version: "test",
    drain: idleFaceDrain,
    resolveAgent: unusedAgentResolve(),
    ...options,
    store,
    workspaceRoot: options.workspaceRoot ?? isolated,
    productDir: options.productDir ?? isolated,
  });
}
