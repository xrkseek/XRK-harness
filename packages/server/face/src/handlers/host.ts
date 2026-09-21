import { homedir } from "node:os";
import {
  hostCreateDirectory,
  hostListDirectory,
} from "../host-directory.js";
import { canOpenNativePath, hostOpenPath } from "../host-open-path.js";
import {
  hostListOpenInApps,
  hostOpenInApp,
} from "../host-open-in-app.js";
import { hostPickDirectoryRpc } from "../host-pick-directory.js";
import type { FaceHandler } from "./types.js";

const REMOTE_EXEC_MSG =
  "host path is remote (SSH execution world); native desktop open is unavailable";

export const hostDescribe: FaceHandler = async (runtime) => {
  const routable = runtime.registry.listRoutable();
  const brands = runtime.registry.listBrands();
  const first = routable.find((r) => r.active) ?? routable[0];
  const brand = first
    ? brands.find((b) => b.id === first.id)
    : undefined;
  const remote = runtime.remoteExecution === true;
  return {
    ok: true,
    value: {
      version: runtime.version,
      hostRoot: remote
        ? (runtime.localHostRoot ?? runtime.workspaceRoot)
        : runtime.workspaceRoot,
      cwd: runtime.workspaceRoot,
      home: remote ? runtime.workspaceRoot : homedir(),
      ...(first ? { provider: first.id } : {}),
      ...(brand?.defaultModel ? { model: brand.defaultModel } : {}),
      attachedSessions: runtime.store.list().length,
      // Remote paths are not OS-openable on the Host machine.
      canOpenPath: remote ? false : canOpenNativePath(),
      ...(remote ? { remoteExecution: true as const } : {}),
      ...(runtime.localHostRoot !== undefined
        ? { localHostRoot: runtime.localHostRoot }
        : {}),
      // Agent + sidebar interactive PTY stay host-local; off when SSH.
      canPty: !remote,
    },
  };
};

export const hostPickDirectory: FaceHandler = async (runtime) => {
  if (runtime.remoteExecution) {
    return {
      ok: false,
      error: {
        code: "directory-picker-unavailable",
        message:
          "OS folder picker unavailable under SSH remote workspace; cwd is fixed by XRK_SSH_WORKSPACE",
      },
    };
  }
  return hostPickDirectoryRpc(runtime);
};

export const hostListDirectoryHandler: FaceHandler = async (
  runtime,
  _rpcId,
  payload,
) => {
  if (runtime.directoryBackend) {
    return runtime.directoryBackend.list(payload);
  }
  return hostListDirectory(payload);
};

export const hostCreateDirectoryHandler: FaceHandler = async (
  runtime,
  _rpcId,
  payload,
) => {
  if (runtime.directoryBackend) {
    return runtime.directoryBackend.create(payload);
  }
  return hostCreateDirectory(payload);
};

export const hostOpenPathHandler: FaceHandler = async (
  runtime,
  _rpcId,
  payload,
) => {
  if (runtime.remoteExecution) {
    return {
      ok: false,
      error: { code: "bad-request", message: REMOTE_EXEC_MSG },
    };
  }
  return hostOpenPath(payload);
};

export const hostListOpenInAppsHandler: FaceHandler = async (runtime) => {
  if (runtime.remoteExecution) {
    return { ok: true, value: { apps: [] as string[] } };
  }
  return hostListOpenInApps();
};

export const hostOpenInAppHandler: FaceHandler = async (
  runtime,
  _rpcId,
  payload,
) => {
  if (runtime.remoteExecution) {
    return {
      ok: false,
      error: { code: "bad-request", message: REMOTE_EXEC_MSG },
    };
  }
  return hostOpenInApp(payload);
};
