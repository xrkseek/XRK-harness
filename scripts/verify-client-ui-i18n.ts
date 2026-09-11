/**
 * Reject product UI copy embedded directly in Client / Desktop shell sources.
 *
 * Locale dictionaries are the only source files allowed to own translated
 * text. Presentation code receives copy through its typed `t` seat, locale
 * payload, or an already-localized prop.
 */

import { globSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";

const root = resolve(import.meta.dirname, "..");
/** Floor so a narrowed glob cannot silently skip the Client / Desktop corpus. */
const MINIMUM_CLIENT_UI_SOURCES = 400;

const COPY_ATTRIBUTES = new Set([
  "alt",
  "aria-description",
  "aria-label",
  "aria-valuetext",
  "cancelLabel",
  "closeLabel",
  "confirmLabel",
  "copyLabel",
  "description",
  "emptyLabel",
  "label",
  "placeholder",
  "title",
  "truncatedLabel",
]);
const COPY_ATTRIBUTE_SUFFIX =
  /(?:Aria|Copy|Description|Heading|Label|Message|Placeholder|Summary|Text|Title|Tooltip)$/;

const COPY_NAME =
  /(?:^|_)(?:aria|copy|description|empty|heading|label|message|placeholder|summary|text|title|tooltip)(?:s|_.*)?$/i;
const COPY_SUFFIX =
  /(?:aria|copy|description|empty|heading|label|labels|message|placeholder|summary|text|title|tooltip|tabs)$/i;
const IMMUTABLE_LANGUAGE_TOKENS = new Set([
  "B",
  "Function",
  "GB",
  "K",
  "KB",
  "M",
  "MB",
  "Symbol",
  "false",
  "function()",
  "n",
  "null",
  "true",
  "undefined",
]);
const LOCALE_KEY = /^[a-z][a-zA-Z0-9]*(?:[._-][a-zA-Z0-9]+)+$/;

/** One hard-coded product-copy occurrence. */
export interface UiI18nViolation {
  readonly column: number;
  readonly file: string;
  readonly line: number;
  readonly reason: string;
  readonly text: string;
}

function localeOwner(file: string): boolean {
  const normalized = file.replaceAll("\\", "/");
  const base = normalized.slice(normalized.lastIndexOf("/") + 1);
  return (
    base === "locale.ts" ||
    base === "locales.ts" ||
    normalized.includes("/locales/")
  );
}

function containsProductText(text: string): boolean {
  const normalized = text.replace(/\s+/g, " ").trim();
  return (
    normalized !== "" &&
    !IMMUTABLE_LANGUAGE_TOKENS.has(normalized) &&
    !LOCALE_KEY.test(normalized) &&
    /\p{L}/u.test(normalized)
  );
}

function propertyName(
  node: ts.PropertyName | ts.BindingName,
): string | undefined {
  return ts.isIdentifier(node) || ts.isStringLiteral(node)
    ? node.text
    : undefined;
}

function copyAttribute(name: string): boolean {
  return (
    !name.endsWith("Key") &&
    (COPY_ATTRIBUTES.has(name) || COPY_ATTRIBUTE_SUFFIX.test(name))
  );
}

function compactText(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length <= 80
    ? normalized
    : `${normalized.slice(0, 77)}...`;
}

function looksLikeNaturalText(text: string): boolean {
  const normalized = text.replace(/\s+/g, " ").trim();
  return /\s|[\u3400-\u9fff]/u.test(normalized) || /^[A-Z]/.test(normalized);
}

/**
 * Find hard-coded product copy in one Client / Desktop source file.
 */
export function findUiI18nViolations(
  file: string,
  sourceText: string,
): UiI18nViolation[] {
  if (localeOwner(file)) return [];
  const source = ts.createSourceFile(
    file,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx")
      ? ts.ScriptKind.TSX
      : file.endsWith(".js")
        ? ts.ScriptKind.JS
        : ts.ScriptKind.TS,
  );
  const violations = new Map<number, UiI18nViolation>();

  const report = (
    node: ts.Node,
    text: string,
    reason: string,
    naturalOnly = false,
  ): void => {
    if (
      !containsProductText(text) ||
      (naturalOnly && !looksLikeNaturalText(text)) ||
      violations.has(node.getStart(source))
    ) {
      return;
    }
    const position = source.getLineAndCharacterOfPosition(node.getStart(source));
    violations.set(node.getStart(source), {
      column: position.character + 1,
      file,
      line: position.line + 1,
      reason,
      text: compactText(text),
    });
  };

  const collectExpression = (
    node: ts.Expression,
    reason: string,
    naturalOnly = false,
  ): void => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      report(node, node.text, reason, naturalOnly);
      return;
    }
    if (ts.isTemplateExpression(node)) {
      report(
        node,
        [node.head.text, ...node.templateSpans.map((span) => span.literal.text)].join(
          "",
        ),
        reason,
        naturalOnly,
      );
      return;
    }
    if (ts.isCallExpression(node)) return;
    if (
      ts.isParenthesizedExpression(node) ||
      ts.isAsExpression(node) ||
      ts.isSatisfiesExpression(node) ||
      ts.isNonNullExpression(node)
    ) {
      collectExpression(node.expression, reason, naturalOnly);
      return;
    }
    if (ts.isConditionalExpression(node)) {
      collectExpression(node.whenTrue, reason, naturalOnly);
      collectExpression(node.whenFalse, reason, naturalOnly);
      return;
    }
    if (ts.isBinaryExpression(node)) {
      if (node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
        collectExpression(node.right, reason, naturalOnly);
      } else if (
        node.operatorToken.kind === ts.SyntaxKind.PlusToken ||
        node.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
        node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken
      ) {
        collectExpression(node.left, reason, naturalOnly);
        collectExpression(node.right, reason, naturalOnly);
      }
      return;
    }
    if (ts.isArrayLiteralExpression(node)) {
      for (const element of node.elements) {
        if (ts.isExpression(element)) {
          collectExpression(element, reason, naturalOnly);
        }
      }
      return;
    }
    if (ts.isObjectLiteralExpression(node)) {
      for (const property of node.properties) {
        if (ts.isPropertyAssignment(property)) {
          const name = propertyName(property.name);
          const propertyOwnsCopy =
            name !== undefined &&
            (COPY_NAME.test(name) || COPY_SUFFIX.test(name));
          collectExpression(
            property.initializer,
            reason,
            naturalOnly || !propertyOwnsCopy,
          );
        }
      }
    }
  };

  const enclosingFunctionName = (node: ts.Node): string | undefined => {
    let current = node.parent;
    while (!ts.isSourceFile(current)) {
      if (
        ts.isFunctionDeclaration(current) ||
        ts.isMethodDeclaration(current)
      ) {
        return current.name === undefined
          ? undefined
          : propertyName(current.name);
      }
      if (ts.isArrowFunction(current) || ts.isFunctionExpression(current)) {
        const parent = current.parent;
        return ts.isVariableDeclaration(parent)
          ? propertyName(parent.name)
          : undefined;
      }
      current = current.parent;
    }
    return undefined;
  };

  const hasExplicitStringReturn = (node: ts.Node): boolean => {
    let current = node.parent;
    while (!ts.isSourceFile(current)) {
      if (
        ts.isFunctionDeclaration(current) ||
        ts.isMethodDeclaration(current) ||
        ts.isArrowFunction(current) ||
        ts.isFunctionExpression(current)
      ) {
        return current.type?.kind === ts.SyntaxKind.StringKeyword;
      }
      current = current.parent;
    }
    return false;
  };

  const visit = (node: ts.Node): void => {
    if (ts.isJsxText(node)) report(node, node.text, "JSX text");

    if (ts.isJsxAttribute(node)) {
      const name = node.name.getText(source);
      if (copyAttribute(name) && node.initializer !== undefined) {
        if (ts.isStringLiteral(node.initializer)) {
          report(node.initializer, node.initializer.text, `${name} attribute`);
        } else if (
          ts.isJsxExpression(node.initializer) &&
          node.initializer.expression !== undefined
        ) {
          collectExpression(
            node.initializer.expression,
            `${name} attribute`,
          );
        }
      }
    }

    if (
      ts.isJsxExpression(node) &&
      node.expression !== undefined &&
      (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent))
    ) {
      collectExpression(node.expression, "JSX child");
    }

    if (
      (file.endsWith(".tsx") || file.startsWith("apps/desktop/")) &&
      ts.isPropertyAssignment(node)
    ) {
      const name = propertyName(node.name);
      if (
        name !== undefined &&
        (COPY_NAME.test(name) || COPY_SUFFIX.test(name))
      ) {
        collectExpression(node.initializer, `${name} property`);
      }
    }

    if (
      file.startsWith("apps/desktop/") &&
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isPropertyAccessExpression(node.left) &&
      (node.left.name.text === "textContent" ||
        node.left.name.text === "innerText")
    ) {
      collectExpression(node.right, `${node.left.name.text} assignment`);
    }

    if (
      file.startsWith("apps/desktop/") &&
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      (node.expression.name.text === "setTitle" ||
        node.expression.name.text === "prompt")
    ) {
      const copy = node.arguments[0];
      if (copy !== undefined) {
        collectExpression(copy, `${node.expression.name.text} argument`);
      }
    }

    if (ts.isVariableDeclaration(node) && node.initializer !== undefined) {
      const name = propertyName(node.name);
      if (
        name !== undefined &&
        (COPY_NAME.test(name) || COPY_SUFFIX.test(name))
      ) {
        collectExpression(node.initializer, `${name} value`);
      }
    }

    if (ts.isBindingElement(node) && node.initializer !== undefined) {
      const name = propertyName(node.name);
      if (
        name !== undefined &&
        (COPY_NAME.test(name) || COPY_SUFFIX.test(name))
      ) {
        collectExpression(node.initializer, `${name} default value`);
      }
    }

    if (ts.isReturnStatement(node) && node.expression !== undefined) {
      const name = enclosingFunctionName(node);
      if (
        name !== undefined &&
        (COPY_NAME.test(name) || COPY_SUFFIX.test(name))
      ) {
        collectExpression(node.expression, `${name} return value`);
      } else if (file.endsWith(".tsx") && hasExplicitStringReturn(node)) {
        collectExpression(node.expression, "string return value", true);
      }
    }

    ts.forEachChild(node, visit);
  };
  visit(source);
  return [...violations.values()].sort(
    (left, right) => left.line - right.line || left.column - right.column,
  );
}

