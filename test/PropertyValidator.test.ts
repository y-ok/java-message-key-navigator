import { strict as assert } from "assert";
import type { TextDocument, DiagnosticCollection, Uri } from "vscode";

// ① outputChannel をスパイ化
const appendLineSpy = jest.fn();
jest.mock("../src/outputChannel", () => ({
  __esModule: true,
  outputChannel: {
    appendLine: appendLineSpy,
    clear: jest.fn(),
  },
}));

// ② utils モック
const getCustomPatterns = jest.fn();
const isPropertyDefined = jest.fn();
jest.mock("../src/utils", () => ({
  __esModule: true,
  getCustomPatterns,
  isPropertyDefined,
}));

// ③ vscode モック
jest.mock("vscode", () => ({
  __esModule: true,
  Range: class {
    constructor(public start: any, public end: any) {}
  },
  Diagnostic: class {
    public code?: string;
    constructor(
      public range: any,
      public message: string,
      public severity: any
    ) {}
  },
  DiagnosticSeverity: { Warning: 1 },
}));

import * as vscode from "vscode";
import { validateProperties } from "../src/PropertyValidator";

describe("validateProperties", () => {
  let doc: TextDocument;
  let diagnostics: DiagnosticCollection;
  let captured: [Uri, any[]] | null;
  let text: string;

  beforeEach(() => {
    jest.clearAllMocks();
    captured = null;

    // デフォルト: パターンなし、全キー定義済み
    getCustomPatterns.mockReturnValue([]);
    isPropertyDefined.mockReturnValue(true);

    // ダミー Document
    doc = {
      getText: () => text,
      positionAt: (offset: number) => ({ offset }),
      uri: { fsPath: "/fake/File.java" } as any,
    } as any;

    // DiagnosticCollection の set をキャプチャ
    diagnostics = {
      set: (uri: Uri, diags: any[]) => {
        captured = [uri, diags];
      },
    } as any;
  });

  it("no patterns → no diagnostics", async () => {
    text = `whatever`;
    await validateProperties(doc, diagnostics);

    // diagnostics.set 呼び出し
    assert.ok(captured);
    const [uri, diags] = captured!;
    assert.strictEqual(uri, doc.uri);
    assert.deepStrictEqual(diags, []);

    // ログは start・starting・completed の3回
    const calls = appendLineSpy.mock.calls.map((c) => c[0] as string);
    assert.strictEqual(calls.length, 3);
    assert.ok(calls[0].startsWith("🔔 validateProperties start"));
    assert.ok(calls[1].startsWith("🔍 Starting properties validation"));
    assert.ok(
      calls[2].startsWith("✅ Properties validation completed: 0 errors")
    );
  });

  it("defined key → no diagnostics", async () => {
    // キー検出用パターン foo("key")
    getCustomPatterns.mockReturnValue([/foo\("([^"]+)"\)/g]);
    isPropertyDefined.mockReturnValue(true);

    text = `prefix foo("abc") suffix`;
    await validateProperties(doc, diagnostics);

    const [, diags] = captured!;
    assert.deepStrictEqual(diags, []);

    const calls = appendLineSpy.mock.calls.map((c) => c[0] as string);
    assert.strictEqual(calls.length, 3);
    assert.ok(calls[0].startsWith("🔔 validateProperties start"));
    assert.ok(calls[1].startsWith("🔍 Starting properties validation"));
    assert.ok(
      calls[2].startsWith("✅ Properties validation completed: 0 errors")
    );
  });

  it("undefined key → one diagnostic", async () => {
    getCustomPatterns.mockReturnValue([/bar\("([^"]+)"\)/g]);
    isPropertyDefined.mockReturnValue(false);

    text = `bar("missingKey")`;
    await validateProperties(doc, diagnostics);

    const [uri, diags] = captured!;
    assert.strictEqual(uri, doc.uri);
    assert.strictEqual(diags.length, 1);

    const diag = diags[0];
    assert.strictEqual(diag.message, "🚨 Undefined message key: 'missingKey'");
    assert.strictEqual(diag.severity, vscode.DiagnosticSeverity.Warning);
    assert.strictEqual(diag.code, "undefinedMessageKey");
    assert.deepStrictEqual(diag.range.start, {
      offset: text.indexOf("missingKey"),
    });
    assert.deepStrictEqual(diag.range.end, {
      offset: text.indexOf("missingKey") + "missingKey".length,
    });

    const calls = appendLineSpy.mock.calls.map((c) => c[0] as string);
    assert.strictEqual(calls.length, 4);
    assert.ok(calls[0].startsWith("🔔 validateProperties start"));
    assert.ok(calls[1].startsWith("🔍 Starting properties validation"));
    assert.ok(calls[2].startsWith("❌ Undefined key detected: missingKey"));
    assert.ok(
      calls[3].startsWith("✅ Properties validation completed: 1 errors")
    );
  });

  it("multiple matches → multiple diagnostics", async () => {
    getCustomPatterns.mockReturnValue([/key\("([^"]+)"\)/g]);
    // 1つめは定義済み, 2つめは未定義
    isPropertyDefined.mockImplementation((k) => k !== "undef");

    text = `key("first") key("undef")`;
    await validateProperties(doc, diagnostics);

    const [, diags] = captured!;
    assert.strictEqual(diags.length, 1);
    assert.strictEqual(diags[0].message, "🚨 Undefined message key: 'undef'");

    const calls = appendLineSpy.mock.calls.map((c) => c[0] as string);
    assert.strictEqual(calls.length, 4);
    assert.ok(calls[0].startsWith("🔔 validateProperties start"));
    assert.ok(calls[1].startsWith("🔍 Starting properties validation"));
    assert.ok(calls[2].startsWith("❌ Undefined key detected: undef"));
    assert.ok(
      calls[3].startsWith("✅ Properties validation completed: 1 errors")
    );
  });

  it("skips matches with empty key", async () => {
    // パターンは foo("") のようにキャプチャはするが空文字列
    getCustomPatterns.mockReturnValue([/foo\("([^"]*)"\)/g]);
    // isPropertyDefined は呼ばれるけれど key が空なので continue する
    isPropertyDefined.mockReturnValue(false);

    text = `prefix foo("") suffix`;
    await validateProperties(doc, diagnostics);

    // diagnostics.set には空配列が渡される
    const [uri, diags] = captured!;
    assert.strictEqual(uri, doc.uri);
    assert.deepStrictEqual(diags, []);

    const calls = appendLineSpy.mock.calls.map((c) => c[0]);
    assert.strictEqual(calls.length, 3);
    assert.strictEqual(calls[0], "🔔 validateProperties start");
    assert.strictEqual(calls[1], "🔍 Starting properties validation...");
    assert.strictEqual(calls[2], "✅ Properties validation completed: 0 errors");
  });
});
