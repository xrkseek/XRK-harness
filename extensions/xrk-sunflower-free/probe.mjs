/**
 * OFM-shaped availability ping for the OpenCode free roster.
 *
 * Shape: `ping` + `max_tokens: 16` + stream; one session per model;
 * fan-out concurrency 2 (wide burst → 429 on the same quota window).
 *
 * Product rule (stricter than OFM picker): only `available` enters the Host
 * catalog. `throttled` (FreeUsageLimit) / `unavailable` / `unknown` → omit.
 * Kilo stays listing-only (no chat probe).
 *
 * 判据（每次踩坑换来的）：
 *   - **2xx 不算可用**。上游限流/软拒绝会包在 200 里：空 body、只有一帧
 *     role delta、或先给一帧再报错。必须看到**终止帧**（`finish_reason`
 *     非 null / `data: [DONE]`）且**真的产出过 content** 才算 available。
 *   - 首帧就 cancel 是假阳性主因：那一帧往往只是 `{"delta":{"role":...}}`。
 *   - 额度文案各入口不同（OpenCode 说 `FreeUsageLimit`，别的入口说
 *     `You've used today's free messages`），关键词表宁可宽。
 *   - 流里出现 error 对象时，`"error": null` 不算错，`"error": {…}` 才算。
 */
import { FREE_MODELS } from "./free-models.mjs";

/** Loopback health only — shared by probe + plugin boot. */
export async function sidecarHealthy(handle, timeoutMs = 4000) {
  try {
    const health = await fetch(
      `${String(handle.url).replace(/\/v1\/?$/, "")}/__sunflower/health`,
      { signal: AbortSignal.timeout(timeoutMs) },
    );
    return health.ok;
  } catch {
    return false;
  }
}

/** 额度 / 限流类措辞。不同入口一套话术，宁可宽一点判成 throttled。 */
const THROTTLED_RE =
  /FreeUsageLimit|free usage limit|used today'?s free|free (?:messages|usage)|reset(?:s)? at|quota|rate.?limit|too many requests|exhausted|no (?:more )?credits|subscribe to/iu;

/** 上游真的没有这个模型 / 不路由它。 */
const UNAVAILABLE_RE =
  /unavailable|not supported|no such model|unknown model|does not exist|model not found/iu;

/** SSE 终止帧 —— 只有它才算「这一轮真的跑完」。 */
const FINISH_RE =
  /"finish_reason"\s*:\s*"(?:stop|length|tool_calls|function_call|content_filter)"/u;
const DONE_RE = /data:\s*\[DONE\]/u;
/** 有实际产出的内容帧。`"content":""` 这种空 delta 不算。 */
const CONTENT_RE = /"content"\s*:\s*"[^"]/u;
/** 流里报错。要求对象形态，避开正常帧里的 `"error": null`。 */
const ERROR_RE = /"(?:type"\s*:\s*"error"|error"\s*:\s*\{)/u;

/** 兜底上限：异常长的流还没终止帧就别再读了。 */
const MAX_PROBE_BYTES = 256 * 1024;

/** @returns {"throttled"|"unavailable"|"unknown"} */
function classifyFailureBody(body) {
  if (THROTTLED_RE.test(body)) return "throttled";
  return UNAVAILABLE_RE.test(body) ? "unavailable" : "unknown";
}

/**
 * @returns {Promise<"available"|"unavailable"|"throttled"|"unknown">}
 */
export async function probeOneModel(handle, model, timeoutMs = 45000) {
  try {
    const res = await fetch(`${handle.url}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-sunflower-key": handle.key,
        "x-xrk-session": `xrkh-probe-${model}`,
        accept: "text/event-stream",
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "ping" }],
        stream: true,
        max_tokens: 16,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });

    // 429 / 402：额度与付费门，共享出口桶 → 整条车道应短路。
    if (res.status === 429 || res.status === 402) {
      await res.text().catch(() => "");
      return "throttled";
    }
    if (res.status === 400 || res.status === 404 || res.status === 422) {
      return "unavailable";
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return classifyFailureBody(body);
    }

    // 2xx 但没有 body：说明不了任何事。曾在这里直接判 available，是假阳性。
    if (!res.body) return "unknown";

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let sawContent = false;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });

        if (ERROR_RE.test(buf)) {
          await reader.cancel().catch(() => {});
          return classifyFailureBody(buf);
        }
        if (CONTENT_RE.test(buf)) sawContent = true;
        if (FINISH_RE.test(buf) || DONE_RE.test(buf)) {
          await reader.cancel().catch(() => {});
          // 跑完了但一个字没产出 = 上游的软拒绝，不能算可用。
          return sawContent ? "available" : "unknown";
        }
        if (buf.length > MAX_PROBE_BYTES) break;
      }
    } catch {
      await reader.cancel().catch(() => {});
      return "unknown";
    }

    // 流自然结束：有内容才算跑通过（有些上游不发 [DONE]）。
    return sawContent ? "available" : "unknown";
  } catch {
    return "unknown";
  }
}

/**
 * Probe OpenCode candidates; return only ids that answered `available`.
 * Logs omit reasons so Host boot shows why a row disappeared.
 *
 * 见到 `throttled` 就整体短路：这条车道的配额是**共享桶**（`sidecar.ts`
 * 的 lane-refused 注释 + 实测：换 session 一样 429，5 个模型同时死），
 * 所以第一个 429 之后剩下的模型不必再各烧一次真实请求。
 *
 * 串行 + 单模型重试一次：并发 2 会让同一出口 IP 突发两个请求，实测因此
 * 出现过 `ECONNRESET` 被误判成「模型不可用」。串行的代价是时间，所以
 * 外层还有 `budgetMs` 硬顶——超预算的模型一律按 unknown 处理（omit，
 * 宁可这一轮少挂一个，也不假阳性）。
 *
 * @returns {Promise<string[]>}
 */
export async function probeUsableModels(
  handle,
  candidates = FREE_MODELS,
  timeoutMs = 12000,
  concurrency = 1,
  budgetMs = 20000,
) {
  if (!(await sidecarHealthy(handle))) return [];
  /** @type {string[]} */
  const usable = [];
  const queue = [...candidates];
  let laneRefused = false;
  const deadline = Date.now() + budgetMs;

  const worker = async () => {
    while (queue.length > 0 && !laneRefused) {
      if (Date.now() > deadline) {
        console.warn(
          `[sunflower-free] probe budget ${budgetMs}ms exhausted — ${queue.length} model(s) left untested (omit)`,
        );
        return;
      }
      const model = queue.shift();
      if (model === undefined) return;
      let state = await probeOneModel(handle, model, timeoutMs);
      // 网络抖动（ECONNRESET / 超时）表现为 unknown，重试一次能吸收掉；
      // 真的限流会稳定返回 throttled，不会被重试掩盖。
      if (state === "unknown" && Date.now() < deadline) {
        state = await probeOneModel(handle, model, timeoutMs);
      }
      if (state === "available") {
        usable.push(model);
        continue;
      }
      if (state === "throttled") {
        laneRefused = true;
        console.warn(
          `[sunflower-free] ${model}: FreeUsageLimit / quota — lane refused, skip ${queue.length} remaining model(s)`,
        );
        return;
      }
      const why =
        state === "unavailable"
          ? "upstream will not route"
          : "no clear verdict (2xx without a finished, content-bearing stream)";
      console.warn(`[sunflower-free] ${model}: ${why} (omit on this Host)`);
    }
  };

  const n = Math.max(1, Math.min(concurrency, candidates.length || 1));
  await Promise.all(Array.from({ length: n }, worker));
  return usable;
}
