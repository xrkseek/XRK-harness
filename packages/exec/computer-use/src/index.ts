import { createBackgroundInputProvider, backgroundInputInstalled } from "./background.js";
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
  type ComputerUseProviderName,
  type ComputerUseService,
  type ComputerUseWindow,
} from "./types.js";
export {
  COMPUTER_USE_PROMPT_TEXT,
  DEFAULT_MAX_ELEMENTS,
  DEFAULT_MAX_SNAPSHOT_CHARS,
  buildCaptureResult,
  formatAxSnapshot,
  formatWindowsList,
} from "./format.js";
export { mapKeysToSendKeys } from "./keys.js";
export {
  createBackgroundInputProvider,
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
  type PowerShellRunner,
  type WindowsUiAutomationOptions,
} from "./windows-uia.js";
export {
  createComputerUseTools,
  computerUseUnavailableMessage,
  type CreateComputerUseToolsOptions,
} from "./tools.js";

/** Face `computer-use` product modes (Settings SoT). */
export type ComputerUseProductMode = "off" | "uia" | "background";

/** Face `computer-use` product shape. */
export interface ComputerUseProductConfig {
  readonly mode: ComputerUseProductMode;
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
  if (raw === "1" || raw === "uia") return "uia";
  return "off";
}

/**
 * Resolve a desktop computer-use Provider.
 * - Injected `service` wins (name `memory` unless the service id is uia/background).
 * - Non-empty `XRK_COMPUTER_USE` is CI bypass over Face `product`.
 * - Product / env: `off` · `uia` (`1`) · `background` · `memory` (env-only).
 * - Else no service; tools stay registered and fail honestly.
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
      id === "uia" || id === "background" || id === "memory" ? id : "memory";
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
  if (resolved === "background") {
    registry.register("background");
    const command = env.XRK_COMPUTER_USE_BACKGROUND?.trim();
    const installed = backgroundInputInstalled(env);
    return {
      service: createBackgroundInputProvider(
        installed && command ? { installed: true, command } : { installed: false },
      ),
      providerName: "background",
      unavailableMessage: installed
        ? unavailableMessage
        : "Error: background input backend unavailable (not installed).",
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
