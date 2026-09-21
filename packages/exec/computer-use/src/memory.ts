import { buildCaptureResult } from "./format.js";
import {
  ComputerUseError,
  type ComputerUseActRequest,
  type ComputerUseActResult,
  type ComputerUseCaptureRequest,
  type ComputerUseElement,
  type ComputerUseService,
  type ComputerUseWindow,
} from "./types.js";

export interface MemoryComputerUseOptions {
  readonly app?: string;
  readonly windowTitle?: string;
  readonly elements?: readonly ComputerUseElement[];
  readonly windows?: readonly ComputerUseWindow[];
}

/**
 * In-memory Provider for tests — AX tree + act bookkeeping, no OS input.
 */
export function createMemoryComputerUseProvider(
  options: MemoryComputerUseOptions = {},
): ComputerUseService {
  let elements: ComputerUseElement[] = (options.elements ?? [
    { index: 1, role: "button", name: "OK" },
    { index: 2, role: "textbox", name: "Search" },
  ]).map((e) => ({ ...e }));
  let app = options.app ?? "MemoryApp";
  let windowTitle = options.windowTitle ?? "Memory Window";
  const windows = options.windows ?? [
    { title: windowTitle, app, pid: 1 },
  ];
  const fieldValues = new Map<number, string>();
  let lastCaptureGen = 0;

  const requireElement = (index: number | undefined): ComputerUseElement => {
    if (index === undefined || !Number.isFinite(index)) {
      throw new ComputerUseError(
        "element index is required (from the last capture)",
        "COMPUTER_USE_BAD_ARGS",
      );
    }
    const el = elements.find((e) => e.index === index);
    if (!el) {
      throw new ComputerUseError(
        `unknown element [${index}] — capture again`,
        "COMPUTER_USE_STALE_ELEMENT",
      );
    }
    return el;
  };

  return {
    providerId: "memory",
    delivery: "memory",
    async capture(request?: ComputerUseCaptureRequest) {
      lastCaptureGen += 1;
      const mode = request?.mode ?? "ax";
      const max = request?.maxElements ?? 80;
      const slice = elements.slice(0, max).map((e) => ({
        ...e,
        elementToken: `mem-${lastCaptureGen}-${e.index}`,
      }));
      elements = slice;
      const note =
        mode === "vision" || mode === "som"
          ? "memory provider has no screenshot; AX elements only"
          : undefined;
      return buildCaptureResult({
        mode: mode === "vision" ? "ax" : mode,
        app,
        windowTitle,
        elements: slice,
        ...(note !== undefined ? { note } : {}),
      });
    },
    async act(request: ComputerUseActRequest): Promise<ComputerUseActResult> {
      if (request.action === "click") {
        const el = requireElement(request.element);
        return {
          ok: true,
          action: "click",
          message: `clicked [${el.index}] ${el.name}`,
          delivery: "memory",
        };
      }
      if (request.action === "type") {
        const el = requireElement(request.element);
        const text = request.text ?? "";
        fieldValues.set(el.index, text);
        elements = elements.map((e) =>
          e.index === el.index ? { ...e, name: `${e.name} value=${JSON.stringify(text)}` } : e,
        );
        return {
          ok: true,
          action: "type",
          message: `typed into [${el.index}]`,
          delivery: "memory",
        };
      }
      if (request.action === "key") {
        const keys = String(request.keys ?? "").trim();
        if (!keys) {
          throw new ComputerUseError("keys is required", "COMPUTER_USE_BAD_ARGS");
        }
        return {
          ok: true,
          action: "key",
          message: `pressed ${keys}`,
          delivery: "memory",
        };
      }
      if (request.action === "scroll") {
        return {
          ok: true,
          action: "scroll",
          message: `scrolled ${request.direction ?? "down"} x${request.amount ?? 3}`,
          delivery: "memory",
        };
      }
      throw new ComputerUseError(
        `unsupported action`,
        "COMPUTER_USE_BAD_ARGS",
      );
    },
    async listWindows() {
      return windows;
    },
  };
}
