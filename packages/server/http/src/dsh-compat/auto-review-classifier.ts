/**
 * Auto-review classifier seam.
 * Default is the local heuristic. Replace it with `options.classifier`,
 * Face Settings `auto-review.classifierUrl` (+ Credentials token), or
 * POST `XRK_AUTO_REVIEW_CLASSIFIER_URL` (CI bypass). Not a Cordis host.
 */
import { classifyAutoReviewHeuristic } from "./host-feature-bridge.js";

export const AUTO_REVIEW_CLASSIFIER_URL = "XRK_AUTO_REVIEW_CLASSIFIER_URL";
export const AUTO_REVIEW_CLASSIFIER_TOKEN = "XRK_AUTO_REVIEW_CLASSIFIER_TOKEN";

export type AutoReviewVerdict = "allow" | "deny" | "ask";

export interface AutoReviewClassification {
  readonly verdict: AutoReviewVerdict;
  readonly reason: string;
  readonly confidence: number;
}

export type AutoReviewClassifier = (
  payload: Record<string, unknown>,
) => AutoReviewClassification | Promise<AutoReviewClassification>;

export interface AutoReviewClassifierOptions {
  readonly classifier?: AutoReviewClassifier;
  /** Wire id when `classifier` is set. Default `plugin`. */
  readonly classifierId?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly fetchImpl?: typeof fetch;
  /**
   * Face product (`auto-review` ns + Credentials token). Ignored when
   * `XRK_AUTO_REVIEW_CLASSIFIER_URL` is set (CI bypass).
   */
  readonly product?: {
    readonly classifierUrl?: string;
    readonly classifierToken?: string;
  };
}

export interface ResolvedAutoReviewClassifier {
  readonly id: string;
  readonly kind: "plugin" | "http" | "heuristic";
  readonly run: AutoReviewClassifier;
}

const VERDICTS = new Set<AutoReviewVerdict>(["allow", "deny", "ask"]);

function isVerdict(value: unknown): value is AutoReviewVerdict {
  return typeof value === "string" && VERDICTS.has(value as AutoReviewVerdict);
}

export function normalizeAutoReviewClassification(
  raw: Record<string, unknown>,
): AutoReviewClassification {
  const verdict = isVerdict(raw.verdict)
    ? raw.verdict
    : isVerdict(raw.decision)
      ? raw.decision
      : undefined;
  if (!verdict) {
    throw new Error("auto-review: verdict must be allow, deny, or ask");
  }
  const confidence =
    typeof raw.confidence === "number" && Number.isFinite(raw.confidence)
      ? Math.min(1, Math.max(0, raw.confidence))
      : 0.5;
  const reason =
    typeof raw.reason === "string" && raw.reason.trim()
      ? raw.reason.trim()
      : "classifier";
  return { verdict, reason, confidence };
}

export function createHttpAutoReviewClassifier(options: {
  readonly url: string;
  readonly token?: string;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
}): AutoReviewClassifier {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 8000;
  const endpoint = options.url.replace(/\/+$/, "");
  return async (payload) => {
    const headers: Record<string, string> = {
      accept: "application/json",
      "content-type": "application/json",
    };
    if (options.token) headers.authorization = `Bearer ${options.token}`;
    const res = await fetchImpl(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      throw new Error(`auto-review classifier upstream ${res.status}`);
    }
    const body = (await res.json()) as Record<string, unknown>;
    return normalizeAutoReviewClassification(body);
  };
}

