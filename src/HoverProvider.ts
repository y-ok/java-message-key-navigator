import * as vscode from "vscode";
import { getCustomPatterns, getPropertyValue } from "./utils";
import { outputChannel } from "./outputChannel";

export class PropertiesHoverProvider implements vscode.HoverProvider {
  public provideHover(
    document: vscode.TextDocument,
    position: vscode.Position
  ): vscode.ProviderResult<vscode.Hover> {
    const text = document.getText();
    const offset = document.offsetAt(position);

    // カスタムパターンを取得 (log("KEY") や @LogStartEnd(...) など)
    const patterns = getCustomPatterns();
    const processedKeys = new Set<string>();

    for (const regex of patterns) {
      regex.lastIndex = 0;
      let match: RegExpExecArray | null;

      // ドキュメント全体をパターンマッチ
      while ((match = regex.exec(text)) !== null) {
        // マッチしたキャプチャグループ (match[1], match[2], …) をすべてキーとして扱う
        const keys = match
          .slice(1)
          .filter((g): g is string => typeof g === "string");

        for (const key of keys) {
          if (!key || processedKeys.has(key)) {continue;}

          // キャプチャ文字列の開始・終了オフセットを計算
          const start = match.index + match[0].indexOf(key);
          const end = start + key.length;

          // カーソル位置がその範囲内ならホバーを返す
          if (offset >= start && offset <= end) {
            processedKeys.add(key);
            outputChannel.appendLine(
              `✅ Hover target key: ${key} (pattern: ${regex})`
            );

            let value = getPropertyValue(key);
            if (value) {
              // メッセージ中に "=" が含まれる場合はコードブロックで囲む
              if (value.includes("=")) {
                value = "```\n" + value + "\n```";
              }
              outputChannel.appendLine(
                `📢 Displaying hover message: 🔤 Message: ${value}`
              );
              return new vscode.Hover(new vscode.MarkdownString(value));
            }
          }
        }
      }
    }

    // マッチしなければ何も返さない
    return;
  }
}
