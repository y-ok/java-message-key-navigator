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
    assert.strictEqual(action.title, expectedTitle);
    assert.strictEqual(action.kind, vscode.CodeActionKind.QuickFix);
    assert.ok(action.command, "Expected action.command to be defined");

    const cmd = action.command!;
    assert.strictEqual(
      cmd.command,
      "java-message-key-navigator.addPropertyKey"
    );
    assert.strictEqual(cmd.title, expectedTitle);
    // key のみ渡す（ファイル選択はコマンドハンドラ側の showQuickPick で行う）
    assert.deepStrictEqual(cmd.arguments, [key]);

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
