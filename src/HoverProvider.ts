import * as vscode from "vscode";
import { getCustomPatterns, getPropertyValue } from "./utils";

export class PropertiesHoverProvider implements vscode.HoverProvider {
  provideHover(
    document: vscode.TextDocument,
    position: vscode.Position
  ): vscode.ProviderResult<vscode.Hover> {
    const text = document.getText();
    const offset = document.offsetAt(position);
    const patterns = getCustomPatterns();

    for (const regex of patterns) {
      regex.lastIndex = 0;
      let match;
      while ((match = regex.exec(text)) !== null) {
        const key = match[1];
        if (!key) continue;

        const start = match.index + match[0].indexOf(key);
        const end = start + key.length;

        if (offset >= start && offset <= end) {
          const value = getPropertyValue(key);
          if (value) {
            return new vscode.Hover(`🔤 **メッセージ:** ${value}`);
          }
        }
      }
    }
    return;
  }
}
