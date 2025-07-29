/**
 * test/diagnostic.test.ts
 */
import { strict as assert } from "assert";

// ——— outputChannel モック（呼ばれないが import 必須）
jest.mock("../src/outputChannel", () => ({
  __esModule: true,
  outputChannel: { appendLine: jest.fn(), clear: jest.fn() },
}));

// ——— getMessageValueForKey をモック
const getMessageValueForKey = jest.fn();
jest.mock("../src/utils", () => ({ __esModule: true, getMessageValueForKey }));

// ——— vscode API モック
jest.mock("vscode", () => ({
  __esModule: true,
  workspace: { getConfiguration: jest.fn() },
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
}));

import * as vscode from "vscode";
import type { TextDocument, DiagnosticCollection } from "vscode";
import { validatePlaceholders } from "../src/diagnostic";

describe("validatePlaceholders", () => {
  let doc: TextDocument;
  let collection: DiagnosticCollection;
  let seen: any[][];
  let text: string;
  let offset: number;
  let patterns: string[];

  beforeEach(() => {
    jest.clearAllMocks();
    seen = [];

    doc = {
      languageId: "java",
      getText: () => text,
      offsetAt: (_: any) => offset,
      positionAt: (off: number) => ({
        line: 0,
        character: off,
        translate: (_l: number, c: number) => ({ line: 0, character: off + c }),
      }),
      uri: { fsPath: "/fake/Doc.java" },
    } as any;

    collection = {
      set: (_uri: any, diags: any[]) => seen.push(diags),
    } as any;

    (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
      get: (_key: string, _def: any) => patterns,
    });
  });

  it("does nothing when languageId isn't java", async () => {
    (doc as any).languageId = "xml";
    text = `foo("k",{0})`;
    offset = 0;
    patterns = [];

    await validatePlaceholders(doc, collection);
    assert.deepStrictEqual(seen, []);
  });

  it("reports error when arg count mismatches placeholder count", async () => {
    patterns = ["foo"];
    text = `foo("key", x)`;
    offset = 0;
    getMessageValueForKey.mockResolvedValue("Hello {0}, bye {1}");

    await validatePlaceholders(doc, collection);
    assert.strictEqual(seen.length, 1);
    assert.strictEqual(seen[0].length, 1);
    const diag = seen[0][0];
    const expectedOffset = text.indexOf("key");
    assert.strictEqual(diag.range.start.character, expectedOffset);
    assert.strictEqual(
      diag.message,
      "⚠️ Placeholder count (2) doesn’t match provided argument count (1)."
    );
    assert.strictEqual(diag.severity, vscode.DiagnosticSeverity.Error);
  });

  it("no diagnostic when arg count matches placeholder count", async () => {
    patterns = ["foo"];
    text = `foo("key", a, b)`;
    offset = 0;
    getMessageValueForKey.mockResolvedValue("A {0}, B {1}");

    await validatePlaceholders(doc, collection);
    assert.strictEqual(seen.length, 1);
    assert.strictEqual(seen[0].length, 0);
  });

  it("skips when getMessageValueForKey returns undefined", async () => {
    patterns = ["foo"];
    text = `foo("key")`;
    getMessageValueForKey.mockResolvedValue(undefined);

    await validatePlaceholders(doc, collection);
    assert.deepStrictEqual(seen, [[]]);
  });

  it("handles varargs when no array literal present", async () => {
    patterns = ["foo"];
    text = `foo("key", arg1, arg2)`;
    getMessageValueForKey.mockResolvedValue("value{0}{1}");

    await validatePlaceholders(doc, collection);
    assert.deepStrictEqual(seen, [[]]);
  });

  it("reports error when varargs count mismatch", async () => {
    patterns = ["foo"];
    text = `foo("key", a1, a2)`;
    getMessageValueForKey.mockResolvedValue("v{0}{1}{2}");

    await validatePlaceholders(doc, collection);
    assert.strictEqual(seen.length, 1);
    assert.strictEqual(seen[0].length, 1);
    assert.ok(seen[0][0].message.includes("provided argument count"));
  });

  it("counts elements inside array literal", async () => {
    patterns = ["foo"];
    text = `foo("key", new String[] { x, y, z })`;
    getMessageValueForKey.mockResolvedValue("m{0}{1}");

    await validatePlaceholders(doc, collection);
    assert.strictEqual(seen.length, 1);
    assert.strictEqual(seen[0].length, 1);
    assert.ok(seen[0][0].message.includes("argument count (3)"));
  });

  it("プレースホルダーなし・引数なしの場合は診断されないこと", async () => {
    patterns = ["log"];
    text = `log("MSG")`;
    getMessageValueForKey.mockResolvedValue("Hello");

    await validatePlaceholders(doc, collection);
    assert.strictEqual(seen.length, 1);
    assert.strictEqual(seen[0].length, 0);
  });

  it("プレースホルダー1個・引数1個で一致する場合は診断されないこと", async () => {
    patterns = ["log"];
    text = `log("MSG", new Object[] { "A" })`;
    getMessageValueForKey.mockResolvedValue("Hi {0}");

    await validatePlaceholders(doc, collection);
    assert.strictEqual(seen.length, 1);
    assert.strictEqual(seen[0].length, 0);
  });

  it("プレースホルダー2個・引数1個で不足している場合はエラーになること", async () => {
    patterns = ["log"];
    text = `log("MSG", new Object[] { "A" })`;
    getMessageValueForKey.mockResolvedValue("Hi {0} {1}");

    await validatePlaceholders(doc, collection);
    assert.strictEqual(seen.length, 1);
    assert.strictEqual(seen[0].length, 1);
    expect(seen[0][0].message).toMatch(/Placeholder count|argument count/);
  });

  it("プレースホルダーなし・引数1個で過剰な場合はエラーになること", async () => {
    patterns = ["log"];
    text = `log("MSG", new Object[] { "A" })`;
    getMessageValueForKey.mockResolvedValue("Hi");

    await validatePlaceholders(doc, collection);
    assert.strictEqual(seen.length, 1);
    assert.strictEqual(seen[0].length, 1);
    expect(seen[0][0].message).toMatch(/Placeholder count|argument count/);
  });

  it("プレースホルダー2個・引数2個で一致する場合は診断されないこと", async () => {
    patterns = ["log"];
    text = `log("MSG", new Object[] { "A", "B" })`;
    getMessageValueForKey.mockResolvedValue("Hi {0} {1}");

    await validatePlaceholders(doc, collection);
    assert.strictEqual(seen.length, 1);
    assert.strictEqual(seen[0].length, 0);
  });

  it("varargs形式で引数数が一致する場合は診断されないこと", async () => {
    patterns = ["log"];
    text = `log("MSG", "A", "B")`;
    getMessageValueForKey.mockResolvedValue("A {0}, B {1}");

    await validatePlaceholders(doc, collection);
    assert.strictEqual(seen.length, 1);
    assert.strictEqual(seen[0].length, 0);
  });

  it("varargs形式で引数が多すぎる場合はエラーになること", async () => {
    patterns = ["log"];
    text = `log("MSG", "A", "B")`;
    getMessageValueForKey.mockResolvedValue("Hi {0}");

    await validatePlaceholders(doc, collection);
    assert.strictEqual(seen.length, 1);
    assert.strictEqual(seen[0].length, 1);
    expect(seen[0][0].message).toMatch(/Placeholder count|argument count/);
  });

  it("join() を使った配列初期化（プレースホルダー2個・引数1個）では診断されないこと", async () => {
    patterns = ["log"];
    text = `log("MSG", new Object[] { task.join(",") })`;
    getMessageValueForKey.mockResolvedValue("Hi {0} {1}");

    await validatePlaceholders(doc, collection);
    assert.strictEqual(seen.length, 1);
    assert.strictEqual(seen[0].length, 0); // OK
  });

  it("join() と別引数を含む配列（プレースホルダー1個）では不一致としてエラーになること", async () => {
    patterns = ["log"];
    text = `log("MSG", new Object[] { task.join(","), "xxx" })`;
    getMessageValueForKey.mockResolvedValue("Hi {0}");

    await validatePlaceholders(doc, collection);
    assert.strictEqual(seen.length, 1);
    assert.strictEqual(seen[0].length, 1); // NG
    expect(seen[0][0].message).toMatch(/Placeholder count.*argument count/);
  });

  it("join() のみ含む配列（プレースホルダー0個）では診断されないこと", async () => {
    patterns = ["log"];
    text = `log("MSG", new Object[] { task.join(",") })`;
    getMessageValueForKey.mockResolvedValue("Hello"); // no placeholder

    await validatePlaceholders(doc, collection);
    assert.strictEqual(seen.length, 1);
    assert.strictEqual(seen[0].length, 0); // OK
  });

  it("文字列リテラル内のカンマが分割されず、プレースホルダー1個と一致すること", async () => {
    patterns = ["log"];
    text = `log("MSG", new Object[] { "a,b,c" })`;
    getMessageValueForKey.mockResolvedValue("Hi {0}");

    await validatePlaceholders(doc, collection);
    assert.strictEqual(seen[0].length, 0); // OK
  });

  it("配列内の値にコメントがあってもプレースホルダー評価に影響しないこと", async () => {
    patterns = ["log"];
    text = `log("MSG", new Object[] { "A /* comment */" })`;
    getMessageValueForKey.mockResolvedValue("Hi {0}");

    await validatePlaceholders(doc, collection);
    assert.strictEqual(seen.length, 1);
    assert.strictEqual(seen[0].length, 0);
  });

  it("プレースホルダーが不連続（{2}）で必要引数数が3となる場合、引数2個ではエラーになること", async () => {
    patterns = ["log"];
    text = `log("MSG", new Object[] { "A", "B" })`;
    getMessageValueForKey.mockResolvedValue("Hi {2}");

    await validatePlaceholders(doc, collection);

    const messages = seen.flat().map((d) => d.message);

    // どちらのエラーも含まれているか確認
    expect(messages.some((m) => /プレースホルダー.*\{2\}/.test(m))).toBe(true);
    expect(
      messages.some((m) => /Placeholder count.*argument count/.test(m))
    ).toBe(true);
  });

  it("エスケープされた波括弧（\\{notReal\\}）はプレースホルダーとみなされず診断されないこと", async () => {
    patterns = ["log"];
    text = `log("MSG", new Object[] { "A" })`;
    getMessageValueForKey.mockResolvedValue("Hi \\{notReal\\} {0}");

    await validatePlaceholders(doc, collection);
    assert.strictEqual(seen.length, 1);
    assert.strictEqual(seen[0].length, 0);
  });

  it("プレースホルダーあり・引数なし（空配列）の場合は不足としてエラーになること", async () => {
    patterns = ["log"];
    text = `log("MSG", new Object[] {})`;
    getMessageValueForKey.mockResolvedValue("Hi {0}");

    await validatePlaceholders(doc, collection);
    assert.strictEqual(seen.length, 1);
    assert.strictEqual(seen[0].length, 1);
    expect(seen[0][0].message).toMatch(/Placeholder count|argument count/);
  });

  it("配列初期化の前にブロックコメントがあっても正しく解析され診断されないこと", async () => {
    patterns = ["log"];
    text = `log("MSG", /* コメント */ new Object[] { "A" })`;
    getMessageValueForKey.mockResolvedValue("Hi {0}");

    await validatePlaceholders(doc, collection);
    assert.strictEqual(seen.length, 1);
    assert.strictEqual(seen[0].length, 0);
  });

  it("プレースホルダー2個に対して引数が3個ある場合は過剰としてエラーになること", async () => {
    patterns = ["log"];
    text = `log("MSG", new Object[] { a, b, c })`;
    getMessageValueForKey.mockResolvedValue("Hi {0} {1}");

    await validatePlaceholders(doc, collection);
    assert.strictEqual(seen.length, 1);
    assert.strictEqual(seen[0].length, 1);
    expect(seen[0][0].message).toMatch(/Placeholder count|argument count/);
  });

  // バックスラッシュ→次の文字をエスケープとして扱うロジックをカバー
  it("文字列リテラル内のエスケープされた引用符を含む場合でも1要素として扱われること", async () => {
    patterns = ["log"];
    // \" を含む文字列リテラルを配列に１つだけ渡す
    text = `log("MSG", new Object[] { "He said \\\"Hello\\\"" })`;
    // プレースホルダーは1個
    getMessageValueForKey.mockResolvedValue("Hi {0}");

    await validatePlaceholders(doc, collection);
    // 1要素とみなされるので診断はゼロ
    assert.strictEqual(seen.length, 1);
    assert.strictEqual(seen[0].length, 0);
  });

  // join()だけを含むときは expectedArgCount をそのまま使うロジックをカバー
  it("join() のみ含む配列リテラルは expectedArgCount と同じ要素数とみなされること", async () => {
    patterns = ["log"];
    // join() を含む式を配列に１つだけ渡す
    text = `log("MSG", new Object[] { taskList.join(\",\") })`;
    // プレースホルダーは2個（{0},{1}）
    getMessageValueForKey.mockResolvedValue("Value {0}, again {1}");

    await validatePlaceholders(doc, collection);
    // 設定された expectedArgCount(2) をそのままactualArgCountとみなすので診断はゼロ
    assert.strictEqual(seen.length, 1);
    assert.strictEqual(seen[0].length, 0);
  });

  it("varargs で join() のみを渡した場合は expectedArgCount と同じ要素数とみなされ診断されないこと", async () => {
    patterns = ["log"];
    // 配列リテラルではなく varargs 形式で join() のみ
    text = `log("MSG", taskList.join(","))`;
    // プレースホルダー 2 個 ({0},{1}) と想定
    getMessageValueForKey.mockResolvedValue("Hello {0}, world {1}");

    await validatePlaceholders(doc, collection);
    // ⭐️ actualArgCount = expectedArgCount ブランチが走るので診断なし
    assert.strictEqual(seen.length, 1);
    assert.strictEqual(seen[0].length, 0);
  });

  it("引数がまったくない場合は診断されないこと", async () => {
    // infrastructureLogger.log のケースも含めて
    patterns = ["log"];
    text = `infrastructureLogger.log("PLF1003");`;
    // .properties の値にプレースホルダーがなくても（またはあっても）、引数なしはスキップ
    getMessageValueForKey.mockResolvedValue("直前の実行時刻: なし（初回実行）");

    await validatePlaceholders(doc, collection);
    // collection.set は呼ばれているが、診断リストは空
    assert.strictEqual(seen.length, 1);
    assert.strictEqual(seen[0].length, 0);
  });

  it("引数が存在しない場合（parts.length === 0）はスキップされる", async () => {
    // 1) 準備: Java ドキュメント、パターン "foo"
    patterns = ["foo"];
    text = `foo()`; // 引数リストが空 → argString === "" → safeSplit() は []
    offset = 0;

    // 2) getMessageValue は返しても返さなくても良い（parts.length===0 で先に continue）
    getMessageValueForKey.mockResolvedValue("Value {0}");

    // 3) 実行
    await validatePlaceholders(doc, collection);

    // 4) 検証: diagnostics は空配列が1回セットされるだけ
    assert.strictEqual(seen.length, 1);
    assert.strictEqual(seen[0].length, 0);
  });

  function getDiagnosticMessages(): string[] {
    return seen.flat().map((d) => d.message);
  }

  it("プレースホルダーが {0} から始まらない場合は診断されること", async () => {
    patterns = ["log"];
    text = `log("MSG", "A")`;
    getMessageValueForKey.mockResolvedValue("Hello {1}");

    await validatePlaceholders(doc, collection);

    const messages = getDiagnosticMessages();
    expect(messages.length).toBeGreaterThanOrEqual(1);
    expect(messages.some((m) => /プレースホルダー.*\{1\}/.test(m))).toBe(true);
  });

  it("プレースホルダーが連番でない場合（飛び番号）に診断されること", async () => {
    patterns = ["log"];
    text = `log("MSG", "A", "B", "C")`;
    getMessageValueForKey.mockResolvedValue("Hi {0} {2}");

    await validatePlaceholders(doc, collection);

    const messages = getDiagnosticMessages();
    expect(messages.length).toBeGreaterThanOrEqual(1);
    expect(messages.some((m) => /プレースホルダー.*\{0\}.*\{2\}/.test(m))).toBe(
      true
    );
  });

  it("プレースホルダーが {2}, {3}, {5} のように連続しない場合に診断されること", async () => {
    patterns = ["log"];
    text = `log("MSG", "A", "B", "C", "D", "E")`;
    getMessageValueForKey.mockResolvedValue("X {2} Y {3} Z {5}");

    await validatePlaceholders(doc, collection);

    const messages = getDiagnosticMessages();
    expect(messages.length).toBeGreaterThanOrEqual(1);
    expect(messages.some((m) => /プレースホルダー.*\{2\}.*\{5\}/.test(m))).toBe(
      true
    );
  });
});
