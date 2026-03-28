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

    // ② ユーザー設定から glob パターンを取得
    const config = vscode.workspace.getConfiguration(
      "java-message-key-navigator"
    );
    const globs: string[] = config.get("propertyFileGlobs", []);

    // ③ 設定された glob をすべて検索してファイル存在を確認（重複排除）
    const seen = new Set<string>();
    const uris: vscode.Uri[] = [];
    for (const g of globs) {
      const found = await vscode.workspace.findFiles(g);
      for (const uri of found) {
        if (!seen.has(uri.fsPath)) {
          seen.add(uri.fsPath);
          uris.push(uri);
        }
      }
    }
    if (uris.length === 0) {return [];}

    // ④ 1件のアクションを返す（ファイル選択はコマンドハンドラ側の showQuickPick で行う）
    const title = `💾 Add "${key}" to properties file`;
    const action = new vscode.CodeAction(title, vscode.CodeActionKind.QuickFix);
    action.diagnostics = [...diagnostics];
    action.command = {
      command: "java-message-key-navigator.addPropertyKey",
      title,
      arguments: [key],
    };
    outputChannel.appendLine(`✅ Quick fix added: ${title}`);

    return [action];
  }
}
