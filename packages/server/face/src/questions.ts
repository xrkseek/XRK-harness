/**
 * Face user-questions — DSH apiproxy `question/requested` + `/api/respond`.
 * rpcId is the question's stable id (core has none); mux reconnect replays pending.
 */

import { randomUUID } from "node:crypto";
import type { ToolRegistry } from "@xrkseek/core-tools";
import {
  PLAN_APPROVE_LABEL,
  PLAN_KEEP_LABEL,
  PLAN_REVIEW_ID,
  createExitPlanModeTool,
} from "@xrkseek/core-tools";
import { foldPlanMode } from "@xrkseek/protocol";
import type { SessionStore } from "@xrkseek/core-session";
import type {
  FaceQuestionAnswer,
  FaceQuestionAnswerItem,
  FaceQuestionItem,
  FaceRpcReceipt,
  MuxFrame,
} from "./types.js";

export class FaceQuestionError extends Error {
  constructor(
    message: string,
    readonly code: "ASK_CANCELLED" | "ASK_ABORTED" | "EMPTY_QUESTIONS",
  ) {
    super(message);
    this.name = "FaceQuestionError";
  }
}

export interface PendingQuestionItem {
  readonly rpcId: string;
  readonly sessionId: string;
  readonly questions: readonly FaceQuestionItem[];
}

type Waiter = PendingQuestionItem & {
  resolve: (answer: FaceQuestionAnswer) => void;
  reject: (error: FaceQuestionError) => void;
  signal?: AbortSignal;
  onAbort?: () => void;
};

export interface FaceQuestionHooks {
  onRequested(item: PendingQuestionItem): void;
  onResolved(
    sessionId: string,
    questionRpcId: string,
    outcome: "answered" | "cancelled",
  ): void;
}

function mintRpcId(): string {
  return `qrpc_${randomUUID()}`;
}

function matchesQuestions(
  sessionId: string,
  answer: FaceQuestionAnswer,
  pending: PendingQuestionItem,
): boolean {
  if (sessionId !== pending.sessionId) return false;
  const answers = answer.answers;
  if (answers.length !== pending.questions.length) return false;
  return answers.every((row, index) => {
    const question = pending.questions[index]!;
    if (row.id !== question.id) return false;
    if (new Set(row.selected).size !== row.selected.length) return false;
    const custom = row.custom?.trim();
    if (custom !== undefined && custom === "") return false;
    if (question.multiSelect !== true) {
      if (custom !== undefined && row.selected.length > 0) return false;
      if (row.selected.length > 1) return false;
    }
    const labels = new Set(question.options?.map((o) => o.label) ?? []);
    return row.selected.every((label) => labels.has(label));
  });
}

function parseAnswer(value: unknown): FaceQuestionAnswer | undefined {
  if (!value || typeof value !== "object") return undefined;
  const answersRaw = (value as { answers?: unknown }).answers;
  if (!Array.isArray(answersRaw)) return undefined;
  const answers: FaceQuestionAnswerItem[] = [];
  for (const row of answersRaw) {
    if (!row || typeof row !== "object") return undefined;
    const r = row as Record<string, unknown>;
    if (typeof r.id !== "string") return undefined;
    if (!Array.isArray(r.selected) || r.selected.some((x) => typeof x !== "string")) {
      return undefined;
    }
    const item: FaceQuestionAnswerItem = {
      id: r.id,
      selected: r.selected as string[],
      ...(typeof r.custom === "string" ? { custom: r.custom } : {}),
    };
    answers.push(item);
  }
  return { answers };
}

export function formatQuestionAnswer(answer: FaceQuestionAnswer): string {
  return answer.answers
    .map((row) => {
      const bits = [...row.selected];
      const custom = row.custom?.trim();
      if (custom) bits.push(custom);
      return bits.join(", ") || "(skipped)";
    })
    .join("\n");
}

export class FaceQuestionBroker {
  private readonly waiters = new Map<string, Waiter>();

  constructor(private readonly hooks: FaceQuestionHooks) {}

  listPending(sessionId?: string): readonly PendingQuestionItem[] {
    const out: PendingQuestionItem[] = [];
    for (const w of this.waiters.values()) {
      if (sessionId === undefined || w.sessionId === sessionId) {
        out.push({
          rpcId: w.rpcId,
          sessionId: w.sessionId,
          questions: w.questions,
        });
      }
    }
    return out;
  }

  hasRpcId(rpcId: string): boolean {
    return this.waiters.has(rpcId);
  }

