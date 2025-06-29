import * as vscode from "vscode";
import {
  loadPropertyDefinitions,
  getCustomPatterns,
  isPropertyDefined,
} from "./utils";
import { outputChannel } from "./outputChannel";

export async function validateProperties(
  document: vscode.TextDocument,
  diagnostics: vscode.DiagnosticCollection,
  customGlobs: string[] = []
): Promise<void> {
  outputChannel.appendLine(`🔔 validateProperties start: ${JSON.stringify(customGlobs)}`);
  await loadPropertyDefinitions(customGlobs);

  const text = document.getText();
  const patterns = getCustomPatterns();
  const errors: vscode.Diagnostic[] = [];
  outputChannel.appendLine("🔍 Starting properties validation...");

  for (const re of patterns) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const key = m[1]?.trim();
      if (!key) continue;
      const start = document.positionAt(m.index + m[0].indexOf(key));
      const end = document.positionAt(m.index + m[0].indexOf(key) + key.length);
      const range = new vscode.Range(start, end);
      if (!isPropertyDefined(key)) {
        const diag = new vscode.Diagnostic(
          range,
          `🚨 Undefined message key: '${key}'`,
          vscode.DiagnosticSeverity.Warning
        );
        diag.code = "undefinedMessageKey";
        errors.push(diag);
        outputChannel.appendLine(`❌ Undefined key detected: ${key}`);
      }
    }
  }

  diagnostics.set(document.uri, errors);
  outputChannel.appendLine(`✅ Properties validation completed: ${errors.length} errors`);
}
