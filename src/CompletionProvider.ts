import * as vscode from "vscode";
import { getAllPropertyKeys, getPropertyValue } from "./utils";

export class MessageKeyCompletionProvider
  implements vscode.CompletionItemProvider
{
  async provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position
  ) {
    const config = vscode.workspace.getConfiguration(
      "java-message-key-navigator"
    );
    const methodPatterns: string[] | undefined = config.get(
      "messageKeyExtractionPatterns"
    );
    const annotationPatterns: string[] | undefined = config.get(
      "annotationKeyExtractionPatterns"
    );
    const patterns = [...(methodPatterns || []), ...(annotationPatterns || [])];
    if (patterns.length === 0) {
      return undefined;
    }

    const lineText = document.lineAt(position).text;

    // 行にパターンを含むかだけ判定する
    const matchesPattern = patterns.some((pattern) =>
      lineText.includes(pattern)
    );
    if (!matchesPattern) return undefined;

    // 入力中の文字を取得
    const lineUntilPosition = document
      .lineAt(position)
      .text.substring(0, position.character);
    const inputMatch = lineUntilPosition.match(/["']([^"']*)$/);
    const input = inputMatch ? inputMatch[1] : "";

    return generateCompletionItems(input);
  }
}

function generateCompletionItems(input: string): vscode.CompletionItem[] {
  const keys = getAllPropertyKeys();
  const filteredKeys = input
    ? keys.filter((key) => key.toLowerCase().includes(input.toLowerCase()))
    : keys;

  return filteredKeys.map((key) => {
    const value = getPropertyValue(key) || "";
    const item = new vscode.CompletionItem(
      `${key} - ${value}`,
      vscode.CompletionItemKind.Value
    );
    item.insertText = key;
    item.documentation = new vscode.MarkdownString(`**${key}**\n\n${value}`);
    return item;
  });
}
