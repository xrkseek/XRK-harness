/**
 * Cloudflare Worker product page.
 * Installer bytes stay on AGT :6969.
 */
import fallbackCatalog from "../releases.json" with { type: "json" };

const DEFAULT_ORIGIN = "http://103.236.89.174:6969";
const GITHUB = "https://github.com/xrkseek/XRK-harness";
const NPM = "https://www.npmjs.com/package/@xrkseek/harness-cli";
const DOCS = `${GITHUB}/blob/main/docs/getting-started.md`;

/** Keep in sync with seedGlobalRosterMembers in packages/server/face. */
const SEEDS = [
  { id: "mem_seed_researcher", name: "调研员", nameEn: "Researcher", brief: "只读调研，引用路径与原文。", briefEn: "Read-only research. Cite paths and quotes.", shape: "blob", color: "mist" },
  { id: "mem_seed_worker", name: "施工员", nameEn: "Builder", brief: "按任务改代码，不扩范围。", briefEn: "Edit in scope. No extras.", shape: "wedge", color: "sage" },
  { id: "mem_seed_reviewer", name: "审稿员", nameEn: "Reviewer", brief: "只读审稿，先报缺陷。", briefEn: "Read-only review. Defects first.", shape: "gem", color: "lilac" },
  { id: "mem_seed_lead", name: "调度员", nameEn: "Lead", brief: "拆任务、协调干员。", briefEn: "Split work. Coordinate the roster.", shape: "blob", color: "slate" },
  { id: "mem_seed_scout", name: "探网员", nameEn: "Scout", brief: "查网上公开事实，给出链接与日期。", briefEn: "Public web facts with URLs and dates.", shape: "wedge", color: "peach" },
  { id: "mem_seed_docs", name: "文书员", nameEn: "Docs", brief: "写诚实说明书与发行说明，不编未做能力。", briefEn: "Honest docs. No invented APIs.", shape: "squircle", color: "butter" },
  { id: "mem_seed_fixer", name: "排障员", nameEn: "Fixer", brief: "复现故障、定位、修，并给出证据。", briefEn: "Reproduce, isolate, fix, show evidence.", shape: "gem", color: "coral" },
  { id: "mem_seed_tester", name: "测员", nameEn: "Tester", brief: "跑相关测试，报告失败与最小复现。", briefEn: "Run tests. Report failures and repro.", shape: "pill", color: "sage" },
];

const TARGET_KEY = { "win-x64": "win", "mac-arm64": "macArm", "mac-x64": "macIntel" };

