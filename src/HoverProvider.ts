import * as vscode from "vscode";
import { outputChannel } from "./outputChannel";
import { getCustomPatterns, getPropertyValue } from "./utils";

export class PropertiesHoverProvider implements vscode.HoverProvider {
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
          processedKeys.add(key);
          outputChannel.appendLine(
            `✅ Hover対象キー: ${key} (パターン: ${regex})`
          );

          let value = getPropertyValue(key);
          if (value) {
            // 🔹 `=` を含む場合はコードブロックで囲む
            if (value.includes("=")) {
              value = "```\n" + value + "\n```";
            }

            outputChannel.appendLine(
              `📢 Hoverメッセージを表示: 🔤 **メッセージ:** ${value}`
            );
            return new vscode.Hover(new vscode.MarkdownString(value));
          }
        }
      }
    }

    return;
  }
}
