/**
 * Lossy HTML → interactive element refs for browser_snapshot / browser_act.
 * Not a full a11y tree — enough for Hermes-style @eN refs without CDP.
 */

export interface BrowserElement {
  readonly ref: string;
  readonly role: string;
  readonly name: string;
  readonly tag: string;
  readonly href?: string;
  readonly inputType?: string;
  readonly value?: string;
}

const TAG_RE =
  /<(a|button|input|textarea|select)\b([^>]*)>(?:([\s\S]*?)<\/\1>)?/gi;

function attr(attrs: string, name: string): string | undefined {
  const re = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i");
  const m = re.exec(attrs);
  return m?.[1] ?? m?.[2] ?? m?.[3];
}

function decodeLite(text: string): string {
  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#(\d+);/g, (_, n) => {
      const code = Number(n);
      return Number.isFinite(code) ? String.fromCodePoint(code) : "";
    })
    .replace(/\s+/g, " ")
    .trim();
}

function roleFor(tag: string, inputType: string | undefined): string {
  if (tag === "a") return "link";
  if (tag === "button") return "button";
  if (tag === "textarea") return "textbox";
  if (tag === "select") return "combobox";
  if (tag === "input") {
    if (inputType === "submit" || inputType === "button") return "button";
    if (inputType === "checkbox") return "checkbox";
    if (inputType === "radio") return "radio";
    if (inputType === "hidden") return "none";
    return "textbox";
  }
  return tag;
}

/** Extract clickable / fillable elements with stable @eN refs. */
export function extractBrowserElements(html: string): BrowserElement[] {
  const out: BrowserElement[] = [];
  let index = 0;
  TAG_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TAG_RE.exec(html)) !== null) {
    const tag = match[1]!.toLowerCase();
    const attrs = match[2] ?? "";
    const inner = match[3] ?? "";
    const inputType = (attr(attrs, "type") ?? "text").toLowerCase();
    const role = roleFor(tag, inputType);
    if (role === "none") continue;
    const name =
      decodeLite(
        attr(attrs, "aria-label") ??
          attr(attrs, "name") ??
          attr(attrs, "placeholder") ??
          attr(attrs, "value") ??
          attr(attrs, "title") ??
          inner.replace(/<[^>]+>/g, " "),
      ) || tag;
    const href = attr(attrs, "href");
    index += 1;
    out.push({
      ref: `e${index}`,
      role,
      name: name.slice(0, 120),
      tag,
      ...(href !== undefined ? { href } : {}),
      ...(tag === "input" ? { inputType } : {}),
      ...(attr(attrs, "value") !== undefined
        ? { value: decodeLite(attr(attrs, "value")!) }
        : {}),
    });
    if (out.length >= 200) break;
  }
  return out;
}

export function formatBrowserSnapshot(options: {
  readonly url: string;
  readonly title: string;
  readonly elements: readonly BrowserElement[];
  readonly fieldValues: ReadonlyMap<string, string>;
  readonly full?: boolean;
  readonly pageText?: string;
  readonly maxChars?: number;
}): string {
  const maxChars = options.maxChars ?? 15_000;
  const lines: string[] = [
    `url: ${options.url}`,
    `title: ${options.title || "(untitled)"}`,
    "elements:",
  ];
  for (const el of options.elements) {
    const typed = options.fieldValues.get(el.ref);
    const value =
      typed !== undefined
        ? ` value=${JSON.stringify(typed)}`
        : el.value
          ? ` value=${JSON.stringify(el.value)}`
          : "";
    const href = el.href ? ` href=${JSON.stringify(el.href)}` : "";
    lines.push(`  @${el.ref} [${el.role}] ${el.name}${href}${value}`);
  }
  if (options.full && options.pageText) {
    lines.push("text:");
    lines.push(options.pageText);
  }
  let text = lines.join("\n");
  if (text.length > maxChars) {
    text =
      text.slice(0, maxChars) +
      `\n… truncated (${text.length} chars). Pass full=false or act then snapshot again.`;
  }
  return text;
}

export function titleFromHtml(html: string): string {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return m ? decodeLite(m[1] ?? "") : "";
}
