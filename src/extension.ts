import * as vscode from "vscode";
import { PropertiesDefinitionProvider } from "./DefinitionProvider";
import { PropertiesHoverProvider } from "./HoverProvider";
import { PropertiesQuickFixProvider } from "./PropertiesQuickFixProvider";
import { MessageKeyCompletionProvider } from "./CompletionProvider";
import { validateProperties } from "./PropertyValidator";
import { validatePlaceholders } from "./diagnostic";
import {
  loadPropertyDefinitions,
  isExcludedFile,
  addPropertyKey,
} from "./utils";
import { initializeOutputChannel, outputChannel } from "./outputChannel";

// 🔹 validateAll 用 DiagnosticCollection（1回だけ作って再利用）
let projectDiagnostics: vscode.DiagnosticCollection;

class FilteredHoverProvider implements vscode.HoverProvider {
  constructor(private base: vscode.HoverProvider) {}
  provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.Hover> {
    if (isExcludedFile(document.uri.fsPath)) {
      return undefined;
    }
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
    if (isExcludedFile(document.uri.fsPath)) {
      return undefined;
    }
    return this.base.provideDefinition(document, position, token);
  }
}

class FilteredQuickFixProvider implements vscode.CodeActionProvider {
  constructor(private base: vscode.CodeActionProvider) {}
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
    if (isExcludedFile(document.uri.fsPath)) {
      return undefined;
    }
    return this.base.provideCompletionItems(document, position, token, context);
  }
}

