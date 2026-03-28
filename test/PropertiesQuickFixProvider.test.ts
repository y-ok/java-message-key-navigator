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
        .mockReturnValue({
          get: (key: string, def: any) =>
            key === "propertyFileGlobs" ? ["**/*.properties"] : def,
        }),
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

    const expectedTitle = `💾 Add "${key}" to file.properties`;
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
    assert.deepStrictEqual(cmd.arguments, [key, "/path/to/file.properties"]);

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

  it("フォールバック: どの glob でもマッチしない → 空配列を返す", async () => {
    (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
      get: (_key: string, _def: any) => ["g1", "g2"],
    });
    (vscode.workspace.findFiles as jest.Mock).mockResolvedValue([]);

    const fakeDiag = {
      code: "undefinedMessageKey",
      range: { intersection: () => range },
    } as any;

    const actions = await provider.provideCodeActions(doc, range, {
      diagnostics: [fakeDiag],
    } as any);

    assert.strictEqual(actions.length, 0);
  });

  it("全 glob を走査し、ヒットしたファイルごとにアクションが返る", async () => {
    (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
      get: () => ["gA", "gB", "gC"],
    });
    (vscode.workspace.findFiles as jest.Mock)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ fsPath: "/dir/B.properties" }])
      .mockResolvedValueOnce([{ fsPath: "/dir/C.properties" }]);

    const fakeDiag = {
      code: "undefinedMessageKey",
      range: { intersection: () => range },
    } as any;

    const actions = await provider.provideCodeActions(doc, range, {
      diagnostics: [fakeDiag],
    } as any);

    assert.strictEqual(actions.length, 2);
    assert.strictEqual(actions[0].command?.arguments?.[1], "/dir/B.properties");
    assert.strictEqual(actions[1].command?.arguments?.[1], "/dir/C.properties");
    expect((vscode.workspace.findFiles as jest.Mock).mock.calls.length).toBe(3);
  });
});

describe("PropertiesQuickFixProvider – 複数 glob の全ファイルを候補に含める", () => {
  let provider: PropertiesQuickFixProvider;
  const doc: any = { getText: (_: vscode.Range) => `"NewKey"` };
  const range = {} as vscode.Range;

  beforeEach(() => {
    jest.clearAllMocks();
    provider = new PropertiesQuickFixProvider();
  });

  it("複数 glob にマッチする全ファイルが走査される", async () => {
    (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
      get: (_key: string, _def: any) => ["g1", "g2"],
    });
    const uriA = { fsPath: "/dir/A.properties" };
    const uriB = { fsPath: "/dir/B.properties" };
    (vscode.workspace.findFiles as jest.Mock)
      .mockResolvedValueOnce([uriA])
      .mockResolvedValueOnce([uriB]);

    const fakeDiag = {
      code: "undefinedMessageKey",
      range: { intersection: () => range },
    } as any;

    await provider.provideCodeActions(doc, range, {
      diagnostics: [fakeDiag],
    } as any);

    expect((vscode.workspace.findFiles as jest.Mock).mock.calls.length).toBe(2);
  });
});

describe("PropertiesQuickFixProvider – 重複排除", () => {
  let provider: PropertiesQuickFixProvider;
  const doc: any = { getText: (_: vscode.Range) => `"DupKey"` };
  const range = {} as vscode.Range;
  const fakeDiag = {
    code: "undefinedMessageKey",
    range: { intersection: () => range },
  } as any;

  beforeEach(() => {
    jest.clearAllMocks();
    provider = new PropertiesQuickFixProvider();
  });

  it("複数 glob が同一ファイルにマッチした場合、重複が排除される", async () => {
    (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
      get: () => ["src/**/*.properties", "src/main/*.properties"],
    });
    const samePath = "/proj/src/main/msg.properties";
    (vscode.workspace.findFiles as jest.Mock)
      .mockResolvedValueOnce([{ fsPath: samePath }])
      .mockResolvedValueOnce([{ fsPath: samePath }]);

    const actions = await provider.provideCodeActions(doc, range, {
      diagnostics: [fakeDiag],
    } as any);

    assert.strictEqual(actions.length, 1);
    assert.strictEqual(actions[0].command?.arguments?.[1], samePath);
  });
});

describe("PropertiesQuickFixProvider – 複数ファイル時のファイル選択", () => {
  let provider: PropertiesQuickFixProvider;
  const doc: any = { getText: (_: vscode.Range) => `"PLF001"` };
  const range = {} as vscode.Range;
  const fakeDiag = {
    code: "undefinedMessageKey",
    range: { intersection: () => range },
  } as any;

  beforeEach(() => {
    jest.clearAllMocks();
    provider = new PropertiesQuickFixProvider();
  });

  it("単一 glob で複数ファイルがマッチした場合、ファイルごとにアクションが返る", async () => {
    (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
      get: () => ["src/**/*.properties"],
    });
    (vscode.workspace.findFiles as jest.Mock).mockResolvedValueOnce([
      { fsPath: "/proj/src/message.properties" },
      { fsPath: "/proj/src/error.properties" },
    ]);

    const actions = await provider.provideCodeActions(doc, range, {
      diagnostics: [fakeDiag],
    } as any);

    assert.strictEqual(actions.length, 2);
    assert.strictEqual(
      actions[0].command?.arguments?.[1],
      "/proj/src/message.properties"
    );
    assert.strictEqual(
      actions[1].command?.arguments?.[1],
      "/proj/src/error.properties"
    );
  });

  it("複数 glob で各1件マッチした場合、ファイルごとにアクションが返る", async () => {
    (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
      get: () => ["msg*.properties", "err*.properties"],
    });
    (vscode.workspace.findFiles as jest.Mock)
      .mockResolvedValueOnce([{ fsPath: "/proj/message.properties" }])
      .mockResolvedValueOnce([{ fsPath: "/proj/error.properties" }]);

    const actions = await provider.provideCodeActions(doc, range, {
      diagnostics: [fakeDiag],
    } as any);

    assert.strictEqual(actions.length, 2);
    assert.strictEqual(
      actions[0].command?.arguments?.[1],
      "/proj/message.properties"
    );
    assert.strictEqual(
      actions[1].command?.arguments?.[1],
      "/proj/error.properties"
    );
  });
});
