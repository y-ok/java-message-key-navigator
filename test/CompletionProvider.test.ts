import { strict as assert } from "assert";
import type { TextDocument, Position, CompletionItem } from "vscode";
import * as vscode from "vscode";
import * as utils from "../src/utils";
import {
  inferAnnotationTargets,
  inferMethodPatterns,
  matchesInferredCompletionContext,
} from "../src/inference";
import { MessageKeyCompletionProvider } from "../src/CompletionProvider";

jest.mock("vscode", () => {
  let stubChannel: any;
  return {
    __esModule: true,
    window: {
      createOutputChannel: () => stubChannel,
      showErrorMessage: jest.fn(),
      showWarningMessage: jest.fn(),
      showInformationMessage: jest.fn(),
      showTextDocument: jest.fn(),
    },
    workspace: {
      getConfiguration: jest.fn(),
      findFiles: jest.fn(),
      openTextDocument: jest.fn(),
      applyEdit: jest.fn(),
    },
    CompletionItem: class {
      label: string;
      kind: any;
      insertText: any;
      documentation: any;
      constructor(label: string, kind: any) {
        this.label = label;
        this.kind = kind;
      }
    },
    CompletionItemKind: { Value: "Value" },
    MarkdownString: class {
      value: string;
      constructor(v: string) {
        this.value = v;
      }
    },
    Uri: {
      file: (fsPath: string) => ({ fsPath }),
    },
    Position: class {
      constructor(public line: number, public character: number) {}
    },
    Range: class {
      constructor(public start: any, public end: any) {}
    },
    ViewColumn: { One: 1 },
    __setChannel: (chan: any) => {
      stubChannel = chan;
    },
  };
});

jest.mock("../src/utils", () => ({
  getAllPropertyKeys: jest.fn(),
  getPropertyValue: jest.fn(),
}));

jest.mock("../src/inference", () => ({
  __esModule: true,
  inferMethodPatterns: jest.fn(),
  inferAnnotationTargets: jest.fn(),
  matchesInferredCompletionContext: jest.fn(),
}));

