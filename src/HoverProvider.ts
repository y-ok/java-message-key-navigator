import * as vscode from "vscode";
import { outputChannel } from "./outputChannel";
import { getCustomPatterns, getPropertyValue } from "./utils";

export class PropertiesHoverProvider implements vscode.HoverProvider {
  private lastHoveredKey: string | null = null;

  provideHover(
    document: vscode.TextDocument,
    position: vscode.Position
  ): vscode.ProviderResult<vscode.Hover> {
    const text = document.getText();
    const offset = document.offsetAt(position);
    const patterns = getCustomPatterns();
    const processedKeys = new Set<string>();

    outputChannel.appendLine("🔍 Hover処理を実行...");

    for (const regex of patterns) {
      regex.lastIndex = 0;
      let match;

      while ((match = regex.exec(text)) !== null) {
        const key = match[1];
        if (!key || processedKeys.has(key)) continue;

        const start = match.index + match[0].indexOf(key);
        const end = start + key.length;

        if (offset >= start && offset <= end) {
          if (this.lastHoveredKey === key) {
            outputChannel.appendLine(`⚠️ 直前と同じキーのため無視: ${key}`);
            return;
          }
          this.lastHoveredKey = key;

          processedKeys.add(key);
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
