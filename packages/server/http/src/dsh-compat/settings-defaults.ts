/**
 * Default documents for DSH Cordis `*-settings` namespaces.
 * Keeps community settings panels from rendering empty on first open.
 */
import { MNEMON_SETTINGS_DEFAULTS, MNEMON_UI_SETTINGS_DEFAULTS } from "./mnemon.js";

const VISION_ROUTER = {
  enabled: false,
  provider: "",
  model: "",
  routeMode: "auto",
  captureMode: "viewport",
  autoRoute: true,
};

const COST_METER = {
  locale: "auto",
  position: "dock",
  sidebar: true,
  showSessionId: false,
  hideOfficialBalance: false,
  hideTodayCost: false,
  pricingCurrency: "USD",
  currency: "CNY",
  symbol: "¥",
  decimals: 4,
  exchangeRate: 7.2,
  peakEnabled: false,
  peakEffectiveAt: "",
  peakWindows: [],
  peakNotice: true,
  peakAlertEnabled: true,
  peakAlertAhead: 2,
  peakAlertTarget: "both",
  peakAlertPosition: "corner",
  peakAlertWebNotify: false,
  peakStyle: "compact",
  priceMatch: "auto",
  priceOverrides: {},
  priceTableDisplay: {},
  codingPlans: {},
  prices: {
    models: {
      "deepseek-chat": { cacheHit: 0.07, cacheMiss: 0.27, output: 1.1 },
      "deepseek-reasoner": { cacheHit: 0.14, cacheMiss: 0.55, output: 2.19 },
      unknown: { cacheHit: 0.07, cacheMiss: 0.27, output: 1.1 },
    },
    default: { cacheHit: 0.07, cacheMiss: 0.27, output: 1.1 },
    providers: {
      deepseek: {
        models: {
          "deepseek-chat": { cacheHit: 0.07, cacheMiss: 0.27, output: 1.1 },
          "deepseek-reasoner": { cacheHit: 0.14, cacheMiss: 0.55, output: 2.19 },
        },
      },
    },
  },
  historyDays: 180,
  fetchedAt: null,
  priceSource: "bundled",
  budget: {
    enabled: false,
    amount: 100,
    period: "month",
    customStart: null,
    customEnd: null,
    detail: true,
  },
  balance: {
    display: "both",
    refreshMinutes: 5,
    showProgressBar: false,
    budgetCap: null,
    clickHintSeen: false,
  },
  goQuota: {
    enabled: true,
    display: "both",
    refreshMinutes: 15,
    apiKey: "",
    main: "rolling",
    detail: true,
  },
  corner: {
    enabled: false,
    goRolling: true,
    goWeekly: true,
    goMonthly: true,
    budget: true,
  },
  quotaStrip: {
    enabled: false,
    budget: true,
    go: true,
    plans: true,
    promptSeen: false,
  },
  usage: { position: "cost" },
};

/** Namespace → default base document (Cordis settings + Face seed). */
export const DSH_SETTINGS_DEFAULTS: Readonly<
  Record<string, Record<string, unknown>>
> = {
  mnemon: MNEMON_SETTINGS_DEFAULTS,
  "mnemon-ui": MNEMON_UI_SETTINGS_DEFAULTS,
  "vision-router": VISION_ROUTER,
  costMeter: COST_METER,
  tokenLedger: {
    enabled: true,
    displayCurrency: "USD",
    showInSidebar: true,
    accounts: {},
  },
  modlens: {
    provider: "",
    engines: {},
    reuse: {
      claude: false,
      codex: false,
      opencode: false,
      pi: false,
      grok: false,
    },
  },
  modsearch: {
    enabled: true,
    providers: [],
    shortcuts: [],
    defaultProvider: "",
  },
  "noema-memory": {
    enabled: false,
    mode: "local",
    retentionDays: 30,
  },
  "genui-design": {
    enabled: true,
    designs: [],
  },
  "chat-import": {
    enabled: true,
    formats: ["json", "markdown"],
  },
  "wallpaper-engine": {
    enabled: false,
    source: "local",
    playlists: [],
  },
  "settings.dreamSkin": {
    activeSkinId: null,
    skins: {},
  },
  undo: {
    auto: true,
    debounce: 5000,
    keepAuto: 20,
    keepPre: 5,
    autoCleanup: true,
  },
  redo: { enabled: true },
  lyrics: { enabled: false },
  query: { enabled: false },
  text: { enabled: false },
  usagePrompt: { enabled: true },
  "image-generation": { enabled: false, provider: "" },
  market: { registryUrl: "", autoUpdate: false },
  pocket: { enabled: true, sync: false },
  autoReview: { enabled: false },
  poisonGuard: { enabled: false, rules: [] },
};

export function dshSettingsDefaults(
  namespace: string,
): Record<string, unknown> {
  return { ...(DSH_SETTINGS_DEFAULTS[namespace] ?? {}) };
}
