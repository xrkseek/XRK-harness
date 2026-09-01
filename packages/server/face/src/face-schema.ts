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
    /** Conversation content font size (px); range enforced via {@link validateFaceFontSize}. */
    6: { type: "number" },
    5: { type: "object", dict: { preference: 4, fontSize: 6 } },
  },
};

/** Matches client `FONT_SIZE_*` in `@xrkseek/client-ui-theme`. */
export const FACE_FONT_SIZE_MIN = 12;
export const FACE_FONT_SIZE_MAX = 17;
export const FACE_FONT_SIZE_DEFAULT = 14;

/**
 * Validate optional `fontSize` on a ui-theme section.
 * @returns error message, or undefined when absent / valid.
 */
export function validateFaceFontSize(fontSize: unknown): string | undefined {
  if (fontSize === undefined) return undefined;
  if (
    typeof fontSize !== "number" ||
    !Number.isInteger(fontSize) ||
    fontSize < FACE_FONT_SIZE_MIN ||
    fontSize > FACE_FONT_SIZE_MAX
  ) {
    return `fontSize must be an integer in ${FACE_FONT_SIZE_MIN}..${FACE_FONT_SIZE_MAX}`;
  }
  return undefined;
}

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
 * Face MCP desired servers. `connected` / `parked` are live overlays.
 * `allowConnect` is user-writable (Web Settings); env `XRK_MCP_ALLOW` still
 * forces allow for headless/CI. File-sourced Host remounts on mutate
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
    /** Live overlay: Host sends a numeric tool count. */
    5: { type: "number" },
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
    12: { type: "const", value: true },
    13: { type: "const", value: false },
    14: { type: "union", list: [12, 13] },
    9: {
      type: "object",
      dict: {
        servers: 4,
        allowConnect: 14,
        connected: 7,
        parked: 2,
        note: 8,
        connectFailures: 11,
      },
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