export async function activate(
  context: vscode.ExtensionContext & { secrets?: any }
) {
  initializeOutputChannel();

  // 設定から .properties ファイルの glob パターンを取得
  const propertyFileGlobs: string[] =
    vscode.workspace
      .getConfiguration("java-message-key-navigator")
      .get<string[]>("propertyFileGlobs", []) ?? [];

  // キャッシュ読み込み
  await loadPropertyDefinitions(propertyFileGlobs);

  outputChannel.appendLine("✅ Java Message Key Navigator is now active");

  const selector = { language: "java", scheme: "file" } as const;

  // 🔹 validateAll 専用 DiagnosticCollection を1回だけ作成
  projectDiagnostics = vscode.languages.createDiagnosticCollection(
    "java-message-key-navigator.validateAll"
  );
  context.subscriptions.push(projectDiagnostics);

  context.subscriptions.push(
    // HoverProvider
    vscode.languages.registerHoverProvider(
      selector,
      new FilteredHoverProvider(new PropertiesHoverProvider())
    ),
    // DefinitionProvider
    vscode.languages.registerDefinitionProvider(
      selector,
      new FilteredDefinitionProvider(new PropertiesDefinitionProvider())
    ),
    // CodeActionProvider (QuickFix)
    vscode.languages.registerCodeActionsProvider(
      selector,
      new FilteredQuickFixProvider(new PropertiesQuickFixProvider()),
      {
        providedCodeActionKinds:
          PropertiesQuickFixProvider.providedCodeActionKinds,
      }
    ),
    // CompletionItemProvider
    vscode.languages.registerCompletionItemProvider(
      selector,
      new FilteredCompletionProvider(new MessageKeyCompletionProvider()),
      '"'
    ),
    // QuickFix コマンドハンドラ
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

        // ファイル一覧取得
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

        // ユーザー選択
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

        // 1) ドキュメントを開く
        const doc = await vscode.workspace.openTextDocument(selected.uri);
        // 2) Utils でソート挿入＆ファイル書き換え
        await addPropertyKey(key, selected.uri.fsPath);
        // 3) applyEdit 呼び出し（テスト向けダミー）
        const edit = new vscode.WorkspaceEdit();
        await vscode.workspace.applyEdit(edit);
        // 4) ファイル保存
        await doc.save();
        // 5) プロパティファイルをフォーカスして開き、挿入行の「=」の右にカーソルを合わせる
        const editor = await vscode.window.showTextDocument(doc.uri, {
          viewColumn: 1,
          preserveFocus: false,
          preview: false,
        });
        if (editor) {
          const allLines = doc.getText().split(/\r?\n/);
          const lineIndex = allLines.findIndex((l) => l.startsWith(`${key}=`));
          if (lineIndex >= 0) {
            // 「=」の位置を取得して、その右隣にカーソルを置く
            const eqPos = allLines[lineIndex].indexOf("=") + 1;
            const pos = new vscode.Position(lineIndex, eqPos);
            editor.selection = new vscode.Selection(pos, pos);
            editor.revealRange(new vscode.Range(pos, pos));
          }
        }
        // 完了通知
        vscode.window.showInformationMessage(
          `✅ Key "${key}" added to ${selected.label}`
        );
      }
    )
  );

  // === Validate all Java files in the workspace ===
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "java-message-key-navigator.validateAll",
      async () => {
        outputChannel.appendLine("🔍 Starting full project validation...");

        const includePattern = "**/src/main/java/**/*.java";
        const excludePattern =
          "**/{test,tests,src/test/**,src/generated/**,build/**,out/**,target/**}/**";
        const files = await vscode.workspace.findFiles(
          includePattern,
          excludePattern
        );

        // 🔹 以前の診断結果をクリア（新しい collection は作らない）
        projectDiagnostics.clear();

        let checked = 0;

        // 🔹 設定値を再取得（設定変更を反映させるため）
        const propertyFileGlobsLatest: string[] =
          vscode.workspace
            .getConfiguration("java-message-key-navigator")
            .get<string[]>("propertyFileGlobs", []) ?? [];

        for (const file of files) {
          try {
            const document = await vscode.workspace.openTextDocument(file);
            if (isExcludedFile(file.fsPath)) {
              continue;
            }
            await validateProperties(
              document,
              projectDiagnostics,
              propertyFileGlobsLatest
            );
            await validatePlaceholders(document, projectDiagnostics);
            checked++;
          } catch (err) {
            outputChannel.appendLine(
              `[Error] Failed to validate ${file.fsPath}: ${err}`
            );
          }
        }

        outputChannel.appendLine(
          `✅ Validation completed: ${checked} Java files checked.`
        );
        vscode.window.showInformationMessage(
          `✅ Validation completed for ${checked} Java files`
        );
      }
    )
  );

  // Diagnostics
  const propDiagnostics =
    vscode.languages.createDiagnosticCollection("messages");
  const phDiagnostics =
    vscode.languages.createDiagnosticCollection("placeholders");
  context.subscriptions.push(propDiagnostics, phDiagnostics);

  // バリデーション（ファイルオープン・変更・保存・エディタ切替時）
  let validationTimeout: ReturnType<typeof setTimeout>;
  const scheduleAll = (doc: vscode.TextDocument) => {
    if (doc.languageId !== "java" || isExcludedFile(doc.uri.fsPath)) {
      return;
    }
    clearTimeout(validationTimeout);
    validationTimeout = setTimeout(async () => {
      outputChannel.appendLine("🔍 Re-validating properties and placeholders…");
      await validateProperties(doc, propDiagnostics, propertyFileGlobs);
      await validatePlaceholders(doc, phDiagnostics);
    }, 500);
  };

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(scheduleAll),
    vscode.workspace.onDidChangeTextDocument((e) => scheduleAll(e.document)),
    vscode.workspace.onDidSaveTextDocument(scheduleAll),
    vscode.window.onDidChangeActiveTextEditor(
      (ed) => ed?.document && scheduleAll(ed.document)
    )
  );

  // アクティブエディタがあれば即時バリデート
  if (vscode.window.activeTextEditor) {
    scheduleAll(vscode.window.activeTextEditor.document);
  }

  // 最後に起動メッセージ
  vscode.window.showInformationMessage(
    "Java Message Key Navigator is now active 🚀"
  );
}
