import { buildCaptureResult } from "./format.js";
import {
  ComputerUseError,
  type ComputerUseActRequest,
  type ComputerUseActResult,
  type ComputerUseCaptureRequest,
  type ComputerUseElement,
  type ComputerUseFindRequest,
  type ComputerUseService,
  type ComputerUseWindow,
} from "./types.js";

function matchesFind(
  el: ComputerUseElement,
  request: ComputerUseFindRequest,
): boolean {
  const role = request.role?.trim().toLowerCase() ?? "";
  const name = request.name?.trim() ?? "";
  const text = request.text?.trim() ?? "";
  if (role && el.role.toLowerCase() !== role) return false;
  const hay = `${el.name} ${el.role}`;
  if (name) {
    if (request.exact === true) {
      if (el.name.toLowerCase() !== name.toLowerCase()) return false;
    } else if (!el.name.toLowerCase().includes(name.toLowerCase())) {
      return false;
    }
  }
  if (text) {
    if (request.exact === true) {
      if (hay.toLowerCase() !== text.toLowerCase()) return false;
    } else if (!hay.toLowerCase().includes(text.toLowerCase())) {
      return false;
    }
  }
  return Boolean(role || name || text);
}

export interface MemoryComputerUseOptions {
  readonly app?: string;
  readonly windowTitle?: string;
  readonly elements?: readonly ComputerUseElement[];
  readonly windows?: readonly ComputerUseWindow[];
  /** Optional PNG for mode=vision|som tests / fixtures. */
  readonly screenshotPng?: Uint8Array;
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
  const app = options.app ?? "MemoryApp";
  const windowTitle = options.windowTitle ?? "Memory Window";
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
          ? options.screenshotPng
            ? mode === "som"
              ? "memory provider screenshot with SOM labels (test fixture)"
              : "memory provider screenshot (test fixture)"
            : "memory provider has no screenshot; AX elements only"
          : undefined;
      return buildCaptureResult({
        mode,
        app,
        windowTitle,
        elements: slice,
        ...(note !== undefined ? { note } : {}),
        ...(options.screenshotPng !== undefined
          ? { screenshotPng: options.screenshotPng }
          : {}),
      });
    },
    async act(request: ComputerUseActRequest): Promise<ComputerUseActResult> {
      if (request.action === "clipboard_set") {
        return {
          ok: true,
          action: "clipboard_set",
          message: "clipboard-set",
          delivery: "memory",
        };
      }
      if (request.action === "clipboard_get") {
        return {
          ok: true,
          action: "clipboard_get",
          message: "",
          delivery: "memory",
        };
      }
      if (request.action === "click") {
        if (request.coordinate !== undefined && request.element === undefined) {
          if (request.headed !== true) {
            throw new ComputerUseError(
              "coordinate click moves the real mouse. Pass headed=true only when the user accepts that.",
              "COMPUTER_USE_BAD_ARGS",
            );
          }
          const [x, y] = request.coordinate;
          return {
            ok: true,
            action: "click",
            message: `clicked coordinate (${x},${y})`,
            delivery: "memory",
          };
        }
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
    async find(request: ComputerUseFindRequest) {
      const role = request.role?.trim() ?? "";
      const name = request.name?.trim() ?? "";
      const text = request.text?.trim() ?? "";
      if (!role && !name && !text) {
        throw new ComputerUseError(
          "find needs role, name, and/or text",
          "COMPUTER_USE_BAD_ARGS",
        );
      }
      lastCaptureGen += 1;
      let matched = elements.filter((el) => matchesFind(el, request));
      if (request.first === true) matched = matched.slice(0, 1);
      const max =
        typeof request.limit === "number" &&
        Number.isFinite(request.limit) &&
        request.limit > 0
          ? Math.floor(request.limit)
          : 80;
      const slice = matched.slice(0, max).map((e, i) => ({
        ...e,
        index: i + 1,
        elementToken: `mem-find-${lastCaptureGen}-${i + 1}`,
      }));
      elements = slice;
      return buildCaptureResult({
        mode: "ax",
        app,
        windowTitle,
        elements: slice,
        note: "delivery=memory find (indices replaced)",
      });
    },
  };
}