export function resolveAutoReviewClassifier(
  options: AutoReviewClassifierOptions = {},
): ResolvedAutoReviewClassifier {
  if (options.classifier) {
    const run = options.classifier;
    return {
      id: options.classifierId?.trim() || "plugin",
      kind: "plugin",
      run: async (payload) =>
        normalizeAutoReviewClassification(
          (await run(payload)) as unknown as Record<string, unknown>,
        ),
    };
  }
  const env = options.env ?? process.env;
  const envUrl = env[AUTO_REVIEW_CLASSIFIER_URL]?.trim();
  if (envUrl) {
    const token = env[AUTO_REVIEW_CLASSIFIER_TOKEN]?.trim();
    return {
      id: "http",
      kind: "http",
      run: createHttpAutoReviewClassifier({
        url: envUrl,
        ...(token ? { token } : {}),
        ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
      }),
    };
  }
  const productUrl = options.product?.classifierUrl?.trim();
  if (productUrl) {
    const token =
      options.product?.classifierToken?.trim() ||
      env[AUTO_REVIEW_CLASSIFIER_TOKEN]?.trim();
    return {
      id: "http",
      kind: "http",
      run: createHttpAutoReviewClassifier({
        url: productUrl,
        ...(token ? { token } : {}),
        ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
      }),
    };
  }
  return {
    id: "xrk-heuristic",
    kind: "heuristic",
    run: (payload) => classifyAutoReviewHeuristic(payload),
  };
}

export async function classifyAutoReview(
  payload: Record<string, unknown>,
  options: AutoReviewClassifierOptions = {},
): Promise<{
  ok: boolean;
  classifier: string;
  classification: AutoReviewClassification;
  error?: string;
}> {
  const resolved = resolveAutoReviewClassifier(options);
  try {
    const classification = normalizeAutoReviewClassification(
      (await resolved.run(payload)) as unknown as Record<string, unknown>,
    );
    return { ok: true, classifier: resolved.id, classification };
  } catch (err) {
    return {
      ok: false,
      classifier: resolved.id,
      classification: {
        verdict: "ask",
        reason: "classifier-error",
        confidence: 0,
      },
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export type AutoReviewAccessKind = "heuristic" | "http" | "plugin";

export interface AutoReviewAccessDescription {
  readonly kind: AutoReviewAccessKind;
  readonly classifierId: string;
  /** Settings / env / default — where the active classifier came from. */
  readonly source: "plugin" | "env" | "product" | "default";
  readonly summary: string;
}

/**
 * Doctor / Settings readiness for the auto-review classifier seam
 * (same resolve path as `/auto-review/classify`).
 */
export function describeAutoReviewAccess(
  env: NodeJS.ProcessEnv = process.env,
  product?: {
    readonly classifierUrl?: string;
    readonly classifierToken?: string;
  },
): AutoReviewAccessDescription {
  if (env[AUTO_REVIEW_CLASSIFIER_URL]?.trim()) {
    return {
      kind: "http",
      classifierId: "http",
      source: "env",
      summary: `http · ${AUTO_REVIEW_CLASSIFIER_URL} (CI bypass) · fail→ask`,
    };
  }
  const productUrl = product?.classifierUrl?.trim();
  if (productUrl) {
    return {
      kind: "http",
      classifierId: "http",
      source: "product",
      summary: `http · Settings auto-review.classifierUrl · fail→ask`,
    };
  }
  return {
    kind: "heuristic",
    classifierId: "xrk-heuristic",
    source: "default",
    summary:
      "heuristic · Settings Plugins → Advanced auto-review empty · not an LLM Guardian",
  };
}

/** Sample classify used by `xrkh doctor` (fail-closed for HTTP). */
export async function probeAutoReviewClassifier(
  options: AutoReviewClassifierOptions = {},
): Promise<{
  readonly ok: boolean;
  readonly detail: string;
}> {
  const desc = describeAutoReviewAccess(options.env, options.product);
  const result = await classifyAutoReview(
    { toolName: "read_file", args: { path: "README.md" } },
    options,
  );
  if (!result.ok) {
    return {
      ok: false,
      detail: `${desc.kind} probe failed: ${result.error ?? "classifier-error"}`,
    };
  }
  return {
    ok: true,
    detail: `${desc.kind} probe ok · verdict=${result.classification.verdict} · id=${result.classifier}`,
  };
}
