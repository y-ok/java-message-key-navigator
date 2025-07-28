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
    if (diagnostics.length === 0) return [];

    // ① 診断からキー文字列を抜き取り
    const key = document.getText(range).replace(/["']/g, "").trim();
    outputChannel.appendLine(`🔍 Undefined key: ${key}`);

    // ② ユーザー設定から glob パターンを取得
    const config = vscode.workspace.getConfiguration(
      "java-message-key-navigator"
    );
    const globs: string[] = config.get("propertyFileGlobs", [
      "**/*.properties",
    ]);

    // ③ 設定された glob をすべて検索して最初にヒットしたファイルを選択
    const uris: vscode.Uri[] = [];
    for (const g of globs) {
      const found = await vscode.workspace.findFiles(g, undefined, 1);
      if (found.length) {
        uris.push(found[0]);
        break;
      }
    }
    const fileToUse = uris.length > 0 ? uris[0].fsPath : globs[0];

    const title = `💾 Add "${key}" to properties file`;
    const action = new vscode.CodeAction(title, vscode.CodeActionKind.QuickFix);
    action.diagnostics = diagnostics;
    // ④ addPropertyKey に key と fileToUse を渡す
    action.command = {
      command: "java-message-key-navigator.addPropertyKey",
      title,
      arguments: [key, fileToUse],
    };
    outputChannel.appendLine(`✅ Quick fix added: ${title}`);

    return [action];
  }
}
