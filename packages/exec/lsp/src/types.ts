export type LspOperation =
  | "goToDefinition"
  | "findReferences"
  | "goToImplementation"
  | "hover";

export const LSP_OPERATIONS: readonly LspOperation[] = [
  "goToDefinition",
  "findReferences",
  "goToImplementation",
  "hover",
];

/** Zero-based UTF-16, matching the LSP wire. */
export interface LspPosition {
  readonly line: number;
  readonly character: number;
}

export interface LspRange {
  readonly start: LspPosition;
  readonly end: LspPosition;
}

export interface LspQueryRequest {
  readonly operation: LspOperation;
  readonly filePath: string;
  readonly position: LspPosition;
  readonly workspaceRoot: string;
}

export interface LspLocation {
  readonly uri: string;
  readonly range: LspRange;
}

export interface LspHover {
  readonly contents: string;
  readonly range?: LspRange;
}

export type LspQueryResult =
  | {
      readonly kind: "locations";
      readonly locations: readonly LspLocation[];
      readonly resolvedWorkspaceUri: string;
    }
  | { readonly kind: "hover"; readonly hover: LspHover | null };

export type LspErrorCode =
  | "LSP_UNAVAILABLE"
  | "LSP_WORKSPACE_REQUIRED"
  | "LSP_UNSUPPORTED_OPERATION"
  | "LSP_MALFORMED_RESPONSE"
  | "LSP_DISPOSED"
  | "LSP_PATH"
  | "LSP_IO";

export class LspError extends Error {
  readonly code: LspErrorCode;
  constructor(message: string, code: LspErrorCode) {
    super(message);
    this.name = "LspError";
    this.code = code;
  }
}

export function isLspError(err: unknown): err is LspError {
  return err instanceof LspError;
}

export interface LspService {
  query(
    request: LspQueryRequest,
    signal?: AbortSignal,
  ): Promise<LspQueryResult>;
}

export interface DisposableLspService extends LspService {
  dispose(): Promise<void>;
}
