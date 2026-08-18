/**
 * Compact schemastery envelopes (`schema.toJSON()`) for Face `settings.describe`.
 * The captured DSH Web rehydrates these; JSON Schema will not parse.
 */

export interface DshSchemaNode {
  readonly type: string;
  readonly value?: unknown;
  readonly list?: readonly number[];
  readonly dict?: Readonly<Record<string, number>>;
  readonly inner?: number;
  readonly meta?: { readonly description?: string };
}

export interface DshSchemaEnvelope {
  readonly uid: number;
  readonly refs: Readonly<Record<number, DshSchemaNode>>;
}

export const DSH_EMPTY_OBJECT_SCHEMA: DshSchemaEnvelope = {
  uid: 1,
  refs: { 1: { type: "object" } },
};

export const DSH_ONBOARDING_SCHEMA: DshSchemaEnvelope = {
  uid: 2,
  refs: {
    1: { type: "string" },
    2: { type: "object", dict: { welcomeNoticeVersion: 1 } },
  },
};

export const DSH_LOCALE_SCHEMA: DshSchemaEnvelope = {
  uid: 4,
  refs: {
    1: { type: "const", value: "zh" },
    2: { type: "const", value: "en" },
    3: { type: "union", list: [1, 2] },
    4: { type: "object", dict: { preference: 3 } },
  },
};

export const DSH_THEME_SCHEMA: DshSchemaEnvelope = {
  uid: 5,
  refs: {
    1: { type: "const", value: "system" },
    2: { type: "const", value: "light" },
    3: { type: "const", value: "dark" },
    4: { type: "union", list: [1, 2, 3] },
    5: { type: "object", dict: { preference: 4 } },
  },
};

/** Same preset ids as DSH permission-presets (settings row enum). */
export const FACE_PERMISSION_PRESETS = [
  "read-only",
  "workspace-write",
  "danger-full-access",
] as const;

export type FacePermissionPreset = (typeof FACE_PERMISSION_PRESETS)[number];

export const DSH_PERMISSION_SCHEMA: DshSchemaEnvelope = {
  uid: 5,
  refs: {
    1: {
      type: "const",
      meta: { description: "Read only" },
      value: "read-only",
    },
    2: {
      type: "const",
      meta: { description: "Workspace write" },
      value: "workspace-write",
    },
    3: {
      type: "const",
      meta: { description: "Full access" },
      value: "danger-full-access",
    },
    4: { type: "union", list: [1, 2, 3] },
    5: { type: "object", dict: { defaultPreset: 4 } },
  },
};

/** `providers` is a dict so models page can probe `providers/<route>/api`. */
export const DSH_LLM_SCHEMA: DshSchemaEnvelope = {
  uid: 8,
  refs: {
    1: { type: "const", value: "openai-chat" },
    2: { type: "union", list: [1] },
    3: { type: "string" },
    4: { type: "string" },
    5: {
      type: "object",
      dict: { api: 2, apiKeyEnv: 3, baseURL: 4 },
    },
    6: { type: "dict", inner: 5 },
    8: { type: "object", dict: { providers: 6 } },
  },
};

export function isFacePermissionPreset(
  value: unknown,
): value is FacePermissionPreset {
  return (
    typeof value === "string" &&
    (FACE_PERMISSION_PRESETS as readonly string[]).includes(value)
  );
}
