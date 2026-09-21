/** Policy plane subjects — tool / provider / mcp / Host sidebar gates. */
export type PolicySubjectKind =
  | "tool.call"
  | "provider.use"
  | "mcp.connect"
  | "mcp.resource"
  /** Native open path / URL (`open.external` · Host open). */
  | "host.open"
  /** Embed remote URL in sidebar browser tab (`browser.probe` before iframe). */
  | "sidebar.embed"
  /** Sidebar workspace file ops (read / write / html preview). */
  | "sidebar.fs"
  /** AI Office connector (`/office` · office-harness.v1). */
  | "office.connect";

/** MCP resource operation gated by Host policy (default allow). */
export type McpResourceAction = "list" | "templates" | "read";

/** Host open target kind for `host.open`. */
export type HostOpenAction = "path" | "url";

/** Sidebar FS op for `sidebar.fs` (cwd sandbox still applies). */
export type SidebarFsOp = "read" | "write" | "html";

export type PolicySubject =
  | {
      readonly kind: "tool.call";
      readonly name: string;
      readonly args?: Record<string, unknown>;
    }
  | {
      readonly kind: "provider.use";
      readonly providerId: string;
    }
  | {
      readonly kind: "mcp.connect";
      readonly serverId: string;
    }
  | {
      readonly kind: "mcp.resource";
      readonly serverId: string;
      readonly action: McpResourceAction;
      /** Present for `action: "read"`. */
      readonly uri?: string;
    }
  | {
      readonly kind: "host.open";
      readonly action: HostOpenAction;
      /** Path or URL string when known. */
      readonly target?: string;
    }
  | {
      readonly kind: "sidebar.embed";
      readonly url: string;
      /** Lowercase scheme without colon (`http` · `https`). */
      readonly scheme?: string;
    }
  | {
      readonly kind: "sidebar.fs";
      readonly op: SidebarFsOp;
      readonly path?: string;
    }
  | {
      readonly kind: "office.connect";
      /** Optional connector / device id when configured. */
      readonly connectorId?: string;
    };

/** Product verdicts. Pipeline maps `ask` via pre-execute approval when wired. */
export type PolicyVerdict = "allow" | "deny" | "ask";

export interface PolicyDecision {
  readonly verdict: PolicyVerdict;
  readonly reason?: string;
  readonly ruleId?: string;
}

/**
 * First matching rule wins (registration order).
 * Return `undefined` to continue to the next rule / defaults.
 */
export interface PolicyRule {
  readonly id: string;
  match(subject: PolicySubject): PolicyDecision | undefined;
}

export interface PolicyEngine {
  evaluate(subject: PolicySubject): PolicyDecision;
}
