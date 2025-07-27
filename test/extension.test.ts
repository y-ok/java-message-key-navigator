import { strict as assert } from "assert";

// ===== VSCodeフルモック (jest.mockより前に定義) =====
const showWarningMessage = jest.fn();
const showInformationMessage = jest.fn();
const showQuickPick = jest.fn();
const applyEdit = jest.fn();
const openTextDocument = jest.fn();
const asRelativePath = jest.fn((uri) => uri.fsPath);
const createDiagnosticCollection = jest.fn(() => ({ dispose: jest.fn() }));
const registerHoverProvider = jest.fn();
const registerDefinitionProvider = jest.fn();
const registerCodeActionsProvider = jest.fn();
const registerCompletionItemProvider = jest.fn();
const registerCommand = jest.fn();
const findFiles = jest.fn();

const mockWindow: any = {
  showWarningMessage,
  showInformationMessage,
  showQuickPick,
  activeTextEditor: undefined,
  onDidChangeActiveTextEditor: jest.fn((fn) => ({ dispose: jest.fn() })),
};
const mockWorkspace: any = {
  getConfiguration: jest.fn(),
  findFiles,
  asRelativePath,
  openTextDocument,
  onDidOpenTextDocument: jest.fn((fn) => ({ dispose: jest.fn() })),
  onDidChangeTextDocument: jest.fn((fn) => ({ dispose: jest.fn() })),
  onDidSaveTextDocument: jest.fn((fn) => ({ dispose: jest.fn() })),
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

// ===== jest.mockで "vscode" を先にモック =====
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
}));

// ===== 依存モジュールもmock =====
jest.mock("../src/outputChannel", () => ({
  __esModule: true,
  initializeOutputChannel: jest.fn(),
  outputChannel: { appendLine: jest.fn(), clear: jest.fn() },
}));
jest.mock("../src/utils");
jest.mock("../src/PropertyValidator");
jest.mock("../src/diagnostic");
jest.mock("../src/CompletionProvider");
jest.mock("../src/PropertiesQuickFixProvider");
jest.mock("../src/HoverProvider");
jest.mock("../src/DefinitionProvider");

// ===== 依存モジュールimport（jest.mockより後）=====
import * as utils from "../src/utils";
import * as PropertyValidator from "../src/PropertyValidator";
import * as diagnostic from "../src/diagnostic";
import { activate } from "../src/extension";

