import type { IncomingMessage, ServerResponse } from "node:http";
import type { ToolDefinition } from "@xrkseek/core-tools";

/** Runtime context passed when a `kind: host` plugin builds its public handler. */
export interface HostWireContext {
  readonly pluginsDir?: string;
  readonly xrkHome?: string;
  readonly workspaceRoot?: string;
  readonly defaultCwd?: string;
  readonly resolveSessionCwd?: (sessionId: string) => string | undefined;
  /** Face bridges injected by Host when wiring public handlers. */
  readonly tokenLedger?: {
    readonly aggregateUsage?: (
      query: { readonly days?: number; readonly site?: string },
    ) => Promise<Record<string, unknown> | undefined>;
    readonly fetchBalance?: (
      account?: string,
    ) => Promise<Record<string, unknown> | undefined>;
    readonly listUsageProviders?: () => Promise<
      readonly {
        readonly id: string;
        readonly displayName?: string;
        readonly configured?: boolean;
        readonly accountMode?: string;
      }[]
    >;
  };
  readonly harnessConnector?: {
    readonly onJobAccepted?: (job: {
      readonly id: string;
      readonly workspace?: string;
      readonly instruction?: string;
    }) => Promise<{ readonly sessionId?: string } | void>;
  };
  /** {@link XrkWalletPort} from `@xrkseek/server-http` — typed at Host wire site. */
  readonly walletPort?: unknown;
}

export type HostPublicHandlerFn = (
  req: IncomingMessage,
  res: ServerResponse,
) => boolean | Promise<boolean>;

/** Prompt section contribution (`kind: "prompt"`). */
export interface PluginPromptSection {
  readonly id: string;
  readonly order?: number;
  readonly content: string | (() => string | Promise<string>);
}

/** Slash command contribution (`kind: "commands"`). */
export interface PluginCommandResult {
  readonly kind: "success" | "error";
  readonly text?: string;
}

export interface PluginCommandContext {
  readonly sessionId: string;
  readonly rawInput: string;
  readonly commandId: string;
}

export interface PluginCommand {
  readonly name: string;
  readonly description: string;
  readonly input?: { readonly hint: string };
  readonly handler: (
    ctx: PluginCommandContext,
  ) => PluginCommandResult | Promise<PluginCommandResult>;
}

/**
 * Process plugin registered with Host / presets.
 * Prefer a known `kind` + contribution field over Host special cases.
 */
export interface RegisteredPlugin {
  readonly id: string;
  readonly kind: string;
  /**
   * When `kind === "tools"`: ToolDefinition contributions.
   * Applied via `applyToolsPlugins` — explicit registry names win.
   */
  readonly tools?: readonly ToolDefinition[];
  /**
   * When `kind === "prompt"`: system prompt sections.
   * Applied via `applyPromptPlugins` — explicit section ids win.
   */
  readonly promptSections?: readonly PluginPromptSection[];
  /**
   * When `kind === "commands"`: slash contributions for Face `commands/*`.
   * Collected via `collectPluginCommands` — first name wins.
   */
  readonly commands?: readonly PluginCommand[];
  /**
   * When `kind === "host"`: claims paths before SPA static (community client
   * plugins expect Cordis Host routes on the product origin).
   */
  readonly createPublicHandler?: (
    ctx: HostWireContext,
  ) => HostPublicHandlerFn;
  dispose?: () => void | Promise<void>;
}
