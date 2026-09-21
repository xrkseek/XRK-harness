import type { PolicyEngine } from "@xrkseek/policy";
import type { MessageContent } from "@xrkseek/protocol";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { McpReconnectConfig } from "./reconnect.js";
import type { McpImageAdmission } from "./project-content.js";

export type { McpReconnectConfig } from "./reconnect.js";

/** Live generation health the Host overlay and register disposer observe. */
export type McpConnectionStatus = "connected" | "reconnecting" | "gave-up";

/** Snapshot of the stdio supervisor's current generation. */
export interface McpConnectionState {
  readonly status: McpConnectionStatus;
  /** Consecutive failed attempts in the current outage (reconnect / gave-up). */
  readonly attempt?: number;
  readonly maxAttempts?: number;
}

export interface McpToolAnnotations {
  readonly title?: string;
  /** MCP hint — exact `true` may opt the tool into parallel settle. */
  readonly readOnlyHint?: boolean;
  readonly destructiveHint?: boolean;
  readonly idempotentHint?: boolean;
  readonly openWorldHint?: boolean;
}

export interface McpToolInfo {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
  /** Optional MCP tool annotations (spec tool.annotations). */
  readonly annotations?: McpToolAnnotations;
}

/** One entry from `resources/list`. */
export interface McpResourceInfo {
  readonly uri: string;
  readonly name: string;
  readonly description?: string;
  readonly mimeType?: string;
}

/** One entry from `resources/templates/list`. */
export interface McpResourceTemplateInfo {
  readonly uriTemplate: string;
  readonly name: string;
  readonly description?: string;
  readonly mimeType?: string;
}

/** One page (or drained list) from resources/list or templates/list. */
export interface McpResourceListResult<T> {
  readonly items: readonly T[];
  /** Present only when a single page was requested via `cursor`. */
  readonly nextCursor?: string;
}

/** Contents from `resources/read` (text and/or blob blocks). */
export interface McpResourceContents {
  readonly contents: readonly (
    | {
        readonly uri: string;
        readonly text: string;
        readonly mimeType?: string;
      }
    | {
        readonly uri: string;
        readonly blob: string;
        readonly mimeType?: string;
      }
  )[];
}

export interface McpCallResult {
  /** Model-visible projection (string or admitted ContentBlock[]). */
  readonly content: MessageContent;
  readonly isError?: boolean;
}

export interface McpClient {
  readonly serverName: string;
  connect(): Promise<void>;
  listTools(): Promise<readonly McpToolInfo[]>;
  /**
   * `resources/list`. No resources capability → empty. Without `cursor`,
   * drains pagination (same bound as tools/list). With `cursor`, one page.
   */
  listResources(options?: {
    readonly cursor?: string;
  }): Promise<McpResourceListResult<McpResourceInfo>>;
  /**
   * `resources/templates/list`. No resources capability → empty.
   * Cursor semantics match {@link listResources}.
   */
  listResourceTemplates(options?: {
    readonly cursor?: string;
  }): Promise<McpResourceListResult<McpResourceTemplateInfo>>;
  /** `resources/read` — requires resources capability + policy allow. */
  readResource(uri: string, signal?: AbortSignal): Promise<McpResourceContents>;
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
  onToolsListChanged(handler: () => void | Promise<void>): () => void;
  /** Supervisor health (stdio crash recovery). HTTP stays `connected` unless the Client closes. */
  onConnectionState(handler: (state: McpConnectionState) => void): () => void;
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
  /**
   * Process supervisor after a successful first connect (stdio and HTTP).
   * Default enabled. HTTP also keeps SDK SSE resume via
   * {@link McpHttpOptions.reconnectionOptions}.
   */
  readonly reconnect?: McpReconnectConfig;
  /** Optional supervisor diagnostics (tests / Host logs). */
  readonly onLog?: (level: "info" | "warn" | "error", message: string) => void;
  /**
   * When set, image blocks in tool results may be saved to the AttachmentStore
   * and returned as ContentBlock[] (DSH mcp-client image admission).
   */
  readonly imageAdmission?: McpImageAdmission;
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

/**
 * Supplies authorization headers for the HTTP transport. The device-code
 * token store implements this, refreshing before each (re)connect.
 */
export interface McpHttpAuthProvider {
  headers():
    Promise<Readonly<Record<string, string>>> | Readonly<Record<string, string>>;
}

export interface McpHttpOptions extends McpClientBase {
  readonly transport: "http";
  readonly url: string;
  readonly requestInit?: RequestInit;
  /**
   * Optional bearer-token provider (e.g. {@link McpDeviceTokenStore} from the
   * OAuth device-code flow). `headers()` is awaited before the transport is
   * built and merged onto `requestInit` headers.
   */
  readonly auth?: McpHttpAuthProvider;
  /**
   * Passed to SDK `StreamableHTTPClientTransport`.
   * SSE stream resume only — complementary to the process supervisor
   * (`reconnect`, default enabled for HTTP too).
   */
  readonly reconnectionOptions?: McpHttpReconnectionOptions;
}

export type McpClientOptions = McpStdioOptions | McpHttpOptions;
