import type {
  ExtensionContext,
  Uri,
  TextDocument,
  Position,
  CancellationToken,
  Range,
  CodeActionContext,
  CompletionContext,
  HoverProvider,
  DefinitionProvider,
  CodeActionProvider,
  CompletionItemProvider,
  Hover,
  Definition,
  LocationLink,
  CodeAction,
  CompletionItem,
} from "vscode";
import { activate } from "../src/extension";
import {
  FilteredHoverProvider,
  FilteredDefinitionProvider,
  FilteredQuickFixProvider,
  FilteredCompletionProvider,
} from "../src/extension";

jest.useFakeTimers();

// --- VS Code API モック ---
jest.mock("vscode", () => {
  const fakeUri = { fsPath: "/fake", toString: () => "/fake" } as Uri;
  return {
    window: {
      showInformationMessage: jest.fn(),
      showWarningMessage: jest.fn(),
      showQuickPick: jest.fn(),
      activeTextEditor: { document: { languageId: "java", uri: fakeUri } },
      onDidChangeActiveTextEditor: jest.fn((cb) => ({ dispose: jest.fn() })),
    },
    workspace: {
      getConfiguration: jest.fn().mockReturnValue({
        get: jest.fn().mockReturnValue([]),
      }),
      findFiles: jest.fn().mockResolvedValue([]),
      createFileSystemWatcher: jest.fn().mockReturnValue({
        onDidChange: jest.fn((cb) => cb()),
        onDidCreate: jest.fn((cb) => cb()),
        onDidDelete: jest.fn((cb) => cb()),
        dispose: jest.fn(),
      }),
      onDidOpenTextDocument: jest.fn((cb) => ({ dispose: jest.fn() })),
      onDidChangeTextDocument: jest.fn((cb) => ({ dispose: jest.fn() })),
      onDidSaveTextDocument: jest.fn((cb) => ({ dispose: jest.fn() })),
      openTextDocument: jest.fn().mockResolvedValue({
        lineCount: 1,
        lineAt: () => ({ range: { end: {} } }),
        save: jest.fn(),
      }),
      applyEdit: jest.fn().mockResolvedValue(true),
      asRelativePath: (uri: Uri) => uri.fsPath.split("/").pop(),
    },
    languages: {
      createDiagnosticCollection: jest.fn(() => ({ dispose: jest.fn(), set: jest.fn() })),
      registerHoverProvider: jest.fn(() => ({ dispose: jest.fn() })),
      registerDefinitionProvider: jest.fn(() => ({ dispose: jest.fn() })),
      registerCodeActionsProvider: jest.fn(() => ({ dispose: jest.fn() })),
      registerCompletionItemProvider: jest.fn(() => ({ dispose: jest.fn() })),
    },
    commands: {
      registerCommand: jest.fn((cmd: string, fn: any) => {
        (global as any).__registeredCommand = { cmd, fn };
        return { dispose: jest.fn() };
      }),
    },
    CodeActionKind: { QuickFix: "QuickFix" },
    WorkspaceEdit: jest.fn(() => ({ insert: jest.fn() })),
  };
});

// --- 内部依存モジュールモック ---
jest.mock("../src/utils", () => ({
  loadPropertyDefinitions: jest.fn(),
  isExcludedFile: jest.fn().mockReturnValue(false),
}));
jest.mock("../src/outputChannel", () => ({
  initializeOutputChannel: jest.fn(),
  outputChannel: { appendLine: jest.fn() },
}));
jest.mock("../src/PropertyValidator", () => ({
  validateProperties: jest.fn(),
}));
jest.mock("../src/diagnostic", () => ({
  validatePlaceholders: jest.fn(),
}));
jest.mock("../src/addPropertyKey", () => ({
  addPropertyKeyHandler: jest.fn(),
}));

import { loadPropertyDefinitions, isExcludedFile } from "../src/utils";
import { initializeOutputChannel, outputChannel } from "../src/outputChannel";
import { validateProperties } from "../src/PropertyValidator";
import { validatePlaceholders } from "../src/diagnostic";
import { addPropertyKeyHandler } from "../src/addPropertyKey";

const vscode = require("vscode");

