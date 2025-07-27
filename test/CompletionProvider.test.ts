import { strict as assert } from "assert";
import type { TextDocument, Position, CompletionItem } from "vscode";

// ① vscode モジュールを完全モック
jest.mock("vscode", () => {
  let stubChannel: any;
  return {
    __esModule: true,
    window: {
      createOutputChannel: () => stubChannel,
    },
    workspace: {
      getConfiguration: jest.fn(),
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
      constructor(v: string) { this.value = v; }
    },
    // テストから stubChannel を注入できるようにする
    __setChannel: (chan: any) => { stubChannel = chan; },
  };
});

// ② utils モジュールをモック
jest.mock("../src/utils", () => ({
  getAllPropertyKeys: jest.fn(),
  getPropertyValue: jest.fn(),
}));

import * as vscode from "vscode";
import {
  getAllPropertyKeys,
  getPropertyValue,
} from "../src/utils";
import { MessageKeyCompletionProvider } from "../src/CompletionProvider";

describe("MessageKeyCompletionProvider.provideCompletionItems", () => {
  let provider: MessageKeyCompletionProvider;
  let fakeChannelImpl: any;
  let doc: TextDocument;
  let currentLine: string;

  beforeEach(() => {
    jest.resetAllMocks();
    provider = new MessageKeyCompletionProvider();

    // ③ utils モックの戻り値を設定
    (getAllPropertyKeys as jest.Mock).mockReturnValue([
      "user.name",
      "admin.key",
      "publicKey",
      "other.setting",
    ]);
    (getPropertyValue as jest.Mock).mockImplementation(
      (k: string) => `value:${k}`
    );

    // ④ stubChannel にログ／クリアのフックを仕込む
    const logs: string[] = [];
    let cleared = false;
    fakeChannelImpl = {
      appendLine(msg: string) { logs.push(msg); },
      clear() { cleared = true; },
    };
    // vscode モックにセット
    (vscode as any).__setChannel(fakeChannelImpl);

    // ⑤ Document モック。lineAt だけ返せば十分
    doc = {
      lineAt: () => ({ text: currentLine }),
    } as any;
  });

  it("returns undefined when no patterns configured", async () => {
    (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
      get: () => undefined,
    });

    currentLine = `foo("`;
    const pos = { line: 0, character: currentLine.length } as any;

    const result = await provider.provideCompletionItems(doc, pos);
    assert.strictEqual(result, undefined);
  });

  it("returns undefined when line does not match any pattern", async () => {
    (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
      get: (_: string) => ["foo("],
    });

    currentLine = `someOther("`;
    const pos = { line: 0, character: currentLine.length } as any;

    const result = await provider.provideCompletionItems(doc, pos);
    assert.strictEqual(result, undefined);
  });

  it("returns all keys when input prefix is empty", async () => {
    (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
      get: (_: string) => ["foo("],
    });

    currentLine = `foo("`;
    const pos = { line: 0, character: currentLine.length } as any;

    const items = await provider.provideCompletionItems(doc, pos);
    assert.ok(Array.isArray(items) && items!.length === 4);

    const first = items![0];
    assert.strictEqual(first.label, "user.name - value:user.name");
    assert.strictEqual(first.insertText, "user.name");
    assert.strictEqual(
      (first.documentation as any).value,
      "**user.name**\n\nvalue:user.name"
    );
  });

  it("filters keys by input prefix", async () => {
    (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
      get: (_: string) => ["foo("],
    });

    currentLine = `foo("Key`;
    const pos = { line: 0, character: currentLine.length } as any;

    const items = await provider.provideCompletionItems(doc, pos);
    const inserts = items!.map((i) => i.insertText);
    assert.deepStrictEqual(inserts, ["admin.key", "publicKey"]);
  });
});
