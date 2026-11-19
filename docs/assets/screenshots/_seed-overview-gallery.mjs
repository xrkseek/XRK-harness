/**
 * Seed an isolated Host with Overview / transcript UI gallery sessions.
 *
 * Design (docs/status · session-identity-scenarios) — do not confuse these:
 *
 *   老板→经理（概况球）
 *     Coding **parent** session with NO parentSessionId. Face paints right
 *     ball as roster 经理 (mem_seed_manager). Not a live subagent.
 *
 *   会话协作
 *     Two peer **parent** sessions. Overview mutual 委派方 needs a team peer
 *     edge labeled `collab`. Seed it with seatChannel:`peer` + fromSessionId
 *     (Face linkPeers) or thread_message / workspace_session_prompt. Never
 *     parentSessionId.
 *
 *   子代理委派（概况 N→1 / 1→1）
 *     parentSessionId lineage. Shows under 「子代理」. N→1 left stack needs
 *     **distinct** memberIds per layer — same mem_seed_manager twice paints
 *     as one 经理. Titles say 委派/子代理 — never 「经理协作」.
 *
 * Env:
 *   HOST_URL  default http://127.0.0.1:8787
 *
 * Sidebar titles to open + check 概况（展开概况栏，勿收起球轨）:
 *   向阳·默认席
 *   概况·老板→经理
 *   概况·向日葵开的编码席          ← 老板 + 向日葵（两委派方）
 *   概况·会话协作·甲方 / 乙方
 *   概况·子代理委派·双委派方叶      ← 经理 → 调度员 → 调研员（左栈≥2）
 *   概况·子代理委派·一层叶
 */
const HOST = (process.env.HOST_URL || "http://127.0.0.1:8787").replace(/\/$/, "");

