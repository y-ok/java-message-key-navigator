import * as vscode from "vscode";

// 再代入可能に let で宣言
export let outputChannel: vscode.OutputChannel;

/**
 * 拡張機能が有効化されたら初回のメッセージを表示
 * すでに作られていれば clear()、作られていなければ create
 */
export function initializeOutputChannel() {
  if (outputChannel) {
    outputChannel.clear();
  } else {
    outputChannel = vscode.window.createOutputChannel("Java Message Key Navigator");
  }

  // タブは自動で開かない
  outputChannel.appendLine(
    "✅ Java Message Key Navigator: output console initialized"
  );
}