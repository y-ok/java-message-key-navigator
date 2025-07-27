import { strict as assert } from "assert";
import type { TextDocument, Position, Hover } from "vscode";

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
const getPropertyValue = jest.fn();
jest.mock("../src/utils", () => ({
  __esModule: true,
  getCustomPatterns,
  getPropertyValue,
}));

// ③ vscode モック（Hover と MarkdownString だけ実装）
jest.mock("vscode", () => ({
  __esModule: true,
  Hover: class {
    contents: any;
    constructor(contents: any) {
      this.contents = contents;
    }
  },
  MarkdownString: class {
    value: string;
    constructor(v: string) { this.value = v; }
  },
}));

import { PropertiesHoverProvider } from "../src/HoverProvider";

describe("PropertiesHoverProvider.provideHover", () => {
  let provider: PropertiesHoverProvider;
  let doc: TextDocument;
  let pos: Position;
  let text: string;
  let offset: number;

  beforeEach(() => {
    jest.clearAllMocks();
    provider = new PropertiesHoverProvider();
    doc = {
      getText: () => text,
      offsetAt: () => offset,
    } as any;
    pos = {} as any;
  });

  it("returns undefined and logs start when no patterns", () => {
    getCustomPatterns.mockReturnValue([]);
    text = "anything";
    offset = 0;

    const result = provider.provideHover(doc, pos);
    assert.strictEqual(result, undefined);

    const calls = appendLineSpy.mock.calls.map((c) => c[0]);
    assert.strictEqual(calls.length, 1);
    assert.ok(calls[0].startsWith("🔍 Executing hover operation"));
  });

  it("returns undefined when no regex match", () => {
    const re = /foo\("([^"]+)"\)/g;
    getCustomPatterns.mockReturnValue([re]);
    text = `bar("key")`;
    offset = text.indexOf("key") + 1;

    const result = provider.provideHover(doc, pos);
    assert.strictEqual(result, undefined);

    const calls = appendLineSpy.mock.calls.map((c) => c[0]);
    assert.strictEqual(calls.length, 1);
    assert.ok(calls[0].startsWith("🔍 Executing hover operation"));
  });

  it("returns undefined and logs target when value missing", () => {
    const re = /foo\("([^"]+)"\)/g;
    getCustomPatterns.mockReturnValue([re]);
    getPropertyValue.mockReturnValue(undefined);
    text = `foo("key")`;
    offset = text.indexOf("key") + 1;

    const result = provider.provideHover(doc, pos);
    assert.strictEqual(result, undefined);

    const calls = appendLineSpy.mock.calls.map((c) => c[0]);
    // start + target
    assert.strictEqual(calls.length, 2);
    assert.ok(calls[1].startsWith("✅ Hover target key: key"));
  });

  it("returns a Hover when value present without '='", () => {
    const re = /foo\("([^"]+)"\)/g;
    getCustomPatterns.mockReturnValue([re]);
    getPropertyValue.mockReturnValue("simple");
    text = `foo("key")`;
    offset = text.indexOf("key") + 1;

    const hover = provider.provideHover(doc, pos) as Hover;
    assert.ok(hover instanceof (require("vscode") as any).Hover);
    assert.strictEqual((hover.contents as any).value, "simple");

    const calls = appendLineSpy.mock.calls.map((c) => c[0]);
    assert.strictEqual(calls.length, 3);
    assert.ok(calls[2].startsWith("📢 Displaying hover message"));
  });

  it("wraps value in code block when it contains '='", () => {
    const re = /foo\("([^"]+)"\)/g;
    getCustomPatterns.mockReturnValue([re]);
    getPropertyValue.mockReturnValue("a=b=c");
    text = `foo("key")`;
    offset = text.indexOf("key") + 1;

    const hover = provider.provideHover(doc, pos) as Hover;
    assert.strictEqual((hover.contents as any).value, "```\na=b=c\n```");

    const calls = appendLineSpy.mock.calls.map((c) => c[0]);
    assert.strictEqual(calls.length, 3);
  });

  it("does not re-process the same key twice", () => {
    const re = /foo\("([^"]+)"\)/g;
    getCustomPatterns.mockReturnValue([re]);
    getPropertyValue.mockReturnValue("val");
    text = `foo("key") foo("key")`;
    
    // first occurrence
    offset = text.indexOf("key") + 1;
    provider.provideHover(doc, pos);
    // second occurrence
    offset = text.lastIndexOf("key") + 1;
    provider.provideHover(doc, pos);

    const targetLogs = appendLineSpy
      .mock.calls
      .map((c) => c[0])
      .filter((msg) => msg.startsWith("✅ Hover target key"));
    // 最初の一度だけ
    assert.strictEqual(targetLogs.length, 1);
  });
});
