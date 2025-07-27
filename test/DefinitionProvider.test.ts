/**
 * test/DefinitionProvider.test.ts
 */
import { PropertiesDefinitionProvider } from "../src/DefinitionProvider";
import * as utils from "../src/utils";

// outputChannelモック
jest.mock("../src/outputChannel", () => ({
  __esModule: true,
  outputChannel: { appendLine: jest.fn() },
}));

// utilsモック
jest.mock("../src/utils", () => {
  const actual = jest.requireActual("../src/utils");
  return {
    ...actual,
    getCustomPatterns: jest.fn(),
    loadPropertyDefinitions: jest.fn(),
    findPropertyLocation: jest.fn(),
  };
});

// vscode完全モック（Uri.file含む）
jest.mock("vscode", () => ({
  __esModule: true,
  workspace: {
    getConfiguration: jest.fn(),
  },
  Uri: {
    file: (path: string) => ({ fsPath: path }),
  },
  Position: class {
    constructor(public line: number, public character: number) {}
  },
  Location: class {
    constructor(public uri: any, public range: any) {
      this.uri = uri;
      this.range = { start: range, end: range };
    }
  },
}));

import * as vscode from "vscode";

describe("PropertiesDefinitionProvider", () => {
  let provider: PropertiesDefinitionProvider;
  let doc: any;
  let position: any;

  beforeEach(() => {
    jest.clearAllMocks();
    provider = new PropertiesDefinitionProvider();
    doc = {
      getText: jest.fn(),
      offsetAt: jest.fn(),
    };
    position = { line: 0, character: 0 };
  });

  it("正常系: ジャンプ先が見つかる場合、Locationが返る", async () => {
    const text = 'log("MSG_KEY");';
    (doc.getText as jest.Mock).mockReturnValue(text);
    (doc.offsetAt as jest.Mock).mockReturnValue(5 + 1);

    const regex = /log\("([^"]+)"\)/g;
    (utils.getCustomPatterns as jest.Mock).mockReturnValue([regex]);
    (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
      get: () => [],
    });

    (utils.findPropertyLocation as jest.Mock).mockResolvedValue({
      filePath: "/foo/bar.properties",
      position: new vscode.Position(3, 5),
    });

    const res = await provider.provideDefinition(doc as any, position);
    expect(res).toBeInstanceOf(vscode.Location);

    // ★ nullチェック (TypeScript型安全＋実行時ガード)
    if (!res) {
      fail("Location expected, but got null");
    }

    expect(res.uri.fsPath).toBe("/foo/bar.properties");
    expect(res.range.start.line).toBe(3);
    expect(res.range.start.character).toBe(5);
  });

  it("異常系: ジャンプ先が見つからない場合、nullが返る", async () => {
    const text = 'log("NOT_FOUND");';
    (doc.getText as jest.Mock).mockReturnValue(text);
    (doc.offsetAt as jest.Mock).mockReturnValue(5 + 1);

    const regex = /log\("([^"]+)"\)/g;
    (utils.getCustomPatterns as jest.Mock).mockReturnValue([regex]);
    (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
      get: () => [],
    });
    (utils.findPropertyLocation as jest.Mock).mockResolvedValue(null);

    const res = await provider.provideDefinition(doc as any, position);
    expect(res).toBeNull();
  });

  it("異常系: キーマッチしてもカーソルが範囲外ならスキップされnull", async () => {
    const text = 'log("SKIP_KEY");';
    (doc.getText as jest.Mock).mockReturnValue(text);
    (doc.offsetAt as jest.Mock).mockReturnValue(1); // 範囲外

    const regex = /log\("([^"]+)"\)/g;
    (utils.getCustomPatterns as jest.Mock).mockReturnValue([regex]);
    (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
      get: () => [],
    });

    const res = await provider.provideDefinition(doc as any, position);
    expect(res).toBeNull();
    expect(utils.findPropertyLocation).not.toHaveBeenCalled();
  });

  it("異常系: キーマッチしない場合もnull", async () => {
    const text = 'foo("NO_MATCH");';
    (doc.getText as jest.Mock).mockReturnValue(text);
    (doc.offsetAt as jest.Mock).mockReturnValue(5);

    (utils.getCustomPatterns as jest.Mock).mockReturnValue([
      /log\("([^"]+)"\)/g,
    ]);
    (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
      get: () => [],
    });

    const res = await provider.provideDefinition(doc as any, position);
    expect(res).toBeNull();
    expect(utils.findPropertyLocation).not.toHaveBeenCalled();
  });
});
