/**
 * XRK host providers — small fixed capability set.
 * Plugins pick a provider in `xrk.host.json`; the kernel does not list plugins.
 */
import path from "node:path";
import { pathToFileURL } from "node:url";
import type {
  DshCompatWireOptions,
  HostProviderFn,
  HostProviderPartial,
  PluginHostHttpRoute,
  PluginHostRpcRoute,
} from "./adapter-types.js";
import { handleGenericDshHttp } from "./generic-dsh-http.js";
import { stubHttpProvider, stubRpcHandler } from "./wire/stub-handlers.js";
import { settingsRpcProvider } from "./wire/settings-provider.js";
import { handleDshMarketHttp } from "./market.js";
import {
  handleMnemonRead,
  handleMnemonWrite,
  MNEMON_SETTINGS_DEFAULTS,
  MNEMON_UI_SETTINGS_DEFAULTS,
  MNEMON_VIEW_SETTINGS_DEFAULTS,
} from "./mnemon.js";
import { handleDreamSkinHttp } from "./dream-skin.js";
import { handleWallpaperHttp, isWallpaperHttpPath } from "./wallpaper.js";
import { handleSkinMarketHttp } from "./skin-market.js";
import { handleSkinAssetsHttp, isSkinAssetsPath } from "./skin-assets.js";
import { handleDshSkinsHttp, isDshSkinsHttpPath } from "./dsh-skins.js";
import { handleSkinCenterHttp, isSkinCenterPath } from "./skin-center.js";
import { handleUndoHttp } from "./undo.js";
import { handleTokenLedgerHttp } from "./tokenledger.js";
import { handleMobileAccessHttp, isMobileAccessPath } from "./mobile-access.js";
import {
  handleTongflowCanvasHttp,
  handleTongflowMiscHttp,
  handleTongflowStudioHttp,
  isTongflowCanvasPath,
  isTongflowMiscPath,
  isTongflowStudioPath,
} from "./tongflow.js";
import {
  handleVisionRouterHttp,
  handleVisionToolkitHttp,
} from "./vision.js";
import { handleWalletHttp } from "./wallet.js";
import { handleMementoHttp } from "./memento.js";
import { handleModlensHttp } from "./modlens.js";
import { handleNiulaiKwsHttp, isNiulaiKwsPath } from "./niulai-kws.js";
import { handleChatImportHttp } from "./chat-import.js";
import { handleGenuiHttp, isGenuiPath } from "./genui.js";
import { handleNoemaHttp, handleNoemaRpc } from "./noema.js";
import { handlePocketRpc } from "./pocket.js";
import { handleModsearchHttp, handleModsearchRpc, isModsearchPath } from "./modsearch.js";
import { handleUsageStatsHttp, isUsageStatsPath } from "./usage-stats.js";
import { handleTurnRewindHttp, isTurnRewindPath } from "./turn-rewind.js";
import { handleReleasesHttp, isReleasesPath } from "./releases.js";
import {
  handleHarnessConnectorHttp,
  isHarnessConnectorPath,
} from "./harness-connector.js";
import {
  handleAutoReviewHttp,
  isAutoReviewPath,
} from "./auto-review-http.js";
import {
  handleCommunityRootHttp,
  isCommunityRootPath,
} from "./community-root-http.js";
import {
  handlePluginAssetHttp,
  isPluginAssetPath,
} from "./generic-plugin-http.js";
import { handleOfficeRpc } from "./im-office.js";
import { handleImChannelRpc } from "./im-channels.js";
import { handleImMessagingHttp } from "./im-messaging-bridge.js";
import { createPersistedSettingsDocStore } from "./persisted-settings-store.js";
import { handleSettingsEndpoint } from "./settings-store.js";
import { handlePetHttp, isPetHttpPath } from "./pet.js";
import { handleBillingHttp, isBillingPath } from "./billing.js";
import {
  handleSkillsManagerHttp,
  isSkillsManagerPath,
} from "./skills-manager.js";
import {
  handleTaskBoardHttp,
  isTaskBoardPath,
} from "./task-board.js";
import { handleDshSshHttp, isDshSshPath } from "./dsh-ssh.js";
import {
  handleDshContextHttp,
  isDshContextPath,
} from "./dsh-context.js";
import {
  handleDshCodexUiHttp,
  isDshCodexUiPath,
} from "./dsh-codex-ui.js";
import {
  handleRemoteWebUiHttp,
  isRemoteWebUiPath,
} from "./remote-web-ui.js";
import { handleDshUpdateHttp, isDshUpdatePath } from "./dsh-update.js";
import { handleUniverApiHttp, isUniverApiPath } from "./univer-api.js";
import {
  handleMcpConnectorHttp,
  isMcpConnectorPath,
} from "./mcp-connector.js";
import { handleCodeServerHttp, isCodeServerPath } from "./code-server.js";
import { handleImConnectHttp, isImConnectPath } from "./im-connect.js";
import {
  handleMichengaiHttp,
  isMichengaiPath,
  isMichengaiImConnectPath,
} from "./michengai.js";
import {
  handleInstallHttp,
  isInstallPath,
} from "./install.js";
import {
  handleServerDeckHttp,
  isServerDeckPath,
} from "./server-deck.js";
import {
  handleFreeSearchHttp,
  isFreeSearchPath,
} from "./free-search.js";
import {
  handleGitGraphHttp,
  isGitGraphPath,
} from "./git-graph.js";
import {
  handleDshEmailHttp,
  isDshEmailPath,
} from "./dsh-email.js";
import {
  handleDshPetLegacyHttp,
  isDshPetLegacyPath,
} from "./dsh-pet-legacy.js";
import {
  handleTokenUsageStatsHttp,
  isTokenUsageStatsPath,
} from "./token-usage-stats-dash.js";

