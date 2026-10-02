/**
 * Tool-pipeline pre-handler for Auto Review (DSH Guardian parity).
 *
 * Gates (both required — not redundant):
 * 1. **Session permission preset === `auto`** — only Auto sessions are reviewed
 *    (DSH `permissionPresets.current(session) === AUTO_PRESET`).
 * 2. **Settings `auto-review.enabled` (or `isEnabled`)** — process-level master
 *    switch; when off, no review even while the session is on Auto.
 *
 * Deny mapping: under session approval `never`, deny is final
 * (`AUTO_REVIEW_DENIED`); under `ask` (default), remaps to Face approval.
 * Classifier / stream failures fail-closed as final deny (DSH `failed`).
 */
import type {
  PreHandler,
  PreOutcome,
  ToolPipelineContext,
} from "@xrkseek/core-tools";
import {
  foldPermissionKnobs,
  TOOL_ABORTED_BEFORE_DISPATCH,
  TOOL_ABORTED_BEFORE_DISPATCH_MESSAGE,
  type SessionEvent,
} from "@xrkseek/protocol";
import {
  classifyAutoReview,
  type AutoReviewClassifierOptions,
} from "./auto-review-classifier.js";
import { filterAutoReviewSessionHistory } from "./auto-review-history.js";
import {
  isAutoReviewEnabled,
  recordAutoReviewAllow,
  recordAutoReviewDeny,
  recordAutoReviewFallback,
  type AutoReviewOptions,
} from "./auto-review-http.js";

/** Strip live `product()` so store/stats helpers get plain {@link AutoReviewOptions}. */
function storeOptions(options: AutoReviewToolPreOptions): AutoReviewOptions {
  const { product: _product, ...rest } = options;
  return rest;
}

/** Structured error persisted on every final Auto-review denial. */
export const AUTO_REVIEW_DENIED_ERROR_NAME = "AutoReviewDeniedError";
/** Structured error code persisted on every final Auto-review denial. */
export const AUTO_REVIEW_DENIED_CODE = "AUTO_REVIEW_DENIED";

/** Durable Auto identity written by Face `/permission auto`. */
export const AUTO_REVIEW_SESSION_PRESET = "auto" as const;

/**
 * Code Mode / PTC outer transport (DSH `RUN_CODE_NAME`). Auto-review skips this
 * call and reviews each nested `tools.*` re-entry once (`ptc-inner`).
 */
export const AUTO_REVIEW_RUN_CODE_NAME = "run_code" as const;

export interface AutoReviewToolPreOptions extends Omit<AutoReviewOptions, "product"> {
  /**
   * Process master switch (Face Settings `auto-review.enabled` / Host).
   * When omitted, falls back to the dsh-compat store. Off → no review even on Auto.
   */
  readonly isEnabled?: () => boolean;
  /** Live classifier product (Face Settings URL + Credentials token). */
  readonly product?: () => AutoReviewClassifierOptions["product"] | undefined;
  /** @deprecated Ask UI localizes via displayReason en/zh; audit reason stays English. */
  readonly locale?: () => "zh" | "en" | undefined;
  /**
   * How classifier `deny` should land: `deny` = final (structured error);
   * `ask` = Face approval (DSH under session approval ask). Default `ask`.
   * Independent of {@link onClassifierError} (technical / parse failures).
   */
  readonly resolveDenyAction?: () => "deny" | "ask";
  /**
   * How classifier **technical** failures land (`!ok`: HTTP / parse / empty /
   * illegal risk×decision). Default **`ask`** → Face approval (`defer-ask`) so
   * a broken reviewer does not silently hard-block the tool. Set **`deny`** for
   * fail-closed final `AUTO_REVIEW_DENIED` (CI / headless). Abort / dispose still
   * cancel via {@link TOOL_ABORTED_BEFORE_DISPATCH} and ignore this knob.
   */
  readonly onClassifierError?: "ask" | "deny";
  /**
   * Session working directory for ENVIRONMENT.cwd in the reviewer prompt.
   * Host wires Face session cwd / workspace root.
   */
  readonly resolveCwd?: () => string | undefined;
  /**
   * Live session log for PROJECT_INSTRUCTIONS + FILTERED_HISTORY and for the
   * Auto preset gate. Host wires `readSessionEvents(store, sessionId)`.
   */
  readonly resolveSessionEvents?: () => readonly SessionEvent[] | undefined;
  /**
   * Override the Auto preset gate (tests). Default: folded
   * `permission/preset` from {@link resolveSessionEvents}.
   */
  readonly resolvePermissionPreset?: () => string | null | undefined;
  /**
   * Live Auto integration lifecycle (Host `permissionAuto.lifecycle()`).
   * When accepting is false or the signal aborts, reviews cancel without
   * dispatching the tool body (DSH dispose).
   */
  readonly lifecycle?: {
    readonly signal: AbortSignal;
    isAccepting(): boolean;
    track(work: Promise<unknown>): void;
  };
  /** Optional seq of the direct-parent creation prompt (subagent). */
  readonly resolveDirectParentPromptSeq?: () => number | undefined;
}

