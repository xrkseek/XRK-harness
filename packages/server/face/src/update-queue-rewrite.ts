/**
 * Rewrite a pending admit while keeping relative FIFO order of the tail.
 * Withdraw + append alone would move the edited item to the end of the queue.
 *
 * AdmitIds stay stable across rewrite so Face rpc maps and client queue row
 * identity do not churn. `listPendingAdmits` folds chronologically, so
 * withdraw → re-admit with the same id is pending again.
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

  // Preserve durable producer tags (seat / handoff / plugin). Dropping
  // `source` would re-admit as human `kind:"user"` and break 委派方 chrome.
  // Reuse admitIds so admitRpcMap / QueueDock row ids stay put. Stamp rpcId
  // from the live map (or prior receipt) onto the new admitted event for
  // cold reload when maps are rebuilt from the log.
  const head = reAdmit(store, sessionId, {
    admitId: itemId,
    content,
    delivery,
    source: tail[0]?.source,
    rpcId: maps.admitRpcMap.get(itemId) ?? tail[0]?.rpcId,
  });

  for (const row of tail.slice(1)) {
    reAdmit(store, sessionId, {
      admitId: row.admitId,
      content: row.content,
      delivery: row.delivery,
      source: row.source,
      rpcId: maps.admitRpcMap.get(row.admitId) ?? row.rpcId,
    });
  }

  return head;
}

function reAdmit(
  store: SessionStore,
  sessionId: string,
  args: {
    readonly admitId: string;
    readonly content: MessageContent;
    readonly delivery: PromptDelivery;
    readonly source: AdmitReceipt["source"];
    readonly rpcId: string | undefined;
  },
): AdmitReceipt {
  return admitPrompt(store, sessionId, args.content, {
    delivery: args.delivery,
    admitId: args.admitId,
    ...(args.source !== undefined ? { source: args.source } : {}),
    ...(args.rpcId !== undefined ? { rpcId: args.rpcId } : {}),
  });
}
