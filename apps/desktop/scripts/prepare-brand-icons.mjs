#!/usr/bin/env node
/**
 * Sync Desktop brand icons from apps/web/public/logo-plate.png.
 *
 *   node apps/desktop/scripts/prepare-brand-icons.mjs
 *
 * Writes apps/desktop/build/icon.png + multi-size icon.ico.
 * Keep the plate's **transparent rounded corners** — do not flatten onto cream
 * (that turns the squircle into a sharp square in the taskbar / installer).
 */
import { createRequire } from "node:module";
import { mkdirSync, readdirSync, existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = path.resolve(APP_ROOT, "..", "..");
const SOURCE = path.join(REPO_ROOT, "apps", "web", "public", "logo-plate.png");
const BUILD = path.join(APP_ROOT, "build");
const PNG = path.join(BUILD, "icon.png");
const ICO = path.join(BUILD, "icon.ico");

const ICO_SIZES = [256, 128, 64, 48, 32, 16];

/**
 * @returns {typeof import("sharp")}
 */
function loadSharp() {
  const attempts = [
    path.join(APP_ROOT, "package.json"),
    path.join(REPO_ROOT, "package.json"),
  ];
  for (const pkg of attempts) {
    try {
      return createRequire(pkg)("sharp");
    } catch {
      // try next
    }
  }
  const pnpm = path.join(REPO_ROOT, "node_modules", ".pnpm");
  if (existsSync(pnpm)) {
    for (const entry of readdirSync(pnpm)) {
      if (!entry.startsWith("sharp@")) continue;
      const mod = path.join(pnpm, entry, "node_modules", "sharp");
      if (existsSync(path.join(mod, "package.json"))) {
        return createRequire(path.join(mod, "package.json"))(mod);
      }
    }
  }
  throw new Error(
    "xrk desktop: sharp not found (needed to build icon.png / icon.ico)",
  );
}

/**
 * @param {readonly { size: number, png: Buffer }[]} images
 */
function buildPngIco(images) {
  const count = images.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(count, 4);
  const entries = Buffer.alloc(16 * count);
  const bodies = [];
  let offset = 6 + 16 * count;
  for (let i = 0; i < count; i++) {
    const { size, png } = images[i];
    const entry = entries.subarray(i * 16, i * 16 + 16);
    entry[0] = size >= 256 ? 0 : size;
    entry[1] = size >= 256 ? 0 : size;
    entry[2] = 0;
    entry[3] = 0;
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    bodies.push(png);
    offset += png.length;
  }
  return Buffer.concat([header, entries, ...bodies]);
}

if (!existsSync(SOURCE)) {
  throw new Error(`xrk desktop: missing brand plate at ${SOURCE}`);
}

mkdirSync(BUILD, { recursive: true });
const sharp = loadSharp();

/** Preserve alpha so rounded plate corners stay transparent. */
const plate = await sharp(SOURCE).ensureAlpha().png().toBuffer();

writeFileSync(PNG, plate);

/** @type {{ size: number, png: Buffer }[]} */
const images = [];
for (const size of ICO_SIZES) {
  const png = await sharp(plate)
    .resize(size, size, { fit: "cover" })
    .png()
    .toBuffer();
  images.push({ size, png });
}
writeFileSync(ICO, buildPngIco(images));

process.stdout.write(
  `prepare-brand-icons: ${path.relative(REPO_ROOT, PNG)} + ${path.relative(REPO_ROOT, ICO)} (${ICO_SIZES.join(",")}px, rounded alpha)\n`,
);
