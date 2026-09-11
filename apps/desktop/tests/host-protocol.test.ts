import { describe, expect, it } from "vitest";
import {
  DESKTOP_HOST_PROTOCOL_VERSION,
  DESKTOP_PIPE_CHUNK_BYTES,
  DesktopHostRequestDecoder,
  DesktopHostResponseDecoder,
  encodeDesktopRequestCancel,
  encodeDesktopRequestData,
  encodeDesktopRequestEnd,
  encodeDesktopRequestStart,
  encodeDesktopResponseData,
  encodeDesktopResponseEnd,
  encodeDesktopResponseError,
  encodeDesktopResponseStart,
  iterDesktopPipeChunks,
  writeDesktopPipeFrame,
} from "../src/host-protocol.js";

function decodeInPieces<T>(
  bytes: Buffer,
  push: (chunk: Buffer) => readonly T[],
): T[] {
  const values: T[] = [];
  for (let offset = 0; offset < bytes.byteLength; offset += 7) {
    values.push(...push(bytes.subarray(offset, offset + 7)));
  }
  return values;
}

describe("desktop Host pipe protocol", () => {
  it("exports protocol version 1", () => {
    expect(DESKTOP_HOST_PROTOCOL_VERSION).toBe(1);
  });

  it("keeps Electron request frames compatible with the Host decoder", () => {
    const decoder = new DesktopHostRequestDecoder();
    const bytes = Buffer.concat([
      encodeDesktopRequestStart(7, {
        url: "xrk-app://app/api/session",
        method: "POST",
        headers: [["content-type", "application/json"]],
        hasBody: true,
      }),
      encodeDesktopRequestData(7, Buffer.from('{"ok":true}')),
      encodeDesktopRequestEnd(7),
      encodeDesktopRequestCancel(7),
    ]);

    expect(decodeInPieces(bytes, (chunk) => decoder.push(chunk))).toEqual([
      {
        type: "start",
        streamId: 7,
        url: "xrk-app://app/api/session",
        method: "POST",
        headers: [["content-type", "application/json"]],
        hasBody: true,
      },
      { type: "data", streamId: 7, data: Buffer.from('{"ok":true}') },
      { type: "end", streamId: 7 },
      { type: "cancel", streamId: 7 },
    ]);
    expect(() => {
      decoder.finish();
    }).not.toThrow();
  });

  it("keeps Host response frames compatible with the Electron decoder", () => {
    const decoder = new DesktopHostResponseDecoder();
    const bytes = Buffer.concat([
      encodeDesktopResponseStart(9, {
        status: 201,
        headers: [["content-type", "application/octet-stream"]],
        hasBody: true,
      }),
      encodeDesktopResponseData(9, Buffer.from([0, 1, 2, 255])),
      encodeDesktopResponseEnd(9),
      encodeDesktopResponseError(10, "failed"),
    ]);

    expect(decodeInPieces(bytes, (chunk) => decoder.push(chunk))).toEqual([
      {
        type: "start",
        streamId: 9,
        status: 201,
        headers: [["content-type", "application/octet-stream"]],
        hasBody: true,
      },
      { type: "data", streamId: 9, data: Buffer.from([0, 1, 2, 255]) },
      { type: "end", streamId: 9 },
      { type: "error", streamId: 10, message: "failed" },
    ]);
    expect(() => {
      decoder.finish();
    }).not.toThrow();
  });

  it("rejects a corrupt marker and truncated EOF on both directions", () => {
    const request = new DesktopHostRequestDecoder();
    const response = new DesktopHostResponseDecoder();
    expect(() => request.push(Buffer.alloc(13))).toThrow(/request frame marker/u);
    expect(() => response.push(Buffer.alloc(13))).toThrow(/response frame marker/u);

    const partialRequest = new DesktopHostRequestDecoder();
    partialRequest.push(encodeDesktopRequestEnd(1).subarray(0, 5));
    expect(() => {
      partialRequest.finish();
    }).toThrow(/ended inside a frame/u);

    const partialResponse = new DesktopHostResponseDecoder();
    partialResponse.push(encodeDesktopResponseEnd(1).subarray(0, 5));
    expect(() => {
      partialResponse.finish();
    }).toThrow(/ended inside a frame/u);
  });

  it("chunks bodies at DESKTOP_PIPE_CHUNK_BYTES for backpressure-sized frames", () => {
    const body = Buffer.alloc(DESKTOP_PIPE_CHUNK_BYTES + 10, 7);
    const parts = [...iterDesktopPipeChunks(body)];
    expect(parts).toHaveLength(2);
    expect(parts[0]?.byteLength).toBe(DESKTOP_PIPE_CHUNK_BYTES);
    expect(parts[1]?.byteLength).toBe(10);
    expect(() =>
      encodeDesktopRequestData(1, Buffer.alloc(DESKTOP_PIPE_CHUNK_BYTES + 1)),
    ).toThrow(/byte limit/u);
  });

  it("writeDesktopPipeFrame waits for drain when write buffers", async () => {
    let writeCount = 0;
    const pipe = {
      destroyed: false,
      write: () => {
        writeCount += 1;
        return false;
      },
      once: (event: string, listener: () => void) => {
        expect(event).toBe("drain");
        queueMicrotask(listener);
        return pipe;
      },
    };
    await writeDesktopPipeFrame(pipe as never, encodeDesktopRequestEnd(1));
    expect(writeCount).toBe(1);
  });
});
