import { createStdioLspService } from "./stdio.js";
import type { DisposableLspService } from "./types.js";

export {
  LspError,
  isLspError,
  LSP_OPERATIONS,
  type DisposableLspService,
  type LspErrorCode,
  type LspHover,
  type LspLocation,
  type LspOperation,
  type LspPosition,
  type LspQueryRequest,
  type LspQueryResult,
  type LspRange,
  type LspService,
} from "./types.js";
export {
  encodeMessage,
  MessageDecoder,
} from "./framing.js";
export {
  negotiatePositionEncoding,
  normalizeHover,
  normalizeLocations,
  requestMethod,
  supportsOperation,
  supportsTransientOpen,
} from "./translate.js";
export {
  DEFAULT_LSP_TOOL_TIMEOUT_MS,
  DEFAULT_MAX_LOCATIONS,
  DEFAULT_MAX_RESULT_CHARS,
  LSP_PROMPT_TEXT,
  formatHover,
  formatLocations,
  parseLspArgs,
  presentLspCall,
  presentLspResult,
  renderUri,
} from "./render.js";
export {
  DEFAULT_EXTENSION_TO_LANGUAGE,
  DEFAULT_MAX_DOCUMENT_BYTES,
  DEFAULT_MAX_MESSAGE_BYTES,
  createStdioLspService,
  type StdioLspOptions,
} from "./stdio.js";
export {
  createLspTools,
  lspUnavailableMessage,
  type CreateLspToolsOptions,
} from "./tools.js";

export interface DefaultLspAccessOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly extensionToLanguage?: Readonly<Record<string, string>>;
}

export interface DefaultLspAccess {
  readonly service?: DisposableLspService;
  readonly unavailableMessage: string;
}

function splitArgs(raw: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("[")) {
    const parsed: unknown = JSON.parse(trimmed);
    if (!Array.isArray(parsed) || parsed.some((x) => typeof x !== "string")) {
      throw new Error("XRK_LSP_ARGS must be a JSON string array");
    }
    return parsed;
  }
  return trimmed.split(/\s+/);
}

export function resolveLspCommand(
  env: NodeJS.ProcessEnv = process.env,
): { readonly command: string; readonly args: readonly string[] } | undefined {
  const command = String(env.XRK_LSP_COMMAND ?? "").trim();
  if (!command) return undefined;
  return {
    command,
    args: splitArgs(String(env.XRK_LSP_ARGS ?? "")),
  };
}

/** Stdio language server when `XRK_LSP_COMMAND` is set; otherwise no service. */
export function createDefaultLspAccess(
  options: DefaultLspAccessOptions = {},
): DefaultLspAccess {
  const env = options.env ?? process.env;
  const launch = resolveLspCommand(env);
  const unavailableMessage = launch
    ? "Error: LSP is not configured."
    : "Error: LSP is not configured. Set XRK_LSP_COMMAND to a language server executable (for example typescript-language-server) plus optional XRK_LSP_ARGS.";
  if (!launch) {
    return { unavailableMessage };
  }
  const service = createStdioLspService({
    command: launch.command,
    args: launch.args,
    env,
    ...(options.extensionToLanguage
      ? { extensionToLanguage: options.extensionToLanguage }
      : {}),
  });
  return { service, unavailableMessage };
}

export function createLspServiceFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): DisposableLspService | undefined {
  return createDefaultLspAccess({ env }).service;
}
