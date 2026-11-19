/** Reject oversized JSON bodies (default 1 MiB) so a bad client cannot pin RAM. */
export const DEFAULT_BODY_LIMIT = 1_048_576;
/**
 * `/result` may carry a phone screenshot as base64 JSON (~4/3× binary).
 * Cap at 12 MiB so a full-screen JPEG/PNG can land without opening the door
 * to unbounded RAM growth on other routes.
 */
export const RESULT_BODY_LIMIT = 12 * 1024 * 1024;

export function readBody(req, { limit = DEFAULT_BODY_LIMIT } = {}) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let rejected = false;
    req.on("data", (c) => {
      if (rejected) return;
      size += c.length;
      if (size > limit) {
        rejected = true;
        reject(Object.assign(new Error("body-too-large"), { code: "body-too-large" }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      if (rejected) return;
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve(undefined);
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

export function sendJson(res, status, payload) {
  const body = JSON.stringify(payload ?? {});
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(body);
  return true;
}

export const PREFIX = "/xrk-phone-bridge";
