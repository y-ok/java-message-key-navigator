import { strict as assert } from "assert";
import type { TextDocument, Position } from "vscode";

// ① outputChannel モック
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
const findPropertyLocation = jest.fn();
jest.mock("../src/utils", () => ({
  __esModule: true,
  getCustomPatterns,
  findPropertyLocation,
}));

// ③ vscode モック
jest.mock("vscode", () => ({
  __esModule: true,
  workspace: {
    getConfiguration: jest.fn(),
  },
  Uri: {
    file: (path: string) => ({ fsPath: path }),
  },
  Location: class {
    uri: any;
    position: any;
    constructor(uri: any, position: any) {
      this.uri = uri;
      this.position = position;
    }
  },
}));

import * as vscode from "vscode";
import { PropertiesDefinitionProvider } from "../src/DefinitionProvider";

describe("PropertiesDefinitionProvider.provideDefinition", () => {
  let provider: PropertiesDefinitionProvider;
  let doc: TextDocument;
  let pos: Position;
  let docText: string;
  let offset: number;

  beforeEach(() => {
    jest.clearAllMocks();
    provider = new PropertiesDefinitionProvider();

    // デフォルトはパターンなし
    getCustomPatterns.mockReturnValue([]);

    doc = {
      getText: () => docText,
      offsetAt: () => offset,
    } as any;
    pos = {} as any;
  });

  it("logs only the start and returns null when no patterns are configured", async () => {
    docText = `foo("anything")`;
    offset = 0;

    const result = await provider.provideDefinition(doc, pos);
    assert.strictEqual(result, null);

    const calls = appendLineSpy.mock.calls.map((c) => c[0] as string);
    // 1回だけ呼ばれていること
    assert.strictEqual(calls.length, 1, `Expected 1 call, got ${calls.length}`);
    // ログメッセージが先頭のみ一致すること
    assert.ok(
      calls[0].startsWith("🔍 Executing DefinitionProvider"),
      `Expected initial log, got: ${calls[0]}`
    );
  });

  it("returns null when cursor is outside a matching key", async () => {
    const re = /foo\("([^"]+)"\)/g;
    getCustomPatterns.mockReturnValue([re]);

    docText = `before foo("key") after`;
    offset = 1; // 範囲外

    const result = await provider.provideDefinition(doc, pos);
    assert.strictEqual(result, null);

    const calls = appendLineSpy.mock.calls.map((c) => c[0] as string);
    assert.strictEqual(calls.length, 1, `Expected 1 call, got ${calls.length}`);
    assert.ok(
      calls[0].startsWith("🔍 Executing DefinitionProvider"),
      `Expected initial log, got: ${calls[0]}`
    );
  });

  it("returns a Location and logs correctly when findPropertyLocation finds the key", async () => {
    const re = /foo\("([^"]+)"\)/g;
    getCustomPatterns.mockReturnValue([re]);
    findPropertyLocation.mockResolvedValue({
      filePath: "/path/to/file.properties",
      position: { line: 2, character: 5 },
    });

    docText = `foo("myKey")`;
    offset = docText.indexOf("myKey") + 1;

    const result = await provider.provideDefinition(doc, pos);
    assert.ok(result instanceof (vscode as any).Location);
    assert.strictEqual((result as any).uri.fsPath, "/path/to/file.properties");
    assert.deepStrictEqual((result as any).position, { line: 2, character: 5 });

    const calls = appendLineSpy.mock.calls.map((c) => c[0] as string);
    assert.strictEqual(
      calls.length,
      3,
      `Expected 3 calls, got ${calls.length}`
    );
    assert.ok(calls[0].startsWith("🔍 Executing DefinitionProvider"));
    assert.ok(calls[1].startsWith("✅ Jump target key: myKey"));
    assert.ok(
      calls[2].startsWith("🚀 Jump destination: /path/to/file.properties")
    );
  });

  it("returns null and logs not-found when findPropertyLocation returns null", async () => {
    const re = /foo\("([^"]+)"\)/g;
    getCustomPatterns.mockReturnValue([re]);
    findPropertyLocation.mockResolvedValue(null);

    docText = `foo("absent")`;
    offset = docText.indexOf("absent") + 2;

    const result = await provider.provideDefinition(doc, pos);
    assert.strictEqual(result, null);

    const calls = appendLineSpy.mock.calls.map((c) => c[0] as string);
    assert.strictEqual(
      calls.length,
      3,
      `Expected 3 calls, got ${calls.length}`
    );
    assert.ok(calls[0].startsWith("🔍 Executing DefinitionProvider"));
    assert.ok(calls[1].startsWith("✅ Jump target key: absent"));
    assert.ok(calls[2].startsWith("❌ Definition not found: absent"));
  });

  it("skips matches with empty key", async () => {
    // 空文字キャプチャ用の正規表現を返す
    const pattern = /foo\("([^"]*)"\)/g;
    getCustomPatterns.mockReturnValue([pattern]);

    // テキスト中のグループは空文字列
    docText = `foo("")`;
    offset = docText.indexOf('""') + 1;

    // findPropertyLocation は呼ばれてはいけない
    findPropertyLocation.mockClear();

    const result = await provider.provideDefinition(doc, pos);
    assert.strictEqual(result, null, "Expected null when key is empty");

    // ログは開始メッセージのみ
    const calls = appendLineSpy.mock.calls.map((c) => c[0] as string);
    assert.strictEqual(
      calls.length,
      1,
      `Expected 1 log call, got ${calls.length}`
    );
    assert.ok(
      calls[0].startsWith("🔍 Executing DefinitionProvider"),
      `Expected initial log, got: ${calls[0]}`
    );

    expect(findPropertyLocation).not.toHaveBeenCalled();
  });
});
