/**
 * 向日葵免费 — Bun sidecar。
 *
 * 为什么需要独立进程：该车道的网关按 TLS/HTTP 客户端栈做准入，Bun 的栈在
 * 允许列表内；Node 的栈会被归进共享配额池，返回 429。Host 是 Node，
 * 所以这条车道的 egress 交给一个 Bun 子进程。
 *
 * 这个进程做四件事（缺一即拒绝）：
 *   1. 以车道要求的 system 文本打底，把调用方的 persona 追加在后面；
 *   2. 注入 `read` + `shell` 两个必需的工具定义（形状须逐字）；
 *   3. 按会话铸造并复用会话标识（配额按 session 计）；
 *   4. 上游出口：默认直连（`proxy: false`）。本机 Clash 等可设
 *      `XRK_SUNFLOWER_PROXY` 或 `HTTPS_PROXY`/`HTTP_PROXY`/`ALL_PROXY`
 *      （例如 `http://127.0.0.1:7897`）换出口 IP；显式 `0`/`false`/`off` 仍直连。
 *
 * 只监听 127.0.0.1，并带每次启动生成的一次性 key：不做开放代理。
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { FINGERPRINT } from "./fingerprint.js";

const UPSTREAM = "https://opencode.ai";
const PATH_PREFIX = "/v1";
/** 车道要求的客户端标识：整串匹配，不能拼接额外信息。 */
const CLIENT_UA = "opencode/latest/2.2.0/cli";
const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

export interface SidecarOptions {
  /** 0 = 让内核挑空闲端口（默认）。 */
  readonly port?: number;
  /** 固定一次性 key；省略则每次启动 mint。 */
  readonly key?: string;
  /** 探针/测试注入用。 */
  readonly fetchImpl?: typeof fetch;
}

export interface SidecarHandle {
  readonly url: string;
  readonly key: string;
  readonly port: number;
  stop(): Promise<void>;
}

/** 报错分类：车道被拒 ≠ 模型限流。 */
export type LaneVerdict =
  | { readonly kind: "ok" }
  | {
      /** 出口运行时不对：整条车道对所有模型同时 429 且共享同一倒计时。 */
      readonly kind: "lane-refused";
      readonly retryAfterSeconds?: number;
    }
  | { readonly kind: "upstream-error"; readonly status: number; readonly detail: string };

const base62From = (bytes: Uint8Array): string => {
  let out = "";
  for (const byte of bytes) out += BASE62[byte % 62];
  return out;
};

/**
 * 铸造 gateway 形状的 canonical session id。
 *
 * 编码是闸门的约定：`~(ts_ms * 0x1000 + counter)`，低 12 位落在
 * `0xfff - counter`。counter 每毫秒重置，连铸也不会越过 1–63 窗口。
 * 升序 `ts_ms << 12`、sha256 摘要、随机 hex —— 形状再像也会被拒。
 */
export function mintSessionId(timestamp = Date.now(), counter = 1): string {
  const value = ~(BigInt(timestamp) * 0x1000n + BigInt(counter));
  let hex = "";
  for (let i = 0; i < 6; i += 1) {
    hex += Number((value >> BigInt(40 - 8 * i)) & 0xffn)
      .toString(16)
      .padStart(2, "0");
  }
  return `ses_${hex}${base62From(randomBytes(14))}`;
}

/** 一个上游会话对应一个 xrkh 会话：配额按 session 计，每请求新造会自打 429。 */
export class SessionIdPool {
  private readonly byKey = new Map<string, string>();
  private lastStamp = 0;
  private seq = 0;

  constructor(private readonly mint: () => string = () => this.mintStable()) {}

  private mintStable(): string {
    const now = Date.now();
    if (now !== this.lastStamp) {
      this.lastStamp = now;
      this.seq = 0;
    }
    this.seq += 1;
    return mintSessionId(now, Math.min(this.seq, 63));
  }

  /** @param key - xrkh session id；缺省时退化成进程级单会话。 */
  get(key: string | undefined): string {
    const id = (key ?? "").trim() || "__default__";
    const hit = this.byKey.get(id);
    if (hit) return hit;
    const minted = this.mint();
    this.byKey.set(id, minted);
    return minted;
  }

