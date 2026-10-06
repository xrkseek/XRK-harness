const THEME_KEY = "xrk-site-theme";

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

function applyTheme(pref) {
  const mode = resolved(pref);
  document.documentElement.dataset.theme = mode;
  document.body.toggleAttribute("data-ds-dark-theme", mode === "dark");
  document.querySelectorAll("[data-theme-id]").forEach((btn) => {
    btn.setAttribute("aria-pressed", btn.dataset.themeId === pref ? "true" : "false");
  });
}

function showRail(id) {
  document.querySelectorAll("[data-rail]").forEach((btn) => {
    btn.className = btn.dataset.rail === id ? "segOn" : "segOff";
  });
  document.querySelectorAll("[data-rail-panel]").forEach((panel) => {
    panel.hidden = panel.dataset.railPanel !== id;
  });
}

function showOverview(id) {
  document.querySelectorAll("[data-ov-tab]").forEach((btn) => {
    btn.className = btn.dataset.ovTab === id ? "segOn" : "segOff";
  });
  document.querySelectorAll("[data-ov-panel]").forEach((panel) => {
    panel.hidden = panel.dataset.ovPanel !== id;
  });
}

function showSession(id) {
  const row = document.querySelector(`[data-session="${id}"]`);
  document.querySelectorAll("[data-session]").forEach((btn) => {
    btn.classList.toggle("sessOn", btn === row);
    btn.setAttribute("aria-pressed", btn === row ? "true" : "false");
  });
  document.querySelectorAll("[data-thread]").forEach((panel) => {
    panel.hidden = panel.dataset.thread !== id;
  });
  const title = document.getElementById("thread-title");
  const tag = document.getElementById("thread-tag");
  if (row && title) title.textContent = row.querySelector("strong")?.textContent || "";
  if (row && tag) tag.textContent = row.querySelector(".seed")?.textContent?.split("·")[0]?.trim() || "";
}

function selectMember(id) {
  const card = document.querySelector(`[data-member="${id}"]`);
  if (!card) return;
  document.querySelectorAll("[data-member]").forEach((btn) => {
    btn.setAttribute("aria-pressed", btn === card ? "true" : "false");
  });
  const who = document.getElementById("member-who");
  const brief = document.getElementById("member-brief");
  const ov = document.getElementById("ov-member");
  if (who) who.textContent = card.dataset.name || "";
  if (brief) brief.textContent = card.dataset.brief || "";
  if (ov) ov.textContent = card.dataset.name || "";
}

document.querySelectorAll("[data-rail]").forEach((btn) => {
  btn.addEventListener("click", () => showRail(btn.dataset.rail || "sessions"));
});
document.querySelectorAll("[data-session]").forEach((btn) => {
  btn.addEventListener("click", () => showSession(btn.dataset.session || "trunk"));
});
document.querySelectorAll("[data-ov-tab]").forEach((btn) => {
  btn.addEventListener("click", () => showOverview(btn.dataset.ovTab || "status"));
});

const delegateBtn = document.getElementById("delegate-btn");
if (delegateBtn) {
  delegateBtn.addEventListener("click", () => {
    const card = document.querySelector("[data-member][aria-pressed='true']");
    const extra = document.getElementById("task-extra");
    const name = document.getElementById("task-extra-name");
    const brief = document.getElementById("task-extra-brief");
    if (card && extra && name && brief) {
      name.textContent = card.dataset.name || "";
      brief.textContent = card.dataset.brief || "";
      extra.hidden = false;
    }
    showOverview("tasks");
    showRail("team");
  });
}

document.querySelectorAll("[data-theme-id]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const id = btn.dataset.themeId || "system";
    try {
      localStorage.setItem(THEME_KEY, id);
    } catch {
      /* private mode */
    }
    applyTheme(id);
  });
});

document.querySelectorAll("[data-member]").forEach((btn) => {
  btn.addEventListener("click", () => {
    selectMember(btn.dataset.member || "");
  });
});

const copyBtn = document.getElementById("copy-cli");
const cli = document.getElementById("cli-text");
if (copyBtn && cli) {
  copyBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(cli.textContent || "");
        copyBtn.textContent = copyBtn.dataset.copied || "Copied";
        copyBtn.setAttribute("aria-live", "polite");
      window.setTimeout(() => {
        copyBtn.textContent = copyBtn.dataset.copy || "Copy";
      }, 1200);
    } catch {
      /* ignore */
    }
  });
}

const composer = document.getElementById("composer");
if (composer) {
  composer.addEventListener("submit", (event) => event.preventDefault());
  composer.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) event.preventDefault();
  });
}

applyTheme(preference());
window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
  if (preference() === "system") applyTheme("system");
});

const first = document.querySelector("[data-member]");
if (first) selectMember(first.dataset.member || "");
