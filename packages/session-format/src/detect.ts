/**
 * Detect durable session artifacts. Cross-product interchange ≠ Session Format V3
 * (ADR-0009). Foreign logical Format headers are refused, not migrated.
 */

export type SessionArtifactKind =
  | {
      readonly kind: "xrk-interchange";
      readonly version: number;
    }
  | {
      readonly kind: "xrk-events-jsonl";
    }
  | {
      readonly kind: "xrk-packed-hint";
      /** First line looked like a packed storage row (text-chunks / tool-call-chunks). */
      readonly packedRow: boolean;
    }
  | {
      /** Third-party logical Session Format (often called V3). Not adopted. */
      readonly kind: "foreign-session-format";
      readonly version: number;
      readonly refused: true;
      readonly reason: string;
    }
  | {
      readonly kind: "unknown";
    };

function firstJsonObject(text: string): Record<string, unknown> | undefined {
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const raw: unknown = JSON.parse(trimmed);
      if (raw && typeof raw === "object" && !Array.isArray(raw)) {
        return raw as Record<string, unknown>;
      }
    } catch {
      return undefined;
    }
    break;
  }
  return undefined;
}

/**
 * Classify the opening of a JSONL / header blob.
 * Does **not** parse a full transcript — enough to refuse Format V3 and route
 * interchange / packed / XRK event lines.
 */
export function detectSessionArtifact(text: string): SessionArtifactKind {
  const head = firstJsonObject(text);
  if (!head) return { kind: "unknown" };

  if (typeof head.xrkInterchange === "number") {
    return { kind: "xrk-interchange", version: head.xrkInterchange };
  }

  // dsh / community Session Format header shape (logical generation).
  const version = head.version;
  const looksForeign =
    typeof version === "number" &&
    Number.isInteger(version) &&
    typeof head.id === "string" &&
    typeof head.createdAt === "number" &&
    typeof head.isSeeded === "boolean" &&
    typeof head.delegationDepth === "number" &&
    head.type === undefined;

  if (looksForeign) {
    return {
      kind: "foreign-session-format",
      version,
      refused: true,
      reason:
        "third-party Session Format is not adopted (ADR-0009); use importSessionInterchange for role JSONL",
    };
  }

  if (head.type === "text-chunks" || head.type === "tool-call-chunks") {
    return { kind: "xrk-packed-hint", packedRow: true };
  }

  if (typeof head.type === "string" && head.type.includes("/")) {
    return { kind: "xrk-events-jsonl" };
  }

  // Bare role JSONL (interchange body without header) — treat as interchange v0 body.
  if (
    head.role === "user" ||
    head.role === "assistant" ||
    head.role === "tool" ||
    head.role === "human" ||
    head.role === "model"
  ) {
    return { kind: "xrk-interchange", version: 0 };
  }

  return { kind: "unknown" };
}
