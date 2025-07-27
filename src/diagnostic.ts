import * as vscode from "vscode";
import { getMessageValueForKey } from "./utils";

/**
 * テスト完全対応のプレースホルダー検証
 */
export async function validatePlaceholders(
  document: vscode.TextDocument,
  collection: vscode.DiagnosticCollection
) {
  if (document.languageId !== "java") return;
  const diagnostics: vscode.Diagnostic[] = [];
  const text = document.getText();

  const patterns = vscode.workspace
    .getConfiguration("java-message-key-navigator")
    .get<string[]>("messageKeyExtractionPatterns", []);
  const regexes = patterns.map(
    (pat) => new RegExp(`${pat}\\s*\\(`, "g")
  );

  for (const regex of regexes) {
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      // 1. カッコ内全体を抜き出す
      const callStart = regex.lastIndex - 1; // "("の位置
      let callEnd = callStart, depth = 0;
      for (let i = callStart; i < text.length; i++) {
        if (text[i] === "(") depth++;
        else if (text[i] === ")") depth--;
        if (depth === 0) { callEnd = i; break; }
      }
      const argString = text.slice(callStart + 1, callEnd);

      // 2. safeSplit で分割（1個目はkey, 2個目以降が引数）
      const parts = safeSplit(argString);
      if (parts.length === 0) continue;
      const key = (parts[0].trim().replace(/^"|"$/g, ""));
      const keyOffset = text.indexOf(`"${key}"`, match.index);
      const keyPos = document.positionAt(keyOffset + 1);
      const keyRange = new vscode.Range(
        keyPos,
        keyPos.translate(0, key.length)
      );
      const args = parts.slice(1);

      // 3. プレースホルダー数を算出
      const messageValue = await getMessageValueForKey(key);
      if (!messageValue) continue;
      const placeholders = Array.from(
        messageValue.matchAll(/(?<!\\)\{(\d+)\}/g)
      ).map((m) => Number(m[1]));
      const expectedArgCount =
        placeholders.length > 0 ? Math.max(...placeholders) + 1 : 0;

      // 4. 引数カウント
      let actualArgCount = 0;
      if (args.length === 0 || (args.length === 1 && args[0].trim() === "")) {
        actualArgCount = 0;
      } else if (args.length === 1) {
        // 配列リテラル or join特別扱い
        const arrayMatch = args[0].match(/new\s+[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\s*\[\s*\]\s*{([\s\S]*?)}/);
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
          actualArgCount = 1;
        }
      } else {
        actualArgCount = args.filter((e) => e.trim() !== "").length;
      }

      // 5. 診断
      if (
        (expectedArgCount === 0 && actualArgCount > 0) ||
        (expectedArgCount > 0 && actualArgCount !== expectedArgCount)
      ) {
        diagnostics.push(
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
 * カンマ分割（文字列リテラル・括弧対応）
 */
function safeSplit(argString: string): string[] {
  const result: string[] = [];
  let buffer = "";
  let inQuotes = false;
  let quoteChar = "";
  let parenDepth = 0;

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
    if (ch === "," && parenDepth === 0) {
      result.push(buffer.trim());
      buffer = "";
      continue;
    }
    buffer += ch;
  }
  if (buffer.trim() !== "") {
    result.push(buffer.trim());
  }
  return result;
}
