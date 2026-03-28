import * as vscode from "vscode";
import { getMessageValueForKey } from "./utils";

interface ArgBuilderPattern {
  pattern: string;
  argCount: number;
}

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
      // 1. カッコ内全体を抜き出す
      const callStart = regex.lastIndex - 1; // "("の位置
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

      // 2. safeSplit で分割（1個目はkey, 2個目以降が引数）
      const parts = safeSplit(argString);
      if (parts.length === 0) {continue;}
      const firstArg = parts[0].trim();
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

      // 3. プレースホルダー数を算出
      const messageValue = await getMessageValueForKey(key);
      if (!messageValue) {continue;}
      const placeholders = Array.from(
        messageValue.matchAll(/(?<!\\)\{(\d+)\}/g)
      ).map((m) => Number(m[1]));

      // プレースホルダーの正当性チェック: {0} がない、不連続 など
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

      // === 例外引数除外ロジック ===
      if (
        expectedArgCount === 0 &&
        args.length === 1 &&
        isLikelyExceptionArg(args[0])
      ) {
        // log("KEY", e) など、例外オブジェクトだけを渡すログ呼び出しは
        // プレースホルダー検証の実引数としてはカウントしない
        args.pop();
      }

      if (args.length > 1) {
        const lastArg = args[args.length - 1].trim();
        const prevArg = args[args.length - 2].trim();

        const isSingleVar = /^[A-Za-z_$][\w$]*$/.test(lastArg);
        const prevIsArrayLiteral =
          /^new\s+[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\s*\[\s*\]\s*{[\s\S]*}$/.test(
            prevArg
          );
        const prevIsJoinCall = /\.join\s*\(/.test(prevArg);

        if (isSingleVar) {
          if (prevIsArrayLiteral) {
            // 配列直後の末尾変数は常に例外扱いで除外
            args.pop();
          } else if (!prevIsJoinCall) {
            // 純 varargs
            const precedingCount = args.length - 1; // ex を除いた個数
            // 2パターンで除外する：
            // 1) 先行が2個以上（"A","B",ex など）…常に除外（ex を例外として扱う）
            // 2) 先行が1個 かつ プレースホルダーが1個（"A",ex × "Hi {0}"）…一致させるために除外
            if (
              precedingCount >= 2 ||
              (precedingCount === 1 && expectedArgCount === 1)
            ) {
              args.pop();
            }
            // ※ prev が join() のときはこの分岐に入らないので除外しない
          }
          // varargs の直前が join() のとき（join(), ex）は除外しない
        }
      }

      // 4. 引数カウント
      let actualArgCount = 0;
      if (args.length === 0 || (args.length === 1 && args[0].trim() === "")) {
        actualArgCount = 0;
      } else if (args.length === 1) {
        // 配列リテラル or join特別扱い
        const arrayMatch = args[0].match(
          /new\s+[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\s*\[\s*\]\s*{([\s\S]*?)}/
        );
        if (arrayMatch) {
          const arr = safeSplit(arrayMatch[1]);
          if (arr.length === 1 && /\.join\s*\(/.test(arr[0])) {
            actualArgCount = expectedArgCount;
          } else {
            actualArgCount = arr.filter((e) => e.trim() !== "").length;
          }
        } else if (/\.join\s*\(/.test(args[0])) {
          actualArgCount = expectedArgCount;
        } else {
          const builderArgCount = matchArgBuilderPattern(
            args[0],
            argBuilderPatterns
          );
          if (builderArgCount !== null) {
            actualArgCount = builderArgCount;
          } else {
            actualArgCount = 1;
          }
        }
      } else {
        actualArgCount = args.filter((e) => e.trim() !== "").length;
      }

      // 5. 診断
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

function normalizeMethodPattern(pattern: string): string {
  return pattern.trim().replace(/\(\s*$/, "");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripTrailingLocaleArg(args: string[]): boolean {
  if (args.length === 0) {
    return false;
  }

  const lastArg = args[args.length - 1];
  if (!isLikelyLocaleArg(lastArg)) {
    return false;
  }

  args.pop();
  return true;
}

function isLikelyLocaleArg(arg: string): boolean {
  const trimmed = arg.trim();

  return (
    /(?:^|[.])getLocale\s*\(\s*\)\s*$/.test(trimmed) ||
    /locale/i.test(trimmed) ||
    /\bLocale\b/.test(trimmed)
  );
}

function isLikelyExceptionArg(arg: string): boolean {
  const trimmed = arg.trim();
  const isIdentifier = /^[A-Za-z_$][\w$]*$/.test(trimmed);
  if (!isIdentifier) {return false;}

  // catch (Exception e) / catch (...) ex などの短い慣用名
  if (/^(e|ex|err|error|exception|throwable|cause)$/i.test(trimmed)) {
    return true;
  }

  // exceptionObj / dbException / rootCause / throwableError などを許可
  return /(exception|throwable|cause|error)/i.test(trimmed);
}

/**
 * カンマ分割（文字列リテラル・括弧対応）
 */
function safeSplit(argString: string): string[] {
  const result: string[] = [];
  let buffer = "";
  let inQuotes = false;
  let quoteChar = "";
  let parenDepth = 0; // ()
  let braceDepth = 0; // {}
  let bracketDepth = 0; // []

  for (let i = 0; i < argString.length; i++) {
    const ch = argString[i];

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

    // トップレベルのカンマのみで分割
    if (
      ch === "," &&
      parenDepth === 0 &&
      braceDepth === 0 &&
      bracketDepth === 0
    ) {
      result.push(buffer.trim());
      buffer = "";
      continue;
    }

    buffer += ch;
  }

  if (buffer.trim() !== "") {result.push(buffer.trim());}
  return result;
}

/**
 * 引数式が argBuilderPatterns に定義されたメソッド呼び出しにマッチするか判定し、
 * マッチした場合は設定された argCount を返す。マッチしなければ null。
 */
function matchArgBuilderPattern(
  argText: string,
  patterns: ArgBuilderPattern[]
): number | null {
  const trimmed = argText.trim();
  for (const { pattern, argCount } of patterns) {
    const esc = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // buildArgs(...), Utils.buildArgs(...), this.buildArgs(...) にマッチ
    const re = new RegExp(`(?:^|\\.)${esc}\\s*\\(`);
    if (re.test(trimmed)) {
      return argCount;
    }
  }
  return null;
}
