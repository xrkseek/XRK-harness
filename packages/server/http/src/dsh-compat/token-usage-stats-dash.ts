/**
 * dsh-token-usage-stats — HTML dashboard at `/token-usage-stats` + JSON at `/api/token-usage-stats`.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { sendJson } from "./underlying/http-json.js";
import { DSH_COMPAT_ADAPTER } from "./meta.js";
import type { TokenLedgerOptions } from "./tokenledger.js";

export type TokenUsageStatsOptions = TokenLedgerOptions;

export function isTokenUsageStatsPath(pathname: string): boolean {
  return (
    pathname === "/token-usage-stats" ||
    pathname.startsWith("/token-usage-stats/") ||
    pathname === "/api/token-usage-stats" ||
    pathname.startsWith("/api/token-usage-stats/")
  );
}

function emptySnapshot(): Record<string, unknown> {
  return {
    currency: "USD",
    totals: {
      requestCount: 0,
      totalTokens: 0,
      outputTokens: 0,
      inputTokens: 0,
      cost: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    },
    series: [],
    models: [],
    topSessions: [],
    adapter: DSH_COMPAT_ADAPTER,
  };
}

function dashboardHtml(): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Token 用量统计</title>
  <style>
    :root { color-scheme: light dark; --bg:#f6f7f9; --panel:#fff; --text:#1c2333; --muted:#6b7280; --line:#e5e7eb; }
    @media (prefers-color-scheme: dark) {
      :root { --bg:#111827; --panel:#1f2937; --text:#f9fafb; --muted:#9ca3af; --line:#374151; }
    }
    body { margin:0; background:var(--bg); color:var(--text); font:14px/1.45 system-ui,sans-serif; }
    main { max-width:720px; margin:24px auto; padding:0 16px; }
    .panel { background:var(--panel); border:1px solid var(--line); border-radius:12px; padding:16px 18px; }
    h1 { font-size:18px; margin:0 0 8px; }
    p { margin:0; color:var(--muted); }
    .grid { display:grid; grid-template-columns:repeat(3,1fr); gap:12px; margin-top:16px; }
    .stat strong { display:block; font-size:20px; }
    .stat span { color:var(--muted); font-size:12px; }
  </style>
</head>
<body>
  <main>
    <div class="panel">
      <h1>Token 用量统计</h1>
      <p id="note">加载中…</p>
      <div class="grid">
        <div class="stat"><strong id="requests">0</strong><span>请求</span></div>
        <div class="stat"><strong id="tokens">0</strong><span>总 Token</span></div>
        <div class="stat"><strong id="cost">0</strong><span id="currency">USD</span></div>
      </div>
    </div>
  </main>
  <script>
    (async () => {
      const note = document.getElementById('note');
      try {
        const res = await fetch('/api/token-usage-stats', { cache: 'no-store' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const snap = await res.json();
        document.getElementById('requests').textContent = String(snap.totals?.requestCount ?? 0);
        document.getElementById('tokens').textContent = String(snap.totals?.totalTokens ?? 0);
        document.getElementById('cost').textContent = String(snap.totals?.cost ?? 0);
        document.getElementById('currency').textContent = snap.currency || 'USD';
        note.textContent = snap.adapter
          ? 'XRK Host 聚合（空数据时为 0）'
          : '就绪';
      } catch (err) {
        note.textContent = '无法加载用量：' + (err && err.message ? err.message : String(err));
      }
    })();
  </script>
</body>
</html>`;
}

export async function handleTokenUsageStatsHttp(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  options: TokenUsageStatsOptions = {},
): Promise<boolean> {
  if (!isTokenUsageStatsPath(pathname)) return false;
  const method = (req.method ?? "GET").toUpperCase();

  if (
    (pathname === "/token-usage-stats" || pathname === "/token-usage-stats/") &&
    (method === "GET" || method === "HEAD")
  ) {
    const html = dashboardHtml();
    res.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "content-length": Buffer.byteLength(html),
    });
    if (method === "HEAD") {
      res.end();
      return true;
    }
    res.end(html);
    return true;
  }

  if (
    pathname === "/api/token-usage-stats" ||
    pathname.startsWith("/api/token-usage-stats")
  ) {
    const aggregated = options.aggregateUsage
      ? await options.aggregateUsage({})
      : undefined;
    const body =
      aggregated && typeof aggregated === "object"
        ? { ...emptySnapshot(), ...aggregated }
        : emptySnapshot();
    sendJson(res, 200, body);
    return true;
  }

  sendJson(res, 200, emptySnapshot());
  return true;
}
