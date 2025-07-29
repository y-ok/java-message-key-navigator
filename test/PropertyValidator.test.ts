/**
 * test/PropertyValidator.test.ts
 */
import { strict as assert } from "assert";
import * as utils from "../src/utils";
import { validateProperties, validateMessagePlaceholders } from "../src/PropertyValidator";
import { Range, DiagnosticSeverity } from 'vscode';

const dummyRange: Range = {
  start: { line: 0, character: 0 },
  end: { line: 0, character: 10 }
} as Range;

// vscode API を丸ごとモック化
jest.mock("vscode", () => {
  const actual = jest.requireActual("vscode");
  return {
    __esModule: true,
    ...actual,
    // DiagnosticSeverity のモック
    DiagnosticSeverity: { Warning: 1 },
    // Position, Range, Diagnostic をコンストラクタとしてモック実装
    Position: class {
      constructor(public line: number, public character: number) {}
    },
    Range: class {
      constructor(public start: any, public end: any) {}
    },
    Diagnostic: class {
      public code: any;
      constructor(
        public range: any,
        public message: string,
        public severity: any
      ) {
        this.code = undefined;
      }
    },
  };
});
import * as vscode from "vscode";

// outputChannel モック
jest.mock("../src/outputChannel", () => ({
  __esModule: true,
  outputChannel: { appendLine: jest.fn() },
}));

describe("validateProperties (utils 経由の基本動作)", () => {
  let doc: any;
  let diagnostics: any;
  let seen: any[];
  let patterns: RegExp[];

  beforeEach(() => {
    seen = [];
    doc = {
      getText: jest.fn(),
      positionAt: jest.fn((offset: number) => ({ line: 0, character: offset })),
      uri: { fsPath: "/foo/Bar.java" },
    };
    diagnostics = { set: (_uri: any, diags: any[]) => seen.push(diags) };
    jest.spyOn(utils, "loadPropertyDefinitions").mockResolvedValue(undefined);
    jest.spyOn(utils, "getCustomPatterns").mockClear();
    jest.spyOn(utils, "isPropertyDefined").mockClear();
  });

  it("全て定義済みキーのみの場合は警告なし", async () => {
    const text = 'log("KEY1"); log("KEY2");';
    patterns = [/log\("([^"]+)"\)/g];
    doc.getText.mockReturnValue(text);
    (utils.getCustomPatterns as jest.Mock).mockReturnValue(patterns);
    (utils.isPropertyDefined as jest.Mock).mockReturnValue(true);

    await validateProperties(doc, diagnostics, ["foo"]);
    assert.strictEqual(seen.length, 1);
    assert.strictEqual(seen[0].length, 0);
  });

  it("定義されていないキーがある場合は警告が出る", async () => {
    const text = 'log("HIT"); log("MISS");';
    patterns = [/log\("([^"]+)"\)/g];
    doc.getText.mockReturnValue(text);
    (utils.getCustomPatterns as jest.Mock).mockReturnValue(patterns);
    (utils.isPropertyDefined as jest.Mock).mockImplementation(
      (key) => key !== "MISS"
    );

    await validateProperties(doc, diagnostics, []);
    assert.strictEqual(seen.length, 1);
    assert.strictEqual(seen[0].length, 1);
    const diag = seen[0][0];
    assert.ok(diag.message.includes("Undefined message key: 'MISS'"));
    assert.strictEqual(diag.code, "undefinedMessageKey");
    assert.strictEqual(diag.severity, vscode.DiagnosticSeverity.Warning);
  });

  it("空文字キーはスキップされる", async () => {
    const text = 'log("");';
    patterns = [/log\("([^"]*)"\)/g];
    doc.getText.mockReturnValue(text);
    (utils.getCustomPatterns as jest.Mock).mockReturnValue(patterns);

    await validateProperties(doc, diagnostics, []);
    assert.strictEqual(seen.length, 1);
    assert.strictEqual(seen[0].length, 0);
  });

  it("パターンにマッチしない場合は診断なし", async () => {
    const text = 'System.out.println("Hello");';
    patterns = [/log\("([^"]+)"\)/g];
    doc.getText.mockReturnValue(text);
    (utils.getCustomPatterns as jest.Mock).mockReturnValue(patterns);

    await validateProperties(doc, diagnostics, []);
    assert.strictEqual(seen.length, 1);
    assert.strictEqual(seen[0].length, 0);
  });
});

