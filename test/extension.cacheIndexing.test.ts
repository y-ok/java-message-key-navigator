import { strict as assert } from "assert";

const JAVA_INCLUDE_PATTERN = "**/src/main/java/**/*.java";
const JAVA_EXCLUDE_PATTERN =
  "**/{test,tests,src/test/**,src/generated/**,build/**,out/**,target/**}/**";

const showWarningMessage = jest.fn();
const showInformationMessage = jest.fn();
const showQuickPick = jest.fn();
const showTextDocument = jest.fn();
const applyEdit = jest.fn();
const openTextDocument = jest.fn();
const asRelativePath = jest.fn((uri) => uri.fsPath);
const createDiagnosticCollection = jest.fn(() => ({
  clear: jest.fn(),
  set: jest.fn(),
  delete: jest.fn(),
  dispose: jest.fn(),
}));
const registerHoverProvider = jest.fn();
const registerDefinitionProvider = jest.fn();
const registerCodeActionsProvider = jest.fn();
const registerCompletionItemProvider = jest.fn();
const registerCommand = jest.fn();
const findFiles = jest.fn();
const getConfiguration = jest.fn();
const onDidOpenTextDocument = jest.fn();
const onDidChangeTextDocument = jest.fn();
const onDidSaveTextDocument = jest.fn();
const onDidCloseTextDocument = jest.fn();
const onDidChangeConfiguration = jest.fn();
const onDidChangeActiveTextEditor = jest.fn();
const createFileSystemWatcher = jest.fn();

let onOpenDocCb: ((doc: any) => void) | undefined;
let onChangeDocCb: ((e: { document: any }) => void) | undefined;
let onSaveDocCb: ((doc: any) => void) | undefined;
let onCloseDocCb: ((doc: any) => void) | undefined;
let onConfigChangeCb: ((e: { affectsConfiguration: (key: string) => boolean }) => void) | undefined;
let onActiveEditorCb: ((ed: { document: any } | undefined) => void) | undefined;
let watcherCreateCb: ((uri: any) => void) | undefined;
let watcherChangeCb: ((uri: any) => void) | undefined;
let watcherDeleteCb: ((uri: any) => void) | undefined;

const mockWindow: any = {
  showWarningMessage,
  showInformationMessage,
  showQuickPick,
  showTextDocument,
  activeTextEditor: undefined,
  onDidChangeActiveTextEditor,
};

const mockWorkspace: any = {
  getConfiguration,
  findFiles,
  asRelativePath,
  openTextDocument,
  onDidOpenTextDocument,
  onDidChangeTextDocument,
  onDidSaveTextDocument,
  onDidCloseTextDocument,
  onDidChangeConfiguration,
  createFileSystemWatcher,
  workspaceFolders: undefined,
  applyEdit,
};

const mockLanguages: any = {
  registerHoverProvider,
  registerDefinitionProvider,
  registerCodeActionsProvider,
  registerCompletionItemProvider,
  createDiagnosticCollection,
};

const mockCommands: any = {
  registerCommand,
};

const WorkspaceEdit = jest.fn().mockImplementation(() => ({
  insert: jest.fn(),
}));

jest.mock("vscode", () => ({
  __esModule: true,
  window: mockWindow,
  workspace: mockWorkspace,
  languages: mockLanguages,
  commands: mockCommands,
  Uri: { file: (p: string) => ({ fsPath: p }) },
  WorkspaceEdit,
  CodeActionKind: {
    QuickFix: "quickfix",
  },
  Position: jest.fn().mockImplementation((line: number, character: number) => ({
    line,
    character,
  })),
  Selection: jest
    .fn()
    .mockImplementation((start: any, end: any) => ({ start, end })),
  Range: jest
    .fn()
    .mockImplementation((start: any, end: any) => ({ start, end })),
}));

jest.mock("../src/outputChannel", () => ({
  __esModule: true,
  initializeOutputChannel: jest.fn(),
  outputChannel: { appendLine: jest.fn(), clear: jest.fn() },
}));

jest.mock("../src/utils", () => ({
  __esModule: true,
  loadPropertyDefinitions: jest.fn(),
  isExcludedFile: jest.fn(),
  addPropertyKey: jest.fn(),
}));

jest.mock("../src/PropertyValidator", () => ({
  __esModule: true,
  validateProperties: jest.fn(),
}));

