import * as vscode from "vscode";

export const outputChannel =
  vscode.window.createOutputChannel("Java I18N Ally");

// 拡張機能が有効化されたら初回のメッセージを表示
export function initializeOutputChannel() {
  outputChannel.clear(); // 前回のログをクリア
  outputChannel.show(true); // 出力パネルを表示
  outputChannel.appendLine(
    "✅ Java I18N Ally: 出力コンソールが初期化されました"
  );
}
