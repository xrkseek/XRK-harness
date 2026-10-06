/**
 * Cloudflare Worker product page: shell tokens, seed 干员, live catalog.
 * Installer bytes stay on AGT :6969 (Worker size limits).
 */
import fallbackCatalog from "../releases.json" with { type: "json" };

const DEFAULT_ORIGIN = "http://103.236.89.174:6969";
const GITHUB = "https://github.com/xrkseek/XRK-harness";
const NPM = "https://www.npmjs.com/package/@xrkseek/harness-cli";
const DOCS = `${GITHUB}/blob/main/docs/getting-started.md`;

/** Keep in sync with seedGlobalRosterMembers in packages/server/face. */
const SEEDS = [
  { id: "mem_seed_researcher", name: "调研员", nameEn: "Researcher", role: "researcher", brief: "只读调研，引用路径与原文。", briefEn: "Read-only research. Cite paths and quotes.", shape: "blob", color: "mist" },
  { id: "mem_seed_worker", name: "施工员", nameEn: "Builder", role: "worker", brief: "按任务改代码，不扩范围。", briefEn: "Edit in scope. No extras.", shape: "wedge", color: "sage" },
  { id: "mem_seed_reviewer", name: "审稿员", nameEn: "Reviewer", role: "reviewer", brief: "只读审稿，先报缺陷。", briefEn: "Read-only review. Defects first.", shape: "gem", color: "lilac" },
  { id: "mem_seed_lead", name: "调度员", nameEn: "Lead", role: "lead", brief: "拆任务、协调干员。", briefEn: "Split work. Coordinate the roster.", shape: "blob", color: "slate" },
  { id: "mem_seed_scout", name: "探网员", nameEn: "Scout", role: "researcher", brief: "查网上公开事实，给出链接与日期。", briefEn: "Public web facts with URLs and dates.", shape: "wedge", color: "peach" },
  { id: "mem_seed_docs", name: "文书员", nameEn: "Docs", role: "worker", brief: "写诚实说明书与发行说明，不编未做能力。", briefEn: "Honest docs. No invented APIs.", shape: "squircle", color: "butter" },
  { id: "mem_seed_fixer", name: "排障员", nameEn: "Fixer", role: "worker", brief: "复现故障、定位、修，并给出证据。", briefEn: "Reproduce, isolate, fix, show evidence.", shape: "gem", color: "coral" },
  { id: "mem_seed_tester", name: "测员", nameEn: "Tester", role: "worker", brief: "跑相关测试，报告失败与最小复现。", briefEn: "Run tests. Report failures and repro.", shape: "pill", color: "sage" },
];

const SHAPE = {
  wedge: "M18 5.5c1.2 0 2.3.6 3 1.6l10.2 15.8c1.4 2.2-.2 5.1-2.8 5.1H7.6c-2.6 0-4.2-2.9-2.8-5.1L15 7.1c.7-1 1.8-1.6 3-1.6z",
  gem: "M18 4.5 31.5 18 18 31.5 4.5 18 18 4.5z",
};

