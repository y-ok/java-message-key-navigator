import * as vscode from "vscode";
import { outputChannel } from "./outputChannel";
import {
  getCustomPatterns,
  loadPropertyDefinitions,
  findPropertyLocation,
} from "./utils";

/**
 * Resolves a message key reference to the matching entry in a properties file.
 */
export class PropertiesDefinitionProvider implements vscode.DefinitionProvider {
  /**
   * Returns the definition location for the message key under the cursor.
   */
  public async provideDefinition(
    document: vscode.TextDocument,
    position: vscode.Position
  ): Promise<vscode.Location | null> {
    outputChannel.appendLine("🔍 Executing DefinitionProvider...");

    // Refresh the cache using the configured propertyFileGlobs.
    const customProps = vscode.workspace
      .getConfiguration("java-message-key-navigator")
      .get<string[]>("propertyFileGlobs", []);
    await loadPropertyDefinitions(customProps);

    const text = document.getText();
    const offset = document.offsetAt(position);
    const patterns = getCustomPatterns(text);

    for (const regex of patterns) {
      regex.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = regex.exec(text)) !== null) {
        const key = match[1]?.trim();
        if (!key) {continue;}

        const start = match.index + match[0].indexOf(key);
        const end = start + key.length;
        if (offset < start || offset > end) {continue;}

        outputChannel.appendLine(`✅ Jump target key: ${key}`);

        // Resolve the definition target before constructing the VS Code location.
        const loc = await findPropertyLocation(key);
        if (loc) {
          outputChannel.appendLine(
            `🚀 Jump destination: ${loc.filePath}:${loc.range.start.line + 1}`
          );
          return new vscode.Location(vscode.Uri.file(loc.filePath), loc.range);
        } else {
          outputChannel.appendLine(`❌ Definition not found: ${key}`);
          return null;
        }
      }
    }

    return null;
  }
}
