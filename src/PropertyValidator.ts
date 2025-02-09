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

  for (const regex of patterns) {
    let match;
    while ((match = regex.exec(text)) !== null) {
      const key = match[1] || match[2];
      const range = new vscode.Range(
        document.positionAt(match.index + match[0].indexOf(key)),
        document.positionAt(match.index + match[0].indexOf(key) + key.length)
      );

      if (!isPropertyDefined(key)) {
        const diagnostic = new vscode.Diagnostic(
          range,
          `🚨 未定義のメッセージキー: '${key}'`,
          vscode.DiagnosticSeverity.Warning
        );
        diagnostic.code = "undefinedMessageKey";
        errors.push(diagnostic);
        outputChannel.appendLine(`❌ 未定義キー検出: ${key}`);
      }
    }
  }
  diagnostics.set(document.uri, errors);
  outputChannel.appendLine(
    `✅ プロパティ検証完了: ${errors.length} 件のエラー`
  );
}
