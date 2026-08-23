import {
  listFileReferenceCandidates,
  listSessionReferenceCandidates,
} from "../reference-discovery.js";
import { resolveSessionCwd } from "../session-cwd.js";
import { remoteArgs, type FaceHandler } from "./types.js";

function sessionFromAgentId(
  runtime: Parameters<FaceHandler>[0],
  agentId: string,
): { ok: true } | { ok: false; error: { code: string; message: string } } {
  if (!agentId) {
    return {
      ok: false,
      error: { code: "invalid-payload", message: "agentId required" },
    };
  }
  if (!runtime.store.has(agentId)) {
    return {
      ok: false,
      error: { code: "session-not-found", message: agentId },
    };
  }
  return { ok: true };
}

/** DSH `fileReferences/list` — workspace path discovery for `@file`. */
export const fileReferencesList: FaceHandler = async (
  runtime,
  _rpcId,
  payload,
) => {
  const args = remoteArgs(payload);
  const agentId = String(args.agentId ?? "");
  const session = sessionFromAgentId(runtime, agentId);
  if (!session.ok) return session;
  const query = String(args.query ?? "");
  const cwd = resolveSessionCwd(runtime, agentId);
  const value = await listFileReferenceCandidates(
    agentId,
    cwd,
    query,
    new AbortController().signal,
  );
  return { ok: true, value };
};

/** DSH `sessionReferenceResolver/candidates` — metadata session mentions. */
export const sessionReferenceResolverCandidates: FaceHandler = async (
  runtime,
  _rpcId,
  payload,
) => {
  const args = remoteArgs(payload);
  const agentId = String(args.agentId ?? "");
  const session = sessionFromAgentId(runtime, agentId);
  if (!session.ok) return session;
  const query = String(args.query ?? "");
  const value = listSessionReferenceCandidates(runtime, agentId, query);
  return { ok: true, value };
};
