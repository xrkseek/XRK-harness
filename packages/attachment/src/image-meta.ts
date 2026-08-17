import type { ImageMediaType } from "@xrkseek/protocol";

function u16be(data: Uint8Array, offset: number): number {
  return ((data[offset]! << 8) | data[offset + 1]!) >>> 0;
}

function u16le(data: Uint8Array, offset: number): number {
  return (data[offset]! | (data[offset + 1]! << 8)) >>> 0;
}

function u32be(data: Uint8Array, offset: number): number {
  return (
    ((data[offset]! << 24) |
      (data[offset + 1]! << 16) |
      (data[offset + 2]! << 8) |
      data[offset + 3]!) >>>
    0
  );
}

/** Sniff raster media type from magic bytes; undefined if unknown. */
export function sniffImageMediaType(data: Uint8Array): ImageMediaType | undefined {
  if (data.length >= 8) {
    if (
      data[0] === 0x89 &&
      data[1] === 0x50 &&
      data[2] === 0x4e &&
      data[3] === 0x47 &&
      data[4] === 0x0d &&
      data[5] === 0x0a &&
      data[6] === 0x1a &&
      data[7] === 0x0a
    ) {
      return "image/png";
    }
  }
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    data.length >= 6 &&
    data[0] === 0x47 &&
    data[1] === 0x49 &&
    data[2] === 0x46 &&
    data[3] === 0x38 &&
    (data[4] === 0x37 || data[4] === 0x39) &&
    data[5] === 0x61
  ) {
    return "image/gif";
  }
  if (
    data.length >= 12 &&
    data[0] === 0x52 &&
    data[1] === 0x49 &&
    data[2] === 0x46 &&
    data[3] === 0x46 &&
    data[8] === 0x57 &&
    data[9] === 0x45 &&
    data[10] === 0x42 &&
    data[11] === 0x50
  ) {
    return "image/webp";
  }
  return undefined;
}

export interface ImageSize {
  readonly width: number;
  readonly height: number;
}

/** Intrinsic size from encoded headers (no full decode). */
export function readImageSize(
  data: Uint8Array,
  mediaType: ImageMediaType,
): ImageSize | undefined {
  switch (mediaType) {
    case "image/png":
      return readPngSize(data);
    case "image/jpeg":
      return readJpegSize(data);
    case "image/gif":
      return readGifSize(data);
    case "image/webp":
      return readWebpSize(data);
    default:
      return undefined;
  }
}

function readPngSize(data: Uint8Array): ImageSize | undefined {
  // IHDR after 8-byte signature + 4 length + 4 type
  if (data.length < 24) return undefined;
  if (
    data[12] !== 0x49 ||
    data[13] !== 0x48 ||
    data[14] !== 0x44 ||
    data[15] !== 0x52
  ) {
    return undefined;
  }
  return { width: u32be(data, 16), height: u32be(data, 20) };
}

function readGifSize(data: Uint8Array): ImageSize | undefined {
  if (data.length < 10) return undefined;
  return { width: u16le(data, 6), height: u16le(data, 8) };
}

function readJpegSize(data: Uint8Array): ImageSize | undefined {
  let i = 2;
  while (i + 9 < data.length) {
    if (data[i] !== 0xff) {
      i += 1;
      continue;
    }
    const marker = data[i + 1]!;
    if (marker === 0xd8 || marker === 0xd9) {
      i += 2;
      continue;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    const len = u16be(data, i + 2);
    if (len < 2 || i + 2 + len > data.length) return undefined;
    // SOF0–SOF3, SOF5–SOF7, SOF9–SOF11, SOF13–SOF15
    if (
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf)
    ) {
      return { height: u16be(data, i + 5), width: u16be(data, i + 7) };
    }
    i += 2 + len;
  }
  return undefined;
}

function readWebpSize(data: Uint8Array): ImageSize | undefined {
  if (data.length < 30) return undefined;
  const fourCC =
    String.fromCharCode(data[12]!, data[13]!, data[14]!, data[15]!);
  if (fourCC === "VP8X" && data.length >= 30) {
    const w =
      1 + (data[24]! | (data[25]! << 8) | (data[26]! << 16));
    const h =
      1 + (data[27]! | (data[28]! << 8) | (data[29]! << 16));
    return { width: w, height: h };
  }
  if (fourCC === "VP8 " && data.length >= 30) {
    // lossy bitstream starts at offset 23 relative to RIFF? after chunk header at 20
    const start = 20;
    if (data[start + 3] !== 0x9d || data[start + 4] !== 0x01 || data[start + 5] !== 0x2a) {
      return undefined;
    }
    const w = u16le(data, start + 6) & 0x3fff;
    const h = u16le(data, start + 8) & 0x3fff;
    return { width: w, height: h };
  }
  if (fourCC === "VP8L" && data.length >= 25) {
    const b0 = data[21]!;
    const b1 = data[22]!;
    const b2 = data[23]!;
    const b3 = data[24]!;
    const w = 1 + (((b1 & 0x3f) << 8) | b0);
    const h = 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6));
    return { width: w, height: h };
  }
  return undefined;
}