/**
 * Whether the session log's last `permission/preset` is Auto.
 * Missing events / null preset → false (fail closed: no review).
 */
export function sessionPermissionPresetIsAuto(
  events: readonly SessionEvent[] | undefined,
): boolean {
  if (!events) return false;
  return foldPermissionKnobs(events).preset === AUTO_REVIEW_SESSION_PRESET;
}

function shouldRunAutoReview(options: AutoReviewToolPreOptions): boolean {
  const preset =
    options.resolvePermissionPreset?.() ??
    foldPermissionKnobs(options.resolveSessionEvents?.() ?? []).preset;
  if (preset !== AUTO_REVIEW_SESSION_PRESET) return false;
  return options.isEnabled?.() ?? isAutoReviewEnabled(storeOptions(options));
}

const REASON_ZH: Readonly<Record<string, string>> = {
  "destructive-pattern": "匹配到破坏性命令模式",
  "network-fetch": "涉及网络抓取",
  "sensitive-tool": "敏感工具，需确认",
  "heuristic-pass": "启发式放行",
  "classifier-error": "自动审查失败，已拒绝执行",
  "session-llm-allow": "会话模型放行",
  "session-llm-deny": "会话模型拒绝",
  classifier: "自动审查",
};

/**
 * Review payload: cwd + tool name/args/schema + filtered history /
 * project instructions when session events are available.
 */
export function buildAutoReviewToolPayload(
  ctx: {
    readonly call: { readonly id?: string; readonly name: string };
    readonly args: unknown;
    readonly definition?: {
      readonly name: string;
      readonly description: string;
      readonly parameters: Record<string, unknown>;
    };
  },
  options: {
    readonly cwd?: string;
    readonly projectInstructions?: readonly unknown[];
    readonly history?: readonly unknown[];
    /** DSH PENDING_ACTION.mode — nested Code Mode / PTC inners are `ptc-inner`. */
    readonly mode?: "native" | "ptc-inner";
  } = {},
): Record<string, unknown> {
  const args =
    ctx.args && typeof ctx.args === "object" && !Array.isArray(ctx.args)
      ? (ctx.args as Record<string, unknown>)
      : ctx.args ?? {};
  const description = ctx.definition?.description ?? "";
  const parameters = ctx.definition?.parameters ?? {};
  return {
    toolName: ctx.call.name,
    name: ctx.call.name,
    args,
    description,
    parameters,
    ...(options.mode !== undefined ? { mode: options.mode } : {}),
    ...(options.cwd !== undefined && options.cwd !== ""
      ? { cwd: options.cwd }
      : {}),
    ...(options.projectInstructions !== undefined
      ? { projectInstructions: options.projectInstructions }
      : {}),
    ...(options.history !== undefined ? { history: options.history } : {}),
  };
}

function toolPayload(
  ctx: {
    readonly call: { readonly id: string; readonly name: string };
    readonly args: unknown;
    readonly parentCallId?: string;
    readonly definition?: {
      readonly name: string;
      readonly description: string;
      readonly parameters: Record<string, unknown>;
    };
  },
  options: AutoReviewToolPreOptions,
): Record<string, unknown> {
  const cwd = options.resolveCwd?.()?.trim();
  const events = options.resolveSessionEvents?.();
  const parentSeq = options.resolveDirectParentPromptSeq?.();
  const filtered =
    events !== undefined
      ? filterAutoReviewSessionHistory(events, {
          excludeToolCallId: ctx.call.id,
          ...(parentSeq !== undefined
            ? { directParentPromptSeq: parentSeq }
            : {}),
        })
      : undefined;
  return buildAutoReviewToolPayload(ctx, {
    mode: ctx.parentCallId !== undefined ? "ptc-inner" : "native",
    ...(cwd ? { cwd } : {}),
    ...(filtered
      ? {
          projectInstructions: filtered.projectInstructions,
          history: filtered.history,
        }
      : {}),
  });
}