const LABELS = {
  zh: {
    lead: "TypeScript Agent Harness。会话是真源，干员可委派，设置里改模型与 MCP。桌面端目前只提供 Windows x64 安装包。",
    roster: "预置干员",
    rosterHint: "点一名干员，看它在产品里会怎么接任务。",
    you: "你",
    composer: "给干员下达任务…（演示，不会发送）",
    send: "发送",
    cli: "命令行",
    copy: "复制",
    copied: "已复制",
    lang: "EN",
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
    macOff: "目前不支持桌面安装包。请用 CLI 或 xrkh web。",
    wait: "尚未上传",
    mit: "MIT",
    demo: "产品演示",
    sessions: "会话",
    workspaces: "工作区",
    team: "Agent Team",
    overview: "概况",
    graph: "委派图",
    tasks: "Agent Teams 任务",
    changes: "改动",
    home: "委派方",
    member: "被委派方",
    delegate: "委派",
    running: "运行中",
    idle: "已完成",
    fork: "分叉会话",
    trunk: "主线",
    branch: "支线",
    quota: "配额",
    fleet: "舰队健康",
    fleetOk: "正常",
    merge: "合回主仓",
    openChild: "打开子会话",
    demoHint: "演示不连 Host。点会话、干员、概况页签即可。",
    trunkTitle: "发版 0.5.14",
    branchTitle: "修 Host 冷启动",
    trunkMsg: "这条是主线：侧栏标题跟工作区主线走。",
    branchMsg: "这条是支线：从主线分叉，不藏进子代理行。",
    delegateHint: "选干员后点委派，概况里会出现子代理与任务板。",
    changeFile: "apps/desktop/src/main.ts",
    turn: "回合 3 · 2 个文件",
    skip: "跳到正文",
    how: "怎么用",
    webRun: "命令行进网页壳",
    slash: "/status · /plan · /mcp · /rollback",
    context: "上下文",
    plan: "计划",
    mention: "@file / @session",
    todo1: "核对 Windows 安装包",
    todo2: "委派施工员改 Host 启动",
    todo3: "审稿员只读过一遍",
    tool: "bash",
    toolOut: "node -v → v26.10.0",
    quotaVal: "2 / 2",
  },
  en: {
    lead: "A TypeScript agent harness. Sessions are the source of truth, operators can be delegated, models and MCP live in Settings. Desktop installers ship for Windows x64 only.",
    roster: "Seed roster",
    rosterHint: "Pick an operator to see how it takes work in the product.",
    you: "You",
    composer: "Assign a task… (demo, not sent)",
    send: "Send",
    cli: "CLI",
    copy: "Copy",
    copied: "Copied",
    lang: "中文",
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
    macOff: "No desktop installer yet. Use the CLI or xrkh web.",
    wait: "Not uploaded yet",
    mit: "MIT",
    demo: "Product demo",
    sessions: "Sessions",
    workspaces: "Workspaces",
    team: "Agent Team",
    overview: "Overview",
    graph: "Delegation graph",
    tasks: "Agent Team tasks",
    changes: "Changes",
    home: "Delegator",
    member: "Delegate",
    delegate: "Delegate",
    running: "running",
    idle: "done",
    fork: "Fork session",
    trunk: "Main",
    branch: "Branch",
    quota: "quota",
    fleet: "Fleet",
    fleetOk: "ok",
    merge: "Merge to main",
    openChild: "Open child",
    demoHint: "Demo is local. Click sessions, operators, and Overview tabs.",
    trunkTitle: "Ship 0.5.14",
    branchTitle: "Host cold start",
    trunkMsg: "This is the main line: the sidebar title follows the workspace thread.",
    branchMsg: "This is a branch: an ordinary fork, not a hidden subagent row.",
    delegateHint: "Pick an operator and Delegate. Overview then shows a child and a task row.",
    changeFile: "apps/desktop/src/main.ts",
    turn: "Turn 3 · 2 files",
    skip: "Skip to content",
    how: "Get started",
    webRun: "Open the web shell from the CLI",
    slash: "/status · /plan · /mcp · /rollback",
    context: "Context",
    plan: "Plan",
    mention: "@file / @session",
    todo1: "Check the Windows installer",
    todo2: "Delegate the builder onto Host boot",
    todo3: "Read-only review",
    tool: "bash",
    toolOut: "node -v → v26.10.0",
    quotaVal: "2 / 2",
  },
};

const CAPS = {
  zh: [
    ["Session", "对话与工具写在可重建的事件日志里。turn 短寿，会话长寿。"],
    ["Agent Team", "预置干员带外形、brief、playbook。subagent(member_id) 委派，侧栏球可见。"],
    ["主线 / 支线", "工作区主线钉标题；支线是分叉会话。子代理行不进侧栏会话树。"],
    ["概况", "右侧栏与 /status 同源：委派图、任务板、改动、上下文。"],
    ["MCP / 插件", "设置里热挂载 MCP。进程插件 tools · prompt · commands。"],
    ["Skills", "家目录与工作区分层注入。干员默认 minimal，不把技能表塞进子代理。"],
    ["桌面", "Windows x64 安装包能跑。macOS 桌面包此页不提供；可用 xrkh web。"],
    ["CLI", "xrkh web / serve / run。Node ≥26。日常调参走设置，不必先配 env。"],
  ],
  en: [
    ["Session", "Chat and tools land on a rebuildable event log. Turns are short; sessions last."],
    ["Agent Team", "Seeded operators carry look, brief, and playbook. Spawn with subagent(member_id)."],
    ["Main / branch", "A workspace thread pins the title. Branches are ordinary forks. Subagents stay off the session tree."],
    ["Overview", "The Status column matches /status: graph, task board, changes, context."],
    ["MCP / plugins", "Hot-mount MCP from Settings. Process plugins: tools, prompt, commands."],
    ["Skills", "Home and workspace layers inject. Operators default to minimal and skip the skill catalog."],
    ["Desktop", "Windows x64 installer works. No macOS installer on this page; use xrkh web."],
    ["CLI", "xrkh web / serve / run. Node ≥26. Day-to-day knobs live in Settings, not env."],
  ],
};

