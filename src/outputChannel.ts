import * as vscode from "vscode";

/**
 * Shared output channel used by the extension for debug and validation logs.
 */
export let outputChannel: vscode.OutputChannel;

/**
 * Creates or resets the extension output channel.
 */
export function initializeOutputChannel() {
  if (outputChannel) {
    outputChannel.clear();
  } else {
    outputChannel = vscode.window.createOutputChannel(
      "Java Message Key Navigator"
    );
  }

  // Keep the output tab hidden until the user opens it explicitly.
  outputChannel.appendLine(
    "✅ Java Message Key Navigator: output console initialized"
  );
}
