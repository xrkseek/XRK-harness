/**
 * Rebuild Face `admitRpcMap` from durable pending `prompt/admitted` rows
 * after Host restart (process Maps are empty).
 *
 * Legacy admits without `rpcId` get a stable synthetic id so queue wire and
 * promote→`user/message` stamping always have an echo identity.
 */

import type { AdmitReceipt } from "@xrkseek/core-session";

/** Synthetic client-echo id for pre-rpcId pending admits. */
export function legacyAdmitRpcId(admitId: string): string {
  return `rpc:legacy:${admitId}`;
}

/** Prefer durable rpcId, else stable legacy synthetic id. */
export function echoRpcForAdmit(row: {
  readonly admitId: string;
  readonly rpcId?: string;
}): string {
  return typeof row.rpcId === "string" && row.rpcId.length > 0
    ? row.rpcId
    : legacyAdmitRpcId(row.admitId);
}

/**
 * Fill `admitRpcMap` (admitId → echo rpcId) and `rpcAdmitMap` (rpc → admitId)
 * from pending receipts. Prefer durable `receipt.rpcId`; otherwise mint
 * {@link legacyAdmitRpcId}.
 */
export function rebuildAdmitRpcMaps(
  pending: readonly AdmitReceipt[],
  maps: {
    readonly admitRpcMap: Map<string, string>;
    readonly rpcAdmitMap: Map<string, string>;
  },
): void {
  for (const row of pending) {
    const rpc = echoRpcForAdmit(row);
    maps.admitRpcMap.set(row.admitId, rpc);
    maps.rpcAdmitMap.set(rpc, row.admitId);
  }
}