function denialError(reviewerReason: string): {
  readonly name: string;
  readonly code: string;
  readonly reason: string;
} {
  return {
    name: AUTO_REVIEW_DENIED_ERROR_NAME,
    code: AUTO_REVIEW_DENIED_CODE,
    reason: reviewerReason,
  };
}

function deniedOutcome(
  toolName: string,
  reviewerReason: string,
): PreOutcome {
  return {
    action: "deny",
    reason: `Auto review rejected tool "${toolName}"; its body was not executed`,
    error: denialError(reviewerReason),
  };
}

function askOutcome(toolName: string, reviewerReason: string): PreOutcome {
  // DSH askUser: audited reason stays English; displayReason carries en/zh UI copy.
  const denial =
    reviewerReason === ""
      ? `Auto review denied tool "${toolName}"`
      : `Auto review denied tool "${toolName}": ${reviewerReason}`;
  const zhDetail =
    reviewerReason === ""
      ? undefined
      : (REASON_ZH[reviewerReason] ?? reviewerReason);
  return {
    action: "defer-ask",
    reason: denial,
    displayReason:
      reviewerReason === ""
        ? {
            en: "Auto review denied this call.",
            zh: "Auto review 拒绝了此调用。",
          }
        : {
            en: `Auto review denied this call: ${reviewerReason}`,
            zh: `Auto review 拒绝了此调用：${zhDetail}`,
          },
    error: denialError(reviewerReason),
  };
}

/**
 * DSH `{ kind: 'cancel' }` — XRK PreOutcome has no cancel arm, so pipeline
 * deny + {@link TOOL_ABORTED_BEFORE_DISPATCH} is the wire-equivalent (never
 * {@link AUTO_REVIEW_DENIED_CODE} / ask).
 */
function cancelledOutcome(detail?: string): PreOutcome {
  const reason = detail?.trim() || TOOL_ABORTED_BEFORE_DISPATCH_MESSAGE;
  return {
    action: "deny",
    reason,
    error: {
      name: "AbortError",
      code: TOOL_ABORTED_BEFORE_DISPATCH,
      reason,
    },
  };
}

function isAbortLike(err: unknown): boolean {
  if (
    (err instanceof DOMException || err instanceof Error) &&
    err.name === "AbortError"
  ) {
    return true;
  }
  if (err instanceof Error && /\baborted\b/i.test(err.message)) return true;
  return false;
}

function reviewCancelled(
  reviewSignal: AbortSignal | undefined,
  life:
    | {
        readonly signal: AbortSignal;
        isAccepting(): boolean;
      }
    | undefined,
): boolean {
  if (life !== undefined && (!life.isAccepting() || life.signal.aborted)) {
    return true;
  }
  return reviewSignal?.aborted === true;
}

/**
 * Pre-execute auto-review: maps classifier verdicts to pipeline continue /
 * deny / ask (Face approval). Mid-review abort / dispose returns
 * {@link TOOL_ABORTED_BEFORE_DISPATCH} (DSH cancel), never ordinary deny/ask.
 * No-op unless session preset is Auto and the Settings master switch is on.
 *
 * **Install with {@link import("@xrkseek/core-tools").ToolPipeline.prependPre}**
 * (harness composition does). Soft floors stay on `onPre` so classify /
 * `defer-ask` still sees downstream deny · ask · cancel (DSH next()).
 *
 * **Classifier error:** {@link AutoReviewToolPreOptions.onClassifierError}
 * (`ask` default · `deny` fail-closed). Distinct from
 * {@link AutoReviewToolPreOptions.resolveDenyAction} (reviewer `deny` verdict).
 */
