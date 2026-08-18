/**
 * Uncompressed ZIP (store method). No extra dependency.
 */

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