  /** 上游说这个 session 被限时，丢掉它，下次换新（配额可能按 session 轮换）。 */
  forget(key: string | undefined): void {
    this.byKey.delete((key ?? "").trim() || "__default__");
  }
}

interface ChatBody {
  model?: unknown;
  messages?: unknown;
  stream?: unknown;
  [key: string]: unknown;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** OpenCode gate names → XRK Host tool names (avoid `Unknown tool: read|shell`). */
const DOWNSTREAM_TOOL_NAMES: Readonly<Record<string, string>> = {
  read: "read_file",
  shell: "bash",
};

function toolDefName(tool: unknown): string | undefined {
  if (!isRecord(tool)) return undefined;
  if (isRecord(tool.function) && typeof tool.function.name === "string") {
    return tool.function.name;
  }
  if (typeof tool.name === "string") return tool.name;
  return undefined;
}

/**
 * Remap OpenCode fingerprint tool names (and shell arg aliases) so Host can
 * settle calls against `read_file` / `bash`.
 */
export function remapDownstreamToolCall(call: unknown): unknown {
  if (!isRecord(call)) return call;
  const fn = isRecord(call.function) ? { ...call.function } : undefined;
  if (!fn || typeof fn.name !== "string") return call;
  const mapped = DOWNSTREAM_TOOL_NAMES[fn.name];
  if (!mapped) return call;
  if (typeof fn.arguments === "string" && fn.name === "shell") {
    try {
      const args = JSON.parse(fn.arguments) as Record<string, unknown>;
      if (typeof args.timeout === "number" && args.timeout_ms === undefined) {
        args.timeout_ms = args.timeout;
        delete args.timeout;
      }
      fn.arguments = JSON.stringify(args);
    } catch {
      /* leave partial stream args alone */
    }
  }
  fn.name = mapped;
  return { ...call, function: fn };
}

function remapToolCallsInPlace(node: Record<string, unknown>): void {
  if (Array.isArray(node.tool_calls)) {
    node.tool_calls = node.tool_calls.map(remapDownstreamToolCall);
  }
}

/** Rewrite one OpenAI chat-completion JSON object (stream delta or full body). */
export function remapDownstreamCompletionJson(raw: string): string {
  try {
    const data = JSON.parse(raw) as unknown;
    if (!isRecord(data) || !Array.isArray(data.choices)) return raw;
    for (const choice of data.choices) {
      if (!isRecord(choice)) continue;
      if (isRecord(choice.delta)) remapToolCallsInPlace(choice.delta);
      if (isRecord(choice.message)) remapToolCallsInPlace(choice.message);
    }
    return JSON.stringify(data);
  } catch {
    return raw;
  }
}

/** Transform an SSE upstream body so Host never sees bare `read` / `shell`. */
export function remapDownstreamSseStream(
  upstream: ReadableStream<Uint8Array>,
): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let pending = "";
  const reader = upstream.getReader();
  return new ReadableStream({
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) {
        if (pending.trim()) {
          controller.enqueue(encoder.encode(pending));
          pending = "";
        }
        controller.close();
        return;
      }
      pending += decoder.decode(value, { stream: true });
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      let out = "";
      for (const line of lines) {
        if (line.startsWith("data:")) {
          const payload = line.slice(5).trimStart();
          if (payload && payload !== "[DONE]") {
            out += `data: ${remapDownstreamCompletionJson(payload)}\n`;
            continue;
          }
        }
        out += `${line}\n`;
      }
      if (out) controller.enqueue(encoder.encode(out));
    },
    cancel(reason) {
      void reader.cancel(reason);
    },
  });
}

/**
 * 把 Host 发来的请求补成车道要求的形状。
 *
 * 实测（2026-10-29）：system 打底后可以追加调用方自己的段落；多轮对话、
 * `tool_calls`、`role: tool` 都放行。整段替换 system 会被拒。
 * tools：保留 Host 真工具，并追加 OpenCode 门禁要求的 `read`+`shell` 逐字定义；
 * 少一个门禁工具会 429。回程再把 `read`/`shell` 映射成 Host 的 `read_file`/`bash`。
 */
