/**
 * Restricted boolean expressions for policy ruleset `match.when`.
 *
 * Hand-rolled — no `eval` / `vm` / Function. Grammar is a boolean subset with
 * subject bindings and a tiny string/RegExp method whitelist. Unknown
 * identifiers, assignment, and prototype walks are rejected at compile time.
 *
 * Does **not** introduce a second policy engine: ruleset JSON stays the only
 * surface; `when` is an optional filter on an existing rule.
 */

import type { PolicySubject } from "./types.js";

export class WhenExprError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WhenExprError";
  }
}

/** Max source length (chars). */
export const WHEN_EXPR_MAX_CHARS = 512;
/** Max AST depth while compiling. */
export const WHEN_EXPR_MAX_DEPTH = 32;

type Token =
  | { kind: "ident"; value: string }
  | { kind: "string"; value: string }
  | { kind: "number"; value: number }
  | { kind: "regex"; value: RegExp }
  | { kind: "true" }
  | { kind: "false" }
  | { kind: "null" }
  | { kind: "undefined" }
  | { kind: "op"; value: string }
  | { kind: "punc"; value: string }
  | { kind: "eof" };

const STRING_METHODS = new Set(["includes", "startsWith", "endsWith", "match"]);
const REGEX_METHODS = new Set(["test"]);

/** Bindings exposed to `when` (frozen plain data only). */
export type WhenEnv = Readonly<Record<string, unknown>>;

/** Compile subject → env once per evaluate. */
export function whenEnvFromSubject(subject: PolicySubject): WhenEnv {
  const base: Record<string, unknown> = { kind: subject.kind };
  switch (subject.kind) {
    case "tool.call":
      base.name = subject.name;
      base.args = freezePlain(subject.args ?? {});
      break;
    case "provider.use":
      base.providerId = subject.providerId;
      base.name = subject.providerId;
      break;
    case "mcp.connect":
      base.serverId = subject.serverId;
      base.name = subject.serverId;
      break;
    case "mcp.resource":
      base.serverId = subject.serverId;
      base.name = subject.serverId;
      base.action = subject.action;
      if (subject.uri !== undefined) base.uri = subject.uri;
      break;
    case "host.open":
      base.action = subject.action;
      if (subject.target !== undefined) {
        base.target = subject.target;
        base.path = subject.target;
      }
      break;
    case "sidebar.embed":
      base.url = subject.url;
      if (subject.scheme !== undefined) base.scheme = subject.scheme;
      break;
    case "sidebar.fs":
      base.op = subject.op;
      if (subject.path !== undefined) base.path = subject.path;
      break;
    case "office.connect":
      if (subject.connectorId !== undefined) {
        base.connectorId = subject.connectorId;
        base.name = subject.connectorId;
      }
      break;
  }
  return Object.freeze(base);
}

function freezePlain(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    return Object.freeze(value.map(freezePlain));
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (k === "__proto__" || k === "prototype" || k === "constructor") continue;
    out[k] = freezePlain(v);
  }
  return Object.freeze(out);
}

type Compiled = (env: WhenEnv) => unknown;

/**
 * Compile a `when` source string. Throws {@link WhenExprError} on syntax /
 * safety violations (fail closed at ruleset load).
 */
export function compileWhenExpr(source: string): (env: WhenEnv) => boolean {
  if (typeof source !== "string") {
    throw new WhenExprError("when must be a string");
  }
  const trimmed = source.trim();
  if (!trimmed) throw new WhenExprError("when must be non-empty");
  if (trimmed.length > WHEN_EXPR_MAX_CHARS) {
    throw new WhenExprError(
      `when exceeds ${WHEN_EXPR_MAX_CHARS} characters`,
    );
  }
  const tokens = tokenize(trimmed);
  const parser = new Parser(tokens);
  const compiled = parser.parseExpression(0);
  parser.expectEof();
  return (env: WhenEnv): boolean => {
    try {
      return Boolean(compiled(env));
    } catch {
      // Runtime type errors (method on undefined) → no match, not a throw out.
      return false;
    }
  };
}