function prefixMatcher(prefix: string): (pathname: string) => boolean {
  const norm = prefix.endsWith("/") ? prefix : `${prefix}/`;
  return (p) => p === prefix || p.startsWith(norm);
}

export const XRK_HOST_PROVIDERS: Record<string, HostProviderFn> = {
  "xrk-stub": (_ctx, route) =>
    stubHttpProvider(route as PluginHostHttpRoute),

  "xrk-stub-rpc": (ctx, route) => {
    const r = route as PluginHostRpcRoute;
    const kind =
      typeof r.options?.kind === "string" ? r.options.kind : "generic";
    const feature =
      typeof r.options?.feature === "string" ? r.options.feature : "plugin";
    return {
      rpc: {
        [r.channel]: (endpoint, payload) =>
          stubRpcHandler(kind, endpoint, payload, feature, {
            ...(ctx.xrkHome ? { xrkHome: ctx.xrkHome } : {}),
            channel: r.channel,
          }),
      },
    };
  },

  "xrk-settings-rpc": (_ctx, route) =>
    settingsRpcProvider(route as PluginHostRpcRoute),

  "xrk-dsh-http": (ctx, route) => ({
    http: [
      {
        match: prefixMatcher((route as PluginHostHttpRoute).prefix),
        handle: (req, res, pathname) =>
          handleGenericDshHttp(req, res, pathname, {
            ...(ctx.xrkHome ? { xrkHome: ctx.xrkHome } : {}),
          }),
      },
    ],
  }),

  "xrk-market": (ctx, route) => ({
    http: [
      {
        match: prefixMatcher((route as PluginHostHttpRoute).prefix),
        handle: async (req, res, pathname) => {
          const mapped =
            pathname === "/api/dsh-market" ||
            pathname.startsWith("/api/dsh-market/")
              ? pathname.replace(/^\/api\/dsh-market/, "/dsh-market") ||
                "/dsh-market"
              : pathname;
          await handleDshMarketHttp(req, res, mapped, ctx);
          return true;
        },
      },
    ],
  }),

  "xrk-dream-skin": (ctx, route) => ({
    http: [
      {
        match: prefixMatcher((route as PluginHostHttpRoute).prefix),
        handle: (req, res, pathname) =>
          handleDreamSkinHttp(req, res, pathname, ctx),
      },
    ],
  }),

  "xrk-wallpaper": (ctx) => ({
    http: [
      {
        match: isWallpaperHttpPath,
        handle: (req, res, pathname) =>
          handleWallpaperHttp(req, res, pathname, ctx),
      },
    ],
  }),

  "xrk-skin-market": (ctx, route) => ({
    http: [
      {
        match: prefixMatcher((route as PluginHostHttpRoute).prefix),
        handle: (req, res, pathname) =>
          handleSkinMarketHttp(req, res, pathname, ctx),
      },
    ],
  }),

  "xrk-skin-assets": (ctx) => ({
    http: [
      {
        match: isSkinAssetsPath,
        handle: (req, res, pathname) =>
          handleSkinAssetsHttp(req, res, pathname, {
            ...(ctx.pluginsDir ? { pluginsDir: ctx.pluginsDir } : {}),
          }),
      },
    ],
  }),

  "xrk-dsh-skins": (ctx) => ({
    http: [
      {
        match: isDshSkinsHttpPath,
        handle: (req, res, pathname) =>
          handleDshSkinsHttp(req, res, pathname, {
            ...(ctx.pluginsDir ? { pluginsDir: ctx.pluginsDir } : {}),
            ...(ctx.xrkHome ? { xrkHome: ctx.xrkHome } : {}),
          }),
      },
    ],
  }),

  "xrk-skin-center": (ctx) => ({
    http: [
      {
        match: isSkinCenterPath,
        handle: (req, res, pathname) =>
          handleSkinCenterHttp(req, res, pathname, {
            ...(ctx.pluginsDir ? { pluginsDir: ctx.pluginsDir } : {}),
            ...(ctx.xrkHome ? { xrkHome: ctx.xrkHome } : {}),
          }),
      },
    ],
  }),

  "xrk-undo": (ctx, route) => ({
    http: [
      {
        match: prefixMatcher((route as PluginHostHttpRoute).prefix),
        handle: (req, res, pathname) =>
          handleUndoHttp(req, res, pathname, ctx),
      },
    ],
  }),

  "xrk-tokenledger": (ctx, route) => ({
    http: [
      {
        match: prefixMatcher((route as PluginHostHttpRoute).prefix),
        handle: (req, res, pathname) =>
          handleTokenLedgerHttp(req, res, pathname, ctx),
      },
    ],
  }),

  "xrk-mobile-access": (ctx) => ({
    http: [
      {
        match: isMobileAccessPath,
        handle: (req, res, pathname) =>
          handleMobileAccessHttp(req, res, pathname, ctx),
      },
    ],
  }),

  "xrk-tongflow": (ctx, route) => {
    const prefix = (route as PluginHostHttpRoute).prefix;
    const http: Array<{
      match: (pathname: string) => boolean;
      handle: (
        req: import("node:http").IncomingMessage,
        res: import("node:http").ServerResponse,
        pathname: string,
      ) => Promise<boolean>;
    }> = [];
    if (
      prefix.startsWith("/api/") ||
      prefix === "/health" ||
      isTongflowCanvasPath(prefix)
    ) {
      http.push({
        match: isTongflowCanvasPath,
        handle: (req, res, pathname) =>
          handleTongflowCanvasHttp(req, res, pathname, ctx),
      });
    }
    if (prefix === "/tongflow" || prefix.startsWith("/tongflow/")) {
      http.push({
        match: isTongflowStudioPath,
        handle: (req, res, pathname) =>
          handleTongflowStudioHttp(req, res, pathname, ctx),
      });
    }
    if (isTongflowMiscPath(prefix)) {
      http.push({
        match: isTongflowMiscPath,
        handle: (req, res, pathname) =>
          handleTongflowMiscHttp(req, res, pathname, ctx),
      });
    }
    return { http };
  },

  "xrk-modsearch": (ctx, route) => {
    const opts = {
      ...(ctx.xrkHome ? { xrkHome: ctx.xrkHome } : {}),
      ...(ctx.workspaceRoot ? { workspaceRoot: ctx.workspaceRoot } : {}),
      ...(ctx.defaultCwd ? { defaultCwd: ctx.defaultCwd } : {}),
      ...(ctx.resolveSessionCwd
        ? { resolveSessionCwd: ctx.resolveSessionCwd }
        : {}),
    };
    if ("channel" in route) {
      const r = route;
      return {
        rpc: {
          [r.channel]: (endpoint, payload) =>
            handleModsearchRpc(endpoint, payload, opts),
        },
      };
    }
    return {
      http: [
        {
          match: isModsearchPath,
          handle: (req, res, pathname) =>
            handleModsearchHttp(req, res, pathname, opts),
        },
      ],
    };
  },

  "xrk-usage-stats": (ctx) => ({
    http: [
      {
        match: isUsageStatsPath,
        handle: (req, res, pathname) => handleUsageStatsHttp(req, res, pathname, ctx),
      },
    ],
  }),

  "xrk-pet": (ctx) => ({
    http: [
      {
        match: isPetHttpPath,
        handle: (req, res, pathname) =>
          handlePetHttp(req, res, pathname, {
            ...(ctx.pluginsDir ? { pluginsDir: ctx.pluginsDir } : {}),
            ...(ctx.xrkHome ? { xrkHome: ctx.xrkHome } : {}),
          }),
      },
    ],
  }),

  "xrk-billing": (ctx) => ({
    http: [
      {
        match: isBillingPath,
        handle: (req, res, pathname) =>
          handleBillingHttp(req, res, pathname, ctx),
      },
    ],
  }),

  "xrk-skills-manager": (ctx) => ({
    http: [
      {
        match: isSkillsManagerPath,
        handle: (req, res, pathname) =>
          handleSkillsManagerHttp(req, res, pathname, {
            ...(ctx.xrkHome ? { xrkHome: ctx.xrkHome } : {}),
            ...(ctx.workspaceRoot ? { workspaceRoot: ctx.workspaceRoot } : {}),
          }),
      },
    ],
  }),

  "xrk-task-board": (ctx) => ({
    http: [
      {
        match: isTaskBoardPath,
        handle: (req, res, pathname) =>
          handleTaskBoardHttp(req, res, pathname, {
            ...(ctx.xrkHome ? { xrkHome: ctx.xrkHome } : {}),
          }),
      },
    ],
  }),

  "xrk-install": (ctx) => ({
    http: [
      {
        match: isInstallPath,
        handle: (req, res, pathname) =>
          handleInstallHttp(req, res, pathname, {
            ...(ctx.xrkHome ? { xrkHome: ctx.xrkHome } : {}),
            ...(ctx.pluginsDir ? { pluginsDir: ctx.pluginsDir } : {}),
          }),
      },
    ],
  }),

  "xrk-michengai": (ctx) => ({
    http: [
      {
        match: (pathname) =>
          isMichengaiPath(pathname) && !isMichengaiImConnectPath(pathname),
        handle: (req, res, pathname) =>
          handleMichengaiHttp(req, res, pathname, {
            ...(ctx.xrkHome ? { xrkHome: ctx.xrkHome } : {}),
          }),
      },
    ],
  }),

  "xrk-server-deck": (ctx) => ({
    http: [
      {
        match: isServerDeckPath,
        handle: (req, res, pathname) =>
          handleServerDeckHttp(req, res, pathname, {
            ...(ctx.xrkHome ? { xrkHome: ctx.xrkHome } : {}),
          }),
      },
    ],
  }),

  "xrk-dsh-ssh": (ctx) => ({
    http: [
      {
        match: isDshSshPath,
        handle: (req, res, pathname) =>
          handleDshSshHttp(req, res, pathname, {
            ...(ctx.xrkHome ? { xrkHome: ctx.xrkHome } : {}),
          }),
      },
    ],
  }),

  "xrk-dsh-context": (ctx) => ({
    http: [
      {
        match: isDshContextPath,
        handle: (req, res, pathname) =>
          handleDshContextHttp(req, res, pathname, {
            ...(ctx.xrkHome ? { xrkHome: ctx.xrkHome } : {}),
          }),
      },
    ],
  }),

  "xrk-dsh-codex-ui": (ctx) => ({
    http: [
      {
        match: isDshCodexUiPath,
        handle: (req, res, pathname) =>
          handleDshCodexUiHttp(req, res, pathname, {
            ...(ctx.xrkHome ? { xrkHome: ctx.xrkHome } : {}),
          }),
      },
    ],
  }),

  "xrk-remote-web-ui": (ctx) => ({
    http: [
      {
        match: isRemoteWebUiPath,
        handle: (req, res, pathname) =>
          handleRemoteWebUiHttp(req, res, pathname, {
            ...(ctx.xrkHome ? { xrkHome: ctx.xrkHome } : {}),
          }),
      },
    ],
  }),

  "xrk-dsh-update": (ctx) => ({
    http: [
      {
        match: isDshUpdatePath,
        handle: (req, res, pathname) =>
          handleDshUpdateHttp(req, res, pathname, {
            ...(ctx.pluginsDir ? { pluginsDir: ctx.pluginsDir } : {}),
          }),
      },
    ],
  }),

  "xrk-univer-api": (ctx) => ({
    http: [
      {
        match: isUniverApiPath,
        handle: (req, res, pathname) =>
          handleUniverApiHttp(req, res, pathname, {
            ...(ctx.xrkHome ? { xrkHome: ctx.xrkHome } : {}),
          }),
      },
    ],
  }),

  "xrk-mcp-connector": (ctx) => ({
    http: [
      {
        match: isMcpConnectorPath,
        handle: (req, res, pathname) =>
          handleMcpConnectorHttp(req, res, pathname, {
            ...(ctx.pluginsDir ? { pluginsDir: ctx.pluginsDir } : {}),
            ...(ctx.xrkHome ? { xrkHome: ctx.xrkHome } : {}),
          }),
      },
    ],
  }),

  "xrk-code-server": (ctx) => ({
    http: [
      {
        match: isCodeServerPath,
        handle: (req, res, pathname) =>
          handleCodeServerHttp(req, res, pathname, {
            ...(ctx.xrkHome ? { xrkHome: ctx.xrkHome } : {}),
          }),
      },
    ],
  }),

  "xrk-free-search": (ctx) => ({
    http: [
      {
        match: isFreeSearchPath,
        handle: (req, res, pathname) =>
          handleFreeSearchHttp(req, res, pathname, {
            ...(ctx.xrkHome ? { xrkHome: ctx.xrkHome } : {}),
          }),
      },
    ],
  }),

  "xrk-git-graph": (ctx) => ({
    http: [
      {
        match: isGitGraphPath,
        handle: (req, res, pathname) =>
          handleGitGraphHttp(req, res, pathname, {
            ...(ctx.xrkHome ? { xrkHome: ctx.xrkHome } : {}),
            ...(ctx.workspaceRoot ? { workspaceRoot: ctx.workspaceRoot } : {}),
            ...(ctx.defaultCwd ? { defaultCwd: ctx.defaultCwd } : {}),
          }),
      },
    ],
  }),

  "xrk-dsh-email": (ctx) => ({
    http: [
      {
        match: isDshEmailPath,
        handle: (req, res, pathname) =>
          handleDshEmailHttp(req, res, pathname, {
            ...(ctx.xrkHome ? { xrkHome: ctx.xrkHome } : {}),
          }),
      },
    ],
  }),

  "xrk-dsh-pet-legacy": (ctx) => ({
    http: [
      {
        match: isDshPetLegacyPath,
        handle: (req, res, pathname) =>
          handleDshPetLegacyHttp(req, res, pathname, {
            ...(ctx.xrkHome ? { xrkHome: ctx.xrkHome } : {}),
          }),
      },
    ],
  }),

  "xrk-im-connect": (ctx) => ({
    http: [
      {
        match: isImConnectPath,
        handle: (req, res, pathname) =>
          handleImConnectHttp(req, res, pathname, {
            ...(ctx.xrkHome ? { xrkHome: ctx.xrkHome } : {}),
          }),
      },
    ],
  }),

  "xrk-token-usage-stats": (ctx) => ({
    http: [
      {
        match: isTokenUsageStatsPath,
        handle: (req, res, pathname) =>
          handleTokenUsageStatsHttp(req, res, pathname, ctx),
      },
    ],
  }),

  "xrk-turn-rewind": (ctx) => ({
    http: [
      {
        match: isTurnRewindPath,
        handle: (req, res, pathname) =>
          handleTurnRewindHttp(req, res, pathname, {
            ...(ctx.xrkHome ? { xrkHome: ctx.xrkHome } : {}),
            ...(ctx.workspaceRoot ? { workspaceRoot: ctx.workspaceRoot } : {}),
            ...(ctx.defaultCwd ? { defaultCwd: ctx.defaultCwd } : {}),
            ...(ctx.resolveSessionCwd
              ? { resolveSessionCwd: ctx.resolveSessionCwd }
              : {}),
            ...(ctx.sidebarFace ? { sidebarFace: ctx.sidebarFace } : {}),
          }),
      },
    ],
  }),

  "xrk-releases": (ctx) => ({
    http: [
      {
        match: isReleasesPath,
        handle: (req, res, pathname) => handleReleasesHttp(req, res, pathname, ctx),
      },
    ],
  }),

  "xrk-harness-connector": (ctx) => ({
    http: [
      {
        match: isHarnessConnectorPath,
        handle: (req, res, pathname) =>
          handleHarnessConnectorHttp(req, res, pathname, {
            ...(ctx.xrkHome ? { xrkHome: ctx.xrkHome } : {}),
            ...(ctx.onJobAccepted ? { onJobAccepted: ctx.onJobAccepted } : {}),
          }),
      },
    ],
  }),

  "xrk-im-office": (ctx, route) => {
    const r = route as PluginHostRpcRoute;
    const officeOpts = {
      ...(ctx.xrkHome ? { xrkHome: ctx.xrkHome } : {}),
      ...(ctx.policy ? { policy: ctx.policy } : {}),
      ...(ctx.resolvePolicyAsk
        ? { resolvePolicyAsk: ctx.resolvePolicyAsk }
        : {}),
    };
    return {
      rpc: {
        [r.channel]: (endpoint, payload) =>
          handleOfficeRpc(endpoint, payload, officeOpts),
      },
    };
  },

  "xrk-im-channel": (ctx, route) => {
    const r = route as PluginHostRpcRoute;
    const channel =
      typeof r.options?.channel === "string"
        ? `/${r.options.channel}`
        : r.channel;
    const imOpts = {
      ...(ctx.xrkHome ? { xrkHome: ctx.xrkHome } : {}),
    };
    return {
      rpc: {
        [r.channel]: (endpoint, payload) =>
          handleImChannelRpc(channel, endpoint, payload, imOpts),
      },
    };
  },

  "xrk-im-messaging": (ctx, route) => ({
    http: [
      {
        match: prefixMatcher((route as PluginHostHttpRoute).prefix),
        handle: async (req, res, pathname) =>
          (await handleImMessagingHttp(
            req,
            res,
            pathname,
            ctx.xrkHome,
          ))
            ? true
            : false,
      },
    ],
  }),

  "xrk-wallet": (ctx, route) => ({
    http: [
      {
        match: prefixMatcher((route as PluginHostHttpRoute).prefix),
        handle: (req, res, pathname) =>
          handleWalletHttp(req, res, pathname, {
            ...(ctx.xrkHome ? { xrkHome: ctx.xrkHome } : {}),
            ...(ctx.walletPort ? { walletPort: ctx.walletPort } : {}),
          }),
      },
    ],
  }),

  "xrk-memento": (ctx, route) => ({
    http: [
      {
        match: prefixMatcher((route as PluginHostHttpRoute).prefix),
        handle: (req, res, pathname) =>
          handleMementoHttp(req, res, pathname, {
            ...(ctx.xrkHome ? { xrkHome: ctx.xrkHome } : {}),
          }),
      },
    ],
  }),

  "xrk-modlens": (ctx, route) => ({
    http: [
      {
        match: prefixMatcher((route as PluginHostHttpRoute).prefix),
        handle: (req, res, pathname) =>
          handleModlensHttp(req, res, pathname, {
            ...(ctx.xrkHome ? { xrkHome: ctx.xrkHome } : {}),
          }),
      },
    ],
  }),

  "xrk-niulai-kws": (ctx) => ({
    http: [
      {
        match: isNiulaiKwsPath,
        handle: (req, res, pathname) =>
          handleNiulaiKwsHttp(req, res, pathname, {
            ...(ctx.pluginsDir ? { pluginsDir: ctx.pluginsDir } : {}),
          }),
      },
    ],
  }),

  "xrk-community-root": (ctx) => ({
    http: [
      {
        match: isCommunityRootPath,
        handle: (req, res, pathname) =>
          handleCommunityRootHttp(req, res, pathname, {
            ...(ctx.pluginsDir ? { pluginsDir: ctx.pluginsDir } : {}),
            ...(ctx.xrkHome ? { xrkHome: ctx.xrkHome } : {}),
          }),
      },
    ],
  }),

  "xrk-chat-import": (ctx, route) => ({
    http: [
      {
        match: prefixMatcher((route as PluginHostHttpRoute).prefix),
        handle: (req, res, pathname) =>
          handleChatImportHttp(req, res, pathname, {
            ...(ctx.xrkHome ? { xrkHome: ctx.xrkHome } : {}),
          }),
      },
    ],
  }),

  "xrk-genui": (ctx) => ({
    http: [
      {
        match: isGenuiPath,
        handle: (req, res, pathname) =>
          handleGenuiHttp(req, res, pathname, {
            ...(ctx.xrkHome ? { xrkHome: ctx.xrkHome } : {}),
          }),
      },
    ],
  }),

  "xrk-noema": (ctx, route) => {
    const buildOpts = () => ({
      ...(ctx.xrkHome ? { xrkHome: ctx.xrkHome } : {}),
      ...(ctx.resolveMemoryEmbedProduct
        ? { product: ctx.resolveMemoryEmbedProduct() }
        : {}),
    });
    if ("channel" in route) {
      const r = route;
      return {
        rpc: {
          [r.channel]: (endpoint, payload) =>
            handleNoemaRpc(endpoint, payload, buildOpts()),
        },
      };
    }
    return {
      http: [
        {
          match: prefixMatcher((route).prefix),
          handle: (req, res, pathname) =>
            handleNoemaHttp(req, res, pathname, buildOpts()),
        },
      ],
    };
  },

  "xrk-pocket": (ctx, route) => {
    const r = route as PluginHostRpcRoute;
    const pocketOpts = {
      ...(ctx.xrkHome ? { xrkHome: ctx.xrkHome } : {}),
      ...(ctx.pluginsDir ? { pluginsDir: ctx.pluginsDir } : {}),
    };
    return {
      rpc: {
        [r.channel]: (endpoint, payload, req) =>
          handlePocketRpc(endpoint, payload, req, pocketOpts),
      },
    };
  },

  "xrk-vision-http": (ctx) => {
    const visionOpts = {
      ...(ctx.xrkHome ? { xrkHome: ctx.xrkHome } : {}),
    };
    return {
      http: [
        {
          match: (p) => p.startsWith("/_dsh/vision-toolkit/"),
          handle: async (req, res, pathname) => {
            await handleVisionToolkitHttp(req, res, pathname, visionOpts);
            return true;
          },
        },
        {
          match: (p) => p.startsWith("/_dsh/vision-router/"),
          handle: async (req, res, pathname) => {
            await handleVisionRouterHttp(req, res, pathname, visionOpts);
            return true;
          },
        },
      ],
    };
  },

  "xrk-mnemon": (ctx, route) => {
    const mnemonOpts = {
      ...(ctx.xrkHome ? { xrkHome: ctx.xrkHome } : {}),
      ...(ctx.workspaceRoot || ctx.defaultCwd
        ? { workspaceRoot: ctx.workspaceRoot ?? ctx.defaultCwd }
        : {}),
    };
    const mnemonStore = createPersistedSettingsDocStore(
      mnemonOpts.xrkHome,
      "mnemon",
      MNEMON_SETTINGS_DEFAULTS,
    );
    const mnemonUiStore = createPersistedSettingsDocStore(
      mnemonOpts.xrkHome,
      "mnemon-ui",
      MNEMON_UI_SETTINGS_DEFAULTS,
    );
    const mnemonViewStore = createPersistedSettingsDocStore(
      mnemonOpts.xrkHome,
      "mnemon-view",
      MNEMON_VIEW_SETTINGS_DEFAULTS,
    );
    const r = route as PluginHostRpcRoute;
    const handlers: Record<
      string,
      (endpoint: string, payload: Record<string, unknown>) => unknown
    > = {
      "/dsh-mnemon-settings": (endpoint, payload) => {
        const ns =
          typeof payload.namespace === "string" ? payload.namespace : "mnemon";
        const store =
          ns === "mnemon-ui"
            ? mnemonUiStore
            : ns === "mnemon-view"
              ? mnemonViewStore
              : mnemonStore;
        return handleSettingsEndpoint(store, endpoint, payload, "scope-snapshot");
      },
      "/dsh-mnemon-view-settings": (endpoint, payload) =>
        handleSettingsEndpoint(
          mnemonViewStore,
          endpoint,
          payload,
          "scope-snapshot",
        ),
      "/dsh-mnemon-view": (endpoint, payload) =>
        handleMnemonRead(endpoint || "status", mnemonOpts, payload),
      "/dsh-mnemon-activation": () => ({ active: true }),
      "/dsh-mnemon-read": (endpoint, payload) =>
        handleMnemonRead(endpoint, mnemonOpts, payload),
      "/dsh-mnemon-write": (endpoint, payload) =>
        handleMnemonWrite(endpoint, payload, mnemonOpts),
      "/dsh-mnemon-pack": (endpoint, payload) =>
        handleMnemonWrite(endpoint, payload, mnemonOpts),
    };
    const handler = handlers[r.channel];
    return handler ? { rpc: { [r.channel]: handler } } : {};
  },

  "xrk-auto-review": (ctx) => ({
    http: [
      {
        match: isAutoReviewPath,
        handle: (req, res, pathname) =>
          handleAutoReviewHttp(req, res, pathname, {
            ...(ctx.xrkHome ? { xrkHome: ctx.xrkHome } : {}),
            ...(ctx.resolveAutoReviewClassifierProduct
              ? { product: ctx.resolveAutoReviewClassifierProduct() }
              : {}),
          }),
      },
    ],
  }),

  "xrk-plugin-http": (ctx) => ({
    http: [
      {
        match: isPluginAssetPath,
        handle: (req, res, pathname) =>
          handlePluginAssetHttp(req, res, pathname, {
            ...(ctx.pluginsDir ? { pluginsDir: ctx.pluginsDir } : {}),
            ...(ctx.xrkHome ? { xrkHome: ctx.xrkHome } : {}),
          }),
      },
    ],
  }),

  "xrk-module": async (ctx, route, pkgRoot, packageName) => {
    const r = route as PluginHostHttpRoute;
    const entry =
      typeof r.options?.entry === "string" ? r.options.entry : "./host.mjs";
    const href = pathToFileURL(path.join(pkgRoot, entry)).href;
    const mod = (await import(/* @vite-ignore */ href)) as {
      createHostContribution?: (
        c: DshCompatWireOptions,
      ) => HostProviderPartial | Promise<HostProviderPartial>;
    };
    if (typeof mod.createHostContribution !== "function") {
      throw new Error(
        `${packageName}: xrk-module provider requires export createHostContribution(ctx)`,
      );
    }
    return mod.createHostContribution(ctx);
  },
};
