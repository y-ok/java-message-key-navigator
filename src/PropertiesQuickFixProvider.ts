import * as vscode from "vscode";
import * as path from "path";
import { outputChannel } from "./outputChannel";

export class PropertiesQuickFixProvider implements vscode.CodeActionProvider {
  public static readonly providedCodeActionKinds = [
    vscode.CodeActionKind.QuickFix,
  ];

  provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range,
    context: vscode.CodeActionContext
  ): vscode.CodeAction[] {
    const diagnostics = context.diagnostics.filter(
      (d) =>
        d.code === "undefinedMessageKey" &&
        d.range.intersection(range) !== undefined
    );
    if (diagnostics.length === 0) return [];

    const key = document.getText(range).replace(/"/g, "").trim();
    outputChannel.appendLine(`🔍 Undefined key: ${key}`);

    const customProps: string[] = vscode.workspace
      .getConfiguration("java-message-key-navigator")
      .get("propertyFileGlobs", []);
    if (customProps.length === 0) return [];

    return customProps.map((filePath) => {
      const label = path.basename(filePath);
      const title = `💾 Added "${key}" to ${label}`;
      const action = new vscode.CodeAction(title, vscode.CodeActionKind.QuickFix);
      action.command = {
        command: "java-message-key-navigator.addPropertyKey",
        title,
        arguments: [key, filePath],
      };
      action.diagnostics = diagnostics;
      outputChannel.appendLine(`✅ Quick fix added: ${title}`);
      return action;
    });
  }
}