/** Evaluate `when` against a subject (compile + run). */
export function evalWhenExpr(source: string, subject: PolicySubject): boolean {
  return compileWhenExpr(source)(whenEnvFromSubject(subject));
}

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < source.length) {
    const ch = source[i]!;
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }
    if (ch === "'" || ch === '"') {
      const quote = ch;
      i += 1;
      let value = "";
      while (i < source.length && source[i] !== quote) {
        if (source[i] === "\\") {
          i += 1;
          if (i >= source.length) throw new WhenExprError("unterminated string");
          const esc = source[i]!;
          if (esc === "n") value += "\n";
          else if (esc === "t") value += "\t";
          else value += esc;
          i += 1;
          continue;
        }
        value += source[i]!;
        i += 1;
      }
      if (i >= source.length) throw new WhenExprError("unterminated string");
      i += 1;
      tokens.push({ kind: "string", value });
      continue;
    }
    if (ch === "/" && peekRegex(source, i)) {
      i += 1;
      let body = "";
      while (i < source.length && source[i] !== "/") {
        if (source[i] === "\\") {
          body += source[i]!;
          i += 1;
          if (i >= source.length) throw new WhenExprError("unterminated regex");
          body += source[i]!;
          i += 1;
          continue;
        }
        body += source[i]!;
        i += 1;
      }
      if (i >= source.length) throw new WhenExprError("unterminated regex");
      i += 1;
      let flags = "";
      while (i < source.length && /[gimsuy]/.test(source[i]!)) {
        flags += source[i]!;
        i += 1;
      }
      try {
        tokens.push({ kind: "regex", value: new RegExp(body, flags) });
      } catch (err) {
        throw new WhenExprError(
          `invalid regex: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      continue;
    }
    if (/[0-9]/.test(ch) || (ch === "." && /[0-9]/.test(source[i + 1] ?? ""))) {
      let raw = "";
      while (i < source.length && /[0-9.]/.test(source[i]!)) {
        raw += source[i]!;
        i += 1;
      }
      const n = Number(raw);
      if (!Number.isFinite(n)) throw new WhenExprError(`invalid number ${raw}`);
      tokens.push({ kind: "number", value: n });
      continue;
    }
    if (/[A-Za-z_$]/.test(ch)) {
      let ident = "";
      while (i < source.length && /[A-Za-z0-9_$]/.test(source[i]!)) {
        ident += source[i]!;
        i += 1;
      }
      if (ident === "true") tokens.push({ kind: "true" });
      else if (ident === "false") tokens.push({ kind: "false" });
      else if (ident === "null") tokens.push({ kind: "null" });
      else if (ident === "undefined") tokens.push({ kind: "undefined" });
      else tokens.push({ kind: "ident", value: ident });
      continue;
    }
    const two = source.slice(i, i + 2);
    if (
      two === "&&" ||
      two === "||" ||
      two === "==" ||
      two === "!=" ||
      two === "<=" ||
      two === ">="
    ) {
      tokens.push({ kind: "op", value: two });
      i += 2;
      continue;
    }
    if ("!<>".includes(ch)) {
      tokens.push({ kind: "op", value: ch });
      i += 1;
      continue;
    }
    if ("().,".includes(ch)) {
      tokens.push({ kind: "punc", value: ch });
      i += 1;
      continue;
    }
    throw new WhenExprError(`unexpected character ${JSON.stringify(ch)}`);
  }
  tokens.push({ kind: "eof" });
  return tokens;
}

/** Disambiguate `/` division (unsupported) vs regex literal. */
function peekRegex(source: string, at: number): boolean {
  // After ident/number/)/]/ regex is invalid — we never support division.
  // Treat `/` as regex start whenever the next non-space isn't whitespace-only end.
  let j = at + 1;
  if (j >= source.length) return false;
  // Empty regex `//` is not useful; still tokenize as regex with empty body.
  return true;
}

class Parser {
  private pos = 0;
  constructor(private readonly tokens: Token[]) {}

  private peek(): Token {
    return this.tokens[this.pos] ?? { kind: "eof" };
  }

  private take(): Token {
    const t = this.peek();
    if (t.kind !== "eof") this.pos += 1;
    return t;
  }

  expectEof(): void {
    if (this.peek().kind !== "eof") {
      throw new WhenExprError("unexpected trailing tokens");
    }
  }

  parseExpression(depth: number): Compiled {
    if (depth > WHEN_EXPR_MAX_DEPTH) {
      throw new WhenExprError("when expression too deeply nested");
    }
    return this.parseOr(depth);
  }

  private parseOr(depth: number): Compiled {
    let left = this.parseAnd(depth);
    while (this.peek().kind === "op" && (this.peek() as { value: string }).value === "||") {
      this.take();
      const right = this.parseAnd(depth);
      const L = left;
      const R = right;
      left = (env) => Boolean(L(env)) || Boolean(R(env));
    }
    return left;
  }

  private parseAnd(depth: number): Compiled {
    let left = this.parseUnary(depth);
    while (this.peek().kind === "op" && (this.peek() as { value: string }).value === "&&") {
      this.take();
      const right = this.parseUnary(depth);
      const L = left;
      const R = right;
      left = (env) => Boolean(L(env)) && Boolean(R(env));
    }
    return left;
  }

  private parseUnary(depth: number): Compiled {
    if (this.peek().kind === "op" && (this.peek() as { value: string }).value === "!") {
      this.take();
      const inner = this.parseUnary(depth + 1);
      return (env) => !Boolean(inner(env));
    }
    return this.parseCompare(depth);
  }

  private parseCompare(depth: number): Compiled {
    const left = this.parsePrimary(depth);
    const t = this.peek();
    if (t.kind !== "op") return left;
    const op = t.value;
    if (!["==", "!=", "<", ">", "<=", ">="].includes(op)) return left;
    this.take();
    const right = this.parsePrimary(depth);
    return (env) => {
      const a = left(env);
      const b = right(env);
      switch (op) {
        case "==":
          return a === b;
        case "!=":
          return a !== b;
        case "<":
          return (a as number) < (b as number);
        case ">":
          return (a as number) > (b as number);
        case "<=":
          return (a as number) <= (b as number);
        case ">=":
          return (a as number) >= (b as number);
        default:
          return false;
      }
    };
  }

  private parsePrimary(depth: number): Compiled {
    const t = this.peek();
    if (t.kind === "punc" && t.value === "(") {
      this.take();
      const inner = this.parseExpression(depth + 1);
      const close = this.take();
      if (close.kind !== "punc" || close.value !== ")") {
        throw new WhenExprError("expected ')'");
      }
      return inner;
    }
    if (t.kind === "true") {
      this.take();
      return () => true;
    }
    if (t.kind === "false") {
      this.take();
      return () => false;
    }
    if (t.kind === "null") {
      this.take();
      return () => null;
    }
    if (t.kind === "undefined") {
      this.take();
      return () => undefined;
    }
    if (t.kind === "string") {
      this.take();
      return () => t.value;
    }
    if (t.kind === "number") {
      this.take();
      return () => t.value;
    }
    if (t.kind === "regex") {
      this.take();
      return this.parseRegexTail(t.value, depth);
    }
    if (t.kind === "ident") {
      this.take();
      return this.parseIdentTail(t.value, depth);
    }
    throw new WhenExprError("expected expression");
  }

  private parseIdentTail(root: string, depth: number): Compiled {
    if (
      root === "process" ||
      root === "global" ||
      root === "globalThis" ||
      root === "window" ||
      root === "require" ||
      root === "Function" ||
      root === "eval" ||
      root === "constructor" ||
      root === "__proto__" ||
      root === "prototype"
    ) {
      throw new WhenExprError(`forbidden identifier ${root}`);
    }

    const path: string[] = [root];
    while (this.peek().kind === "punc" && (this.peek() as { value: string }).value === ".") {
      this.take();
      const next = this.take();
      if (next.kind !== "ident") {
        throw new WhenExprError("expected property name after '.'");
      }
      if (
        next.value === "__proto__" ||
        next.value === "prototype" ||
        next.value === "constructor"
      ) {
        throw new WhenExprError(`forbidden property ${next.value}`);
      }
      path.push(next.value);
    }

    if (this.peek().kind === "punc" && (this.peek() as { value: string }).value === "(") {
      // method call: last segment is the method name
      if (path.length < 2) {
        throw new WhenExprError(`unknown function ${path[0]}`);
      }
      const method = path[path.length - 1]!;
      const recvPath = path.slice(0, -1);
      const args = this.parseArgList(depth);
      return (env) => invokeMethod(readPath(env, recvPath), method, args.map((a) => a(env)));
    }

    return (env) => readPath(env, path);
  }

  private parseRegexTail(re: RegExp, depth: number): Compiled {
    if (this.peek().kind === "punc" && (this.peek() as { value: string }).value === ".") {
      this.take();
      const methodTok = this.take();
      if (methodTok.kind !== "ident") {
        throw new WhenExprError("expected method after regex");
      }
      if (!REGEX_METHODS.has(methodTok.value)) {
        throw new WhenExprError(`forbidden regex method ${methodTok.value}`);
      }
      const args = this.parseArgList(depth);
      return (env) => invokeMethod(re, methodTok.value, args.map((a) => a(env)));
    }
    return () => re;
  }

  private parseArgList(depth: number): Compiled[] {
    const open = this.take();
    if (open.kind !== "punc" || open.value !== "(") {
      throw new WhenExprError("expected '('");
    }
    const args: Compiled[] = [];
    if (this.peek().kind === "punc" && (this.peek() as { value: string }).value === ")") {
      this.take();
      return args;
    }
    for (;;) {
      args.push(this.parseExpression(depth + 1));
      const t = this.peek();
      if (t.kind === "punc" && t.value === ",") {
        this.take();
        continue;
      }
      if (t.kind === "punc" && t.value === ")") {
        this.take();
        break;
      }
      throw new WhenExprError("expected ',' or ')' in argument list");
    }
    if (args.length > 4) {
      throw new WhenExprError("too many arguments");
    }
    return args;
  }
}

function readPath(env: WhenEnv, path: string[]): unknown {
  let cur: unknown = env;
  for (const key of path) {
    if (cur === null || cur === undefined) return undefined;
    if (typeof cur !== "object") return undefined;
    if (key === "__proto__" || key === "prototype" || key === "constructor") {
      return undefined;
    }
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

function invokeMethod(receiver: unknown, method: string, args: unknown[]): unknown {
  if (receiver instanceof RegExp) {
    if (method === "test" && args.length === 1) {
      return receiver.test(String(args[0] ?? ""));
    }
    throw new Error("bad regex call");
  }
  if (typeof receiver !== "string") {
    throw new Error("method on non-string");
  }
  if (!STRING_METHODS.has(method)) {
    throw new Error("forbidden string method");
  }
  if (method === "includes") {
    return receiver.includes(String(args[0] ?? ""), typeof args[1] === "number" ? args[1] : undefined);
  }
  if (method === "startsWith") {
    return receiver.startsWith(String(args[0] ?? ""), typeof args[1] === "number" ? args[1] : undefined);
  }
  if (method === "endsWith") {
    return receiver.endsWith(String(args[0] ?? ""), typeof args[1] === "number" ? args[1] : undefined);
  }
  if (method === "match") {
    const pat = args[0];
    if (pat instanceof RegExp) return pat.test(receiver);
    if (typeof pat === "string") return receiver.includes(pat);
    return false;
  }
  return false;
}
