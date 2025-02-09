import * as vscode from "vscode";
import { outputChannel } from "./outputChannel";
import { getCustomPatterns, getPropertyValue } from "./utils";

export class PropertiesHoverProvider implements vscode.HoverProvider {
  private lastHoveredKey: string | null = null;
  private processedKeys = new Set<string>();

  constructor() {
    vscode.window.onDidChangeActiveTextEditor(() => {
      this.resetState();
    });

    vscode.workspace.onDidChangeTextDocument(() => {
      this.resetState();
    });
  }

  private resetState() {
    outputChannel.appendLine("🔄 ドキュメント変更により状態をリセット");
    this.lastHoveredKey = null;
    this.processedKeys.clear();
  }

  provideHover(
    document: vscode.TextDocument,
    position: vscode.Position
  ): vscode.ProviderResult<vscode.Hover> {
    const text = document.getText();
    const offset = document.offsetAt(position);
    const patterns = getCustomPatterns();

    outputChannel.appendLine("🔍 Hover処理を実行...");

    for (const regex of patterns) {
      regex.lastIndex = 0;
      let match;

      while ((match = regex.exec(text)) !== null) {
        const key = match[1];
        if (!key) continue;

        const start = match.index + match[0].indexOf(key);
        const end = start + key.length;

        if (offset >= start && offset <= end) {
          if (this.lastHoveredKey === key) {
            outputChannel.appendLine(`⚠️ 直前と同じキーのため無視: ${key}`);
            return;
          }

          if (this.processedKeys.has(key)) {
            outputChannel.appendLine(`⚠️ 既に処理済みのキーをスキップ: ${key}`);
            continue;
          }

          this.lastHoveredKey = key;
          this.processedKeys.add(key);

          outputChannel.appendLine(
            `✅ Hover対象キー: ${key} (パターン: ${regex})`
          );

          const value = getPropertyValue(key);
          if (value) {
            outputChannel.appendLine(
              `📢 Hoverメッセージを表示: 🔤 **メッセージ:** ${value}`
            );
            return new vscode.Hover(`🔤 **メッセージ:** ${value}`);
          }
        }
      }
    }

    return;
  }
}
