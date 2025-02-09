import * as vscode from "vscode";
import { PropertiesDefinitionProvider } from "./DefinitionProvider";
import { PropertiesHoverProvider } from "./HoverProvider";
import { PropertiesQuickFixProvider } from "./PropertiesQuickFixProvider";
import { validateProperties } from "./PropertyValidator";
import { outputChannel } from "./outputChannel";
import { addPropertyKey } from "./utils";

export function activate(context: vscode.ExtensionContext) {
  outputChannel.appendLine("✅ Java I18N Ally: 拡張機能が有効化されました");

  const diagnostics = vscode.languages.createDiagnosticCollection("messages");

  // 🔹 HoverProvider, DefinitionProvider, QuickFixProvider の二重登録防止
  if (
    !context.subscriptions.some(
      (sub) =>
        sub instanceof vscode.Disposable &&
        (sub as any).constructor.name === "PropertiesHoverProvider"
    )
  ) {
    context.subscriptions.push(
      vscode.languages.registerHoverProvider(
        "java",
        new PropertiesHoverProvider()
      )
    );
  }

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

  // ✅ メッセージキー追加コマンドを登録
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "java-i18n-ally.addPropertyKey",
      addPropertyKey
    )
  );

  // ✅ Java ファイルが開かれた・変更されたときに診断実行
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

  vscode.window.showInformationMessage("Java I18N Ally が有効になりました 🚀");
}
