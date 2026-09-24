/**
 * Windows UI Automation Provider — AX snapshot + Invoke/ValuePattern input.
 * Delivery is "uia" (not cua-driver background SPI). Opt-in via XRK_COMPUTER_USE=1
 * or Settings → Plugins → Computer use (mode=uia).
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { buildCaptureResult, DEFAULT_MAX_ELEMENTS } from "./format.js";
import { escapeSendKeys, mapKeysToSendKeys } from "./keys.js";
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

/** UIA calls block forever when the target app stops pumping messages. */
export const DEFAULT_POWERSHELL_TIMEOUT_MS = 25_000;

/**
 * Windows PowerShell 5.1 writes stdout in the OEM codepage (GBK on zh-CN), which
 * mangles every CJK `Name` when decoded as UTF-8. The prelude pins both streams
 * to UTF-8 so the JSON payload survives round-trip.
 */
const PS_PRELUDE = `
$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}
try { [Console]::ErrorEncoding = [System.Text.Encoding]::UTF8 } catch {}
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
function XrkSafeInt {
  param([double]$Value)
  if ([double]::IsNaN($Value) -or [double]::IsInfinity($Value)) { return $null }
  if ($Value -lt [int]::MinValue -or $Value -gt [int]::MaxValue) { return $null }
  return [int][Math]::Round($Value, [System.MidpointRounding]::AwayFromZero)
}
function XrkTopWindows {
  $cond = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
    [System.Windows.Automation.ControlType]::Window)
  return [System.Windows.Automation.AutomationElement]::RootElement.FindAll(
    [System.Windows.Automation.TreeScope]::Children, $cond)
}
function XrkProcName([int]$targetPid) {
  try { return (Get-Process -Id $targetPid -ErrorAction SilentlyContinue).ProcessName } catch { return '' }
}
function XrkMatch([string]$hay, [string]$needle) {
  if ([string]::IsNullOrWhiteSpace($needle)) { return $true }
  if ([string]::IsNullOrEmpty($hay)) { return $false }
  return ($hay.IndexOf($needle, [System.StringComparison]::OrdinalIgnoreCase) -ge 0)
}
`;

/**
 * `powershell.exe` is resolvable only when the parent process inherited the
 * WindowsPowerShell directory on PATH. A GUI/service parent (Desktop host, a
 * vitest worker) often has a trimmed PATH and the spawn then dies with ENOENT,
 * which reads to the model as "computer use is broken". Windows PowerShell 5.1
 * is deliberate: the UIAutomation client assemblies ship with it, `pwsh` 7 has
 * them only if the optional module is installed.
 */
function powerShellExe(): string {
  const root =
    process.env["SystemRoot"] ?? process.env["WINDIR"] ?? "C:\\Windows";
  const fixed = join(
    root,
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe",
  );
  return existsSync(fixed) ? fixed : "powershell.exe";
}

