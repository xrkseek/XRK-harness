const HEADER_SEPARATOR = "\r\n\r\n";
const MAX_HEADER_BYTES = 1 << 16;

export function encodeMessage(message: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(message), "utf8");
  const header = Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, "ascii");
  return Buffer.concat([header, body]);
}

export class MessageDecoder {
  private buffer: Buffer = Buffer.alloc(0);
  private readonly maxMessageBytes: number;

  constructor(maxMessageBytes: number) {
    this.maxMessageBytes = maxMessageBytes;
  }

  push(chunk: Buffer): unknown[] {
    this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk]);
    const messages: unknown[] = [];
    for (;;) {
      const step = this.next();
      if (!step.ready) break;
      messages.push(step.message);
    }
    return messages;
  }

  private next(): { ready: false } | { ready: true; message: unknown } {
    const separator = this.buffer.indexOf(HEADER_SEPARATOR);
    if (separator < 0) {
      if (this.buffer.length > MAX_HEADER_BYTES) {
        throw new Error(
          `LSP header exceeded ${MAX_HEADER_BYTES} bytes without a terminator`,
        );
      }
      return { ready: false };
    }
    if (separator > MAX_HEADER_BYTES) {
      throw new Error(`LSP header exceeded ${MAX_HEADER_BYTES} bytes`);
    }
    const headerText = this.buffer.toString("ascii", 0, separator);
    const contentLength = parseContentLength(headerText);
    if (contentLength > this.maxMessageBytes) {
      throw new Error(
        `LSP message length ${contentLength} exceeds the ${this.maxMessageBytes}-byte limit`,
      );
    }
    const bodyStart = separator + HEADER_SEPARATOR.length;
    const bodyEnd = bodyStart + contentLength;
    if (this.buffer.length < bodyEnd) return { ready: false };
    const body = this.buffer.toString("utf8", bodyStart, bodyEnd);
    this.buffer = this.buffer.subarray(bodyEnd);
    try {
      return { ready: true, message: JSON.parse(body) };
    } catch (error) {
      throw new Error(
        `LSP message body was not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

function parseContentLength(headerText: string): number {
  for (const line of headerText.split("\r\n")) {
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    if (line.slice(0, colon).trim().toLowerCase() !== "content-length") continue;
    const value = Number(line.slice(colon + 1).trim());
    if (!Number.isInteger(value) || value < 0) {
      throw new Error(`invalid Content-Length header: ${JSON.stringify(line)}`);
    }
    return value;
  }
  throw new Error(
    `LSP header block missing Content-Length: ${JSON.stringify(headerText)}`,
  );
}