describe("MessageKeyCompletionProvider.provideCompletionItems", () => {
  let provider: MessageKeyCompletionProvider;
  let fakeChannel: any;
  let doc: TextDocument;
  let currentLine: string;
  let currentText: string;

  beforeEach(() => {
    jest.resetAllMocks();
    provider = new MessageKeyCompletionProvider();

    (utils.getAllPropertyKeys as jest.Mock).mockReturnValue([
      "user.name",
      "admin.key",
      "publicKey",
      "other.setting",
    ]);
    (utils.getPropertyValue as jest.Mock).mockImplementation(
      (k: string) => `value:${k}`
    );

    (inferMethodPatterns as jest.Mock).mockReturnValue(["foo"]);
    (inferAnnotationTargets as jest.Mock).mockReturnValue(new Set<string>());
    (matchesInferredCompletionContext as jest.Mock).mockReturnValue(true);

    const logs: string[] = [];
    fakeChannel = {
      appendLine(msg: string) {
        logs.push(msg);
      },
      clear() {
        logs.length = 0;
      },
    };
    (vscode as any).__setChannel(fakeChannel);

    currentText = "class A {}";
    doc = {
      getText: () => currentText,
      lineAt: () => ({ text: currentLine }),
    } as any;
  });

  it("補完パターン設定が undefined の場合は undefined を返す", async () => {
    doc = {
      lineAt: () => ({ text: `foo("` }),
    } as any;
    const pos = { line: 0, character: 5 } as Position;

    const res = await provider.provideCompletionItems(doc, pos);
    assert.strictEqual(res, undefined);
  });

  it("行がいずれのパターンにもマッチしない場合は undefined を返す", async () => {
    (matchesInferredCompletionContext as jest.Mock).mockReturnValue(false);
    currentLine = `bar("`;
    const pos = { line: 0, character: currentLine.length } as Position;

    const res = await provider.provideCompletionItems(doc, pos);
    assert.strictEqual(res, undefined);
  });

  it('プレフィックス空 (foo(") の場合は全キーを配列で返す', async () => {
    currentLine = `foo("`;
    const pos = { line: 0, character: currentLine.length } as Position;

    const items = (await provider.provideCompletionItems(
      doc,
      pos
    )) as CompletionItem[];
    assert.strictEqual(items.length, 4);
    assert.strictEqual(items[0].label, "user.name - value:user.name");
    assert.strictEqual(items[0].insertText, "user.name");
    assert.strictEqual(
      (items[0].documentation as any).value,
      "**user.name**\n\nvalue:user.name"
    );
  });

  it("入力プレフィックス “Key” でキーをフィルタリングする", async () => {
    currentLine = `foo("Key`;
    const pos = { line: 0, character: currentLine.length } as Position;

    const items = (await provider.provideCompletionItems(
      doc,
      pos
    )) as CompletionItem[];
    const inserts = items.map((i) => i.insertText);
    assert.deepStrictEqual(inserts, ["admin.key", "publicKey"]);
  });

  it("パターン設定が空配列の場合は undefined を返す", async () => {
    (inferMethodPatterns as jest.Mock).mockReturnValue([]);
    (inferAnnotationTargets as jest.Mock).mockReturnValue(new Set<string>());
    (matchesInferredCompletionContext as jest.Mock).mockReturnValue(false);
    currentLine = `foo("`;
    const pos = { line: 0, character: currentLine.length } as Position;

    const res = await provider.provideCompletionItems(doc, pos);
    assert.strictEqual(res, undefined);
  });

  it("マッチするパターンかつキャッシュが空の場合は空配列を返す", async () => {
    (utils.getAllPropertyKeys as jest.Mock).mockReturnValue([]);
    currentLine = `foo("`;
    const pos = { line: 0, character: currentLine.length } as Position;

    const res = await provider.provideCompletionItems(doc, pos);
    assert.deepStrictEqual(res, []);
  });

  it("マッチしキャッシュにキーがある場合は CompletionItem[] を返す", async () => {
    (utils.getAllPropertyKeys as jest.Mock).mockReturnValue(["A", "B"]);
    (utils.getPropertyValue as jest.Mock)
      .mockReturnValueOnce("VA")
      .mockReturnValueOnce("VB");
    currentLine = `foo("`;
    const pos = { line: 0, character: currentLine.length } as Position;

    const items = (await provider.provideCompletionItems(
      doc,
      pos
    )) as CompletionItem[];
    assert.strictEqual(items[0].label, "A - VA");
    assert.strictEqual(items[1].label, "B - VB");
  });

  it("パターンが一致し、キャッシュが空の場合は空配列を返す", async () => {
    (utils.getAllPropertyKeys as jest.Mock).mockReturnValue([]);
    (inferMethodPatterns as jest.Mock).mockReturnValue(["log"]);
    currentLine = `log("`;
    const pos = { line: 0, character: currentLine.length } as Position;

    const res = await provider.provideCompletionItems(doc, pos);
    assert.deepStrictEqual(res, []);
  });

  it("annotationKeyExtractionPatterns でのみマッチする場合も補完が動作する", async () => {
    (inferMethodPatterns as jest.Mock).mockReturnValue([]);
    (inferAnnotationTargets as jest.Mock).mockReturnValue(new Set(["Anno#value"]));
    (utils.getAllPropertyKeys as jest.Mock).mockReturnValue(["abc", "def"]);
    (utils.getPropertyValue as jest.Mock).mockReturnValue("VAL");
    currentLine = `@Anno("`;
    const pos = { line: 0, character: currentLine.length } as Position;

    const items = (await provider.provideCompletionItems(
      doc,
      pos
    )) as CompletionItem[];
    assert.strictEqual(items.length, 2);
    assert.strictEqual(items[0].label, "abc - VAL");
    assert.strictEqual(items[1].label, "def - VAL");
  });

  it("getPropertyValue が undefined の場合は空文字として扱う", async () => {
    (utils.getAllPropertyKeys as jest.Mock).mockReturnValue(["XYZ"]);
    (utils.getPropertyValue as jest.Mock).mockReturnValue(undefined);
    currentLine = `log("`;
    const pos = { line: 0, character: currentLine.length } as Position;

    const items = (await provider.provideCompletionItems(
      doc,
      pos
    )) as CompletionItem[];
    assert.strictEqual(items.length, 1);
    assert.strictEqual(items[0].label, "XYZ - ");
    assert.strictEqual(items[0].insertText, "XYZ");
  });

  it("messageKeyExtractionPatterns と annotationKeyExtractionPatterns 両方にマッチする場合も補完が動作する", async () => {
    (utils.getAllPropertyKeys as jest.Mock).mockReturnValue(["X", "Y"]);
    (utils.getPropertyValue as jest.Mock)
      .mockReturnValueOnce("VX")
      .mockReturnValueOnce("VY")
      .mockReturnValueOnce("value:X")
      .mockReturnValueOnce("value:Y");

    currentLine = `log("`;
    let pos = { line: 0, character: currentLine.length } as Position;
    let items = (await provider.provideCompletionItems(doc, pos)) as CompletionItem[];
    assert.strictEqual(items.length, 2);
    assert.strictEqual(items[0].label, "X - VX");
    assert.strictEqual(items[1].label, "Y - VY");

    currentLine = `@Anno("`;
    pos = { line: 0, character: currentLine.length } as Position;
    items = (await provider.provideCompletionItems(doc, pos)) as CompletionItem[];
    assert.strictEqual(items.length, 2);
    assert.strictEqual(items[0].label, "X - value:X");
    assert.strictEqual(items[1].label, "Y - value:Y");
  });

  it("lineUntilPosition.match が null のとき（引用符直前以外）inputMatch=null 分岐をテスト", async () => {
    (utils.getAllPropertyKeys as jest.Mock).mockReturnValue(["A"]);
    (utils.getPropertyValue as jest.Mock).mockReturnValue("VA");
    currentLine = `foo(`;
    const pos = { line: 0, character: currentLine.length } as Position;
    const items = (await provider.provideCompletionItems(doc, pos)) as CompletionItem[];
    assert.deepStrictEqual(items.map((i) => i.insertText), ["A"]);
  });

  it("getPropertyValue が undefined の場合は空文字として扱う分岐（51行目）をテスト", async () => {
    (utils.getAllPropertyKeys as jest.Mock).mockReturnValue(["Z"]);
    (utils.getPropertyValue as jest.Mock).mockReturnValue(undefined);
    currentLine = `foo("`;
    const pos = { line: 0, character: currentLine.length } as Position;
    const items = (await provider.provideCompletionItems(doc, pos)) as CompletionItem[];
    assert.strictEqual(items[0].label, "Z - ");
    assert.strictEqual((items[0].documentation as any).value, "**Z**\n\n");
  });
});
