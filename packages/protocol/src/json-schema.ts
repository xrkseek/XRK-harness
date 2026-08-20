/**
 * Hand-maintained JSON Schema for SessionEvent (oneOf by `type`).
 * Runtime validation uses `parseSessionEvent` — this schema is for export /
 * OpenAPI / external validators. Keep in sync with session-events.ts.
 */

const toolCallSchema = {
  type: "object",
  required: ["id", "name", "arguments"],
  properties: {
    id: { type: "string" },
    name: { type: "string" },
    arguments: {},
  },
  additionalProperties: false,
} as const;

const tokenUsageSchema = {
  type: "object",
  required: ["inputTokens", "outputTokens"],
  properties: {
    inputTokens: { type: "integer", minimum: 0 },
    outputTokens: { type: "integer", minimum: 0 },
    cacheReadTokens: { type: "integer", minimum: 0 },
    cacheWriteTokens: { type: "integer", minimum: 0 },
    reasoningTokens: { type: "integer", minimum: 0 },
  },
  additionalProperties: false,
} as const;

const messageContentSchema = {
  oneOf: [
    { type: "string" },
    {
      type: "array",
      items: {
        oneOf: [
          {
            type: "object",
            required: ["type", "text"],
            properties: {
              type: { const: "text" },
              text: { type: "string" },
            },
            additionalProperties: false,
          },
          {
            type: "object",
            required: ["type", "attachment"],
            properties: {
              type: { const: "image" },
              attachment: {
                type: "object",
                required: [
                  "attachmentId",
                  "mediaType",
                  "bytes",
                  "width",
                  "height",
                ],
                properties: {
                  attachmentId: { type: "string" },
                  mediaType: {
                    enum: [
                      "image/png",
                      "image/jpeg",
                      "image/webp",
                      "image/gif",
                    ],
                  },
                  bytes: { type: "number" },
                  width: { type: "number" },
                  height: { type: "number" },
                  name: { type: "string" },
                },
                additionalProperties: false,
              },
            },
            additionalProperties: false,
          },
        ],
      },
    },
  ],
} as const;

const toolResultSchema = {
  type: "object",
  required: ["toolCallId", "name", "content"],
  properties: {
    toolCallId: { type: "string" },
    name: { type: "string" },
    content: messageContentSchema,
    isError: { type: "boolean" },
    meta: { type: "object" },
  },
  additionalProperties: false,
} as const;

function baseProps(extra: Record<string, unknown>) {
  return {
    type: { type: "string" },
    ts: { type: "number" },
    ...extra,
  };
}

