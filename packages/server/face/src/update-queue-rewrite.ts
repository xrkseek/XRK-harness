/**
 * Rewrite a pending admit while keeping relative FIFO order of the tail.
 * Withdraw + append alone would move the edited item to the end of the queue.
 */

import {
  AdmitNotPendingError,
  admitPrompt,
  listPendingAdmits,
  readSessionEvents,
  withdrawAdmit,
  type AdmitReceipt,
  type SessionStore,
} from "@xrkseek/core-session";
import type { MessageContent, PromptDelivery } from "@xrkseek/protocol";

export type AdmitRpcMaps = {
  readonly admitRpcMap: Map<string, string>;
  readonly rpcAdmitMap: Map<string, string>;
};

function newAdmitId(): string {
  return `admit_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function remaps(
  maps: AdmitRpcMaps,
  oldId: string,
  newId: string,
): void {
  const rpc = maps.admitRpcMap.get(oldId);
  maps.admitRpcMap.delete(oldId);
  if (rpc) {
    maps.admitRpcMap.set(newId, rpc);
    maps.rpcAdmitMap.set(rpc, newId);
  }
}

/**
 * Replace one pending admit's content (and optionally delivery), preserving
 * the FIFO order of every still-pending item after it.
 */
export function rewritePendingAdmit(
  store: SessionStore,
  sessionId: string,
  itemId: string,
  content: MessageContent,
  delivery: PromptDelivery,
  maps: AdmitRpcMaps,
): AdmitReceipt {
  const pending = listPendingAdmits(
    readSessionEvents(store, sessionId),
    sessionId,
  );
  const index = pending.findIndex((row) => row.admitId === itemId);
  if (index < 0) throw new AdmitNotPendingError(itemId);

  const tail = pending.slice(index);
  for (const row of tail) {
    withdrawAdmit(store, sessionId, row.admitId);
  }

  const head = admitPrompt(store, sessionId, content, {
    delivery,
    admitId: newAdmitId(),
  });
  remaps(maps, itemId, head.admitId);

  for (const row of tail.slice(1)) {
    const next = admitPrompt(store, sessionId, row.content, {
      delivery: row.delivery,
      admitId: newAdmitId(),
    });
    remaps(maps, row.admitId, next.admitId);
  }

  return head;
}
