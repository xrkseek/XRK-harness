/**
 * Environment repairs for the client lane (`vitest.client.config.ts`).
 *
 * The lane runs under jsdom, but several browser surfaces the client half
 * depends on are missing from that pairing on this toolchain:
 *
 * 1. Web storage. The lane's config already disables Node's experimental
 *    `localStorage` global (`--no-experimental-webstorage`), which is what
 *    normally leaves jsdom's own storage usable. The fallback below covers
 *    Node builds that do not offer that flag: a dead global there would be
 *    `undefined`, and specs call `localStorage.clear()` unguarded.
 * 2. jsdom implements no `PointerEvent`, so pointer-gesture specs cannot
 *    construct one.
 * 3. jsdom ships no Range geometry — `Range.prototype.getBoundingClientRect`
 *    is absent. Lexical's selection commit calls it on the live range, so
 *    every contenteditable composer update throws without a zero-rect stub.
 * 4. Some jsdom builds omit `URL.createObjectURL` / `revokeObjectURL`; draft
 *    image benches spy on those and need a real function to wrap.
 *
 * Patches are guarded, so they are no-ops wherever the real global exists
 * — including the lane's node-environment specs (`*-styles.client.spec.ts`),
 * which never see a `window` at all.
 */

/** @returns whether `value` behaves like a Web Storage instance. */
function isStorage(value: unknown): boolean {
  return typeof (value as Storage | null)?.clear === "function";
}

/** In-memory `Storage`, for a host whose web-storage global shadowed jsdom's. */
function memoryStorage(): Storage {
  const entries = new Map<string, string>();
  return {
    get length() {
      return entries.size;
    },
    key: (index: number) => [...entries.keys()][index] ?? null,
    getItem: (key: string) => entries.get(String(key)) ?? null,
    setItem: (key: string, value: string) => {
      entries.set(String(key), String(value));
    },
    removeItem: (key: string) => {
      entries.delete(String(key));
    },
    clear: () => {
      entries.clear();
    },
  } as unknown as Storage;
}

/** Re-define a global the environment left unusable. */
function defineGlobal(name: string, value: unknown): void {
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
}

if (typeof window !== "undefined") {
  const globals = globalThis as unknown as Record<string, unknown>;
  for (const name of ["localStorage", "sessionStorage"] as const) {
    if (isStorage(globals[name])) continue;
    defineGlobal(name, isStorage(window[name]) ? window[name] : memoryStorage());
  }
  if (typeof globals.PointerEvent !== "function") {
    /** Pointer fields the gesture specs read; jsdom's `MouseEvent` carries the rest. */
    class PointerEventPolyfill extends MouseEvent {
      readonly pointerId: number;
      readonly width: number;
      readonly height: number;
      readonly pressure: number;
      readonly tangentialPressure: number;
      readonly tiltX: number;
      readonly tiltY: number;
      readonly twist: number;
      readonly pointerType: string;
      readonly isPrimary: boolean;

      constructor(type: string, init: PointerEventInit = {}) {
        super(type, init);
        this.pointerId = init.pointerId ?? 0;
        this.width = init.width ?? 1;
        this.height = init.height ?? 1;
        this.pressure = init.pressure ?? 0;
        this.tangentialPressure = init.tangentialPressure ?? 0;
        this.tiltX = init.tiltX ?? 0;
        this.tiltY = init.tiltY ?? 0;
        this.twist = init.twist ?? 0;
        this.pointerType = init.pointerType ?? "mouse";
        this.isPrimary = init.isPrimary ?? false;
      }
    }
    defineGlobal("PointerEvent", PointerEventPolyfill);
  }

  /** Zero DOMRect — enough for Lexical selection commit and caret reveal math. */
  const zeroRect = (): DOMRect =>
    ({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      bottom: 0,
      right: 0,
      width: 0,
      height: 0,
      toJSON: () => ({}),
    }) as DOMRect;

  if (typeof Range !== "undefined" && typeof Range.prototype.getBoundingClientRect !== "function") {
    Range.prototype.getBoundingClientRect = zeroRect;
  }
  if (typeof Range !== "undefined" && typeof Range.prototype.getClientRects !== "function") {
    Range.prototype.getClientRects = () => ({
      length: 0,
      item: () => null,
      [Symbol.iterator]: function* () {},
    }) as DOMRectList;
  }

  if (typeof URL.createObjectURL !== "function") {
    URL.createObjectURL = () => "blob:stub";
  }
  if (typeof URL.revokeObjectURL !== "function") {
    URL.revokeObjectURL = () => {};
  }

  // jsdom's Element.scrollIntoView is often missing or non-callable; Menu /
  // ModelSelect virtual-highlight effects call it after arrow navigation.
  if (typeof Element !== "undefined" && typeof Element.prototype.scrollIntoView !== "function") {
    Element.prototype.scrollIntoView = function scrollIntoView() {};
  }

  // jsdom omits DataTransfer; paste/drop benches that construct one need a
  // minimal items bag (kind/type/getAsFile) matching the ClipboardItem shape
  // the composer paste handler reads.
  if (typeof DataTransfer === "undefined") {
    class DataTransferPolyfill {
      readonly items = {
        _files: [] as File[],
        add(file: File): void {
          this._files.push(file);
        },
        [Symbol.iterator]: function* (this: { _files: File[] }) {
          for (const file of this._files) {
            yield {
              kind: "file" as const,
              type: file.type,
              getAsFile: () => file,
            };
          }
        },
      };
      getData(): string {
        return "";
      }
    }
    defineGlobal("DataTransfer", DataTransferPolyfill);
  }
}
