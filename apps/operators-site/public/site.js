const THEME_KEY = "xrk-ops-theme";

/** Built-in roster seeds — appearance lives on the site only (packs never round-trip shape/color). */
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

const PALETTES = {
  mist: { light: { body: "#D4E0EC", eyes: "#1A1A1A" }, dark: { body: "#9AABB8", eyes: "#1A1A1A" } },
  sage: { light: { body: "#D4E5C8", eyes: "#1A1A1A" }, dark: { body: "#96B088", eyes: "#1A1A1A" } },
  lilac: { light: { body: "#E5D4E8", eyes: "#1A1A1A" }, dark: { body: "#B098B8", eyes: "#1A1A1A" } },
  slate: { light: { body: "#C8CDD4", eyes: "#1A1A1A" }, dark: { body: "#5A6068", eyes: "#F0EEE8" } },
  peach: { light: { body: "#F0D8C8", eyes: "#1A1A1A" }, dark: { body: "#C4A090", eyes: "#1A1A1A" } },
  butter: { light: { body: "#F2E4B0", eyes: "#1A1A1A" }, dark: { body: "#C4B070", eyes: "#1A1A1A" } },
  coral: { light: { body: "#F0C8BC", eyes: "#1A1A1A" }, dark: { body: "#C48A7C", eyes: "#1A1A1A" } },
};

const I18N = {
  zh: {
    skip: "跳到干员列表",
    brand: "XRK 干员",
    downloadSite: "下载站",
    github: "GitHub",
    light: "浅色",
    dark: "深色",
    system: "系统",
    lang: "EN",
    title: "把干员交给朋友",
    lead: "下方可以挑选下载干员，直接发给向阳空间向日葵经理即可完成部署下载环境准备。",
    browse: "浏览列表",
    getHarness: "先装 Harness",
    listTitle: "干员列表",
    listHint: "下载直达 AGT，本站不存大文件。",
    searchLabel: "搜索",
    searchPh: "搜名字或简介",
    empty: "还没有公开包。上架后会出现在这里；天幕里是预置干员。",
    mit: "MIT",
    download: "下载",
    advanced: "高级包",
    thin: "瘦卡",
    noUrl: "暂无链接",
    clickPlay: "点击互动",
    documentTitle: "XRK 干员",
  },
  en: {
    skip: "Skip to catalog",
    brand: "XRK Operators",
    downloadSite: "Download",
    github: "GitHub",
    light: "Light",
    dark: "Dark",
    system: "System",
    lang: "中文",
    title: "Hand operators to friends",
    lead: "Pick an operator below and send it to Xiangyang’s sunflower manager — they handle deploy and environment prep.",
    browse: "Browse list",
    getHarness: "Get Harness first",
    listTitle: "Operator catalog",
    listHint: "Downloads go straight to AGT. This site does not host large files.",
    searchLabel: "Search",
    searchPh: "Search name or brief",
    empty: "No public packs yet. They show up after publish; seeded operators fill the sky.",
    mit: "MIT",
    download: "Download",
    advanced: "Advanced",
    thin: "Thin card",
    noUrl: "No link",
    clickPlay: "Click to play",
    documentTitle: "XRK Operators",
  },
};

/** Layout slots for the constellation (percent of constellation box). */
const SKY_SLOTS = [
  { x: 8, y: 18, size: "lg" },
  { x: 28, y: 8, size: "md" },
  { x: 48, y: 22, size: "lg" },
  { x: 68, y: 6, size: "sm" },
  { x: 82, y: 28, size: "md" },
  { x: 12, y: 52, size: "sm" },
  { x: 34, y: 58, size: "lg" },
  { x: 56, y: 48, size: "md" },
  { x: 74, y: 62, size: "lg" },
  { x: 90, y: 48, size: "sm" },
  { x: 22, y: 78, size: "md" },
  { x: 46, y: 82, size: "sm" },
  { x: 66, y: 78, size: "md" },
  { x: 88, y: 72, size: "sm" },
];

let locale = "zh";
let catalog = { sites: {}, agt: {}, members: [] };
let members = [];

function t() {
  return I18N[locale] || I18N.zh;
}

