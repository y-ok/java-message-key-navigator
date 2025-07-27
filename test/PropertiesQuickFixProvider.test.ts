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
jest.mock("vscode", () => ({
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
}));

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
    // ダミー Document: getText(range)→ `"theKey"`
    doc = {
      getText: (_r: any) => `"theKey"`,
    };
    range = {}; // ダミー範囲
  });

  it("returns empty when no diagnostics", () => {
    context = { diagnostics: [] };
    const actions = provider.provideCodeActions(doc, range, context);
    assert.deepStrictEqual(actions, []);
    assert.strictEqual(appendLineSpy.mock.calls.length, 0);
  });

  it("returns empty when diagnostic.code is not undefinedMessageKey", () => {
    const diag = {
      code: "otherCode",
      range: { intersection: (_: any) => ({}) },
    };
    context = { diagnostics: [diag] };
    const actions = provider.provideCodeActions(doc, range, context);
    assert.deepStrictEqual(actions, []);
    assert.strictEqual(appendLineSpy.mock.calls.length, 0);
  });

  it("returns one QuickFix action for undefinedMessageKey", () => {
    const key = "fooBar";
    // Document.getText を上書きして `"fooBar"` を返す
    doc = { getText: (_: any) => `"${key}"` } as any;
    const diag = {
      code: "undefinedMessageKey",
      range: { intersection: (_: any) => ({}) },
    };
    context = { diagnostics: [diag] } as any;

    const actions = provider.provideCodeActions(doc, range, context);
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

    // アクション内容確認
    const action = actions[0];
    assert.strictEqual(action.title, expectedTitle);
    assert.strictEqual(action.kind, vscode.CodeActionKind.QuickFix);

    // ← まず command が定義されていることを確認
    assert.ok(action.command, "Expected action.command to be defined");

    // ここからは非 null アサーションで安全にアクセス
    const cmd = action.command!;
    assert.strictEqual(
      cmd.command,
      "java-message-key-navigator.addPropertyKey"
    );
    assert.strictEqual(cmd.title, expectedTitle);
    assert.deepStrictEqual(cmd.arguments, [key]);

    // diagnostics も同様に
    assert.deepStrictEqual(action.diagnostics, [diag]);
  });

  it("returns empty when intersection returns undefined", () => {
    const diag = {
      code: "undefinedMessageKey",
      range: { intersection: (_: any) => undefined },
    };
    context = { diagnostics: [diag] };
    const actions = provider.provideCodeActions(doc, range, context);
    assert.deepStrictEqual(actions, []);
    assert.strictEqual(appendLineSpy.mock.calls.length, 0);
  });
});