  ask(
    sessionId: string,
    questions: readonly FaceQuestionItem[],
    signal?: AbortSignal,
  ): Promise<FaceQuestionAnswer> {
    if (questions.length === 0) {
      return Promise.reject(
        new FaceQuestionError("questions must be non-empty", "EMPTY_QUESTIONS"),
      );
    }
    return new Promise<FaceQuestionAnswer>((resolve, reject) => {
      const rpcId = mintRpcId();
      const pending: Waiter = {
        rpcId,
        sessionId,
        questions,
        resolve,
        reject,
        ...(signal ? { signal } : {}),
      };
      const onAbort = () => {
        this.claim(pending, "cancelled");
        reject(
          new FaceQuestionError(
            "ask_user_question was aborted before the user answered",
            "ASK_ABORTED",
          ),
        );
      };
      pending.onAbort = onAbort;
      this.waiters.set(rpcId, pending);
      if (signal) {
        if (signal.aborted) {
          onAbort();
          return;
        }
        signal.addEventListener("abort", onAbort, { once: true });
      }
      this.hooks.onRequested({ rpcId, sessionId, questions });
    });
  }

  askText(
    sessionId: string,
    question: string,
    signal?: AbortSignal,
  ): Promise<string> {
    const q = question.trim();
    if (!q) {
      return Promise.reject(
        new FaceQuestionError("questions must be non-empty", "EMPTY_QUESTIONS"),
      );
    }
    return this.ask(sessionId, [{ id: "q0", question: q }], signal).then(
      formatQuestionAnswer,
    );
  }

  /**
   * DSH `/api/respond` after approvals miss. `result` is the client-response
   * `result` object (`ok` + `value` or `error`).
   */
  respondByRpcId(rpcId: string, result: unknown): FaceRpcReceipt {
    const pending = this.waiters.get(rpcId);
    if (!pending) return { accepted: false, reason: "not-pending" };
    if (!result || typeof result !== "object") {
      return { accepted: false, reason: "bad-response" };
    }
    const r = result as Record<string, unknown>;
    if (r.ok !== true) {
      const err = r.error;
      const code =
        err && typeof err === "object"
          ? (err as { code?: unknown }).code
          : undefined;
      if (code !== "cancelled") {
        return { accepted: false, reason: "bad-response" };
      }
      this.claim(pending, "cancelled");
      pending.reject(
        new FaceQuestionError(
          "the user cancelled ask_user_question",
          "ASK_CANCELLED",
        ),
      );
      return { accepted: true };
    }
    const value = r.value;
    if (!value || typeof value !== "object") {
      return { accepted: false, reason: "bad-response" };
    }
    const v = value as Record<string, unknown>;
    if (typeof v.sessionId !== "string") {
      return { accepted: false, reason: "bad-response" };
    }
    const answer = parseAnswer(v.answer);
    if (!answer || !matchesQuestions(v.sessionId, answer, pending)) {
      return { accepted: false, reason: "bad-response" };
    }
    this.claim(pending, "answered");
    pending.resolve(answer);
    return { accepted: true };
  }

  private claim(pending: Waiter, outcome: "answered" | "cancelled"): void {
    this.waiters.delete(pending.rpcId);
    if (pending.signal && pending.onAbort) {
      pending.signal.removeEventListener("abort", pending.onAbort);
    }
    this.hooks.onResolved(pending.sessionId, pending.rpcId, outcome);
  }
}

export function questionRequestedFrame(
  item: PendingQuestionItem,
): Extract<MuxFrame, { type: "question/requested" }> {
  return {
    type: "question/requested",
    sessionId: item.sessionId,
    questions: item.questions,
  };
}

export function questionResolvedFrame(
  sessionId: string,
  questionRpcId: string,
  outcome: "answered" | "cancelled",
): Extract<MuxFrame, { type: "question/resolved" }> {
  return {
    type: "question/resolved",
    sessionId,
    questionRpcId,
    outcome,
  };
}

/**
 * Coerce `ask_user` args to DSH `AskUserQuestionItem[]`.
 * Accepts free-text `{ question }` or `{ questions: [...] }` (`multi_select` → multiSelect).
 */
