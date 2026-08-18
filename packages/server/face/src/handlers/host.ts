import {
  hostCreateDirectory,
  hostListDirectory,
} from "../host-directory.js";
import { canOpenNativePath, hostOpenPath } from "../host-open-path.js";
import { hostPickDirectoryRpc } from "../host-pick-directory.js";
import type { FaceHandler } from "./types.js";

export const hostDescribe: FaceHandler = async (runtime) => {
  const routable = runtime.registry.listRoutable();
  const brands = runtime.registry.listBrands();
  const first = routable.find((r) => r.active) ?? routable[0];
  const brand = first
    ? brands.find((b) => b.id === first.id)
    : undefined;
  return {
    ok: true,
    value: {
      version: runtime.version,
      cwd: runtime.workspaceRoot,
      ...(first ? { provider: first.id } : {}),
      ...(brand?.defaultModel ? { model: brand.defaultModel } : {}),
      attachedSessions: runtime.store.list().length,
      canOpenPath: canOpenNativePath(),
    },
  };
};

export const hostPickDirectory: FaceHandler = async (runtime) =>
  hostPickDirectoryRpc(runtime);

export const hostListDirectoryHandler: FaceHandler = async (
  _runtime,
  _rpcId,
  payload,
) => hostListDirectory(payload);

export const hostCreateDirectoryHandler: FaceHandler = async (
  _runtime,
  _rpcId,
  payload,
) => hostCreateDirectory(payload);

export const hostOpenPathHandler: FaceHandler = async (
  _runtime,
  _rpcId,
  payload,
) => hostOpenPath(payload);
