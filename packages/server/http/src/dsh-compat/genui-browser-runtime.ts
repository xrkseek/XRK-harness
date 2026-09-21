/**
 * GenUI browser ESM served at `/dsh-genui/runtime.js`.
 * Self-contained (no npm deps): mount schema → DOM, custom element, optional Host fetch.
 * Not Vue/OpenTiny CE — XRK Host-owned DOM runtime for community client dynamic import.
 */

/** Pure schema → HTML (mirrors host-feature-bridge preview renderer). */
export function renderGenuiSchemaToHtml(schema: unknown): string {
  const escapeHtml = (text: string): string =>
    text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  const renderNode = (node: unknown): string => {
    if (node === null || node === undefined) return "";
    if (
      typeof node === "string" ||
      typeof node === "number" ||
      typeof node === "boolean"
    ) {
      return `<span>${escapeHtml(String(node))}</span>`;
    }
    if (Array.isArray(node)) {
      return node.map((item) => renderNode(item)).join("");
    }
    if (typeof node !== "object") return "";
    const row = node as Record<string, unknown>;
    const type = String(row.type ?? "box").toLowerCase();
    const children = Array.isArray(row.children)
      ? row.children.map((c) => renderNode(c)).join("")
      : row.body
        ? renderNode(row.body)
        : row.value != null
          ? escapeHtml(String(row.value))
          : "";
    const title =
      typeof row.title === "string"
        ? `<header>${escapeHtml(row.title)}</header>`
        : typeof row.label === "string"
          ? `<header>${escapeHtml(row.label)}</header>`
          : "";
    switch (type) {
      case "text":
      case "paragraph":
        return `<p data-genui="${type}">${children || escapeHtml(String(row.value ?? ""))}</p>`;
      case "button":
        return `<button type="button" data-genui="button">${children || escapeHtml(String(row.label ?? "Action"))}</button>`;
      case "card":
      case "panel":
        return `<section data-genui="${type}">${title}${children}</section>`;
      case "row":
      case "column":
      case "stack":
        return `<div data-genui="${type}" style="display:flex;flex-direction:${type === "column" ? "column" : "row"};gap:8px">${children}</div>`;
      case "npm":
        return `<div data-genui="npm" data-package="${escapeHtml(String(row.package ?? ""))}">${title}${children || escapeHtml(String(row.export ?? row.exportName ?? "npm"))}</div>`;
      default:
        return `<div data-genui="${escapeHtml(type)}">${title}${children}</div>`;
    }
  };

  return `<div data-xrk-genui-preview="1" data-xrk-genui-runtime="1">${renderNode(schema)}</div>`;
}

/**
 * Browser ESM source. Keep in sync with {@link renderGenuiSchemaToHtml}.
 * Served verbatim; must not import Node modules.
 */
