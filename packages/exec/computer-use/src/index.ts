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

export interface DefaultComputerUseAccessOptions {
  readonly env?: NodeJS.ProcessEnv;
  /** Force a Provider (tests / Host inject). */
  readonly service?: ComputerUseService;
}

export interface DefaultComputerUseAccess {
  readonly service?: ComputerUseService;
  readonly providerName?: ComputerUseProviderName;
  readonly unavailableMessage: string;
}

/**
 * Resolve a desktop computer-use Provider.
 * - Injected `service` wins (name `memory` unless the service id is uia/background).
 * - `XRK_COMPUTER_USE=memory` → in-memory Provider.
 * - `XRK_COMPUTER_USE=1` on Windows → UI Automation Provider.
 * - `XRK_COMPUTER_USE=background` → background input. Missing helper → unavailable.
 * - Else no service; tools stay registered and fail honestly.
 */
export function createDefaultComputerUseAccess(
  options: DefaultComputerUseAccessOptions = {},
): DefaultComputerUseAccess {
  const env = options.env ?? process.env;
  const unavailableMessage = computerUseUnavailableMessage(env);
  const registry = createComputerUseProviderRegistry();
  if (options.service) {
    const id = options.service.providerId;
    const name: ComputerUseProviderName =
      id === "uia" || id === "background" || id === "memory" ? id : "memory";
    registry.register(name);
    return { service: options.service, providerName: name, unavailableMessage };
  }
  const flag = String(env.XRK_COMPUTER_USE ?? "").trim().toLowerCase();
  if (flag === "memory") {
    registry.register("memory");
    return {
      service: createMemoryComputerUseProvider(),
      providerName: "memory",
      unavailableMessage,
    };
  }
  if (flag === "background") {
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
  if (flag === "1" && process.platform === "win32") {
    registry.register("uia");
    return {
      service: createWindowsUiAutomationProvider(),
      providerName: "uia",
      unavailableMessage,
    };
  }
  return { unavailableMessage };
}
