/**
 * test/HoverProvider.test.ts
 */
import { PropertiesHoverProvider } from "../src/HoverProvider";
import * as utils from "../src/utils";
import * as vscode from "vscode";
import { outputChannel } from "../src/outputChannel";

// ——— vscode API モック
jest.mock("vscode", () => {
  const actual = jest.requireActual("vscode");
  return {
    __esModule: true,
    ...actual,
    workspace: { getConfiguration: jest.fn() },
    MarkdownString: class {
      value: string;
      constructor(val: string) {
        this.value = val;
      }
    },
    Hover: class {
      contents: any[];
      constructor(contents: any) {
        this.contents = [contents];
      }
    },
    Diagnostic: class {
      constructor(
        public range: any,
        public message: string,
        public severity: any
      ) {}
    },
    DiagnosticSeverity: { Error: 0 },
    Range: class {
      constructor(public start: any, public end: any) {}
    },
  };
});

// outputChannel モック
jest.mock("../src/outputChannel", () => ({
  __esModule: true,
  outputChannel: { appendLine: jest.fn() },
}));

// ユーティリティ関数モック
jest.mock("../src/utils", () => ({
  __esModule: true,
  getCustomPatterns: jest.fn(),
  getPropertyValue: jest.fn(),
}));

describe("PropertiesHoverProvider", () => {
  let provider: PropertiesHoverProvider;
  let doc: any;
  let pos: any;

  beforeEach(() => {
    provider = new PropertiesHoverProvider();
    doc = {
      getText: jest.fn(),
      offsetAt: jest.fn(),
    };
    pos = { line: 0, character: 0 };
    (utils.getCustomPatterns as jest.Mock).mockReset();
    (utils.getPropertyValue as jest.Mock).mockReset();
  });

  it("正常系: キー上でホバーした場合にメッセージが返る", () => {
    const text = 'log("MSG_KEY");';
    doc.getText.mockReturnValue(text);
    // "MSG_KEY" の位置範囲内にいる想定
    doc.offsetAt.mockReturnValue(text.indexOf("MSG_KEY") + 2);

    // "log"関数パターンのみ返す
    (utils.getCustomPatterns as jest.Mock).mockReturnValue([
      /log\("([^"]+)"\)/g,
    ]);
    (utils.getPropertyValue as jest.Mock).mockReturnValue("Hello, World!");

    const res = provider.provideHover(doc, pos);
    expect(res).toBeInstanceOf(vscode.Hover);
    if (!res) fail();
    const md = (res as vscode.Hover).contents[0] as vscode.MarkdownString;
    expect(md.value).toBe("Hello, World!");
  });

  it("正常系: 値に=を含む場合はコードブロックで返す", () => {
    const text = 'log("EQ_KEY");';
    doc.getText.mockReturnValue(text);
    doc.offsetAt.mockReturnValue(text.indexOf("EQ_KEY") + 2);

    (utils.getCustomPatterns as jest.Mock).mockReturnValue([
      /log\("([^"]+)"\)/g,
    ]);
    (utils.getPropertyValue as jest.Mock).mockReturnValue("foo=bar");

    const res = provider.provideHover(doc, pos);
    expect(res).toBeInstanceOf(vscode.Hover);
    if (!res) fail();
    const md = (res as vscode.Hover).contents[0] as vscode.MarkdownString;
    expect(md.value).toMatch(/^```[\s\S]+```$/);
  });

  it("異常系: 対象範囲外ならhoverは返らない", () => {
    const text = 'log("NO_KEY");';
    doc.getText.mockReturnValue(text);
    // "NO_KEY"の外側（0）を指定
    doc.offsetAt.mockReturnValue(0);

    (utils.getCustomPatterns as jest.Mock).mockReturnValue([
      /log\("([^"]+)"\)/g,
    ]);
    (utils.getPropertyValue as jest.Mock).mockReturnValue("何も返さない");

    const res = provider.provideHover(doc, pos);
    expect(res).toBeUndefined();
  });

  it("異常系: キーが取得できない場合hoverを返さない", () => {
    const text = 'log("");';
    doc.getText.mockReturnValue(text);
    doc.offsetAt.mockReturnValue(text.indexOf('""') + 1);

    (utils.getCustomPatterns as jest.Mock).mockReturnValue([
      /log\("([^"]*)"\)/g,
    ]);
    (utils.getPropertyValue as jest.Mock).mockReturnValue(undefined);

    const res = provider.provideHover(doc, pos);
    expect(res).toBeUndefined();
  });

  it("異常系: すでにprocessedKeysに含まれるキーでも常にHoverが返る", () => {
    const text = 'log("DUP_KEY");log("DUP_KEY");';
    doc.getText.mockReturnValue(text);
    doc.offsetAt.mockReturnValue(text.indexOf("DUP_KEY") + 2);

    (utils.getCustomPatterns as jest.Mock).mockReturnValue([
      /log\("([^"]+)"\)/g,
    ]);
    (utils.getPropertyValue as jest.Mock)
      .mockReturnValueOnce("message1")
      .mockReturnValueOnce("message2");

    // 1回目
    const first = provider.provideHover(doc, pos);
    expect(first).toBeInstanceOf(vscode.Hover);

    // 2回目もHoverが返る
    const second = provider.provideHover(doc, pos);
    expect(second).toBeInstanceOf(vscode.Hover);
  });

  describe("LogStartEndアノテーション対応", () => {
    const text = '@LogStartEnd(start="S", end="E", exception="X")';
    beforeEach(() => {
      // LogStartEnd用の正規表現を返す
      (utils.getCustomPatterns as jest.Mock).mockReturnValue([
        /@LogStartEnd\(\s*start="([^"]+)"\s*,\s*end="([^"]+)"\s*,\s*exception="([^"]+)"\s*\)/g,
      ]);
      // プロパティサービスのモック
      (utils.getPropertyValue as jest.Mock).mockImplementation(
        (key: string) => {
          switch (key) {
            case "S":
              return "Start Message";
            case "E":
              return "End Message";
            case "X":
              return "Exception Message";
            default:
              return undefined;
          }
        }
      );
      doc.getText.mockReturnValue(text);
    });

    it("start属性にホバーすると対応メッセージが返る", () => {
      doc.offsetAt.mockReturnValue(text.indexOf("S") + 1);
      const res = provider.provideHover(doc, pos);
      expect(res).toBeInstanceOf(vscode.Hover);
      const md = (res as vscode.Hover).contents[0] as vscode.MarkdownString;
      expect(md.value).toBe("Start Message");
    });

    it("end属性にホバーすると対応メッセージが返る", () => {
      doc.offsetAt.mockReturnValue(text.indexOf("E") + 1);
      const res = provider.provideHover(doc, pos);
      expect(res).toBeInstanceOf(vscode.Hover);
      const md = (res as vscode.Hover).contents[0] as vscode.MarkdownString;
      expect(md.value).toBe("End Message");
    });

    it("exception属性にホバーすると対応メッセージが返る", () => {
      doc.offsetAt.mockReturnValue(text.indexOf("X") + 1);
      const res = provider.provideHover(doc, pos);
      expect(res).toBeInstanceOf(vscode.Hover);
      const md = (res as vscode.Hover).contents[0] as vscode.MarkdownString;
      expect(md.value).toBe("Exception Message");
    });
  });

  describe("PropertiesHoverProvider – value falsy スキップ", () => {
    let provider: PropertiesHoverProvider;
    let doc: any;
    const pos = { line: 0, character: 1 } as vscode.Position;

    beforeEach(() => {
      jest.clearAllMocks();
      provider = new PropertiesHoverProvider();
      doc = {
        getText: jest.fn().mockReturnValue('log("SKIP_KEY");'),
        offsetAt: jest.fn().mockReturnValue(5), // 範囲内
        uri: { fsPath: "/foo/Bar.java" },
      } as any;
      // まずは log("KEY") パターン
      (utils.getCustomPatterns as jest.Mock).mockReturnValue([
        /log\("([^"]+)"\)/g,
      ]);
    });

    it("getPropertyValue が undefined のときは Displaying hover message を出さない", () => {
      (utils.getPropertyValue as jest.Mock).mockReturnValue(undefined);

      const res = provider.provideHover(doc, pos);
      expect(res).toBeUndefined();

      const logs = (outputChannel.appendLine as jest.Mock).mock.calls.map(
        ([msg]: [string]) => msg
      );
      expect(logs[0]).toContain("✅ Hover target key: SKIP_KEY");
      // 「📢 Displaying hover message」は含まれない
      expect(logs.some((l) => l.includes("📢 Displaying hover message"))).toBe(
        false
      );
    });

    it('getPropertyValue が空文字列 "" のときも Displaying hover message を出さない', () => {
      (utils.getPropertyValue as jest.Mock).mockReturnValue("");

      const res = provider.provideHover(doc, pos);
      expect(res).toBeUndefined();

      const logs = (outputChannel.appendLine as jest.Mock).mock.calls.map(
        ([msg]: [string]) => msg
      );
      expect(logs[0]).toContain("✅ Hover target key: SKIP_KEY");
      expect(logs).not.toEqual(
        expect.arrayContaining([
          expect.stringContaining("📢 Displaying hover message"),
        ])
      );
    });
  });
});
