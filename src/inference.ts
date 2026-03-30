/**
 * Parsed representation of a method-call expression.
 */
interface ParsedMethodCall {
  methodPath: string;
  args: string[];
}

/**
 * Parsed representation of an annotation attribute assignment.
 */
interface ParsedAnnotationAttr {
  annotationName: string;
  attrName: string;
  value: string;
}

/**
 * Returns whether a character is a valid first identifier character.
 *
 * @param ch Character to test.
 */
function isIdentifierStart(ch: string): boolean {
  return /[A-Za-z_$]/.test(ch);
}

/**
 * Returns whether a character is valid inside an identifier.
 *
 * @param ch Character to test.
 */
function isIdentifierPart(ch: string): boolean {
  return /[A-Za-z0-9_$]/.test(ch);
}

/**
 * Returns whether a character is whitespace.
 *
 * @param ch Character to test.
 */
function isWhitespace(ch: string): boolean {
  return /\s/.test(ch);
}

/**
 * Unescapes basic Java-like escape sequences used in string literals.
 *
 * @param raw Raw string-literal body without quote characters.
 */
function unescapeSimpleString(raw: string): string {
  let out = "";
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === "\\" && i + 1 < raw.length) {
      i++;
      const next = raw[i];
      if (next === "n") {out += "\n";}
      else if (next === "r") {out += "\r";}
      else if (next === "t") {out += "\t";}
      else {out += next;}
      continue;
    }
    out += ch;
  }
  return out;
}

/**
 * Parses a quoted string literal token and returns its unescaped content.
 *
 * @param token Candidate quoted token.
 */
function parseStringLiteral(token: string): string | null {
  const trimmed = token.trim();
  if (trimmed.length < 2) {
    return null;
  }
  const quote = trimmed[0];
  if ((quote !== '"' && quote !== "'") || trimmed[trimmed.length - 1] !== quote) {
    return null;
  }
  return unescapeSimpleString(trimmed.slice(1, -1));
}

/**
 * Replaces line/block comments with whitespace while preserving offsets.
 *
 * @param source Source text to normalize.
 */
function stripComments(source: string): string {
  let out = "";
  let i = 0;
  let inLineComment = false;
  let inBlockComment = false;
  let inSingle = false;
  let inDouble = false;

  while (i < source.length) {
    const ch = source[i];
    const next = i + 1 < source.length ? source[i + 1] : "";

    if (inLineComment) {
      if (ch === "\n") {
        inLineComment = false;
        out += "\n";
      } else {
        out += " ";
      }
      i++;
      continue;
    }
    if (inBlockComment) {
      if (ch === "*" && next === "/") {
        inBlockComment = false;
        out += "  ";
        i += 2;
      } else {
        out += ch === "\n" ? "\n" : " ";
        i++;
      }
      continue;
    }
    if (inSingle) {
      out += ch;
      if (ch === "'" && source[i - 1] !== "\\") {
        inSingle = false;
      }
      i++;
      continue;
    }
    if (inDouble) {
      out += ch;
      if (ch === '"' && source[i - 1] !== "\\") {
        inDouble = false;
      }
      i++;
      continue;
    }

    if (ch === "/" && next === "/") {
      inLineComment = true;
      out += "  ";
      i += 2;
      continue;
    }
    if (ch === "/" && next === "*") {
      inBlockComment = true;
      out += "  ";
      i += 2;
      continue;
    }
    if (ch === "'") {
      inSingle = true;
      out += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      out += ch;
      i++;
      continue;
    }

    out += ch;
    i++;
  }

  return out;
}

/**
 * Finds the index of the closing parenthesis that matches `openIndex`.
 *
 * @param source Source text containing parentheses.
 * @param openIndex Index of the opening parenthesis.
 */
function findMatchingParen(source: string, openIndex: number): number {
  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  for (let i = openIndex; i < source.length; i++) {
    const ch = source[i];
    if (inSingle) {
      if (ch === "'" && source[i - 1] !== "\\") {
        inSingle = false;
      }
      continue;
    }
    if (inDouble) {
      if (ch === '"' && source[i - 1] !== "\\") {
        inDouble = false;
      }
      continue;
    }
    if (ch === "'") {
      inSingle = true;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      continue;
    }
    if (ch === "(") {
      depth++;
      continue;
    }
    if (ch === ")") {
      depth--;
      if (depth === 0) {
        return i;
      }
    }
  }
  return -1;
}