jest.mock("../src/diagnostic", () => ({
  __esModule: true,
  validatePlaceholders: jest.fn(),
}));

jest.mock("../src/CompletionProvider", () => ({
  __esModule: true,
  MessageKeyCompletionProvider: class {},
}));

jest.mock("../src/HoverProvider", () => ({
  __esModule: true,
  PropertiesHoverProvider: class {},
}));

jest.mock("../src/DefinitionProvider", () => ({
  __esModule: true,
  PropertiesDefinitionProvider: class {},
}));

jest.mock("../src/PropertiesQuickFixProvider", () => {
  class MockQuickFixProvider {
    public static readonly providedCodeActionKinds = ["quickfix"];
  }
  return {
    __esModule: true,
    PropertiesQuickFixProvider: MockQuickFixProvider,
  };
});

import * as utils from "../src/utils";
import * as PropertyValidator from "../src/PropertyValidator";
import * as diagnostic from "../src/diagnostic";
import { activate } from "../src/extension";

function disposable() {
  return { dispose: jest.fn() };
}

async function flushMicrotasks(count = 8): Promise<void> {
  for (let i = 0; i < count; i++) {
    await Promise.resolve();
  }
}

function getCommandHandler(name: string): (...args: any[]) => Promise<void> {
  const found = registerCommand.mock.calls.find((call) => call[0] === name);
  assert.ok(found, `Command not registered: ${name}`);
  return found[1];
}

function makeJavaDoc(
  fsPath: string,
  getText: () => string
): { uri: { fsPath: string }; languageId: string; getText: () => string } {
  return {
    uri: { fsPath },
    languageId: "java",
    getText,
  };
}

