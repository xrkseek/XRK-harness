const THEME_KEY = "xrk-site-theme";
const PALETTES = {
  mist: { light: { body: "#D4E0EC", eyes: "#1A1A1A" }, dark: { body: "#9AABB8", eyes: "#1A1A1A" } },
  sage: { light: { body: "#D4E5C8", eyes: "#1A1A1A" }, dark: { body: "#96B088", eyes: "#1A1A1A" } },
  lilac: { light: { body: "#E5D4E8", eyes: "#1A1A1A" }, dark: { body: "#B098B8", eyes: "#1A1A1A" } },
  slate: { light: { body: "#C8CDD4", eyes: "#1A1A1A" }, dark: { body: "#5A6068", eyes: "#F0EEE8" } },
  peach: { light: { body: "#F0D8C8", eyes: "#1A1A1A" }, dark: { body: "#C4A090", eyes: "#1A1A1A" } },
  butter: { light: { body: "#F2E4B0", eyes: "#1A1A1A" }, dark: { body: "#C4B070", eyes: "#1A1A1A" } },
  coral: { light: { body: "#F0C8BC", eyes: "#1A1A1A" }, dark: { body: "#C48A7C", eyes: "#1A1A1A" } },
};

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

/** Keep lang + theme when hopping to the operators Pages site. */
function withChromeParams(href) {
  const u = new URL(href, location.href);
  const lang = new URLSearchParams(location.search).get("lang");
  if (lang === "en" || lang === "zh") u.searchParams.set("lang", lang);
  else if ((document.documentElement.lang || "").toLowerCase().startsWith("zh")) u.searchParams.delete("lang");
  else u.searchParams.set("lang", "en");
  u.searchParams.set("theme", preference());
  return u.toString();
}

function wireSiblingLinks() {
  document.querySelectorAll("[data-operators-link]").forEach((a) => {
    const base = a.getAttribute("href");
    if (!base) return;
    a.href = withChromeParams(base);
  });
}