/**
 * Splits a comma-separated argument list at top level only.
 *
 * @param argsSource Raw argument-list text.
 */
function splitTopLevelArgs(argsSource: string): string[] {
  const args: string[] = [];
  let current = "";
  let parenDepth = 0;
  let braceDepth = 0;
  let bracketDepth = 0;
  let inSingle = false;
  let inDouble = false;

  for (let i = 0; i < argsSource.length; i++) {
    const ch = argsSource[i];
    if (inSingle) {
      current += ch;
      if (ch === "'" && argsSource[i - 1] !== "\\") {
        inSingle = false;
      }
      continue;
    }
    if (inDouble) {
      current += ch;
      if (ch === '"' && argsSource[i - 1] !== "\\") {
        inDouble = false;
      }
      continue;
    }
    if (ch === "'") {
      inSingle = true;
      current += ch;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      current += ch;
      continue;
    }
    if (ch === "(") {
      parenDepth++;
      current += ch;
      continue;
    }
    if (ch === ")") {
      parenDepth--;
      current += ch;
      continue;
    }
    if (ch === "{") {
      braceDepth++;
      current += ch;
      continue;
    }
    if (ch === "}") {
      braceDepth--;
      current += ch;
      continue;
    }
    if (ch === "[") {
      bracketDepth++;
      current += ch;
      continue;
    }
    if (ch === "]") {
      bracketDepth--;
      current += ch;
      continue;
    }
    if (
      ch === "," &&
      parenDepth === 0 &&
      braceDepth === 0 &&
      bracketDepth === 0
    ) {
      const token = current.trim();
      if (token.length > 0) {
        args.push(token);
      }
      current = "";
      continue;
    }
    current += ch;
  }

  const tail = current.trim();
  if (tail.length > 0) {
    args.push(tail);
  }
  return args;
}

/**
 * Reads a dotted method path by scanning backward from the given index.
 *
 * @param source Source text that contains a call-like expression.
 * @param fromIndex Starting index for backward scanning.
 */
function readMethodPathBackward(source: string, fromIndex: number): string | null {
  let i = fromIndex;
  while (i >= 0 && isWhitespace(source[i])) {
    i--;
  }
  if (i < 0 || !isIdentifierPart(source[i])) {
    return null;
  }
  const end = i;
  while (i >= 0 && (isIdentifierPart(source[i]) || source[i] === ".")) {
    i--;
  }
  const path = source.slice(i + 1, end + 1);
  if (path.length === 0 || path.startsWith(".") || path.endsWith(".")) {
    return null;
  }
  return path;
}

/**
 * Returns the simple name from a dotted symbol path.
 *
 * @param name Possibly qualified symbol name.
 */
function simpleName(name: string): string {
  const idx = name.lastIndexOf(".");
  return idx >= 0 ? name.slice(idx + 1) : name;
}

/**
 * Parses call-like expressions from source and collects their argument tokens.
 *
 * @param source Source text to parse.
 */
function parseMethodCalls(source: string): ParsedMethodCall[] {
  const clean = stripComments(source);
  const calls: ParsedMethodCall[] = [];
  for (let i = 0; i < clean.length; i++) {
    if (clean[i] !== "(") {
      continue;
    }
    const methodPath = readMethodPathBackward(clean, i - 1);
    if (!methodPath) {
      continue;
    }
    const close = findMatchingParen(clean, i);
    if (close < 0) {
      continue;
    }
    calls.push({
      methodPath,
      args: splitTopLevelArgs(clean.slice(i + 1, close)),
    });
  }
  return calls;
}

/**
 * Parses a named assignment token such as `value = "foo"` from annotation args.
 *
 * @param arg Single annotation argument token.
 */
