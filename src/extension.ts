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

  // ✅ HoverProvider, DefinitionProvider, QuickFixProvider を登録
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

  // ✅ メッセージキー追加コマンドを登録
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "java-i18n-ally.addPropertyKey",
      addPropertyKey
    )
  );

  // ✅ ドキュメント変更時の処理を最適化
  let validationTimeout: NodeJS.Timeout | undefined;

  function scheduleValidation(document: vscode.TextDocument) {
    if (document.languageId !== "java") return;

    if (validationTimeout) clearTimeout(validationTimeout);

    validationTimeout = setTimeout(() => {
      outputChannel.appendLine(
        "🔍 ドキュメント変更によりプロパティを再検証..."
      );
      validateProperties(document, diagnostics);
    }, 500); // 500ms 待機して変更が止まったら実行
  }

  vscode.workspace.onDidOpenTextDocument((document) => {
    if (document.languageId === "java") {
      validateProperties(document, diagnostics);
    }
  });

  vscode.workspace.onDidChangeTextDocument((event) => {
    scheduleValidation(event.document);
  });

  vscode.window.onDidChangeActiveTextEditor((editor) => {
    if (editor && editor.document.languageId === "java") {
      validateProperties(editor.document, diagnostics);
    }
  });

  vscode.window.showInformationMessage("Java I18N Ally が有効になりました 🚀");
}
