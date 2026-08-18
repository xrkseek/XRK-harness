import type { PolicyEngine } from "@xrkseek/policy";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

export interface McpToolInfo {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
}

export interface McpCallResult {
  readonly content: string;
  readonly isError?: boolean;
}

export interface McpClient {
  readonly serverName: string;
  connect(): Promise<void>;
  listTools(): Promise<readonly McpToolInfo[]>;
  callTool(
    rawName: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<McpCallResult>;
  /**
   * Subscribe to MCP `notifications/tools/list_changed`.
   * Returns unsubscribe. Handlers run sequentially per notification;
   * a throwing handler does not block others.
   */
  onToolsListChanged(
    handler: () => void | Promise<void>,
  ): () => void;
  dispose(): Promise<void>;
}

interface McpClientBase {
  readonly serverName: string;
  readonly policy: PolicyEngine;
  readonly toolCallTimeoutMs?: number;
  /**
   * Advanced / tests: supply a ready transport (e.g. InMemoryTransport).
   * When set, stdio `command` / http `url` are ignored.
   */
  readonly createTransport?: () => Transport | Promise<Transport>;
}

export interface McpStdioOptions extends McpClientBase {
  readonly transport?: "stdio";
  readonly command?: string;
  readonly args?: readonly string[];
  readonly env?: Readonly<Record<string, string>>;
  readonly cwd?: string;
}

export interface McpHttpReconnectionOptions {
  /** Default 2 (SDK). SSE resume only — not a process supervisor. */
  readonly maxRetries?: number;
  readonly initialReconnectionDelay?: number;
  readonly maxReconnectionDelay?: number;
  readonly reconnectionDelayGrowFactor?: number;
}

export interface McpHttpOptions extends McpClientBase {
  readonly transport: "http";
  readonly url: string;
  readonly requestInit?: RequestInit;
  /**
   * Passed to SDK `StreamableHTTPClientTransport`.
   * This is SSE stream resume, not Host process restart or Face MCP settings UI.
   */
  readonly reconnectionOptions?: McpHttpReconnectionOptions;
}

export type McpClientOptions = McpStdioOptions | McpHttpOptions;
