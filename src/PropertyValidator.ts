import * as vscode from "vscode";
import { outputChannel } from "./outputChannel";
import { getCustomPatterns, isPropertyDefined } from "./utils";

export function validateProperties(
  document: vscode.TextDocument,
  diagnostics: vscode.DiagnosticCollection
) {
  const text = document.getText();
  const patterns = getCustomPatterns();
  let errors: vscode.Diagnostic[] = [];

  outputChannel.appendLine("🔍 プロパティ検証開始...");

  for (const regex of patterns) {
    regex.lastIndex = 0; // ✅ 検索位置リセット
    let match;

    while ((match = regex.exec(text)) !== null) {
      const key = match[1] || match[2]; // 🔍 マッチしたキーを取得
      if (!key) continue;

      const trimmedKey = key.trim(); // ✅ 余計なスペース削除

      const range = new vscode.Range(
        document.positionAt(match.index + match[0].indexOf(trimmedKey)),
        document.positionAt(
          match.index + match[0].indexOf(trimmedKey) + trimmedKey.length
        )
      );

      if (!isPropertyDefined(trimmedKey)) {
        const diagnostic = new vscode.Diagnostic(
          range,
          `🚨 未定義のメッセージキー: '${trimmedKey}'`,
          vscode.DiagnosticSeverity.Warning
        );
        diagnostic.code = "undefinedMessageKey";
        errors.push(diagnostic);
        outputChannel.appendLine(`❌ 未定義キー検出: ${trimmedKey}`);
      }
    }
  }

  diagnostics.set(document.uri, errors);
  outputChannel.appendLine(
    `✅ プロパティ検証完了: ${errors.length} 件のエラー`
  );
}
