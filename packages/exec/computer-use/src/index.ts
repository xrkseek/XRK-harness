import { createAgentDesktopProvider } from "./agent-desktop.js";
import {
  backgroundInputInstalled,
  composeBackgroundWithCapture,
  createBackgroundInputProvider,
} from "./background.js";
import { createMemoryComputerUseProvider } from "./memory.js";
import { createComputerUseProviderRegistry } from "./registry.js";
import { createWindowsUiAutomationProvider } from "./windows-uia.js";
import type { ComputerUseProviderName, ComputerUseService } from "./types.js";
import { computerUseUnavailableMessage } from "./tools.js";

export {
  ComputerUseError,
  isComputerUseError,
  COMPUTER_USE_ACTIONS,
  type ComputerUseAction,
  type ComputerUseActRequest,
  type ComputerUseActResult,
  type ComputerUseCaptureRequest,
  type ComputerUseCaptureResult,
  type ComputerUseDelivery,
  type ComputerUseElement,
  type ComputerUseErrorCode,
  type ComputerUseFindRequest,
  type ComputerUseProviderName,
  type ComputerUseService,
  type ComputerUseWindow,
} from "./types.js";
export {
  COMPUTER_USE_PROMPT_TEXT,
  DEFAULT_MAX_ELEMENTS,
  DEFAULT_MAX_SNAPSHOT_CHARS,
  buildCaptureResult,
  formatActResult,
  formatAxSnapshot,
  formatCaptureEnvelope,
  formatComputerUseGuidance,
  formatWindowsList,
  type ComputerUseModalityOptions,
} from "./format.js";
export { mapKeysToSendKeys, escapeSendKeys } from "./keys.js";
export {
  createBackgroundInputProvider,
  composeBackgroundWithCapture,
  backgroundInputInstalled,
  type BackgroundInputOptions,
} from "./background.js";
export {
  createComputerUseProviderRegistry,
  type ComputerUseProviderRegistry,
} from "./registry.js";
export {
  createMemoryComputerUseProvider,
  type MemoryComputerUseOptions,
} from "./memory.js";
export {
  createWindowsUiAutomationProvider,
  captureScript,
  DEFAULT_POWERSHELL_TIMEOUT_MS,
  type CaptureScriptOptions,
  type PowerShellRunner,
  type WindowsUiAutomationOptions,
} from "./windows-uia.js";
export {
  createComputerUseTools,
  computerUseUnavailableMessage,
  type ComputerUseScreenshotRef,
  type CreateComputerUseToolsOptions,
} from "./tools.js";
export {
  createAgentDesktopProvider,
  runAgentDesktop,
  type AgentDesktopProviderOptions,
} from "./agent-desktop.js";
export { resolveAgentDesktopBin } from "./resolve-cli.js";

/** Face `computer-use` product modes (Settings SoT). */
export type ComputerUseProductMode =
  | "off"
  | "uia"
  | "background"
  | "agent-desktop";

/** Face `computer-use` product shape. */
export interface ComputerUseProductConfig {
  readonly mode: ComputerUseProductMode;
}

/**
 * Whether Settings / env should mount the `computer_use` tool.
 * `off` (and empty env) → do not register; save + rebuild hot-adds it.
 */
export function isComputerUseEnabled(
  options: {
    readonly env?: NodeJS.ProcessEnv;
    readonly product?: ComputerUseProductConfig;
  } = {},
): boolean {
  const env = options.env ?? process.env;
  const envRaw = String(env.XRK_COMPUTER_USE ?? "").trim().toLowerCase();
  if (envRaw !== "") {
    return envRaw !== "0" && envRaw !== "off" && envRaw !== "false";
  }
  // Face schema default is agent-desktop; missing product (tests / minimal
  // Hosts) stays off so we never invent desktop control without Settings.
  const mode = options.product?.mode ?? "off";
  return (
    mode === "uia" || mode === "background" || mode === "agent-desktop"
  );
}

export interface DefaultComputerUseAccessOptions {
  readonly env?: NodeJS.ProcessEnv;
  /**
   * Face Settings product. Used when `XRK_COMPUTER_USE` is unset
   * (env remains the CI bypass).
   */
  readonly product?: ComputerUseProductConfig;
  /** Force a Provider (tests / Host inject). */
  readonly service?: ComputerUseService;
}

export interface DefaultComputerUseAccess {
  readonly service?: ComputerUseService;
  readonly providerName?: ComputerUseProviderName;
  readonly unavailableMessage: string;
}

function modeFromEnvFlag(flag: string): ComputerUseProductMode | "memory" {
  const raw = flag.trim().toLowerCase();
  if (raw === "memory") return "memory";
  if (raw === "background") return "background";
  if (raw === "agent-desktop" || raw === "desktop") return "agent-desktop";
  if (raw === "1" || raw === "uia") return "uia";
  if (raw === "0" || raw === "off" || raw === "false") return "off";
  return "off";
}

/**
 * Resolve a desktop computer-use Provider.
 * - Injected `service` wins (name `memory` unless the service id is uia/background).
 * - Non-empty `XRK_COMPUTER_USE` is CI bypass over Face `product`.
 * - Product / env: `off` · `uia` (`1`) · `background` · `memory` (env-only).
 * - Else no service — harness must **not** register `computer_use` (hot unload).
 */
export function createDefaultComputerUseAccess(
  options: DefaultComputerUseAccessOptions = {},
): DefaultComputerUseAccess {
  const env = options.env ?? process.env;
  const unavailableMessage = computerUseUnavailableMessage(env, options.product);
  const registry = createComputerUseProviderRegistry();
  if (options.service) {
    const id = options.service.providerId;
    const name: ComputerUseProviderName =
      id === "uia" ||
      id === "background" ||
      id === "memory" ||
      id === "agent-desktop"
        ? id
        : "memory";
    registry.register(name);
    return { service: options.service, providerName: name, unavailableMessage };
  }

  const envRaw = String(env.XRK_COMPUTER_USE ?? "").trim();
  const envBypass = envRaw !== "";
  const resolved = envBypass
    ? modeFromEnvFlag(envRaw)
    : (options.product?.mode ?? "off");

  if (resolved === "memory") {
    registry.register("memory");
    return {
      service: createMemoryComputerUseProvider(),
      providerName: "memory",
      unavailableMessage,
    };
  }
  if (resolved === "agent-desktop") {
    registry.register("agent-desktop");
    return {
      service: createAgentDesktopProvider({ env }),
      providerName: "agent-desktop",
      unavailableMessage,
    };
  }
  if (resolved === "background") {
    registry.register("background");
    const command = env.XRK_COMPUTER_USE_BACKGROUND?.trim();
    const installed = backgroundInputInstalled(env);
    const act = createBackgroundInputProvider(
      installed && command ? { installed: true, command } : { installed: false },
    );
    // Docs + DSH: background owns act; Windows UIA still owns capture/list.
    const capture =
      process.platform === "win32" ? createWindowsUiAutomationProvider() : undefined;
    return {
      service: composeBackgroundWithCapture(act, capture),
      providerName: "background",
      unavailableMessage: installed
        ? unavailableMessage
        : "Error: background helper unavailable — set XRK_COMPUTER_USE_BACKGROUND.",
    };
  }
  if (resolved === "uia" && process.platform === "win32") {
    registry.register("uia");
    return {
      service: createWindowsUiAutomationProvider(),
      providerName: "uia",
      unavailableMessage,
    };
  }
  return { unavailableMessage };
}
