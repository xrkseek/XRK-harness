/**
 * Community Host adapter — wires first-party surfaces by path/RPC shape.
 * Layered public exports; extract checklist in PACKAGE.md.
 */
import type { PublicRouteHandlerFn } from "./underlying/public-handler.js";
import type { DshCompatWireOptions } from "./adapter-types.js";
import { ensureDshCompatRegistry } from "./shared-registry.js";
import {
  createMobileAccessGateChecker,
  createMobileAccessGateHandler,
  tryHandleMobileAccessGate,
} from "./mobile-access-gate.js";

export type DshCompatOptions = DshCompatWireOptions;

// —— underlying (extractable primitives) ——
export {
  createXrkDocStore,
  dataPath,
  drainMutatingBody,
  ensureDir,
  httpMethod,
  isMutatingMethod,
  parseJsonBody,
  readBody,
  readJsonFile,
  rpcErr,
  rpcOk,
  sendJson,
  writeJsonFile,
  applyMobileGateDecision,
  classifyRequestHost,
  effectiveRequestHost,
  evaluateMobileGate,
  hostOnly,
  isMobileGateExemptPath,
  type DshUnderlyingModule,
  type Json,
  type MobileGateCredentials,
  type MobileGateDecision,
  type MobileGateMode,
  type MobileGateSnapshot,
  type PublicRouteHandlerFn,
  type RequestHostClass,
  type XrkDocStore,
} from "./underlying/index.js";

export {
  readRevisionedDoc,
  writeRevisionedDoc,
  patchRevisionedDoc,
  type XrkRevisionedDoc,
} from "./xrk-json-store.js";

// —— meta / envelope ——
export { DSH_COMPAT_ADAPTER, tag, hostIncomplete } from "./meta.js";
export {
  honestReady,
  honestHostActionUnavailable,
  imHostActionUnavailable,
  modsearchHostUnavailable,
  genuiHostIncomplete,
  visionHostUnavailable,
  noemaRunnerUnavailable,
  pocketHostIncomplete,
  tongflowStudioUnavailable,
  autoReviewClassifierUnavailable,
} from "./honest-envelope.js";

// —— registry / compose ——
export { createCordisCompatRegistry } from "./cordis-registry.js";
export { XRK_HOST_PROVIDERS } from "./adapter-providers.js";
export type { PluginHostManifest } from "./adapter-types.js";
export {
  ensureDshCompatRegistry,
  appendDshCompatContribution,
  invokeDshCompatRpc,
  resetDshCompatRegistryCache,
} from "./shared-registry.js";
export {
  baselineHttpRoutes,
  baselineRpcRoutes,
  listDshHttpCapabilityPrefixes,
  DSH_HTTP_CAPABILITIES,
} from "./dsh-path-capabilities.js";
export {
  DSH_COMPAT_GENERIC_CAPABILITIES,
  DSH_COMPAT_KNOWN_GAPS,
  listDshCompatGenericIds,
  listDshCompatGapIds,
} from "./dsh-compat-matrix.js";
export {
  registerHonestHttpCatchall,
  handleHonestHttpCatchall,
  shouldHonestHttpCatchall,
} from "./honest-http-catchall.js";
export {
  inferDshCommunityHostManifest,
  isDshCommunityClientPackage,
} from "./dsh-community-infer.js";
export { scanClientHostSurface } from "./dsh-client-scan.js";

// —— settings ——
export {
  createSettingsDocStore,
  handleSettingsEndpoint,
  remoteSettingsDescribe,
  settingsScopeSnapshot,
} from "./settings-store.js";
export { buildMnemonStatus, buildMnemonVersions } from "./mnemon.js";

// —— host plugin entry ——
export {
  createDshCompatHostPlugin,
  ensureDshCompatHostPlugin,
  DSH_COMPAT_HOST_PLUGIN_ID,
  type DshCompatHostPluginOptions,
} from "./create-host-plugin.js";

// —— apply / fiber ——
export {
  createXrkHostApplyContext,
  tryApplyHostModule,
  hasHostApplyEntry,
} from "./xrk-host-apply.js";
export {
  composeApplyBridgeContributions,
  applyHostPackageByName,
  stopHostPackageFiber,
} from "./host-apply-bridge.js";
export {
  startCordisFiber,
  stopCordisFiber,
  isCordisFiberRunning,
  listCordisFiberPackages,
} from "./cordis-fiber-runner.js";
export {
  listHostAppliedPackages,
  isHostApplied,
  getHostApplyRecord,
  resetHostApplyRegistry,
  type HostApplyRecord,
} from "./host-apply-registry.js";
export {
  resetDshCompatUpgrades,
  registerDshCompatUpgrade,
  listDshCompatUpgradePaths,
  attachDshCompatUpgrades,
  type DshCompatUpgradeRoute,
  type DshCompatUpgradeOptions,
} from "./dsh-compat-upgrades.js";

// —— Face / Host bridges (peer injection when extracted) ——
export type { UsageStatsProviderRow } from "./tokenledger.js";
export {
  createTokenLedgerBridgeFromFace,
  type TokenLedgerOptions,
} from "./tokenledger.js";
export {
  createXrkWalletPort,
  mapSessionCostToDsh,
  type WalletFaceBridge,
  type XrkWalletPort,
} from "./wallet.js";
export type { SidebarFaceBridge } from "./sidebar-face-bridge.js";
export {
  syncAutoReviewSlashCommand,
  recordAutoReviewDeny,
} from "./auto-review-http.js";

// —— mobile-access Host contract ——
export {
  createMobileAccessGateChecker,
  createMobileAccessGateHandler,
  tryHandleMobileAccessGate,
};
export {
  injectMobileAccessShellIntoHtml,
  XRK_MOBILE_SHELL_CSS,
} from "./mobile-access.js";

/** Host startup: compose adapters once so upgrade routes exist before first HTTP. */
export async function prewarmDshCompatAdapters(
  options: DshCompatOptions = {},
): Promise<void> {
  await ensureDshCompatRegistry(options);
}

export function createDshCompatPublicHandler(
  options: DshCompatOptions = {},
): PublicRouteHandlerFn {
  return async (req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (await tryHandleMobileAccessGate(req, res, url.pathname, options)) {
      return true;
    }
    const registry = await ensureDshCompatRegistry(options);
    return registry.handle(req, res, url.pathname);
  };
}
