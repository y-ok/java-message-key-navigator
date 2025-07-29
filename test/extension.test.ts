import { strict as assert } from "assert";

// ===== VSCodeフルモック (jest.mockより前に定義) =====
const showWarningMessage = jest.fn();
const showInformationMessage = jest.fn();
const showQuickPick = jest.fn();
const showTextDocument = jest.fn();
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
  showTextDocument,
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

  it("プロパティファイル追加: editorはあるが '=' の行が見つからないとき selection/revealRange は呼ばれない", async () => {
    // 1) 設定とファイル選択のモック
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

    // 2) ドキュメントのモック：行はあるが "NEWKEY=" はない
    const lines = ["foo=1", "bar=2", "baz=3"];
    const mockDoc: any = {
      uri: {
        fsPath: "/dir/bar.properties",
        toString: () => "/dir/bar.properties",
      },
      getText: jest.fn().mockReturnValue(lines.join("\n")),
      save: jest.fn().mockResolvedValue(true),
      lineAt: jest
        .fn()
        .mockReturnValue({ range: { end: { line: 1, character: 5 } } }),
      lineCount: 3,
    };
    openTextDocument.mockResolvedValueOnce(mockDoc);

    // 3) エディタのモック
    const mockEditor: any = {
      selection: undefined,
      revealRange: jest.fn(),
    };
    showTextDocument.mockResolvedValueOnce(mockEditor);

    // 4) 実行
    await activate(context);
    const handler = registerCommand.mock.calls[0][1];
    await handler("NEWKEY");

    // 5) アサーション：selection は変わらず、revealRange も呼ばれていない
    assert.strictEqual(mockEditor.selection, undefined);
    assert.strictEqual(mockEditor.revealRange.mock.calls.length, 0);
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

  it("activate: activeTextEditor があるとき scheduleAll が呼ばれる", async () => {
    // タイマーをモック化
    jest.useFakeTimers();

    // 1) mockWindow に activeTextEditor を仕込む
    const fakeDoc = {
      languageId: "java",
      uri: { fsPath: "/foo/Bar.java" },
      getText: jest.fn().mockReturnValue(""), // scheduleAll内のsplit用
    } as any;
    mockWindow.activeTextEditor = { document: fakeDoc } as any;

    // 2) 除外ファイルフィルタを通過させる
    (utils.isExcludedFile as jest.Mock).mockReturnValue(false);

    // 3) activate を実行
    await activate(context);

    // まだタイマー前なのでバリデータは呼ばれていない
    assert.strictEqual(
      (PropertyValidator.validateProperties as jest.Mock).mock.calls.length,
      0
    );
    assert.strictEqual(
      (diagnostic.validatePlaceholders as jest.Mock).mock.calls.length,
      0
    );

    // 4) 500ms 経過させてコールバックを即時実行
    jest.advanceTimersByTime(500);
    // Promise キューを解放して async 内も回す
    await Promise.resolve();

    // 5) scheduleAll 経由でバリデータが呼ばれているはず
    assert.strictEqual(
      (PropertyValidator.validateProperties as jest.Mock).mock.calls.length > 0,
      true
    );
    assert.strictEqual(
      (diagnostic.validatePlaceholders as jest.Mock).mock.calls.length > 0,
      true
    );

    // 後片付け
    mockWindow.activeTextEditor = undefined;
    jest.useRealTimers();
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

  // 既存の「正常系でkey追加、保存」テストのあと、バリデーション系テストの手前あたりに追加してください
  it("プロパティファイル追加: editorがあるとき '=' の右隣にカーソルをセットし、revealRangeが呼ばれる", async () => {
    // 1) 設定とファイル選択のモック
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

    // 2) ドキュメントのモック：2行目に "NEWKEY=" がある想定
    const lines = ["foo=1", "NEWKEY=", "baz=3"];
    const mockDoc: any = {
      uri: {
        fsPath: "/dir/bar.properties",
        toString: () => "/dir/bar.properties",
      },
      getText: jest.fn().mockReturnValue(lines.join("\n")),
      save: jest.fn().mockResolvedValue(true),
      lineAt: jest
        .fn()
        .mockReturnValue({ range: { end: { line: 2, character: 3 } } }),
      lineCount: 3,
    };
    openTextDocument.mockResolvedValueOnce(mockDoc);

    // 3) エディタのモック
    const mockEditor: any = {
      selection: undefined,
      revealRange: jest.fn(),
    };
    showTextDocument.mockResolvedValueOnce(mockEditor);

    // 4) 実行
    await activate(context);
    const handler = registerCommand.mock.calls[0][1];
    await handler("NEWKEY");

    // 5) アサーション：selectionがセットされ、revealRangeが呼ばれていること
    assert.ok(mockEditor.selection, "editor.selection が設定されているはず");
    assert.strictEqual(
      mockEditor.revealRange.mock.calls.length > 0,
      true,
      "editor.revealRange が呼ばれているはず"
    );
  });

  describe("activate → subscription callbacks のスケジュール動作", () => {
    beforeAll(() => {
      jest.useFakeTimers();
    });
    afterAll(() => {
      jest.useRealTimers();
    });
    beforeEach(() => {
      jest.clearAllMocks();
      // 除外フィルタは通す
      (utils.isExcludedFile as jest.Mock).mockReturnValue(false);
    });

    it("onDidChangeTextDocument: Javaドキュメントなら scheduleAll が呼ばれる", async () => {
      await activate(context);
      const changeCb = mockWorkspace.onDidChangeTextDocument.mock.calls[0][0];
      const doc = {
        languageId: "java",
        uri: { fsPath: "foo" },
        getText: jest.fn().mockReturnValue(""),
      } as any;
      changeCb({ document: doc });
      jest.advanceTimersByTime(500);
      await Promise.resolve();
      assert.ok(
        (PropertyValidator.validateProperties as jest.Mock).mock.calls.length >
          0,
        "validateProperties が呼ばれる"
      );
      assert.ok(
        (diagnostic.validatePlaceholders as jest.Mock).mock.calls.length > 0,
        "validatePlaceholders が呼ばれる"
      );
    });

    it("onDidChangeTextDocument: Java以外や除外ファイルでは何も起きない", async () => {
      (utils.isExcludedFile as jest.Mock).mockReturnValue(true);
      await activate(context);
      const changeCb = mockWorkspace.onDidChangeTextDocument.mock.calls[0][0];
      const doc = { languageId: "xml", uri: { fsPath: "foo" } } as any;
      changeCb({ document: doc });
      jest.advanceTimersByTime(500);
      await Promise.resolve();
      assert.strictEqual(
        (PropertyValidator.validateProperties as jest.Mock).mock.calls.length,
        0
      );
      assert.strictEqual(
        (diagnostic.validatePlaceholders as jest.Mock).mock.calls.length,
        0
      );
    });

    it("onDidSaveTextDocument: Javaドキュメントなら scheduleAll が呼ばれる", async () => {
      await activate(context);
      const saveCb = mockWorkspace.onDidSaveTextDocument.mock.calls[0][0];
      const doc = {
        languageId: "java",
        uri: { fsPath: "foo" },
        getText: jest.fn().mockReturnValue(""),
      } as any;
      saveCb(doc);
      jest.advanceTimersByTime(500);
      await Promise.resolve();
      assert.ok(
        (PropertyValidator.validateProperties as jest.Mock).mock.calls.length >
          0,
        "validateProperties が呼ばれる"
      );
      assert.ok(
        (diagnostic.validatePlaceholders as jest.Mock).mock.calls.length > 0,
        "validatePlaceholders が呼ばれる"
      );
    });

    it("onDidSaveTextDocument: Java以外や除外ファイルでは何も起きない", async () => {
      (utils.isExcludedFile as jest.Mock).mockReturnValue(true);
      await activate(context);
      const saveCb = mockWorkspace.onDidSaveTextDocument.mock.calls[0][0];
      const doc = { languageId: "xml", uri: { fsPath: "foo" } } as any;
      saveCb(doc);
      jest.advanceTimersByTime(500);
      await Promise.resolve();
      assert.strictEqual(
        (PropertyValidator.validateProperties as jest.Mock).mock.calls.length,
        0
      );
      assert.strictEqual(
        (diagnostic.validatePlaceholders as jest.Mock).mock.calls.length,
        0
      );
    });

    it("onDidChangeActiveTextEditor: editor.document があれば scheduleAll が呼ばれる", async () => {
      await activate(context);
      const activeCb = mockWindow.onDidChangeActiveTextEditor.mock.calls[0][0];
      const doc = {
        languageId: "java",
        uri: { fsPath: "foo" },
        getText: jest.fn().mockReturnValue(""),
      } as any;
      activeCb({ document: doc });
      jest.advanceTimersByTime(500);
      await Promise.resolve();
      assert.ok(
        (PropertyValidator.validateProperties as jest.Mock).mock.calls.length >
          0,
        "validateProperties が呼ばれる"
      );
      assert.ok(
        (diagnostic.validatePlaceholders as jest.Mock).mock.calls.length > 0,
        "validatePlaceholders が呼ばれる"
      );
    });

    it("onDidChangeActiveTextEditor: undefined が渡されると何も起きない", async () => {
      await activate(context);
      const activeCb = mockWindow.onDidChangeActiveTextEditor.mock.calls[0][0];
      activeCb(undefined);
      jest.advanceTimersByTime(500);
      await Promise.resolve();
      assert.strictEqual(
        (PropertyValidator.validateProperties as jest.Mock).mock.calls.length,
        0
      );
      assert.strictEqual(
        (diagnostic.validatePlaceholders as jest.Mock).mock.calls.length,
        0
      );
    });
  });

  describe("Filtered*Provider classes", () => {
    const fakeDoc = { uri: { fsPath: "/any/file" }, languageId: "java" } as any;
    const pos = {} as any;
    const token = {} as any;

    beforeEach(async () => {
      // clearAllMocks は outer beforeEach ですでに呼ばれているので、
      // 実装のモックだけ確認できればOK
      // 設定は空配列、loadPropertyDefinitionsは解決、activateで登録
      mockWorkspace.getConfiguration.mockReturnValue({
        get: jest.fn().mockReturnValue([]),
      });
      await activate(context);
    });

    it("FilteredHoverProvider: isExcludedFile=true → undefined を返す", () => {
      (utils.isExcludedFile as jest.Mock).mockReturnValue(true);
      const provider = registerHoverProvider.mock.calls[0][1] as any;
      const result = provider.provideHover(fakeDoc, pos, token);
      assert.strictEqual(result, undefined);
    });

    it("FilteredHoverProvider: isExcludedFile=false → base.provideHover が呼ばれる", () => {
      (utils.isExcludedFile as jest.Mock).mockReturnValue(false);
      const provider = registerHoverProvider.mock.calls[0][1] as any;
      // base をモックに差し替え
      const baseMock = { provideHover: jest.fn().mockReturnValue("HOVERED") };
      provider.base = baseMock;
      const result = provider.provideHover(fakeDoc, pos, token);
      assert.strictEqual(result, "HOVERED");
      assert.ok(baseMock.provideHover.mock.calls.length > 0);
    });

    it("FilteredDefinitionProvider: isExcludedFile=true → undefined を返す", () => {
      (utils.isExcludedFile as jest.Mock).mockReturnValue(true);
      const provider = registerDefinitionProvider.mock.calls[0][1] as any;
      const result = provider.provideDefinition(fakeDoc, pos, token);
      assert.strictEqual(result, undefined);
    });

    it("FilteredDefinitionProvider: isExcludedFile=false → base.provideDefinition が呼ばれる", () => {
      (utils.isExcludedFile as jest.Mock).mockReturnValue(false);
      const provider = registerDefinitionProvider.mock.calls[0][1] as any;
      const baseMock = {
        provideDefinition: jest.fn().mockReturnValue(["DEF"]),
      };
      provider.base = baseMock;
      const result = provider.provideDefinition(fakeDoc, pos, token);
      assert.deepStrictEqual(result, ["DEF"]);
      assert.ok(baseMock.provideDefinition.mock.calls.length > 0);
    });

    it("FilteredQuickFixProvider: isExcludedFile=true → 空配列を返す", () => {
      (utils.isExcludedFile as jest.Mock).mockReturnValue(true);
      const provider = registerCodeActionsProvider.mock.calls[0][1] as any;
      const result = provider.provideCodeActions(
        fakeDoc,
        {} as any,
        {} as any,
        token
      );
      assert.deepStrictEqual(result, []);
    });

    it("FilteredQuickFixProvider: isExcludedFile=false → base.provideCodeActions が呼ばれる", () => {
      (utils.isExcludedFile as jest.Mock).mockReturnValue(false);
      const provider = registerCodeActionsProvider.mock.calls[0][1] as any;
      const baseMock = {
        provideCodeActions: jest.fn().mockReturnValue(["ACTION"]),
      };
      provider.base = baseMock;
      const result = provider.provideCodeActions(
        fakeDoc,
        {} as any,
        {} as any,
        token
      );
      assert.deepStrictEqual(result, ["ACTION"]);
      assert.ok(baseMock.provideCodeActions.mock.calls.length > 0);
    });

    it("FilteredCompletionProvider: isExcludedFile=true → undefined を返す", () => {
      (utils.isExcludedFile as jest.Mock).mockReturnValue(true);
      const provider = registerCompletionItemProvider.mock.calls[0][1] as any;
      const result = provider.provideCompletionItems(
        fakeDoc,
        pos,
        token,
        {} as any
      );
      assert.strictEqual(result, undefined);
    });

    it("FilteredCompletionProvider: isExcludedFile=false → base.provideCompletionItems が呼ばれる", () => {
      (utils.isExcludedFile as jest.Mock).mockReturnValue(false);
      const provider = registerCompletionItemProvider.mock.calls[0][1] as any;
      const baseMock = {
        provideCompletionItems: jest.fn().mockReturnValue("COMP"),
      };
      provider.base = baseMock;
      const result = provider.provideCompletionItems(
        fakeDoc,
        pos,
        token,
        {} as any
      );
      assert.strictEqual(result, "COMP");
      assert.ok(baseMock.provideCompletionItems.mock.calls.length > 0);
    });
  });
});
