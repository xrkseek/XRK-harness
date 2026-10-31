/**
 * 向日葵免费 — Bun sidecar。
 *
 * 为什么需要独立进程：该车道的网关按 TLS/HTTP 客户端栈做准入，Bun 的栈在
 * 允许列表内；Node 的栈会被归进共享配额池，返回 429。Host 是 Node，
 * 所以这条车道的 egress 交给一个 Bun 子进程。
 *
 * OpenCode-only（Kilo 由 Host 直连 api.kilo.ai，对齐 OFM egress.js）。
 *   1. OFM 指纹：官方 `read`/`shell` + `<env>` + placeholder（不抄 OC persona）；
 *   2. 铸造并复用 session id（配额按 session）；
 *   3. 粘性出口：探测级联经 `POST /__sunflower/egress` 写入，聊天与探针共用。
 *
 * 只监听 127.0.0.1，并带每次启动生成的一次性 key：不做开放代理。
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createConnection } from "node:net";
import { CLIENT_UA, FINGERPRINT } from "./fingerprint.js";

const UPSTREAM = "https://opencode.ai";
const PATH_PREFIX = "/v1";
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
  // OFM FREE_LANE_TOOL_ALIASES inverse (b3d4b5a): wire aliases → Host names.
  workspace_directory: "working_directory",
  conversation_delegate: "subagent_fork",
};

/**
 * OFM `FREE_LANE_TOOL_ALIASES` — these Host names alone (or with certain
 * companions) returned 429 on the free lane; keep schemas, rename on the wire.
 */
