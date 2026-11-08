/**
 * Desktop computer-use seam — accessibility tree + input Provider.
 * Separate from page-level browser_* (HTTP snapshot/act).
 */

import type { ComputerUseAction } from "./actions.js";

export type {
  ComputerUseAction,
} from "./actions.js";
export {
  COMPUTER_USE_ACTIONS,
  COMPUTER_USE_READ_ACTIONS,
} from "./actions.js";

export type ComputerUseDelivery =
  | "background"
  | "uia"
  | "memory"
  | "agent-desktop";

export type ComputerUseProviderName =
  | "memory"
  | "uia"
  | "background"
  | "agent-desktop";

/** Search AX tree by role/name/text (agent-desktop `find`, or filtered last capture). */
export interface ComputerUseFindRequest {
  readonly role?: string;
  readonly name?: string;
  /** Match name/value/description text (substring unless exact). */
  readonly text?: string;
  readonly app?: string;
  readonly exact?: boolean;
  readonly first?: boolean;
  readonly limit?: number;
}

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
  /**
   * Optional PNG bytes for mode=vision|som (Windows UIA CopyFromScreen).
   * Tool layer stores via AttachmentStore so the model can see the desktop.
   */
  readonly screenshotPng?: Uint8Array;
}

export interface ComputerUseActRequest {
  /** Any action except capture/find (those use capture()/find()). */
  readonly action: Exclude<ComputerUseAction, "capture" | "find">;
  readonly element?: number;
  readonly text?: string;
  readonly keys?: string;
  readonly direction?: "up" | "down" | "left" | "right";
  readonly amount?: number;
  readonly coordinate?: readonly [number, number];
  /** Second point for drag (screen pixels) or resize/move size/pos. */
  readonly coordinate2?: readonly [number, number];
  /**
   * Allow physical pointer / `--headed` paths (moves the real mouse / steals focus).
   * Default false — agent-desktop and UIA stay on AX / Invoke / clipboard.
   */
  readonly headed?: boolean;
  /** App / window filter (launch, close_app, focus_window, wait, …). */
  readonly app?: string;
  /** Property name for get/is (text, value, title, bounds, role, states / visible, …). */
  readonly property?: string;
  /** Wait predicate or system surface id. */
  readonly predicate?: string;
  /** Wait timeout ms. */
  readonly timeoutMs?: number;
  /**
   * Overlay control: for action=overlay, text is the label (empty/`off` disables).
   * Also used as optional intent label updates before other acts when set.
   */
  readonly label?: string;
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
  /** Optional: search AX by role/name/text and refresh act targets. */
  find?(
    request: ComputerUseFindRequest,
    signal?: AbortSignal,
  ): Promise<ComputerUseCaptureResult>;
  /** Release CLI session / overlay (Host invalidate). */
  close?(): Promise<void>;
}
