/**
 * Model-facing browser vault tools (Hermes browser_vault_list / fill subset).
 *
 * Opaque handles only — secret bytes never appear in tool results. Fill types
 * into the live {@link BrowserSession} via action=type; the model passes handle
 * + ref, never the secret.
 */

import type { ToolDefinition, ToolResultContent } from "@xrkseek/core-tools";
import type { BrowserSession } from "./browser-session.js";
import { BROWSER_ERROR } from "./browser-tools.js";
import { WebError, isWebError } from "./types.js";

/** One listable vault row — metadata only (Hermes: no password). */
export interface BrowserVaultHandle {
  readonly handle: string;
  readonly label: string;
  /** Optional origin hint (exact match when set on fill). */
  readonly origin?: string;
  readonly kind?: string;
}

export interface BrowserVaultAccess {
  /** Configured handles only — never include empty slots. */
  list(): readonly BrowserVaultHandle[] | Promise<readonly BrowserVaultHandle[]>;
  /**
   * Resolve secret bytes for fill. Must return undefined when missing.
   * Callers must not log or echo the return value into tool results.
   */
  peek(handle: string): string | undefined | Promise<string | undefined>;
}

function fail(err: unknown): ToolResultContent {
  if (isWebError(err)) {
    return {
      content: `Error: ${err.message}`,
      isError: true,
      error: { name: "WebError", code: err.code },
    };
  }
  const message = err instanceof Error ? err.message : String(err);
  return {
    content: `Error: ${message}`,
    isError: true,
    error: { name: "WebError", code: BROWSER_ERROR.CDP },
  };
}

function failArgs(
  message: string,
  code:
    | (typeof BROWSER_ERROR)[keyof typeof BROWSER_ERROR] = BROWSER_ERROR.INVALID_ARGS,
): ToolResultContent {
  return {
    content: `Error: ${message}`,
    isError: true,
    error: { name: "WebError", code },
  };
}

function pageOrigin(url: string): string | undefined {
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
}

/**
 * `browser_vault_list` + `browser_vault_fill` over Face/Host credential vault.
 * Omit from the tool registry when {@link BrowserVaultAccess} is unset.
 */
export function createBrowserVaultTools(
  session: BrowserSession,
  vault: BrowserVaultAccess,
): ToolDefinition[] {
  const listTool: ToolDefinition = {
    name: "browser_vault_list",
    description:
      "List opaque browser-vault handles (label + optional origin). " +
      "Secrets are never returned — pass a handle to browser_vault_fill with a snapshot @eN ref. " +
      "Prefer this over asking the user to paste passwords into chat.",
    parameters: {
      type: "object",
      properties: {},
    },
    async execute() {
      const rows = await vault.list();
      if (rows.length === 0) {
        return {
          content:
            "browser vault: (empty — configure credentials in Settings, then retry)",
        };
      }
      const lines = rows.map((r) => {
        const origin = r.origin ? ` origin=${r.origin}` : "";
        const kind = r.kind ? ` kind=${r.kind}` : "";
        return `- handle=${r.handle} label=${JSON.stringify(r.label)}${kind}${origin}`;
      });
      return { content: `browser vault (${rows.length}):\n${lines.join("\n")}` };
    },
    isConcurrencySafe: () => true,
  };

  const fillTool: ToolDefinition<{
    handle: string;
    ref: string;
  }> = {
    name: "browser_vault_fill",
    description:
      "Fill the current page field (snapshot @eN ref) from an opaque vault handle. " +
      "The secret is typed server-side and never appears in the tool result. " +
      "When the handle has an origin, the open page origin must match exactly.",
    parameters: {
      type: "object",
      properties: {
        handle: {
          type: "string",
          description: "Opaque handle from browser_vault_list.",
        },
        ref: {
          type: "string",
          description: "Element ref from browser_snapshot / browser_open (e1 or @e1).",
        },
      },
      required: ["handle", "ref"],
    },
    async execute(args, signal) {
      const handle = String(args?.handle ?? "").trim();
      const ref = String(args?.ref ?? "").trim();
      if (!handle) return failArgs("handle is required");
      if (!ref) return failArgs("ref is required");

      const rows = await vault.list();
      const meta = rows.find((r) => r.handle === handle);
      if (!meta) {
        return failArgs(`unknown vault handle: ${handle}`, BROWSER_ERROR.VAULT_UNKNOWN);
      }

      let secret: string | undefined;
      try {
        secret = await vault.peek(handle);
      } catch (err) {
        return fail(err);
      }
      if (!secret) {
        return failArgs(
          `vault handle ${handle} has no secret configured`,
          BROWSER_ERROR.VAULT_EMPTY,
        );
      }

      try {
        const snap = await session.snapshot();
        const origin = pageOrigin(snap.url);
        if (meta.origin && origin && meta.origin !== origin) {
          return failArgs(
            `vault origin mismatch: handle bound to ${meta.origin}, page is ${origin}`,
            BROWSER_ERROR.VAULT_ORIGIN,
          );
        }

        const result = await session.act(
          { ref, action: "type", text: secret },
          signal,
        );
        // Never echo secret — only filled_fields / handle / origin / success.
        return {
          content: JSON.stringify({
            success: true,
            handle,
            ref,
            filled_fields: ["value"],
            kind: meta.kind ?? "credential",
            origin: origin ?? null,
            note: result.note,
          }),
        };
      } catch (err) {
        if (err instanceof WebError) return fail(err);
        return fail(err);
      }
    },
    isConcurrencySafe: () => false,
  };

  return [listTool, fillTool];
}
