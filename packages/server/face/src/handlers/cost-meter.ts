/**
 * Face Typert remotes for dsh-cost-meter (`costMeter/*`).
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

type TypertOk<T> = { readonly ok: true; readonly value: T };
type TypertFail = {
  readonly ok: false;
  readonly error: Record<string, unknown> & { readonly code: string };
};

function carrierOk<T>(value: T): FaceRpcResult<TypertOk<T>> {
  return { ok: true, value: { ok: true, value } };
}

function carrierBiz(error: TypertFail["error"]): FaceRpcResult<TypertFail> {
  return { ok: true, value: { ok: false, error } };
}

export const costMeterGetStateRemote = async (): Promise<
  FaceRpcResult<TypertOk<ReturnType<typeof costMeterGetState>>>
> => carrierOk(costMeterGetState());

export const costMeterUpdateConfigRemote = async (
  _runtime: unknown,
  payload: unknown,
): Promise<FaceRpcResult<TypertOk<ReturnType<typeof costMeterUpdateConfig>>>> => {
  const args = remoteArgs(payload);
  const patch =
    args.patch && typeof args.patch === "object"
      ? (args.patch as Record<string, unknown>)
      : (args);
  return carrierOk(costMeterUpdateConfig(patch));
};

export const costMeterFetchPricesRemote = async (): Promise<
  FaceRpcResult<TypertOk<ReturnType<typeof costMeterFetchPrices>>>
> => carrierOk(costMeterFetchPrices());

export const costMeterResetHistoryRemote = async (): Promise<
  FaceRpcResult<TypertOk<ReturnType<typeof costMeterResetHistory>>>
> => carrierOk(costMeterResetHistory());

export const costMeterImportLegacyHistoryRemote = async (
  runtime: FaceRuntime,
): Promise<
  FaceRpcResult<TypertOk<ReturnType<typeof costMeterImportLegacyHistoryFromStore>>>
> => carrierOk(
  costMeterImportLegacyHistoryFromStore(runtime.store, runtime.sessionModels),
);

export const costMeterRefreshBalanceRemote = async (): Promise<
  FaceRpcResult<TypertOk<CostMeterRefreshResult>>
> => carrierOk(await costMeterRefreshBalance());

export const costMeterRefreshGoQuotaRemote = async (): Promise<
  FaceRpcResult<TypertOk<CostMeterRefreshResult>>
> => carrierOk(await costMeterRefreshGoQuota());

export const costMeterRefreshCustomBalanceRemote = async (): Promise<
  FaceRpcResult<TypertOk<CostMeterRefreshResult>>
> => carrierOk(await costMeterRefreshCustomBalance());

export const costMeterRefreshCodingPlanRemote = async (
  _runtime: unknown,
  payload: unknown,
): Promise<FaceRpcResult<TypertOk<CostMeterRefreshResult>>> => {
  const args = remoteArgs(payload);
  const provider = String(args.provider ?? args.id ?? "");
  return carrierOk(await costMeterRefreshCodingPlan(provider));
};

export const costMeterGetDaySessionsRemote = async (
  _runtime: unknown,
  payload: unknown,
): Promise<FaceRpcResult<TypertOk<ReturnType<typeof costMeterGetDaySessions>> | TypertFail>> => {
  const args = remoteArgs(payload);
  const date = String(args.date ?? "");
  if (!date) {
    return carrierBiz({
      code: "invalid-payload",
      message: "date required",
    });
  }
  return carrierOk(costMeterGetDaySessions(date));
};

export const costMeterGetTopSessionsRemote = async (
  _runtime: unknown,
  payload: unknown,
): Promise<
  FaceRpcResult<TypertOk<ReturnType<typeof costMeterGetTopSessions>>>
> => {
  const args = remoteArgs(payload);
  const limit = Number(args.limit ?? 20);
  const sort = String(args.sort ?? "cost");
  const dirRaw = String(args.dir ?? "desc");
  const dir = dirRaw === "asc" ? "asc" : "desc";
  return carrierOk(
    costMeterGetTopSessions(
      Number.isFinite(limit) ? limit : 20,
      sort,
      dir,
    ),
  );
};