export const GENUI_BROWSER_RUNTIME_JS = `/* xrk-dsh-compat: GenUI browser runtime (DOM schema mount; Host-owned, not Vue/OpenTiny). */
const VERSION = "0.1.0";

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderNode(node) {
  if (node === null || node === undefined) return "";
  if (typeof node === "string" || typeof node === "number" || typeof node === "boolean") {
    return "<span>" + escapeHtml(String(node)) + "</span>";
  }
  if (Array.isArray(node)) {
    return node.map(renderNode).join("");
  }
  if (typeof node !== "object") return "";
  const row = node;
  const type = String(row.type ?? "box").toLowerCase();
  const children = Array.isArray(row.children)
    ? row.children.map(renderNode).join("")
    : row.body
      ? renderNode(row.body)
      : row.value != null
        ? escapeHtml(String(row.value))
        : "";
  const title =
    typeof row.title === "string"
      ? "<header>" + escapeHtml(row.title) + "</header>"
      : typeof row.label === "string"
        ? "<header>" + escapeHtml(row.label) + "</header>"
        : "";
  switch (type) {
    case "text":
    case "paragraph":
      return "<p data-genui=\\"" + type + "\\">" + (children || escapeHtml(String(row.value ?? ""))) + "</p>";
    case "button":
      return "<button type=\\"button\\" data-genui=\\"button\\">" + (children || escapeHtml(String(row.label ?? "Action"))) + "</button>";
    case "card":
    case "panel":
      return "<section data-genui=\\"" + type + "\\">" + title + children + "</section>";
    case "row":
    case "column":
    case "stack":
      return "<div data-genui=\\"" + type + "\\" style=\\"display:flex;flex-direction:" + (type === "column" ? "column" : "row") + ";gap:8px\\">" + children + "</div>";
    case "npm":
      return "<div data-genui=\\"npm\\" data-package=\\"" + escapeHtml(String(row.package ?? "")) + "\\">" + title + (children || escapeHtml(String(row.export ?? row.exportName ?? "npm"))) + "</div>";
    default:
      return "<div data-genui=\\"" + escapeHtml(type) + "\\">" + title + children + "</div>";
  }
}

export function render(schema) {
  return "<div data-xrk-genui-preview=\\"1\\" data-xrk-genui-runtime=\\"1\\">" + renderNode(schema) + "</div>";
}

const mounts = new WeakMap();

function resolveTarget(target) {
  if (typeof target === "string") {
    const el = document.querySelector(target);
    if (!el) throw new Error("genui mount: selector matched nothing: " + target);
    return el;
  }
  if (target && typeof target === "object" && target.nodeType === 1) return target;
  throw new Error("genui mount: target must be Element or CSS selector");
}

export function mount(target, input, options) {
  const el = resolveTarget(target);
  const opts = options && typeof options === "object" ? options : {};
  let schema = null;
  let designId = null;
  if (input && typeof input === "object" && !Array.isArray(input)) {
    if (input.schema && typeof input.schema === "object") schema = input.schema;
    else if (input.type || input.children || input.body) schema = input;
    if (typeof input.designId === "string") designId = input.designId;
    if (typeof input.design_id === "string") designId = input.design_id;
  }
  if (typeof input === "string") designId = input;

  const apply = (tree) => {
    el.innerHTML = render(tree ?? {});
    mounts.set(el, { schema: tree ?? {}, designId });
    if (typeof opts.onMount === "function") opts.onMount(el, tree);
    return el;
  };

  if (schema) return Promise.resolve(apply(schema));

  if (designId) {
    const base = typeof opts.baseUrl === "string" ? opts.baseUrl.replace(/\\/+$/, "") : "";
    const url = base + "/preview/" + encodeURIComponent(designId);
    return fetch(url, { method: "GET", credentials: "same-origin" })
      .then((res) => {
        if (!res.ok) throw new Error("genui mount: preview HTTP " + res.status);
        return res.json();
      })
      .then((body) => {
        const tree =
          body && typeof body === "object"
            ? body.schema || (body.design && body.design.schema) || {}
            : {};
        return apply(tree);
      });
  }

  return Promise.resolve(apply({}));
}

export function unmount(target) {
  const el = resolveTarget(target);
  el.innerHTML = "";
  mounts.delete(el);
}

export function getMounted(target) {
  try {
    return mounts.get(resolveTarget(target)) || null;
  } catch {
    return null;
  }
}

class DshGenuiElement extends HTMLElement {
  static get observedAttributes() {
    return ["design-id", "schema"];
  }
  connectedCallback() {
    this.#refresh();
  }
  attributeChangedCallback() {
    if (this.isConnected) this.#refresh();
  }
  #refresh() {
    const designId = this.getAttribute("design-id");
    const raw = this.getAttribute("schema");
    let schema = null;
    if (raw) {
      try {
        schema = JSON.parse(raw);
      } catch {
        this.innerHTML = "<pre data-genui=\\"error\\">invalid schema JSON</pre>";
        return;
      }
    }
    mount(this, schema ? { schema } : designId ? { designId } : {}).catch((err) => {
      this.innerHTML = "<pre data-genui=\\"error\\">" + escapeHtml(String(err && err.message ? err.message : err)) + "</pre>";
    });
  }
}

let defined = false;
export function defineCustomElements() {
  if (defined) return;
  if (typeof customElements === "undefined") return;
  if (!customElements.get("dsh-genui")) {
    customElements.define("dsh-genui", DshGenuiElement);
  }
  if (!customElements.get("xrk-genui")) {
    customElements.define("xrk-genui", class extends DshGenuiElement {});
  }
  defined = true;
}

export const version = VERSION;
export const adapter = "xrk-dsh-compat";

if (typeof globalThis !== "undefined") {
  globalThis.__xrkGenuiRuntime__ = {
    version: VERSION,
    adapter: "xrk-dsh-compat",
    mount,
    unmount,
    render,
    defineCustomElements,
    getMounted,
  };
}

try {
  defineCustomElements();
} catch (_) {
  /* non-DOM environments */
}
`;
