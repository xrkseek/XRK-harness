/**
 * ZIP store (write) + store/deflate read. No extra dependency.
 */
import { inflateRawSync } from "node:zlib";

function crc32(data: Uint8Array): number {
  let c = ~0 >>> 0;
  for (let i = 0; i < data.length; i++) {
    c ^= data[i]!;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
    }
  }
  return ~c >>> 0;
}

export interface ZipStoreEntry {
  readonly name: string;
  readonly data: Uint8Array;
}

/** Collapse `..` / absolute prefixes so ZIP entries cannot escape the archive root. */
export function zipEntryName(name: string): string {
  const parts = name
    .replaceAll("\\", "/")
    .split("/")
    .filter((part) => part.length > 0 && part !== "." && part !== "..");
  return parts.join("/") || "unnamed";
}

function dosNow(): { time: number; date: number } {
  const d = new Date();
  const time =
    ((d.getHours() & 31) << 11) |
    ((d.getMinutes() & 63) << 5) |
    (Math.floor(d.getSeconds() / 2) & 31);
  const date =
    (((d.getFullYear() - 1980) & 127) << 9) |
    (((d.getMonth() + 1) & 15) << 5) |
    (d.getDate() & 31);
  return { time, date };
}

/** Build a PKZIP archive with stored (uncompressed) entries. */
export function buildStoredZip(
  entries: readonly ZipStoreEntry[],
): Buffer {
  const { time, date } = dosNow();
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(zipEntryName(entry.name), "utf8");
    const data = Buffer.from(entry.data);
    const crc = crc32(data);
    const flags = 1 << 11; // UTF-8 names
    const local = Buffer.concat([
      Buffer.from([0x50, 0x4b, 0x03, 0x04]),
      u16(20),
      u16(flags),
      u16(0),
      u16(time),
      u16(date),
      u32(crc),
      u32(data.length),
      u32(data.length),
      u16(name.length),
      u16(0),
      name,
      data,
    ]);
    const central = Buffer.concat([
      Buffer.from([0x50, 0x4b, 0x01, 0x02]),
      u16(20),
      u16(20),
      u16(flags),
      u16(0),
      u16(time),
      u16(date),
      u32(crc),
      u32(data.length),
      u32(data.length),
      u16(name.length),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(offset),
      name,
    ]);
    locals.push(local);
    centrals.push(central);
    offset += local.length;
  }

  const centralDir = Buffer.concat(centrals);
  const eocd = Buffer.concat([
    Buffer.from([0x50, 0x4b, 0x05, 0x06]),
    u16(0),
    u16(0),
    u16(entries.length),
    u16(entries.length),
    u32(centralDir.length),
    u32(offset),
    u16(0),
  ]);

  return Buffer.concat([...locals, centralDir, eocd]);
}

/**
 * Read PKZIP entries (store or deflate). Skips directories and unknown methods.
 * Entry names are normalized with `zipEntryName` (no `..` escape).
 */
export function readZipEntries(buf: Buffer): Map<string, Buffer> | undefined {
  let eocd = -1;
  const min = Math.max(0, buf.length - 22 - 0xffff);
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return undefined;
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = new Map<string, Buffer>();
  for (let n = 0; n < count; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) {
      return undefined;
    }
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const rawName = buf.subarray(p + 46, p + 46 + nameLen).toString("utf8");
    p += 46 + nameLen + extraLen + commentLen;
    if (rawName.endsWith("/")) continue;
    if (localOff + 30 > buf.length || buf.readUInt32LE(localOff) !== 0x04034b50) {
      return undefined;
    }
    const localNameLen = buf.readUInt16LE(localOff + 26);
    const localExtra = buf.readUInt16LE(localOff + 28);
    const dataOff = localOff + 30 + localNameLen + localExtra;
    if (dataOff + compSize > buf.length) return undefined;
    const comp = buf.subarray(dataOff, dataOff + compSize);
    let body: Buffer;
    if (method === 0) body = Buffer.from(comp);
    else if (method === 8) {
      try {
        body = inflateRawSync(comp);
      } catch {
        return undefined;
      }
    } else continue;
    out.set(zipEntryName(rawName), body);
  }
  return out;
}

function u16(n: number): Buffer {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(n & 0xffff);
  return b;
}

function u32(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n >>> 0);
  return b;
}
