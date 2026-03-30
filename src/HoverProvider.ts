import * as vscode from "vscode";
import { getCustomPatterns, getPropertyValue } from "./utils";
import { outputChannel } from "./outputChannel";

/**
 * Shows the resolved property value when hovering a supported message key.
 */
export class PropertiesHoverProvider implements vscode.HoverProvider {
  /**
   * Returns hover content for the message key under the cursor.
   *
   * @param document Document containing candidate message-key usages.
   * @param position Cursor position where hover was triggered.
   */
  public provideHover(
    document: vscode.TextDocument,
    position: vscode.Position
  ): vscode.ProviderResult<vscode.Hover> {
    const text = document.getText();
    const offset = document.offsetAt(position);

    // Collect configured extraction patterns such as method calls and annotations.
    const patterns = getCustomPatterns(text);
    const processedKeys = new Set<string>();

    for (const regex of patterns) {
      regex.lastIndex = 0;
      let match: RegExpExecArray | null;

      // Match the configured pattern across the whole document.
      while ((match = regex.exec(text)) !== null) {
        // Treat every captured group as a possible message key.
        const keys = match
          .slice(1)
          .filter((g): g is string => typeof g === "string");

        for (const key of keys) {
          if (!key || processedKeys.has(key)) {continue;}

          // Compute the captured key range inside the document text.
          const start = match.index + match[0].indexOf(key);
          const end = start + key.length;

          // Return hover content only when the cursor is inside the key range.
          if (offset >= start && offset <= end) {
            processedKeys.add(key);
            outputChannel.appendLine(
              `✅ Hover target key: ${key} (pattern: ${regex})`
            );

            let value = getPropertyValue(key);
            if (value) {
              // Render multi-part values in a code block when they contain "=".
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

    // Return nothing when the cursor is not on a supported key reference.
    return;
  }
}