function systemDark() {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function preference() {
  try {
    return localStorage.getItem(THEME_KEY) || "system";
  } catch {
    return "system";
  }
}

function resolved(pref) {
  if (pref === "dark") return "dark";
  if (pref === "light") return "light";
  return systemDark() ? "dark" : "light";
}

function paint(color) {
  const pal = PALETTES[color] || PALETTES.mist;
  return document.documentElement.dataset.theme === "dark" ? pal.dark : pal.light;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatBytes(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return "";
  if (v < 1024) return `${v} B`;
  if (v < 1024 * 1024) return `${(v / 1024).toFixed(1)} KB`;
  return `${(v / (1024 * 1024)).toFixed(1)} MB`;
}

function detectLocale() {
  const q = new URLSearchParams(location.search).get("lang");
  if (q === "en" || q === "zh") return q;
  return new Date().getTimezoneOffset() === -480 ? "zh" : "en";
}

function applyI18n() {
  const L = t();
  document.documentElement.lang = locale === "zh" ? "zh-CN" : "en";
  document.title = L.documentTitle;
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.getAttribute("data-i18n");
    if (key && L[key] != null) el.textContent = L[key];
  });
  document.querySelectorAll("[data-i18n-aria]").forEach((el) => {
    const key = el.getAttribute("data-i18n-aria");
    if (key && L[key] != null) {
      el.setAttribute("aria-label", L[key]);
      el.textContent = L[key];
    }
  });
  document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
    const key = el.getAttribute("data-i18n-placeholder");
    if (key && L[key] != null) el.setAttribute("placeholder", L[key]);
  });
  const lang = document.querySelector("[data-lang-toggle]");
  if (lang) {
    lang.textContent = L.lang;
    lang.href = locale === "zh" ? "?lang=en" : "?lang=zh";
  }
  const home = document.querySelector("[data-home]");
  if (home) home.href = locale === "zh" ? "/" : "/?lang=en";
}

function applyTheme(pref) {
  const mode = resolved(pref);
  document.documentElement.dataset.theme = mode;
  document.body.toggleAttribute("data-ds-dark-theme", mode === "dark");
  document.querySelectorAll("[data-theme-id]").forEach((btn) => {
    btn.setAttribute("aria-pressed", btn.dataset.themeId === pref ? "true" : "false");
  });
  mountBalls();
}

function mountBalls() {
  const create = window.EmotionBall && window.EmotionBall.create;
  document.querySelectorAll("[data-ball]").forEach((el) => {
    if (el._ball && el._ball.destroy) el._ball.destroy();
    el.replaceChildren();
    if (!create) return;
    const tone = paint(el.dataset.color);
    el._ball = create(el, {
      emotion: el.dataset.emotion || "02",
      idle: true,
      lite: true,
      eyeScale: 1.15,
      shape: el.dataset.shape || "blob",
      color: tone.body,
      eyeColor: tone.eyes,
    });
    el.dataset.ready = "";
  });
}

function memberLabel(m) {
  if (locale === "en" && m.nameEn) return m.nameEn;
  return m.name || m.id;
}

function memberBrief(m) {
  if (locale === "en" && m.briefEn) return m.briefEn;
  return m.brief || "";
}

function skyMembers() {
  const fromCatalog = members.map((m) => ({
    id: m.id,
    name: m.name,
    nameEn: m.nameEn,
    shape: m.shape || "blob",
    color: m.color || "mist",
  }));
  const seen = new Set(fromCatalog.map((m) => m.id));
  const seeds = SEEDS.filter((s) => !seen.has(s.id));
  return [...fromCatalog, ...seeds].slice(0, SKY_SLOTS.length);
}

function renderConstellation() {
  const root = document.getElementById("constellation");
  if (!root) return;
  const L = t();
  const items = skyMembers();
  root.replaceChildren();
  items.forEach((m, i) => {
    const slot = SKY_SLOTS[i % SKY_SLOTS.length];
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "sky-ball";
    btn.style.left = `${slot.x}%`;
    btn.style.top = `${slot.y}%`;
    btn.style.animationDelay = `${i * 40}ms`;
    btn.setAttribute("aria-label", `${L.clickPlay} · ${memberLabel(m)}`);
    btn.innerHTML = `<span class="stage ${slot.size}"><span class="mount" data-ball data-shape="${escapeHtml(m.shape)}" data-color="${escapeHtml(m.color)}" data-emotion="0${(i % 5) + 1}"></span></span>`;
    btn.addEventListener("click", () => {
      const ball = btn.querySelector("[data-ball]");
      if (ball && ball._ball && typeof ball._ball.bounce === "function") ball._ball.bounce();
      else if (ball && ball._ball && typeof ball._ball.setEmotion === "function") {
        ball._ball.setEmotion(`0${(Math.floor(Math.random() * 5) + 1)}`);
      }
    });
    root.appendChild(btn);
  });
  mountBalls();
}

function kindChip(kind) {
  const L = t();
  return kind === "thin" ? L.thin : L.advanced;
}

