import { strict as assert } from "assert";

// ① outputChannel モック
const appendLineSpy = jest.fn();
jest.mock("../src/outputChannel", () => ({
  __esModule: true,
  outputChannel: {
    appendLine: appendLineSpy,
    clear: jest.fn(),
  },
}));

// ② vscode モック
jest.mock("vscode", () => {
  return {
    __esModule: true,
    CodeActionKind: { QuickFix: "quickfix" },
    CodeAction: class {
      title: string;
      kind: string;
      command: any;
      diagnostics: any;
      constructor(title: string, kind: string) {
        this.title = title;
        this.kind = kind;
      }
    },
    workspace: {
      getConfiguration: jest
        .fn()
        .mockReturnValue({ get: (_key: string, def: any) => def }), // デフォルト globs を返す
      findFiles: jest
        .fn()
        .mockResolvedValue([{ fsPath: "/path/to/file.properties" }]),
    },
    Uri: {
      file: (fsPath: string) => ({ fsPath }),
    },
  };
});

import * as vscode from "vscode";
import { PropertiesQuickFixProvider } from "../src/PropertiesQuickFixProvider";

describe("PropertiesQuickFixProvider.provideCodeActions", () => {
  let provider: PropertiesQuickFixProvider;
  let doc: any;
  let range: any;
  let context: any;

  beforeEach(() => {
    jest.clearAllMocks();
    provider = new PropertiesQuickFixProvider();
    // デフォルト Document.getText(range) → `"theKey"`
    doc = { getText: (_r: any) => `"theKey"` };
    range = {}; // ダミー範囲
  });

  it("returns empty when no diagnostics", async () => {
    context = { diagnostics: [] };
    const actions = await provider.provideCodeActions(doc, range, context);
    assert.deepStrictEqual(actions, []);
    assert.strictEqual(appendLineSpy.mock.calls.length, 0);
  });

  it("returns empty when diagnostic.code is not undefinedMessageKey", async () => {
    const diag = {
      code: "otherCode",
      range: { intersection: (_: any) => ({}) },
    };
    context = { diagnostics: [diag] };
    const actions = await provider.provideCodeActions(doc, range, context);
    assert.deepStrictEqual(actions, []);
    assert.strictEqual(appendLineSpy.mock.calls.length, 0);
  });

  it("returns one QuickFix action for undefinedMessageKey", async () => {
    const key = "fooBar";
    doc = { getText: (_: any) => `"${key}"` } as any;
    const diag = {
      code: "undefinedMessageKey",
      range: { intersection: (_: any) => ({}) },
    };
    context = { diagnostics: [diag] } as any;

    const actions = await provider.provideCodeActions(doc, range, context);
    assert.strictEqual(actions.length, 1, "Expected one action");

    // ログ出力確認
    const expectedTitle = `💾 Add "${key}" to properties file`;
    expect(appendLineSpy).toHaveBeenNthCalledWith(
      1,
      `🔍 Undefined key: ${key}`
    );
    expect(appendLineSpy).toHaveBeenNthCalledWith(
      2,
      `✅ Quick fix added: ${expectedTitle}`
    );

    const action = actions[0];
    // Action プロパティ検証
    assert.strictEqual(action.title, expectedTitle);
    assert.strictEqual(action.kind, vscode.CodeActionKind.QuickFix);
    assert.ok(action.command, "Expected action.command to be defined");

    const cmd = action.command!;
    assert.strictEqual(
      cmd.command,
      "java-message-key-navigator.addPropertyKey"
    );
    assert.strictEqual(cmd.title, expectedTitle);
    // key と fileToUse の 2 要素で渡されていること
    assert.deepStrictEqual(cmd.arguments, [key, "/path/to/file.properties"]);

    // diagnostics も確認
    assert.deepStrictEqual(action.diagnostics, [diag]);
  });

  it("returns empty when intersection returns undefined", async () => {
    const diag = {
      code: "undefinedMessageKey",
      range: { intersection: (_: any) => undefined },
    };
    context = { diagnostics: [diag] };
    const actions = await provider.provideCodeActions(doc, range, context);
    assert.deepStrictEqual(actions, []);
    assert.strictEqual(appendLineSpy.mock.calls.length, 0);
  });
});

describe("PropertiesQuickFixProvider – glob iteration & fallback", () => {
  let provider: PropertiesQuickFixProvider;
  const doc: any = {
    // getText から戻る文字列はダブルクォート付き key（例: `"MyKey"`）にしてください
    getText: (_: vscode.Range) => `"MyKey"`,
  };
  const range = {} as vscode.Range;

  beforeEach(() => {
    jest.clearAllMocks();
    provider = new PropertiesQuickFixProvider();
  });

  it("フォールバック: どの glob でもマッチしない → 最初の glob が使われる", async () => {
    // 設定は ["g1","g2"]
    (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
      get: (_key: string, _def: any) => ["g1", "g2"],
    });
    // findFiles は常に空
    (vscode.workspace.findFiles as jest.Mock).mockResolvedValue([]);

    // undefinedMessageKey のダイアグをひとつだけ用意
    const fakeDiag = {
      code: "undefinedMessageKey",
      range: { intersection: () => range },
    } as any;

    // await を忘れずに
    const actions = await provider.provideCodeActions(doc, range, {
      diagnostics: [fakeDiag],
    } as any);

    // アクションは必ず 1 件
    assert.strictEqual(actions.length, 1);
    // コマンド引数に [key, "g1"] がセットされている
    assert.deepStrictEqual(actions[0].command?.arguments, ["MyKey", "g1"]);
  });

  it("最初の glob でマッチしない → 次の glob でマッチし break される", async () => {
    (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
      get: () => ["gA", "gB", "gC"],
    });
    // 1回目: 空 → 2回目: マッチ → 3回目は呼ばれない
    const uriB = { fsPath: "/dir/B.properties" };
    (vscode.workspace.findFiles as jest.Mock)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([uriB])
      .mockResolvedValueOnce([{ fsPath: "/dir/C.properties" }]);

    const fakeDiag = {
      code: "undefinedMessageKey",
      range: { intersection: () => range },
    } as any;

    const actions = await provider.provideCodeActions(doc, range, {
      diagnostics: [fakeDiag],
    } as any);

    // 1 件返ってくること
    assert.strictEqual(actions.length, 1);
    // コマンド引数は [key, "/dir/B.properties"]
    assert.deepStrictEqual(actions[0].command?.arguments, ["MyKey", "/dir/B.properties"]);
    // findFiles は 2 回だけ呼ばれていること
    expect((vscode.workspace.findFiles as jest.Mock).mock.calls.length).toBe(2);
  });
});
