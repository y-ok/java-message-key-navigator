import { strict as assert } from "assert";
import * as utils from "../src/utils";

jest.mock("vscode", () => {
  const actualVscode = jest.requireActual("vscode");
  return {
    __esModule: true,
    ...actualVscode,
    DiagnosticSeverity: { Warning: 1 },
    Range: class {
      start: any; end: any;
      constructor(start: any, end: any) {
        this.start = start;
        this.end = end;
      }
    },
    Diagnostic: class {
      range: any; message: string; severity: any; code: any;
      constructor(range: any, message: string, severity: any) {
        this.range = range;
        this.message = message;
        this.severity = severity;
        this.code = undefined;
      }
    }
  };
});

import * as vscode from "vscode";
import { validateProperties } from "../src/PropertyValidator";

// outputChannel のモック
jest.mock("../src/outputChannel", () => ({
  __esModule: true,
  outputChannel: { appendLine: jest.fn() }
}));

jest.mock("../src/utils", () => ({
  __esModule: true,
  loadPropertyDefinitions: jest.fn(),
  getCustomPatterns: jest.fn(),
  isPropertyDefined: jest.fn()
}));

describe("validateProperties", () => {
  let doc: any;
  let diagnostics: any;
  let seen: any[];
  let patterns: RegExp[];

  beforeEach(() => {
    seen = [];
    doc = {
      getText: jest.fn(),
      positionAt: jest.fn((offset: number) => ({ line: 0, character: offset })),
      uri: { fsPath: "/foo/Bar.java" }
    };
    diagnostics = { set: (_uri: any, diags: any[]) => seen.push(diags) };
    (utils.loadPropertyDefinitions as jest.Mock).mockClear();
    (utils.getCustomPatterns as jest.Mock).mockClear();
    (utils.isPropertyDefined as jest.Mock).mockClear();
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
    (utils.isPropertyDefined as jest.Mock).mockImplementation((key) => key !== "MISS");

    await validateProperties(doc, diagnostics, []);
    assert.strictEqual(seen.length, 1);
    assert.strictEqual(seen[0].length, 1);
    assert.ok(seen[0][0].message.includes("Undefined message key: 'MISS'"));
    assert.strictEqual(seen[0][0].code, "undefinedMessageKey");
    assert.strictEqual(seen[0][0].severity, vscode.DiagnosticSeverity.Warning);
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
