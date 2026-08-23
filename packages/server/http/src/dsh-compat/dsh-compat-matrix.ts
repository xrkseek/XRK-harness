/**
 * DSH 社区兼容器 — 通用能力矩阵（非 per-plugin 清单）。
 * 用于文档、测试与 status 对齐；诚实标出 Cordis 不可嵌入项。
 */
export type DshCompatCoverage = "full" | "bridge" | "honest-stub" | "missing";

export interface DshCompatCapabilityRow {
  readonly id: string;
  readonly coverage: DshCompatCoverage;
  readonly genericModule: string;
  readonly note: string;
}

/** 通用底层 + 兼容器已覆盖（不按包名分叉）。 */
export const DSH_COMPAT_GENERIC_CAPABILITIES: readonly DshCompatCapabilityRow[] = [
  {
    id: "http-baseline",
    coverage: "full",
    genericModule: "dsh-path-capabilities + adapter-providers",
    note: "全局 HTTP 能力表一次挂载",
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
    note: "*-settings 命名约定 + 持久化 defaults",
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
    note: "单段社区 slug `/whale-girl` 等",
  },
  {
    id: "plugin-assets",
    coverage: "full",
    genericModule: "generic-plugin-http.ts",
    note: "/plugins/<id>/… 静态读盘 + API 诚实 JSON",
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
    note: "client.js RPC 扫描 + 约定 channel",
  },
  {
    id: "honest-http-catchall",
    coverage: "full",
    genericModule: "honest-http-catchall.ts",
    note: "未入表 GET 仍 JSON，不落 SPA",
  },
  {
    id: "honest-rpc-catchall",
    coverage: "full",
    genericModule: "cordis-registry.ts",
    note: "未注册 channel POST → settings fallback / rpcOk envelope",
  },
  {
    id: "honest-envelope",
    coverage: "full",
    genericModule: "honest-envelope.ts",
    note: "统一 incomplete / ready / IM·modsearch·genui·vision·noema·pocket 诚实 JSON",
  },
  {
    id: "xrk-json-store",
    coverage: "full",
    genericModule: "underlying/doc-store · xrk-json-store · json-store.ts",
    note: "createXrkDocStore 标准工厂 + revision 信封",
  },
  {
    id: "underlying-http-kit",
    coverage: "full",
    genericModule: "underlying/http-kit.ts",
    note: "parseJsonBody / httpMethod — 避免重复读 body",
  },
  {
    id: "harness-connector-jobs",
    coverage: "full",
    genericModule: "harness-connector-store.ts · harness-connector.ts",
    note: "Office job 持久化 + heartbeat；Face session bridge",
  },
  {
    id: "wallet-memento-modlens",
    coverage: "full",
    genericModule: "wallet.ts · memento.ts · modlens.ts · dream-skin.ts · chat-import.ts",
    note: "xrk-json-store revision 持久化 + CLI discover",
  },
  {
    id: "sidebar-fs-git",
    coverage: "full",
    genericModule: "sidebar-adapter.ts + sidebar-prefs-store",
    note: "FS · git · prefs · upload · bundle",
  },
  {
    id: "wallpaper-skin-market",
    coverage: "full",
    genericModule: "wallpaper.ts · skin-market.ts · xrk-json-store",
    note: "壁纸设置与皮肤市场激活 revision 持久化",
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
    note: "Face cost-meter / usage-stats 聚合",
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
    note: "任务/素材/项目持久化 + TypeScript 节点运行时 + /tongflow/scan",
  },
  {
    id: "auto-review-settings",
    coverage: "bridge",
    genericModule:
      "auto-review-http.ts · host-feature-bridge.ts · persisted-settings-store",
    note: "enabled/stats 持久化 + heuristic classify bridge",
  },
  {
    id: "im-channels",
    coverage: "bridge",
    genericModule:
      "im-channels.ts · im-office.ts · im-provision-bridge.ts · im-messaging-bridge.ts",
    note: "connector 持久化 + provision OAuth + message send/list + webhook ingress",
  },
  {
    id: "modsearch-config",
    coverage: "bridge",
    genericModule: "modsearch.ts · host-feature-bridge.ts · xrk-json-store",
    note: "引擎配置持久化 + local rg/遍历 search + 可选 tavily/exa",
  },
  {
    id: "genui-library",
    coverage: "bridge",
    genericModule: "genui.ts · host-feature-bridge.ts",
    note: "design CRUD/import + schema/HTML/React tree live preview",
  },
  {
    id: "noema-memory",
    coverage: "bridge",
    genericModule: "noema.ts · host-feature-bridge.ts",
    note: "memory 索引持久化 + keyword/embedding.search bridge",
  },
  {
    id: "vision-persist",
    coverage: "bridge",
    genericModule: "vision.ts · host-feature-bridge.ts",
    note: "paste/analyze 元数据 + OCR 启发式 + model-capabilities + screenshot permission bridge",
  },
  {
    id: "mobile-access",
    coverage: "full",
    genericModule: "mobile-access.ts · pocket.ts",
    note: "配对/control/settings；pocket 同源隧道",
  },
  {
    id: "dynamic-cordis-runner",
    coverage: "bridge",
    genericModule:
      "cordis-fiber-runner.ts · face/handlers/cordis-stub.ts · shared-registry.ts",
    note: "Isolated Node subprocess for host.mjs RPC when in-process apply fails; inventory / invoke / runHostHalf",
  },
] as const;

/** Vendor-scale production gaps (bridge covers product wire). */
export const DSH_COMPAT_KNOWN_GAPS: readonly DshCompatCapabilityRow[] = [] as const;

export function listDshCompatGenericIds(): readonly string[] {
  return DSH_COMPAT_GENERIC_CAPABILITIES.map((r) => r.id);
}

export function listDshCompatGapIds(): readonly string[] {
  return DSH_COMPAT_KNOWN_GAPS.map((r) => r.id);
}
