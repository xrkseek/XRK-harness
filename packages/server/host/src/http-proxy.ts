/**
 * Install undici's EnvHttpProxyAgent as the process-wide fetch dispatcher when
 * the process exports HTTP(S)/ALL/NO_PROXY. Node's built-in fetch ignores those
 * variables otherwise (LLM, web_*, MCP HTTP). Requires the `undici` package
 * (Host dependency); Node ≥26 may also use `--use-env-proxy` at process start.
 */
import { EnvHttpProxyAgent, setGlobalDispatcher } from "undici";

const PROXY_ENV_KEYS = [
  "HTTP_PROXY",
  "http_proxy",
  "HTTPS_PROXY",
  "https_proxy",
  "ALL_PROXY",
  "all_proxy",
  "NO_PROXY",
  "no_proxy",
] as const;

let installed = false;

/** True when any conventional proxy / bypass env var is non-empty. */
export function hasOutboundProxyEnv(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return PROXY_ENV_KEYS.some((key) => {
    const value = env[key];
    return typeof value === "string" && value.trim() !== "";
  });
}

/**
 * Idempotent: install EnvHttpProxyAgent once per process when proxy env is set.
 * Reads `process.env` (same source undici's agent uses).
 * @returns whether a new dispatcher was installed.
 */
export function installOutboundHttpProxy(): boolean {
  if (installed || !hasOutboundProxyEnv(process.env)) return false;
  setGlobalDispatcher(new EnvHttpProxyAgent());
  installed = true;
  return true;
}

/** Test-only: allow re-install after clearing the latch. */
export function resetOutboundHttpProxyForTests(): void {
  installed = false;
}