describe("activate()", () => {
  let context: ExtensionContext;
  let logSpy: jest.SpyInstance;

  beforeAll(() => {
    logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
  });
  afterAll(() => {
    logSpy.mockRestore();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    const fakeUri = { fsPath: "/fake", toString: () => "/fake" } as Uri;
    context = {
      subscriptions: [],
      workspaceState: {} as any,
      globalState: {} as any,
      secrets: {} as any,
      extensionUri: fakeUri,
      extensionPath: "/fake",
      environmentVariableCollection: {} as any,
      asAbsolutePath: jest.fn(),
      storageUri: fakeUri,
      globalStorageUri: fakeUri,
      logUri: fakeUri,
      storagePath: "/fake",
      globalStoragePath: "/fake",
      logPath: "/fake",
      extensionMode: 1,
      extension: {} as any,
      languageModelAccessInformation: {} as any,
    };
    vscode.window.activeTextEditor = { document: { languageId: "java", uri: fakeUri } };
  });

  afterEach(() => {
    context.subscriptions.forEach((d: any) => d.dispose?.());
    jest.runOnlyPendingTimers();
    jest.clearAllTimers();
  });

  it("基本フロー: Provider/Command登録、完了メッセージ", async () => {
    await activate(context);

    expect(initializeOutputChannel).toHaveBeenCalled();
    expect(loadPropertyDefinitions).toHaveBeenCalledWith(["**/*.properties"]);
    expect(outputChannel.appendLine).toHaveBeenCalledWith(
      "✅ Java Message Key Navigator is now active"
    );
    expect(vscode.languages.registerHoverProvider).toHaveBeenCalled();
    expect(vscode.languages.registerDefinitionProvider).toHaveBeenCalled();
    expect(vscode.languages.registerCodeActionsProvider).toHaveBeenCalled();
    expect(vscode.languages.registerCompletionItemProvider).toHaveBeenCalled();
    expect(vscode.commands.registerCommand).toHaveBeenCalledWith(
      "java-message-key-navigator.addPropertyKey",
      addPropertyKeyHandler
    );
    expect(vscode.languages.createDiagnosticCollection).toHaveBeenCalledTimes(2);
  });

  it("コマンド登録後にハンドラがワイヤーされる", async () => {
    await activate(context);
    const reg = (global as any).__registeredCommand!;
    expect(reg.cmd).toBe("java-message-key-navigator.addPropertyKey");
    await reg.fn("some.key");
    expect(addPropertyKeyHandler).toHaveBeenCalledWith("some.key");
  });

  it("スケジューラ: 500ms 後に validate 呼び出し", async () => {
    await activate(context);
    jest.advanceTimersByTime(500);
    await Promise.resolve();
    expect(validateProperties).toHaveBeenCalled();
    expect(validatePlaceholders).toHaveBeenCalled();
  });

  it("propertyFileGlobs がある場合ウォッチャー登録＋reload", async () => {
    (vscode.workspace.getConfiguration().get as jest.Mock).mockReturnValueOnce([
      "**/*.props",
      "**/*.xml",
    ]);
    await activate(context);

    expect(vscode.workspace.createFileSystemWatcher).toHaveBeenCalledTimes(2);
    expect(vscode.workspace.createFileSystemWatcher).toHaveBeenCalledWith("**/*.props");
    expect(vscode.workspace.createFileSystemWatcher).toHaveBeenCalledWith("**/*.xml");

    // 最後の呼び出し引数で reload が走っていること
    const calls = (loadPropertyDefinitions as jest.Mock).mock.calls;
    expect(calls[calls.length - 1]).toEqual([["**/*.props", "**/*.xml"]]);
  });

  it("非Javaまたは除外パスはスケジュールスキップ", async () => {
    (isExcludedFile as jest.Mock).mockReturnValue(true);

    await activate(context);
    const openCb = vscode.workspace.onDidOpenTextDocument.mock.calls[0][0] as (
      doc: TextDocument
    ) => void;
    openCb({ languageId: "java", uri: { fsPath: "/fake/excluded" } } as TextDocument);

    jest.advanceTimersByTime(500);
    await Promise.resolve();
    expect(validateProperties).not.toHaveBeenCalled();
    expect(validatePlaceholders).not.toHaveBeenCalled();
  });

  it("イベントリスナーが登録される", async () => {
    await activate(context);
    expect(vscode.workspace.onDidOpenTextDocument).toHaveBeenCalledWith(expect.any(Function));
    expect(vscode.workspace.onDidChangeTextDocument).toHaveBeenCalledWith(expect.any(Function));
    expect(vscode.workspace.onDidSaveTextDocument).toHaveBeenCalledWith(expect.any(Function));
    expect(vscode.window.onDidChangeActiveTextEditor).toHaveBeenCalledWith(expect.any(Function));
  });

  // Filtered providers
  describe("Filtered Providers", () => {
    const fakeDoc = { uri: { fsPath: "/file.java" } } as TextDocument;
    const pos = {} as Position;
    const token = {} as CancellationToken;
    const range = {} as Range;
    const codeCtx = {} as CodeActionContext;
    const compCtx = {} as CompletionContext;

    beforeEach(() => jest.clearAllMocks());

    it("FilteredHoverProvider: excluded → undefined", () => {
      (isExcludedFile as jest.Mock).mockReturnValue(true);
      const base: HoverProvider = { provideHover: jest.fn() };
      const p = new FilteredHoverProvider(base);
      expect(p.provideHover(fakeDoc, pos, token)).toBeUndefined();
    });
    it("FilteredHoverProvider: normal → base called", () => {
      (isExcludedFile as jest.Mock).mockReturnValue(false);
      const hoverObj = {} as Hover;
      const base: HoverProvider = { provideHover: jest.fn().mockReturnValue(hoverObj) };
      const p = new FilteredHoverProvider(base);
      expect(p.provideHover(fakeDoc, pos, token)).toBe(hoverObj);
    });

    it("FilteredDefinitionProvider: excluded → undefined", () => {
      (isExcludedFile as jest.Mock).mockReturnValue(true);
      const base: DefinitionProvider = { provideDefinition: jest.fn() };
      const p = new FilteredDefinitionProvider(base);
      expect(p.provideDefinition(fakeDoc, pos, token)).toBeUndefined();
    });
    it("FilteredDefinitionProvider: normal → base called", () => {
      (isExcludedFile as jest.Mock).mockReturnValue(false);
      const defObj = [{}] as (Definition | LocationLink)[];
      const base: DefinitionProvider = {
        provideDefinition: jest.fn().mockReturnValue(defObj),
      };
      const p = new FilteredDefinitionProvider(base);
      expect(p.provideDefinition(fakeDoc, pos, token)).toBe(defObj);
    });

    it("FilteredQuickFixProvider: excluded → []", () => {
      (isExcludedFile as jest.Mock).mockReturnValue(true);
      const base: CodeActionProvider = { provideCodeActions: jest.fn() };
      const p = new FilteredQuickFixProvider(base);
      expect(p.provideCodeActions(fakeDoc, range, codeCtx, token)).toEqual([]);
    });
    it("FilteredQuickFixProvider: normal → base called", () => {
      (isExcludedFile as jest.Mock).mockReturnValue(false);
      const actions = [{ title: "A" }] as CodeAction[];
      const base: CodeActionProvider = {
        provideCodeActions: jest.fn().mockReturnValue(actions),
      };
      const p = new FilteredQuickFixProvider(base);
      expect(p.provideCodeActions(fakeDoc, range, codeCtx, token)).toBe(actions);
    });

    it("FilteredCompletionProvider: excluded → undefined", () => {
      (isExcludedFile as jest.Mock).mockReturnValue(true);
      const base: CompletionItemProvider = { provideCompletionItems: jest.fn() };
      const p = new FilteredCompletionProvider(base);
      expect(p.provideCompletionItems(fakeDoc, pos, token, compCtx)).toBeUndefined();
    });
    it("FilteredCompletionProvider: normal → base called", () => {
      (isExcludedFile as jest.Mock).mockReturnValue(false);
      const items = [{}] as CompletionItem[];
      const base: CompletionItemProvider = {
        provideCompletionItems: jest.fn().mockReturnValue(items),
      };
      const p = new FilteredCompletionProvider(base);
      expect(p.provideCompletionItems(fakeDoc, pos, token, compCtx)).toBe(items);
    });
  });

  // scheduleAll イベントリスナー
  describe("scheduleAll イベントリスナー", () => {
    let fakeDoc: TextDocument;
    let openCb: (doc: TextDocument) => void;
    let changeCb: (e: { document: TextDocument }) => void;
    let saveCb: (doc: TextDocument) => void;
    let editorCb: (ed: { document: TextDocument } | undefined) => void;

    beforeEach(async () => {
      await activate(context);
      openCb = vscode.workspace.onDidOpenTextDocument.mock.calls[0][0];
      changeCb = vscode.workspace.onDidChangeTextDocument.mock.calls[0][0];
      saveCb = vscode.workspace.onDidSaveTextDocument.mock.calls[0][0];
      editorCb = vscode.window.onDidChangeActiveTextEditor.mock.calls[0][0];
      jest.clearAllMocks();
      fakeDoc = { languageId: "java", uri: { fsPath: "/fake/file.java" } } as TextDocument;
    });

    const flush = () => {
      jest.advanceTimersByTime(500);
      return Promise.resolve();
    };

    it("onDidOpenTextDocument → validate 呼び出し", async () => {
      openCb(fakeDoc);
      await flush();
      expect(validateProperties).toHaveBeenCalled();
      expect(validatePlaceholders).toHaveBeenCalled();
    });

    it("onDidChangeTextDocument → validate 呼び出し", async () => {
      changeCb({ document: fakeDoc });
      await flush();
      expect(validateProperties).toHaveBeenCalled();
      expect(validatePlaceholders).toHaveBeenCalled();
    });

    it("onDidSaveTextDocument → validate 呼び出し", async () => {
      saveCb(fakeDoc);
      await flush();
      expect(validateProperties).toHaveBeenCalled();
      expect(validatePlaceholders).toHaveBeenCalled();
    });

    it("onDidChangeActiveTextEditor → validate 呼び出し", async () => {
      editorCb({ document: fakeDoc });
      await flush();
      expect(validateProperties).toHaveBeenCalled();
      expect(validatePlaceholders).toHaveBeenCalled();
    });
  });
});