/**
 * Resolve the normalized Client source root containing one TSX component.
 */
export function clientSourceRoot(file: string): string | undefined {
  const normalized = file.replaceAll("\\", "/");
  const marker = "/src/client/";
  const index = normalized.indexOf(marker);
  return index < 0
    ? undefined
    : normalized.slice(0, index + marker.length - 1);
}

/** Desktop shell files scanned for menu / dialog / DOM copy (locale.ts excluded). */
export function desktopUiI18nSourceFiles(): string[] {
  return [
    ...globSync("apps/desktop/src/{main,update-coordinator}.{ts,tsx}", {
      cwd: root,
    }),
    ...globSync("apps/desktop/renderer/*.{js,ts}", { cwd: root }),
  ]
    .map((file) => file.replaceAll("\\", "/"))
    .filter((file) => !file.endsWith(".d.ts"))
    .sort();
}

/** Full Client UI + Desktop corpus for the gate. */
export function clientUiI18nSourceFiles(): string[] {
  const clientComponentRoots = new Set(
    globSync("packages/*/*/src/client/**/*.tsx", { cwd: root })
      .map(clientSourceRoot)
      .filter((clientRoot): clientRoot is string => clientRoot !== undefined),
  );
  return [
    ...new Set([
      ...globSync("packages/client/*/src/**/*.tsx", { cwd: root }),
      ...globSync("packages/client/ui-*/src/**/*.{ts,tsx}", { cwd: root }),
      ...[...clientComponentRoots].flatMap((clientRoot) =>
        globSync(`${clientRoot}/**/*.{ts,tsx}`, { cwd: root }),
      ),
      ...globSync("apps/web/src/**/*.{ts,tsx}", { cwd: root }),
      ...desktopUiI18nSourceFiles(),
    ]),
  ]
    .map((file) => file.replaceAll("\\", "/"))
    .filter((file) => !file.endsWith(".d.ts"))
    .sort();
}

