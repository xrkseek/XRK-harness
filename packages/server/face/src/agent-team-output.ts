/**
 * Hermes-style optional output_schema contract for delegated tasks.
 * Appends an OUTPUT CONTRACT block; validates final JSON with a light check
 * (no jsonschema dependency). One correction turn is the caller's job.
 */

export type OutputSchemaObject = Readonly<Record<string, unknown>>;

/** Coerce model-supplied schema; `(schema, undefined)` or `(undefined, error)`. */
export function coerceOutputSchema(
  raw: unknown,
):
  | { readonly schema: OutputSchemaObject; readonly error?: undefined }
  | { readonly schema?: undefined; readonly error: string }
  | { readonly schema?: undefined; readonly error?: undefined } {
  if (raw === undefined || raw === null) return {};
  let value: unknown = raw;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return {};
    try {
      value = JSON.parse(trimmed);
    } catch {
      return {
        error: "output_schema must be a JSON Schema object, got a non-JSON string",
      };
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { error: "output_schema must be a JSON Schema object" };
  }
  return { schema: value as OutputSchemaObject };
}

/** Append the machine-validated OUTPUT CONTRACT block (Hermes wording). */
export function appendOutputContract(
  prompt: string,
  schema: OutputSchemaObject,
): string {
  let schemaText: string;
  try {
    schemaText = JSON.stringify(schema, null, 2);
  } catch {
    schemaText = String(schema);
  }
  const block =
    "OUTPUT CONTRACT (machine-validated):\n" +
    "Your FINAL response must be ONLY the JSON value that validates against this JSON " +
    "Schema — no prose before or after it, no code fence, no explanation. Anything else " +
    "costs a correction turn and, if it fails again, is handed to the caller unvalidated.\n" +
    schemaText;
  const base = prompt.trim();
  return base ? `${base}\n\n${block}` : block;
}

/** Strip fences / prose; return outermost `{…}` or `[…]` that parses as JSON. */
export function extractJsonCandidate(text: string): string | undefined {
  let raw = text.trim();
  if (raw.startsWith("```")) {
    raw = raw.split("\n").slice(1).join("\n");
    if (raw.trimEnd().endsWith("```")) {
      raw = raw.trimEnd().slice(0, -3);
    }
    raw = raw.trim();
    if (raw.toLowerCase().startsWith("json\n")) {
      raw = raw.slice(5);
    }
  }
  const spans: { start: number; body: string }[] = [];
  for (const [opener, closer] of [
    ["{", "}"],
    ["[", "]"],
  ] as const) {
    const start = raw.indexOf(opener);
    const end = raw.lastIndexOf(closer);
    if (start >= 0 && end > start) {
      spans.push({ start, body: raw.slice(start, end + 1) });
    }
  }
  spans.sort((a, b) => a.start - b.start);
  for (const span of spans) {
    try {
      JSON.parse(span.body);
      return span.body;
    } catch {
      /* try next */
    }
  }
  return undefined;
}

export interface OutputSchemaValidation {
  readonly valid: boolean;
  readonly errors: readonly string[];
  readonly candidate?: string;
}

/**
 * Light validation: parse JSON candidate; when schema.required is a string[],
 * require those keys on object results. Type mismatches are best-effort only.
 */
export function validateOutputAgainstSchema(
  text: string,
  schema: OutputSchemaObject,
): OutputSchemaValidation {
  const candidate = extractJsonCandidate(text);
  if (!candidate) {
    return {
      valid: false,
      errors: ["final answer is not JSON (no object/array candidate)"],
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch (err) {
    return {
      valid: false,
      errors: [
        `JSON parse failed: ${err instanceof Error ? err.message : String(err)}`,
      ],
    };
  }
  const errors: string[] = [];
  const required = schema.required;
  if (Array.isArray(required) && parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    const obj = parsed as Record<string, unknown>;
    for (const key of required) {
      if (typeof key !== "string") continue;
      if (!(key in obj)) errors.push(`missing required property: ${key}`);
    }
  }
  const type = schema.type;
  if (typeof type === "string") {
    if (type === "object" && (!parsed || typeof parsed !== "object" || Array.isArray(parsed))) {
      errors.push("expected a JSON object");
    }
    if (type === "array" && !Array.isArray(parsed)) {
      errors.push("expected a JSON array");
    }
  }
  return {
    valid: errors.length === 0,
    errors,
    candidate,
  };
}

/** One correction turn (Hermes: do not re-paste the schema). */
export function buildOutputSchemaRetryMessage(
  errors: readonly string[],
): string {
  const lines = errors.map((e) => `- ${e}`).join("\n");
  return (
    "Your previous final answer did not satisfy the OUTPUT CONTRACT.\n" +
    "Validation errors:\n" +
    `${lines}\n` +
    "Reply again with ONLY the corrected JSON value — no prose, no fences."
  );
}