export function buildUpstreamBody(body: ChatBody): ChatBody {
  const rawMessages = Array.isArray(body.messages) ? body.messages : [];
  const systemParts: string[] = [];
  const rest: unknown[] = [];
  for (const message of rawMessages) {
    if (isRecord(message) && message.role === "system") {
      const content = message.content;
      if (typeof content === "string" && content.trim()) systemParts.push(content.trim());
      continue;
    }
    rest.push(message);
  }

  const persona = systemParts.join("\n\n");
  const system =
    persona.length > 0
      ? `${FINGERPRINT.system}\n\n<!-- xrkh persona (appended, upstream allows a suffix) -->\n${persona}`
      : FINGERPRINT.system;

  const hostTools = Array.isArray(body.tools) ? body.tools : [];
  const kept = hostTools.filter((tool) => {
    const name = toolDefName(tool);
    return name !== "read" && name !== "shell";
  });

  return {
    ...body,
    messages: [{ role: "system", content: system }, ...rest],
    tools: [...kept, FINGERPRINT.readTool, FINGERPRINT.shellTool],
    stream: true,
  };
}

/** 上游只认这些头；其余（含任何 `x-opencode-request`）一律不透传。 */
const FORWARD_HEADERS = [
  "content-type",
  "accept",
] as const;

/**
 * 从对话前缀推一个稳定的会话键。
 *
 * Host 的 adapter 不知道我们要的会话粒度，所以退而求其次：同一段对话的第一条
 * user 消息 + 我们自己追加的 persona，在整段会话里是稳定的，换会话才变。
 * 拿不到就退化成进程级单会话（保守：宁可共用一个，也不要每请求新造）。
 */
export function deriveSessionKey(body: ChatBody): string | undefined {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const anchor = messages.find(
    (m) => isRecord(m) && m.role === "user" && typeof m.content === "string",
  );
  if (!isRecord(anchor) || typeof anchor.content !== "string") return undefined;
  const digest = createHash("sha256")
    .update(anchor.content.slice(0, 512))
    .digest("hex")
    .slice(0, 16);
  return `xrkh-${digest}`;
}

/**
 * 判读一次上游响应。
 * 整条车道被拒时上游给的是全局共享桶的倒计时，**不是**这个模型不可用。
 */
export function classifyLane(
  status: number,
  retryAfter: string | null,
  payload: string,
): LaneVerdict {
  if (status >= 200 && status < 300) return { kind: "ok" };
  const seconds = Number(retryAfter);
  const shared =
    Number.isFinite(seconds) && seconds > 0 ? { retryAfterSeconds: Math.trunc(seconds) } : {};
  if (status === 429 && /FreeUsageLimitError/.test(payload)) {
    return { kind: "lane-refused", ...shared };
  }
  if (status === 403) {
    // 请求形状不符（缺头 / 工具被改写 / session 编码错）会走这里。
    return { kind: "lane-refused", ...shared };
  }
  return {
    kind: "upstream-error",
    status,
    detail: payload.slice(0, 240),
  };
}

const secureEqual = (a: string, b: string): boolean => {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
};

/**
 * 取调用方出示的 key。两处都认：
 *   - `x-sunflower-key`：sidecar 自己的约定（探针 / 直连调试）；
 *   - `Authorization: Bearer <key>`：Host 的 OpenAI 兼容 adapter 只会发这个。
 */
export function presentedKey(headers: Headers): string {
  const direct = headers.get("x-sunflower-key")?.trim();
  if (direct) return direct;
  const auth = headers.get("authorization")?.trim() ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(auth);
  return match?.[1]?.trim() ?? "";
}

/**
 * Upstream egress for Bun.fetch. Prefer `XRK_SUNFLOWER_PROXY`; else conventional
 * proxy env; empty / `0`|`false`|`off` → force direct (`proxy: false`).
 */
export function resolveUpstreamProxy(
  env: Record<string, string | undefined> = process.env,
): string | false {
  const explicit = env.XRK_SUNFLOWER_PROXY?.trim();
  if (explicit) {
    const lower = explicit.toLowerCase();
    if (lower === "0" || lower === "false" || lower === "off") return false;
    return explicit;
  }
  const fromEnv =
    env.HTTPS_PROXY?.trim() ||
    env.https_proxy?.trim() ||
    env.HTTP_PROXY?.trim() ||
    env.http_proxy?.trim() ||
    env.ALL_PROXY?.trim() ||
    env.all_proxy?.trim();
  return fromEnv || false;
}

