/**
 * Compact schemastery envelopes (`schema.toJSON()`) for Face `settings.describe`.
 * The product Web rehydrates these; JSON Schema will not parse.
 */

export interface FaceSchemaNode {
  readonly type: string;
  readonly value?: unknown;
  readonly list?: readonly number[];
  readonly dict?: Readonly<Record<string, number>>;
  readonly inner?: number;
  readonly meta?: { readonly description?: string };
}

export interface FaceSchemaEnvelope {
  readonly uid: number;
  readonly refs: Readonly<Record<number, FaceSchemaNode>>;
}

export const FACE_EMPTY_OBJECT_SCHEMA: FaceSchemaEnvelope = {
  uid: 1,
  refs: { 1: { type: "object" } },
};

export const FACE_ONBOARDING_SCHEMA: FaceSchemaEnvelope = {
  uid: 2,
  refs: {
    1: { type: "string" },
    2: { type: "object", dict: { welcomeNoticeVersion: 1 } },
  },
};

export const FACE_LOCALE_SCHEMA: FaceSchemaEnvelope = {
  uid: 4,
  refs: {
    1: { type: "const", value: "zh" },
    2: { type: "const", value: "en" },
    3: { type: "union", list: [1, 2] },
    4: { type: "object", dict: { preference: 3 } },
  },
};

export const FACE_THEME_SCHEMA: FaceSchemaEnvelope = {
  uid: 5,
  refs: {
    1: { type: "const", value: "system" },
    2: { type: "const", value: "light" },
    3: { type: "const", value: "dark" },
    4: { type: "union", list: [1, 2, 3] },
    5: { type: "object", dict: { preference: 4 } },
  },
};

/** Same preset ids as the permission-presets settings row enum. */
export const FACE_PERMISSION_PRESETS = [
  "read-only",
  "workspace-write",
  "danger-full-access",
] as const;

export type FacePermissionPreset = (typeof FACE_PERMISSION_PRESETS)[number];

export const FACE_PERMISSION_SCHEMA: FaceSchemaEnvelope = {
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

/**
 * Face MCP desired servers. `connected` is overlay from live plugins
 * (`status` is supervisor health). File-sourced Host remounts on mutate
 * (`applies: live`); env/config MCP stays `applies: restart`.
 */
export const FACE_MCP_SCHEMA: FaceSchemaEnvelope = {
  uid: 9,
  refs: {
    1: { type: "string" },
    2: { type: "array", inner: 1 },
    3: {
      type: "object",
      dict: {
        serverName: 1,
        command: 1,
        url: 1,
        args: 2,
        cwd: 1,
      },
    },
    4: { type: "array", inner: 3 },
    5: { type: "string" },
    6: {
      type: "object",
      dict: { id: 1, serverName: 1, kind: 1, toolCount: 5, status: 1 },
    },
    7: { type: "array", inner: 6 },
    8: { type: "string" },
    10: {
      type: "object",
      dict: { serverName: 1, message: 1 },
    },
    11: { type: "array", inner: 10 },
    9: {
      type: "object",
      dict: { servers: 4, connected: 7, note: 8, connectFailures: 11 },
    },
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
