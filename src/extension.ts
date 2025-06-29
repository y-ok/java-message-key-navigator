console.log("🔍 [Java I18N Ally] extension.ts をロードしました");

import * as vscode from "vscode";
import { PropertiesDefinitionProvider } from "./DefinitionProvider";
import { PropertiesHoverProvider } from "./HoverProvider";
import { PropertiesQuickFixProvider } from "./PropertiesQuickFixProvider";
import { validateProperties } from "./PropertyValidator";
import { loadPropertyDefinitions, addPropertyKey } from "./utils";
import { initializeOutputChannel, outputChannel } from "./outputChannel";

export async function activate(context: vscode.ExtensionContext) {
  initializeOutputChannel();
  console.log("✅ [Java I18N Ally] activate() が呼ばれました");

  const propertyFileGlobs: string[] = vscode.workspace
    .getConfiguration("java-message-key-navigator")
    .get("propertyFileGlobs", []);

  // デフォルトファイルは読み込まず、カスタムのみ
  await loadPropertyDefinitions(propertyFileGlobs);

  outputChannel.appendLine("✅ Java Message Key Navigator is now active");
  const diagnostics = vscode.languages.createDiagnosticCollection("messages");
  const selector = { language: "java", scheme: "file" } as const;

  context.subscriptions.push(
    vscode.languages.registerHoverProvider(selector, new PropertiesHoverProvider())
  );
  context.subscriptions.push(
    vscode.languages.registerDefinitionProvider(selector, new PropertiesDefinitionProvider())
  );
  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider(
      selector,
      new PropertiesQuickFixProvider(),
      { providedCodeActionKinds: PropertiesQuickFixProvider.providedCodeActionKinds }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("java-message-key-navigator.addPropertyKey", addPropertyKey)
  );

  let timeout: NodeJS.Timeout;
  const schedule = (doc: vscode.TextDocument) => {
    if (doc.languageId !== "java") return;
    clearTimeout(timeout);
    timeout = setTimeout(async () => {
      outputChannel.appendLine("🔍 Re-validating due to document change...");
      await validateProperties(doc, diagnostics, propertyFileGlobs);
    }, 500);
  };

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(async (doc) => {
      if (doc.languageId === "java") {
        await validateProperties(doc, diagnostics, propertyFileGlobs);
      }
    })
  );
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((e) => schedule(e.document))
  );
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(async (ed) => {
      if (ed?.document.languageId === "java") {
        await validateProperties(ed.document, diagnostics, propertyFileGlobs);
      }
    })
  );
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(async (e) => {
      if (e.affectsConfiguration("java-message-key-navigator.propertyFileGlobs")) {
        const newGlobs: string[] = vscode.workspace
          .getConfiguration("java-message-key-navigator")
          .get("propertyFileGlobs", []);
        outputChannel.appendLine(`🔄 Updated propertyFileGlobs: ${JSON.stringify(newGlobs)}`);
        await loadPropertyDefinitions(newGlobs);
      }
    })
  );

  vscode.window.showInformationMessage("Java Message Key Navigator is now active 🚀");
}
