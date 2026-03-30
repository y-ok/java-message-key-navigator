import { strict as assert } from "assert";
import type { CompletionItem, Position, TextDocument } from "vscode";
import * as vscode from "vscode";
import * as utils from "../src/utils";
import { MessageKeyCompletionProvider } from "../src/CompletionProvider";

jest.mock("vscode", () => ({
  __esModule: true,
  workspace: { getConfiguration: jest.fn() },
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
}));

jest.mock("../src/utils", () => ({
  getAllPropertyKeys: jest.fn(),
  getPropertyValue: jest.fn(),
}));

describe("MessageKeyCompletionProvider inference mode", () => {
  let provider: MessageKeyCompletionProvider;

  beforeEach(() => {
    jest.clearAllMocks();
    provider = new MessageKeyCompletionProvider();
    (utils.getAllPropertyKeys as jest.Mock).mockReturnValue([
      "MSG_START",
      "MSG_END",
    ]);
    (utils.getPropertyValue as jest.Mock).mockImplementation(
      (k: string) => `value:${k}`
    );
    (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
      get: (_key: string) => [],
    });
  });

  it("returns completion items when inferred method context matches", async () => {
    const fullText = [
      `infrastructureLogger.log("MSG_START");`,
      `infrastructureLogger.log("`,
    ].join("\n");
    const line = `infrastructureLogger.log("`;
    const doc = {
      getText: () => fullText,
      lineAt: () => ({ text: line }),
    } as unknown as TextDocument;
    const pos = { line: 1, character: line.length } as Position;

    const items = (await provider.provideCompletionItems(
      doc,
      pos
    )) as CompletionItem[];
    assert.strictEqual(items.length, 2);
    assert.strictEqual(items[0].insertText, "MSG_START");
  });

  it("returns undefined when inferred context does not match", async () => {
    const fullText = `foo("BAR");`;
    const line = `plain("`;
    const doc = {
      getText: () => fullText,
      lineAt: () => ({ text: line }),
    } as unknown as TextDocument;
    const pos = { line: 0, character: line.length } as Position;

    const result = await provider.provideCompletionItems(doc, pos);
    assert.strictEqual(result, undefined);
  });
});
