import * as vscode from "vscode";
import { outputChannel } from "./outputChannel";

export class PropertiesQuickFixProvider implements vscode.CodeActionProvider {
  public static readonly providedCodeActionKinds = [
    vscode.CodeActionKind.QuickFix,
  ];

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

    // ① 診断からキー文字列を抜き取り
    const key = document.getText(range).replace(/["']/g, "").trim();
    outputChannel.appendLine(`🔍 Undefined key: ${key}`);

    // ② アクションを生成（ファイル選択はコマンドハンドラ側の showQuickPick で行う）
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