export function createAutoReviewToolPre(
  options: AutoReviewToolPreOptions = {},
): PreHandler {
  return async (ctx: ToolPipelineContext): Promise<PreOutcome> => {
    if (!shouldRunAutoReview(options)) {
      return { action: "continue", args: ctx.args };
    }

    // DSH Auto: outer `run_code` is transport only — skip review here. Nested
    // `await tools.*` re-enter this pre with `parentCallId` and are reviewed
    // once each as PENDING_ACTION.mode = ptc-inner.
    if (
      ctx.call.name === AUTO_REVIEW_RUN_CODE_NAME &&
      ctx.parentCallId === undefined
    ) {
      return { action: "continue", args: ctx.args };
    }

    const life = options.lifecycle;
    const reviewSignal =
      life !== undefined && ctx.signal
        ? AbortSignal.any([ctx.signal, life.signal])
        : life !== undefined
          ? life.signal
          : ctx.signal;

    if (reviewCancelled(reviewSignal, life)) {
      return cancelledOutcome(
        life !== undefined && (!life.isAccepting() || life.signal.aborted)
          ? "auto-review integration disposed"
          : undefined,
      );
    }

    const product =
      typeof options.product === "function" ? options.product() : undefined;
    const store = storeOptions(options);

    const startedAt = Date.now();
    const classify = classifyAutoReview(toolPayload(ctx, options), {
      ...(options.classifier !== undefined
        ? { classifier: options.classifier }
        : {}),
      ...(options.classifierId !== undefined
        ? { classifierId: options.classifierId }
        : {}),
      ...(options.reviewer !== undefined ? { reviewer: options.reviewer } : {}),
      ...(options.resolveLlm !== undefined
        ? { resolveLlm: options.resolveLlm }
        : {}),
      ...(options.env !== undefined ? { env: options.env } : {}),
      ...(options.fetchImpl !== undefined
        ? { fetchImpl: options.fetchImpl }
        : {}),
      ...(product !== undefined ? { product } : {}),
      ...(reviewSignal ? { signal: reviewSignal } : {}),
    });

    let settled: Awaited<typeof classify>;
    if (life !== undefined) {
      const tracked = classify.then(
        (value) => value,
        (error: unknown) => {
          throw error;
        },
      );
      life.track(tracked.then(() => undefined, () => undefined));
      try {
        settled = await tracked;
      } catch (error) {
        if (reviewCancelled(reviewSignal, life) || isAbortLike(error)) {
          return cancelledOutcome(
            life.signal.aborted || !life.isAccepting()
              ? "auto-review integration disposed"
              : undefined,
          );
        }
        throw error;
      }
    } else {
      try {
        settled = await classify;
      } catch (error) {
        if (reviewCancelled(reviewSignal, life) || isAbortLike(error)) {
          return cancelledOutcome();
        }
        throw error;
      }
    }

    // DSH: after classifyRisk settles, lifecycle/caller abort still wins over
    // allow / deny / failed — never remap abort into AutoReviewDenied / ask.
    if (reviewCancelled(reviewSignal, life)) {
      return cancelledOutcome(
        life !== undefined && (!life.isAccepting() || life.signal.aborted)
          ? "auto-review integration disposed"
          : undefined,
      );
    }
    if (settled.aborted === true) {
      return cancelledOutcome();
    }

    const durationMs = Math.max(0, Date.now() - startedAt);
    const result = settled;
    // Audit / deny error.reason stay English (DSH). UI localization rides
    // displayReason on the ask path, not this string.
    const reason = result.classification.reason;
    const verdict = result.classification.verdict;

    // Stream / HTTP / parse / illegal JSON — technical failure (`!ok`).
    // Default ask (Face); onClassifierError:'deny' keeps fail-closed hard deny.
    if (!result.ok) {
      const detail =
        reason === "classifier-error" && result.error
          ? `${reason}: ${result.error}`
          : reason;
      if ((options.onClassifierError ?? "ask") === "deny") {
        recordAutoReviewDeny(store, ctx.call.name, durationMs);
        return deniedOutcome(ctx.call.name, detail);
      }
      recordAutoReviewFallback(store, durationMs);
      return askOutcome(ctx.call.name, detail);
    }

    if (verdict === "allow") {
      recordAutoReviewAllow(store, durationMs);
      return { action: "continue", args: ctx.args };
    }
    if (verdict === "deny") {
      const denyAction = options.resolveDenyAction?.() ?? "ask";
      if (denyAction === "deny") {
        recordAutoReviewDeny(store, ctx.call.name, durationMs);
        return deniedOutcome(ctx.call.name, reason);
      }
      recordAutoReviewFallback(store, durationMs);
      return askOutcome(ctx.call.name, reason);
    }
    // ask
    recordAutoReviewFallback(store, durationMs);
    return askOutcome(ctx.call.name, reason);
  };
}