async function faceRpc(method, payload = {}, rpcId = method) {
  const res = await fetch(`${HOST}/api/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ rpcId, payload }),
  });
  const body = await res.json();
  const result = body.result ?? body;
  if (!result?.ok) {
    throw new Error(`${method} failed: ${JSON.stringify(result?.error ?? body).slice(0, 800)}`);
  }
  return result.value;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function rename(sessionId, title) {
  try {
    await faceRpc("session.rename", { sessionId, title });
  } catch (e) {
    console.warn("rename", title, String(e));
  }
}

async function cancel(sessionId) {
  try {
    await faceRpc("session.cancel", { sessionId });
  } catch {
    /* idle ok */
  }
}

/** UI composer speech — marks humanSpoke so Overview can stack 老板. */
async function bossSay(sessionId, text) {
  await say(sessionId, text, { seatChannel: "human_face" }, `gallery-boss-${Math.random().toString(36).slice(2, 8)}`);
}

async function say(sessionId, text, extras = {}, rpcId = `gallery-${Math.random().toString(36).slice(2, 8)}`) {
  // Cancel first so a racing drain cannot keep burning tokens after admit.
  await cancel(sessionId);
  const promptPromise = faceRpc(
    "session.prompt",
    {
      sessionId,
      mode: "queue",
      content: [{ type: "text", text }],
      ...extras,
    },
    rpcId,
  ).catch((e) => {
    console.warn("prompt", sessionId.slice(-8), String(e).slice(0, 240));
  });
  // Abort as soon as the turn starts — gallery only needs transcript chrome.
  await sleep(50);
  await cancel(sessionId);
  await promptPromise;
  await cancel(sessionId);
}

async function createSession(payload) {
  const created = await faceRpc("session.create", payload);
  return created.sessionId || created.id;
}

async function listSessions() {
  const listed = await faceRpc("session.list", {});
  const rows = listed.sessions || listed.items || listed || [];
  return Array.isArray(rows) ? rows : [];
}

/**
 * Live 向阳 seat only: workspaceId must be ws_default.
 * Do NOT accept "has badge" / title-only matches — that reused coding parents
 * and inheritFrom painted 经理 as opener (openerIsChild → empty left stack).
 */
async function findXiangyangSession() {
  const rows = await listSessions();
  return rows.find((s) => {
    if (s.archived || s.offload || s.readOnly) return false;
    const title = s.title || s.name || "";
    if (/^\[旧\]/.test(title) || /开的编码席/.test(title)) return false;
    const ws = s.workspaceId || s.workspace?.id || "";
    return ws === "ws_default";
  });
}

/** Fresh 向阳 seat on ws_default — required so inheritFrom paints 向日葵 opener. */
async function ensureXiangyangSession() {
  const existing = await findXiangyangSession();
  if (existing) {
    const id = existing.sessionId || existing.id;
    try {
      const st = await faceRpc("session.status", { sessionId: id });
      // 向阳 paints companion as sunflower member (childSeat may still say manager).
      if (st?.delegate?.childMemberId === "mem_seed_xrkseek") {
        return id;
      }
    } catch {
      /* fall through and mint */
    }
  }
  return createSession({ workspaceId: "ws_default" });
}

async function findOrCreateCodingWorkspace() {
  const listed = await faceRpc("workspace.list");
  const rows = listed.workspaces || listed.items || [];
  const list = Array.isArray(rows) ? rows : [];
  const coding = list.find((w) => {
    const title = w.title || w.name || w.label || "";
    const id = w.workspaceId || w.id || "";
    if (id === "ws_default" || /向阳/.test(title)) return false;
    return Boolean(id);
  });
  if (coding) {
    return {
      workspaceId: coding.workspaceId || coding.id,
      title: coding.title || coding.name || coding.root,
    };
  }
  const repo = process.env.GALLERY_WORKSPACE_PATH || process.cwd();
  const created = await faceRpc("workspace.create", { path: repo });
  const ws = created.workspace || created;
  return {
    workspaceId: ws.workspaceId || ws.id,
    title: ws.title || ws.name || repo,
  };
}

async function parentsOf(sessionId) {
  const st = await faceRpc("session.status", { sessionId });
  const parents = st.delegate?.parents;
  return Array.isArray(parents) ? parents : [];
}

console.log("HOST", HOST);

try {
  await faceRpc("settings.mutate", {
    ns: "agent-loop",
    scope: "user",
    ops: [{ op: "set", path: ["maxConcurrentModelSessions"], value: 32 }],
  });
  console.log("raised maxConcurrentModelSessions → 32");
} catch (e) {
  console.warn("settings.mutate", String(e).slice(0, 240));
}

const coding = await findOrCreateCodingWorkspace();
console.log("coding workspace", coding);

for (const row of await listSessions()) {
  const id = row.sessionId || row.id;
  if (id) await cancel(id);
}
await sleep(400);

const catalog = [];
const created = {};

// —— Create every session first (no prompts) ——
{
  // Presence pair only: coding parent → Face paints 经理 on the right. NO child.
  created.office = await createSession({ workspaceId: coding.workspaceId });
  await rename(created.office, "概况·老板→经理");

  created.xiangyang = await ensureXiangyangSession();
  await rename(created.xiangyang, "向阳·默认席");

  created.fromSunflower = await createSession({
    workspaceId: coding.workspaceId,
    inheritFrom: created.xiangyang,
  });
  await rename(created.fromSunflower, "概况·向日葵开的编码席");

  // Session collab: two peer parents (no parentSessionId).
  // Mutual Overview 委派方 requires team peer edge `collab` (armed by
  // thread_message). Seed puts peer seat speech for transcript chrome.
  created.collabA = await createSession({ workspaceId: coding.workspaceId });
  await rename(created.collabA, "概况·会话协作·甲方");
  created.collabB = await createSession({ workspaceId: coding.workspaceId });
  await rename(created.collabB, "概况·会话协作·乙方");

  // Subagent N→1: DISTINCT roster seats per layer (never mid=mem_seed_manager —
  // that clones the coding-root 经理 look and the left stack looks like one ball).
  created.stackRoot = await createSession({ workspaceId: coding.workspaceId });
  await rename(created.stackRoot, "概况·子代理委派·栈根");

  created.stackMid = await createSession({
    workspaceId: coding.workspaceId,
    parentSessionId: created.stackRoot,
    memberId: "mem_seed_lead",
    label: "调度员",
  });
  await rename(created.stackMid, "概况·子代理委派·栈中");

  created.stackLeaf = await createSession({
    workspaceId: coding.workspaceId,
    parentSessionId: created.stackMid,
    memberId: "mem_seed_researcher",
    label: "调研员",
  });
  await rename(created.stackLeaf, "概况·子代理委派·双委派方叶");

  created.oneParent = await createSession({ workspaceId: coding.workspaceId });
  await rename(created.oneParent, "概况·子代理委派·一层父");

  created.oneChild = await createSession({
    workspaceId: coding.workspaceId,
    parentSessionId: created.oneParent,
    memberId: "mem_seed_scout",
    label: "探网员",
  });
  await rename(created.oneChild, "概况·子代理委派·一层叶");
}

console.log("created", Object.fromEntries(
  Object.entries(created).map(([k, v]) => [k, String(v).slice(-12)]),
));

// —— Inject transcript chrome (cancel after each) ——
await bossSay(created.office, "【图例】概况球：左老板、右经理（名册装扮，不是子代理）。点老板可改心情。");

await bossSay(created.xiangyang, "【图例】向阳空间默认概况：老板 → 向日葵。");

await bossSay(created.fromSunflower, "【图例】概况左栈应是向日葵（opener）。");
await bossSay(created.fromSunflower, "【图例】老板插话后，左栈应出现「老板 + 向日葵」两委派方。展开概况栏查看。");

// Peer collab: seatChannel peer + fromSessionId → Face linkPeers(collab)
// so Overview paints mutual 委派方 (same edge thread_message would arm).
await say(
  created.collabB,
  "甲方来信：请按会话协作纪律回传结论（thread_message / wait）。",
  { seatChannel: "peer", fromSessionId: created.collabA },
  "gallery-collab-peer",
);
await bossSay(
  created.collabA,
  "【图例】会话协作：两侧栏各开「甲方/乙方」——对等父会话，无「子代理」。展开概况：左栈应是对等席（乙方），不是子代理经理。",
);
await bossSay(
  created.collabB,
  "【图例】概况左栈应看到甲方为委派方；收起球轨只留 lead。",
);

await say(
  created.stackMid,
  "栈根委派：把发版拆成调研任务。",
  { seatChannel: "parent", fromSessionId: created.stackRoot },
  "gallery-delegate-mid",
);
await say(
  created.stackLeaf,
  "调度员交代：核对 Overview 左栈多层委派方。",
  { seatChannel: "parent", fromSessionId: created.stackMid },
  "gallery-delegate-leaf-seat",
);
// Boss joins the leaf → left stack 老板 + 经理(根) + 调度员(中) → 调研员.
await bossSay(
  created.stackLeaf,
  "【图例】子代理委派 N→1：展开概况栏。左栈应看到至少两个不同委派方（经理→调度员），右球调研员。收起球轨只会留 lead。",
);

await say(
  created.oneChild,
  "父席交代：先看 transcript 席位气泡（不可当老板编辑）。",
  { seatChannel: "parent", fromSessionId: created.oneParent },
  "gallery-delegate-one-seat",
);
await bossSay(
  created.oneChild,
  "【图例】子代理委派 1→1：左栈一个委派方；要看双委派方请开「双委派方叶」。",
);

// —— Design probe ——
const probe = async (title, sessionId) => {
  const parents = await parentsOf(sessionId);
  console.log(
    `probe ${title}: parents=${parents.length}`,
    parents.map((p) => `${p.label || "?"}(${p.memberId || p.kind || "?"})`).join(" → ") || "-",
  );
  return parents.length;
};

const nParents = await probe("双委派方叶", created.stackLeaf);
const sunParents = await probe("向日葵开的编码席", created.fromSunflower);
const collabAParents = await probe("会话协作·甲方", created.collabA);
const collabBParents = await probe("会话协作·乙方", created.collabB);
if (nParents < 2) {
  console.warn("WARN: N→1 leaf should expose ≥2 委派方 on parents[] — check memberIds / Host Face build");
}
if (sunParents < 2) {
  console.warn("WARN: 向日葵席 after boss speak should stack 老板+向日葵 — check inheritFrom opener");
}
if (collabAParents < 1 || collabBParents < 1) {
  console.warn("WARN: 会话协作 should paint peer on parents[] — need Face peer→linkPeers(collab) or restart Host on new dist");
}

catalog.push(
  { title: "向阳·默认席", sessionId: created.xiangyang, note: "Boss→向日葵 presence" },
  { title: "概况·老板→经理", sessionId: created.office, note: "Boss→经理 presence (no subagent)" },
  { title: "概况·向日葵开的编码席", sessionId: created.fromSunflower, note: "老板+向日葵 two 委派方" },
  { title: "概况·会话协作·甲方", sessionId: created.collabA, note: "peer 委派方=乙方; 子代理 0" },
  { title: "概况·会话协作·乙方", sessionId: created.collabB, note: "peer 委派方=甲方; 子代理 0" },
  { title: "概况·子代理委派·双委派方叶", sessionId: created.stackLeaf, note: "N→1 left stack ≥2 distinct seats" },
  { title: "概况·子代理委派·一层叶", sessionId: created.oneChild, note: "1→1 single 委派方" },
);

console.log("\n=== UI gallery — open each title, expand 概况 (not collapsed rail) ===");
for (const row of catalog) {
  console.log(`- ${row.title}  (${row.note})`);
  console.log(`  ${row.sessionId}`);
}
console.log(`\nHost: ${HOST}/`);
console.log(JSON.stringify({ host: HOST, catalog }, null, 2));