describe("activate", () => {
  let context: any;
  beforeEach(() => {
    jest.clearAllMocks();
    context = { subscriptions: [] };
    showQuickPick.mockResolvedValue(undefined);
    mockWorkspace.getConfiguration.mockReset();
    mockWorkspace.getConfiguration.mockReturnValue({
      get: jest.fn().mockReturnValue([]),
    });
    (utils.loadPropertyDefinitions as jest.Mock).mockResolvedValue(undefined);
    (utils.isExcludedFile as jest.Mock).mockReturnValue(false);
    (PropertyValidator.validateProperties as jest.Mock).mockResolvedValue(
      undefined
    );
    (diagnostic.validatePlaceholders as jest.Mock).mockResolvedValue(undefined);
  });

  it("プロバイダとコマンドがすべて登録される", async () => {
    await activate(context);
    assert.strictEqual(registerHoverProvider.mock.calls.length > 0, true);
    assert.strictEqual(registerDefinitionProvider.mock.calls.length > 0, true);
    assert.strictEqual(registerCodeActionsProvider.mock.calls.length > 0, true);
    assert.strictEqual(
      registerCompletionItemProvider.mock.calls.length > 0,
      true
    );
    assert.strictEqual(registerCommand.mock.calls.length > 0, true);
    assert.strictEqual(createDiagnosticCollection.mock.calls.length, 2);
  });

  it("プロパティファイル追加: globsが未設定なら警告", async () => {
    mockWorkspace.getConfiguration.mockReturnValueOnce({
      get: jest.fn().mockReturnValue(undefined),
    });
    await activate(context);
    const handler = registerCommand.mock.calls[0][1];
    await handler("KEY_XYZ");
    assert.deepStrictEqual(
      showWarningMessage.mock.calls[0][0],
      "No propertyFileGlobs defined in settings."
    );
  });

  it("プロパティファイル追加: マッチなしで警告", async () => {
    // activate内で2回getConfigurationされるため両方セットする
    mockWorkspace.getConfiguration
      .mockReturnValueOnce({
        get: jest.fn().mockReturnValue(["src/**/foo.properties"]),
      })
      .mockReturnValueOnce({
        get: jest.fn().mockReturnValue(["src/**/foo.properties"]),
      });
    findFiles.mockResolvedValueOnce([]);
    await activate(context);
    const handler = registerCommand.mock.calls[0][1];
    await handler("KEY_ABC");
    assert.deepStrictEqual(
      showWarningMessage.mock.calls[0][0],
      "No properties files found matching propertyFileGlobs."
    );
  });

  it("プロパティファイル追加: 選択キャンセルで情報", async () => {
    mockWorkspace.getConfiguration
      .mockReturnValueOnce({
        get: jest.fn().mockReturnValue(["src/foo.properties"]),
      })
      .mockReturnValueOnce({
        get: jest.fn().mockReturnValue(["src/foo.properties"]),
      });
    findFiles.mockResolvedValueOnce([{ fsPath: "/hoge/foo.properties" }]);
    showQuickPick.mockResolvedValueOnce(undefined);
    await activate(context);
    const handler = registerCommand.mock.calls[0][1];
    await handler("CANCEL_KEY");
    // 1回目はactivate時の情報メッセージ、2回目が本命
    assert.deepStrictEqual(
      showInformationMessage.mock.calls[1][0],
      "Key addition canceled."
    );
  });

  it("プロパティファイル追加: 正常系でkey追加、保存", async () => {
    mockWorkspace.getConfiguration
      .mockReturnValueOnce({
        get: jest.fn().mockReturnValue(["src/bar.properties"]),
      })
      .mockReturnValueOnce({
        get: jest.fn().mockReturnValue(["src/bar.properties"]),
      });
    findFiles.mockResolvedValueOnce([{ fsPath: "/dir/bar.properties" }]);
    showQuickPick.mockResolvedValueOnce({
      label: "bar.properties",
      uri: { fsPath: "/dir/bar.properties" },
    });
    const mockDoc = {
      lineAt: jest
        .fn()
        .mockReturnValue({ range: { end: { line: 1, character: 5 } } }),
      lineCount: 2,
      uri: { fsPath: "/dir/bar.properties" },
      save: jest.fn().mockResolvedValue(true),
    };
    openTextDocument.mockResolvedValueOnce(mockDoc);

    await activate(context);
    const handler = registerCommand.mock.calls[0][1];
    await handler("NEWKEY");
    assert.strictEqual(applyEdit.mock.calls.length > 0, true);
    assert.strictEqual(mockDoc.save.mock.calls.length > 0, true);
  });

  it("バリデーション: Java以外や除外パスは実行されない", async () => {
    (utils.isExcludedFile as jest.Mock).mockReturnValue(true);
    await activate(context);
    const cb = mockWorkspace.onDidOpenTextDocument.mock.calls[0][0];
    const doc = { languageId: "xml", uri: { fsPath: "foo" } };
    cb(doc);
    assert.strictEqual(
      (PropertyValidator.validateProperties as jest.Mock).mock.calls.length,
      0
    );
    assert.strictEqual(
      (diagnostic.validatePlaceholders as jest.Mock).mock.calls.length,
      0
    );
  });

  it("バリデーション: Javaかつ対象パスなら両バリデーションが呼ばれる", async () => {
    (utils.isExcludedFile as jest.Mock).mockReturnValue(false);
    await activate(context);

    // Jestのタイマーを使って500ms進める
    jest.useFakeTimers();

    const cb = mockWorkspace.onDidOpenTextDocument.mock.calls[0][0];
    const doc = { languageId: "java", uri: { fsPath: "foo" } };
    cb(doc);

    // 500ms進めて、全setTimeoutコールバックを即座に実行
    jest.advanceTimersByTime(501);

    // タイマーのキューが片付くまで待つ
    await Promise.resolve();

    assert.strictEqual(
      (PropertyValidator.validateProperties as jest.Mock).mock.calls.length > 0,
      true
    );
    assert.strictEqual(
      (diagnostic.validatePlaceholders as jest.Mock).mock.calls.length > 0,
      true
    );

    // テスト終了後にタイマーをリセット
    jest.useRealTimers();
  });
});
