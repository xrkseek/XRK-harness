/**
 * Engine ids and the `XRK_VOICE` CI bypass, shared by the registry and the
 * readiness copy.
 *
 * Kept apart from both so neither has to import the other: `engines.ts` builds
 * Providers, `readiness.ts` only describes them, and the alias table is the
 * single place a bypass spelling is defined.
 */

/** `XRK_VOICE` aliases → engine ids. */
const ENV_ENGINE_ALIASES: Readonly<Record<string, string>> = {
  "1": "openai",
  openai: "openai",
  local: "local",
  sensevoice: "local",
  // TTS spells its local engine `system`; the registry's table lookup falls
  // back to that direction's local engine when the id does not exist there.
  system: "local",
  memory: "memory",
};

/**
 * Resolve the engine id a call should use.
 *
 * A non-empty `XRK_VOICE` is a CI bypass and outranks Settings; anything else
 * falls through to the requested engine, lowercased.
 * @param env - environment to read the bypass from.
 * @param requested - engine id staged by the card.
 * @returns the engine id, or the empty string when neither source names one.
 */
export function resolveEngineId(
  env: NodeJS.ProcessEnv,
  requested: string | undefined,
): string {
  const declared = String(env.XRK_VOICE ?? "").trim().toLowerCase();
  const fromEnv = ENV_ENGINE_ALIASES[declared] ?? declared;
  return (fromEnv !== "" ? fromEnv : (requested ?? ""))
    .trim()
    .toLowerCase();
}
