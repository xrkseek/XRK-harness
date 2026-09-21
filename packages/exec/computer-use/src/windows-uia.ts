/**
 * Windows UI Automation Provider — AX snapshot + Invoke/ValuePattern input.
 * Delivery is "uia" (not cua-driver background SPI). Opt-in via XRK_COMPUTER_USE=1.
 */
import { spawn } from "node:child_process";
import { buildCaptureResult, DEFAULT_MAX_ELEMENTS } from "./format.js";
import {
  ComputerUseError,
  type ComputerUseActRequest,
  type ComputerUseActResult,
  type ComputerUseCaptureRequest,
  type ComputerUseElement,
  type ComputerUseService,
  type ComputerUseWindow,
} from "./types.js";

export type PowerShellRunner = (
  script: string,
  signal?: AbortSignal,
) => Promise<string>;

async function defaultRunPowerShell(
  script: string,
  signal?: AbortSignal,
): Promise<string> {
  return await new Promise((resolve, reject) => {
    const child = spawn(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
      { windowsHide: true },
    );
    let stdout = "";
    let stderr = "";
    const onAbort = () => {
      child.kill();
      reject(new ComputerUseError("aborted", "COMPUTER_USE_BACKEND"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (err) => {
      signal?.removeEventListener("abort", onAbort);
      reject(
        new ComputerUseError(
          `powershell failed: ${err.message}`,
          "COMPUTER_USE_BACKEND",
        ),
      );
    });
    child.on("close", (code) => {
      signal?.removeEventListener("abort", onAbort);
      if (code !== 0) {
        reject(
          new ComputerUseError(
            `powershell exit ${code}: ${stderr.trim() || stdout.trim() || "no output"}`,
            "COMPUTER_USE_BACKEND",
          ),
        );
        return;
      }
      resolve(stdout.trim());
    });
  });
}

function parseJson<T>(raw: string, label: string): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new ComputerUseError(
      `invalid ${label} JSON from UIA backend`,
      "COMPUTER_USE_BACKEND",
    );
  }
}

/** Compact PowerShell: walk focused (or named) window for ControlType+Name. */
function captureScript(appFilter: string | undefined, maxElements: number): string {
  const appLit = JSON.stringify(appFilter ?? "");
  return `
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$ErrorActionPreference = 'Stop'
$appFilter = ${appLit}
$max = ${maxElements}
$root = [System.Windows.Automation.AutomationElement]::FocusedElement
if (-not $root) { $root = [System.Windows.Automation.AutomationElement]::RootElement }
$walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
$win = $root
while ($win -and $win.Current.ControlType -ne [System.Windows.Automation.ControlType]::Window) {
  $parent = $walker.GetParent($win)
  if (-not $parent) { break }
  $win = $parent
}
if (-not $win) { $win = $root }
$title = $win.Current.Name
$app = $win.Current.Name
if ($appFilter -ne '' -and $title -notlike "*$appFilter*" -and $app -notlike "*$appFilter*") {
  $cond = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::NameProperty, $appFilter)
  $found = [System.Windows.Automation.AutomationElement]::RootElement.FindFirst(
    [System.Windows.Automation.TreeScope]::Children, $cond)
  if ($found) { $win = $found; $title = $win.Current.Name; $app = $win.Current.Name }
}
$elements = New-Object System.Collections.Generic.List[object]
$stack = New-Object System.Collections.Stack
$stack.Push($win)
$idx = 0
while ($stack.Count -gt 0 -and $idx -lt $max) {
  $el = $stack.Pop()
  $child = $walker.GetFirstChild($el)
  while ($child) {
    $stack.Push($child)
    $child = $walker.GetNextSibling($child)
  }
  $ct = $el.Current.ControlType.ProgrammaticName
  $name = $el.Current.Name
  if ([string]::IsNullOrWhiteSpace($name) -and [string]::IsNullOrWhiteSpace($ct)) { continue }
  if ($ct -eq 'ControlType.Window' -or $ct -eq 'ControlType.Pane') { continue }
  $idx++
  $r = $el.Current.BoundingRectangle
  $elements.Add([pscustomobject]@{
    index = $idx
    role = ($ct -replace '^ControlType\\.','')
    name = ($(if ($name) { $name } else { $ct }))
    x = [int]$r.X; y = [int]$r.Y; width = [int]$r.Width; height = [int]$r.Height
    runtimeId = ($el.GetRuntimeId() -join ',')
  })
}
@{ app = $app; windowTitle = $title; elements = $elements } | ConvertTo-Json -Depth 5 -Compress
`.trim();
}

function clickScript(runtimeId: string): string {
  const idLit = JSON.stringify(runtimeId);
  return `
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$ErrorActionPreference = 'Stop'
$ids = @((${idLit}) -split ',' | ForEach-Object { [int]$_ })
$el = [System.Windows.Automation.AutomationElement]::AutomationElementFromRuntimeId($ids)
if (-not $el) { throw 'element not found' }
$inv = $null
if ($el.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$inv)) {
  $inv.Invoke()
  'clicked-invoke'
  return
}
$sel = $null
if ($el.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern, [ref]$sel)) {
  $sel.Select()
  'clicked-select'
  return
}
throw 'element is not invokable via UIA'
`.trim();
}

