/**
 * Child → parent-agent ask (three-tier).
 * Blocks the child tool until the parent AI calls `answer_ask`.
 * Does **not** raise a human question card on the parent composer.
 */

import { randomUUID } from "node:crypto";
import type { ToolDefinition, ToolRegistry } from "@xrkseek/core-tools";

export type ParentAskChoice = {
  readonly label: string;
  readonly description?: string;
};

export type ParentAskQuestion = {
  readonly id: string;
  readonly question: string;
  readonly header?: string;
  readonly options?: readonly ParentAskChoice[];
};

export type PendingParentAsk = {
  readonly askId: string;
  readonly childSessionId: string;
  readonly parentSessionId: string;
  readonly childLabel: string;
  readonly questions: readonly ParentAskQuestion[];
};

type Waiter = PendingParentAsk & {
  resolve: (answer: string) => void;
  reject: (error: Error) => void;
  signal?: AbortSignal;
  onAbort?: () => void;
};

export class ParentAskError extends Error {
  constructor(
    message: string,
    readonly code: "ASK_CANCELLED" | "ASK_ABORTED" | "EMPTY_QUESTIONS",
  ) {
    super(message);
    this.name = "ParentAskError";
  }
}

export interface FaceParentAskHooks {
  /** Fire when a child opens a blocker — Host should steer+wake the parent. */
  onRequested(pending: PendingParentAsk): void;
}

function mintAskId(): string {
  return `pask_${randomUUID()}`;
}

/** Notice text admitted into the parent inbox (steer). Keep short — tokens cost. */
export function formatParentAskNotice(pending: PendingParentAsk): string {
  const q = pending.questions[0];
  const label = pending.childLabel.trim() || "subagent";
  const lines = [
    `<child_ask id="${pending.askId}" from="${label}">`,
    q?.question ?? "",
  ];
  if (q?.options && q.options.length > 0) {
    lines.push(
      `opts: ${q.options.map((o) => o.label).join(" | ")}`,
    );
  }
  lines.push("→ answer_ask(ask_id, answer). Need boss? ask_user then answer_ask.");
  lines.push("</child_ask>");
  return lines.join("\n");
}

/**
 * In-process waiters: child `ask` blocks here; parent `answer_ask` settles.
 */
export class FaceParentAskBroker {
  private readonly waiters = new Map<string, Waiter>();

  constructor(private readonly hooks: FaceParentAskHooks) {}

  listPending(parentSessionId: string): readonly PendingParentAsk[] {
    const out: PendingParentAsk[] = [];
    for (const w of this.waiters.values()) {
      if (w.parentSessionId === parentSessionId) {
        out.push({
          askId: w.askId,
          childSessionId: w.childSessionId,
          parentSessionId: w.parentSessionId,
          childLabel: w.childLabel,
          questions: w.questions,
        });
      }
    }
    return out;
  }

  ask(options: {
    readonly childSessionId: string;
    readonly parentSessionId: string;
    readonly childLabel: string;
    readonly questions: readonly ParentAskQuestion[];
    readonly signal?: AbortSignal;
  }): Promise<string> {
    if (options.questions.length === 0) {
      return Promise.reject(
        new ParentAskError("questions must be non-empty", "EMPTY_QUESTIONS"),
      );
    }
    return new Promise<string>((resolve, reject) => {
      const askId = mintAskId();
      const pending: Waiter = {
        askId,
        childSessionId: options.childSessionId,
        parentSessionId: options.parentSessionId,
        childLabel: options.childLabel,
        questions: options.questions,
        resolve,
        reject,
        ...(options.signal ? { signal: options.signal } : {}),
      };
      const onAbort = () => {
        if (!this.waiters.has(askId)) return;
        this.waiters.delete(askId);
        reject(
          new ParentAskError(
            "ask was aborted before the parent answered",
            "ASK_ABORTED",
          ),
        );
      };
      pending.onAbort = onAbort;
      this.waiters.set(askId, pending);
      if (options.signal) {
        if (options.signal.aborted) {
          onAbort();
          return;
        }
        options.signal.addEventListener("abort", onAbort, { once: true });
      }
      this.hooks.onRequested({
        askId,
        childSessionId: options.childSessionId,
        parentSessionId: options.parentSessionId,
        childLabel: options.childLabel,
        questions: options.questions,
      });
    });
  }

  /**
   * Parent settles one pending ask. Returns error string when not found / wrong parent.
   */
  answer(
    parentSessionId: string,
    askId: string,
    answer: string,
  ): { readonly ok: true } | { readonly ok: false; readonly error: string } {
    const id = askId.trim();
    const text = answer.trim();
    if (!id) return { ok: false, error: "answer_ask: ask_id required" };
    if (!text) return { ok: false, error: "answer_ask: answer required" };
    const w = this.waiters.get(id);
    if (!w) return { ok: false, error: `answer_ask: unknown ask_id ${id}` };
    if (w.parentSessionId !== parentSessionId) {
      return {
        ok: false,
        error: "answer_ask: this ask belongs to another parent session",
      };
    }
    this.finish(w);
    w.resolve(text);
    return { ok: true };
  }

