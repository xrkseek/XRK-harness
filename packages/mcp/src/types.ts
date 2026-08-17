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
  dispose(): Promise<void>;
}

export interface McpStdioOptions {
  readonly transport?: "stdio";
  readonly serverName: string;
  readonly policy: PolicyEngine;
  readonly command: string;
  readonly args?: readonly string[];
  readonly env?: Readonly<Record<string, string>>;
  readonly cwd?: string;
  readonly toolCallTimeoutMs?: number;
  /**
   * Advanced / tests: supply a ready transport (e.g. InMemoryTransport).
   * When set, `command` is ignored.
   */
  readonly createTransport?: () => Transport | Promise<Transport>;
}