async function defaultRunPowerShell(
  script: string,
  signal?: AbortSignal,
  timeoutMs = DEFAULT_POWERSHELL_TIMEOUT_MS,
): Promise<string> {
  return await new Promise((resolve, reject) => {
    const child = spawn(
      powerShellExe(),
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
      { windowsHide: true },
    );
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(
        new ComputerUseError(
          `UIA script timed out after ${timeoutMs}ms (target app may be busy or not pumping UIA messages)`,
          "COMPUTER_USE_BACKEND",
        ),
      );
    }, Math.max(1_000, timeoutMs));
    const onAbort = () => {
      if (settled) return;
      settled = true;
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
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(
        new ComputerUseError(
          `powershell failed: ${err.message}`,
          "COMPUTER_USE_BACKEND",
        ),
      );
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      if (code !== 0) {
        const detail = (stderr.trim() || stdout.trim() || "no output").slice(-600);
        reject(
          new ComputerUseError(
            `powershell exit ${code}: ${detail}`,
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
    const snippet = raw.trim().slice(0, 240) || "(empty stdout)";
    throw new ComputerUseError(
      `invalid ${label} JSON from UIA backend: ${snippet}`,
      "COMPUTER_USE_BACKEND",
    );
  }
}

/**
 * Embed a string as a PowerShell single-quoted literal. `JSON.stringify` emits
 * double quotes, where PowerShell expands `$` and a stray `'` breaks the script.
 */
function psStr(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export interface CaptureScriptOptions {
  readonly app?: string;
  readonly maxElements?: number;
  /** Keep elements whose BoundingRectangle is empty (offscreen / unrendered). */
  readonly includeOffscreen?: boolean;
}

/**
 * Walk one top-level window (by app/title match, else the focused window) and
 * emit ControlType+Name elements as JSON.
 */
export function captureScript(options: CaptureScriptOptions = {}): string {
  const appLit = psStr(options.app?.trim() ?? "");
  const max = Math.max(1, Math.floor(options.maxElements ?? DEFAULT_MAX_ELEMENTS));
  const keepOffscreen = options.includeOffscreen ? "$true" : "$false";
  return `${PS_PRELUDE}
$appFilter = ${appLit}
$max = ${max}
$keepOffscreen = ${keepOffscreen}
$maxDepth = 60
# Cross-process UIA calls are expensive; bound the walk so a giant browser tree
# cannot outrun the PowerShell timeout.
$visitCap = [Math]::Max(300, $max * 12 + 200)
$walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker

$focusedWin = $null
try {
  $fe = [System.Windows.Automation.AutomationElement]::FocusedElement
  $cur = $fe
  while ($cur -and $cur.Current.ControlType -ne [System.Windows.Automation.ControlType]::Window) {
    $p = $walker.GetParent($cur)
    if (-not $p) { break }
    $cur = $p
  }
  if ($cur) { $focusedWin = $cur }
} catch {}

$all = XrkTopWindows
$win = $null
$byProc = $null
$byTitle = $null
$candidates = New-Object System.Collections.Generic.List[string]
foreach ($w in $all) {
  $t = ''
  try { $t = $w.Current.Name } catch {}
  $pn = XrkProcName $w.Current.ProcessId
  $cn = ''
  try { $cn = $w.Current.ClassName } catch {}
  if (-not [string]::IsNullOrWhiteSpace($t)) { $candidates.Add($t + ' [' + $pn + ']') }
  if ($appFilter -eq '') {
    if (-not $win -and $focusedWin -and $w.Current.NativeWindowHandle -eq $focusedWin.Current.NativeWindowHandle) {
      $win = $w
    } elseif (-not $win -and -not [string]::IsNullOrWhiteSpace($t)) {
      $win = $w
    }
    continue
  }
  # A process/class hit beats a title that merely mentions the app (a browser tab
  # titled "...QQ..." must not shadow the real QQ window).
  if (-not $byProc -and ((XrkMatch $pn $appFilter) -or (XrkMatch $cn $appFilter))) { $byProc = $w }
  if (-not $byTitle -and (XrkMatch $t $appFilter)) { $byTitle = $w }
}
if ($appFilter -ne '' -and -not $win) {
  if ($focusedWin) {
    $ft = ''
    try { $ft = $focusedWin.Current.Name } catch {}
    $fpn = XrkProcName $focusedWin.Current.ProcessId
    if ((XrkMatch $fpn $appFilter) -or (XrkMatch $ft $appFilter)) { $win = $focusedWin }
  }
  if (-not $win) { $win = $byProc }
  if (-not $win) { $win = $byTitle }
}
if (-not $win) {
  @{ error = 'app-not-found'; app = ''; windowTitle = ''; elements = @(); candidates = $candidates } | ConvertTo-Json -Depth 6 -Compress
  return
}

$title = ''
try { $title = $win.Current.Name } catch {}
$targetPid = $win.Current.ProcessId
$appLabel = XrkProcName $targetPid
if ([string]::IsNullOrWhiteSpace($appLabel)) { $appLabel = $title }

$elements = New-Object System.Collections.Generic.List[object]
$seen = New-Object System.Collections.Generic.HashSet[string]
$queue = New-Object System.Collections.Generic.Queue[object]
$queue.Enqueue(@{ el = $win; d = 0 })
$idx = 0
$visited = 0
$dropped = 0
$exhausted = $true
while ($queue.Count -gt 0 -and $idx -lt $max -and $visited -lt $visitCap) {
  $item = $queue.Dequeue()
  $el = $item.el
  $depth = $item.d
  $visited++
  $rid = ''
  try { $rid = ($el.GetRuntimeId() -join ',') } catch {}
  if ($rid -ne '' -and -not $seen.Add($rid)) { continue }
  $ct = ''
  try { $ct = $el.Current.ControlType.ProgrammaticName } catch {}
  $name = ''
  try { $name = $el.Current.Name } catch {}
  # Always expand (bounded by depth): gating expansion on $depth -gt 0 meant the
  # root window never yielded children and every capture came back empty.
  if ($depth -lt $maxDepth) {
    try {
      $child = $walker.GetFirstChild($el)
      $guard = 0
      while ($child -and $guard -lt 500 -and ($visited + $guard) -lt $visitCap) {
        $queue.Enqueue(@{ el = $child; d = ($depth + 1) })
        $guard++
        $child = $walker.GetNextSibling($child)
      }
    } catch { $dropped++ }
  }
  try {
    if ($el.Current.ProcessId -ne $targetPid) { continue }
    $role = ($ct -replace '^ControlType\\.','')
    if ($depth -eq 0) { continue }
    if (($role -eq 'Window' -or $role -eq 'Pane') -and [string]::IsNullOrWhiteSpace($name)) { continue }
    $r = $el.Current.BoundingRectangle
    $x = XrkSafeInt $r.X
    $y = XrkSafeInt $r.Y
    $wd = XrkSafeInt $r.Width
    $ht = XrkSafeInt $r.Height
    $offscreen = ($null -eq $x -or $null -eq $y -or $null -eq $wd -or $null -eq $ht -or $wd -le 0 -or $ht -le 0)
    if ($offscreen -and -not $keepOffscreen) { continue }
    if ([string]::IsNullOrWhiteSpace($name) -and [string]::IsNullOrWhiteSpace($role)) { continue }
    $idx++
    $display = $name
    if ([string]::IsNullOrWhiteSpace($display)) { $display = $ct }
    $elements.Add([pscustomobject]@{
      index = $idx
      role = $role
      name = $display
      x = $x; y = $y; width = $wd; height = $ht
      runtimeId = $rid
    })
  } catch { $dropped++ }
}
if ($queue.Count -gt 0 -and $visited -ge $visitCap) { $exhausted = $false }
@{ app = $appLabel; windowTitle = $title; elements = $elements; visited = $visited; dropped = $dropped; exhausted = $exhausted } | ConvertTo-Json -Depth 6 -Compress
`.trim();
}

/** Re-resolve an element by runtime id; Invoke → Select → focus + mouse click. */
function clickScript(runtimeId: string): string {
  const idLit = psStr(runtimeId);
  return `${PS_PRELUDE}
$ids = @((${idLit}) -split ',' | ForEach-Object { [int]$_ })
$el = [System.Windows.Automation.AutomationElement]::AutomationElementFromRuntimeId($ids)
if (-not $el) { throw 'element not found (window changed? capture again)' }
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
$box = $el.Current.BoundingRectangle
if ($null -eq (XrkSafeInt $box.X) -or $null -eq (XrkSafeInt $box.Y)) {
  throw 'element is not invokable via UIA and has no on-screen bounds to click'
}
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class XrkClick {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, int data, UIntPtr extra);
  public const uint LEFTDOWN = 0x0002;
  public const uint LEFTUP = 0x0004;
}
"@
try { $el.SetFocus() } catch {}
Start-Sleep -Milliseconds 40
$r = $el.Current.BoundingRectangle
$x = XrkSafeInt ($r.X + $r.Width / 2)
$y = XrkSafeInt ($r.Y + $r.Height / 2)
[void][XrkClick]::SetCursorPos($x, $y)
[void][XrkClick]::mouse_event([XrkClick]::LEFTDOWN, 0, 0, 0, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 30
[void][XrkClick]::mouse_event([XrkClick]::LEFTUP, 0, 0, 0, [UIntPtr]::Zero)
'clicked-point'
`.trim();
}

/**
 * ValuePattern first, then clipboard paste (CJK-safe), then escaped SendKeys.
 * Raw SendKeys mangles `+^%~()` and drops non-ASCII, so the caller passes both
 * the literal text and a SendKeys-escaped copy.
 */
function typeScript(runtimeId: string, text: string): string {
  const idLit = psStr(runtimeId);
  const textLit = psStr(text);
  const keysLit = psStr(escapeSendKeys(text));
  return `${PS_PRELUDE}
Add-Type -AssemblyName System.Windows.Forms
$text = ${textLit}
$escaped = ${keysLit}
$ids = @((${idLit}) -split ',' | ForEach-Object { [int]$_ })
$el = [System.Windows.Automation.AutomationElement]::AutomationElementFromRuntimeId($ids)
if (-not $el) { throw 'element not found (window changed? capture again)' }
$val = $null
if ($el.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$val)) {
  try {
    if (-not $val.Current.IsReadOnly) {
      $val.SetValue($text)
      'typed-value'
      return
    }
  } catch {}
}
try { $el.SetFocus() } catch {}
Start-Sleep -Milliseconds 40
$pasted = $false
$old = $null
$clipReadable = $false
try { $old = Get-Clipboard -ErrorAction Stop; $clipReadable = $true } catch {
  try { $old = Get-Clipboard -Raw -ErrorAction Stop; $clipReadable = $true } catch {}
}
try {
  Set-Clipboard -Value $text
  [System.Windows.Forms.SendKeys]::SendWait('^v')
  Start-Sleep -Milliseconds 30
  $pasted = $true
} catch {}
if ($pasted -and $clipReadable) {
  try {
    if ($null -ne $old) { Set-Clipboard -Value ($old -join [Environment]::NewLine) } else { Set-Clipboard -Value '' }
  } catch {}
}
if ($pasted) { 'typed-paste' } else {
  [System.Windows.Forms.SendKeys]::SendWait($escaped)
  'typed-sendkeys'
}
`.trim();
}

function keyScript(keysSendWait: string, runtimeId?: string): string {
  const keysLit = psStr(keysSendWait);
  const focusBlock = runtimeId
    ? `
$ids = @((${psStr(runtimeId)}) -split ',' | ForEach-Object { [int]$_ })
$el = [System.Windows.Automation.AutomationElement]::AutomationElementFromRuntimeId($ids)
if (-not $el) { throw 'element not found (window changed? capture again)' }
try { $el.SetFocus() } catch {}
Start-Sleep -Milliseconds 40
`
    : "";
  return `${PS_PRELUDE}${focusBlock}Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.SendKeys]::SendWait(${keysLit})
'keyed'
`.trim();
}

function scrollScript(options: {
  readonly runtimeId?: string;
  readonly direction: "up" | "down" | "left" | "right";
  readonly amount: number;
}): string {
  const amount = Math.max(1, Math.min(50, Math.floor(options.amount)));
  const dir = options.direction;
  const idLit = options.runtimeId ? psStr(options.runtimeId) : "''";
  return `${PS_PRELUDE}
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$dir = ${psStr(dir)}
$amount = ${amount}
$runtimeId = ${idLit}
$el = $null
if ($runtimeId -ne '') {
  $ids = @(($runtimeId) -split ',' | ForEach-Object { [int]$_ })
  $el = [System.Windows.Automation.AutomationElement]::AutomationElementFromRuntimeId($ids)
  if (-not $el) { throw 'element not found (window changed? capture again)' }
}
if ($el) {
  $scroll = $null
  if ($el.TryGetCurrentPattern([System.Windows.Automation.ScrollPattern]::Pattern, [ref]$scroll)) {
    $horiz = [System.Windows.Automation.ScrollAmount]::NoAmount
    $vert = [System.Windows.Automation.ScrollAmount]::NoAmount
    $large = [System.Windows.Automation.ScrollAmount]::LargeIncrement
    $largeNeg = [System.Windows.Automation.ScrollAmount]::LargeDecrement
    $small = [System.Windows.Automation.ScrollAmount]::SmallIncrement
    $smallNeg = [System.Windows.Automation.ScrollAmount]::SmallDecrement
    for ($i = 0; $i -lt $amount; $i++) {
      if ($dir -eq 'down') { $vert = $large }
      elseif ($dir -eq 'up') { $vert = $largeNeg }
      elseif ($dir -eq 'right') { $horiz = $small }
      elseif ($dir -eq 'left') { $horiz = $smallNeg }
      $scroll.Scroll($horiz, $vert)
    }
    'scrolled-pattern'
    return
  }
  try { $el.SetFocus() } catch {}
  Start-Sleep -Milliseconds 40
  $r = $el.Current.BoundingRectangle
  $x = XrkSafeInt ($r.X + $r.Width / 2)
  $y = XrkSafeInt ($r.Y + $r.Height / 2)
  if ($null -ne $x -and $null -ne $y) {
    [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point($x, $y)
  }
}
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class XrkMouseWheel {
  [DllImport("user32.dll")]
  public static extern void mouse_event(uint dwFlags, uint dx, uint dy, int dwData, UIntPtr dwExtraInfo);
  public const uint MOUSEEVENTF_WHEEL = 0x0800;
  public const uint MOUSEEVENTF_HWHEEL = 0x01000;
}
"@
$delta = 120 * $amount
if ($dir -eq 'down' -or $dir -eq 'right') { $delta = -$delta }
$flags = [XrkMouseWheel]::MOUSEEVENTF_WHEEL
if ($dir -eq 'left' -or $dir -eq 'right') { $flags = [XrkMouseWheel]::MOUSEEVENTF_HWHEEL }
[XrkMouseWheel]::mouse_event($flags, 0, 0, $delta, [UIntPtr]::Zero)
'scrolled-wheel'
`.trim();
}

/**
 * Wrap the list in an object and hand the `List` straight to ConvertTo-Json:
 * a bare piped array serializes as `{"value":[…],"Count":n}` (which reads back as
 * one window), and `@($list)` around a Generic List makes ConvertTo-Json throw
 * "Argument types do not match".
 */
function listWindowsScript(): string {
  return `${PS_PRELUDE}
$root = [System.Windows.Automation.AutomationElement]::RootElement
$cond = New-Object System.Windows.Automation.PropertyCondition(
  [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
  [System.Windows.Automation.ControlType]::Window)
$wins = $root.FindAll([System.Windows.Automation.TreeScope]::Children, $cond)
$list = New-Object System.Collections.Generic.List[object]
foreach ($w in $wins) {
  $n = ''
  try { $n = $w.Current.Name } catch {}
  $proc = XrkProcName $w.Current.ProcessId
  if ([string]::IsNullOrWhiteSpace($n) -and [string]::IsNullOrWhiteSpace($proc)) { continue }
  $list.Add([pscustomobject]@{ title = $n; pid = $w.Current.ProcessId; app = $proc })
}
@{ windows = $list } | ConvertTo-Json -Depth 5 -Compress
`.trim();
}

export interface WindowsUiAutomationOptions {
  readonly runPowerShell?: PowerShellRunner;
  /** Hard kill for one UIA script; guards against a wedged target app. */
  readonly timeoutMs?: number;
}

interface CaptureElementPayload {
  readonly index: number;
  readonly role: string;
  readonly name: string;
  readonly x?: number | null;
  readonly y?: number | null;
  readonly width?: number | null;
  readonly height?: number | null;
  readonly runtimeId?: string;
}

interface CapturePayload {
  readonly error?: string;
  readonly app?: string;
  readonly windowTitle?: string;
  readonly elements?: ReadonlyArray<CaptureElementPayload>;
  readonly candidates?: ReadonlyArray<string>;
  readonly visited?: number;
  readonly dropped?: number;
  /** False when the visit budget ended with nodes still queued. */
  readonly exhausted?: boolean;
}

interface ListWindowsPayload {
  readonly windows?: ReadonlyArray<ComputerUseWindow>;
}

function finite(...values: ReadonlyArray<number | undefined | null>): boolean {
  return values.every((v) => typeof v === "number" && Number.isFinite(v));
}

/** PowerShell can emit `{}` or `{"value":…}` where an array was expected. */
function payloadList<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

/**
 * Windows UI Automation Provider. Requires a desktop session; opt-in with XRK_COMPUTER_USE=1.
 */
export function createWindowsUiAutomationProvider(
  options: WindowsUiAutomationOptions = {},
): ComputerUseService {
  const run =
    options.runPowerShell ??
    ((script, signal) =>
      defaultRunPowerShell(script, signal, options.timeoutMs));
  let tokens = new Map<number, string>();

  async function runCapture(
    request: ComputerUseCaptureRequest | undefined,
    signal: AbortSignal | undefined,
    includeOffscreen: boolean,
  ): Promise<CapturePayload> {
    const max = request?.maxElements ?? DEFAULT_MAX_ELEMENTS;
    const raw = await run(
      captureScript({
        ...(request?.app !== undefined ? { app: request.app } : {}),
        maxElements: max,
        includeOffscreen,
      }),
      signal,
    );
    return parseJson<CapturePayload>(raw, "capture");
  }

  return {
    providerId: "windows-uia",
    delivery: "uia",
    async capture(request?: ComputerUseCaptureRequest, signal?: AbortSignal) {
      let payload = await runCapture(request, signal, false);
      // Chromium / Electron builds its UIA tree lazily and many widgets report an
      // empty BoundingRectangle on the first pass — retry once keeping offscreen
      // nodes instead of handing the model a 0-element snapshot.
      if (!payload.error && payloadList<CaptureElementPayload>(payload.elements).length === 0) {
        const retry = await runCapture(request, signal, true);
        if (!retry.error) payload = retry;
      }
      if (payload.error === "app-not-found") {
        const wanted = String(request?.app ?? "").trim();
        const candidates = payloadList<string>(payload.candidates).slice(0, 8).join("; ");
        throw new ComputerUseError(
          `no window matches "${wanted}"${candidates ? ` — open windows: ${candidates}` : ""}`,
          "COMPUTER_USE_BAD_ARGS",
        );
      }
      tokens = new Map();
      const elements: ComputerUseElement[] = payloadList<CaptureElementPayload>(
        payload.elements,
      ).map((e) => {
        if (e.runtimeId) tokens.set(e.index, e.runtimeId);
        const hasBounds = finite(e.x, e.y, e.width, e.height);
        return {
          index: e.index,
          role: e.role || "unknown",
          name: e.name || "",
          ...(hasBounds
            ? {
                bounds: {
                  x: e.x as number,
                  y: e.y as number,
                  width: e.width as number,
                  height: e.height as number,
                },
              }
            : {}),
          ...(e.runtimeId
            ? { elementToken: `uia-${e.runtimeId}` }
            : {}),
        };
      });
      const mode = request?.mode ?? "ax";
      const notes: string[] = [
        mode === "vision" || mode === "som"
          ? "windows-uia has no screenshot overlay yet; AX elements only (delivery=uia, not background SPI)"
          : "delivery=uia (UI Automation; not cua-driver background SPI)",
      ];
      if (elements.length === 0) {
        notes.push(
          payload.exhausted === false
            ? "visit budget ran out before any matching node — raise maxElements (the window is large, not empty)"
            : "this window exposed no usable UIA elements (custom-drawn or accessibility-disabled apps expose none) — fall back to action=key, or browser_* when the target is a web page",
        );
      } else if (payload.exhausted === false) {
        notes.push(`tree truncated at ${elements.length} of more nodes; raise maxElements for more`);
      }
      return buildCaptureResult({
        mode: mode === "vision" ? "ax" : mode,
        app: payload.app ?? "",
        windowTitle: payload.windowTitle ?? "",
        elements,
        note: notes.join(" | "),
      });
    },
    async act(
      request: ComputerUseActRequest,
      signal?: AbortSignal,
    ): Promise<ComputerUseActResult> {
      if (request.action === "key") {
        const keysRaw = String(request.keys ?? "").trim();
        if (!keysRaw) {
          throw new ComputerUseError("keys is required", "COMPUTER_USE_BAD_ARGS");
        }
        let sendKeys: string;
        try {
          sendKeys = mapKeysToSendKeys(keysRaw);
        } catch (err) {
          throw new ComputerUseError(
            err instanceof Error ? err.message : String(err),
            "COMPUTER_USE_BAD_ARGS",
          );
        }
        const runtimeId =
          request.element !== undefined
            ? tokens.get(request.element)
            : undefined;
        if (request.element !== undefined && !runtimeId) {
          throw new ComputerUseError(
            `stale or unknown element [${request.element}] — capture again`,
            "COMPUTER_USE_STALE_ELEMENT",
          );
        }
        const out = await run(keyScript(sendKeys, runtimeId), signal);
        return {
          ok: true,
          action: "key",
          message: out || `pressed ${keysRaw}`,
          delivery: "uia",
        };
      }
      if (request.action === "scroll") {
        const direction = request.direction ?? "down";
        if (
          direction !== "up" &&
          direction !== "down" &&
          direction !== "left" &&
          direction !== "right"
        ) {
          throw new ComputerUseError(
            "direction must be up|down|left|right",
            "COMPUTER_USE_BAD_ARGS",
          );
        }
        const amount = request.amount ?? 3;
        const runtimeId =
          request.element !== undefined
            ? tokens.get(request.element)
            : undefined;
        if (request.element !== undefined && !runtimeId) {
          throw new ComputerUseError(
            `stale or unknown element [${request.element}] — capture again`,
            "COMPUTER_USE_STALE_ELEMENT",
          );
        }
        const out = await run(
          scrollScript({
            ...(runtimeId !== undefined ? { runtimeId } : {}),
            direction,
            amount,
          }),
          signal,
        );
        return {
          ok: true,
          action: "scroll",
          message: out || `scrolled ${direction}`,
          delivery: "uia",
        };
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
          `stale or unknown element [${request.element}] — capture again (elements with no runtime id cannot be targeted)`,
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
      const parsed = parseJson<ListWindowsPayload | ComputerUseWindow[]>(
        raw,
        "windows",
      );
      const list = Array.isArray(parsed)
        ? parsed
        : payloadList<ComputerUseWindow>(
            (parsed as ListWindowsPayload | undefined)?.windows,
          );
      return list.map((w) => ({
        title: String(w.title ?? ""),
        ...(w.pid !== undefined ? { pid: w.pid } : {}),
        ...(w.app ? { app: w.app } : {}),
      }));
    },
  };
}
