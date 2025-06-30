import * as vscode from "vscode";
import { PropertiesDefinitionProvider } from "./DefinitionProvider";
import { PropertiesHoverProvider } from "./HoverProvider";
import { PropertiesQuickFixProvider } from "./PropertiesQuickFixProvider";
import { validateProperties } from "./PropertyValidator";
import { loadPropertyDefinitions } from "./utils";
import { initializeOutputChannel, outputChannel } from "./outputChannel";
import { MessageKeyCompletionProvider } from "./CompletionProvider";
import { validatePlaceholders } from "./diagnostic";

export async function activate(context: vscode.ExtensionContext) {
  initializeOutputChannel();
  console.log("✅ [Java I18N Ally] activate() が呼ばれました");

  // 1. settings から globs を取得して既存定義をロード
  const propertyFileGlobs: string[] = vscode.workspace
    .getConfiguration("java-message-key-navigator")
    .get("propertyFileGlobs", []);
  await loadPropertyDefinitions(propertyFileGlobs);

  outputChannel.appendLine("✅ Java Message Key Navigator is now active");

  // 2. Hover/Definition/QuickFix/Completion Providers 登録
  const selector = { language: "java", scheme: "file" } as const;
  context.subscriptions.push(
    vscode.languages.registerHoverProvider(
      selector,
      new PropertiesHoverProvider()
    ),
    vscode.languages.registerDefinitionProvider(
      selector,
      new PropertiesDefinitionProvider()
    ),
    vscode.languages.registerCodeActionsProvider(
      selector,
      new PropertiesQuickFixProvider(),
      {
        providedCodeActionKinds:
          PropertiesQuickFixProvider.providedCodeActionKinds,
      }
    ),
    vscode.languages.registerCompletionItemProvider(
      selector,
      new MessageKeyCompletionProvider(),
      '"'
    )
  );

  // 3. addPropertyKey コマンド登録
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "java-message-key-navigator.addPropertyKey",
      async (key: string) => {
        const config = vscode.workspace.getConfiguration(
          "java-message-key-navigator"
        );
        const globs: string[] | undefined = config.get("propertyFileGlobs");
        if (!globs || globs.length === 0) {
          vscode.window.showWarningMessage(
            "No propertyFileGlobs defined in settings."
          );
          return;
        }

        let uris: vscode.Uri[] = [];
        for (const glob of globs) {
          const found = await vscode.workspace.findFiles(glob);
          uris.push(...found);
        }
        if (uris.length === 0) {
          vscode.window.showWarningMessage(
            "No properties files found matching propertyFileGlobs."
          );
          return;
        }

        const picks = uris.map((uri) => ({
          label: vscode.workspace.asRelativePath(uri),
          uri,
        }));
        const selected = await vscode.window.showQuickPick(picks, {
          placeHolder: `Select properties file to add the key "${key}"`,
        });
        if (!selected) {
          vscode.window.showInformationMessage("Key addition canceled.");
          return;
        }

        const doc = await vscode.workspace.openTextDocument(selected.uri);
        const edit = new vscode.WorkspaceEdit();
        const lastLine = doc.lineAt(doc.lineCount - 1);
        edit.insert(selected.uri, lastLine.range.end, `\n${key}=`);
        await vscode.workspace.applyEdit(edit);
        await doc.save();

        vscode.window.showInformationMessage(
          `✅ Key "${key}" added to ${selected.label}`
        );
      }
    )
  );

  // 4. DiagnosticCollection を 2つ 作成
  const propDiagnostics =
    vscode.languages.createDiagnosticCollection("messages");
  const phDiagnostics =
    vscode.languages.createDiagnosticCollection("placeholders");
  context.subscriptions.push(propDiagnostics, phDiagnostics);

  // 5. properties と placeholders を同時に検証するスケジューラ
  let validationTimeout: NodeJS.Timeout;
  const scheduleAll = (doc: vscode.TextDocument) => {
    if (doc.languageId !== "java") return;
    clearTimeout(validationTimeout);
    validationTimeout = setTimeout(async () => {
      outputChannel.appendLine("🔍 Re-validating properties and placeholders…");
      await validateProperties(doc, propDiagnostics, propertyFileGlobs);
      await validatePlaceholders(doc, phDiagnostics);
    }, 500);
  };

  // 6. ドキュメント／エディタ切替イベントにスケジューラを登録
  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(scheduleAll),
    vscode.workspace.onDidChangeTextDocument((e) => scheduleAll(e.document)),
    vscode.workspace.onDidSaveTextDocument(scheduleAll),
    vscode.window.onDidChangeActiveTextEditor(
      (ed) => ed?.document && scheduleAll(ed.document)
    )
  );

  // 7. 有効化時にアクティブなエディタを一度検証
  if (vscode.window.activeTextEditor) {
    scheduleAll(vscode.window.activeTextEditor.document);
  }

  // 8. 起動完了メッセージ（任意）
  vscode.window.showInformationMessage(
    "Java Message Key Navigator is now active 🚀"
  );
}
