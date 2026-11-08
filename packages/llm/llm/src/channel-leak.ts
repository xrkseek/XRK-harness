/**
 * Harmony / free-lane channel markers that sometimes leak into tool args.
 * Persisting them poisons the session: later requests replay the leak and
 * free-lane gateways answer with INVALID_REQUEST.
 *
 * Markers seen in the wild (beam-free):
 *   <|channel|>analysis <|message|> … <|end|><|start|> …
 *   </rfl:parameter> / <rfl:parameter …>
 */

const CHANNEL_LEAK_RE =
  /<\|(?:start|end|channel|message|constrain)\|[^>]*>|<\/?rfl:parameter(?:\s[^>]*)?>|<\|[^|>]{1,64}\|>/g;

const CHANNEL_LEAK_REPLACEMENT = "[channel-leak-removed]";

/** True when `text` contains a Harmony / rfl channel marker. */
export function containsChannelLeak(text: string): boolean {
  CHANNEL_LEAK_RE.lastIndex = 0;
  return CHANNEL_LEAK_RE.test(text);
}

/** Replace channel-leak markers in a single string. */
export function scrubChannelLeakText(text: string): string {
  CHANNEL_LEAK_RE.lastIndex = 0;
  return text.replace(CHANNEL_LEAK_RE, CHANNEL_LEAK_REPLACEMENT);
}

/** Deep-walk strings in JSON-ish tool args / content trees. */
export function scrubChannelLeakValue<T>(value: T): T {
  if (typeof value === "string") {
    return scrubChannelLeakText(value) as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => scrubChannelLeakValue(item)) as T;
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(
      value as Record<string, unknown>,
    )) {
      out[key] = scrubChannelLeakValue(child);
    }
    return out as T;
  }
  return value;
}