function typeScript(runtimeId: string, text: string): string {
  const idLit = JSON.stringify(runtimeId);
  const textLit = JSON.stringify(text);
  return `
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Windows.Forms
$ErrorActionPreference = 'Stop'
$ids = @((${idLit}) -split ',' | ForEach-Object { [int]$_ })
$el = [System.Windows.Automation.AutomationElement]::AutomationElementFromRuntimeId($ids)
if (-not $el) { throw 'element not found' }
$val = $null
if ($el.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$val)) {
  $val.SetValue(${textLit})
  'typed-value'
  return
}
$el.SetFocus()
[System.Windows.Forms.SendKeys]::SendWait(${textLit})
'typed-sendkeys'
`.trim();
}

function listWindowsScript(): string {
  return `
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$ErrorActionPreference = 'Stop'
$root = [System.Windows.Automation.AutomationElement]::RootElement
$cond = New-Object System.Windows.Automation.PropertyCondition(
  [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
  [System.Windows.Automation.ControlType]::Window)
$wins = $root.FindAll([System.Windows.Automation.TreeScope]::Children, $cond)
$list = @()
foreach ($w in $wins) {
  $n = $w.Current.Name
  if ([string]::IsNullOrWhiteSpace($n)) { continue }
  $list += [pscustomobject]@{ title = $n; pid = $w.Current.ProcessId; app = $n }
}
,@($list) | ConvertTo-Json -Compress
`.trim();
}

export interface WindowsUiAutomationOptions {
  readonly runPowerShell?: PowerShellRunner;
}

interface CapturePayload {
  readonly app?: string;
  readonly windowTitle?: string;
  readonly elements?: ReadonlyArray<{
    readonly index: number;
    readonly role: string;
    readonly name: string;
    readonly x?: number;
    readonly y?: number;
    readonly width?: number;
    readonly height?: number;
    readonly runtimeId?: string;
  }>;
}

/**
 * Windows UI Automation Provider. Requires a desktop session; opt-in with XRK_COMPUTER_USE=1.
 */
export function createWindowsUiAutomationProvider(
  options: WindowsUiAutomationOptions = {},
): ComputerUseService {
  const run = options.runPowerShell ?? defaultRunPowerShell;
  let tokens = new Map<number, string>();

  return {
    providerId: "windows-uia",
    delivery: "uia",
    async capture(request?: ComputerUseCaptureRequest, signal?: AbortSignal) {
      const max = request?.maxElements ?? DEFAULT_MAX_ELEMENTS;
      const raw = await run(captureScript(request?.app, max), signal);
      const payload = parseJson<CapturePayload>(raw, "capture");
      tokens = new Map();
      const elements: ComputerUseElement[] = (payload.elements ?? []).map((e) => {
        if (e.runtimeId) tokens.set(e.index, e.runtimeId);
        return {
          index: e.index,
          role: e.role || "unknown",
          name: e.name || "",
          ...(e.x !== undefined
            ? {
                bounds: {
                  x: e.x ?? 0,
                  y: e.y ?? 0,
                  width: e.width ?? 0,
                  height: e.height ?? 0,
                },
              }
            : {}),
          ...(e.runtimeId
            ? { elementToken: `uia-${e.runtimeId}` }
            : {}),
        };
      });
      const mode = request?.mode ?? "ax";
      const note =
        mode === "vision" || mode === "som"
          ? "windows-uia has no screenshot overlay yet; AX elements only (delivery=uia, not background SPI)"
          : "delivery=uia (UI Automation; not cua-driver background SPI)";
      return buildCaptureResult({
        mode: mode === "vision" ? "ax" : mode,
        app: payload.app ?? "",
        windowTitle: payload.windowTitle ?? "",
        elements,
        note,
      });
    },
    async act(
      request: ComputerUseActRequest,
      signal?: AbortSignal,
    ): Promise<ComputerUseActResult> {
      if (request.action === "scroll" || request.action === "key") {
        throw new ComputerUseError(
          `${request.action} via windows-uia is not implemented yet; inject a custom ComputerUseService or use cua-driver later`,
          "COMPUTER_USE_UNAVAILABLE",
        );
      }
      if (request.element === undefined) {
        throw new ComputerUseError(
          "element index is required",
          "COMPUTER_USE_BAD_ARGS",
        );
      }
      const runtimeId = tokens.get(request.element);
      if (!runtimeId) {
        throw new ComputerUseError(
          `stale or unknown element [${request.element}] — capture again`,
          "COMPUTER_USE_STALE_ELEMENT",
        );
      }
      if (request.action === "click") {
        const out = await run(clickScript(runtimeId), signal);
        return {
          ok: true,
          action: "click",
          message: out || "clicked",
          delivery: "uia",
        };
      }
      if (request.action === "type") {
        const out = await run(typeScript(runtimeId, request.text ?? ""), signal);
        return {
          ok: true,
          action: "type",
          message: out || "typed",
          delivery: "uia",
        };
      }
      throw new ComputerUseError("unsupported action", "COMPUTER_USE_BAD_ARGS");
    },
    async listWindows(signal?: AbortSignal) {
      const raw = await run(listWindowsScript(), signal);
      const parsed = parseJson<ComputerUseWindow[] | ComputerUseWindow>(
        raw,
        "windows",
      );
      return Array.isArray(parsed) ? parsed : [parsed];
    },
  };
}
