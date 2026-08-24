/**
 * Mobile remote tunnel runtime — tailscale funnel + cpolar controllers.
 */
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { dataPath } from "./underlying/json-store.js";
import {
  CpolarComponentManager,
} from "./mobile-access-cpolar-component.js";
import { resolveFunnelSidecarPath } from "./mobile-access-funnel-sidecar.js";
import {
  CpolarRemoteController,
  FunnelRemoteController,
  createRemoteGatewayFactory,
} from "./mobile-access-remote-controllers.js";
import type { LocalMobileGateway } from "./mobile-access-local-gateway.js";

export type RemoteProviderId = "tailscale" | "cpolar";

interface ControlDoc {
  version: number;
  enabled: boolean;
}

interface ProviderDoc {
  version: number;
  provider: RemoteProviderId;
}

function resolveUpstreamUrl(): string {
  const direct = process.env.XRK_SERVE_URL?.trim();
  if (direct) return direct.replace(/\/$/, "");
  const port = process.env.XRK_SERVE_PORT?.trim() || "8099";
  return `http://127.0.0.1:${port}`;
}

async function readJsonFile<T>(file: string, fallback: T): Promise<T> {
  if (!existsSync(file)) return fallback;
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

async function writeJsonAtomic(file: string, data: unknown): Promise<void> {
  const dir = path.dirname(file);
  await import("node:fs/promises").then((fs) => fs.mkdir(dir, { recursive: true }));
  await writeFile(file, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

export class MobileRemoteRuntime {
  private readonly remoteDir: string;
  private readonly tailscaleControlFile: string;
  private readonly cpolarControlFile: string;
  private readonly providerFile: string;
  private readonly tailscaleStateDir: string;
  readonly cpolarComponent: CpolarComponentManager;
  private provider: RemoteProviderId = "tailscale";
  private createGateway!: (
    publicOrigin: string,
    listenPort?: number,
  ) => Promise<LocalMobileGateway>;
  private tailscale!: FunnelRemoteController;
  private cpolar!: CpolarRemoteController;
  private initialized = false;
  private initPromise: Promise<void> | undefined;

  constructor(readonly xrkHome: string | undefined) {
    this.remoteDir = dataPath(xrkHome, "mobile-access", "remote");
    this.tailscaleControlFile = path.join(this.remoteDir, "tailscale", "control.json");
    this.cpolarControlFile = path.join(this.remoteDir, "cpolar", "control.json");
    this.providerFile = path.join(this.remoteDir, "provider.json");
    this.tailscaleStateDir = path.join(this.remoteDir, "tailscale", "state");
    this.cpolarComponent = new CpolarComponentManager(xrkHome);
  }

  async ensureInitialized(instanceId: string): Promise<void> {
    if (this.initialized) return;
    if (this.initPromise) {
      await this.initPromise;
      return;
    }
    this.initPromise = this.doInitialize(instanceId);
    await this.initPromise;
  }

  private async doInitialize(instanceId: string): Promise<void> {
    await this.cpolarComponent.initialize();
    this.createGateway = await createRemoteGatewayFactory(resolveUpstreamUrl());
    const providerDoc = await readJsonFile<ProviderDoc>(this.providerFile, {
      version: 1,
      provider: "tailscale",
    });
    this.provider =
      providerDoc.provider === "cpolar" ? "cpolar" : "tailscale";

    const funnelExe = resolveFunnelSidecarPath(this.xrkHome) ?? "";
    const hostname = `xrk-${instanceId.slice(0, 12)}`;

    this.tailscale = new FunnelRemoteController(
      this.createGateway,
      () => this.loadControl(this.tailscaleControlFile),
      (enabled) => this.saveControl(this.tailscaleControlFile, enabled),
      funnelExe,
      this.tailscaleStateDir,
      hostname,
    );
    this.cpolar = new CpolarRemoteController(
      this.createGateway,
      () => this.loadControl(this.cpolarControlFile),
      (enabled) => this.saveControl(this.cpolarControlFile, enabled),
      this.cpolarComponent.executable,
      this.cpolarComponent.configFile,
      "cn",
    );
    await this.tailscale.initialize();
    await this.cpolar.initialize();
    this.initialized = true;
  }

  private async loadControl(file: string): Promise<boolean> {
    const doc = await readJsonFile<ControlDoc>(file, {
      version: 1,
      enabled: false,
    });
    return doc.enabled === true;
  }

  private async saveControl(file: string, enabled: boolean): Promise<void> {
    await writeJsonAtomic(file, { version: 1, enabled });
  }

  activeController(): FunnelRemoteController | CpolarRemoteController {
    return this.provider === "cpolar" ? this.cpolar : this.tailscale;
  }

  async selectProvider(provider: RemoteProviderId): Promise<void> {
    if (provider === this.provider) return;
    const previous = this.activeController();
    const wasEnabled = previous.status().enabled;
    if (wasEnabled) await previous.setEnabled(false);
    try {
      await writeJsonAtomic(this.providerFile, { version: 1, provider });
      this.provider = provider;
    } catch (err) {
      if (wasEnabled) await previous.setEnabled(true);
      throw err;
    }
  }

  buildRemotePayload(): Record<string, unknown> {
    const active = this.activeController();
    const status = active.status();
    const gateway = active.gateway();
    const tailscaleStatus = this.tailscale.status();
    const cpolarStatus = this.cpolar.status();
    return {
      provider: this.provider,
      running: status.enabled,
      state: status.state,
      ...(status.origin ? { origin: status.origin } : {}),
      ...(status.loginUrl ? { loginUrl: status.loginUrl } : {}),
      ...(status.setupUrl ? { setupUrl: status.setupUrl } : {}),
      ...(status.errorCode ? { errorCode: status.errorCode } : {}),
      ...(gateway
        ? { extensions: gateway.extensionStatus() }
        : {}),
      providers: {
        tailscale: {
          bundled: true,
          running: tailscaleStatus.enabled,
          state: tailscaleStatus.state,
          ...(tailscaleStatus.origin ? { origin: tailscaleStatus.origin } : {}),
          ...(tailscaleStatus.loginUrl
            ? { loginUrl: tailscaleStatus.loginUrl }
            : {}),
        },
        cpolar: {
          bundled: false,
          running: cpolarStatus.enabled,
          state: cpolarStatus.state,
          component: this.cpolarComponent.status(),
        },
      },
    };
  }

  async setRemoteEnabled(enabled: boolean): Promise<Record<string, unknown>> {
    await this.activeController().setEnabled(enabled);
    return this.buildRemotePayload();
  }

  async reconnect(): Promise<Record<string, unknown>> {
    await this.activeController().reconnect();
    return this.buildRemotePayload();
  }

  async resetRemote(): Promise<Record<string, unknown>> {
    await this.activeController().reset();
    return this.buildRemotePayload();
  }

  getProvider(): RemoteProviderId {
    return this.provider;
  }
}

const runtimes = new Map<string, MobileRemoteRuntime>();

export function getMobileRemoteRuntime(
  xrkHome: string | undefined,
): MobileRemoteRuntime {
  const key = dataPath(xrkHome, "mobile-access");
  let rt = runtimes.get(key);
  if (!rt) {
    rt = new MobileRemoteRuntime(xrkHome);
    runtimes.set(key, rt);
  }
  return rt;
}

/** Rebuild controllers after funnel sidecar is downloaded. */
export function resetMobileRemoteRuntime(xrkHome: string | undefined): void {
  runtimes.delete(dataPath(xrkHome, "mobile-access"));
}