function parseNamedAssignment(arg: string): { name: string; valueToken: string } | null {
  let inSingle = false;
  let inDouble = false;
  let parenDepth = 0;
  let braceDepth = 0;
  let bracketDepth = 0;

  for (let i = 0; i < arg.length; i++) {
    const ch = arg[i];
    if (inSingle) {
      if (ch === "'" && arg[i - 1] !== "\\") {
        inSingle = false;
      }
      continue;
    }
    if (inDouble) {
      if (ch === '"' && arg[i - 1] !== "\\") {
        inDouble = false;
      }
      continue;
    }
    if (ch === "'") {
      inSingle = true;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      continue;
    }
    if (ch === "(") {parenDepth++; continue;}
    if (ch === ")") {parenDepth--; continue;}
    if (ch === "{") {braceDepth++; continue;}
    if (ch === "}") {braceDepth--; continue;}
    if (ch === "[") {bracketDepth++; continue;}
    if (ch === "]") {bracketDepth--; continue;}

    if (
      ch === "=" &&
      parenDepth === 0 &&
      braceDepth === 0 &&
      bracketDepth === 0
    ) {
      const name = arg.slice(0, i).trim();
      const valueToken = arg.slice(i + 1).trim();
      if (!name || !valueToken || !isIdentifierStart(name[0])) {
        return null;
      }
      for (let j = 1; j < name.length; j++) {
        if (!isIdentifierPart(name[j])) {
          return null;
        }
      }
      return { name, valueToken };
    }
  }

  return null;
}

/**
 * Parses annotation attributes with string-literal values from source.
 *
 * @param source Source text to parse.
 */
function parseAnnotations(source: string): ParsedAnnotationAttr[] {
  const clean = stripComments(source);
  const parsed: ParsedAnnotationAttr[] = [];

  for (let i = 0; i < clean.length; i++) {
    if (clean[i] !== "@") {
      continue;
    }
    let p = i + 1;
    if (p >= clean.length || !isIdentifierStart(clean[p])) {
      continue;
    }
    while (p < clean.length && (isIdentifierPart(clean[p]) || clean[p] === ".")) {
      p++;
    }
    const annotationName = simpleName(clean.slice(i + 1, p));
    while (p < clean.length && isWhitespace(clean[p])) {
      p++;
    }
    if (p >= clean.length || clean[p] !== "(") {
      continue;
    }
    const close = findMatchingParen(clean, p);
    if (close < 0) {
      continue;
    }
    const args = splitTopLevelArgs(clean.slice(p + 1, close));
    for (const arg of args) {
      const assignment = parseNamedAssignment(arg);
      if (!assignment) {
        continue;
      }
      const value = parseStringLiteral(assignment.valueToken);
      if (value === null) {
        continue;
      }
      parsed.push({
        annotationName,
        attrName: assignment.name,
        value,
      });
    }
  }

  return parsed;
}

/**
 * Escapes regular-expression metacharacters in a plain text token.
 *
 * @param value Plain text to escape for regex usage.
 */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Infers method call patterns whose first argument consistently matches
 * defined message keys.
 *
 * @param source Java source text to inspect.
 * @param definedKeys Set of known property keys.
 */
export function inferMethodPatterns(
  source: string,
  definedKeys: Set<string>
): string[] {
  const stats = new Map<string, { positive: number; negative: number }>();
  for (const call of parseMethodCalls(source)) {
    if (call.args.length === 0) {
      continue;
    }
    const key = parseStringLiteral(call.args[0]);
    if (key === null) {
      continue;
    }
    const entry = stats.get(call.methodPath) ?? { positive: 0, negative: 0 };
    if (definedKeys.has(key)) {
      entry.positive++;
    } else {
      entry.negative++;
    }
    stats.set(call.methodPath, entry);
  }

  const result: string[] = [];
  for (const [method, stat] of stats.entries()) {
    if (stat.positive > 0 && stat.negative === 0) {
      result.push(method);
    }
  }
  return result;
}

/**
 * Collects positive/negative evidence per annotation attribute key.
 *
 * @param source Java source text to inspect.
 * @param definedKeys Set of known property keys.
 */
function collectAnnotationStats(
  source: string,
  definedKeys: Set<string>
): Map<string, { positive: number; negative: number }> {
  const stats = new Map<string, { positive: number; negative: number }>();
  for (const entry of parseAnnotations(source)) {
    const key = `${entry.annotationName}#${entry.attrName}`;
    const stat = stats.get(key) ?? { positive: 0, negative: 0 };
    if (definedKeys.has(entry.value)) {
      stat.positive++;
    } else {
      stat.negative++;
    }
    stats.set(key, stat);
  }
  return stats;
}

/**
 * Infers annotation-name/attribute targets that consistently point to
 * defined message keys.
 *
 * @param source Java source text to inspect.
 * @param definedKeys Set of known property keys.
 */