function wireNavMenu() {
  const top = document.querySelector(".top");
  const btn = document.querySelector("[data-nav-menu]");
  if (!top || !btn) return;
  const openLabel = btn.getAttribute("aria-label") || "Menu";
  const closeLabel = document.documentElement.lang?.startsWith("zh") ? "关闭" : "Close";
  const setOpen = (open) => {
    top.dataset.navOpen = open ? "true" : "false";
    btn.setAttribute("aria-expanded", open ? "true" : "false");
    btn.setAttribute("aria-label", open ? closeLabel : openLabel);
  };
  btn.addEventListener("click", () => {
    setOpen(top.dataset.navOpen !== "true");
  });
  document.querySelectorAll(".nav a, .nav .theme").forEach((el) => {
    el.addEventListener("click", () => {
      if (window.matchMedia("(max-width: 860px)").matches) setOpen(false);
    });
  });
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

function isPhoneLayout() {
  return window.matchMedia("(max-width: 860px)").matches;
}

let ballScriptsPromise = null;

function loadBallScripts() {
  if (window.EmotionBall && window.EmotionBall.create) return Promise.resolve();
  if (ballScriptsPromise) return ballScriptsPromise;
  const files = [
    "/presence/emotion-ball/rings.js",
    "/presence/emotion-ball/emotions.js",
    "/presence/emotion-ball/ball.js",
    "/presence/emotion-ball/engine.js",
  ];
  ballScriptsPromise = files.reduce(
    (chain, src) =>
      chain.then(
        () =>
          new Promise((resolve, reject) => {
            const s = document.createElement("script");
            s.src = src;
            s.async = false;
            s.onload = () => resolve();
            s.onerror = () => reject(new Error(src));
            document.head.appendChild(s);
          }),
      ),
    Promise.resolve(),
  );
  return ballScriptsPromise.catch(() => {
    ballScriptsPromise = null;
  });
}

async function mountBalls() {
  // Phone: download presence balls only (hero/rail/orbit stay CSS-hidden).
  // Desktop: mount every data-ball.
  const phone = isPhoneLayout();
  const nodes = phone
    ? document.querySelectorAll("#download [data-ball]")
    : document.querySelectorAll("[data-ball]");
  if (!nodes.length) return;
  await loadBallScripts();
  const create = window.EmotionBall && window.EmotionBall.create;
  if (!create) return;
  nodes.forEach((el) => {
    if (el._ball && el._ball.destroy) el._ball.destroy();
    el.replaceChildren();
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

function applyTheme(pref) {
  const mode = resolved(pref);
  document.documentElement.dataset.theme = mode;
  document.body.toggleAttribute("data-ds-dark-theme", mode === "dark");
  document.querySelectorAll("[data-theme-id]").forEach((btn) => {
    btn.setAttribute("aria-pressed", btn.dataset.themeId === pref ? "true" : "false");
  });
  void mountBalls();
}

function selectMember(id) {
  const card = document.querySelector(`.roster .ball[data-member="${id}"]`);
  if (!card) return;
  document.querySelectorAll(".roster .ball").forEach((btn) => {
    btn.setAttribute("aria-pressed", btn === card ? "true" : "false");
  });
  const name = document.getElementById("pick-name");
  const brief = document.getElementById("pick-brief");
  const ov = document.getElementById("ov-member");
  const graph = document.getElementById("graph-child");
  const taskName = document.getElementById("task-name");
  const taskBrief = document.getElementById("task-brief");
  if (name) name.textContent = card.dataset.name || "";
  if (brief) brief.textContent = card.dataset.brief || "";
  if (ov) ov.textContent = card.dataset.name || "";
  if (graph) graph.textContent = `${document.getElementById("desk")?.dataset.assigned || ""} · ${card.dataset.name || ""}`;
  if (taskName) taskName.textContent = card.dataset.name || "";
  if (taskBrief) taskBrief.textContent = card.dataset.brief || "";
}

function bubble(text, badge, kind) {
  const row = kind === "asst" ? "asstRow" : "userRow";
  const mark = badge ? `<span class="badge">${badge}</span>` : "";
  return `<div class="${row}"><div class="bubble"><p>${text}</p></div>${mark}</div>`;
}

const SEND_ICON = '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M8.3125 0.980183C8.66767 1.0531 8.97902 1.20418 9.2627 1.43233C9.48724 1.61297 9.73029 1.85793 9.97949 2.10714L14.707 6.83468L13.293 8.24874L9 3.95577V15.0417H7V3.95577L2.70703 8.24874L1.29297 6.83468L6.02051 2.10714C6.26971 1.85793 6.51277 1.61297 6.7373 1.43233C6.97662 1.23986 7.28445 1.04402 7.6875 0.980183C7.8973 0.947006 8.1031 0.95516 8.3125 0.980183Z"/></svg>';
const STOP_ICON = '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><rect x="3" y="3" width="10" height="10" rx="3" fill="currentColor"/></svg>';

function paintPrimary(sendBtn, label, mode) {
  sendBtn.setAttribute("aria-label", label);
  sendBtn.classList.toggle("is-idle", mode === "idle");
  sendBtn.innerHTML = mode === "stop" ? STOP_ICON : SEND_ICON;
}

function setBusy(on, labels) {
  const sendBtn = document.getElementById("send-btn");
  const draft = document.getElementById("draft");
  if (!sendBtn || !labels) return;
  paintPrimary(sendBtn, on ? labels.stop : labels.send, on ? "stop" : "idle");
  if (draft) draft.placeholder = on ? labels.phBusy : labels.ph;
}

function showOv(id) {
  document.querySelectorAll("[data-ov]").forEach((btn) => {
    btn.classList.toggle("on", btn.dataset.ov === id);
  });
  document.querySelectorAll("[data-ov-panel]").forEach((panel) => {
    panel.hidden = panel.dataset.ovPanel !== id;
  });
}

function showScene(i) {
  document.querySelectorAll("[data-scene]").forEach((el) => {
    const on = Number(el.dataset.scene) === i;
    el.classList.toggle("on", on);
    el.hidden = !on;
  });
  document.querySelectorAll("[data-scene-dot]").forEach((el) => {
    el.classList.toggle("on", Number(el.dataset.sceneDot) === i);
  });
}

function runDesk() {
  const desk = document.getElementById("desk");
  const thread = document.getElementById("thread");
  const qdock = document.getElementById("qdock");
  const qbadge = document.getElementById("qbadge");
  const sendBtn = document.getElementById("send-btn");
  const draft = document.getElementById("draft");
  const title = document.getElementById("thread-title");
  const tag = document.getElementById("thread-tag");
  if (!desk || !thread || !sendBtn || !draft) return;
  const d = desk.dataset;
  const labels = { send: d.send, queue: d.queue, ph: d.ph, phBusy: d.phBusy, stop: d.stop };
  let timer = 0;
  let beat = 0;

  function pickTitle() {
    const on = document.querySelector("[data-session].on");
    if (title && on) title.textContent = on.querySelector("strong")?.textContent || "";
    if (tag && on) tag.textContent = on.querySelector("span")?.textContent || "";
  }

  const frames = [
    () => {
      thread.innerHTML = bubble(d.opener);
      if (qdock) qdock.hidden = true;
      setBusy(false, labels);
      showOv("status");
      pickTitle();
      showScene(0);
    },
    () => {
      thread.innerHTML = bubble(d.opener, d.sending);
      setBusy(false, labels);
      showScene(0);
    },
    () => {
      thread.innerHTML =
        bubble(d.opener) +
        `<p class="wait" role="status">${d.waiting}</p>` +
        `<div class="tool"><p>${d.tool}</p></div>`;
      setBusy(true, labels);
      showOv("status");
      showScene(1);
    },
    () => {
      if (qdock) qdock.hidden = false;
      if (qbadge) qbadge.textContent = d.sending;
      setBusy(true, labels);
      showScene(1);
    },
    () => {
      if (qbadge) qbadge.textContent = d.steer;
      thread.innerHTML =
        bubble(d.opener) +
        `<p class="wait" role="status">${d.waiting}</p>` +
        bubble(d.steerMsg, d.steering) +
        `<button type="button" class="ghost" disabled>${d.withdraw}</button>`;
      paintPrimary(sendBtn, d.steer, "armed");
      showOv("graph");
      showScene(2);
    },
    () => {
      if (qdock) qdock.hidden = true;
      thread.innerHTML =
        bubble(d.opener) +
        `<div class="tool"><p>${d.tool}</p></div>` +
        bubble(d.steerMsg) +
        bubble(d.queued) +
        bubble(d.reply, "", "asst");
      setBusy(false, labels);
      showOv("tasks");
      showScene(3);
    },
    () => {
      document.querySelector('[data-session="branch"]')?.classList.add("on");
      document.querySelector('[data-session="trunk"]')?.classList.remove("on");
      pickTitle();
      showScene(4);
    },
    () => {
      document.querySelector('[data-session="trunk"]')?.classList.add("on");
      document.querySelector('[data-session="branch"]')?.classList.remove("on");
      pickTitle();
      showScene(0);
    },
  ];

  function tick() {
    frames[beat]();
    beat = (beat + 1) % frames.length;
    timer = window.setTimeout(tick, beat === 1 ? 900 : 2600);
  }

  document.querySelectorAll("[data-scene-dot]").forEach((btn) => {
    btn.addEventListener("click", () => {
      beat = Number(btn.dataset.sceneDot) || 0;
      frames[Math.min(beat, frames.length - 1)]();
    });
  });
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    frames[4]();
    return;
  }
  tick();
  return () => window.clearTimeout(timer);
}

function applyGaze(clientX, clientY) {
  document.querySelectorAll(".hero-ball .stage").forEach((stage) => {
    const ball = stage.querySelector("[data-ball]")?._ball;
    if (!ball || !ball.setGaze) return;
    const rect = stage.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const nx = (clientX - (rect.left + rect.width / 2)) / (rect.width / 2);
    const ny = (clientY - (rect.top + rect.height / 2)) / (rect.height / 2);
    ball.setGaze(Math.max(-1, Math.min(1, nx)), Math.max(-1, Math.min(1, ny)));
  });
}

/** Same click tour as Overview PresenceBall (`CLICK_IDS`). */
const CLICK_IDS = ["10", "13", "03", "33", "14", "11", "19", "07"];

function playBall(btn) {
  const mount = btn.querySelector("[data-ball]");
  const ball = mount && mount._ball;
  if (!ball) return;
  const i = Number(btn.dataset.clickIndex || 0);
  const id = CLICK_IDS[i % CLICK_IDS.length];
  btn.dataset.clickIndex = String(i + 1);
  if (ball.setEmotion) ball.setEmotion(id);
  if (ball.bounce) ball.bounce();
  if (ball.resetIdle) ball.resetIdle();
}

function bindPlayBalls() {
  document.querySelectorAll("[data-play-ball]").forEach((btn) => {
    btn.addEventListener("click", () => playBall(btn));
  });
  window.addEventListener("pointermove", (event) => {
    applyGaze(event.clientX, event.clientY);
  }, { passive: true });
  window.addEventListener("blur", () => {
    document.querySelectorAll(".hero-ball [data-ball]").forEach((el) => {
      if (el._ball && el._ball.setGaze) el._ball.setGaze(0, 0);
    });
  });
}

document.querySelectorAll("[data-theme-id]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const id = btn.dataset.themeId || "system";
    try { localStorage.setItem(THEME_KEY, id); } catch { /* private */ }
    applyTheme(id);
    wireSiblingLinks();
  });
});
wireSiblingLinks();
wireNavMenu();

