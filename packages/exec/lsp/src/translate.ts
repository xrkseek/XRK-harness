import { LspError, type LspHover, type LspLocation, type LspOperation, type LspRange } from "./types.js";

export interface WirePosition {
  readonly line: number;
  readonly character: number;
}

export interface WireRange {
  readonly start: WirePosition;
  readonly end: WirePosition;
}

export interface WireLocation {
  readonly uri: string;
  readonly range: WireRange;
}

export interface WireLocationLink {
  readonly targetUri: string;
  readonly targetSelectionRange: WireRange;
  readonly targetRange?: WireRange;
}

export type WireTextDocumentSyncKind = 0 | 1 | 2;

export interface WireTextDocumentSyncOptions {
  readonly openClose?: boolean;
  readonly change?: WireTextDocumentSyncKind;
}

export type WireProviderCapability = boolean | Record<string, unknown> | undefined;

export interface WireServerCapabilities {
  readonly positionEncoding?: string;
  readonly textDocumentSync?: WireTextDocumentSyncKind | WireTextDocumentSyncOptions;
  readonly definitionProvider?: WireProviderCapability;
  readonly referencesProvider?: WireProviderCapability;
  readonly implementationProvider?: WireProviderCapability;
  readonly hoverProvider?: WireProviderCapability;
}

export interface WireInitializeResult {
  readonly capabilities: WireServerCapabilities;
}

export function requestMethod(operation: LspOperation): string {
  switch (operation) {
    case "goToDefinition":
      return "textDocument/definition";
    case "findReferences":
      return "textDocument/references";
    case "goToImplementation":
      return "textDocument/implementation";
    case "hover":
      return "textDocument/hover";
  }
}

function capabilityValue(
  capabilities: WireServerCapabilities,
  operation: LspOperation,
): WireProviderCapability {
  switch (operation) {
    case "goToDefinition":
      return capabilities.definitionProvider;
    case "findReferences":
      return capabilities.referencesProvider;
    case "goToImplementation":
      return capabilities.implementationProvider;
    case "hover":
      return capabilities.hoverProvider;
  }
}

function supportsCapability(value: WireProviderCapability): boolean {
  if (value === undefined) return false;
  if (typeof value === "boolean") return value;
  return true;
}

export function supportsOperation(
  capabilities: WireServerCapabilities,
  operation: LspOperation,
): boolean {
  return supportsCapability(capabilityValue(capabilities, operation));
}

export function supportsTransientOpen(
  sync: WireServerCapabilities["textDocumentSync"],
): boolean {
  if (sync === undefined) return false;
  if (typeof sync === "number") return sync === 1 || sync === 2;
  return sync.openClose === true;
}

export function negotiatePositionEncoding(
  encoding: string | undefined,
): "utf-16" {
  if (encoding === undefined || encoding === "utf-16") return "utf-16";
  throw new Error(
    `server negotiated unsupported position encoding "${encoding}"; this host requires utf-16`,
  );
}

function toRange(range: WireRange): LspRange {
  return {
    start: { line: range.start.line, character: range.start.character },
    end: { line: range.end.line, character: range.end.character },
  };
}

function isProtocolCoordinate(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isPosition(value: unknown): boolean {
  if (value === null || typeof value !== "object") return false;
  const position = value as Record<string, unknown>;
  return isProtocolCoordinate(position.line) && isProtocolCoordinate(position.character);
}

function isRange(value: unknown): value is WireRange {
  if (value === null || typeof value !== "object") return false;
  const range = value as Record<string, unknown>;
  return isPosition(range.start) && isPosition(range.end);
}

function isLocationLink(value: Record<string, unknown>): boolean {
  return typeof value.targetUri === "string" && isRange(value.targetSelectionRange);
}

function isLocation(value: Record<string, unknown>): boolean {
  return typeof value.uri === "string" && isRange(value.range);
}

function malformedResponse(message: string): LspError {
  return new LspError(message, "LSP_MALFORMED_RESPONSE");
}

export function normalizeLocations(payload: unknown): LspLocation[] {
  if (payload === null) return [];
  if (payload === undefined) throw malformedResponse("LSP navigation result was missing");
  const elements = Array.isArray(payload) ? payload : [payload];
  const locations: LspLocation[] = [];
  for (const element of elements) {
    if (element === null || typeof element !== "object") {
      throw malformedResponse("LSP navigation result contained a non-object entry");
    }
    const record = element as Record<string, unknown>;
    if (isLocationLink(record)) {
      const link = record as unknown as WireLocationLink;
      locations.push({
        uri: link.targetUri,
        range: toRange(link.targetSelectionRange),
      });
    } else if (isLocation(record)) {
      const location = record as unknown as WireLocation;
      locations.push({ uri: location.uri, range: toRange(location.range) });
    } else {
      throw malformedResponse(
        "LSP navigation result contained neither a Location nor a LocationLink",
      );
    }
  }
  return locations;
}

type WireMarkedString = string | { readonly language: string; readonly value: string };

function renderMarkedString(value: WireMarkedString): string {
  if (typeof value === "string") return value;
  return `\`\`\`${value.language}\n${value.value}\n\`\`\``;
}

function isMarkedString(value: unknown): value is WireMarkedString {
  if (typeof value === "string") return true;
  if (value === null || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return typeof record.language === "string" && typeof record.value === "string";
}

function renderHoverContents(contents: unknown): string {
  if (contents === null || contents === undefined) {
    throw malformedResponse("LSP hover result had no contents");
  }
  if (typeof contents === "string") return contents;
  if (Array.isArray(contents)) {
    return contents
      .map((value) => {
        if (isMarkedString(value)) return renderMarkedString(value);
        throw malformedResponse("LSP hover contents contained a malformed MarkedString");
      })
      .join("\n\n");
  }
  if (typeof contents !== "object") {
    throw malformedResponse(
      "LSP hover contents were not MarkupContent, MarkedString, or an array",
    );
  }
  const record = contents as Record<string, unknown>;
  if (record.kind === "markdown" || record.kind === "plaintext") {
    if (typeof record.value !== "string") {
      throw malformedResponse("LSP hover MarkupContent value was not a string");
    }
    return record.value;
  }
  if (typeof record.language === "string" && typeof record.value === "string") {
    return renderMarkedString({ language: record.language, value: record.value });
  }
  throw malformedResponse(
    "LSP hover contents were not MarkupContent, MarkedString, or an array",
  );
}

export function normalizeHover(payload: unknown): LspHover | null {
  if (payload === null) return null;
  if (payload === undefined) throw malformedResponse("LSP hover result was missing");
  if (typeof payload !== "object") {
    throw malformedResponse("LSP hover result was not an object");
  }
  const hover = payload as { contents?: unknown; range?: unknown };
  const contents = renderHoverContents(hover.contents);
  if (contents === "") return null;
  if (hover.range === undefined) return { contents };
  if (!isRange(hover.range)) {
    throw malformedResponse("LSP hover result contained a malformed range");
  }
  return { contents, range: toRange(hover.range) };
}
