import * as vscode from "vscode";
import { PropertiesDefinitionProvider } from "./DefinitionProvider";
import { PropertiesHoverProvider } from "./HoverProvider";
import { PropertiesQuickFixProvider } from "./PropertiesQuickFixProvider";
import { validateProperties } from "./PropertyValidator";
import { loadPropertyDefinitions } from "./utils";
import { initializeOutputChannel, outputChannel } from "./outputChannel";
import { MessageKeyCompletionProvider } from "./CompletionProvider";
import { validatePlaceholders } from "./diagnostic";
import { isExcludedFile } from "./utils";

class FilteredHoverProvider implements vscode.HoverProvider {
  constructor(private base: vscode.HoverProvider) {}
  provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.Hover> {
    if (isExcludedFile(document.uri.fsPath)) return undefined;
    return this.base.provideHover(document, position, token);
  }
}

class FilteredDefinitionProvider implements vscode.DefinitionProvider {
  constructor(private base: vscode.DefinitionProvider) {}
  provideDefinition(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.Definition | vscode.LocationLink[]> {
    if (isExcludedFile(document.uri.fsPath)) return undefined;
    return this.base.provideDefinition(document, position, token);
  }
}

class FilteredQuickFixProvider implements vscode.CodeActionProvider {
  constructor(private base: vscode.CodeActionProvider) {}

  // Overloads to match VSCode CodeActionProvider signature
  provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range,
    context: vscode.CodeActionContext,
    token: vscode.CancellationToken
  ): vscode.ProviderResult<(vscode.CodeAction | vscode.Command)[]>;
  provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Selection,
    context: vscode.CodeActionContext,
    token: vscode.CancellationToken
  ): vscode.ProviderResult<(vscode.CodeAction | vscode.Command)[]>;
  provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range | vscode.Selection,
    context: vscode.CodeActionContext,
    token: vscode.CancellationToken
  ): vscode.ProviderResult<(vscode.CodeAction | vscode.Command)[]> {
    if (isExcludedFile(document.uri.fsPath)) {
      return [];
    }
    return this.base.provideCodeActions(document, range as any, context, token);
  }
}

class FilteredCompletionProvider implements vscode.CompletionItemProvider {
  constructor(private base: vscode.CompletionItemProvider) {}
  provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken,
    context: vscode.CompletionContext
  ): vscode.ProviderResult<vscode.CompletionItem[] | vscode.CompletionList> {
    if (isExcludedFile(document.uri.fsPath)) return undefined;
    return this.base.provideCompletionItems(document, position, token, context);
  }
}

export async function activate(
  context: vscode.ExtensionContext & { secrets?: any }
) {
  initializeOutputChannel();

  const propertyFileGlobs: string[] =
    vscode.workspace
      .getConfiguration("java-message-key-navigator")
      .get("propertyFileGlobs", []) ?? [];
  await loadPropertyDefinitions(propertyFileGlobs);

  outputChannel.appendLine("✅ Java Message Key Navigator is now active");

  const selector = { language: "java", scheme: "file" } as const;
  context.subscriptions.push(
    vscode.languages.registerHoverProvider(
      selector,
      new FilteredHoverProvider(new PropertiesHoverProvider())
    ),
    vscode.languages.registerDefinitionProvider(
      selector,
      new FilteredDefinitionProvider(new PropertiesDefinitionProvider())
    ),
    vscode.languages.registerCodeActionsProvider(
      selector,
      new FilteredQuickFixProvider(new PropertiesQuickFixProvider()),
      {
        providedCodeActionKinds:
          PropertiesQuickFixProvider.providedCodeActionKinds,
      }
    ),
    vscode.languages.registerCompletionItemProvider(
      selector,
      new FilteredCompletionProvider(new MessageKeyCompletionProvider()),
      '"'
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

  const propDiagnostics =
    vscode.languages.createDiagnosticCollection("messages");
  const phDiagnostics =
    vscode.languages.createDiagnosticCollection("placeholders");
  context.subscriptions.push(propDiagnostics, phDiagnostics);

  let validationTimeout: NodeJS.Timeout;
  const scheduleAll = (doc: vscode.TextDocument) => {
    if (doc.languageId !== "java" || isExcludedFile(doc.uri.fsPath)) {
      return;
    }
    clearTimeout(validationTimeout);
    validationTimeout = setTimeout(async () => {
      outputChannel.appendLine(
        "🔍 Re-validating properties and placeholders…"
      );
      await validateProperties(doc, propDiagnostics, propertyFileGlobs);
      await validatePlaceholders(doc, phDiagnostics);
    }, 500);
  };

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(scheduleAll),
    vscode.workspace.onDidChangeTextDocument((e) => scheduleAll(e.document)),
    vscode.workspace.onDidSaveTextDocument(scheduleAll),
    vscode.window.onDidChangeActiveTextEditor((ed) =>
      ed?.document && scheduleAll(ed.document)
    )
  );

  if (vscode.window.activeTextEditor) {
    scheduleAll(vscode.window.activeTextEditor.document);
  }

  vscode.window.showInformationMessage(
    "Java Message Key Navigator is now active 🚀"
  );
}
