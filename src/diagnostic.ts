import * as vscode from "vscode";
import { getMessageValueForKey } from "./utils";

/**
 * Describes a configured helper that expands to a fixed number of arguments.
 */
interface ArgBuilderPattern {
  pattern: string;
  argCount: number;
}

/**
 * Represents a split argument together with its start offset inside the call.
 */
interface ArgPart {
  text: string;
  start: number;
}

/**
 * Validates placeholder usage for supported Java message-key invocations.
 */
export async function validatePlaceholders(
  document: vscode.TextDocument,
  collection: vscode.DiagnosticCollection
) {
  if (document.languageId !== "java") {return;}
  const diagnostics: vscode.Diagnostic[] = [];
  const seenDiagnostics = new Set<string>();
  const text = document.getText();

  const config = vscode.workspace.getConfiguration("java-message-key-navigator");
  const patterns = config.get<string[]>("messageKeyExtractionPatterns", []);
  const argBuilderPatterns = config.get<ArgBuilderPattern[]>(
    "argBuilderPatterns",
    []
  );
  const regexes = patterns
    .map(normalizeMethodPattern)
    .filter((pat) => pat.length > 0)
    .map((pat) => new RegExp(`(?<![\\w$])${escapeRegExp(pat)}\\s*\\(`, "g"));

  for (const regex of regexes) {
    regex.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      // 1. Extract the entire argument list enclosed by the call parentheses.
      const callStart = regex.lastIndex - 1; // Position of the opening parenthesis.
      let callEnd = callStart,
        depth = 0;
      for (let i = callStart; i < text.length; i++) {
        if (text[i] === "(") {depth++;}
        else if (text[i] === ")") {depth--;}
        if (depth === 0) {
          callEnd = i;
          break;
        }
      }
      const argString = text.slice(callStart + 1, callEnd);

      // 2. Split arguments safely; the first entry is the key and the rest are values.
      const parts = safeSplitWithOffsets(argString);
      if (parts.length === 0) {continue;}
      const firstArg = parts[0].text.trim();
      const keyMatch = firstArg.match(/^(['"])([\s\S]*)\1$/);
      if (!keyMatch) {continue;}

      const key = keyMatch[2];
      const firstArgOffset = text.indexOf(firstArg, match.index);
      const keyPos = document.positionAt(firstArgOffset + 1);
      const keyRange = new vscode.Range(
        keyPos,
        keyPos.translate(0, key.length)
      );
      const args = parts.slice(1);

      const removedLocaleArg = stripTrailingLocaleArg(args);
      if (removedLocaleArg && args.length === 0) {
        continue;
      }

      // 3. Resolve the message and derive the expected placeholder count.
      const messageValue = await getMessageValueForKey(key);
      if (!messageValue) {continue;}
      const placeholders = Array.from(
        messageValue.matchAll(/(?<!\\)\{(\d+)\}/g)
      ).map((m) => Number(m[1]));

      // Validate placeholder ordering, for example missing {0} or skipped indices.
      if (placeholders.length > 0) {
        const sorted = [...new Set(placeholders)].sort((a, b) => a - b);
        const isContinuous = sorted[0] === 0 && sorted.every((v, i) => v === i);
        if (!isContinuous) {
          pushDiagnosticOnce(
            diagnostics,
            seenDiagnostics,
            new vscode.Diagnostic(
              keyRange,
              `⚠️ プレースホルダーは {0} から始まり連番である必要がありますが、不正な順序です: {${sorted.join(
                "}, {"
              )}}`,
              vscode.DiagnosticSeverity.Error
            )
          );
        }
      }

      const expectedArgCount =
        placeholders.length > 0 ? Math.max(...placeholders) + 1 : 0;

      // === Ignore special trailing arguments that should not count as placeholders. ===
      if (
        expectedArgCount === 0 &&
        args.length === 1 &&
        isLikelyExceptionArg(args[0].text)
      ) {
        // Calls such as log("KEY", e) pass only an exception object, which should
        // not be counted as a placeholder argument.
        args.pop();
      }

      if (args.length > 1) {
        const lastArg = args[args.length - 1].text.trim();
        const prevArg = args[args.length - 2].text.trim();

        const isSingleVar = /^[A-Za-z_$][\w$]*$/.test(lastArg);
        const prevIsArrayLiteral =
          /^new\s+[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\s*\[\s*\]\s*{[\s\S]*}$/.test(
            prevArg
          );
        const prevIsJoinCall = /\.join\s*\(/.test(prevArg);

        if (isSingleVar) {
          if (prevIsArrayLiteral) {
            // Treat a trailing identifier after an array literal as an exception argument.
            args.pop();
          } else if (!prevIsJoinCall) {
            // For plain varargs calls, only ignore the trailing argument when its
            // resolved type is throwable-like.
            const precedingCount = args.length - 1;
            if (
              precedingCount >= 2 ||
              (precedingCount === 1 && expectedArgCount === 1)
            ) {
              const shouldIgnore = await isThrowableArgument(
                document,
                args[args.length - 1],
                callStart + 1
              );
              if (shouldIgnore) {
                args.pop();
              }
            }
          }
        }
      }

      // 4. Count the effective arguments after applying supported shortcuts.
      const actualArgCount = countActualArguments(
        args,
        expectedArgCount,
        argBuilderPatterns
      );

      // 5. Emit a diagnostic when the placeholder count does not match.
      if (
        (expectedArgCount === 0 && actualArgCount > 0) ||
        (expectedArgCount > 0 && actualArgCount !== expectedArgCount)
      ) {
        pushDiagnosticOnce(
          diagnostics,
          seenDiagnostics,
          new vscode.Diagnostic(
            keyRange,
            `⚠️ Placeholder count (${expectedArgCount}) doesn’t match provided argument count (${actualArgCount}).`,
            vscode.DiagnosticSeverity.Error
          )
        );
      }
    }
  }
  collection.set(document.uri, diagnostics);
}

/**
 * Adds a diagnostic only once for the same location and message pair.
 */
function pushDiagnosticOnce(
  diagnostics: vscode.Diagnostic[],
  seenDiagnostics: Set<string>,
  diagnostic: vscode.Diagnostic
): void {
  const { start, end } = diagnostic.range;
  const key = `${start.line}:${start.character}:${end.line}:${end.character}:${diagnostic.message}`;
  if (seenDiagnostics.has(key)) {
    return;
  }

  seenDiagnostics.add(key);
  diagnostics.push(diagnostic);
}

/**
 * Normalizes a configured method pattern so it can be converted to a call regex.
 */
function normalizeMethodPattern(pattern: string): string {
  return pattern.trim().replace(/\(\s*$/, "");
}

/**
 * Escapes regular-expression metacharacters in literal method names.
 */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Removes a trailing locale argument from the parsed argument list.
 */
function stripTrailingLocaleArg(args: ArgPart[]): boolean {
  if (args.length === 0) {
    return false;
  }

  const lastArg = args[args.length - 1].text;
  if (!isLikelyLocaleArg(lastArg)) {
    return false;
  }

  args.pop();
  return true;
}

/**
 * Heuristically detects locale-like expressions that should not count as
 * message placeholders.
 */
function isLikelyLocaleArg(arg: string): boolean {
  const trimmed = arg.trim();

  return (
    /(?:^|[.])getLocale\s*\(\s*\)\s*$/.test(trimmed) ||
    /locale/i.test(trimmed) ||
    /\bLocale\b/.test(trimmed)
  );
}

/**
 * Heuristically detects exception-like identifiers used without type
 * information.
 */
function isLikelyExceptionArg(arg: string): boolean {
  const trimmed = arg.trim();
  const isIdentifier = /^[A-Za-z_$][\w$]*$/.test(trimmed);
  if (!isIdentifier) {return false;}

  if (/^(e|ex|err|error|exception|throwable|cause)$/i.test(trimmed)) {
    return true;
  }

  return /(exception|throwable|cause|error)/i.test(trimmed);
}

/**
 * Splits a raw argument list while respecting nested syntax and string literals.
 */
function safeSplit(argString: string): string[] {
  return safeSplitWithOffsets(argString).map((part) => part.text);
}

/**
 * Splits a raw argument list and preserves each part's relative offset.
 */
function safeSplitWithOffsets(argString: string): ArgPart[] {
  const result: ArgPart[] = [];
  let buffer = "";
  let inQuotes = false;
  let quoteChar = "";
  let parenDepth = 0; // ()
  let braceDepth = 0; // {}
  let bracketDepth = 0; // []
  let tokenStart = -1;

  for (let i = 0; i < argString.length; i++) {
    const ch = argString[i];
    if (tokenStart === -1 && /\S/.test(ch)) {
      tokenStart = i;
    }

    if (inQuotes) {
      buffer += ch;
      if (ch === quoteChar && argString[i - 1] !== "\\") {
        inQuotes = false;
        quoteChar = "";
      }
      continue;
    }

    if (ch === '"' || ch === "'") {
      inQuotes = true;
      quoteChar = ch;
      buffer += ch;
      continue;
    }

    if (ch === "(") {
      parenDepth++;
      buffer += ch;
      continue;
    }
    if (ch === ")") {
      parenDepth--;
      buffer += ch;
      continue;
    }
    if (ch === "{") {
      braceDepth++;
      buffer += ch;
      continue;
    }
    if (ch === "}") {
      braceDepth--;
      buffer += ch;
      continue;
    }
    if (ch === "[") {
      bracketDepth++;
      buffer += ch;
      continue;
    }
    if (ch === "]") {
      bracketDepth--;
      buffer += ch;
      continue;
    }

    // Split only on top-level commas.
    if (
      ch === "," &&
      parenDepth === 0 &&
      braceDepth === 0 &&
      bracketDepth === 0
    ) {
      pushArgPart(result, buffer, tokenStart);
      buffer = "";
      tokenStart = -1;
      continue;
    }

    buffer += ch;
  }

  pushArgPart(result, buffer, tokenStart);
  return result;
}

/**
 * Pushes a trimmed argument token into the parsed result list.
 */
function pushArgPart(result: ArgPart[], raw: string, tokenStart: number): void {
  const trimmed = raw.trim();
  if (trimmed === "") {
    return;
  }

  const leadingWhitespace = raw.length - raw.trimStart().length;
  result.push({
    text: trimmed,
    start: tokenStart,
  });
}

/**
 * Matches an argument-builder helper and returns the number of arguments it
 * contributes.
 */
function matchArgBuilderPattern(
  argText: string,
  patterns: ArgBuilderPattern[]
): number | null {
  const trimmed = argText.trim();
  for (const { pattern, argCount } of patterns) {
    const esc = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Match buildArgs(...), Utils.buildArgs(...), or this.buildArgs(...).
    const re = new RegExp(`(?:^|\\.)${esc}\\s*\\(`);
    if (re.test(trimmed)) {
      return argCount;
    }
  }
  return null;
}

/**
 * Counts effective placeholder arguments after applying supported shortcuts.
 */
function countActualArguments(
  args: ArgPart[],
  expectedArgCount: number,
  argBuilderPatterns: ArgBuilderPattern[]
): number {
  const argTexts = args.map((arg) => arg.text);
  if (
    argTexts.length === 0 ||
    (argTexts.length === 1 && argTexts[0].trim() === "")
  ) {
    return 0;
  }

  if (argTexts.length === 1) {
    const arrayMatch = argTexts[0].match(
      /new\s+[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\s*\[\s*\]\s*{([\s\S]*?)}/
    );
    if (arrayMatch) {
      const arr = safeSplit(arrayMatch[1]);
      if (arr.length === 1 && /\.join\s*\(/.test(arr[0])) {
        return expectedArgCount;
      }
      return arr.filter((e) => e.trim() !== "").length;
    }

    if (/\.join\s*\(/.test(argTexts[0])) {
      return expectedArgCount;
    }

    const builderArgCount = matchArgBuilderPattern(
      argTexts[0],
      argBuilderPatterns
    );
    if (builderArgCount !== null) {
      return builderArgCount;
    }

    return 1;
  }

  return argTexts.filter((e) => e.trim() !== "").length;
}

/**
 * Resolves the trailing argument type and returns whether it is throwable-like.
 */
async function isThrowableArgument(
  document: vscode.TextDocument,
  arg: ArgPart,
  baseOffset: number
): Promise<boolean> {
  const queryOffset = baseOffset + arg.start;
  let locations: Array<vscode.Location | vscode.LocationLink> = [];
  try {
    locations =
      (await vscode.commands.executeCommand<
        Array<vscode.Location | vscode.LocationLink>
      >(
        "vscode.executeTypeDefinitionProvider",
        document.uri,
        document.positionAt(queryOffset)
      )) ?? [];
  } catch {
    return false;
  }

  for (const location of locations) {
    if (await locationResolvesToThrowable(location, new Set(), 0)) {
      return true;
    }
  }

  return false;
}

/**
 * Follows a type-definition location chain to determine whether it resolves to
 * a throwable type.
 */
async function locationResolvesToThrowable(
  location: vscode.Location | vscode.LocationLink,
  visited: Set<string>,
  depth: number
): Promise<boolean> {
  if (depth > 8) {
    return false;
  }

  const targetUri = isLocationLink(location) ? location.targetUri : location.uri;
  const targetRange = isLocationLink(location)
    ? (location.targetSelectionRange ?? location.targetRange)
    : location.range;
  if (!targetRange) {
    return false;
  }
  const visitKey = `${targetUri.toString()}:${targetRange.start.line}:${targetRange.start.character}`;
  if (visited.has(visitKey)) {
    return false;
  }
  visited.add(visitKey);

  let doc: vscode.TextDocument;
  try {
    doc = await vscode.workspace.openTextDocument(targetUri);
  } catch {
    return false;
  }
  const declaration = findTypeDeclaration(doc, targetRange.start.line);
  if (!declaration) {
    return false;
  }

  if (isThrowableTypeName(declaration.name)) {
    return true;
  }

  if (!declaration.extendsName) {
    return false;
  }

  if (isThrowableTypeName(declaration.extendsName)) {
    return true;
  }

  const extendsIndex = declaration.lineText.indexOf(declaration.extendsName);

  let baseLocations: Array<vscode.Location | vscode.LocationLink> = [];
  try {
    baseLocations =
      (await vscode.commands.executeCommand<
        Array<vscode.Location | vscode.LocationLink>
      >(
        "vscode.executeTypeDefinitionProvider",
        doc.uri,
        new vscode.Position(declaration.line, extendsIndex)
      )) ?? [];
  } catch {
    return false;
  }

  for (const baseLocation of baseLocations) {
    if (await locationResolvesToThrowable(baseLocation, visited, depth + 1)) {
      return true;
    }
  }

  return false;
}

/**
 * Narrows a VS Code definition result to a {@link vscode.LocationLink}.
 */
function isLocationLink(
  location: vscode.Location | vscode.LocationLink
): location is vscode.LocationLink {
  return "targetUri" in location;
}

/**
 * Finds a nearby class or record declaration for a resolved Java type.
 */
function findTypeDeclaration(
  document: vscode.TextDocument,
  aroundLine: number
): { name: string; extendsName?: string; line: number; lineText: string } | null {
  const lineCount =
    typeof (document as any).lineCount === "number"
      ? (document as any).lineCount
      : Math.max(aroundLine + 1, 1);
  const startLine = Math.max(0, aroundLine - 5);
  const endLine = Math.min(lineCount - 1, aroundLine + 5);

  for (let line = startLine; line <= endLine; line++) {
    const lineText = document.lineAt(line).text;
    const match = lineText.match(
      /\b(?:class|record)\s+([A-Za-z_$][\w$]*)(?:\s+extends\s+([A-Za-z_$][\w$.]*))?/
    );
    if (match) {
      return {
        name: match[1],
        extendsName: match[2]?.split(".").pop(),
        line,
        lineText,
      };
    }
  }

  return null;
}

/**
 * Returns whether a simple or qualified type name is throwable-compatible.
 */
function isThrowableTypeName(typeName: string): boolean {
  return /^(?:Throwable|Exception|RuntimeException|Error)$/.test(
    typeName.split(".").pop()!
  );
}
