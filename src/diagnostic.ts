import * as vscode from "vscode";
import { getMessageValueForKey } from "./utils";

export async function validatePlaceholders(
  document: vscode.TextDocument,
  collection: vscode.DiagnosticCollection
) {
  if (document.languageId !== "java") {
    return;
  }

  const diagnostics: vscode.Diagnostic[] = [];
  const text = document.getText();

  // messageKeyExtractionPatterns からキー検出用パターンを取得
  const patterns = vscode.workspace
    .getConfiguration("java-message-key-navigator")
    .get<string[]>("messageKeyExtractionPatterns", []);
  const regexes = patterns.map(
    (pat) => new RegExp(`${pat}\\s*\\(\\s*"([^"]+)"`, "g")
  );

  for (const regex of regexes) {
    let match;
    while ((match = regex.exec(text)) !== null) {
      const key = match[1];
      const keyOffset = match.index + match[0].indexOf(`"${key}"`) + 1;
      const keyPos = document.positionAt(keyOffset);
      const keyRange = new vscode.Range(
        keyPos,
        keyPos.translate(0, key.length)
      );

      // .properties からメッセージ値を取得
      const messageValue = await getMessageValueForKey(key);
      if (!messageValue) {
        continue;
      }

      // プレースホルダー数を解析
      const placeholders = Array.from(messageValue.matchAll(/\{(\d+)\}/g)).map(
        (m) => Number(m[1])
      );
      const expectedArgCount =
        placeholders.length > 0 ? Math.max(...placeholders) + 1 : 0;

      // ─── ここから「スニペット＋コメント除去＋マルチライン検索」方式 ───

      // 1. キー呼び出し直後から最大20000文字をスニペット取得
      const snippet = text.substring(
        regex.lastIndex,
        Math.min(text.length, regex.lastIndex + 20000)
      );

      // 2. コメントをすべて除去 (// シングルライン, /* */ ブロック)
      const code = snippet
        .replace(/\/\/.*$/gm, "") // シングルラインコメント
        .replace(/\/\*[\s\S]*?\*\//g, ""); // ブロックコメント

      // 3. 汎用的な配列リテラル (new 任意の型[] { … }) を最優先でキャプチャ
      const arrayMatch = code.match(
        /new\s+[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\s*\[\s*\]\s*{([\s\S]*?)}/
      );

      // 4. varargs 呼び出し (, arg1, arg2, … ) を次にキャプチャ
      let actualArgCount = 0;
      if (arrayMatch) {
        actualArgCount = arrayMatch[1]
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean).length;
      } else {
        // 「,」から最初の「)」までをキャプチャ
        const varargsMatch = code.match(/,\s*([\s\S]*?)\)/);
        if (varargsMatch) {
          actualArgCount = varargsMatch[1]
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean).length;
        }
      }

      // 5. プレースホルダーが1つ以上あり、かつ不一致ならエラー
      if (expectedArgCount > 0 && expectedArgCount !== actualArgCount) {
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
