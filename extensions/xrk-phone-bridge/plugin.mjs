/**
 * Single install: kind host. On wire, materializes sibling tools + prompt plugins
 * and Settings client half (loader is one-kind-per-plugin) and shares runtime via Symbol.for.
 */
import { getPhoneBridge, requestHasOperator } from "./lib/runtime.mjs";
import { PREFIX, RESULT_BODY_LIMIT, readBody, sendJson } from "./lib/http.mjs";
import { materializeOnce } from "./materialize.mjs";

function needOperator(req, runtime, res) {
  const op = requestHasOperator(req, runtime.home);
  if (op.ok) return null;
  return sendJson(res, 401, {
    ok: false,
    error: "not-operator",
    message: "Need Face operator proof (device / session / LAN·WAN PIN cookie).",
  });
}

export function createPlugin() {
  return {
    id: "xrk-phone-bridge",
    kind: "host",
    createPublicHandler(ctx) {
      const ready = materializeOnce(ctx);
      const runtime = getPhoneBridge(ctx?.xrkHome);
      return async (req, res) => {
        await ready;
        const url = new URL(req.url || "/", "http://127.0.0.1");
        const path = url.pathname;
        if (!path.startsWith(PREFIX)) return false;
        const method = (req.method || "GET").toUpperCase();
        try {
          if (method === "GET" && path === `${PREFIX}/status`) {
            if (needOperator(req, runtime, res)) return true;
            return sendJson(res, 200, runtime.statusForReq(req));
          }

          // Settings whitelist mutations (JSON only).
          if (method === "POST" && path === `${PREFIX}/whitelist`) {
            if (needOperator(req, runtime, res)) return true;
            const body = (await readBody(req)) || {};
            const action = String(body.action || "");
            const deviceKey = String(body.deviceKey || "").trim();
            const label = String(body.label || "").trim();
            if (action === "add") {
              if (!deviceKey) return sendJson(res, 400, { ok: false, error: "missing-deviceKey" });
              runtime.addWhitelist(deviceKey, label);
            } else if (action === "remove") {
              runtime.removeWhitelist(deviceKey);
            } else {
              return sendJson(res, 400, { ok: false, error: "bad-action" });
            }
            return sendJson(res, 200, {
              ok: true,
              ...runtime.statusForReq(req),
            });
          }

          if (method === "POST" && path === `${PREFIX}/ticket`) {
            const body = (await readBody(req)) || {};
            const out = runtime.issueTicket(req, body.label, body.clientDeviceId);
            return sendJson(res, out.ok ? 200 : 401, out);
          }

          if (method === "POST" && path === `${PREFIX}/register`) {
            const body = (await readBody(req)) || {};
            const out = runtime.register(body.ticket, body.label);
            return sendJson(res, out.ok ? 200 : 403, out);
          }

          if (method === "POST" && path === `${PREFIX}/bind-session`) {
            const body = (await readBody(req)) || {};
            const out = runtime.bindSession(body.ticket, body.sessionId);
            return sendJson(res, out.ok ? 200 : 400, out);
          }

          if (method === "POST" && path === `${PREFIX}/poll`) {
            const body = (await readBody(req)) || {};
            const ticket = String(body.ticket || "");
            const wait = Number(body.wait ?? 25000);
            const ac = new AbortController();
            const onClose = () => ac.abort();
            req.on("close", onClose);
            try {
              const out = await runtime.poll(ticket, wait, ac.signal);
              return sendJson(res, out.ok ? 200 : 403, out);
            } finally {
              req.off("close", onClose);
            }
          }

          if (method === "POST" && path === `${PREFIX}/result`) {
            const body = (await readBody(req, { limit: RESULT_BODY_LIMIT })) || {};
            const out = runtime.submitResult(
              body.ticket,
              body.id,
              body.content,
              body.isError,
              body.imageBase64,
              body.imageMime,
            );
            return sendJson(res, out.ok ? 200 : 400, out);
          }

          if (method === "POST" && path === `${PREFIX}/offline`) {
            const body = (await readBody(req)) || {};
            const out = runtime.markOffline(body.ticket);
            return sendJson(res, out.ok ? 200 : 400, out);
          }

          return sendJson(res, 404, { ok: false, error: "not-found" });
        } catch (e) {
          if (e && e.code === "body-too-large") {
            return sendJson(res, 413, {
              ok: false,
              error: "body-too-large",
              message: "Request body exceeds limit (screenshots use /result 12 MiB).",
            });
          }
          return sendJson(res, 500, {
            ok: false,
            error: String(e && e.message ? e.message : e),
          });
        }
      };
    },
  };
}
