const HOST = (process.env.HOST_URL || "http://127.0.0.1:8787").replace(/\/$/, "");
async function rpc(method, payload = {}) {
  const res = await fetch(`${HOST}/api/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ rpcId: method, payload }),
  });
  const body = await res.json();
  const r = body.result ?? body;
  if (!r.ok) throw new Error(`${method} ${JSON.stringify(r.error)}`);
  return r.value;
}

const listed = await rpc("session.list", {});
const rows = listed.sessions || listed.items || listed || [];
console.log("count", Array.isArray(rows) ? rows.length : typeof rows);
for (const s of Array.isArray(rows) ? rows : []) {
  console.log({
    id: s.sessionId || s.id,
    title: s.title || s.name,
    ws: s.workspaceId,
    origin: s.origin,
    parent: s.parentId || s.parentSessionId,
    blank: s.blank,
    cwd: s.cwd,
  });
}

const ws = await rpc("workspace.list", {});
console.log("workspaces", JSON.stringify(ws, null, 2).slice(0, 2000));
