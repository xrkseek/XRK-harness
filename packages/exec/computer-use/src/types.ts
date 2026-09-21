/**
 * Desktop computer-use seam — accessibility tree + input Provider.
 * Separate from page-level browser_* (HTTP snapshot/act).
 */

export type ComputerUseDelivery = "background" | "uia" | "memory";

export type ComputerUseProviderName = "memory" | "uia" | "background";

export type ComputerUseAction =
  | "capture"
  | "click"
  | "type"
  | "key"
  | "scroll"
  | "list_windows";

export const COMPUTER_USE_ACTIONS: readonly ComputerUseAction[] = [
  "capture",
  "click",
  "type",
  "key",
  "scroll",
  "list_windows",
];

export interface ComputerUseElement {
  /** 1-based SOM / AX index for click/type. */
  readonly index: number;
  readonly role: string;
  readonly name: string;
  readonly bounds?: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
  /** Opaque handle; stale after a new capture of the same target. */
  readonly elementToken?: string;
}

export interface ComputerUseWindow {
  readonly title: string;
  readonly pid?: number;
  readonly app?: string;
}

export interface ComputerUseCaptureRequest {
  readonly mode?: "ax" | "som" | "vision";
  readonly app?: string;
  readonly maxElements?: number;
}

export interface ComputerUseCaptureResult {
  readonly mode: "ax" | "som" | "vision";
  readonly app: string;
  readonly windowTitle: string;
  readonly elements: readonly ComputerUseElement[];
  readonly text: string;
  readonly note?: string;
}

export interface ComputerUseActRequest {
  readonly action: Exclude<ComputerUseAction, "capture" | "list_windows">;
  readonly element?: number;
  readonly text?: string;
  readonly keys?: string;
  readonly direction?: "up" | "down" | "left" | "right";
  readonly amount?: number;
  readonly coordinate?: readonly [number, number];
}

export interface ComputerUseActResult {
  readonly ok: boolean;
  readonly action: string;
  readonly message: string;
  readonly delivery: ComputerUseDelivery;
  readonly capture?: ComputerUseCaptureResult;
}

export type ComputerUseErrorCode =
  | "COMPUTER_USE_UNAVAILABLE"
  | "COMPUTER_USE_BAD_ARGS"
  | "COMPUTER_USE_STALE_ELEMENT"
  | "COMPUTER_USE_BACKEND";

export class ComputerUseError extends Error {
  readonly code: ComputerUseErrorCode;

  constructor(message: string, code: ComputerUseErrorCode) {
    super(message);
    this.name = "ComputerUseError";
    this.code = code;
  }
}

export function isComputerUseError(err: unknown): err is ComputerUseError {
  return err instanceof ComputerUseError;
}

/**
 * Desktop computer-use Provider: AX snapshot + click/type/key/scroll.
 * Prefer element indices from the last capture over raw coordinates.
 */
export interface ComputerUseService {
  readonly providerId: string;
  readonly delivery: ComputerUseDelivery;
  capture(
    request?: ComputerUseCaptureRequest,
    signal?: AbortSignal,
  ): Promise<ComputerUseCaptureResult>;
  act(
    request: ComputerUseActRequest,
    signal?: AbortSignal,
  ): Promise<ComputerUseActResult>;
  listWindows(signal?: AbortSignal): Promise<readonly ComputerUseWindow[]>;
}
