/**
 * better-sidebar embedded browser probe — HEAD/GET remote URL headers.
 */
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";

const PROBE_TIMEOUT_MS = 8_000;

function parseFrameAncestors(
  csp: string | undefined,
): string[] | undefined {
  if (!csp) return undefined;
  const match = /frame-ancestors\s+([^;]+)/i.exec(csp);
  if (!match?.[1]) return undefined;
  return match[1]
    .trim()
    .split(/\s+/)
    .map((s) => s.replace(/['"]/g, ""))
    .filter(Boolean);
}

function probeOnce(url: URL): Promise<{
  reachable: boolean;
  xFrameOptions?: string;
  frameAncestors?: string[];
}> {
  const transport = url.protocol === "https:" ? httpsRequest : httpRequest;
  return new Promise((resolve) => {
    const req = transport(
      url,
      { method: "HEAD", timeout: PROBE_TIMEOUT_MS },
      (res) => {
        res.resume();
        const out: {
          reachable: boolean;
          xFrameOptions?: string;
          frameAncestors?: string[];
        } = { reachable: true };
        const xfo = res.headers["x-frame-options"];
        if (typeof xfo === "string") out.xFrameOptions = xfo;
        const fa = parseFrameAncestors(
          res.headers["content-security-policy"] as string | undefined,
        );
        if (fa) out.frameAncestors = fa;
        resolve(out);
      },
    );
    req.on("timeout", () => {
      req.destroy();
      resolve({ reachable: false });
    });
    req.on("error", () => resolve({ reachable: false }));
    req.end();
  });
}

/** Probe embeddability headers for better-sidebar browser tabs. */
export async function probeBrowserUrl(
  rawUrl: string,
): Promise<Record<string, unknown>> {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return { reachable: false, supported: false, reason: "empty-url" };
  }
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { reachable: false, supported: false, reason: "invalid-url" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { reachable: false, supported: false, reason: "unsupported-scheme" };
  }
  const head = await probeOnce(url);
  if (!head.reachable && url.protocol === "https:") {
    const get = await new Promise<typeof head>((resolve) => {
      const req = httpsRequest(
        url,
        { method: "GET", timeout: PROBE_TIMEOUT_MS },
        (res) => {
          res.resume();
          const out: {
            reachable: boolean;
            xFrameOptions?: string;
            frameAncestors?: string[];
          } = { reachable: true };
          const xfo = res.headers["x-frame-options"];
          if (typeof xfo === "string") out.xFrameOptions = xfo;
          const fa = parseFrameAncestors(
            res.headers["content-security-policy"] as string | undefined,
          );
          if (fa) out.frameAncestors = fa;
          resolve(out);
        },
      );
      req.on("timeout", () => {
        req.destroy();
        resolve({ reachable: false });
      });
      req.on("error", () => resolve({ reachable: false }));
      req.end();
    });
    return { ...get, supported: true, url: url.toString() };
  }
  return { ...head, supported: true, url: url.toString() };
}
