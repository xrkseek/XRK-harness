/**
 * Face ↔ DSH Web 接线层：信封、错误码、路径、/api/respond。
 */

export {
  errResponse,
  okResponse,
  parseFaceRpcRequest,
  serverRequestFrame,
} from "./envelope.js";
export {
  DSH_RPC_ERROR_CODES,
  mapFaceRpcError,
  type DshRpcErrorCode,
} from "./rpc-error.js";
export {
  FACE_REMOTE_NAMESPACES,
  FACE_RESPOND_PATHS,
  FACE_WS_PATHS,
  faceMethodFromPath,
  isFaceHttpPath,
  isFaceRespondPath,
  isFaceWsPath,
} from "./paths.js";
export { isLoopbackAddress } from "./loopback.js";
export { readHttpBody, sendJson } from "./http-io.js";
export {
  parseClientResponse,
  settleFaceRespond,
  type ParsedClientResponse,
} from "./respond.js";
