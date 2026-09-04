/**
 * Community Host capability matrix (generic, not per-plugin).
 * Aligned with docs/status and community-plugins; coverage is XRK first-party depth.
 */
export type DshCompatCoverage = "full" | "bridge" | "honest-stub" | "missing";

export interface DshCompatCapabilityRow {
  readonly id: string;
  readonly coverage: DshCompatCoverage;
  readonly genericModule: string;
  readonly note: string;
}

/** Generic underlying + adapter coverage (not forked per community package). */
export const DSH_COMPAT_GENERIC_CAPABILITIES: readonly DshCompatCapabilityRow[] = [
  {
    id: "http-baseline",
    coverage: "full",
    genericModule: "dsh-path-capabilities + adapter-providers",
    note: "Mount global HTTP capability table once",
  },
  {
    id: "rpc-baseline",
    coverage: "full",
    genericModule: "SPECIAL_RPC + baselineRpcRoutes",
    note: "pocket / mnemon / IM channels / office",
  },
  {
    id: "settings-rpc",
    coverage: "full",
    genericModule: "wire/settings-provider + cordis-settings-fallback",
    note: "*-settings naming + persisted defaults",
  },
  {
    id: "dsh-http-generic",
    coverage: "full",
    genericModule: "generic-dsh-http.ts",
    note: "/_dsh/<pkg>/status|config|…",
  },
  {
    id: "community-root",
    coverage: "full",
    genericModule: "community-root-http.ts",
    note: "Single-segment community slugs e.g. /whale-girl",
  },
  {
    id: "plugin-assets",
    coverage: "full",
    genericModule: "generic-plugin-http.ts",
    note: "/plugins/<id>/… static files + honest JSON APIs",
  },
  {
    id: "bundle-chunks",
    coverage: "full",
    genericModule: "bundle-chunk-stub.ts",
    note: "*/bundle/<chunk>.js staged chunks",
  },
  {
    id: "host-apply-shim",
    coverage: "bridge",
    genericModule: "xrk-host-apply.ts + host-apply-bridge.ts",
    note: "host.mjs apply / createHostContribution + registerUpgrade",
  },
  {
    id: "dsh-upgrade-registry",
    coverage: "bridge",
    genericModule: "dsh-compat-upgrades.ts",
    note: "host.mjs registerUpgrade → HTTP upgrade listener",
  },
  {
    id: "client-scan-infer",
    coverage: "full",
    genericModule: "dsh-client-scan + dsh-community-infer",
    note: "client.js RPC scan + conventional channels",
  },
  {
    id: "honest-http-catchall",
    coverage: "full",
    genericModule: "honest-http-catchall.ts",
    note: "Unlisted GET still JSON (no SPA fallback)",
  },
  {
    id: "honest-rpc-catchall",
    coverage: "full",
    genericModule: "cordis-registry.ts",
    note: "Unregistered channel POST → settings fallback / rpcOk",
  },
  {
    id: "honest-envelope",
    coverage: "full",
    genericModule: "honest-envelope.ts",
    note: "Unified incomplete/ready honest JSON for IM·modsearch·genui·vision·noema·pocket",
  },
  {
    id: "xrk-json-store",
    coverage: "full",
    genericModule: "underlying/doc-store · xrk-json-store · underlying/json-store",
    note: "createXrkDocStore factory + revision envelope",
  },
  {
    id: "underlying-http-kit",
    coverage: "full",
    genericModule: "underlying/http-kit.ts",
    note: "parseJsonBody / httpMethod — read body once",
  },
  {
    id: "harness-connector-jobs",
    coverage: "full",
    genericModule: "harness-connector-store.ts · harness-connector.ts",
    note: "Office job persistence + heartbeat; Face session bridge",
  },
  {
    id: "wallet-memento-modlens",
    coverage: "full",
    genericModule: "wallet.ts · memento.ts · modlens.ts · dream-skin.ts · chat-import.ts",
    note: "xrk-json-store revision docs + CLI discover",
  },
  {
    id: "sidebar-fs-git",
    coverage: "bridge",
    genericModule: "packages/server/http/src/sidebar (Host-native)",
    note: "Not dsh-compat: Host mounts createSidebarPublicHandler; DSH clients share the same /sidebar/* contract",
  },
  {
    id: "wallpaper-skin-market",
    coverage: "full",
    genericModule: "wallpaper.ts · skin-market.ts · xrk-json-store",
    note: "Wallpaper settings + skin-market activation revision docs",
  },
  {
    id: "market-inventory",
    coverage: "bridge",
    genericModule: "market.ts → xrk/plugin-services",
    note: "dsh-market → XRK inventory / CLI deferred",
  },
  {
    id: "tokenledger-usage",
    coverage: "bridge",
    genericModule: "tokenledger + host bridges",
    note: "Face cost-meter / usage-stats aggregation",
  },
  {
    id: "harness-connector",
    coverage: "bridge",
    genericModule: "harness-connector + face bridge",
    note: "Office jobs → session",
  },
  {
    id: "tongflow-canvas",
    coverage: "bridge",
    genericModule:
      "tongflow.ts · tongflow-node-runtime.ts · host-feature-bridge.ts · xrk-json-store",
    note: "Task/asset/project docs + TS node runtime + /tongflow/scan",
  },
  {
    id: "auto-review-settings",
    coverage: "bridge",
    genericModule:
      "auto-review-http.ts · host-feature-bridge.ts · persisted-settings-store",
    note: "enabled/stats persistence + heuristic classify bridge",
  },
  {
    id: "im-channels",
    coverage: "bridge",
    genericModule:
      "im-channels.ts · im-office.ts · im-provision-bridge.ts · im-messaging-bridge.ts",
    note: "connector docs + provision OAuth + message send/list + webhook",
  },
  {
    id: "modsearch-config",
    coverage: "bridge",
    genericModule: "modsearch.ts · host-feature-bridge.ts · xrk-json-store",
    note: "Engine config + local rg/walk search + optional tavily/exa",
  },
  {
    id: "genui-library",
    coverage: "full",
    genericModule: "genui.ts · genui-npm-bridge.ts · host-feature-bridge.ts",
    note: "Design CRUD/import + schema/HTML/React tree preview + npm component registry",
  },
  {
    id: "noema-memory",
    coverage: "bridge",
    genericModule: "noema.ts · host-feature-bridge.ts",
    note: "memory index docs + keyword/embedding.search bridge",
  },
  {
    id: "vision-persist",
    coverage: "bridge",
    genericModule: "vision.ts · host-feature-bridge.ts",
    note: "paste/analyze metadata + OCR heuristic + model-capabilities + screenshot permission",
  },
  {
    id: "mobile-access",
    coverage: "full",
    genericModule:
      "underlying/mobile-gate-kit · mobile-access-gate · mobile-access · mobile-access-local-gateway · pocket",
    note: "Mobile access: pairing · LAN/WAN PIN · remote tunnel HTTP+WS proxy",
  },
  {
    id: "dynamic-cordis-runner",
    coverage: "bridge",
    genericModule:
      "cordis-fiber-runner.ts · face/handlers/cordis-stub.ts · shared-registry.ts",
    note: "Subprocess RPC when in-process host.mjs apply fails; inventory / invoke / runHostHalf",
  },
  {
    id: "im-long-lived-gateway",
    coverage: "bridge",
    genericModule:
      "im-long-lived-gateway.ts · im-vendor-ws-client.ts · im-gateway-sidecar.ts",
    note: "Webhook/poll bridge · sidecar relay · in-process WS client (ADR-0006)",
  },
  {
    id: "cloud-vision-routing",
    coverage: "full",
    genericModule:
      "cloud-vision-routing.ts · cloud-vision-inference.ts · vision.ts",
    note: "OpenAI-compatible · anthropic-messages · gemini-generate vision inference",
  },
  {
    id: "memory-embeddings",
    coverage: "full",
    genericModule:
      "memory-embeddings.ts · embedded-vector-store.ts · noema.ts",
    note: "Embedded vector host + optional XRK_MEMORY_EMBED_* sidecar",
  },
  {
    id: "taskflow-external-runtime",
    coverage: "full",
    genericModule:
      "tongflow-node-runtime.ts · tongflow-python-bridge.ts",
    note: "External subprocess + user Python interpreter bridge (ADR-0007)",
  },
] as const;

/** Reserved product gaps (aligned with docs/community-plugins · docs/status). */
export const DSH_COMPAT_KNOWN_GAPS: readonly DshCompatCapabilityRow[] = [] as const;

export function listDshCompatGenericIds(): readonly string[] {
  return DSH_COMPAT_GENERIC_CAPABILITIES.map((r) => r.id);
}

export function listDshCompatGapIds(): readonly string[] {
  return DSH_COMPAT_KNOWN_GAPS.map((r) => r.id);
}
