console.log("🔍 [Java I18N Ally] extension.ts をロードしました");

import * as vscode from "vscode";
import { PropertiesDefinitionProvider } from "./DefinitionProvider";
import { PropertiesHoverProvider } from "./HoverProvider";
import { PropertiesQuickFixProvider } from "./PropertiesQuickFixProvider";
import { validateProperties } from "./PropertyValidator";
import { loadPropertyDefinitions, addPropertyKey } from "./utils";
import { initializeOutputChannel, outputChannel } from "./outputChannel";
import { MessageKeyCompletionProvider } from "./CompletionProvider";

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
    vscode.languages.registerHoverProvider(
      selector,
      new PropertiesHoverProvider()
    )
  );
  context.subscriptions.push(
    vscode.languages.registerDefinitionProvider(
      selector,
      new PropertiesDefinitionProvider()
    )
  );
  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider(
      selector,
      new PropertiesQuickFixProvider(),
      {
        providedCodeActionKinds:
          PropertiesQuickFixProvider.providedCodeActionKinds,
      }
    )
  );

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
      if (
        e.affectsConfiguration("java-message-key-navigator.propertyFileGlobs")
      ) {
        const newGlobs: string[] = vscode.workspace
          .getConfiguration("java-message-key-navigator")
          .get("propertyFileGlobs", []);
        outputChannel.appendLine(
          `🔄 Updated propertyFileGlobs: ${JSON.stringify(newGlobs)}`
        );
        await loadPropertyDefinitions(newGlobs);
      }
    })
  );

  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
      { scheme: "file", language: "java" },
      new MessageKeyCompletionProvider(),
      '"'
    )
  );

  vscode.window.showInformationMessage(
    "Java Message Key Navigator is now active 🚀"
  );
}
