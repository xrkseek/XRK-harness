/**
 * Local slash helpers for `xrkh tui`, patterned after community dsh-tui
 * (`/model`, `/resume`, `/details`) but wired to Face unary APIs.
 */

export interface FaceModelEntry {
  readonly id: string;
  readonly name?: string;
  readonly reasoning?: {
    readonly efforts?: readonly { readonly id: string; readonly name?: string }[];
    readonly defaultEffort?: string;
  };
}

export interface FaceModelGroup {
  readonly id: string;
  readonly name?: string;
  readonly models: readonly FaceModelEntry[];
}

export interface FaceModelSelection {
  readonly provider: string;
  readonly model: string;
  readonly reasoningEffort?: string;
}

export interface FaceModelsValue {
  readonly current?: FaceModelSelection;
  readonly groups?: readonly FaceModelGroup[];
}

export interface ListedSession {
  readonly sessionId: string;
  readonly title?: string | null;
  readonly updatedAt?: number;
  readonly blank?: boolean;
  readonly cwd?: string;
  readonly running?: boolean;
}

export interface PendingApproval {
  readonly approvalId: string;
  readonly toolName: string;
  readonly reason?: string;
}

/** Split `/cmd rest…` into name + remainder (name lowercased, no leading /). */
export function parseTuiSlash(line: string): {
  readonly name: string;
  readonly arg: string;
} | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("/")) return null;
  const body = trimmed.slice(1);
  const sp = body.search(/\s/);
  if (sp < 0) return { name: body.toLowerCase(), arg: "" };
  return {
    name: body.slice(0, sp).toLowerCase(),
    arg: body.slice(sp).trim(),
  };
}

export function formatModelCatalog(value: FaceModelsValue): string {
  const lines: string[] = [];
  const cur = value.current;
  if (cur) {
    const effort = cur.reasoningEffort ? ` · effort ${cur.reasoningEffort}` : "";
    lines.push(`current  ${cur.provider}/${cur.model}${effort}`);
  } else {
    lines.push("current  (unset)");
  }
  const groups = value.groups ?? [];
  if (groups.length === 0) {
    lines.push("(no models advertised)");
    return `${lines.join("\n")}\n`;
  }
  for (const g of groups) {
    lines.push(`${g.name ?? g.id}:`);
    for (const m of g.models) {
      const efforts = m.reasoning?.efforts?.map((e) => e.id).join("|");
      const effortHint = efforts ? `  [${efforts}]` : "";
      lines.push(`  ${g.id}/${m.id}${effortHint}`);
    }
  }
  lines.push("usage: /model [provider/]model [effort]");
  return `${lines.join("\n")}\n`;
}

/**
 * Resolve `/model` argument against the Face catalog.
 * Empty arg → list. Supports `model`, `provider/model`, and optional effort.
 */
export function resolveModelArg(
  arg: string,
  value: FaceModelsValue,
):
  | { readonly kind: "list" }
  | { readonly kind: "error"; readonly message: string }
  | {
      readonly kind: "select";
      readonly provider: string;
      readonly model: string;
      readonly reasoningEffort?: string;
    } {
  const trimmed = arg.trim();
  if (!trimmed) return { kind: "list" };

  const parts = trimmed.split(/\s+/);
  if (parts.length > 2) {
    return { kind: "error", message: "usage: /model [provider/]model [effort]" };
  }
  const route = parts[0] ?? "";
  const effortArg = parts[1];

  const choices: { provider: string; model: FaceModelEntry }[] = [];
  for (const g of value.groups ?? []) {
    for (const m of g.models) {
      choices.push({ provider: g.id, model: m });
    }
  }

  const matches =
    route.includes("/")
      ? choices.filter((c) => `${c.provider}/${c.model.id}` === route)
      : choices.filter((c) => c.model.id === route);

  if (matches.length === 0) {
    return {
      kind: "error",
      message: `unknown model: ${route}. Run /model to list.`,
    };
  }
  if (matches.length > 1) {
    return {
      kind: "error",
      message: `model "${route}" is on multiple providers; use /model provider/model`,
    };
  }
  const hit = matches[0]!;
  let reasoningEffort: string | undefined;
  if (effortArg !== undefined) {
    const allowed = new Set(
      (hit.model.reasoning?.efforts ?? []).map((e) => e.id),
    );
    if (allowed.size > 0 && !allowed.has(effortArg)) {
      return {
        kind: "error",
        message: `unknown effort "${effortArg}" for ${hit.provider}/${hit.model.id} (try ${[...allowed].join("|")})`,
      };
    }
    reasoningEffort = effortArg;
  } else if (hit.model.reasoning?.defaultEffort) {
    reasoningEffort = hit.model.reasoning.defaultEffort;
  }

  return {
    kind: "select",
    provider: hit.provider,
    model: hit.model.id,
    ...(reasoningEffort !== undefined ? { reasoningEffort } : {}),
  };
}

export function formatSessionList(
  items: readonly ListedSession[],
  currentId: string,
  limit = 12,
): string {
  const sorted = [...items]
    .filter((s) => !s.blank)
    .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
    .slice(0, limit);
  if (sorted.length === 0) {
    return "(no resumable sessions)\nusage: /resume <sessionId>\n";
  }
  const lines = ["recent sessions:"];
  for (const s of sorted) {
    const mark = s.sessionId === currentId ? "*" : " ";
    const title = (s.title ?? "").trim() || "(untitled)";
    const run = s.running ? " · running" : "";
    lines.push(`${mark} ${s.sessionId}  ${title}${run}`);
  }
  lines.push("usage: /resume <sessionId>");
  return `${lines.join("\n")}\n`;
}

export function formatPendingApproval(pending: PendingApproval | undefined): string {
  if (!pending) return "  (no pending approval)\n";
  const reason = pending.reason ? `\n  ${pending.reason}` : "";
  return (
    `  approval ${pending.approvalId} · ${pending.toolName}${reason}\n` +
    "  /approve · /deny · /whitelist\n"
  );
}

export function formatDetails(input: {
  readonly sessionId: string;
  readonly baseUrl: string;
  readonly busy: boolean;
  readonly toolSummary: string;
  readonly pending?: PendingApproval | undefined;
  readonly modelLabel?: string | undefined;
}): string {
  const lines = [
    `session  ${input.sessionId}`,
    `host     ${input.baseUrl}`,
    `state    ${input.busy ? "busy" : "idle"}`,
  ];
  if (input.modelLabel) lines.push(`model    ${input.modelLabel}`);
  if (input.toolSummary) lines.push(`tools    ${input.toolSummary}`);
  lines.push(formatPendingApproval(input.pending).trimEnd());
  return `${lines.join("\n")}\n`;
}
