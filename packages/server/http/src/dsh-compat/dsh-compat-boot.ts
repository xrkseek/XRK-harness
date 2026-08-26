/**
 * Host boot hooks for long-lived dsh-compat services (IM WS · embedded vector index).
 * Called from {@link prewarmDshCompatAdapters}; torn down via {@link shutdownDshCompatServices}.
 */
import type { DshCompatWireOptions } from "./adapter-types.js";
import { probeImGatewaySidecar, readImGatewaySidecarConfig } from "./im-gateway-sidecar.js";
import {
  readImVendorWsUrl,
  startImVendorWsClient,
  stopImVendorWsClient,
} from "./im-vendor-ws-client.js";
import { rebuildEmbeddedVectorIndex } from "./memory-embeddings.js";
import { resolveTongflowPythonCommand } from "./tongflow-python-bridge.js";

export interface DshCompatBootResult {
  readonly embeddedRows: number;
  readonly imWsStarted: boolean;
  readonly imSidecarConfigured: boolean;
  readonly tongflowPythonConfigured: boolean;
}

let activeBoot: { close(): void } | undefined;

/** Start optional background services after adapter registry compose. */
export async function bootDshCompatServices(
  options: DshCompatWireOptions = {},
): Promise<DshCompatBootResult & { close(): void }> {
  const env = process.env;
  const xrkHome = options.xrkHome;
  const embeddedRows = rebuildEmbeddedVectorIndex(xrkHome);

  const wsUrl = readImVendorWsUrl(env);
  let imWsStarted = false;
  if (wsUrl) {
    const state = startImVendorWsClient({
      ...(xrkHome ? { xrkHome } : {}),
      env,
    });
    imWsStarted = state.configured;
  }

  const sidecar = readImGatewaySidecarConfig(env);
  if (sidecar) {
    void probeImGatewaySidecar(sidecar).catch(() => {
      /* best-effort warm probe */
    });
  }

  const boot = {
    embeddedRows,
    imWsStarted,
    imSidecarConfigured: Boolean(sidecar),
    tongflowPythonConfigured: Boolean(resolveTongflowPythonCommand(env, xrkHome)),
    close() {
      stopImVendorWsClient();
    },
  };
  activeBoot = boot;
  return boot;
}

/** Stop boot-time services (Host shutdown / restart). */
export function shutdownDshCompatServices(): void {
  activeBoot?.close();
  activeBoot = undefined;
}
