import type { ShellController } from "../../shell-controller.js";
import { el } from "../../dom.js";

/** Contribution: chrome.sidebar list id=settings */
export function mountSettingsPanel(
  host: HTMLElement,
  ctl: ShellController,
): () => void {
  host.className = "shell-panel shell-settings";

  const title = el("h2", "Settings");
  const meta = el("p", "");
  meta.className = "shell-ws-meta";

  const themeSelect = document.createElement("select");
  themeSelect.className = "shell-input";
  for (const t of ["system", "light", "dark"]) {
    const opt = document.createElement("option");
    opt.value = t;
    opt.textContent = t;
    themeSelect.append(opt);
  }

  const localeInput = document.createElement("input");
  localeInput.type = "text";
  localeInput.className = "shell-input";
  localeInput.placeholder = "locale";

  const saveUi = document.createElement("button");
  saveUi.type = "button";
  saveUi.textContent = "Save UI";
  saveUi.addEventListener("click", () => {
    void ctl.setUiSettings({
      theme: themeSelect.value,
      locale: localeInput.value.trim() || "en",
    });
  });

  const credTitle = el("h2", "Credentials");
  const credNote = el(
    "p",
    "Values never shown · vault is process memory only · not session-logged",
  );
  credNote.className = "shell-ws-meta";
  const credList = el("ul", "");
  credList.className = "shell-ws-entries";

  const keyInput = document.createElement("input");
  keyInput.type = "password";
  keyInput.className = "shell-input";
  keyInput.placeholder = "host.apiKey value";

  const btnRow = el("div", "");
  btnRow.className = "shell-btn-row";
  const setKey = document.createElement("button");
  setKey.type = "button";
  setKey.textContent = "Set host key";
  setKey.addEventListener("click", () => {
    void ctl.setCredential("host.apiKey", keyInput.value);
    keyInput.value = "";
  });
  const clearKey = document.createElement("button");
  clearKey.type = "button";
  clearKey.textContent = "Clear vault";
  clearKey.addEventListener("click", () => {
    void ctl.clearCredential("host.apiKey");
  });
  const refresh = document.createElement("button");
  refresh.type = "button";
  refresh.textContent = "Refresh";
  refresh.addEventListener("click", () => {
    void ctl.refreshSettings();
    void ctl.refreshCredentials();
  });
  btnRow.append(saveUi, setKey, clearKey, refresh);

  host.replaceChildren(
    title,
    meta,
    themeSelect,
    localeInput,
    credTitle,
    credNote,
    credList,
    keyInput,
    btnRow,
  );

  const render = (): void => {
    themeSelect.value = ctl.settings.theme;
    localeInput.value = ctl.settings.locale;
    meta.textContent = [
      `theme ${ctl.settings.theme}`,
      `locale ${ctl.settings.locale}`,
      ctl.settings.hostPreset
        ? `host ${ctl.settings.hostPreset}:${ctl.settings.hostPort ?? "?"}`
        : null,
    ]
      .filter(Boolean)
      .join(" · ");

    credList.replaceChildren();
    for (const s of ctl.credentials.slots.slice(0, 24)) {
      const li = document.createElement("li");
      li.textContent = `${s.id} · ${s.configured ? s.source : "none"}${
        s.envVar ? ` · ${s.envVar}` : ""
      }`;
      credList.append(li);
    }
    if (ctl.credentials.slots.length === 0) {
      const empty = document.createElement("li");
      empty.className = "muted";
      empty.textContent = "(refresh)";
      credList.append(empty);
    }
  };

  const unsub = ctl.subscribe(render);
  render();
  void ctl.refreshSettings();
  void ctl.refreshCredentials();

  return () => {
    unsub();
  };
}
