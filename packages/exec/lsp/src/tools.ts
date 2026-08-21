import type { ToolDefinition, ToolResultContent } from "@xrkseek/core-tools";
import {
  DEFAULT_LSP_TOOL_TIMEOUT_MS,
  DEFAULT_MAX_LOCATIONS,
  DEFAULT_MAX_RESULT_CHARS,
  formatHover,
  formatLocations,
  parseLspArgs,
  presentLspCall,
  presentLspResult,
} from "./render.js";
import { isLspError, LSP_OPERATIONS, type LspService } from "./types.js";

export function lspUnavailableMessage(env: NodeJS.ProcessEnv = process.env): string {
  if (!String(env.XRK_LSP_COMMAND ?? "").trim()) {
    return "Error: LSP is not configured. Set XRK_LSP_COMMAND to a language server executable (for example typescript-language-server) plus optional XRK_LSP_ARGS.";
  }
  return "Error: LSP is not configured.";
}

export interface CreateLspToolsOptions {
  readonly workspaceRoot: string;
  readonly service?: LspService;
  readonly maxLocations?: number;
  readonly maxResultChars?: number;
  readonly timeoutMs?: number;
  readonly env?: NodeJS.ProcessEnv;
}

function fail(err: unknown): ToolResultContent {
  const message = isLspError(err)
    ? `Error: ${err.message}`
    : `Error: ${err instanceof Error ? err.message : String(err)}`;
  return { content: message, isError: true };
}

export function createLspTools(
  options: CreateLspToolsOptions,
): ToolDefinition[] {
  const maxLocations = options.maxLocations ?? DEFAULT_MAX_LOCATIONS;
  const maxResultChars = options.maxResultChars ?? DEFAULT_MAX_RESULT_CHARS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_LSP_TOOL_TIMEOUT_MS;
  const missing = lspUnavailableMessage(options.env ?? process.env);

  return [
    {
      name: "lsp",
      description:
        "Query a language server for precise code navigation. operation is one of goToDefinition, findReferences, goToImplementation, hover. line and character are one-based UTF-16 cursor coordinates. findReferences includes the declaration.",
      parameters: {
        type: "object",
        properties: {
          operation: {
            type: "string",
            enum: [...LSP_OPERATIONS],
            description:
              "goToDefinition, findReferences, goToImplementation, or hover.",
          },
          file_path: {
            type: "string",
            description:
              "The source file to query, relative to the workspace or absolute inside it.",
          },
          line: {
            type: "number",
            description: "One-based line of the cursor.",
          },
          character: {
            type: "number",
            description: "One-based UTF-16 column of the cursor.",
          },
        },
        required: ["operation", "file_path", "line", "character"],
      },
      async execute(args, signal) {
        const workspaceRoot = options.workspaceRoot.trim();
        if (!workspaceRoot) {
          return {
            content: "Error: the lsp tool requires a session workspace cwd",
            isError: true,
          };
        }
        let input;
        try {
          input = parseLspArgs(args);
        } catch (err) {
          return fail(err);
        }
        if (!options.service) {
          return { content: missing, isError: true };
        }
        const timeout = AbortSignal.timeout(timeoutMs);
        const combined = signal
          ? AbortSignal.any([signal, timeout])
          : timeout;
        try {
          const result = await options.service.query(
            {
              operation: input.operation,
              filePath: input.filePath,
              position: input.position,
              workspaceRoot,
            },
            combined,
          );
          if (result.kind === "hover") {
            return { content: formatHover(result.hover, maxResultChars) };
          }
          return {
            content: formatLocations(
              result.locations,
              result.resolvedWorkspaceUri,
              maxLocations,
              maxResultChars,
            ),
          };
        } catch (err) {
          return fail(err);
        }
      },
      presentCall: presentLspCall,
      presentResult: presentLspResult,
      isConcurrencySafe: () => true,
    } satisfies ToolDefinition<{
      operation: string;
      file_path: string;
      line: number;
      character: number;
    }>,
  ];
}
