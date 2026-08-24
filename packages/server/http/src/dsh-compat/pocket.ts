/**
 * dsh-pocket — bridge Cordis pocket RPC to XRK mobile-access + remote runtime.
 */
import type { IncomingMessage } from "node:http";
import {
  readMobileAccessState,
  patchMobileAccessState,
  ensureMobileAccessRunning,
  buildMobileLanUrl,
  listLanIPv4Candidates,
  mint8DigitPin,
} from "./mobile-access.js";
import { getMobileRemoteRuntime, resetMobileRemoteRuntime } from "./mobile-access-remote-runtime.js";
import { honestReady } from "./honest-envelope.js";
import { qrDataUrlForText } from "./pocket-qrcode.js";
import { readXrkPluginInventory } from "../xrk/plugin-services.js";
import { runPluginMutate } from "../xrk/plugin-mutate.js";

export interface PocketOptions {
  readonly xrkHome?: string;
  readonly pluginsDir?: string;
}

function hostPort(req: IncomingMessage | undefined): number {
  const host = req?.headers.host?.trim() ?? "127.0.0.1:8099";
  const raw = host.includes(":") ? host.split(":").pop() : "";
  const port = raw ? Number.parseInt(raw, 10) : 80;
  return Number.isFinite(port) ? port : 8099;
}

function pocketPluginVersion(options: PocketOptions): string {
  const inv = readXrkPluginInventory({
    ...(options.xrkHome ? { xrkHome: options.xrkHome } : {}),
    ...(options.pluginsDir ? { pluginsDir: options.pluginsDir } : {}),
  });
  return inv.installedMap["dsh-pocket"]?.version?.trim() || "0.0.0";
}

function mapTunnelPhase(
  remote: Record<string, unknown>,
): { phase: string; detail?: string; startedAt?: number } {
  const running = remote.running === true;
  const state = typeof remote.state === "string" ? remote.state : "off";
  const errorCode =
    typeof remote.errorCode === "string" ? remote.errorCode : "";
  if (!running) return { phase: "idle" };
  if (state === "needs-login") {
    const loginUrl =
      typeof remote.loginUrl === "string" ? remote.loginUrl : "";
    return {
      phase: "registering",
      detail: loginUrl
        ? `请在浏览器完成 Tailscale 登录：${loginUrl}`
        : "正在注册公网隧道…",
    };
  }
  if (state === "unavailable" || state === "error") {
    if (errorCode === "cpolar_config_missing") {
      return {
        phase: "error",
        detail:
          "cpolar 未配置：在 dashboard.cpolar.com 复制 authtoken，或用 dsh-mobile 远程面板配置；也可改用 Tailscale（无需 cpolar 账号）",
      };
    }
    if (errorCode === "cpolar_component_missing") {
      return {
        phase: "error",
        detail: "cpolar 组件未安装，请先安装组件或改用 Tailscale",
      };
    }
    return {
      phase: "error",
      detail: errorCode || "tunnel_failed",
    };
  }
  if (state === "connecting" || state === "starting") {
    return { phase: "connecting", detail: "正在连接…" };
  }
  if (remote.origin) return { phase: "ready" };
  return { phase: "starting", detail: "正在开启…" };
}

async function remoteSnapshot(
  options: PocketOptions,
  state: ReturnType<typeof readMobileAccessState>,
): Promise<Record<string, unknown>> {
  const runtime = getMobileRemoteRuntime(options.xrkHome);
  await runtime.ensureInitialized(state.instanceId);
  if (runtime.getProvider() !== state.remoteProvider) {
    await runtime.selectProvider(state.remoteProvider);
  }
  return runtime.buildRemotePayload();
}

export async function buildPocketStatus(
  req: IncomingMessage | undefined,
  options: PocketOptions,
  opts: { autoStart?: boolean } = {},
): Promise<Record<string, unknown>> {
  const state =
    opts.autoStart !== false
      ? ensureMobileAccessRunning(options, req)
      : readMobileAccessState(options);
  const remote = await remoteSnapshot(options, state);
  const lanUrl = buildMobileLanUrl(state, req);
  const tunnelUrl =
    typeof remote.origin === "string" && remote.origin ? remote.origin : "";
  const tunnelPhase = mapTunnelPhase(remote);
  const port = hostPort(req);

  return {
    schemaVersion: 1,
    revision: state.running ? 1 : 0,
    state: state.running ? "connected" : "offline",
    proxyRunning: state.running,
    proxyPort: state.running ? port : null,
    dshPort: port,
    desktop: false,
    restartNotice: state.restartNotice === true,
    lanUrl: lanUrl || null,
    lanQr: lanUrl ? qrDataUrlForText(lanUrl, "LAN") : null,
    lanCandidates: listLanIPv4Candidates(),
    lanIpOverride: state.lanIpOverride ?? "",
    lanAuthEnabled: state.lanAuthEnabled !== false,
    lanToken: state.lanToken || null,
    lanPinCustom: state.lanPinCustom === true,
    tunnelRunning: remote.running === true && Boolean(tunnelUrl),
    tunnelUrl: tunnelUrl || null,
    tunnelQr: tunnelUrl ? qrDataUrlForText(tunnelUrl, "Tunnel") : null,
    tunnelState: tunnelPhase,
    accessToken: state.wanToken || state.appKey || null,
    publicPinCustom: state.wanPinCustom === true,
    tunnelStateDetail: tunnelPhase.detail ?? "",
    connected: state.running,
    configured: state.running,
    bots: [],
    totals: { configured: 0, connected: state.running ? 1 : 0 },
    provisioning: null,
    testMessage: null,
    agentPresetCatalog: { defaultId: "", items: [] },
    bot: null,
    health: { state: state.running ? "ok" : "offline" },
    note: state.running
      ? "XRK pocket via mobile-access (same-origin)."
      : "Enable phone access to start pocket on XRK.",
    killHint: `netstat -ano | findstr :${String(port)}`,
    ...honestReady(),
  };
}

