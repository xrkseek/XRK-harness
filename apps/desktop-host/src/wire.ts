/**
 * Host-side framed transport surface.
 * Codec truth lives in `@xrkseek/harness-desktop` (ADR-0008); this module re-exports for the child entry.
 */

export {
  DESKTOP_HOST_PROTOCOL_VERSION,
  DESKTOP_PIPE_CHUNK_BYTES,
  DESKTOP_REQUEST_PIPE_FD,
  DESKTOP_RESPONSE_PIPE_FD,
  DesktopHostRequestDecoder,
  encodeDesktopResponseData,
  encodeDesktopResponseEnd,
  encodeDesktopResponseError,
  encodeDesktopResponseStart,
  iterDesktopPipeChunks,
  writeDesktopPipeFrame,
  type DesktopHostRequestFrame,
} from "@xrkseek/harness-desktop";