export const sessionEventJsonSchema = {
  $id: "https://xrkseek.dev/schemas/session-event.json",
  title: "SessionEvent",
  description:
    "Append-only session event union. Discriminator: type. See docs/protocol-events.md.",
  oneOf: [
    {
      type: "object",
      required: ["type", "ts", "turnId"],
      properties: baseProps({
        type: { const: "turn/start" },
        turnId: { type: "string" },
      }),
      additionalProperties: false,
    },
    {
      type: "object",
      required: ["type", "ts", "turnId", "reason"],
      properties: baseProps({
        type: { const: "turn/end" },
        turnId: { type: "string" },
        reason: {
          type: "object",
          required: ["kind"],
          properties: {
            kind: { type: "string" },
          },
          additionalProperties: true,
        },
      }),
      additionalProperties: false,
    },
    {
      type: "object",
      required: ["type", "ts", "turnId", "stepId"],
      properties: baseProps({
        type: { const: "step/start" },
        turnId: { type: "string" },
        stepId: { type: "string" },
      }),
      additionalProperties: false,
    },
    {
      type: "object",
      required: ["type", "ts", "turnId", "stepId"],
      properties: baseProps({
        type: { const: "step/end" },
        turnId: { type: "string" },
        stepId: { type: "string" },
      }),
      additionalProperties: false,
    },
    {
      type: "object",
      required: ["type", "ts", "turnId", "content"],
      properties: baseProps({
        type: { const: "user/message" },
        turnId: { type: "string" },
        content: messageContentSchema,
        rpcId: { type: "string" },
      }),
      additionalProperties: false,
    },
    {
      type: "object",
      required: ["type", "ts", "turnId", "stepId", "text"],
      properties: baseProps({
        type: { const: "assistant/chunk" },
        turnId: { type: "string" },
        stepId: { type: "string" },
        text: { type: "string" },
        kind: { type: "string", enum: ["text", "reasoning", "usage"] },
        index: { type: "integer" },
        usage: tokenUsageSchema,
      }),
      additionalProperties: false,
    },
    {
      type: "object",
      required: ["type", "ts", "turnId", "stepId", "content"],
      properties: baseProps({
        type: { const: "assistant/message" },
        turnId: { type: "string" },
        stepId: { type: "string" },
        content: { type: "string" },
        reasoning: { type: "string" },
        interrupted: { type: "boolean" },
        toolCalls: { type: "array", items: toolCallSchema },
        usage: tokenUsageSchema,
      }),
      additionalProperties: false,
    },
    {
      type: "object",
      required: ["type", "ts", "turnId", "stepId", "call"],
      properties: baseProps({
        type: { const: "tool/call" },
        turnId: { type: "string" },
        stepId: { type: "string" },
        call: toolCallSchema,
      }),
      additionalProperties: false,
    },
    {
      type: "object",
      required: ["type", "ts", "turnId", "stepId", "result"],
      properties: baseProps({
        type: { const: "tool/result" },
        turnId: { type: "string" },
        stepId: { type: "string" },
        result: toolResultSchema,
      }),
      additionalProperties: false,
    },
    {
      type: "object",
      required: ["type", "ts", "admitId", "content"],
      properties: baseProps({
        type: { const: "prompt/admitted" },
        admitId: { type: "string" },
        content: {
          oneOf: [
            { type: "string" },
            {
              type: "array",
              items: {
                oneOf: [
                  {
                    type: "object",
                    required: ["type", "text"],
                    properties: {
                      type: { const: "text" },
                      text: { type: "string" },
                    },
                    additionalProperties: false,
                  },
                  {
                    type: "object",
                    required: ["type", "attachment"],
                    properties: {
                      type: { const: "image" },
                      attachment: {
                        type: "object",
                        required: [
                          "attachmentId",
                          "mediaType",
                          "bytes",
                          "width",
                          "height",
                        ],
                        properties: {
                          attachmentId: { type: "string" },
                          mediaType: {
                            enum: [
                              "image/png",
                              "image/jpeg",
                              "image/webp",
                              "image/gif",
                            ],
                          },
                          bytes: { type: "number" },
                          width: { type: "number" },
                          height: { type: "number" },
                          name: { type: "string" },
                        },
                        additionalProperties: false,
                      },
                    },
                    additionalProperties: false,
                  },
                ],
              },
            },
          ],
        },
        delivery: { enum: ["steer", "queue"] },
      }),
      additionalProperties: false,
    },
    {
      type: "object",
      required: ["type", "ts", "admitId"],
      properties: baseProps({
        type: { const: "prompt/promoted" },
        admitId: { type: "string" },
      }),
      additionalProperties: false,
    },
    {
      type: "object",
      required: ["type", "ts", "admitId"],
      properties: baseProps({
        type: { const: "prompt/withdrawn" },
        admitId: { type: "string" },
      }),
      additionalProperties: false,
    },
    {
      type: "object",
      required: ["type", "ts", "turnId", "kind", "content"],
      properties: baseProps({
        type: { const: "safety/notice" },
        turnId: { type: "string" },
        kind: {
          enum: ["loop_soft", "loop_hard", "mistake_limit", "api_error"],
        },
        content: { type: "string" },
        toolName: { type: "string" },
        count: { type: "number" },
      }),
      additionalProperties: false,
    },
    {
      type: "object",
      required: ["type", "ts", "reason", "summary", "recent"],
      properties: baseProps({
        type: { const: "context/compaction" },
        turnId: { type: "string" },
        reason: { enum: ["auto", "overflow", "manual"] },
        summary: { type: "string" },
        recent: { type: "string" },
        shadowedTokenCount: { type: "integer", minimum: 0 },
      }),
      additionalProperties: false,
    },
    {
      type: "object",
      required: ["type", "ts", "title", "source"],
      properties: baseProps({
        type: { const: "session/title" },
        title: { type: "string", minLength: 1 },
        source: {
          type: "object",
          required: ["kind"],
          properties: { kind: { enum: ["fallback", "user"] } },
          additionalProperties: false,
        },
        messageSeqs: {
          type: "array",
          items: { type: "number" },
        },
      }),
      additionalProperties: false,
    },
    {
      type: "object",
      required: [
        "type",
        "ts",
        "approvalId",
        "toolCallId",
        "toolName",
        "reason",
      ],
      properties: baseProps({
        type: { const: "approval/asked" },
        approvalId: { type: "string" },
        toolCallId: { type: "string" },
        toolName: { type: "string" },
        reason: { type: "string" },
        argsSummary: { type: "string" },
        turnId: { type: "string" },
        stepId: { type: "string" },
      }),
      additionalProperties: false,
    },
    {
      type: "object",
      required: ["type", "ts", "approvalId", "decision", "source"],
      properties: baseProps({
        type: { const: "approval/decided" },
        approvalId: { type: "string" },
        decision: { enum: ["allow", "deny"] },
        source: { enum: ["user", "cancel", "timeout"] },
      }),
      additionalProperties: false,
    },
    {
      type: "object",
      required: ["type", "ts", "commandId", "name", "source"],
      properties: baseProps({
        type: { const: "command/run" },
        commandId: { type: "string" },
        name: { type: "string" },
        args: { type: "string" },
        source: {
          type: "object",
          required: ["kind"],
          properties: { kind: { const: "user" } },
          additionalProperties: false,
        },
      }),
      additionalProperties: false,
    },
    {
      type: "object",
      required: ["type", "ts", "commandId", "kind"],
      properties: baseProps({
        type: { const: "command/done" },
        commandId: { type: "string" },
        kind: { enum: ["success", "error"] },
        text: { type: "string" },
        sourceEventSeq: { type: "number" },
      }),
      additionalProperties: false,
    },
    {
      type: "object",
      required: ["type", "ts", "todos"],
      properties: baseProps({
        type: { const: "todo/write" },
        todos: {
          type: "array",
          items: {
            type: "object",
            required: ["content", "status"],
            properties: {
              content: { type: "string" },
              status: { enum: ["pending", "in_progress", "completed"] },
            },
            additionalProperties: false,
          },
        },
      }),
      additionalProperties: false,
    },
    {
      type: "object",
      required: ["type", "ts", "preset"],
      properties: baseProps({
        type: { const: "permission/preset" },
        preset: { type: "string" },
      }),
      additionalProperties: false,
    },
    {
      type: "object",
      required: ["type", "ts", "mode"],
      properties: baseProps({
        type: { const: "sandbox/mode" },
        mode: {
          enum: ["read-only", "workspace-write", "danger-full-access"],
        },
      }),
      additionalProperties: false,
    },
    {
      type: "object",
      required: ["type", "ts", "policy"],
      properties: baseProps({
        type: { const: "approval/policy" },
        policy: { enum: ["ask", "never"] },
      }),
      additionalProperties: false,
    },
    {
      type: "object",
      required: ["type", "ts", "active"],
      properties: baseProps({
        type: { const: "plan/mode" },
        active: { type: "boolean" },
      }),
      additionalProperties: false,
    },
    {
      type: "object",
      required: ["type", "ts", "text"],
      properties: baseProps({
        type: { const: "feedback/record" },
        text: { type: "string" },
      }),
      additionalProperties: false,
    },
  ],
} as const;

/** @deprecated Use `sessionEventJsonSchema`. */
export const sessionEventJsonSchemaStub = sessionEventJsonSchema;