export function inferAnnotationTargets(
  source: string,
  definedKeys: Set<string>
): Set<string> {
  const result = new Set<string>();
  for (const [key, stat] of collectAnnotationStats(source, definedKeys).entries()) {
    if (stat.positive > 0 && stat.negative === 0) {
      result.add(key);
    }
  }
  return result;
}

/**
 * Builds annotation extraction regex sources from inferred targets.
 *
 * @param source Java source text to inspect.
 * @param definedKeys Set of known property keys.
 */
export function inferAnnotationRegexSources(
  source: string,
  definedKeys: Set<string>
): string[] {
  const result: string[] = [];
  for (const key of inferAnnotationTargets(source, definedKeys)) {
    const parts = key.split("#");
    const annEsc = escapeRegExp(parts[0]);
    const attrEsc = escapeRegExp(parts[1]);
    if (parts[1] === "start") {
      result.push(`@${annEsc}\\(\\s*${attrEsc}\\s*=\\s*\"([^\\\"]+)\"`);
    } else {
      result.push(`@${annEsc}\\(.*?${attrEsc}\\s*=\\s*\"([^\\\"]+)\"`);
    }
  }
  return result;
}

/**
 * Parses a call-like argument expression and returns callee name and arg count.
 *
 * @param argText Argument expression text.
 */
export function parseCallLikeArg(
  argText: string
): { methodName: string; argCount: number } | null {
  const trimmed = argText.trim();
  const open = trimmed.indexOf("(");
  if (open <= 0 || trimmed[trimmed.length - 1] !== ")") {
    return null;
  }
  const methodPath = readMethodPathBackward(trimmed, open - 1);
  if (!methodPath) {
    return null;
  }
  const close = findMatchingParen(trimmed, open);
  if (close !== trimmed.length - 1) {
    return null;
  }
  const inner = trimmed.slice(open + 1, close).trim();
  const args = inner.length === 0 ? [] : splitTopLevelArgs(inner);
  return { methodName: simpleName(methodPath), argCount: args.length };
}

/**
 * Reads an identifier by scanning backward from the given index.
 *
 * @param source Source text containing the identifier.
 * @param fromIndex Starting index for backward scanning.
 */
function readIdentifierBackward(source: string, fromIndex: number): string | null {
  let i = fromIndex;
  while (i >= 0 && isWhitespace(source[i])) {
    i--;
  }
  if (i < 0 || !isIdentifierPart(source[i])) {
    return null;
  }
  const end = i;
  while (i >= 0 && isIdentifierPart(source[i])) {
    i--;
  }
  const id = source.slice(i + 1, end + 1);
  return id.length > 0 && isIdentifierStart(id[0]) ? id : null;
}

/**
 * Returns whether completion is currently invoked inside an inferred message
 * key context (method call or annotation attribute assignment).
 *
 * @param lineUntilPosition Current line content from start to caret position.
 * @param methodPatterns Inferred method patterns for message keys.
 * @param annotationTargets Inferred annotation attribute targets.
 */
export function matchesInferredCompletionContext(
  lineUntilPosition: string,
  methodPatterns: string[],
  annotationTargets: Set<string>
): boolean {
  const quotePos = Math.max(
    lineUntilPosition.lastIndexOf('"'),
    lineUntilPosition.lastIndexOf("'")
  );
  if (quotePos < 0) {
    return false;
  }

  const beforeQuote = lineUntilPosition.slice(0, quotePos).trimRight();
  if (beforeQuote.endsWith("(")) {
    const method = readMethodPathBackward(beforeQuote, beforeQuote.length - 2);
    if (!method) {
      return false;
    }
    const methodSimple = simpleName(method);
    return methodPatterns.some((p) => p === method || simpleName(p) === methodSimple);
  }

  if (!beforeQuote.endsWith("=")) {
    return false;
  }
  const attr = readIdentifierBackward(beforeQuote, beforeQuote.length - 2);
  if (!attr) {
    return false;
  }
  const at = beforeQuote.lastIndexOf("@");
  if (at < 0) {
    return false;
  }
  let i = at + 1;
  if (i >= beforeQuote.length || !isIdentifierStart(beforeQuote[i])) {
    return false;
  }
  while (
    i < beforeQuote.length &&
    (isIdentifierPart(beforeQuote[i]) || beforeQuote[i] === ".")
  ) {
    i++;
  }
  const annName = simpleName(beforeQuote.slice(at + 1, i));
  return annotationTargets.has(`${annName}#${attr}`);
}