export function coerceAskUserQuestions(
  args: unknown,
): FaceQuestionItem[] | undefined {
  if (!args || typeof args !== "object") return undefined;
  const a = args as Record<string, unknown>;
  if (Array.isArray(a.questions)) {
    const out: FaceQuestionItem[] = [];
    for (const row of a.questions) {
      if (!row || typeof row !== "object") return undefined;
      const r = row as Record<string, unknown>;
      if (typeof r.id !== "string" || typeof r.question !== "string") {
        return undefined;
      }
      const question = r.question.trim();
      if (!question) return undefined;
      let options:
        | { readonly label: string; readonly description?: string }[]
        | undefined;
      if (r.options !== undefined) {
        if (!Array.isArray(r.options)) return undefined;
        options = [];
        for (const o of r.options) {
          if (!o || typeof o !== "object") return undefined;
          const opt = o as Record<string, unknown>;
          if (typeof opt.label !== "string" || !opt.label.trim()) {
            return undefined;
          }
          options.push({
            label: opt.label,
            ...(typeof opt.description === "string"
              ? { description: opt.description }
              : {}),
          });
        }
      }
      const multiSelect =
        r.multi_select === true || r.multiSelect === true ? true : undefined;
      let intent: FaceQuestionItem["intent"] | undefined;
      if (r.intent !== undefined) {
        if (!r.intent || typeof r.intent !== "object") return undefined;
        const i = r.intent as Record<string, unknown>;
        if (i.kind !== "plan-review" || typeof i.approve !== "string") {
          return undefined;
        }
        const approve = i.approve.trim();
        if (!approve) return undefined;
        intent = { kind: "plan-review", approve };
      }
      out.push({
        id: r.id,
        question,
        ...(typeof r.header === "string" ? { header: r.header } : {}),
        ...(typeof r.detail === "string" ? { detail: r.detail } : {}),
        ...(options !== undefined ? { options } : {}),
        ...(multiSelect ? { multiSelect } : {}),
        ...(intent ? { intent } : {}),
      });
    }
    return out.length > 0 ? out : undefined;
  }
  if (typeof a.question === "string") {
    const q = a.question.trim();
    if (!q) return undefined;
    return [{ id: "q0", question: q }];
  }
  return undefined;
}

/** Point `ask_user` execute at Face questions (DSH web provider). */
export function bindAskUserTool(
  tools: ToolRegistry,
  ask: (
    questions: readonly FaceQuestionItem[],
    signal?: AbortSignal,
  ) => Promise<string>,
): void {
  const prev = tools.get("ask_user");
  if (!prev) return;
  tools.replace({
    name: prev.name,
    description: prev.description,
    parameters: prev.parameters,
    ...(prev.presentCall ? { presentCall: prev.presentCall } : {}),
    ...(prev.presentResult ? { presentResult: prev.presentResult } : {}),
    async execute(args, signal) {
      const questions = coerceAskUserQuestions(args);
      if (!questions) {
        return { content: "ask_user: empty or invalid questions", isError: true };
      }
      try {
        return { content: await ask(questions, signal) };
      } catch (err) {
        if (err instanceof FaceQuestionError) {
          return { content: err.message, isError: true };
        }
        throw err;
      }
    },
  });
}

function planReviewQuestions(plan: string): FaceQuestionItem[] {
  return [
    {
      id: PLAN_REVIEW_ID,
      header: "Plan review",
      question: "Approve this plan and leave plan mode?",
      detail: plan,
      options: [
        {
          label: PLAN_APPROVE_LABEL,
          description:
            "Leave plan mode; the plan is carried out from the next step.",
        },
        {
          label: PLAN_KEEP_LABEL,
          description: "Stay in plan mode; feedback goes back to the model.",
        },
      ],
      intent: { kind: "plan-review", approve: PLAN_APPROVE_LABEL },
    },
  ];
}

/** Point `exit_plan_mode` at Face questions + session fold. Always registered. */
export function bindExitPlanModeTool(
  tools: ToolRegistry,
  store: SessionStore,
  sessionId: string,
  ask: (
    questions: readonly FaceQuestionItem[],
    signal?: AbortSignal,
  ) => Promise<FaceQuestionAnswer>,
): void {
  const bound = createExitPlanModeTool({
    isActive: () => foldPlanMode(store.get(sessionId).events),
    async askReview(plan, signal) {
      try {
        const answer = await ask(planReviewQuestions(plan), signal);
        const item = answer.answers.find((row) => row.id === PLAN_REVIEW_ID);
        if (
          item?.selected.length === 1 &&
          item.selected[0] === PLAN_APPROVE_LABEL &&
          item.custom === undefined
        ) {
          return { approved: true };
        }
        return {
          approved: false,
          ...(item?.custom !== undefined ? { feedback: item.custom } : {}),
        };
      } catch (err) {
        if (err instanceof FaceQuestionError && err.code === "ASK_CANCELLED") {
          return { approved: false, dismissed: true };
        }
        throw err;
      }
    },
  });
  if (tools.get("exit_plan_mode")) tools.replace(bound);
  else tools.register(bound);
}
