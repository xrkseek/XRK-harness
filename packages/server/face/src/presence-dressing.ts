/** Shared costume slots + sticker library for Settings and Agent Team. */

const OVERLAY_MAX = 80_000;
/** Canonical raster / SVG sticker data URLs (SVG-as-image; scripts do not run). */
const OVERLAY_RE = /^data:image\/(png|jpe?g|webp|gif|svg\+xml);base64,[A-Za-z0-9+/=]+$/i;
/** FileReader may emit charset before ;base64, or url-encoded SVG bodies. */
const SVG_BASE64_RE =
  /^data:image\/svg\+xml(?:;charset=[^;,\s]+)?;base64,([A-Za-z0-9+/=]+)$/i;
const SVG_XML_RE =
  /^data:image\/svg\+xml(?:;charset=[^;,\s]+)?,(?!;base64)([\s\S]+)$/i;

function textToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}

/**
 * Accept a transparent PNG/JPEG/WebP/GIF/SVG data URL overlay, or empty to clear.
 * Normalizes FileReader SVG forms (`charset=…`, url-encoded) to canonical base64.
 */
export function parseOverlayImage(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const face = raw.trim().replace(/\s+/g, "");
  if (!face) return "";
  if (face.length > OVERLAY_MAX) return undefined;
  if (OVERLAY_RE.test(face)) return face;

  const base64Svg = SVG_BASE64_RE.exec(face);
  if (base64Svg?.[1]) {
    const out = `data:image/svg+xml;base64,${base64Svg[1]}`;
    return out.length > OVERLAY_MAX ? undefined : out;
  }

  const encoded = SVG_XML_RE.exec(face);
  if (!encoded?.[1]) return undefined;
  try {
    const svgText = decodeURIComponent(encoded[1]);
    if (!/<svg[\s>/]/i.test(svgText)) return undefined;
    const out = `data:image/svg+xml;base64,${textToBase64(svgText)}`;
    return out.length > OVERLAY_MAX ? undefined : out;
  } catch {
    return undefined;
  }
}

export const STICKER_PREFIX = "sticker:";
export const PRESENCE_STICKERS_MAX = 24;
export const HAT_BUILTINS = ["none", "bow", "cap", "beanie", "visor", "halo"] as const;
export const GLASSES_BUILTINS = ["none", "specs", "specs-rect", "specs-cat", "specs-sun"] as const;
export const HELD_BUILTINS = ["none", "flower", "tea", "flag", "spark"] as const;

export type DressingSlot = "hat" | "glasses" | "held";

export type PresenceSticker = {
  readonly id: string;
  readonly image: string;
  readonly slot: DressingSlot;
};

const STICKER_ID_RE = /^stk_[a-zA-Z0-9]{6,24}$/;
const STICKER_PICK_RE = /^sticker:(stk_[a-zA-Z0-9]{6,24})$/;

function parseDressingSlot(raw: unknown): DressingSlot | undefined {
  return raw === "hat" || raw === "glasses" || raw === "held" ? raw : undefined;
}

export function splitLegacyKit(kit: string | undefined): { hat: string; glasses: string } {
  if (!kit || kit === "none") return { hat: "none", glasses: "none" };
  if (kit.startsWith("specs")) return { hat: "none", glasses: kit };
  return { hat: kit, glasses: "none" };
}

export function stickerIdFromPick(pick: string): string | undefined {
  const match = STICKER_PICK_RE.exec(pick);
  return match?.[1];
}

export function parseStickers(raw: unknown): PresenceSticker[] {
  if (Array.isArray(raw)) {
    return raw.flatMap((row) => {
      if (!row || typeof row !== "object" || Array.isArray(row)) return [];
      const id = typeof (row as { id?: unknown }).id === "string" ? (row as { id: string }).id : "";
      const image = parseOverlayImage((row as { image?: unknown }).image);
      const slot = parseDressingSlot((row as { slot?: unknown }).slot) ?? "hat";
      if (!STICKER_ID_RE.test(id) || !image) return [];
      return [{ id, image, slot }];
    }).slice(0, PRESENCE_STICKERS_MAX);
  }
  if (typeof raw !== "string" || !raw.trim()) return [];
  try {
    return parseStickers(JSON.parse(raw) as unknown);
  } catch {
    return [];
  }
}

export function parseSlotPick(raw: unknown, builtins: readonly string[]): string | undefined {
  if (typeof raw !== "string") return undefined;
  const pick = raw.trim();
  if (!pick || pick === "none") return "none";
  if (builtins.includes(pick)) return pick;
  if (stickerIdFromPick(pick)) return pick;
  return undefined;
}

export function resolveEnginePick(pick: string, builtins: readonly string[]): string {
  return builtins.includes(pick) && pick !== "none" ? pick : "none";
}

export function resolveStickerOverlay(
  pick: string,
  stickers: readonly PresenceSticker[],
): string | undefined {
  const id = stickerIdFromPick(pick);
  if (!id) return undefined;
  return stickers.find((row) => row.id === id)?.image;
}

export function dressingFromPresence(user: Record<string, unknown> | undefined): {
  readonly stickers: readonly PresenceSticker[];
  readonly kitHat: string;
  readonly kitGlasses: string;
  readonly kitHeld: string;
} {
  const stickers = parseStickers(user?.stickers);
  const legacy = splitLegacyKit(typeof user?.kit === "string" ? user.kit : undefined);
  return {
    stickers,
    kitHat: parseSlotPick(user?.kitHat, HAT_BUILTINS) ?? legacy.hat,
    kitGlasses: parseSlotPick(user?.kitGlasses, GLASSES_BUILTINS) ?? legacy.glasses,
    kitHeld: parseSlotPick(user?.kitHeld, HELD_BUILTINS) ?? "none",
  };
}