describe("validateProperties の分岐カバー (PropertyValidator.ts)", () => {
  const dummyUri = { toString: () => "dummy" } as any;
  const makeDoc = (text: string): vscode.TextDocument =>
    ({
      getText: () => text,
      positionAt: (offset: number) => new vscode.Position(0, offset),
      uri: dummyUri,
    } as any);

  let diagnostics: vscode.DiagnosticCollection;

  beforeEach(() => {
    // 依存 utils をスパイして副作用を抑制
    jest.spyOn(utils, "loadPropertyDefinitions").mockResolvedValue(undefined);
    jest
      .spyOn(utils, "getCustomPatterns")
      .mockReturnValue([/messageSource\.getMessage\(\s*['"]([^'"]*)['"]/g]);
    diagnostics = { set: jest.fn() } as any;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("空文字キー（''）のときは continue される", async () => {
    const doc = makeDoc(`foo(); messageSource.getMessage('') ; bar();`);
    await validateProperties(doc, diagnostics);
    // 空文字はスキップなのでエラーなし
    expect(diagnostics.set).toHaveBeenCalledWith(dummyUri, []);
  });

  it("isPropertyDefined が true を返したら undefinedMessageKey 分岐を通らない", async () => {
    const key = "EXISTING";
    jest.spyOn(utils, "isPropertyDefined").mockReturnValue(true);

    const doc = makeDoc(`messageSource.getMessage('${key}')`);
    await validateProperties(doc, diagnostics);

    // 定義済みなのでエラーなし
    expect(diagnostics.set).toHaveBeenCalledWith(dummyUri, []);
  });

  it("isPropertyDefined が false を返したら undefinedMessageKey 分岐を通る", async () => {
    const key = "MISSING";
    jest.spyOn(utils, "isPropertyDefined").mockReturnValue(false);

    const doc = makeDoc(`messageSource.getMessage('${key}')`);
    await validateProperties(doc, diagnostics);

    // エラーが 1 件レポートされる
    const calls = (diagnostics.set as jest.Mock).mock.calls;
    expect(calls).toHaveLength(1);
    // calls[0] は [uri, diagnosticsArray]
    const [, diags] = calls[0];
    expect(Array.isArray(diags)).toBe(true);
    expect(diags).toHaveLength(1);
    expect(diags[0].message).toMatch(/Undefined message key: 'MISSING'/);
    expect(diags[0].code).toBe("undefinedMessageKey");
    expect(diags[0].severity).toBe(vscode.DiagnosticSeverity.Warning);
  });
});

describe('validateMessagePlaceholders', () => {
  it('プレースホルダーが存在しない場合は null を返す', () => {
    const result = validateMessagePlaceholders('key1', 'This is a message.', dummyRange);
    expect(result).toBeNull();
  });

  it('{0} から始まり連番の場合は null を返す', () => {
    const result = validateMessagePlaceholders('key2', 'Hello {0}, your ID is {1}.', dummyRange);
    expect(result).toBeNull();
  });

  it('{1} のみが存在する場合はエラーを返す', () => {
    const result = validateMessagePlaceholders('key3', 'Hello {1}', dummyRange);
    expect(result).not.toBeNull();
    expect(result?.severity).toBe(DiagnosticSeverity.Error);
    expect(result?.message).toContain('{1}');
  });

  it('{0}, {2} のように不連続な場合はエラーを返す', () => {
    const result = validateMessagePlaceholders('key4', 'Value: {0}, {2}', dummyRange);
    expect(result).not.toBeNull();
    expect(result?.message).toContain('{0}');
    expect(result?.message).toContain('{2}');
  });

  it('{1}, {2}, {3} のように {0} が無い場合はエラーを返す', () => {
    const result = validateMessagePlaceholders('key5', 'Text: {1}, {2}, {3}', dummyRange);
    expect(result).not.toBeNull();
    expect(result?.message).toContain('{1}');
    expect(result?.message).toContain('{3}');
  });

  it('{0}, {1}, {3} のように途中が抜けている場合はエラーを返す', () => {
    const result = validateMessagePlaceholders('key6', 'Info: {0}, {1}, {3}', dummyRange);
    expect(result).not.toBeNull();
    expect(result?.message).toContain('{3}');
  });
});