document.querySelectorAll(".roster .ball").forEach((btn) => {
  btn.addEventListener("click", () => selectMember(btn.dataset.member || ""));
});

document.querySelectorAll("[data-ov]").forEach((btn) => {
  btn.addEventListener("click", () => showOv(btn.dataset.ov || "status"));
});

const delegateBtn = document.getElementById("delegate-btn");
if (delegateBtn) {
  delegateBtn.addEventListener("click", () => {
    const card = document.querySelector(".roster .ball[aria-pressed='true']");
    const thread = document.getElementById("thread");
    const desk = document.getElementById("desk");
    if (!card || !thread || !desk) return;
    thread.insertAdjacentHTML(
      "beforeend",
      bubble(`${desk.dataset.assigned} · ${card.dataset.brief || ""}`, "", "asst"),
    );
    showOv("tasks");
  });
}

const copyBtn = document.getElementById("copy-cli");
const cli = document.getElementById("cli-text");
if (copyBtn && cli) {
  copyBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(cli.textContent || "");
      copyBtn.textContent = copyBtn.dataset.copied || "Copied";
      copyBtn.setAttribute("aria-live", "polite");
      window.setTimeout(() => { copyBtn.textContent = copyBtn.dataset.copy || "Copy"; }, 1200);
    } catch { /* ignore */ }
  });
}

const composer = document.getElementById("composer");
if (composer) {
  composer.addEventListener("submit", (event) => event.preventDefault());
}

applyTheme(preference());
window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
  if (preference() === "system") applyTheme("system");
});
const first = document.querySelector(".roster .ball");
if (first) selectMember(first.dataset.member || "");
function startUi() {
  void mountBalls();
  // Phone still needs click/bounce on #download presence balls.
  bindPlayBalls();
  runDesk();
}
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", startUi);
} else {
  startUi();
}
