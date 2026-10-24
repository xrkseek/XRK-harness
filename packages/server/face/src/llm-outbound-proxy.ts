/**
 * Per-route outbound HTTP proxy for LLM adapters.
 *
 * Resolution (model beats provider; blank model inherits provider):
 * - unset → inherit (model ← provider ← process EnvHttpProxyAgent / direct)
 * - `direct` / `none` / `-` / empty string → force no proxy for this adapter
 * - `http(s)://…` → undici {@link ProxyAgent} for this adapter only
 *
 * Global `HTTP(S)_PROXY` (Host {@link installOutboundHttpProxy}) still applies
 * when both levels inherit.
 */
import { Agent, ProxyAgent, fetch as undiciFetch } from "undici";

/** One resolved outbound preference. */
export type OutboundProxyPreference =
  | { readonly kind: "inherit" }
  | { readonly kind: "direct" }
  | { readonly kind: "url"; readonly url: string };

const DIRECT_TOKENS = new Set(["", "direct", "none", "-", "off", "false"]);

/**
 * Normalize a settings `proxy` string into a preference fragment.
 * @param raw - provider or model `proxy` field.
 */
export function parseOutboundProxyField(
  raw: unknown,
): OutboundProxyPreference | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  if (DIRECT_TOKENS.has(trimmed.toLowerCase())) return { kind: "direct" };
  // Accept http(s) proxies; Clash/V2Ray local ports are the common case.
  if (!/^https?:\/\//i.test(trimmed)) return undefined;
  return { kind: "url", url: trimmed };
}

/**
 * Model preference overrides provider; either may inherit upward.
 * @param modelProxy - model-row `proxy` (higher priority).
 * @param providerProxy - provider-profile `proxy`.
 */
export function resolveOutboundProxyPreference(
  modelProxy: unknown,
  providerProxy: unknown,
): OutboundProxyPreference {
  return (
    parseOutboundProxyField(modelProxy) ??
    parseOutboundProxyField(providerProxy) ?? { kind: "inherit" }
  );
}

const agentByUrl = new Map<string, ProxyAgent>();
let directAgent: Agent | undefined;

function proxyAgentFor(url: string): ProxyAgent {
  const hit = agentByUrl.get(url);
  if (hit) return hit;
  const agent = new ProxyAgent(url);
  agentByUrl.set(url, agent);
  return agent;
}

function directDispatcher(): Agent {
  directAgent ??= new Agent();
  return directAgent;
}

/**
 * Build a `fetch` bound to the resolved preference.
 * `inherit` returns `undefined` so adapters keep `globalThis.fetch`
 * (Host may have installed EnvHttpProxyAgent).
 */
export function fetchForOutboundProxy(
  preference: OutboundProxyPreference,
): typeof fetch | undefined {
  if (preference.kind === "inherit") return undefined;
  const dispatcher =
    preference.kind === "direct"
      ? directDispatcher()
      : proxyAgentFor(preference.url);
  // DOM `fetch` Request vs undici / undici-types Request are not the same
  // nominal type; bridge once at the boundary instead of asserting each call.
  type ProxiedFetch = (
    input: Parameters<typeof fetch>[0],
    init?: object,
  ) => ReturnType<typeof fetch>;
  const dispatch = undiciFetch as unknown as ProxiedFetch;
  return (input, init) => dispatch(input, { ...init, dispatcher });
}
