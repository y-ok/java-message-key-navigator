import * as vscode from "vscode";
import { outputChannel } from "./outputChannel";

/**
 * Offers quick fixes for diagnostics related to missing properties entries.
 */
export class PropertiesQuickFixProvider implements vscode.CodeActionProvider {
  public static readonly providedCodeActionKinds = [
    vscode.CodeActionKind.QuickFix,
  ];

  /**
   * Creates a quick fix that inserts the missing key into a properties file.
   *
   * @param document Source document that reported the undefined key.
   * @param range Diagnostic range that points to the key usage.
   * @param context Code-action context including active diagnostics.
   */
  public async provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range,
    context: vscode.CodeActionContext
  ): Promise<vscode.CodeAction[]> {
    const diagnostics = context.diagnostics.filter(
      (d) =>
        d.code === "undefinedMessageKey" &&
        d.range.intersection(range) !== undefined
    );
    if (diagnostics.length === 0) {return [];}

    // Extract the missing key from the diagnostic range.
    const key = document.getText(range).replace(/["']/g, "").trim();
    outputChannel.appendLine(`🔍 Undefined key: ${key}`);

    // Build the quick fix; the command handler performs file selection.
    const title = `💾 Add "${key}" to properties file`;
    const action = new vscode.CodeAction(title, vscode.CodeActionKind.QuickFix);
    action.diagnostics = diagnostics;
    action.command = {
      command: "java-message-key-navigator.addPropertyKey",
      title,
      arguments: [key],
    };
    outputChannel.appendLine(`✅ Quick fix added: ${title}`);

    return [action];
  }
}
