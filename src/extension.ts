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

const JAVA_INCLUDE_PATTERN = "**/src/main/java/**/*.java";
const JAVA_EXCLUDE_PATTERN =
  "**/{test,tests,src/test/**,src/generated/**,build/**,out/**,target/**}/**";

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

  const getPropertyFileGlobs = (): string[] =>
    vscode.workspace
      .getConfiguration("java-message-key-navigator")
      .get<string[]>("propertyFileGlobs", []) ?? [];

  const toGlobSignature = (globs: string[]): string => globs.join("\u0000");

  const computeTextFingerprint = (text: string): string => {
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      hash = (hash * 31 + text.charCodeAt(i)) | 0;
    }
    return `${text.length}:${hash}`;
  };

  const initialPropertyFileGlobs = getPropertyFileGlobs();
  await loadPropertyDefinitions(initialPropertyFileGlobs);

  outputChannel.appendLine("✅ Java Message Key Navigator is now active");

  const selector = { language: "java", scheme: "file" } as const;
  const propDiagnostics =
    vscode.languages.createDiagnosticCollection("messages");
  const phDiagnostics =
    vscode.languages.createDiagnosticCollection("placeholders");
  context.subscriptions.push(propDiagnostics, phDiagnostics);

  const javaValidationCache = new Map<string, string>();
  const validationTimers = new Map<string, ReturnType<typeof setTimeout>>();
  let propertyCacheDirty = false;
  let propertyGlobSignature = toGlobSignature(initialPropertyFileGlobs);
  let validationQueue: Promise<void> = Promise.resolve();

  const queueValidation = (task: () => Promise<void>) => {
    validationQueue = validationQueue.then(task).catch((err) => {
      outputChannel.appendLine(`[Error] Validation queue failed: ${err}`);
    });
    return validationQueue;
  };

  const clearDiagnosticsForUri = (uri: vscode.Uri) => {
    propDiagnostics.delete?.(uri);
    phDiagnostics.delete?.(uri);
  };

  const clearValidationTimer = (uri: vscode.Uri) => {
    const cacheKey = uri.fsPath;
    const timer = validationTimers.get(cacheKey);
    if (!timer) {return;}
    clearTimeout(timer);
    validationTimers.delete(cacheKey);
  };

  const validateJavaDocument = async (
    document: vscode.TextDocument,
    force = false
  ): Promise<boolean> => {
    if (document.languageId !== "java" || isExcludedFile(document.uri.fsPath)) {
      return false;
    }

    const cacheKey = document.uri.fsPath;
    const text =
      typeof document.getText === "function" ? document.getText() : "";
    const fingerprint = computeTextFingerprint(text);
    if (!force && javaValidationCache.get(cacheKey) === fingerprint) {
      return false;
    }

    const propertyFileGlobs = getPropertyFileGlobs();
    const nextSignature = toGlobSignature(propertyFileGlobs);
    if (propertyCacheDirty || propertyGlobSignature !== nextSignature) {
      await loadPropertyDefinitions(propertyFileGlobs);
      propertyGlobSignature = nextSignature;
      propertyCacheDirty = false;
    }

    await validateProperties(document, propDiagnostics, propertyFileGlobs, {
      reloadPropertyDefinitions: false,
    });
    await validatePlaceholders(document, phDiagnostics);
    javaValidationCache.set(cacheKey, fingerprint);
    return true;
  };

  const validateJavaUri = async (uri: vscode.Uri, force = false) => {
    if (!uri.fsPath.endsWith(".java") || isExcludedFile(uri.fsPath)) {
      return false;
    }
    try {
      const document = await vscode.workspace.openTextDocument(uri);
      return await validateJavaDocument(document, force);
    } catch (err) {
      outputChannel.appendLine(`[Error] Failed to validate ${uri.fsPath}: ${err}`);
      return false;
    }
  };

  const validateWorkspaceJavaFiles = async (): Promise<{
    checked: number;
    skipped: number;
    total: number;
  }> => {
    outputChannel.appendLine("🔍 Starting full project validation...");
    const files = await vscode.workspace.findFiles(
      JAVA_INCLUDE_PATTERN,
      JAVA_EXCLUDE_PATTERN
    );

    // ワークスペース全体の再評価では毎回診断を作り直す。
    propDiagnostics.clear();
    phDiagnostics.clear();

    const propertyFileGlobs = getPropertyFileGlobs();
    const nextSignature = toGlobSignature(propertyFileGlobs);
    if (propertyCacheDirty || propertyGlobSignature !== nextSignature) {
      await loadPropertyDefinitions(propertyFileGlobs);
      propertyGlobSignature = nextSignature;
      propertyCacheDirty = false;
    }

    const found = new Set<string>();
    let checked = 0;
    let skipped = 0;

    for (const file of files) {
      if (isExcludedFile(file.fsPath)) {
        continue;
      }
      found.add(file.fsPath);
      try {
        const document = await vscode.workspace.openTextDocument(file);
        const updated = await validateJavaDocument(document, true);
        if (updated) {checked++;}
        else {skipped++;}
      } catch (err) {
        outputChannel.appendLine(
          `[Error] Failed to validate ${file.fsPath}: ${err}`
        );
      }
    }

    for (const cachedPath of Array.from(javaValidationCache.keys())) {
      if (found.has(cachedPath)) {
        continue;
      }
      javaValidationCache.delete(cachedPath);
      const staleUri = vscode.Uri.file(cachedPath);
      clearDiagnosticsForUri(staleUri);
      clearValidationTimer(staleUri);
    }

    outputChannel.appendLine(
      `✅ Validation completed: ${checked} updated, ${skipped} unchanged (${found.size} Java files).`
    );
    return { checked, skipped, total: found.size };
  };

  const revalidateCachedJavaFiles = async () => {
    if (javaValidationCache.size === 0) {
      return;
    }
    const propertyFileGlobs = getPropertyFileGlobs();
    await loadPropertyDefinitions(propertyFileGlobs);
    propertyGlobSignature = toGlobSignature(propertyFileGlobs);
    propertyCacheDirty = false;
    for (const fsPath of javaValidationCache.keys()) {
      await validateJavaUri(vscode.Uri.file(fsPath), true);
    }
  };

  const scheduleAll = (doc: vscode.TextDocument) => {
    if (doc.languageId !== "java" || isExcludedFile(doc.uri.fsPath)) {
      return;
    }
    clearValidationTimer(doc.uri);
    const timer = setTimeout(() => {
      validationTimers.delete(doc.uri.fsPath);
      outputChannel.appendLine("🔍 Re-validating properties and placeholders…");
      void validateJavaDocument(doc).catch((err) => {
        outputChannel.appendLine(`[Error] Failed to validate ${doc.uri.fsPath}: ${err}`);
      });
    }, 500);
    validationTimers.set(doc.uri.fsPath, timer);
  };

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
      async (key: string, filePath?: string) => {
        let targetPath: string;

        if (filePath) {
          targetPath = filePath;
        } else {
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
          targetPath = selected.uri.fsPath;
        }

        await addPropertyKey(key, targetPath);

        propertyCacheDirty = true;
        await queueValidation(async () => {
          await revalidateCachedJavaFiles();
        });
      }
    )
  );

  // === Validate all Java files in the workspace ===
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "java-message-key-navigator.validateAll",
      async () => {
        await queueValidation(async () => {
          const { checked } = await validateWorkspaceJavaFiles();
          vscode.window.showInformationMessage(
            `✅ Validation completed for ${checked} Java files`
          );
        });
      }
    )
  );

  // バリデーション（ファイルオープン・変更・保存・エディタ切替時）
  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(scheduleAll),
    vscode.workspace.onDidChangeTextDocument((e) => scheduleAll(e.document)),
    vscode.workspace.onDidSaveTextDocument((doc) => {
      if (doc.languageId === "java") {
        scheduleAll(doc);
        return;
      }
      if (doc.languageId === "properties" || doc.uri.fsPath.endsWith(".properties")) {
        propertyCacheDirty = true;
        void queueValidation(async () => {
          await revalidateCachedJavaFiles();
        });
      }
    }),
    vscode.window.onDidChangeActiveTextEditor(
      (ed) => ed?.document && scheduleAll(ed.document)
    )
  );

  if (typeof vscode.workspace.onDidCloseTextDocument === "function") {
    context.subscriptions.push(
      vscode.workspace.onDidCloseTextDocument((doc) =>
        clearValidationTimer(doc.uri)
      )
    );
  }

  const revalidateOnPropChange = () => {
    propertyCacheDirty = true;
    void queueValidation(async () => {
      await revalidateCachedJavaFiles();
    });
  };
  let propWatcherDisposables: vscode.Disposable[] = [];
  const createPropWatchers = (globs: string[]) => {
    if (typeof vscode.workspace.createFileSystemWatcher !== "function") {
      return;
    }
    for (const d of propWatcherDisposables) {d.dispose();}
    propWatcherDisposables = [];
    for (const glob of globs) {
      const w = vscode.workspace.createFileSystemWatcher(glob);
      propWatcherDisposables.push(
        w,
        w.onDidCreate(revalidateOnPropChange),
        w.onDidChange(revalidateOnPropChange),
        w.onDidDelete(revalidateOnPropChange)
      );
    }
    context.subscriptions.push(...propWatcherDisposables);
  };

  if (typeof vscode.workspace.onDidChangeConfiguration === "function") {
    context.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        const affectsPropertyGlobs = e.affectsConfiguration(
          "java-message-key-navigator.propertyFileGlobs"
        );
        const affectsExtractionPatterns =
          e.affectsConfiguration(
            "java-message-key-navigator.messageKeyExtractionPatterns"
          ) ||
          e.affectsConfiguration(
            "java-message-key-navigator.annotationKeyExtractionPatterns"
          ) ||
          e.affectsConfiguration(
            "java-message-key-navigator.argBuilderPatterns"
          );
        if (!affectsPropertyGlobs && !affectsExtractionPatterns) {
          return;
        }
        if (affectsPropertyGlobs) {
          propertyCacheDirty = true;
          propertyGlobSignature = "";
          createPropWatchers(getPropertyFileGlobs());
        }
        void queueValidation(async () => {
          await validateWorkspaceJavaFiles();
        });
      })
    );
  }

  if (typeof vscode.workspace.createFileSystemWatcher === "function") {
    const javaWatcher =
      vscode.workspace.createFileSystemWatcher(JAVA_INCLUDE_PATTERN);
    context.subscriptions.push(
      javaWatcher,
      javaWatcher.onDidCreate((uri) => {
        if (isExcludedFile(uri.fsPath)) {
          return;
        }
        void queueValidation(async () => {
          await validateJavaUri(uri, true);
        });
      }),
      javaWatcher.onDidChange((uri) => {
        if (isExcludedFile(uri.fsPath)) {
          return;
        }
        void queueValidation(async () => {
          await validateJavaUri(uri);
        });
      }),
      javaWatcher.onDidDelete((uri) => {
        const cacheKey = uri.fsPath;
        javaValidationCache.delete(cacheKey);
        clearValidationTimer(uri);
        clearDiagnosticsForUri(uri);
      })
    );

    createPropWatchers(initialPropertyFileGlobs);
  }

  // 初回インデックス（ワークスペースが開かれている場合）
  if (
    Array.isArray(vscode.workspace.workspaceFolders) &&
    vscode.workspace.workspaceFolders.length > 0
  ) {
    void queueValidation(async () => {
      await validateWorkspaceJavaFiles();
      outputChannel.appendLine("✅ Java validation cache warmed up.");
    });
  }

  // アクティブエディタがあれば即時バリデート
  if (vscode.window.activeTextEditor) {
    scheduleAll(vscode.window.activeTextEditor.document);
  }

  // 最後に起動メッセージ
  vscode.window.showInformationMessage(
    "Java Message Key Navigator is now active 🚀"
  );
}
