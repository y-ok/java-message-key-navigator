import * as vscode from "vscode";
import { findPropertyLocation, getCustomPatterns } from "./utils";

export class PropertiesDefinitionProvider implements vscode.DefinitionProvider {
  provideDefinition(
    document: vscode.TextDocument,
    position: vscode.Position
  ): vscode.ProviderResult<vscode.Location> {
    const text = document.getText();
    const offset = document.offsetAt(position);
    const patterns = getCustomPatterns();

    for (const regex of patterns) {
      regex.lastIndex = 0;
      let match;
      while ((match = regex.exec(text)) !== null) {
        const key = match[1];
        if (!key) continue;

        const start = match.index + match[0].indexOf(key);
        const end = start + key.length;

        if (offset >= start && offset <= end) {
          const location = findPropertyLocation(key);
          if (location) {
            return new vscode.Location(
              vscode.Uri.file(location.filePath),
              location.position
            );
          }
        }
      }
    }
    return;
  }
}