/**
 * Enforce locale-owned copy for one file set.
 * @returns exit code (0 ok, 1 violations)
 */
export function runClientUiI18nGate(
  files: readonly string[],
  options: { readonly minimum?: number; readonly label?: string } = {},
): number {
  const minimum = options.minimum ?? MINIMUM_CLIENT_UI_SOURCES;
  const label = options.label ?? "verify-client-ui-i18n";
  if (files.length < minimum) {
    console.error(
      `${label}: discovery narrowed to ${files.length} source file(s); expected at least ${minimum}.`,
    );
    return 1;
  }
  const violations = files.flatMap((file) =>
    findUiI18nViolations(file, readFileSync(resolve(root, file), "utf8")),
  );
  if (violations.length > 0) {
    console.error(`${label}: ${violations.length} hard-coded UI string(s):`);
    for (const violation of violations) {
      console.error(
        `  ${violation.file}:${violation.line}:${violation.column} ${violation.reason}: ${JSON.stringify(violation.text)}`,
      );
    }
    return 1;
  }
  console.log(
    `${label}: ${files.length} Client UI source file(s) use locale-owned copy.`,
  );
  return 0;
}

function main(): void {
  /**
   * Desktop shell is enforced in `pnpm check` now.
   * Full Client tree shares this checker via unit fixtures; rolling the whole
   * Client corpus into the check graph waits until remaining inline copy is
   * migrated (see docs/status · docs/testing).
   */
  const desktopOnly = process.argv.includes("--desktop-only");
  const files = desktopOnly
    ? desktopUiI18nSourceFiles()
    : clientUiI18nSourceFiles();
  const code = runClientUiI18nGate(files, {
    minimum: desktopOnly ? 1 : MINIMUM_CLIENT_UI_SOURCES,
    label: desktopOnly
      ? "verify-client-ui-i18n (desktop)"
      : "verify-client-ui-i18n",
  });
  process.exitCode = code;
}

const entry = process.argv[1];
if (entry !== undefined && resolve(entry) === import.meta.filename) {
  main();
}
