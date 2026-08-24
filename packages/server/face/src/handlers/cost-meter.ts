/**
 * Face Typert remotes for dsh-cost-meter (`costMeter/*`).
 *
 * Wire shape matches DSH community client: one Typert envelope.
 * `remote.costMeter.getState()` → `{ ok: true, value: CostMeterState }`
 * (not a nested `{ ok, value: { ok, value: state } }`).
 */
import type { FaceRpcResult } from "../types.js";
import type { FaceRuntime } from "../context.js";
import { remoteArgs } from "./types.js";
import {
  costMeterFetchPrices,
  costMeterGetDaySessions,
  costMeterGetState,
  costMeterGetTopSessions,
  costMeterRefreshBalance,
  costMeterRefreshCodingPlan,
  costMeterRefreshCustomBalance,
  costMeterRefreshGoQuota,
  costMeterResetHistory,
  costMeterUpdateConfig,
  type CostMeterRefreshResult,
} from "../cost-meter-store.js";
import { costMeterImportLegacyHistoryFromStore } from "../cost-meter-record.js";

function ok<T>(value: T): FaceRpcResult<T> {
  return { ok: true, value };
}

function fail(
  error: { readonly code: string; readonly message: string },
): FaceRpcResult<never> {
  return {
    ok: false,
    error: { code: error.code, message: error.message },
  };
}

export const costMeterGetStateRemote = async (): Promise<
  FaceRpcResult<ReturnType<typeof costMeterGetState>>
> => ok(costMeterGetState());

export const costMeterUpdateConfigRemote = async (
  _runtime: unknown,
  payload: unknown,
): Promise<FaceRpcResult<ReturnType<typeof costMeterUpdateConfig>>> => {
  const args = remoteArgs(payload);
  const patch =
    args.patch && typeof args.patch === "object"
      ? (args.patch as Record<string, unknown>)
      : (args);
  return ok(costMeterUpdateConfig(patch));
};

export const costMeterFetchPricesRemote = async (): Promise<
  FaceRpcResult<ReturnType<typeof costMeterFetchPrices>>
> => ok(costMeterFetchPrices());

export const costMeterResetHistoryRemote = async (): Promise<
  FaceRpcResult<ReturnType<typeof costMeterResetHistory>>
> => ok(costMeterResetHistory());

export const costMeterImportLegacyHistoryRemote = async (
  runtime: FaceRuntime,
): Promise<
  FaceRpcResult<ReturnType<typeof costMeterImportLegacyHistoryFromStore>>
> => ok(
  costMeterImportLegacyHistoryFromStore(runtime.store, runtime.sessionModels),
);

export const costMeterRefreshBalanceRemote = async (): Promise<
  FaceRpcResult<CostMeterRefreshResult>
> => ok(await costMeterRefreshBalance());

export const costMeterRefreshGoQuotaRemote = async (): Promise<
  FaceRpcResult<CostMeterRefreshResult>
> => ok(await costMeterRefreshGoQuota());

export const costMeterRefreshCustomBalanceRemote = async (): Promise<
  FaceRpcResult<CostMeterRefreshResult>
> => ok(await costMeterRefreshCustomBalance());

export const costMeterRefreshCodingPlanRemote = async (
  _runtime: unknown,
  payload: unknown,
): Promise<FaceRpcResult<CostMeterRefreshResult>> => {
  const args = remoteArgs(payload);
  const provider = String(args.provider ?? args.id ?? "");
  return ok(await costMeterRefreshCodingPlan(provider));
};

export const costMeterGetDaySessionsRemote = async (
  _runtime: unknown,
  payload: unknown,
): Promise<FaceRpcResult<ReturnType<typeof costMeterGetDaySessions>>> => {
  const args = remoteArgs(payload);
  const date = String(args.date ?? "");
  if (!date) {
    return fail({
      code: "invalid-payload",
      message: "date required",
    });
  }
  return ok(costMeterGetDaySessions(date));
};

export const costMeterGetTopSessionsRemote = async (
  _runtime: unknown,
  payload: unknown,
): Promise<FaceRpcResult<ReturnType<typeof costMeterGetTopSessions>>> => {
  const args = remoteArgs(payload);
  const limit = Number(args.limit ?? 20);
  const sort = String(args.sort ?? "cost");
  const dirRaw = String(args.dir ?? "desc");
  const dir = dirRaw === "asc" ? "asc" : "desc";
  return ok(
    costMeterGetTopSessions(
      Number.isFinite(limit) ? limit : 20,
      sort,
      dir,
    ),
  );
};
