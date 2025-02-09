import * as vscode from "vscode";
import { PropertiesDefinitionProvider } from "./DefinitionProvider";
import { PropertiesHoverProvider } from "./HoverProvider";
import { PropertiesQuickFixProvider } from "./PropertiesQuickFixProvider";
import { validateProperties } from "./PropertyValidator";
import { addPropertyKey } from "./utils";

export function activate(context: vscode.ExtensionContext) {
  const diagnostics = vscode.languages.createDiagnosticCollection("messages");

  context.subscriptions.push(
    vscode.languages.registerHoverProvider(
      "java",
      new PropertiesHoverProvider()
    )
  );
  context.subscriptions.push(
    vscode.languages.registerDefinitionProvider(
      "java",
      new PropertiesDefinitionProvider()
    )
  );
  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider(
      "java",
      new PropertiesQuickFixProvider(),
      { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "java-i18n-ally.addPropertyKey",
      (key: string) => addPropertyKey(key)
    )
  );

  vscode.workspace.onDidOpenTextDocument((document) => {
    if (document.languageId === "java") {
      validateProperties(document, diagnostics);
    }
  });

  vscode.workspace.onDidChangeTextDocument((event) => {
    if (event.document.languageId === "java") {
      validateProperties(event.document, diagnostics);
    }
  });

  vscode.window.onDidChangeActiveTextEditor((editor) => {
    if (editor && editor.document.languageId === "java") {
      validateProperties(editor.document, diagnostics);
    }
  });
}
