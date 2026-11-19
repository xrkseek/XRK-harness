/** Seed a short coding-workspace chat on a running Host for docs screenshots. */
const HOST = process.env.HOST_URL || "http://127.0.0.1:18765";

async function faceRpc(method, payload = {}) {
  const res = await fetch(`${HOST}/api/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ rpcId: method, payload }),
  });
  const body = await res.json();
  const result = body.result ?? body;
  if (!result?.ok) {
    throw new Error(`${method} failed: ${JSON.stringify(result?.error ?? body)}`);
  }
  return result.value;
}

const workspaces = await faceRpc("workspace.list");
const list = workspaces.workspaces || workspaces.items || workspaces || [];
const coding =
  (Array.isArray(list) ? list : []).find((w) => {
    const title = w.title || w.name || w.label || "";
    const root = w.root || w.path || w.cwd || "";
    return /XRK-harness/i.test(title) || /XRK-harness/i.test(root);
  }) || (Array.isArray(list) ? list[0] : null);

if (!coding) throw new Error(`no workspace: ${JSON.stringify(workspaces).slice(0, 400)}`);
const workspaceId = coding.workspaceId || coding.id;
console.log("workspace", workspaceId, coding.title || coding.name || coding.root);

const created = await faceRpc("session.create", { workspaceId });
const sessionId = created.sessionId || created.id;
console.log("session", sessionId);

await faceRpc("session.rename", {
  sessionId,
  title: "核对 Windows 安装包",
}).catch((e) => console.warn("rename", String(e)));

const prompt = await faceRpc("session.prompt", {
  sessionId,
  mode: "queue",
  content: [
    {
      type: "text",
      text: "用一两句话说明本仓产品名与本地打开方式（xrkh web）。不要跑工具。",
    },
  ],
});
console.log("prompt", JSON.stringify(prompt).slice(0, 240));

// Wait for assistant turn to land (model may be slow).
let assistant = false;
for (let i = 0; i < 40; i++) {
  await new Promise((r) => setTimeout(r, 1500));
  const hist = await faceRpc("session.history", { sessionId, limit: 40 });
  const events = hist.events || hist.items || hist.page?.events || [];
  const types = events.map((e) => e.type || e.event?.type).filter(Boolean);
  assistant = types.some((t) => /assistant|agent\/message|message\/assistant|llm/i.test(t));
  const texty = JSON.stringify(events).includes("xrkh") || JSON.stringify(events).includes("Harness");
  console.log(`poll ${i + 1}`, { n: events.length, assistant, texty, sample: types.slice(-6) });
  if (assistant || texty) break;
}

console.log("done", sessionId);
console.log(JSON.stringify({ sessionId, workspaceId }));