const LABELS = {
  zh: {
    lead: "会话是真源。干员可委派。设置里改模型与 MCP。桌面目前只提供 Windows x64。",
    tagline: "向阳而生，驭光而行",
    skip: "跳到干员",
    play: "工作台",
    playHint: "画面只播、不能点。点右上角或下方的球换干员。",
    you: "你",
    assign: "委派",
    assigned: "已委派",
    quota: "配额 2 / 2",
    flow: "从任务到合回",
    send: "发送消息",
    sendQueue: "排队（本轮后）",
    sendSteer: "插队（本轮结束后）",
    sending: "发送中",
    waiting: "正在生成",
    steering: "插队中",
    withdraw: "撤回插队",
    queueCount: "1 条排队消息",
    placeholder: "给智能体发消息",
    placeholderBusy: "Enter 排队 · Cmd/Ctrl+Enter 插队",
    trunk: "主线",
    branch: "支线",
    trunkTitle: "发版 0.5.14",
    branchTitle: "修 Host 冷启动",
    opener: "核对 Windows 安装包。",
    queuedMsg: "再跑一遍相关测试。",
    steerMsg: "先看 nightly.yml。",
    toolOut: "bash · node -v → v26.10.0",
    reply: "安装包目录已核。配额 2 / 2。",
    sessions: "会话",
    team: "Agent Team",
    overview: "概况",
    graph: "委派图",
    tasks: "任务",
    stop: "停止生成",
    slash: "/",
    home: "委派方",
    running: "运行中",
    merge: "合回主仓",
    openChild: "打开子会话",
    seed: "预置",
    workspace: "工作区",
    plan: "计划",
    changes: "改动",
    newSession: "新建会话",
    commands: "命令",
    access: "只读",
    model: "模型",
    light: "浅色",
    dark: "深色",
    system: "系统",
    get: "下载 Windows",
    github: "GitHub",
    docs: "文档",
    npm: "npm",
    download: "下载",
    win: "Windows x64",
    macArm: "macOS Apple Silicon",
    macIntel: "macOS Intel",
    macOff: "目前不提供桌面安装包，用 xrkh web。",
    wait: "安装包尚未上传",
    cli: "命令行",
    copy: "复制",
    copied: "已复制",
    mit: "MIT",
    lang: "EN",
  },
  en: {
    lead: "Sessions are the source of truth. Operators take delegated work. Models and MCP live in Settings. Desktop ships for Windows x64 only.",
    tagline: "Grow toward the sun. Steer the light.",
    skip: "Skip to operators",
    play: "Workbench",
    playHint: "The demo plays by itself. Pick an operator on the hero balls or the row below.",
    you: "You",
    assign: "Delegate",
    assigned: "Delegated",
    quota: "quota 2 / 2",
    flow: "From task to merge",
    send: "Send message",
    sendQueue: "Queue (after this turn)",
    sendSteer: "Steer (right after this turn)",
    sending: "Sending",
    waiting: "Generating",
    steering: "Steering",
    withdraw: "Withdraw steer",
    queueCount: "1 queued message",
    placeholder: "Message the agent",
    placeholderBusy: "Enter queues · Cmd/Ctrl+Enter steers",
    trunk: "Main",
    branch: "Branch",
    trunkTitle: "Ship 0.5.14",
    branchTitle: "Host cold start",
    opener: "Check the Windows installer.",
    queuedMsg: "Run the related tests again.",
    steerMsg: "Read nightly.yml first.",
    toolOut: "bash · node -v → v26.10.0",
    reply: "Installer catalog checked. Quota 2 / 2.",
    sessions: "Sessions",
    team: "Agent Team",
    overview: "Overview",
    graph: "Delegation graph",
    tasks: "Tasks",
    stop: "Stop generating",
    slash: "/",
    home: "Delegator",
    running: "running",
    merge: "Merge to main",
    openChild: "Open child",
    seed: "seed",
    workspace: "Workspace",
    plan: "Plan",
    changes: "Changes",
    newSession: "New session",
    commands: "Commands",
    access: "Read only",
    model: "Model",
    light: "Light",
    dark: "Dark",
    system: "System",
    get: "Download Windows",
    github: "GitHub",
    docs: "Docs",
    npm: "npm",
    download: "Download",
    win: "Windows x64",
    macArm: "macOS Apple Silicon",
    macIntel: "macOS Intel",
    macOff: "No desktop installer yet. Use xrkh web.",
    wait: "Installer not uploaded yet",
    cli: "CLI",
    copy: "Copy",
    copied: "Copied",
    mit: "MIT",
    lang: "中文",
  },
};

const FLOW = {
  zh: [
    ["发送", "空闲时右下角蓝圈是发送（无障碍名「发送消息」）。用户气泡先标「发送中」，再进入本轮。"],
    ["排队", "本轮还在跑：蓝圈变成停止。Enter 把下一句放进排队条，等本轮结束后再答。"],
    ["插队", "插队等本轮结束后立刻答，不等于停止，优先于排队。气泡标「插队中」，可撤回。"],
    ["主线 / 支线", "工作区主线钉侧栏标题。支线是分叉会话，不是藏起来的子代理。"],
    ["委派", "subagent(member_id) 把活交给预置干员。球在侧栏可见。配额默认 2 / 2。"],
  ],
  en: [
    ["Send", "Idle send is the blue circle (accessible name “Send message”). The user bubble shows Sending, then the turn starts."],
    ["Queue", "While a turn is live the circle becomes Stop. Enter parks the next line in the queue dock until this turn ends."],
    ["Steer", "Steer answers right after this turn — not Stop, ahead of queue. The bubble shows Steering; it can be withdrawn."],
    ["Main / branch", "The workspace thread pins the sidebar title. A branch is an ordinary fork, not a hidden subagent."],
    ["Delegate", "subagent(member_id) hands work to a seeded operator. The ball stays visible. Quota defaults to 2 / 2."],
  ],
};

function origin(env) {
  return String(env.HARNESS_ORIGIN || DEFAULT_ORIGIN).replace(/\/+$/, "");
}

