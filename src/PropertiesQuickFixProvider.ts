import * as vscode from "vscode";
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

    const title = `💾 Add "${key}" to properties file`;
    const action = new vscode.CodeAction(title, vscode.CodeActionKind.QuickFix);
    action.command = {
      command: "java-message-key-navigator.addPropertyKey",
      title,
      arguments: [key],
    };
    action.diagnostics = diagnostics;
    outputChannel.appendLine(`✅ Quick fix added: ${title}`);

    return [action];
  }
}