/**
 * OpenCode free-lane bearer. Always anonymous `public` — never a user
 * Go / Zen `oc_sk_…` or OPENCODE_* env (privacy/train policies ≠ free pool).
 */
export const OPENCODE_PUBLIC_BEARER = "public";

/** Kilo free-pool base (keyless). Plugin may override via env. */
export function resolveKiloBase(
  env: Record<string, string | undefined> = process.env,
): string {
  return (
    env.XRK_SUNFLOWER_KILO_BASE?.trim() || "https://api.kilo.ai/api/gateway"
  ).replace(/\/+$/, "");
}

/** Model ids routed to Kilo (comma-separated env from the Node plugin). */
export function resolveKiloModelIds(
  env: Record<string, string | undefined> = process.env,
): ReadonlySet<string> {
  const raw = env.XRK_SUNFLOWER_KILO_IDS?.trim() ?? "";
  if (!raw) return new Set();
  return new Set(
    raw
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean),
  );
}

/**
 * Kilo is keyless OpenAI-compatible: pass Host body through (no OpenCode
 * fingerprint). Still remap any accidental read/shell names on the way back.
 */
function buildKiloUpstreamBody(body: ChatBody): ChatBody {
  return {
    ...body,
    stream: body.stream !== false,
  };
}

/** 起一个只服务 xrkh 的 localhost 转发器。 */
export function startSidecar(options: SidecarOptions = {}): SidecarHandle {
  const key = options.key ?? `xrk_sf_${randomBytes(18).toString("hex")}`;
  const pool = new SessionIdPool();
  const doFetch = options.fetchImpl ?? fetch;
  const upstreamProxy = resolveUpstreamProxy();
  const upstreamBearer = OPENCODE_PUBLIC_BEARER;
  const kiloBase = resolveKiloBase();
  const kiloIds = resolveKiloModelIds();

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: options.port ?? 0,
    idleTimeout: 120,
    async fetch(req) {
      const url = new URL(req.url);

      if (url.pathname === "/__sunflower/health") {
        return Response.json({
          ok: true,
          runtime: `bun ${Bun.version}`,
          upstream: UPSTREAM,
          kilo: kiloBase,
          kiloModels: kiloIds.size,
          // 健康检查不暴露 session：配额按 session 计，避免被复用成共享额度。
          sessions: "per-xrkh-session",
        });
      }

      if (!url.pathname.startsWith(PATH_PREFIX)) {
        return new Response("not found", { status: 404 });
      }

      const presented = presentedKey(req.headers);
      if (!secureEqual(presented, key)) {
        return Response.json(
          { error: { type: "unauthorized", message: "sunflower sidecar: bad key" } },
          { status: 401 },
        );
      }

      if (req.method === "GET" && url.pathname.endsWith("/models")) {
        const openCode = FINGERPRINT.models.map((id) => ({
          id,
          object: "model",
          owned_by: "sunflower",
        }));
        const kilo = [...kiloIds].map((id) => ({
          id,
          object: "model",
          owned_by: "kilo",
        }));
        return Response.json({
          object: "list",
          data: [...openCode, ...kilo],
        });
      }

      if (req.method !== "POST") {
        return new Response("method not allowed", { status: 405 });
      }

      let body: ChatBody;
      try {
        body = (await req.json()) as ChatBody;
      } catch {
        return Response.json(
          { error: { type: "bad_request", message: "body is not JSON" } },
          { status: 400 },
        );
      }

      const modelId =
        typeof body.model === "string" ? body.model.trim() : "";
      const viaKilo = modelId.length > 0 && kiloIds.has(modelId);

      // 会话键：优先 Host 显式注入的 xrkh session id；没有就从对话前缀自推
      // （见 `deriveSessionKey`）——配额按 session 计，所有会话共用一个上游
      // session 会互相打满。
      const sessionKey =
        req.headers.get("x-xrk-session") ?? deriveSessionKey(body);
      const sid = pool.get(sessionKey);

      let upstream: Response;
      try {
        if (viaKilo) {
          const kiloBody = buildKiloUpstreamBody(body);
          upstream = await doFetch(`${kiloBase}/chat/completions`, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              accept:
                kiloBody.stream === false
                  ? "application/json"
                  : "text/event-stream",
              "user-agent": "xrk-sunflower-free",
            },
            body: JSON.stringify(kiloBody),
            // @ts-expect-error Bun 支持 proxy 选项，Node 类型里没有
            proxy: upstreamProxy === false ? false : upstreamProxy,
          });
        } else {
          const upstreamBody = buildUpstreamBody(body);
          const headers: Record<string, string> = {
            authorization: `Bearer ${upstreamBearer}`,
            "user-agent": CLIENT_UA,
            "x-opencode-client": "cli",
            "x-opencode-session": sid,
            "x-opencode-session-id": sid,
            "x-session-affinity": sid,
            "x-session-id": sid,
            accept:
              body.stream === false
                ? "application/json"
                : "text/event-stream",
            "content-type": "application/json",
          };
          for (const name of FORWARD_HEADERS) {
            const value = req.headers.get(name);
            if (value !== null) headers[name] = value;
          }
          // Bun.fetch：`proxy` 为 URL 走本地代理；`false` 强制绕过环境代理直连。
          upstream = await doFetch(
            `${UPSTREAM}/inference/openai/v1/chat/completions`,
            {
              method: "POST",
              headers,
              body: JSON.stringify(upstreamBody),
              // @ts-expect-error Bun 支持 proxy 选项，Node 类型里没有
              proxy: upstreamProxy === false ? false : upstreamProxy,
            },
          );
        }
      } catch (error) {
        return Response.json(
          {
            error: {
              type: "sidecar_unreachable",
              message: `sunflower sidecar: ${(error as Error)?.message ?? String(error)}`,
            },
          },
          { status: 502 },
        );
      }

      const retryAfter = upstream.headers.get("retry-after");
      const laneTag = viaKilo ? "kilo" : "opencode";

      if (upstream.ok && upstream.body) {
        const out = new Headers(upstream.headers);
        out.set("x-sunflower-session", sid);
        out.set("x-sunflower-lane", laneTag);
        const ctype = upstream.headers.get("content-type") ?? "";
        if (ctype.includes("text/event-stream")) {
          return new Response(remapDownstreamSseStream(upstream.body), {
            status: upstream.status,
            headers: out,
          });
        }
        const text = await upstream.text();
        return new Response(remapDownstreamCompletionJson(text), {
          status: upstream.status,
          headers: out,
        });
      }

      const text = await upstream.text();
      if (!viaKilo) {
        const verdict = classifyLane(upstream.status, retryAfter, text);
        if (verdict.kind === "lane-refused") {
          // 车道被拒不是这个模型的错，丢掉 session 让下次换新的。
          pool.forget(sessionKey);
        }
        const out = new Headers({
          "content-type": "application/json",
          "x-sunflower-verdict": verdict.kind,
          "x-sunflower-session": sid,
          "x-sunflower-lane": laneTag,
        });
        if (retryAfter) out.set("retry-after", retryAfter);
        return new Response(remapDownstreamCompletionJson(text), {
          status: upstream.status,
          headers: out,
        });
      }

      const out = new Headers({
        "content-type": "application/json",
        "x-sunflower-lane": laneTag,
        "x-sunflower-session": sid,
      });
      if (retryAfter) out.set("retry-after", retryAfter);
      return new Response(text, {
        status: upstream.status,
        headers: out,
      });
    },
  });

  const port = server.port ?? (options.port ?? 0);

  return {
    url: `http://127.0.0.1:${port}${PATH_PREFIX}`,
    key,
    port,
    async stop() {
      await server.stop(true);
    },
  };
}

/** CLI 直跑：`bun run sidecar.ts`（调试用；产品内由 Host 拉起）。 */
if (import.meta.main) {
  const handle = startSidecar({
    port: Number(process.env.XRK_SUNFLOWER_PORT ?? 0) || 0,
  });
  // 一次性 key 只在启动时输出，供 Host 读取；不要写进任何持久文件。
  console.log(
    JSON.stringify({
      url: handle.url,
      port: handle.port,
      key: handle.key,
      runtime: `bun ${Bun.version}`,
      upstream: UPSTREAM,
      proxy: resolveUpstreamProxy() || null,
      auth: OPENCODE_PUBLIC_BEARER,
    }),
  );
}