function renderList(filter = "") {
  const root = document.getElementById("member-list");
  const empty = document.getElementById("empty");
  if (!root) return;
  const L = t();
  const q = filter.trim().toLowerCase();
  const rows = members.filter((m) => {
    if (!q) return true;
    const hay = `${memberLabel(m)} ${memberBrief(m)} ${(m.skills || []).join(" ")}`.toLowerCase();
    return hay.includes(q);
  });
  root.replaceChildren();
  if (!rows.length) {
    if (empty) empty.hidden = false;
    return;
  }
  if (empty) empty.hidden = true;
  for (const m of rows) {
    const article = document.createElement("article");
    article.className = "member";
    const shape = m.shape || "blob";
    const color = m.color || "mist";
    const size = formatBytes(m.sizeBytes);
    const skills = Array.isArray(m.skills) ? m.skills.slice(0, 4) : [];
    const href = String(m.downloadUrl || "").trim();
    const file = String(m.filename || "").trim();
    const chips = [
      `<span class="chip">${escapeHtml(kindChip(m.kind))}</span>`,
      size ? `<span class="chip">${escapeHtml(size)}</span>` : "",
      file ? `<span class="chip">${escapeHtml(file)}</span>` : "",
      ...skills.map((s) => `<span class="chip">${escapeHtml(s)}</span>`),
    ]
      .filter(Boolean)
      .join("");
    const action = href
      ? `<a class="btn" href="${escapeHtml(href)}" rel="noopener">${escapeHtml(L.download)}</a>`
      : `<span class="btn" aria-disabled="true">${escapeHtml(L.noUrl)}</span>`;
    article.innerHTML = `
      <span class="stage md"><span class="mount" data-ball data-shape="${escapeHtml(shape)}" data-color="${escapeHtml(color)}"></span></span>
      <div class="member-copy">
        <h3>${escapeHtml(memberLabel(m))}</h3>
        <p class="brief">${escapeHtml(memberBrief(m))}</p>
        <div class="meta">${chips}</div>
      </div>
      <div class="member-actions">${action}</div>`;
    root.appendChild(article);
  }
  mountBalls();
}

function wireDownloadLinks() {
  const href = String(catalog.sites?.download || "https://xrk.siphot.com/").trim();
  document.querySelectorAll("[data-download-link]").forEach((a) => {
    a.href = href;
  });
}

function normalizeCatalog(raw) {
  const base = raw && typeof raw === "object" ? raw : {};
  const list = Array.isArray(base.members) ? base.members : Array.isArray(base.items) ? base.items : [];
  return {
    sites: base.sites || {},
    agt: base.agt || {},
    members: list
      .map((row) => {
        if (!row || typeof row !== "object") return null;
        const id = String(row.id || "").trim();
        const name = String(row.name || "").trim();
        if (!id || !name) return null;
        return {
          id,
          name,
          nameEn: row.nameEn ? String(row.nameEn) : undefined,
          brief: row.brief ? String(row.brief) : "",
          briefEn: row.briefEn ? String(row.briefEn) : undefined,
          kind: row.kind === "thin" ? "thin" : "advanced",
          shape: row.shape || "blob",
          color: row.color || "mist",
          filename: row.filename ? String(row.filename) : "",
          downloadUrl: row.downloadUrl ? String(row.downloadUrl) : "",
          sizeBytes: Number(row.sizeBytes) || 0,
          skills: Array.isArray(row.skills) ? row.skills.map(String) : [],
        };
      })
      .filter(Boolean),
  };
}

async function loadLiveCatalog(staticCatalog) {
  const origin = String(staticCatalog.agt?.origin || "").replace(/\/+$/, "");
  const listPath = String(
    staticCatalog.agt?.list || "/api/harness/operators",
  );
  if (!origin) return staticCatalog;
  try {
    const res = await fetch(
      `${origin}${listPath.startsWith("/") ? listPath : `/${listPath}`}`,
      { headers: { Accept: "application/json" } },
    );
    if (!res.ok) throw new Error("live");
    const json = await res.json();
    const data = json && json.data !== undefined ? json.data : json;
    const live = normalizeCatalog({
      ...data,
      // Live AGT may omit sites; keep Pages cross-link defaults.
      sites: { ...staticCatalog.sites, ...(data?.sites || {}) },
      agt: staticCatalog.agt,
    });
    return {
      sites: { ...staticCatalog.sites, ...live.sites },
      agt: staticCatalog.agt,
      members: live.members.length ? live.members : staticCatalog.members,
    };
  } catch {
    return staticCatalog;
  }
}

async function boot() {
  locale = detectLocale();
  applyI18n();
  applyTheme(preference());

  document.querySelectorAll("[data-theme-id]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.themeId || "system";
      try {
        localStorage.setItem(THEME_KEY, id);
      } catch {
        /* ignore */
      }
      applyTheme(id);
    });
  });

  const filter = document.getElementById("filter");
  if (filter) {
    filter.addEventListener("input", () => renderList(filter.value));
  }

  let staticCatalog = { sites: {}, agt: {}, members: [] };
  try {
    const res = await fetch("/catalog.json", { headers: { Accept: "application/json" } });
    if (res.ok) staticCatalog = normalizeCatalog(await res.json());
  } catch {
    /* keep empty */
  }
  catalog = await loadLiveCatalog(staticCatalog);
  members = catalog.members;
  wireDownloadLinks();
  renderConstellation();
  renderList(filter?.value || "");
}

boot();
