import * as vscode from "vscode";
import { Diagnostic, DiagnosticSeverity, Range } from "vscode";
import {
  loadPropertyDefinitions,
  getCustomPatterns,
  isPropertyDefined,
} from "./utils";
import { outputChannel } from "./outputChannel";

/**
 * Validates that every extracted message key is defined in the configured
 * properties files.
 */
export async function validateProperties(
  document: vscode.TextDocument,
  diagnostics: vscode.DiagnosticCollection,
  customGlobs: string[] = [],
  options: { reloadPropertyDefinitions?: boolean } = {}
): Promise<void> {
  outputChannel.appendLine(
    `🔔 validateProperties start: ${JSON.stringify(customGlobs)}`
  );
  if (options.reloadPropertyDefinitions !== false) {
    await loadPropertyDefinitions(customGlobs);
  }

  const text = document.getText();
  const patterns = getCustomPatterns(text);
  const errors: vscode.Diagnostic[] = [];
  outputChannel.appendLine("🔍 Starting properties validation...");

  for (const re of patterns) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const key = m[1]?.trim();
      if (!key) {continue;}
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
  outputChannel.appendLine(
    `✅ Properties validation completed: ${errors.length} errors`
  );
}

/**
 * Validates placeholder indices inside a single message definition.
 */
export function validateMessagePlaceholders(
  key: string,
  value: string,
  range: Range
): Diagnostic | null {
  const placeholderRegex = /\{(\d+)\}/g;
  const found = new Set<number>();
  let match: RegExpExecArray | null;

  while ((match = placeholderRegex.exec(value)) !== null) {
    found.add(parseInt(match[1], 10));
  }

  if (found.size === 0) {
    return null;
  }

  const indices = Array.from(found).sort((a, b) => a - b);

  // Require placeholders to start at {0} and increase without gaps.
  if (indices[0] !== 0 || !indices.every((v, i) => v === i)) {
    return {
      message: `メッセージ内のプレースホルダー {n} は {0} から始まり連番である必要がありますが、不正な順番です: {${indices.join(
        "}, {"
      )}}`,
      range,
      severity: DiagnosticSeverity.Error,
      source: "PropertyValidator",
    };
  }

  return null;
}
