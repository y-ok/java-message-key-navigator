import * as vscode from "vscode";
import { outputChannel } from "./outputChannel";
import { findPropertyLocation, getCustomPatterns } from "./utils";

export class PropertiesDefinitionProvider implements vscode.DefinitionProvider {
  provideDefinition(
    document: vscode.TextDocument,
    position: vscode.Position
  ): vscode.ProviderResult<vscode.Location> {
    const text = document.getText();
    const offset = document.offsetAt(position);
    const patterns = getCustomPatterns();

    outputChannel.appendLine("🔍 DefinitionProvider を実行...");

    for (const regex of patterns) {
      regex.lastIndex = 0;
      let match;

      while ((match = regex.exec(text)) !== null) {
        const key = match[1];
        if (!key) continue;

        const start = match.index + match[0].indexOf(key);
        const end = start + key.length;

        if (offset >= start && offset <= end) {
          outputChannel.appendLine(`✅ 定義ジャンプ対象キー: ${key}`);
          const location = findPropertyLocation(key);
          if (location) {
            outputChannel.appendLine(
              `🚀 ジャンプ先: ${location.filePath}:${location.position.line}`
            );
            return new vscode.Location(
              vscode.Uri.file(location.filePath),
              location.position
            );
          } else {
            outputChannel.appendLine(`❌ 定義なし: ${key}`);
          }
        }
      }
    }
    return;
  }
}