export async function handlePocketRpc(
  endpoint: string,
  payload: Record<string, unknown>,
  req: IncomingMessage | undefined,
  options: PocketOptions,
): Promise<unknown> {
  if (
    endpoint === "pocket.status" ||
    endpoint === "status" ||
    endpoint === "" ||
    endpoint === "connection.status"
  ) {
    return buildPocketStatus(req, options);
  }

  if (endpoint === "pocket.version" || endpoint === "version") {
    const version = pocketPluginVersion(options);
    return {
      current: version,
      loaded: version,
      ...honestReady(),
    };
  }

  if (endpoint === "pocket.update") {
    const inv = readXrkPluginInventory({
      ...(options.xrkHome ? { xrkHome: options.xrkHome } : {}),
      ...(options.pluginsDir ? { pluginsDir: options.pluginsDir } : {}),
    });
    const result = await runPluginMutate({
      action: "add",
      spec: "dsh-pocket@latest",
      pluginsDir: inv.pluginsDir,
    });
    return {
      ok: result.ok,
      autoRestart: result.ok,
      output: result.ok
        ? result.stdout.trim() || "updated"
        : result.error ?? result.stderr,
      error: result.ok ? undefined : result.error ?? "update failed",
      ...honestReady(),
    };
  }

  if (endpoint === "pocket.restart") {
    patchMobileAccessState(options, { restartNotice: true });
    return honestReady({ ok: true, restarted: true });
  }

  if (endpoint === "tunnel.start") {
    if (payload.disclaimer !== true) {
      return { ok: false, error: "disclaimer required" };
    }
    const state = ensureMobileAccessRunning(options, req);
    const { ensureFunnelSidecar } = await import(
      "./mobile-access-funnel-sidecar.js"
    );
    try {
      await ensureFunnelSidecar(options.xrkHome);
      resetMobileRemoteRuntime(options.xrkHome);
    } catch (err) {
      throw new Error(
        `Public tunnel component download failed: ${err instanceof Error ? err.message : String(err)}`,
        { cause: err },
      );
    }
    const runtime = getMobileRemoteRuntime(options.xrkHome);
    await runtime.ensureInitialized(state.instanceId);
    if (state.remoteProvider === "cpolar") {
      const component = runtime.cpolarComponent.status();
      if (!component.configured) {
        await runtime.selectProvider("tailscale");
        patchMobileAccessState(options, { remoteProvider: "tailscale" });
      }
    }
    if (!state.wanToken) {
      patchMobileAccessState(options, { wanToken: mint8DigitPin() });
    }
    await runtime.setRemoteEnabled(true);
    patchMobileAccessState(options, { remoteEnabled: true });
    return buildPocketStatus(req, options, { autoStart: false });
  }

  if (endpoint === "tunnel.stop") {
    const state = readMobileAccessState(options);
    const runtime = getMobileRemoteRuntime(options.xrkHome);
    await runtime.ensureInitialized(state.instanceId);
    await runtime.setRemoteEnabled(false);
    patchMobileAccessState(options, { remoteEnabled: false });
    return buildPocketStatus(req, options, { autoStart: false });
  }

  if (endpoint === "token.lanRefresh") {
    const lanToken = mint8DigitPin();
    patchMobileAccessState(options, { lanToken, lanPinCustom: false });
    return honestReady({ lanToken });
  }

  if (endpoint === "lanAuth.setEnabled") {
    const on = payload.on === true;
    patchMobileAccessState(options, { lanAuthEnabled: on });
    return honestReady({ lanAuthEnabled: on });
  }

  if (endpoint === "lan.setOverride") {
    const ip = typeof payload.ip === "string" ? payload.ip.trim() : "";
    patchMobileAccessState(options, { lanIpOverride: ip });
    return buildPocketStatus(req, options, { autoStart: false });
  }

  if (endpoint === "pin.setCustom") {
    const which = payload.which === "public" ? "public" : "lan";
    const value = typeof payload.value === "string" ? payload.value.trim() : "";
    if (!/^\d{8}$/u.test(value)) {
      return { ok: false, error: "pin must be 8 digits" };
    }
    if (which === "public") {
      patchMobileAccessState(options, {
        wanToken: value,
        wanPinCustom: true,
      });
      return honestReady({ pin: value });
    }
    patchMobileAccessState(options, {
      lanToken: value,
      lanPinCustom: true,
    });
    return honestReady({ pin: value });
  }

  if (endpoint === "pocket.start") {
    ensureMobileAccessRunning(options, req);
    return honestReady({ started: true });
  }

  return {
    ok: false,
    endpoint,
    error: `Pocket endpoint not implemented: ${endpoint}`,
  };
}
