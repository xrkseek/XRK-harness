/**
 * Materialize a video from http(s) URL or local workspace path.
 */
import { extname } from "node:path";
import {
  assertVideoByteBudget,
  MAX_VIDEO_BYTES,
  unsupportedVideoFormatMessage,
  videoMimeForPath,
} from "./mime.js";
import { VideoAnalyzeError } from "./types.js";

export interface VideoAnalyzeFs {
  stat(userPath: string): Promise<{ readonly isFile: boolean }>;
  readBytes(userPath: string, maxBytes?: number): Promise<Uint8Array>;
}

export interface MaterializedVideo {
  readonly data: Uint8Array;
  readonly mediaType: string;
  readonly source: "url" | "path";
}

function isHttpUrl(raw: string): boolean {
  const lower = raw.trim().toLowerCase();
  return lower.startsWith("http://") || lower.startsWith("https://");
}

/**
 * Load video bytes for analysis.
 * - http(s): download with Accept video/*, capped at MAX_VIDEO_BYTES
 * - else: workspace path via injected Fs (same world as read_image)
 */
export async function materializeVideo(
  videoUrl: string,
  options: {
    readonly fs?: VideoAnalyzeFs;
    readonly fetchImpl?: typeof fetch;
    readonly signal?: AbortSignal;
  } = {},
): Promise<MaterializedVideo> {
  const source = videoUrl.trim();
  if (!source) {
    throw new VideoAnalyzeError(
      "video_url must be a non-empty string",
      "VIDEO_ANALYZE_BAD_ARGS",
    );
  }

  if (isHttpUrl(source)) {
    const fetchImpl = options.fetchImpl ?? fetch;
    let res: Response;
    try {
      res = await fetchImpl(source, {
        method: "GET",
        headers: { Accept: "video/*,*/*;q=0.8" },
        ...(options.signal ? { signal: options.signal } : {}),
        redirect: "follow",
      });
    } catch (err) {
      throw new VideoAnalyzeError(
        `Failed to download video: ${err instanceof Error ? err.message : String(err)}`,
        "VIDEO_ANALYZE_FETCH",
        { cause: err },
      );
    }
    if (!res.ok) {
      throw new VideoAnalyzeError(
        `Video download HTTP ${res.status}`,
        "VIDEO_ANALYZE_FETCH",
      );
    }
    const contentLength = Number(res.headers.get("content-length") ?? "");
    if (Number.isFinite(contentLength) && contentLength > MAX_VIDEO_BYTES) {
      assertVideoByteBudget(contentLength);
    }
    const ab = await res.arrayBuffer();
    const data = new Uint8Array(ab);
    assertVideoByteBudget(data.byteLength);
    const headerType = (res.headers.get("content-type") ?? "")
      .split(";")[0]
      ?.trim()
      .toLowerCase();
    const fromUrl = videoMimeForPath(new URL(source).pathname);
    const mediaType =
      (headerType && headerType.startsWith("video/") ? headerType : undefined) ??
      fromUrl ??
      "video/mp4";
    return { data, mediaType, source: "url" };
  }

  const mime = videoMimeForPath(source);
  if (!mime) {
    throw new VideoAnalyzeError(
      unsupportedVideoFormatMessage(extname(source).toLowerCase() || "(none)"),
      "VIDEO_ANALYZE_UNSUPPORTED",
    );
  }
  if (!options.fs) {
    throw new VideoAnalyzeError(
      "Local video paths require a workspace filesystem (Host harness fs).",
      "VIDEO_ANALYZE_BAD_ARGS",
    );
  }
  const st = await options.fs.stat(source);
  if (!st.isFile) {
    throw new VideoAnalyzeError(
      `cannot read "${source}": not a regular file`,
      "VIDEO_ANALYZE_BAD_ARGS",
    );
  }
  const data = await options.fs.readBytes(source, MAX_VIDEO_BYTES + 1);
  assertVideoByteBudget(data.byteLength);
  return { data, mediaType: mime, source: "path" };
}
