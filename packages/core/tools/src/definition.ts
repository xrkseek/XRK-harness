import type { ToolResult } from "@xrkseek/protocol";

export interface ToolDefinition<TArgs = unknown> {
  readonly name: string;
  readonly description: string;
  readonly parameters: Record<string, unknown>;
  execute(args: TArgs, signal?: AbortSignal): Promise<ToolResultContent>;
}

export interface ToolResultContent {
  readonly content: string;
  readonly isError?: boolean;
}

export interface ToolRegistry {
  register(tool: ToolDefinition): void;
  /** Overwrite existing registration (new object identity → stale vs prior materialize). */
  replace(tool: ToolDefinition): void;
  unregister(name: string): boolean;
  get(name: string): ToolDefinition | undefined;
  list(): readonly ToolDefinition[];
}

export function createToolRegistry(): ToolRegistry {
  const tools = new Map<string, ToolDefinition>();
  return {
    register(tool) {
      if (tools.has(tool.name)) {
        throw new Error(`tool already registered: ${tool.name}`);
      }
      tools.set(tool.name, tool);
    },
    get(name) {
      return tools.get(name);
    },
    list() {
      return [...tools.values()];
    },
    /** Replace an existing tool (hot-reload / tests). Same name, new instance → materialize stale. */
    replace(tool) {
      if (!tools.has(tool.name)) {
        throw new Error(`tool not registered: ${tool.name}`);
      }
      tools.set(tool.name, tool);
    },
    unregister(name) {
      return tools.delete(name);
    },
  };
}

export function normalizeToolResult(
  callId: string,
  name: string,
  out: ToolResultContent,
): ToolResult {
  return {
    toolCallId: callId,
    name,
    content: out.content,
    ...(out.isError ? { isError: true as const } : {}),
  };
}

export function errorToolResult(
  callId: string,
  name: string,
  content: string,
): ToolResult {
  return {
    toolCallId: callId,
    name,
    content,
    isError: true,
  };
}

/** Freeze result outcome; further mutation throws. */
export function freezeToolResult(result: ToolResult): ToolResult {
  return Object.freeze({ ...result });
}
