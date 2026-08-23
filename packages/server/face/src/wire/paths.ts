/**
 * Face HTTP/WS 路径：与产品壳 apiproxy 同形。
 *
 * Unary 两类：
 * - 点号方法：`/api/session.prompt`（须含 `.`，避免抢走 REST `/api/sessions`）
 * - Typert Remote：`/api/commands/execute`（`ns/method`；白名单 namespace）
 */

import { isSessionExportPath } from "../session-export.js";

export const FACE_WS_PATHS = [
  "/api/face/events.mux",
  "/api/face/events.host",
  "/api/events.mux",
  "/api/events.host",
] as const;

export const FACE_RESPOND_PATHS = [
  "/api/respond",
  "/api/face/respond",
] as const;

/** REST 一等路径，Face 不得认领。 */
const REST_API_SEGMENTS = new Set(["sessions", "chat"]);

/**
 * 产品壳 `connection.rpc.call("/api", endpoint)` 会打的 Remote namespace。
 * 未实现的 endpoint 仍要认领，回合法 Face 信封，禁止 HTTP 404。
 */
export const FACE_REMOTE_NAMESPACES = new Set([
  "commands",
  "goals",
  "pluginInventory",
  "messageFeedback",
  "dynamicCordisRunner",
  "costMeter",
  "fileReferences",
  "sessionReferenceResolver",
]);

const REMOTE_NS = /^[A-Za-z][A-Za-z0-9_-]*$/;
const REMOTE_METHOD = /^[A-Za-z][A-Za-z0-9_]*$/;

export function isFaceRespondPath(pathname: string): boolean {
  return (FACE_RESPOND_PATHS as readonly string[]).includes(pathname);
}

export function isFaceWsPath(pathname: string): boolean {
  return (FACE_WS_PATHS as readonly string[]).includes(pathname);
}

export function isFaceHttpPath(pathname: string): boolean {
  return (
    isFaceRespondPath(pathname) ||
    isSessionExportPath(pathname) ||
    faceMethodFromPath(pathname) !== undefined
  );
}

function methodFromRest(rest: string): string | undefined {
  if (!rest) return undefined;
  if (rest === "events.mux" || rest === "events.host" || rest === "respond") {
    return undefined;
  }

  const slash = rest.indexOf("/");
  if (slash >= 0) {
    const ns = rest.slice(0, slash);
    const method = rest.slice(slash + 1);
    if (REST_API_SEGMENTS.has(ns)) return undefined;
    if (method.includes("/")) return undefined;
    if (!REMOTE_NS.test(ns) || !REMOTE_METHOD.test(method)) return undefined;
    if (!FACE_REMOTE_NAMESPACES.has(ns)) return undefined;
    return rest;
  }

  if (REST_API_SEGMENTS.has(rest)) return undefined;
  if (!rest.includes(".")) return undefined;
  return rest;
}

/**
 * 从 pathname 解析 unary method。
 * - `/api/face/session.prompt`（U1 前缀）
 * - `/api/session.prompt`（DSH 点号形）
 * - `/api/commands/execute`（DSH Typert Remote）
 */
export function faceMethodFromPath(pathname: string): string | undefined {
  if (pathname.startsWith("/api/face/")) {
    if (
      pathname === "/api/face/events.mux" ||
      pathname === "/api/face/events.host" ||
      pathname === "/api/face/respond"
    ) {
      return undefined;
    }
    return methodFromRest(decodeURIComponent(pathname.slice("/api/face/".length)));
  }

  if (!pathname.startsWith("/api/")) return undefined;
  return methodFromRest(decodeURIComponent(pathname.slice("/api/".length)));
}