  /** Drop all pending asks from a child (e.g. child interrupt). */
  cancelForChild(childSessionId: string, reason = "child cancelled"): void {
    for (const [id, w] of [...this.waiters.entries()]) {
      if (w.childSessionId !== childSessionId) continue;
      this.waiters.delete(id);
      if (w.signal && w.onAbort) {
        w.signal.removeEventListener("abort", w.onAbort);
      }
      w.reject(new ParentAskError(reason, "ASK_CANCELLED"));
    }
  }

  private finish(w: Waiter): void {
    this.waiters.delete(w.askId);
    if (w.signal && w.onAbort) {
      w.signal.removeEventListener("abort", w.onAbort);
    }
  }
}

/** Child tool: ask parent AI (blocks). Replaces ask_user on delegated children. */
export function bindAskParentTool(
  tools: ToolRegistry,
  options: {
    readonly childSessionId: string;
    readonly parentSessionId: string;
    readonly childLabel: string;
    readonly broker: FaceParentAskBroker;
  },
): void {
  tools.unregister("ask_user");
  const label = (options.childLabel ?? "").trim() || "subagent";
  const tool: ToolDefinition = {
    name: "ask",
    description:
      "One blocker to your parent agent (not the boss). Blocks until answer_ask.",
    parameters: {
      type: "object",
      properties: {
        question: { type: "string", description: "One concrete question." },
        header: {
          type: "string",
          description: "≤12 char chip. Optional.",
        },
        options: {
          type: "array",
          description: "Optional choices; omit for free-text.",
          items: {
            type: "object",
            properties: {
              label: { type: "string" },
              description: { type: "string" },
            },
            required: ["label"],
            additionalProperties: false,
          },
        },
      },
      required: ["question"],
      additionalProperties: false,
    },
    // Live route only — parent id already in session_capability.
    dynamicSchema: () => ({
      description: `ask → ${label} parent (blocks).`,
    }),
    presentCall: (args) => ({
      card: "generic",
      title: "ask",
      kind: "execute",
      rawInput: args,
    }),
    execute: async (args, signal) => {
      const a =
        args && typeof args === "object"
          ? (args as Record<string, unknown>)
          : {};
      const question = typeof a.question === "string" ? a.question.trim() : "";
      if (!question) return { content: "ask: question required", isError: true };
      const header =
        typeof a.header === "string" && a.header.trim()
          ? a.header.trim().slice(0, 12)
          : label.slice(0, 12);
      const optionsRaw = Array.isArray(a.options) ? a.options : [];
      const choices: ParentAskChoice[] = [];
      for (const row of optionsRaw) {
        if (!row || typeof row !== "object") continue;
        const labelText = String(
          (row as { label?: unknown }).label ?? "",
        ).trim();
        if (!labelText) continue;
        const description = (row as { description?: unknown }).description;
        choices.push({
          label: labelText,
          ...(typeof description === "string" && description.trim()
            ? { description: description.trim() }
            : {}),
        });
      }
      try {
        const text = await options.broker.ask({
          childSessionId: options.childSessionId,
          parentSessionId: options.parentSessionId,
          childLabel: label,
          questions: [
            {
              id: "q0",
              question,
              header,
              ...(choices.length > 0 ? { options: choices } : {}),
            },
          ],
          ...(signal ? { signal } : {}),
        });
        return { content: text };
      } catch (err) {
        return {
          content: err instanceof Error ? err.message : String(err),
          isError: true,
        };
      }
    },
  };
  if (tools.get("ask")) tools.replace(tool);
  else tools.register(tool);
}

/** Parent tool: settle a blocked child ask. */
export function bindAnswerAskTool(
  tools: ToolRegistry,
  options: {
    readonly parentSessionId: string;
    readonly broker: FaceParentAskBroker;
  },
): void {
  const tool: ToolDefinition = {
    name: "answer_ask",
    description:
      "Settle a blocked child ask. Use when <child_ask> is pending (ask_user first if you need the boss).",
    parameters: {
      type: "object",
      properties: {
        ask_id: {
          type: "string",
          description: "id from <child_ask>.",
        },
        answer: {
          type: "string",
          description: "Text the child tool receives.",
        },
      },
      required: ["ask_id", "answer"],
      additionalProperties: false,
    },
    // Idle: omit dynamic text (static desc is enough). Pending: ids + Q tip only.
    dynamicSchema: () => {
      const pending = options.broker.listPending(options.parentSessionId);
      if (pending.length === 0) return {};
      const tip = pending
        .map((p) => {
          const q = p.questions[0]?.question?.trim() ?? "";
          const short = q.length > 48 ? `${q.slice(0, 45)}…` : q;
          const who = p.childLabel.trim() || p.childSessionId;
          return short ? `${p.askId}←${who}: ${short}` : `${p.askId}←${who}`;
        })
        .join("; ");
      return { description: `pending: ${tip}` };
    },
    presentCall: (args) => ({
      card: "generic",
      title: "answer_ask",
      kind: "execute",
      rawInput: args,
    }),
    execute: async (args) => {
      const a =
        args && typeof args === "object"
          ? (args as Record<string, unknown>)
          : {};
      const askId = typeof a.ask_id === "string" ? a.ask_id : "";
      const answer = typeof a.answer === "string" ? a.answer : "";
      const result = options.broker.answer(
        options.parentSessionId,
        askId,
        answer,
      );
      if (!result.ok) return { content: result.error, isError: true };
      return { content: `answer_ask: delivered to child (${askId.trim()})` };
    },
  };
  if (tools.get("answer_ask")) tools.replace(tool);
  else tools.register(tool);
}