describe("activate cache/index behavior (additional cases)", () => {
  let context: any;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();

    context = { subscriptions: [] };
    onOpenDocCb = undefined;
    onChangeDocCb = undefined;
    onSaveDocCb = undefined;
    onCloseDocCb = undefined;
    onConfigChangeCb = undefined;
    onActiveEditorCb = undefined;
    watcherCreateCb = undefined;
    watcherChangeCb = undefined;
    watcherDeleteCb = undefined;

    mockWorkspace.workspaceFolders = undefined;
    mockWorkspace.onDidCloseTextDocument = onDidCloseTextDocument;
    mockWorkspace.onDidChangeConfiguration = onDidChangeConfiguration;
    mockWorkspace.createFileSystemWatcher = createFileSystemWatcher;
    mockWindow.activeTextEditor = undefined;

    getConfiguration.mockReturnValue({
      get: jest.fn().mockReturnValue([]),
    });

    onDidOpenTextDocument.mockImplementation((fn: any) => {
      onOpenDocCb = fn;
      return disposable();
    });
    onDidChangeTextDocument.mockImplementation((fn: any) => {
      onChangeDocCb = fn;
      return disposable();
    });
    onDidSaveTextDocument.mockImplementation((fn: any) => {
      onSaveDocCb = fn;
      return disposable();
    });
    onDidCloseTextDocument.mockImplementation((fn: any) => {
      onCloseDocCb = fn;
      return disposable();
    });
    onDidChangeConfiguration.mockImplementation((fn: any) => {
      onConfigChangeCb = fn;
      return disposable();
    });
    onDidChangeActiveTextEditor.mockImplementation((fn: any) => {
      onActiveEditorCb = fn;
      return disposable();
    });

    createFileSystemWatcher.mockImplementation((pattern: string) => ({
      onDidCreate: jest.fn((fn: any) => {
        if (!pattern.includes(".properties")) {watcherCreateCb = fn;}
        return disposable();
      }),
      onDidChange: jest.fn((fn: any) => {
        if (!pattern.includes(".properties")) {watcherChangeCb = fn;}
        return disposable();
      }),
      onDidDelete: jest.fn((fn: any) => {
        if (!pattern.includes(".properties")) {watcherDeleteCb = fn;}
        return disposable();
      }),
      dispose: jest.fn(),
    }));

    (utils.loadPropertyDefinitions as jest.Mock).mockResolvedValue(undefined);
    (utils.isExcludedFile as jest.Mock).mockReturnValue(false);
    (utils.addPropertyKey as jest.Mock).mockResolvedValue(undefined);
    (PropertyValidator.validateProperties as jest.Mock).mockResolvedValue(
      undefined
    );
    (diagnostic.validatePlaceholders as jest.Mock).mockResolvedValue(undefined);
  });

  it("workspaceFolders がある場合は初回ウォームアップで全 Java を走査する", async () => {
    mockWorkspace.workspaceFolders = [{ uri: { fsPath: "/project" } }];
    findFiles.mockResolvedValueOnce([{ fsPath: "/project/src/Foo.java" }]);
    openTextDocument.mockResolvedValue(
      makeJavaDoc("/project/src/Foo.java", () => "class Foo {}")
    );

    await activate(context);
    await flushMicrotasks(12);

    expect(findFiles).toHaveBeenCalledWith(
      JAVA_INCLUDE_PATTERN,
      JAVA_EXCLUDE_PATTERN
    );
    expect((PropertyValidator.validateProperties as jest.Mock).mock.calls.length).toBe(
      1
    );
    expect((diagnostic.validatePlaceholders as jest.Mock).mock.calls.length).toBe(
      1
    );
  });

  it("workspaceFolders がない場合は初回ウォームアップを実行しない", async () => {
    mockWorkspace.workspaceFolders = undefined;

    await activate(context);
    await flushMicrotasks(4);

    expect(findFiles).not.toHaveBeenCalled();
    expect((PropertyValidator.validateProperties as jest.Mock).mock.calls.length).toBe(
      0
    );
  });

  it("同一内容の Java は差分キャッシュで再検証をスキップする", async () => {
    jest.useFakeTimers();
    await activate(context);
    assert.ok(onChangeDocCb);

    const doc = makeJavaDoc("/src/A.java", () => "class A {}");
    onChangeDocCb?.({ document: doc });
    jest.advanceTimersByTime(500);
    await flushMicrotasks(6);

    onChangeDocCb?.({ document: doc });
    jest.advanceTimersByTime(500);
    await flushMicrotasks(6);

    expect((PropertyValidator.validateProperties as jest.Mock).mock.calls.length).toBe(
      1
    );
    expect((diagnostic.validatePlaceholders as jest.Mock).mock.calls.length).toBe(
      1
    );
  });

  it("Java 内容が変わった場合は差分キャッシュで再検証される", async () => {
    jest.useFakeTimers();
    await activate(context);
    assert.ok(onChangeDocCb);

    let text = "class A {}";
    const doc = makeJavaDoc("/src/A.java", () => text);

    onChangeDocCb?.({ document: doc });
    jest.advanceTimersByTime(500);
    await flushMicrotasks(6);

    text = "class A { int n; }";
    onChangeDocCb?.({ document: doc });
    jest.advanceTimersByTime(500);
    await flushMicrotasks(6);

    expect((PropertyValidator.validateProperties as jest.Mock).mock.calls.length).toBe(
      2
    );
    expect((diagnostic.validatePlaceholders as jest.Mock).mock.calls.length).toBe(
      2
    );
  });

  it("validateAll はキャッシュ済みでも強制再検証する", async () => {
    findFiles.mockResolvedValue([{ fsPath: "/src/A.java" }]);
    openTextDocument.mockResolvedValue(
      makeJavaDoc("/src/A.java", () => "class A {}")
    );

    await activate(context);
    const validateAll = getCommandHandler(
      "java-message-key-navigator.validateAll"
    );

    await validateAll();
    await validateAll();

    expect((PropertyValidator.validateProperties as jest.Mock).mock.calls.length).toBe(
      2
    );
    expect((diagnostic.validatePlaceholders as jest.Mock).mock.calls.length).toBe(
      2
    );
  });

  it("validateAll 再実行時に消えた Java ファイルの診断を削除する", async () => {
    findFiles
      .mockResolvedValueOnce([{ fsPath: "/src/A.java" }, { fsPath: "/src/B.java" }])
      .mockResolvedValueOnce([{ fsPath: "/src/A.java" }]);
    openTextDocument.mockImplementation((uri: { fsPath: string }) => {
      if (uri.fsPath === "/src/A.java") {
        return Promise.resolve(makeJavaDoc("/src/A.java", () => "class A {}"));
      }
      if (uri.fsPath === "/src/B.java") {
        return Promise.resolve(makeJavaDoc("/src/B.java", () => "class B {}"));
      }
      return Promise.reject(new Error(`Unexpected file: ${uri.fsPath}`));
    });

    await activate(context);
    const validateAll = getCommandHandler(
      "java-message-key-navigator.validateAll"
    );
    const propDiagnostics = createDiagnosticCollection.mock.results[0].value;
    const phDiagnostics = createDiagnosticCollection.mock.results[1].value;

    await validateAll();
    await validateAll();

    expect(propDiagnostics.delete).toHaveBeenCalledWith(
      expect.objectContaining({ fsPath: "/src/B.java" })
    );
    expect(phDiagnostics.delete).toHaveBeenCalledWith(
      expect.objectContaining({ fsPath: "/src/B.java" })
    );
  });

  it(".properties 保存時はキャッシュ済み Java のみ再検証する", async () => {
    findFiles.mockResolvedValueOnce([
      { fsPath: "/src/A.java" },
      { fsPath: "/src/B.java" },
    ]);
    openTextDocument.mockImplementation((uri: { fsPath: string }) => {
      if (uri.fsPath === "/src/A.java") {
        return Promise.resolve(makeJavaDoc("/src/A.java", () => "class A {}"));
      }
      if (uri.fsPath === "/src/B.java") {
        return Promise.resolve(makeJavaDoc("/src/B.java", () => "class B {}"));
      }
      return Promise.reject(new Error(`Unexpected file: ${uri.fsPath}`));
    });

    await activate(context);
    const validateAll = getCommandHandler(
      "java-message-key-navigator.validateAll"
    );
    await validateAll();
    assert.ok(onSaveDocCb);

    onSaveDocCb?.({
      languageId: "properties",
      uri: { fsPath: "/src/main/resources/messages.properties" },
    });
    await flushMicrotasks(12);

    expect((PropertyValidator.validateProperties as jest.Mock).mock.calls.length).toBe(
      4
    );
    expect((diagnostic.validatePlaceholders as jest.Mock).mock.calls.length).toBe(
      4
    );
  });

  it("Java 保存時は対象ファイルのみ再検証する", async () => {
    jest.useFakeTimers();
    findFiles.mockResolvedValueOnce([
      { fsPath: "/src/A.java" },
      { fsPath: "/src/B.java" },
    ]);
    openTextDocument.mockImplementation((uri: { fsPath: string }) => {
      if (uri.fsPath === "/src/A.java") {
        return Promise.resolve(makeJavaDoc("/src/A.java", () => "class A {}"));
      }
      if (uri.fsPath === "/src/B.java") {
        return Promise.resolve(makeJavaDoc("/src/B.java", () => "class B {}"));
      }
      return Promise.reject(new Error(`Unexpected file: ${uri.fsPath}`));
    });

    await activate(context);
    const validateAll = getCommandHandler(
      "java-message-key-navigator.validateAll"
    );
    await validateAll();
    assert.ok(onSaveDocCb);

    let currentText = "class A { int x; }";
    onSaveDocCb?.({
      languageId: "java",
      uri: { fsPath: "/src/A.java" },
      getText: () => currentText,
    });
    jest.advanceTimersByTime(500);
    await flushMicrotasks(8);

    expect((PropertyValidator.validateProperties as jest.Mock).mock.calls.length).toBe(
      3
    );
    expect((diagnostic.validatePlaceholders as jest.Mock).mock.calls.length).toBe(
      3
    );
  });

  it("propertyFileGlobs 設定変更で全 Java 強制再検証する", async () => {
    findFiles.mockResolvedValueOnce([{ fsPath: "/src/A.java" }]);
    openTextDocument.mockResolvedValue(
      makeJavaDoc("/src/A.java", () => "class A {}")
    );

    await activate(context);
    assert.ok(onConfigChangeCb);

    onConfigChangeCb?.({
      affectsConfiguration: (key: string) =>
        key === "java-message-key-navigator.propertyFileGlobs",
    });
    await flushMicrotasks(12);

    expect(findFiles).toHaveBeenCalledWith(
      JAVA_INCLUDE_PATTERN,
      JAVA_EXCLUDE_PATTERN
    );
    expect((PropertyValidator.validateProperties as jest.Mock).mock.calls.length).toBe(
      1
    );
  });

  it("抽出パターン設定変更で全 Java 強制再検証する", async () => {
    findFiles.mockResolvedValueOnce([{ fsPath: "/src/A.java" }]);
    openTextDocument.mockResolvedValue(
      makeJavaDoc("/src/A.java", () => "class A {}")
    );

    await activate(context);
    assert.ok(onConfigChangeCb);

    onConfigChangeCb?.({
      affectsConfiguration: (key: string) =>
        key === "java-message-key-navigator.messageKeyExtractionPatterns",
    });
    await flushMicrotasks(12);

    expect(findFiles).toHaveBeenCalledWith(
      JAVA_INCLUDE_PATTERN,
      JAVA_EXCLUDE_PATTERN
    );
    expect((PropertyValidator.validateProperties as jest.Mock).mock.calls.length).toBe(
      1
    );
  });

  it("無関係な設定変更では再検証しない", async () => {
    await activate(context);
    assert.ok(onConfigChangeCb);

    onConfigChangeCb?.({
      affectsConfiguration: () => false,
    });
    await flushMicrotasks(6);

    expect(findFiles).not.toHaveBeenCalled();
    expect((PropertyValidator.validateProperties as jest.Mock).mock.calls.length).toBe(
      0
    );
  });

  it("Watcher onDidCreate で Java 追加時に検証する", async () => {
    openTextDocument.mockResolvedValue(
      makeJavaDoc("/src/New.java", () => "class New {}")
    );
    await activate(context);
    assert.ok(watcherCreateCb);

    watcherCreateCb?.({ fsPath: "/src/New.java" });
    await flushMicrotasks(10);

    expect((PropertyValidator.validateProperties as jest.Mock).mock.calls.length).toBe(
      1
    );
    expect((diagnostic.validatePlaceholders as jest.Mock).mock.calls.length).toBe(
      1
    );
  });

  it("Watcher onDidChange で Java 更新時に差分検証する", async () => {
    let text = "class New {}";
    openTextDocument.mockImplementation(() =>
      Promise.resolve(makeJavaDoc("/src/New.java", () => text))
    );
    await activate(context);
    assert.ok(watcherCreateCb);
    assert.ok(watcherChangeCb);

    watcherCreateCb?.({ fsPath: "/src/New.java" });
    await flushMicrotasks(10);

    text = "class New { int v; }";
    watcherChangeCb?.({ fsPath: "/src/New.java" });
    await flushMicrotasks(10);

    expect((PropertyValidator.validateProperties as jest.Mock).mock.calls.length).toBe(
      2
    );
    expect((diagnostic.validatePlaceholders as jest.Mock).mock.calls.length).toBe(
      2
    );
  });

  it("Watcher onDidDelete で診断を削除する", async () => {
    await activate(context);
    assert.ok(watcherDeleteCb);
    const propDiagnostics = createDiagnosticCollection.mock.results[0].value;
    const phDiagnostics = createDiagnosticCollection.mock.results[1].value;

    watcherDeleteCb?.({ fsPath: "/src/Dead.java" });

    expect(propDiagnostics.delete).toHaveBeenCalledWith(
      expect.objectContaining({ fsPath: "/src/Dead.java" })
    );
    expect(phDiagnostics.delete).toHaveBeenCalledWith(
      expect.objectContaining({ fsPath: "/src/Dead.java" })
    );
  });

  it("onDidCloseTextDocument が未提供でも activate は失敗しない", async () => {
    mockWorkspace.onDidCloseTextDocument = undefined;

    await expect(activate(context)).resolves.toBeUndefined();
  });

  it("createFileSystemWatcher が未提供でも activate は失敗しない", async () => {
    mockWorkspace.createFileSystemWatcher = undefined;

    await expect(activate(context)).resolves.toBeUndefined();
  });

  it("createFileSystemWatcher が未提供でも propertyFileGlobs 設定変更時に失敗しない", async () => {
    mockWorkspace.createFileSystemWatcher = undefined;
    getConfiguration.mockReturnValue({
      get: jest.fn().mockImplementation((key: string) => {
        if (key === "propertyFileGlobs") {
          return ["src/main/resources/**/*.properties"];
        }
        return [];
      }),
    });

    await activate(context);

    expect(onConfigChangeCb).toBeDefined();
    expect(() =>
      onConfigChangeCb?.({
        affectsConfiguration: (key: string) =>
          key === "java-message-key-navigator.propertyFileGlobs",
      })
    ).not.toThrow();
  });

  it("queueValidation のタスク失敗時にエラーログを出す", async () => {
    findFiles.mockRejectedValueOnce(new Error("queue boom"));
    await activate(context);
    const validateAll = getCommandHandler(
      "java-message-key-navigator.validateAll"
    );
    const output = require("../src/outputChannel").outputChannel;

    await validateAll();
    await flushMicrotasks(8);

    expect(output.appendLine).toHaveBeenCalledWith(
      expect.stringContaining("Validation queue failed")
    );
  });

  it("onDidCloseTextDocument で保留タイマーをクリアして再検証を止める", async () => {
    jest.useFakeTimers();
    await activate(context);
    assert.ok(onOpenDocCb);
    assert.ok(onCloseDocCb);

    const doc = makeJavaDoc("/src/CloseTarget.java", () => "class CloseTarget {}");
    onOpenDocCb?.(doc);
    onCloseDocCb?.(doc);
    jest.advanceTimersByTime(500);
    await flushMicrotasks(8);

    expect((PropertyValidator.validateProperties as jest.Mock).mock.calls.length).toBe(
      0
    );
    expect((diagnostic.validatePlaceholders as jest.Mock).mock.calls.length).toBe(
      0
    );
  });

  it("propertyFileGlobs シグネチャ変更時は再ロードして検証する", async () => {
    jest.useFakeTimers();
    let currentGlobs: string[] = [];
    getConfiguration.mockImplementation(() => ({
      get: jest.fn((key: string, def: any) => {
        if (key === "propertyFileGlobs") {
          return currentGlobs;
        }
        return def;
      }),
    }));
    await activate(context);
    assert.ok(onChangeDocCb);
    (utils.loadPropertyDefinitions as jest.Mock).mockClear();

    currentGlobs = ["src/main/resources/**/*.properties"];
    const doc = makeJavaDoc("/src/WithChangedGlobs.java", () => "class C {}");
    onChangeDocCb?.({ document: doc });
    jest.advanceTimersByTime(500);
    await flushMicrotasks(8);

    expect(utils.loadPropertyDefinitions).toHaveBeenCalledWith(currentGlobs);
    expect((PropertyValidator.validateProperties as jest.Mock).mock.calls.length).toBe(
      1
    );
  });

  it("Watcher は .java 以外のパスを検証しない", async () => {
    await activate(context);
    assert.ok(watcherCreateCb);

    watcherCreateCb?.({ fsPath: "/src/not-java.txt" });
    await flushMicrotasks(8);

    expect(openTextDocument).not.toHaveBeenCalled();
    expect((PropertyValidator.validateProperties as jest.Mock).mock.calls.length).toBe(
      0
    );
  });

  it("validateJavaUri の openTextDocument 失敗時は false 扱いで継続する", async () => {
    openTextDocument.mockRejectedValueOnce(new Error("open failed"));
    await activate(context);
    assert.ok(watcherCreateCb);
    const output = require("../src/outputChannel").outputChannel;

    watcherCreateCb?.({ fsPath: "/src/ErrorOnOpen.java" });
    await flushMicrotasks(10);

    expect(output.appendLine).toHaveBeenCalledWith(
      expect.stringContaining("Failed to validate /src/ErrorOnOpen.java")
    );
    expect((PropertyValidator.validateProperties as jest.Mock).mock.calls.length).toBe(
      0
    );
  });

  it("validateAll で open したドキュメントが java 以外なら unchanged に入る", async () => {
    findFiles.mockResolvedValueOnce([{ fsPath: "/src/LooksJava.java" }]);
    openTextDocument.mockResolvedValue({
      uri: { fsPath: "/src/LooksJava.java" },
      languageId: "xml",
      getText: () => "<a/>",
    });
    await activate(context);
    const validateAll = getCommandHandler(
      "java-message-key-navigator.validateAll"
    );
    const output = require("../src/outputChannel").outputChannel;

    await validateAll();

    expect(output.appendLine).toHaveBeenCalledWith(
      expect.stringContaining("0 updated, 1 unchanged")
    );
    expect((PropertyValidator.validateProperties as jest.Mock).mock.calls.length).toBe(
      0
    );
  });

  it("scheduleAll 内で検証関数が例外を投げても catch でログする", async () => {
    jest.useFakeTimers();
    (PropertyValidator.validateProperties as jest.Mock).mockRejectedValueOnce(
      new Error("validate failed")
    );
    await activate(context);
    assert.ok(onChangeDocCb);
    const output = require("../src/outputChannel").outputChannel;

    const doc = makeJavaDoc("/src/ScheduleFail.java", () => "class S {}");
    onChangeDocCb?.({ document: doc });
    jest.advanceTimersByTime(500);
    await flushMicrotasks(12);

    expect(output.appendLine).toHaveBeenCalledWith(
      expect.stringContaining("Failed to validate /src/ScheduleFail.java")
    );
  });

  it("Watcher の create/change は除外ファイルなら処理しない", async () => {
    (utils.isExcludedFile as jest.Mock).mockReturnValue(true);
    await activate(context);
    assert.ok(watcherCreateCb);
    assert.ok(watcherChangeCb);

    watcherCreateCb?.({ fsPath: "/src/Excluded.java" });
    watcherChangeCb?.({ fsPath: "/src/Excluded.java" });
    await flushMicrotasks(8);

    expect(openTextDocument).not.toHaveBeenCalled();
    expect((PropertyValidator.validateProperties as jest.Mock).mock.calls.length).toBe(
      0
    );
  });

  it.each([5000, 10000])(
    "負荷試験(%i): validateAll は多数 Java ファイルを全件検証できる",
    async (fileCount) => {
      const files = Array.from({ length: fileCount }, (_, i) => ({
        fsPath: `/project/src/main/java/p${i}/C${i}.java`,
      }));
      const texts = new Map<string, string>(
        files.map((f, i) => [f.fsPath, `class C${i} {}`])
      );

      findFiles.mockResolvedValueOnce(files);
      openTextDocument.mockImplementation((uri: { fsPath: string }) => {
        const text = texts.get(uri.fsPath);
        if (!text) {
          return Promise.reject(new Error(`Unexpected file: ${uri.fsPath}`));
        }
        return Promise.resolve(makeJavaDoc(uri.fsPath, () => text));
      });

      await activate(context);
      const validateAll = getCommandHandler(
        "java-message-key-navigator.validateAll"
      );

      await validateAll();

      expect(
        (PropertyValidator.validateProperties as jest.Mock).mock.calls.length
      ).toBe(fileCount);
      expect(
        (diagnostic.validatePlaceholders as jest.Mock).mock.calls.length
      ).toBe(fileCount);
      expect(openTextDocument.mock.calls.length).toBe(fileCount);
    }
  );

  it.each([5000, 10000])(
    "負荷試験(%i): 多数ファイルをキャッシュ後、単一ファイル変更は 1 件だけ再検証する",
    async (fileCount) => {
      const files = Array.from({ length: fileCount }, (_, i) => ({
        fsPath: `/project/src/main/java/p${i}/C${i}.java`,
      }));
      const texts = new Map<string, string>(
        files.map((f, i) => [f.fsPath, `class C${i} {}`])
      );

      findFiles.mockResolvedValueOnce(files);
      openTextDocument.mockImplementation((uri: { fsPath: string }) => {
        const text = texts.get(uri.fsPath);
        if (!text) {
          return Promise.reject(new Error(`Unexpected file: ${uri.fsPath}`));
        }
        return Promise.resolve(makeJavaDoc(uri.fsPath, () => text));
      });

      await activate(context);
      const validateAll = getCommandHandler(
        "java-message-key-navigator.validateAll"
      );
      await validateAll();

      const targetIndex = Math.floor(fileCount / 2);
      const target = files[targetIndex].fsPath;
      texts.set(target, `class C${targetIndex} { int updated; }`);
      assert.ok(watcherChangeCb);

      watcherChangeCb?.({ fsPath: target });
      await flushMicrotasks(16);

      expect(
        (PropertyValidator.validateProperties as jest.Mock).mock.calls.length
      ).toBe(fileCount + 1);
      expect(
        (diagnostic.validatePlaceholders as jest.Mock).mock.calls.length
      ).toBe(fileCount + 1);
      expect(openTextDocument.mock.calls.length).toBe(fileCount + 1);
    }
  );

  it("argBuilderPatterns 設定変更で全 Java 強制再検証する", async () => {
    findFiles.mockResolvedValueOnce([{ fsPath: "/src/A.java" }]);
    openTextDocument.mockResolvedValue(
      makeJavaDoc("/src/A.java", () => "class A {}")
    );

    await activate(context);
    assert.ok(onConfigChangeCb);

    onConfigChangeCb?.({
      affectsConfiguration: (key: string) =>
        key === "java-message-key-navigator.argBuilderPatterns",
    });
    await flushMicrotasks(12);

    expect(findFiles).toHaveBeenCalledWith(
      JAVA_INCLUDE_PATTERN,
      JAVA_EXCLUDE_PATTERN
    );
    expect(
      (PropertyValidator.validateProperties as jest.Mock).mock.calls.length
    ).toBeGreaterThanOrEqual(1);
  });

  it("activate 時に propertyFileGlobs の FileSystemWatcher が作成される", async () => {
    getConfiguration.mockReturnValue({
      get: jest.fn((key: string) =>
        key === "propertyFileGlobs" ? ["src/**/*.properties"] : []
      ),
    });

    await activate(context);

    const patterns = createFileSystemWatcher.mock.calls.map(
      (call: any[]) => call[0]
    );
    assert.ok(
      patterns.includes("src/**/*.properties"),
      `propertyFileGlobs の watcher が登録されていない。登録済み: ${JSON.stringify(patterns)}`
    );
  });

  it("propertyFileGlobs のファイルがディスク変更で再バリデーションが走る", async () => {
    let propChangeCb: ((uri: any) => void) | undefined;
    getConfiguration.mockReturnValue({
      get: jest.fn((key: string) =>
        key === "propertyFileGlobs" ? ["src/**/*.properties"] : []
      ),
    });
    createFileSystemWatcher.mockImplementation((pattern: string) => ({
      onDidCreate: jest.fn(() => disposable()),
      onDidChange: jest.fn((fn: any) => {
        if (pattern !== JAVA_INCLUDE_PATTERN) {
          propChangeCb = fn;
        } else {
          watcherChangeCb = fn;
        }
        return disposable();
      }),
      onDidDelete: jest.fn(() => disposable()),
      dispose: jest.fn(),
    }));

    mockWorkspace.workspaceFolders = [{ uri: { fsPath: "/project" } }];
    findFiles.mockResolvedValueOnce([{ fsPath: "/project/src/Foo.java" }]);
    openTextDocument.mockResolvedValue(
      makeJavaDoc("/project/src/Foo.java", () => "class Foo {}")
    );

    await activate(context);
    await flushMicrotasks(12);

    (PropertyValidator.validateProperties as jest.Mock).mockClear();
    (diagnostic.validatePlaceholders as jest.Mock).mockClear();

    assert.ok(propChangeCb, "propertyFileGlobs 用の onDidChange が登録されていない");
    propChangeCb?.({ fsPath: "/project/src/main/resources/messages.properties" });
    await flushMicrotasks(12);

    expect(
      (PropertyValidator.validateProperties as jest.Mock).mock.calls.length
    ).toBeGreaterThanOrEqual(1);
  });

  it("propertyFileGlobs 変更後に新しい glob で watcher が再作成される", async () => {
    getConfiguration.mockReturnValue({
      get: jest.fn((key: string) =>
        key === "propertyFileGlobs" ? ["src/**/messages.yaml"] : []
      ),
    });

    await activate(context);
    assert.ok(onConfigChangeCb);

    const watcherCallsBefore = createFileSystemWatcher.mock.calls.length;

    getConfiguration.mockReturnValue({
      get: jest.fn((key: string) =>
        key === "propertyFileGlobs"
          ? ["src/**/messages.yaml", "src/**/errors.json"]
          : []
      ),
    });
    findFiles.mockResolvedValueOnce([{ fsPath: "/src/A.java" }]);
    openTextDocument.mockResolvedValue(
      makeJavaDoc("/src/A.java", () => "class A {}")
    );

    onConfigChangeCb?.({
      affectsConfiguration: (key: string) =>
        key === "java-message-key-navigator.propertyFileGlobs",
    });
    await flushMicrotasks(12);

    const newPatterns = createFileSystemWatcher.mock.calls
      .slice(watcherCallsBefore)
      .map((call: any[]) => call[0]);
    const hasNewWatcher = newPatterns.some((p: string) =>
      p.includes("errors.json")
    );
    assert.ok(
      hasNewWatcher,
      `propertyFileGlobs 変更後に新 glob の watcher が作成されていない。新規パターン: ${JSON.stringify(newPatterns)}`
    );
  });
});