const UPSTREAM_TOOL_ALIASES: Readonly<Record<string, string>> = {
  working_directory: "workspace_directory",
  subagent_fork: "conversation_delegate",
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
 * OFM `applyFingerprint` + `ensureFreeLaneEnvironment` (chat wire).
 *
 * - Keep caller system / tools (no copied OC persona — docs/oc-free-transport.md).
 * - Inject official `read`/`shell` defs; append placeholder note when injected.
 * - Append `<env>` cwd/platform unless caller already has one.
 * - Strip `tool_choice: none` (v2 → 403).
 * Downstream remaps `read`/`shell` → Host `read_file`/`bash`.
 */
export function buildUpstreamBody(body: ChatBody): ChatBody {
  const rawMessages = Array.isArray(body.messages) ? body.messages : [];
  const messages = rawMessages.map((m) =>
    isRecord(m) ? { ...m } : m,
  ) as unknown[];

  const hostTools = Array.isArray(body.tools) ? body.tools : [];
  const aliasNotes: string[] = [];
  const kept: unknown[] = [];
  for (const tool of hostTools) {
    const name = toolDefName(tool);
    if (name === "read" || name === "shell") continue;
    const alias = name ? UPSTREAM_TOOL_ALIASES[name] : undefined;
    if (alias && isRecord(tool)) {
      aliasNotes.push(`use \`${alias}\` for \`${name}\``);
      if (isRecord(tool.function) && typeof tool.function.name === "string") {
        kept.push({
          ...tool,
          function: { ...tool.function, name: alias },
        });
      } else {
        kept.push({ ...tool, name: alias });
      }
      continue;
    }
    kept.push(tool);
  }
  // Always inject OFM gate defs (Host `read`/`shell` names were filtered above).
  const tools = [...kept, FINGERPRINT.readTool, FINGERPRINT.shellTool];

  const existingSystem = messages
    .filter(
      (m) =>
        isRecord(m) &&
        (m.role === "system" || m.role === "developer") &&
        typeof m.content === "string",
    )
    .map((m) => String((m as { content: string }).content))
    .join("\n");

  const extras: string[] = [];
  if (!/<env>[\s\S]*?<\/env>/i.test(existingSystem)) {
    const cwd = process.cwd().replace(/[\r\n<>]/g, " ");
    const platform = String(process.platform).replace(/[\r\n<>]/g, " ");
    extras.push(
      `Here is some useful information about the environment you are running in:\n<env>\n  Working directory: ${cwd}\n  Platform: ${platform}\n</env>`,
    );
  }
  extras.push(FINGERPRINT.placeholderNote);
  if (aliasNotes.length > 0) {
    extras.push(
      `Tool name mapping for this request: ${aliasNotes.join("; ")}. These tools retain their original behavior and parameters.`,
    );
  }

  if (extras.length > 0) {
    const note = extras.join("\n\n");
    const first = messages[0];
    if (
      isRecord(first) &&
      first.role === "system" &&
      typeof first.content === "string"
    ) {
      messages[0] = { ...first, content: `${first.content}\n\n${note}` };
    } else {
      messages.unshift({ role: "system", content: note });
    }
  }

  const next: ChatBody = {
    ...body,
    messages,
    tools,
    stream: true,
  };
  if (
    next.tool_choice === "none" ||
    (isRecord(next.tool_choice) && next.tool_choice.type === "none")
  ) {
    delete next.tool_choice;
  }
  return next;
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

/** 本机回环上常见的 HTTP 代理端口（Clash Verge 默认 7897，Clash 传统 7890）。 */
const LOCAL_PROXY_PORTS: readonly number[] = [
  7897, 7890, 1087, 10809, 6152, 8889, 1080,
];

/**
 * 探测本机回环上可用的 HTTP 代理。
 *
 * 这条车道的免费额度按**出口 IP** 计数（实测：直连 5/5 全 429，
 * 换代理出口后 3/5 可用），所以有本地代理时优先走它；没装代理的机器
 * 探不到任何端口，保持直连。只探 loopback，不外发本机任何信息。
 *
 * 只做 TCP 连通性判断，**不**用外部域名验证：Clash 这类分流代理会按
 * 域名规则 REJECT/CONNECT 不通（实测 example.com 超时、api.ipify.org
 * ECONNRESET），拿它当判据会把能用的代理判死。端口白名单本身就是代理
 * 专用口；万一撞上非代理服务，最坏是探针 unknown → 该行 omit（安全降级，
 * 不会假阳性）。
 */
function canConnect(port: number, timeoutMs = 400): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

export async function discoverLocalProxy(
  ports: readonly number[] = LOCAL_PROXY_PORTS,
): Promise<string | undefined> {
  for (const port of ports) {
    if (await canConnect(port)) return `http://127.0.0.1:${port}`;
  }
  return undefined;
}

/**
 * OpenCode free-lane bearer. Always anonymous `public` — never a user
 * Go / Zen `oc_sk_…` or OPENCODE_* env (privacy/train policies ≠ free pool).
 */
export const OPENCODE_PUBLIC_BEARER = "public";

/**
 * 一项出口设置 → 实际代理。取值：
 *   留空 → `fallback`（常规代理 env / 直连）
 *   `off`（或 `0`/`false`）→ 强制直连
 *   `auto` → 探测本机回环上的常见代理端口
 *   其它 → 当作显式代理 URL
 *
 * 默认直连：不猜端口、不静默改路由。要走代理得用户明写。
 */
async function resolveProxySetting(
  raw: string | undefined,
  fallback: string | false,
): Promise<string | false> {
  const value = (raw ?? "").trim();
  if (!value) return fallback;
  const lower = value.toLowerCase();
  if (lower === "0" || lower === "false" || lower === "off") return false;
  if (lower === "auto") return (await discoverLocalProxy()) ?? false;
  return value;
}

/**
 * OpenCode 粘性出口。未设置时强制直连——Settings 里的 `openCodeProxy` 只是
 * **级联候选**，由插件探测决定是否切过去，不能一启动就绑死代理。
 */
let stickyOpenCodeEgress: string | false | undefined;

/** @returns {string | false | undefined} undefined = 尚未粘性（按直连）。 */
export function getStickyOpenCodeEgress(): string | false | undefined {
  return stickyOpenCodeEgress;
}

/**
 * 设置 OpenCode 粘性出口。`auto` = 探测本机回环常见口；失败则直连。
 * @returns 实际生效的出口（`false` = 直连）。
 */
export async function setStickyOpenCodeEgress(
  raw: string | false | "auto",
): Promise<string | false> {
  if (raw === false) {
    stickyOpenCodeEgress = false;
    return false;
  }
  if (raw === "auto") {
    stickyOpenCodeEgress = (await discoverLocalProxy()) ?? false;
    return stickyOpenCodeEgress;
  }
  const value = String(raw).trim();
  if (!value) {
    stickyOpenCodeEgress = false;
    return false;
  }
  const lower = value.toLowerCase();
  if (lower === "0" || lower === "false" || lower === "off") {
    stickyOpenCodeEgress = false;
    return false;
  }
  if (lower === "auto") {
    stickyOpenCodeEgress = (await discoverLocalProxy()) ?? false;
    return stickyOpenCodeEgress;
  }
  stickyOpenCodeEgress = value;
  return stickyOpenCodeEgress;
}

/**
 * OpenCode 车道出口。免费池按**出口 IP** 计额度：国内直连易 429。
 * 粘性优先；未粘性时直连（不读 Settings URL，避免跳过「先直连」级联）。
 */
export async function resolveEgressProxy(): Promise<string | false> {
  if (stickyOpenCodeEgress !== undefined) return stickyOpenCodeEgress;
  return false;
}

/**
 * Kilo 车道出口。Kilo 免费池直连可用（实测 `/models` 与
 * `/chat/completions` 均 200），所以默认直连，只有用户显式配了
 * `kiloProxy` 才走代理——别把两条车道绑在同一个出口上。
 */
let kiloProxyCache: string | false | undefined;
export async function resolveKiloEgressProxy(): Promise<string | false> {
  if (kiloProxyCache !== undefined) return kiloProxyCache;
  kiloProxyCache = await resolveProxySetting(
    process.env.XRK_SUNFLOWER_KILO_PROXY,
    false,
  );
  return kiloProxyCache;
}

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
          openCodeEgress:
            stickyOpenCodeEgress === undefined
              ? null
              : stickyOpenCodeEgress === false
                ? null
                : stickyOpenCodeEgress,
          // 健康检查不暴露 session：配额按 session 计，避免被复用成共享额度。
          sessions: "per-xrkh-session",
        });
      }

      // Egress control is auth-gated like /v1 — key required below after this
      // branch is folded into the authenticated block.

      if (!url.pathname.startsWith(PATH_PREFIX) && url.pathname !== "/__sunflower/egress") {
        return new Response("not found", { status: 404 });
      }

      const presented = presentedKey(req.headers);
      if (!secureEqual(presented, key)) {
        return Response.json(
          { error: { type: "unauthorized", message: "sunflower sidecar: bad key" } },
          { status: 401 },
        );
      }

      if (url.pathname === "/__sunflower/egress") {
        if (req.method === "GET") {
          return Response.json({
            proxy:
              stickyOpenCodeEgress === undefined || stickyOpenCodeEgress === false
                ? null
                : stickyOpenCodeEgress,
          });
        }
        if (req.method !== "POST") {
          return new Response("method not allowed", { status: 405 });
        }
        let body: { proxy?: unknown };
        try {
          body = (await req.json()) as { proxy?: unknown };
        } catch {
          return Response.json(
            { error: { type: "bad_request", message: "body is not JSON" } },
            { status: 400 },
          );
        }
        const raw = body.proxy;
        let next: string | false | "auto";
        if (raw === false || raw === null || raw === "") next = false;
        else if (typeof raw === "string") next = raw.trim() || false;
        else {
          return Response.json(
            {
              error: {
                type: "bad_request",
                message: "proxy must be false | null | URL | \"auto\"",
              },
            },
            { status: 400 },
          );
        }
        const applied = await setStickyOpenCodeEgress(
          next === false ? false : next,
        );
        return Response.json({
          proxy: applied === false ? null : applied,
        });
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
            proxy: await resolveKiloEgressProxy(),
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
            // OFM v2 fingerprint: official CLI always sends this.
            "x-opencode-project": "global",
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
          // Same path as OFM free-lane (`/inference/v1/...`). The older
          // `/inference/openai/v1/...` surface 404s on models and is not the
          // live chat endpoint. Bun.fetch: `proxy` URL → local proxy; `false`
          // forces direct (bypass env proxy).
          upstream = await doFetch(
            `${UPSTREAM}/inference/v1/chat/completions`,
            {
              method: "POST",
              headers,
              body: JSON.stringify(upstreamBody),
              // @ts-expect-error Bun 支持 proxy 选项，Node 类型里没有
              proxy: await resolveEgressProxy(),
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
        // OFM: never rotate session ids on retries / FreeUsageLimit / shape
        // 403 — minting a fresh id burns quota and does not clear an IP bucket.
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
      proxy: (await resolveEgressProxy()) || null,
      kiloProxy: (await resolveKiloEgressProxy()) || null,
      auth: OPENCODE_PUBLIC_BEARER,
    }),
  );
}
