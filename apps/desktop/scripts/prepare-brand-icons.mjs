#!/usr/bin/env node
/**
 * Sync Desktop brand icons from apps/web/public/logo-plate.png.
 *
 *   node apps/desktop/scripts/prepare-brand-icons.mjs
 *
 * Writes apps/desktop/build/icon.png + icon.ico (Vista+ PNG-in-ICO).
 */
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = path.resolve(APP_ROOT, "..", "..");
const SOURCE = path.join(REPO_ROOT, "apps", "web", "public", "logo-plate.png");
const BUILD = path.join(APP_ROOT, "build");
const PNG = path.join(BUILD, "icon.png");
const ICO = path.join(BUILD, "icon.ico");

mkdirSync(BUILD, { recursive: true });
copyFileSync(SOURCE, PNG);

const png = readFileSync(PNG);
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(1, 4);
const entry = Buffer.alloc(16);
entry[0] = 0;
entry[1] = 0;
entry[2] = 0;
entry[3] = 0;
entry.writeUInt16LE(1, 4);
entry.writeUInt16LE(32, 6);
entry.writeUInt32LE(png.length, 8);
entry.writeUInt32LE(6 + 16, 12);
writeFileSync(ICO, Buffer.concat([header, entry, png]));

process.stdout.write(
  `prepare-brand-icons: ${path.relative(REPO_ROOT, PNG)} + ${path.relative(REPO_ROOT, ICO)}\n`,
);
