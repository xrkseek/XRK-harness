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

function resolved(pref) {
  if (pref === "dark") return "dark";
  if (pref === "light") return "light";
  return systemDark() ? "dark" : "light";
}

function paint(color) {
  const pal = PALETTES[color] || PALETTES.mist;
  return document.documentElement.dataset.theme === "dark" ? pal.dark : pal.light;
}

function mountBalls() {
  const create = window.EmotionBall && window.EmotionBall.create;
  document.querySelectorAll("[data-ball]").forEach((el) => {
    if (el._ball && el._ball.destroy) el._ball.destroy();
    el.replaceChildren();
    if (!create) return;
    const tone = paint(el.dataset.color);
    el._ball = create(el, {
      emotion: "02",
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
  mountBalls();
}

function selectMember(id) {
  const card = document.querySelector(`[data-member="${id}"]`);
  if (!card) return;
  document.querySelectorAll("[data-member]").forEach((btn) => {
    btn.setAttribute("aria-pressed", btn === card ? "true" : "false");
  });
  const name = document.getElementById("pick-name");
  const brief = document.getElementById("pick-brief");
  if (name) name.textContent = card.dataset.name || "";
  if (brief) brief.textContent = card.dataset.brief || "";
}

function bubble(who, text, badge) {
  const mark = badge ? `<span class="badge">${badge}</span>` : "";
  return `<div class="bubble"><span class="who">${who}</span><p>${text}</p>${mark}</div>`;
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
  if (!desk || !thread || !sendBtn || !draft) return;
  const d = desk.dataset;
  const you = d.you || "";
  let timer = 0;
  let paused = false;
  let beat = 0;

  const frames = [
    () => {
      thread.innerHTML = bubble(you, d.opener);
      qdock.hidden = true;
      sendBtn.textContent = d.send;
      sendBtn.setAttribute("aria-label", d.send);
      draft.placeholder = d.ph;
      showScene(0);
    },
    () => {
      thread.innerHTML = bubble(you, d.opener, d.sending);
      sendBtn.textContent = d.send;
      showScene(0);
    },
    () => {
      thread.innerHTML =
        bubble(you, d.opener) +
        `<p class="wait" role="status">${d.waiting}</p>` +
        `<div class="tool"><p>${d.tool}</p></div>`;
      sendBtn.textContent = d.queue;
      sendBtn.setAttribute("aria-label", d.queue);
      draft.placeholder = d.phBusy;
      showScene(1);
    },
    () => {
      qdock.hidden = false;
      qbadge.textContent = d.sending;
      sendBtn.textContent = d.queue;
      showScene(1);
    },
    () => {
      qbadge.textContent = d.queue;
      thread.innerHTML =
        bubble(you, d.opener) +
        `<p class="wait" role="status">${d.waiting}</p>` +
        bubble(you, d.steerMsg, d.steering) +
        `<button type="button" class="ghost" disabled>${d.withdraw}</button>`;
      sendBtn.textContent = d.steer;
      sendBtn.setAttribute("aria-label", d.steer);
      showScene(2);
    },
    () => {
      qdock.hidden = true;
      thread.innerHTML =
        bubble(you, d.opener) +
        `<div class="tool"><p>${d.tool}</p></div>` +
        bubble(you, d.steerMsg) +
        bubble(you, d.queued) +
        `<div class="bubble"><span class="who">${document.getElementById("pick-name")?.textContent || ""}</span><p>${d.reply}</p></div>`;
      sendBtn.textContent = d.send;
      sendBtn.setAttribute("aria-label", d.send);
      draft.placeholder = d.ph;
      showScene(3);
    },
    () => {
      document.querySelector('[data-session="branch"]')?.classList.add("on");
      document.querySelector('[data-session="trunk"]')?.classList.remove("on");
      showScene(4);
    },
    () => {
      document.querySelector('[data-session="trunk"]')?.classList.add("on");
      document.querySelector('[data-session="branch"]')?.classList.remove("on");
      showScene(0);
    },
  ];

  function tick() {
    if (paused) {
      timer = window.setTimeout(tick, 400);
      return;
    }
    frames[beat]();
    beat = (beat + 1) % frames.length;
    timer = window.setTimeout(tick, beat === 1 ? 900 : 2600);
  }

  desk.addEventListener("pointerenter", () => { paused = true; });
  desk.addEventListener("pointerleave", () => { paused = false; });
  document.querySelectorAll("[data-scene-dot]").forEach((btn) => {
    btn.addEventListener("click", () => {
      beat = Number(btn.dataset.sceneDot) || 0;
      frames[Math.min(beat, frames.length - 1)]();
    });
  });
  document.querySelectorAll("[data-session]").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("[data-session]").forEach((el) => {
        el.classList.toggle("on", el === btn);
        el.setAttribute("aria-pressed", el === btn ? "true" : "false");
      });
    });
  });
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    frames[4]();
    return;
  }
  tick();
  return () => window.clearTimeout(timer);
}

document.querySelectorAll("[data-theme-id]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const id = btn.dataset.themeId || "system";
    try { localStorage.setItem(THEME_KEY, id); } catch { /* private */ }
    applyTheme(id);
  });
});

document.querySelectorAll("[data-member]").forEach((btn) => {
  btn.addEventListener("click", () => selectMember(btn.dataset.member || ""));
});

const delegateBtn = document.getElementById("delegate-btn");
if (delegateBtn) {
  delegateBtn.addEventListener("click", () => {
    const card = document.querySelector("[data-member][aria-pressed='true']");
    const thread = document.getElementById("thread");
    const desk = document.getElementById("desk");
    if (!card || !thread || !desk) return;
    thread.insertAdjacentHTML(
      "beforeend",
      bubble(card.dataset.name || "", `${desk.dataset.assigned} · ${card.dataset.brief || ""}`),
    );
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
const first = document.querySelector("[data-member]");
if (first) selectMember(first.dataset.member || "");
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => { mountBalls(); runDesk(); });
} else {
  mountBalls();
  runDesk();
}
