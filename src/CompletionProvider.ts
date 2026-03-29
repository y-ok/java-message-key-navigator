import * as vscode from "vscode";
import { getAllPropertyKeys, getPropertyValue } from "./utils";

/**
 * Provides completion candidates for message keys while editing supported Java
 * method calls and annotations.
 */
export class MessageKeyCompletionProvider
  implements vscode.CompletionItemProvider
{
  /**
   * Returns completion items that match the partially typed message key.
   */
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

    // Only check whether the current line contains one of the configured patterns.
    const matchesPattern = patterns.some((pattern) =>
      lineText.includes(pattern)
    );
    if (!matchesPattern) {return undefined;}

    // Extract the partial key being typed inside the current string literal.
    const lineUntilPosition = document
      .lineAt(position)
      .text.substring(0, position.character);
    const inputMatch = lineUntilPosition.match(/["']([^"']*)$/);
    const input = inputMatch ? inputMatch[1] : "";

    return generateCompletionItems(input);
  }
}

/**
 * Builds completion items enriched with the corresponding property value.
 */
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