function unwrap(json) {
  if (!json || json.success === false) throw new Error("catalog");
  if (json.data !== undefined) return json.data;
  const rest = { ...json };
  delete rest.success;
  delete rest.message;
  return rest;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function loadCatalog(env) {
  try {
    const res = await fetch(`${origin(env)}/api/harness/releases`, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) throw new Error("live");
    return unwrap(await res.json());
  } catch {
    return fallbackCatalog;
  }
}

function isMacTarget(target) {
  return String(target || "").startsWith("mac-");
}

function downloadHref(row, env) {
  if (isMacTarget(row?.target)) return "";
  if (!row?.available || !row.download) return "";
  if (/^https?:\/\//i.test(row.download)) return row.download;
  const path = row.download.startsWith("/") ? row.download : `/${row.download}`;
  return `${origin(env)}${path}`;
}

function ballMount(member, extraClass = "") {
  return `<span class="stage ${extraClass}"><span class="mount" data-ball data-shape="${escapeHtml(member.shape)}" data-color="${escapeHtml(member.color)}"></span></span>`;
}

function renderPage(catalog, env, zh) {
  const t = zh ? LABELS.zh : LABELS.en;
  const live = Array.isArray(catalog.products) ? catalog.products : [];
  const products = (fallbackCatalog.products || []).map((base) => {
    const hit = live.find((row) => row.target === base.target) || {};
    if (isMacTarget(base.target)) {
      return { ...base, ...hit, target: base.target, available: false };
    }
    return { ...base, ...hit, target: base.target };
  });
  const cli = catalog.cli || fallbackCatalog.cli || "npm i -g @xrkseek/harness-cli";
  const win = products.find((row) => row.target === "win-x64");
  const winHref = downloadHref(win, env);
  const first = SEEDS[0];
  const firstName = zh ? first.name : first.nameEn;
  const firstBrief = zh ? first.brief : first.briefEn;
  const roster = SEEDS.map((m, index) => {
    const title = zh ? m.name : m.nameEn;
    const brief = zh ? m.brief : m.briefEn;
    return `<button type="button" class="ball" data-member="${escapeHtml(m.id)}" data-name="${escapeHtml(title)}" data-brief="${escapeHtml(brief)}" aria-pressed="${index === 0 ? "true" : "false"}">
      ${ballMount(m)}
      <strong>${escapeHtml(title)}</strong>
    </button>`;
  }).join("");
  const rows = products.map((row) => {
    const mac = isMacTarget(row.target);
    const href = downloadHref(row, env);
    const label = t[TARGET_KEY[row.target] || ""] || row.target;
    const meta = mac ? t.macOff : row.available ? [row.version, row.filename].filter(Boolean).join(" · ") : t.wait;
    const btn = href
      ? `<a class="btn" href="${escapeHtml(href)}">${escapeHtml(t.download)}</a>`
      : `<span class="btn" aria-disabled="true">${escapeHtml(t.download)}</span>`;
    return `<article class="row"><div><h2>${escapeHtml(label)}</h2><p>${escapeHtml(meta)}</p></div>${btn}</article>`;
  }).join("");
  const orbit = SEEDS.map((m, index) => {
    const title = zh ? m.name : m.nameEn;
    const brief = zh ? m.brief : m.briefEn;
    return `<button type="button" class="orbit-ball" data-member="${escapeHtml(m.id)}" data-name="${escapeHtml(title)}" data-brief="${escapeHtml(brief)}" aria-label="${escapeHtml(title)}" aria-pressed="${index === 0 ? "true" : "false"}">${ballMount(m)}</button>`;
  }).join("");
  const scenes = (zh ? FLOW.zh : FLOW.en).map(([title, body], i) =>
    `<article class="scene${i === 0 ? " on" : ""}" data-scene="${i}" ${i === 0 ? "" : "hidden"}>
      <h3>${escapeHtml(title)}</h3>
      <p>${escapeHtml(body)}</p>
    </article>`).join("");
  const dots = (zh ? FLOW.zh : FLOW.en).map((_, i) =>
    `<button type="button" class="dot${i === 0 ? " on" : ""}" data-scene-dot="${i}" aria-label="${i + 1}"></button>`).join("");
  const cta = winHref
    ? `<a class="btn" href="${escapeHtml(winHref)}">${escapeHtml(t.get)}</a>`
    : `<span class="btn" aria-disabled="true">${escapeHtml(t.get)}</span>`;
  return `<!doctype html>
<html lang="${zh ? "zh-CN" : "en"}">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>XRK Harness</title>
  <meta name="description" content="${escapeHtml(t.lead)}"/>
  <link rel="icon" href="/logo-mark.svg" type="image/svg+xml"/>
  <link rel="stylesheet" href="/site.css"/>
  <script>
    (function () {
      try {
        var p = localStorage.getItem("xrk-site-theme") || "system";
        var dark = p === "dark" || (p !== "light" && window.matchMedia("(prefers-color-scheme: dark)").matches);
        document.documentElement.dataset.theme = dark ? "dark" : "light";
      } catch (e) {}
    })();
  </script>
</head>
<body>
  <a class="skip" href="#play">${escapeHtml(t.skip)}</a>
  <header class="top">
    <a class="brand" href="/${zh ? "" : "?lang=en"}">
      <span class="mark-wrap"><img class="mark" src="/logo-mark.svg" width="18" height="18" alt=""/></span>
      <span class="name">XRK Harness</span>
    </a>
    <nav class="nav" aria-label="XRK Harness">
      <a class="ghost" href="${GITHUB}">${escapeHtml(t.github)}</a>
      <a class="ghost" href="${DOCS}">${escapeHtml(t.docs)}</a>
      <button type="button" class="theme" data-theme-id="light" aria-label="${escapeHtml(t.light)}">${escapeHtml(t.light)}</button>
      <button type="button" class="theme" data-theme-id="dark" aria-label="${escapeHtml(t.dark)}">${escapeHtml(t.dark)}</button>
      <button type="button" class="theme" data-theme-id="system" aria-label="${escapeHtml(t.system)}">${escapeHtml(t.system)}</button>
      <a class="lang" href="?lang=${zh ? "en" : "zh"}">${escapeHtml(t.lang)}</a>
    </nav>
  </header>
  <main class="page">
    <section class="hero">
      <div>
        <h1>${escapeHtml(t.tagline)}</h1>
        <p class="lead">${escapeHtml(t.lead)}</p>
        <div class="cta">${cta}<a class="btn btn-outline" href="${GITHUB}">${escapeHtml(t.github)}</a></div>
      </div>
      <div class="pair">
        ${SEEDS.slice(0, 2).map((m, i) => {
          const title = zh ? m.name : m.nameEn;
          const brief = zh ? m.brief : m.briefEn;
          return `<button type="button" class="hero-ball" data-member="${escapeHtml(m.id)}" data-name="${escapeHtml(title)}" data-brief="${escapeHtml(brief)}" aria-label="${escapeHtml(title)}" aria-pressed="${i === 0 ? "true" : "false"}">${ballMount(m, "lg")}</button>`;
        }).join("")}
      </div>
    </section>
    <section class="play" id="play">
      <h2>${escapeHtml(t.play)}</h2>
      <p class="hint">${escapeHtml(t.playHint)}</p>
      <div class="shell" id="desk"
        data-send="${escapeHtml(t.send)}"
        data-queue="${escapeHtml(t.sendQueue)}"
        data-steer="${escapeHtml(t.sendSteer)}"
        data-sending="${escapeHtml(t.sending)}"
        data-waiting="${escapeHtml(t.waiting)}"
        data-steering="${escapeHtml(t.steering)}"
        data-withdraw="${escapeHtml(t.withdraw)}"
        data-qcount="${escapeHtml(t.queueCount)}"
        data-ph="${escapeHtml(t.placeholder)}"
        data-ph-busy="${escapeHtml(t.placeholderBusy)}"
        data-you="${escapeHtml(t.you)}"
        data-opener="${escapeHtml(t.opener)}"
        data-queued="${escapeHtml(t.queuedMsg)}"
        data-steer-msg="${escapeHtml(t.steerMsg)}"
        data-tool="${escapeHtml(t.toolOut)}"
        data-reply="${escapeHtml(t.reply)}"
        data-assigned="${escapeHtml(t.assigned)}"
        data-stop="${escapeHtml(t.stop)}"
      >
        <div class="deskbar" aria-hidden="true">XRK Harness</div>
        <aside class="rail">
          <p class="ws">${escapeHtml(t.workspace)} · XRK-harness</p>
          <p class="rail-k">${escapeHtml(t.team)}</p>
          <p class="quota">${escapeHtml(t.quota)}</p>
          <div class="roster">${roster}</div>
          <p class="who" id="pick-name">${escapeHtml(firstName)}</p>
          <p id="pick-brief">${escapeHtml(firstBrief)}</p>
          <button type="button" class="btn" id="delegate-btn">${escapeHtml(t.assign)}</button>
          <p class="rail-k">${escapeHtml(t.sessions)}</p>
          <button type="button" class="sess on" data-session="trunk" aria-pressed="true">
            <strong>${escapeHtml(t.trunkTitle)}</strong>
            <span>${escapeHtml(t.trunk)}</span>
          </button>
          <button type="button" class="sess nest" data-session="branch" aria-pressed="false">
            <strong>${escapeHtml(t.branchTitle)}</strong>
            <span>${escapeHtml(t.branch)}</span>
          </button>
          <button type="button" class="ghost new-sess" id="new-sess">${escapeHtml(t.newSession)}</button>
        </aside>
        <div class="pane">
          <div class="chrome">
            ${ballMount(SEEDS[0], "sm")}
            <strong id="thread-title">${escapeHtml(t.trunkTitle)}</strong>
            <span id="thread-tag">${escapeHtml(t.trunk)}</span>
          </div>
          <div class="thread" id="thread">
            <div class="userRow"><div class="bubble"><p>${escapeHtml(t.opener)}</p></div></div>
          </div>
          <div class="qdock" id="qdock" hidden>
            <p class="qhead" id="qcount">${escapeHtml(t.queueCount)}</p>
            <p class="qrow"><span class="badge" id="qbadge">${escapeHtml(t.sending)}</span> <span id="qtext">${escapeHtml(t.queuedMsg)}</span></p>
          </div>
          <form class="composer" id="composer">
            <textarea id="draft" rows="2" placeholder="${escapeHtml(t.placeholder)}" aria-label="${escapeHtml(t.placeholder)}"></textarea>
            <div class="crow">
              <div class="ctools">
                <button type="button" class="add" aria-label="${escapeHtml(t.commands)}" disabled>
                  <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M8 3v10M3 8h10" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
                </button>
                <span class="cselect">${escapeHtml(t.access)}</span>
                <span class="cselect">${escapeHtml(t.plan)}</span>
              </div>
              <div class="ctrail">
                <span class="cselect">${escapeHtml(t.model)}</span>
                <span class="meter" aria-hidden="true">
                  <svg viewBox="0 0 18 18" width="18" height="18"><circle class="track" cx="9" cy="9" r="6"/><circle class="fill" cx="9" cy="9" r="6" transform="rotate(-90 9 9)"/></svg>
                </span>
                <button type="button" class="primary is-idle" id="send-btn" aria-label="${escapeHtml(t.send)}">
                  <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M8.3125 0.980183C8.66767 1.0531 8.97902 1.20418 9.2627 1.43233C9.48724 1.61297 9.73029 1.85793 9.97949 2.10714L14.707 6.83468L13.293 8.24874L9 3.95577V15.0417H7V3.95577L2.70703 8.24874L1.29297 6.83468L6.02051 2.10714C6.26971 1.85793 6.51277 1.61297 6.7373 1.43233C6.97662 1.23986 7.28445 1.04402 7.6875 0.980183C7.8973 0.947006 8.1031 0.95516 8.3125 0.980183Z"/></svg>
                </button>
              </div>
            </div>
          </form>
        </div>
        <aside class="overview">
          <div class="seg" role="tablist">
            <button type="button" class="on" data-ov="status">${escapeHtml(t.overview)}</button>
            <button type="button" data-ov="graph">${escapeHtml(t.graph)}</button>
            <button type="button" data-ov="tasks">${escapeHtml(t.tasks)}</button>
            <button type="button" data-ov="plan">${escapeHtml(t.plan)}</button>
            <button type="button" data-ov="changes">${escapeHtml(t.changes)}</button>
          </div>
          <div data-ov-panel="status">
            <div class="ov-home">
              ${ballMount(SEEDS[3], "sm")}
              <p>XRK-harness</p>
            </div>
            <dl class="meta">
              <div><dt>${escapeHtml(t.home)}</dt><dd>XRK-harness</dd></div>
              <div><dt>${escapeHtml(t.team)}</dt><dd id="ov-member">${escapeHtml(firstName)}</dd></div>
              <div><dt>${escapeHtml(t.quota)}</dt><dd class="nums">2 / 2</dd></div>
            </dl>
          </div>
          <div data-ov-panel="graph" hidden>
            <ol class="graph">
              <li>${escapeHtml(t.home)} · XRK-harness</li>
              <li id="graph-child">${escapeHtml(t.running)} · ${escapeHtml(firstName)}</li>
            </ol>
          </div>
          <div data-ov-panel="tasks" hidden>
            <article class="task">
              <strong id="task-name">${escapeHtml(firstName)}</strong>
              <span class="seed">${escapeHtml(t.running)}</span>
              <p id="task-brief">${escapeHtml(firstBrief)}</p>
              <span class="btn" aria-disabled="true">${escapeHtml(t.openChild)}</span>
              <span class="btn btn-outline" aria-disabled="true">${escapeHtml(t.merge)}</span>
            </article>
          </div>
          <div data-ov-panel="plan" hidden>
            <p class="hint">${escapeHtml(zh ? "本轮还没有计划条目。概况里有才会写。" : "No plan items until Overview writes them.")}</p>
          </div>
          <div data-ov-panel="changes" hidden>
            <p class="hint">${escapeHtml(zh ? "改动面板跟仓库 diff，空会话不编造文件。" : "Changes follow the repo diff. An empty session invents none.")}</p>
          </div>
        </aside>
      </div>
    </section>
    <section class="reel" id="flow" aria-label="${escapeHtml(t.flow)}">
      <h2>${escapeHtml(t.flow)}</h2>
      <div class="film" data-reel>${scenes}</div>
      <div class="orbit">${orbit}</div>
      <div class="dots">${dots}</div>
    </section>
    <section class="download" id="download">
      <h2>${escapeHtml(t.download)}</h2>
      <div class="dl">${rows}</div>
      <p class="cli">
        <span>${escapeHtml(t.cli)}</span>
        <code id="cli-text">${escapeHtml(cli)}</code>
        <button type="button" class="copy" id="copy-cli" data-copy="${escapeHtml(t.copy)}" data-copied="${escapeHtml(t.copied)}">${escapeHtml(t.copy)}</button>
      </p>
      <p class="cli"><code>xrkh web</code></p>
    </section>
    <footer class="foot">
      <span>${escapeHtml(t.mit)}</span>
      <a href="${GITHUB}">${escapeHtml(t.github)}</a>
      <a href="${NPM}">@xrkseek/harness-cli</a>
      <a href="${DOCS}">${escapeHtml(t.docs)}</a>
    </footer>
  </main>
  <script src="/presence/emotion-ball/rings.js"></script>
  <script src="/presence/emotion-ball/emotions.js"></script>
  <script src="/presence/emotion-ball/ball.js"></script>
  <script src="/presence/emotion-ball/engine.js"></script>
  <script src="/site.js"></script>
</body>
</html>`;
}

async function proxyHarness(request, env) {
  const incoming = new URL(request.url);
  const upstream = `${origin(env)}${incoming.pathname}${incoming.search}`;
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }
  const headers = new Headers();
  const accept = request.headers.get("Accept");
  if (accept) headers.set("Accept", accept);
  const res = await fetch(upstream, { method: request.method, headers, redirect: "follow" });
  const out = new Headers(res.headers);
  out.set("Access-Control-Allow-Origin", "*");
  return new Response(res.body, { status: res.status, headers: out });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/harness/")) {
      if (url.pathname.startsWith("/api/harness/download/") || url.pathname.startsWith("/api/harness/desktop/bin/")) {
        return Response.redirect(`${origin(env)}${url.pathname}${url.search}`, 302);
      }
      return proxyHarness(request, env);
    }
    if (url.pathname === "/" || url.pathname === "") {
      const catalog = await loadCatalog(env);
      const zh = url.searchParams.get("lang") !== "en";
      return new Response(renderPage(catalog, env, zh), {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "public, max-age=60",
        },
      });
    }
    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response("Not found", { status: 404 });
  },
};
