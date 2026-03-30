import * as vscode from "vscode";
import { getAllPropertyKeys, getPropertyValue } from "./utils";
import {
  inferAnnotationTargets,
  inferMethodPatterns,
  matchesInferredCompletionContext,
} from "./inference";

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
    const lineUntilPosition = document
      .lineAt(position)
      .text.substring(0, position.character);
    if (typeof (document as any).getText !== "function") {
      return undefined;
    }
    const text = document.getText();
    const definedKeys = new Set(getAllPropertyKeys());
    const inferredMethods = inferMethodPatterns(text, definedKeys);
    const inferredAnnotations = inferAnnotationTargets(text, definedKeys);
    const matchesPattern = matchesInferredCompletionContext(
      lineUntilPosition,
      inferredMethods,
      inferredAnnotations
    );

    if (!matchesPattern) {
      return undefined;
    }

    // Extract the partial key being typed inside the current string literal.
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
