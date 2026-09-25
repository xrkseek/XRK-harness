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
    note: "enabled/stats persistence + classifier seam (heuristic default, plugin or HTTP replace)",
  },
  {
    id: "auto-review-pluggable-classifier",
    coverage: "full",
    genericModule: "auto-review-classifier.ts · auto-review-http.ts · host-feature-bridge.ts",
    note: "Default heuristic; Settings Plugins→Advanced, options.classifier, or XRK_AUTO_REVIEW_CLASSIFIER_URL (fail closed)",
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
    note: "Design CRUD/import + schema/HTML/React tree preview + npm component registry + /api/dsh-genui/prompt toggle",
  },
  {
    id: "genui-browser-runtime",
    coverage: "full",
    genericModule: "genui.ts · genui-browser-runtime.ts (/dsh-genui/runtime.js)",
    note: "Browser ESM: mount/unmount/render · dsh-genui / xrk-genui custom elements · optional /preview fetch",
  },
  {
    id: "mnemon-memory-engine",
    coverage: "full",
    genericModule: "mnemon.ts · mnemon-engine.ts · mnemon-store.ts",
    note: "Document CRUD plus keyword search, mention graph, and memory bodies (not a vector DB)",
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
    note: "Webhook/poll bridge · local WS ingress without env · optional sidecar / outbound WS client (ADR-0006)",
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
    note: "Embedded vector host + optional XRK_MEMORY_EMBED_* / Settings memory-embed sidecar",
  },
  {
    id: "taskflow-external-runtime",
    coverage: "full",
    genericModule:
      "tongflow-node-runtime.ts · tongflow-python-bridge.ts",
    note: "External subprocess + user Python interpreter bridge (ADR-0007)",
  },
  {
    id: "im-vendor-cloud-push",
    coverage: "full",
    genericModule:
      "im-gateway-local-ws.ts · im-gateway-sidecar.ts · im-long-lived-gateway.ts",
    note: "Local /api/im/gateway/ws + relay without XRK_IM_GATEWAY_*; external vendor dial stays optional env",
  },
  {
    id: "tongflow-plugins-install",
    coverage: "full",
    genericModule: "tongflow.ts",
    note: "POST /tongflow/plugins runs xrkh plugin add via runPluginMutate; deleted /plugins/install accepted route stays gone",
  },
] as const;

/**
 * Product gaps / honest stubs that must not be treated as Working.
 * Synced with docs/status.md · docs/community-plugins.md「待补」.
 *
 * coverage semantics:
 * - "missing": DSH ecosystem shape with no landing seat in this repo (real gap).
 * - "honest-stub": deliberately NOT implemented (out of product scope by the
 *   "no third-party Host kernel embedding" boundary); the Host answers with an
 *   honest envelope instead of faking the shape.
 */
export const DSH_COMPAT_KNOWN_GAPS: readonly DshCompatCapabilityRow[] = [
  {
    id: "web-panel-global-registry",
    coverage: "missing",
    genericModule: "client ui-layout seat map (src/client/index.ts SlotMap)",
    note: "DSH 0.1.5-alpha.2+ clients register global panels via `sidebar.panellist` and `main` (`main.conversation`); XRK shell only declares sidebar/conversation/details/shell.overlay seats — panellist registrations have no seat to land in.",
  },
  {
    id: "cordis-dual-half-inspect",
    coverage: "honest-stub",
    genericModule: "cordis-registry · cordis-fiber-runner",
    note: "Official @deepseek-ai/dsh-cordis-host-runner 0.1.6-alpha.2 model-mounted dual-half registry (cordis_inspect_list / cordis_inspect_query + mount/dispose lifecycle) is out of scope: XRK does not embed a third-party Host kernel; fiber fallback stays apply-driven.",
  },
  {
    id: "third-party-di",
    coverage: "honest-stub",
    genericModule: "cordis-registry",
    note: "Full third-party DI for arbitrary cordis services is not a product goal (Host-native /first-party injections only); unknown service references get an honest envelope, never a fake provider.",
  },
] as const;

export function listDshCompatGenericIds(): readonly string[] {
  return DSH_COMPAT_GENERIC_CAPABILITIES.map((r) => r.id);
}

export function listDshCompatGapIds(): readonly string[] {
  return DSH_COMPAT_KNOWN_GAPS.map((r) => r.id);
}