const TARGET_KEY = { "win-x64": "win", "mac-arm64": "macArm", "mac-x64": "macIntel" };

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

function glyph(shape) {
  if (shape === "squircle") {
    return `<svg viewBox="0 0 36 36" aria-hidden="true"><rect x="6" y="6" width="24" height="24" rx="8" fill="currentColor"/></svg>`;
  }
  if (shape === "pill") {
    return `<svg viewBox="0 0 36 36" aria-hidden="true"><rect x="4" y="11" width="28" height="14" rx="7" fill="currentColor"/></svg>`;
  }
  const d = SHAPE[shape];
  if (d) {
    return `<svg viewBox="0 0 36 36" aria-hidden="true"><path fill="currentColor" d="${d}"/></svg>`;
  }
  return `<svg viewBox="0 0 36 36" aria-hidden="true"><circle cx="18" cy="18" r="13.5" fill="currentColor"/></svg>`;
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

function renderDemo(t, zh, roster) {
  const first = SEEDS[0];
  const firstName = zh ? first.name : first.nameEn;
  const firstBrief = zh ? first.brief : first.briefEn;
  const worker = SEEDS.find((m) => m.id === "mem_seed_worker") ?? first;
  const reviewer = SEEDS.find((m) => m.id === "mem_seed_reviewer") ?? first;
  const wName = zh ? worker.name : worker.nameEn;
  const rName = zh ? reviewer.name : reviewer.nameEn;
  return `<section class="workbench" id="demo" aria-label="${escapeHtml(t.demo)}">
      <aside class="rail">
        <div class="seg" role="tablist">
          <button type="button" class="segOn" data-rail="sessions">${escapeHtml(t.sessions)}</button>
          <button type="button" class="segOff" data-rail="team">${escapeHtml(t.team)}</button>
        </div>
        <div data-rail-panel="sessions">
          <p class="hint">${escapeHtml(t.workspaces)}</p>
          <button type="button" class="sess sessOn" data-session="trunk" aria-pressed="true">
            <span class="dot" data-state="ongoing"></span>
            <span>
              <strong>${escapeHtml(t.trunkTitle)}</strong>
              <span class="seed">${escapeHtml(t.trunk)}</span>
            </span>
          </button>
          <button type="button" class="sess sessBranch" data-session="branch" aria-pressed="false">
            <span class="dot" data-state="idle"></span>
            <span>
              <strong>${escapeHtml(t.branchTitle)}</strong>
              <span class="seed">${escapeHtml(t.branch)} · ${escapeHtml(t.fork)}</span>
            </span>
          </button>
        </div>
        <div data-rail-panel="team" hidden>
          <h2 class="heading">${escapeHtml(t.roster)}</h2>
          <p class="hint">${escapeHtml(t.delegateHint)}</p>
          <div class="roster">${roster}</div>
          <button type="button" class="btn delegate" id="delegate-btn">${escapeHtml(t.delegate)}</button>
        </div>
      </aside>
      <div class="pane">
        <div class="chrome">
          <span id="thread-tag">${escapeHtml(t.trunk)}</span>
          <strong id="thread-title">${escapeHtml(t.trunkTitle)}</strong>
          <button type="button" class="ghost" data-ov-tab="status">${escapeHtml(t.overview)}</button>
        </div>
        <div class="thread" data-thread="trunk">
          <div class="bubble"><span class="who">${escapeHtml(t.you)}</span><p>${escapeHtml(t.trunkMsg)}</p></div>
          <div class="tool"><span class="seed">${escapeHtml(t.tool)}</span><code>${escapeHtml(t.toolOut)}</code></div>
          <div class="bubble"><span class="who" id="member-who">${escapeHtml(firstName)}</span><p id="member-brief">${escapeHtml(firstBrief)}</p></div>
        </div>
        <div class="thread" data-thread="branch" hidden>
          <div class="bubble"><span class="who">${escapeHtml(t.you)}</span><p>${escapeHtml(t.branchMsg)}</p></div>
          <div class="bubble"><span class="who">${escapeHtml(t.branch)}</span><p>${escapeHtml(zh ? "分叉后各写各的事件日志，合回是另一条操作。" : "Each fork keeps its own event log. Merge is a separate action.")}</p></div>
        </div>
        <form class="composer" id="composer">
          <textarea rows="2" placeholder="${escapeHtml(t.composer)}" aria-label="${escapeHtml(t.composer)}"></textarea>
          <button type="button" class="btn" disabled>${escapeHtml(t.send)}</button>
        </form>
      </div>
      <aside class="overview">
        <div class="seg" role="tablist">
          <button type="button" class="segOn" data-ov-tab="status">${escapeHtml(t.overview)}</button>
          <button type="button" class="segOff" data-ov-tab="graph">${escapeHtml(t.graph)}</button>
          <button type="button" class="segOff" data-ov-tab="tasks">${escapeHtml(t.tasks)}</button>
          <button type="button" class="segOff" data-ov-tab="plan">${escapeHtml(t.plan)}</button>
          <button type="button" class="segOff" data-ov-tab="changes">${escapeHtml(t.changes)}</button>
          <button type="button" class="segOff" data-ov-tab="context">${escapeHtml(t.context)}</button>
        </div>
        <div data-ov-panel="status">
          <p class="hint">${escapeHtml(t.demoHint)}</p>
          <dl class="meta">
            <div><dt>${escapeHtml(t.home)}</dt><dd>XRK-harness</dd></div>
            <div><dt>${escapeHtml(t.member)}</dt><dd id="ov-member">${escapeHtml(firstName)}</dd></div>
            <div><dt>${escapeHtml(t.quota)}</dt><dd class="nums">${escapeHtml(t.quotaVal)}</dd></div>
            <div><dt>${escapeHtml(t.fleet)}</dt><dd>${escapeHtml(t.fleetOk)}</dd></div>
          </dl>
        </div>
        <div data-ov-panel="graph" hidden>
          <p class="hint">${escapeHtml(t.graph)}</p>
          <ol class="graph">
            <li><span class="seed">${escapeHtml(t.home)}</span> XRK-harness</li>
            <li class="edge"></li>
            <li><span class="seed">${escapeHtml(t.running)}</span> ${escapeHtml(wName)}</li>
            <li class="edge"></li>
            <li><span class="seed">${escapeHtml(t.idle)}</span> ${escapeHtml(rName)}</li>
          </ol>
        </div>
        <div data-ov-panel="tasks" hidden>
          <p class="hint">${escapeHtml(t.tasks)}</p>
          <article class="task">
            <strong>${escapeHtml(wName)}</strong>
            <span class="seed">${escapeHtml(t.running)}</span>
            <p>${escapeHtml(zh ? "按任务改 Host 启动路径，不扩范围。" : "Patch Host boot only. Stay in scope.")}</p>
            <div class="cta">
              <span class="btn" aria-disabled="true">${escapeHtml(t.openChild)}</span>
              <span class="btn btn-outline" aria-disabled="true">${escapeHtml(t.merge)}</span>
            </div>
          </article>
          <article class="task" id="task-extra" hidden>
            <strong id="task-extra-name"></strong>
            <span class="seed">${escapeHtml(t.running)}</span>
            <p id="task-extra-brief"></p>
          </article>
        </div>
        <div data-ov-panel="plan" hidden>
          <p class="hint">${escapeHtml(t.plan)}</p>
          <ul class="todos">
            <li data-todo="done">${escapeHtml(t.todo1)}</li>
            <li data-todo="doing">${escapeHtml(t.todo2)}</li>
            <li data-todo="wait">${escapeHtml(t.todo3)}</li>
          </ul>
        </div>
        <div data-ov-panel="changes" hidden>
          <p class="hint">${escapeHtml(t.turn)}</p>
          <p class="change"><span class="added">+18</span> <span class="deleted">-4</span> ${escapeHtml(t.changeFile)}</p>
          <p class="change"><span class="added">+6</span> apps/desktop/src/desktop-bootstrap.ts</p>
        </div>
        <div data-ov-panel="context" hidden>
          <p class="hint">${escapeHtml(t.context)}</p>
          <p class="change">${escapeHtml(t.slash)}</p>
          <p class="change">${escapeHtml(t.mention)}</p>
        </div>
      </aside>
    </section>`;
}

function renderPage(catalog, env, zh) {
  const t = zh ? LABELS.zh : LABELS.en;
  const nextLang = zh ? "en" : "zh";
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
  const roster = SEEDS.map((m, index) => {
    const title = zh ? m.name : m.nameEn;
    const brief = zh ? m.brief : m.briefEn;
    return `<button type="button" class="ball" data-member="${escapeHtml(m.id)}" data-name="${escapeHtml(title)}" data-brief="${escapeHtml(brief)}" data-color="${escapeHtml(m.color)}" aria-pressed="${index === 0 ? "true" : "false"}">
      <span class="stage">${glyph(m.shape)}</span>
      <strong>${escapeHtml(title)}</strong>
      <span class="seed">${escapeHtml(m.role)}</span>
    </button>`;
  }).join("");
  const rows = products.map((row) => {
    const mac = isMacTarget(row.target);
    const href = downloadHref(row, env);
    const label = t[TARGET_KEY[row.target] || ""] || row.target;
    const meta = mac
      ? t.macOff
      : row.available
        ? [row.version, row.filename].filter(Boolean).join(" · ")
        : t.wait;
    const btn = href
      ? `<a class="btn" href="${escapeHtml(href)}">${escapeHtml(t.download)}</a>`
      : `<span class="btn" aria-disabled="true">${escapeHtml(t.download)}</span>`;
    return `<article class="row">
      <div><h2>${escapeHtml(label)}</h2><p>${escapeHtml(meta)}</p></div>
      ${btn}
    </article>`;
  }).join("");
  const caps = (zh ? CAPS.zh : CAPS.en)
    .map(([title, body]) => `<article class="cap"><h2>${escapeHtml(title)}</h2><p>${escapeHtml(body)}</p></article>`)
    .join("");
  const qs = `?lang=${nextLang}`;
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
  <a class="skip" href="#demo">${escapeHtml(t.skip)}</a>
  <header class="top">
    <a class="brand" href="/${zh ? "" : "?lang=en"}">
      <span class="mark-wrap"><img class="mark" src="/logo-mark.svg" width="18" height="18" alt=""/></span>
      <span class="name">XRK Harness</span>
    </a>
    <nav class="nav" aria-label="XRK Harness">
      <a class="ghost" href="#demo">${escapeHtml(t.demo)}</a>
      <a class="ghost" href="#download">${escapeHtml(t.download)}</a>
      <a class="ghost" href="${GITHUB}">${escapeHtml(t.github)}</a>
      <a class="ghost" href="${DOCS}">${escapeHtml(t.docs)}</a>
      <a class="ghost" href="${NPM}">${escapeHtml(t.npm)}</a>
      <button type="button" class="theme" data-theme-id="light" aria-label="${escapeHtml(t.light)}">${escapeHtml(t.light)}</button>
      <button type="button" class="theme" data-theme-id="dark" aria-label="${escapeHtml(t.dark)}">${escapeHtml(t.dark)}</button>
      <button type="button" class="theme" data-theme-id="system" aria-label="${escapeHtml(t.system)}">${escapeHtml(t.system)}</button>
      <a class="lang" href="${qs}">${escapeHtml(t.lang)}</a>
    </nav>
  </header>
  <div class="page">
    <section class="hero">
      <h1>向阳而生，驭光而行</h1>
      <p class="lead">${escapeHtml(t.lead)}</p>
      <div class="cta">
        ${winHref ? `<a class="btn" href="${escapeHtml(winHref)}">${escapeHtml(t.get)}</a>` : `<span class="btn" aria-disabled="true">${escapeHtml(t.get)}</span>`}
        <a class="btn btn-outline" href="${GITHUB}">${escapeHtml(t.github)}</a>
      </div>
    </section>
    ${renderDemo(t, zh, roster)}
    <section class="how" aria-labelledby="how-h">
      <h2 class="heading" id="how-h">${escapeHtml(t.how)}</h2>
      <p class="lead">${escapeHtml(t.webRun)}</p>
      <p class="cli"><code>xrkh web</code></p>
      <p class="hint">${escapeHtml(t.slash)}</p>
    </section>
    <section class="caps">${caps}</section>
    <section class="download" id="download">
      <h2 class="heading">${escapeHtml(t.download)}</h2>
      <div class="dl">${rows}</div>
      <p class="cli">
        <span>${escapeHtml(t.cli)}</span>
        <code id="cli-text">${escapeHtml(cli)}</code>
        <button type="button" class="copy" id="copy-cli" data-copy="${escapeHtml(t.copy)}" data-copied="${escapeHtml(t.copied)}">${escapeHtml(t.copy)}</button>
      </p>
    </section>
    <footer class="foot">
      <span>${escapeHtml(t.mit)}</span>
      <a href="${GITHUB}">${escapeHtml(t.github)}</a>
      <a href="${NPM}">@xrkseek/harness-cli</a>
      <a href="${DOCS}">${escapeHtml(t.docs)}</a>
    </footer>
  </div>
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
