/**
 * QR data URLs for dsh-pocket / dsh-mobile pairing surfaces.
 */
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
// qrcode-generator is CJS (MIT, Kazuhiko Arase).
const qrcode = require("qrcode-generator") as (
  typeNumber: number,
  errorCorrectionLevel: "L" | "M" | "Q" | "H",
) => {
  addData: (text: string) => void;
  make: () => void;
  createSvgTag: (
    cellSize?: number,
    margin?: number,
    alt?: string,
  ) => string;
};

export function qrSvgForText(text: string, alt = "QR"): string {
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  return qr.createSvgTag(4, 2, alt);
}

export function qrDataUrlForText(text: string, alt = "QR"): string {
  const svg = qrSvgForText(text, alt);
  return `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
}
