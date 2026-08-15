/**
 * Shared DOM helpers for Face console + AppShell panels.
 */

export function defaultBaseUrl(): string {
  if (typeof window === "undefined") return "http://127.0.0.1:8787";
  return window.location.origin;
}

export function el(tag: string, text = ""): HTMLElement {
  const n = document.createElement(tag);
  if (text) n.textContent = text;
  return n;
}

export function input(type: string, value: string): HTMLInputElement {
  const n = document.createElement("input");
  n.type = type;
  n.value = value;
  return n;
}

export function labeled(label: string, control: HTMLElement): HTMLElement {
  const wrap = document.createElement("label");
  wrap.style.display = "block";
  wrap.append(document.createTextNode(label + " "), control);
  return wrap;
}
