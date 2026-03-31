/**
 * test/diagnostic.test.ts
 */
import { strict as assert } from "assert";

const executeCommand = jest.fn();
const openTextDocument = jest.fn();

// ——— outputChannel モック（呼ばれないが import 必須）
jest.mock("../src/outputChannel", () => ({
  __esModule: true,
  outputChannel: { appendLine: jest.fn(), clear: jest.fn() },
}));

// ——— getMessageValueForKey をモック
const getMessageValueForKey = jest.fn();
const getAllPropertyKeys = jest.fn();
jest.mock("../src/utils", () => ({
  __esModule: true,
  getMessageValueForKey,
  getAllPropertyKeys,
}));

const inferMethodPatterns = jest.fn();
jest.mock("../src/inference", () => ({
  __esModule: true,
  inferMethodPatterns,
  parseCallLikeArg: jest.requireActual("../src/inference").parseCallLikeArg,
}));

// ——— vscode API モック
jest.mock("vscode", () => ({
  __esModule: true,
  workspace: { getConfiguration: jest.fn(), openTextDocument },
  commands: { executeCommand },
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
  Position: class {
    constructor(public line: number, public character: number) {}
  },
}));

import * as vscode from "vscode";
import type { TextDocument, DiagnosticCollection } from "vscode";
import { validatePlaceholders } from "../src/diagnostic";

function findIdentifierAtOffset(source: string, offset: number): string | null {
  if (offset < 0 || offset >= source.length) {
    return null;
  }

  const isIdentChar = (ch: string) => /[A-Za-z0-9_$]/.test(ch);
  let start = offset;
  while (start > 0 && isIdentChar(source[start - 1])) {
    start--;
  }

  let end = offset;
  while (end < source.length && isIdentChar(source[end])) {
    end++;
  }

  const ident = source.slice(start, end);
  return ident || null;
}

function isThrowableLikeIdentifier(name: string): boolean {
  return /^(e|ex|err|error|exception|throwable|cause)$/i.test(name) ||
    /(exception|throwable|cause|error)/i.test(name);
}

function makeLocationLink(fsPath: string, line = 0, character = 0) {
  return {
    targetUri: { fsPath, toString: () => fsPath },
    targetSelectionRange: { start: { line, character } },
  };
}

function makeLocation(fsPath: string, line = 0, character = 0) {
  return {
    uri: { fsPath, toString: () => fsPath },
    range: { start: { line, character } },
  };
}

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
    getAllPropertyKeys.mockReturnValue([]);
    inferMethodPatterns.mockImplementation(() => patterns ?? []);

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

    executeCommand.mockImplementation(
      async (_command: string, uri: any, position: any) => {
        if (uri?.fsPath !== "/fake/Doc.java") {
          return [];
        }
        const ident = findIdentifierAtOffset(text, position?.character ?? -1);
        if (!ident || !isThrowableLikeIdentifier(ident)) {
          return [];
        }

        const typeName = `${ident}Type`;
        return [
          {
            targetUri: {
              fsPath: `/fake/${typeName}.java`,
              toString: () => `/fake/${typeName}.java`,
            },
            targetSelectionRange: { start: { line: 0, character: 0 } },
          },
        ];
      }
    );

    openTextDocument.mockImplementation(async (uri: any) => {
      const fileName = (uri?.fsPath ?? "ThrowableType")
        .split("/")
        .pop()
        ?.replace(/\.java$/, "") || "ThrowableType";
      return {
        uri,
        lineCount: 1,
        lineAt: () => ({ text: `class ${fileName} extends RuntimeException {` }),
      };
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

  it("設定パターン末尾の '(' は無視して検証できること", async () => {
    patterns = ["log("];
    text = `log("MSG", "A")`;
    getMessageValueForKey.mockResolvedValue("Hi {0}");

    await validatePlaceholders(doc, collection);
    assert.strictEqual(seen.length, 1);
    assert.strictEqual(seen[0].length, 0);
  });

  it("先頭引数が文字列リテラルでない呼び出しはスキップすること", async () => {
    patterns = ["MessageFormat.format"];
    text = `MessageFormat.format(msgTemplate, a, b)`;
    getMessageValueForKey.mockResolvedValue("Hi {0} {1}");

    await validatePlaceholders(doc, collection);
    assert.deepStrictEqual(seen, [[]]);
    expect(getMessageValueForKey).not.toHaveBeenCalled();
  });

  it("locale だけを補助引数に取るキー取得呼び出しはスキップすること", async () => {
    patterns = ["LabelUtils.getLabel"];
    text = `LabelUtils.getLabel("MSG", localeContext.getLocale())`;
    getMessageValueForKey.mockResolvedValue("Hi {0} {1}");

    await validatePlaceholders(doc, collection);
    assert.strictEqual(seen.length, 1);
    assert.strictEqual(seen[0].length, 0);
  });

  it("末尾の locale 引数はプレースホルダー引数として数えないこと", async () => {
    patterns = ["messageSource.getMessage"];
    text = `messageSource.getMessage("MSG", new Object[] { "A", "B" }, Locale.JAPAN)`;
    getMessageValueForKey.mockResolvedValue("Hi {0} {1}");

    await validatePlaceholders(doc, collection);
    assert.strictEqual(seen.length, 1);
    assert.strictEqual(seen[0].length, 0);
  });

  it("getMessage(..., null, locale) で診断されないこと", async () => {
    patterns = ["messageSource.getMessage"];
    text = `messageSource.getMessage("email.verification.subject", null, locale)`;
    getMessageValueForKey.mockResolvedValue("Email verification");

    await validatePlaceholders(doc, collection);
    assert.strictEqual(seen.length, 1);
    assert.strictEqual(seen[0].length, 0);
  });

  it("getMessage(..., (Object[]) null, locale) で診断されないこと", async () => {
    patterns = ["messageSource.getMessage"];
    text =
      'messageSource.getMessage("email.verification.subject", (Object[]) null, locale)';
    getMessageValueForKey.mockResolvedValue("Email verification");

    await validatePlaceholders(doc, collection);
    assert.strictEqual(seen.length, 1);
    assert.strictEqual(seen[0].length, 0);
  });

  it("重複する抽出パターンでも同じ診断は1件だけ登録されること", async () => {
    patterns = ["log", "foo.log"];
    text = `foo.log("MSG", a)`;
    getMessageValueForKey.mockResolvedValue("Hi {0} {1}");

    await validatePlaceholders(doc, collection);
    assert.strictEqual(seen.length, 1);
    assert.strictEqual(seen[0].length, 1);
    expect(seen[0][0].message).toMatch(/Placeholder count.*argument count/);
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

  it("プレースホルダーなし + 単一例外引数 e は診断されないこと", async () => {
    patterns = ["log"];
    text = `log("MSG", e)`;
    getMessageValueForKey.mockResolvedValue("Hello");

    await validatePlaceholders(doc, collection);
    assert.strictEqual(seen.length, 1);
    assert.strictEqual(seen[0].length, 0);
  });

  it("プレースホルダーなし + 単一通常引数は診断されること", async () => {
    patterns = ["log"];
    text = `log("MSG", arg1)`;
    getMessageValueForKey.mockResolvedValue("Hello");

    await validatePlaceholders(doc, collection);
    assert.strictEqual(seen.length, 1);
    assert.strictEqual(seen[0].length, 1);
    expect(seen[0][0].message).toMatch(/Placeholder count|argument count/);
  });

  it("プレースホルダーなし + 単一例外引数 exceptionObj は診断されないこと", async () => {
    patterns = ["log"];
    text = `log("MSG", exceptionObj)`;
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

  it("varargs形式で末尾が通常識別子でも例外扱いせず診断されないこと", async () => {
    patterns = ["log"];
    text = `log("MSG", customerId, orderId, status)`;
    getMessageValueForKey.mockResolvedValue("A {0}, B {1}, C {2}");

    await validatePlaceholders(doc, collection);
    assert.strictEqual(seen.length, 1);
    assert.strictEqual(seen[0].length, 0);
  });

  it("varargs形式で余剰末尾引数が Throwable 型なら診断されないこと", async () => {
    patterns = ["log"];
    text = `log("MSG", customerId, orderId, ex)`;
    getMessageValueForKey.mockResolvedValue("A {0}, B {1}");

    executeCommand.mockResolvedValue([
      {
        targetUri: { fsPath: "/fake/MyThrowable.java", toString: () => "/fake/MyThrowable.java" },
        targetSelectionRange: { start: { line: 0, character: 13 } },
      },
    ]);
    openTextDocument.mockResolvedValue({
      uri: { fsPath: "/fake/MyThrowable.java", toString: () => "/fake/MyThrowable.java" },
      lineCount: 1,
      lineAt: () => ({ text: "class MyThrowable extends RuntimeException {" }),
    });

    await validatePlaceholders(doc, collection);
    assert.strictEqual(seen.length, 1);
    assert.strictEqual(seen[0].length, 0);
  });

  it("varargs形式で余剰末尾引数が String 型なら診断されること", async () => {
    patterns = ["log"];
    text = `log("MSG", customerId, orderId, status)`;
    getMessageValueForKey.mockResolvedValue("A {0}, B {1}");

    executeCommand.mockResolvedValue([
      {
        targetUri: { fsPath: "/fake/Status.java", toString: () => "/fake/Status.java" },
        targetSelectionRange: { start: { line: 0, character: 13 } },
      },
    ]);
    openTextDocument.mockResolvedValue({
      uri: { fsPath: "/fake/Status.java", toString: () => "/fake/Status.java" },
      lineCount: 1,
      lineAt: () => ({ text: "class Status extends String {" }),
    });

    await validatePlaceholders(doc, collection);
    assert.strictEqual(seen.length, 1);
    assert.strictEqual(seen[0].length, 1);
    expect(seen[0][0].message).toMatch(/Placeholder count|argument count/);
  });

  it("型解決不能時は安全側で余剰末尾引数を診断すること", async () => {
    patterns = ["log"];
    text = `log("MSG", customerId, orderId, ex)`;
    getMessageValueForKey.mockResolvedValue("A {0}, B {1}");

    executeCommand.mockResolvedValue(undefined);
    openTextDocument.mockResolvedValue(undefined);

    await validatePlaceholders(doc, collection);
    assert.strictEqual(seen.length, 1);
    assert.strictEqual(seen[0].length, 1);
    expect(seen[0][0].message).toMatch(/Placeholder count|argument count/);
  });

  it("型定義解決コマンドが例外を投げた場合は安全側で診断すること", async () => {
    patterns = ["log"];
    text = `log("MSG", customerId, orderId, ex)`;
    getMessageValueForKey.mockResolvedValue("A {0}, B {1}");

    executeCommand.mockRejectedValue(new Error("type lookup failed"));

    await validatePlaceholders(doc, collection);
    assert.strictEqual(seen.length, 1);
    assert.strictEqual(seen[0].length, 1);
  });

  it("MSG=A {0}, B {1} で末尾 ex の型解決が失敗した場合は不一致 Error になること", async () => {
    patterns = ["log"];
    text = `log("MSG", customerId, orderId, ex)`;
    getMessageValueForKey.mockResolvedValue("A {0}, B {1}");

    executeCommand.mockRejectedValue(new Error("type lookup failed"));

    await validatePlaceholders(doc, collection);
    assert.strictEqual(seen.length, 1);
    assert.strictEqual(seen[0].length, 1);
    assert.strictEqual(
      seen[0][0].message,
      "⚠️ Placeholder count (2) doesn’t match provided argument count (3)."
    );
    assert.strictEqual(seen[0][0].severity, vscode.DiagnosticSeverity.Error);
  });

  it("型定義 location に選択レンジがない場合は安全側で診断すること", async () => {
    patterns = ["log"];
    text = `log("MSG", customerId, orderId, ex)`;
    getMessageValueForKey.mockResolvedValue("A {0}, B {1}");

    executeCommand.mockResolvedValue([
      {
        targetUri: { fsPath: "/fake/Broken.java", toString: () => "/fake/Broken.java" },
      },
    ]);

    await validatePlaceholders(doc, collection);
    assert.strictEqual(seen.length, 1);
    assert.strictEqual(seen[0].length, 1);
  });

  it("型定義ファイルを開けない場合は安全側で診断すること", async () => {
    patterns = ["log"];
    text = `log("MSG", customerId, orderId, ex)`;
    getMessageValueForKey.mockResolvedValue("A {0}, B {1}");

    executeCommand.mockResolvedValue([makeLocationLink("/fake/Missing.java")]);
    openTextDocument.mockRejectedValue(new Error("open failed"));

    await validatePlaceholders(doc, collection);
    assert.strictEqual(seen.length, 1);
    assert.strictEqual(seen[0].length, 1);
  });

  it("型定義ファイルに class/record 宣言がない場合は安全側で診断すること", async () => {
    patterns = ["log"];
    text = `log("MSG", customerId, orderId, ex)`;
    getMessageValueForKey.mockResolvedValue("A {0}, B {1}");

    executeCommand.mockResolvedValue([makeLocationLink("/fake/NoDecl.java")]);
    openTextDocument.mockResolvedValue({
      uri: { fsPath: "/fake/NoDecl.java", toString: () => "/fake/NoDecl.java" },
      lineCount: 1,
      lineAt: () => ({ text: "/* no declaration */" }),
    });

    await validatePlaceholders(doc, collection);
    assert.strictEqual(seen.length, 1);
    assert.strictEqual(seen[0].length, 1);
  });

  it("型名自体が RuntimeException の場合は診断されないこと", async () => {
    patterns = ["log"];
    text = `log("MSG", customerId, orderId, ex)`;
    getMessageValueForKey.mockResolvedValue("A {0}, B {1}");

    executeCommand.mockResolvedValue([makeLocation("/fake/RuntimeException.java")]);
    openTextDocument.mockResolvedValue({
      uri: { fsPath: "/fake/RuntimeException.java", toString: () => "/fake/RuntimeException.java" },
      lineCount: 1,
      lineAt: () => ({ text: "class RuntimeException {" }),
    });

    await validatePlaceholders(doc, collection);
    assert.strictEqual(seen.length, 1);
    assert.strictEqual(seen[0].length, 0);
  });

  it("継承句がない通常型なら診断されること", async () => {
    patterns = ["log"];
    text = `log("MSG", customerId, orderId, ex)`;
    getMessageValueForKey.mockResolvedValue("A {0}, B {1}");

    executeCommand.mockResolvedValue([makeLocationLink("/fake/PlainType.java")]);
    openTextDocument.mockResolvedValue({
      uri: { fsPath: "/fake/PlainType.java", toString: () => "/fake/PlainType.java" },
      lineCount: 1,
      lineAt: () => ({ text: "class PlainType {" }),
    });

    await validatePlaceholders(doc, collection);
    assert.strictEqual(seen.length, 1);
    assert.strictEqual(seen[0].length, 1);
  });

  it("基底型の型解決コマンドが失敗した場合は安全側で診断すること", async () => {
    patterns = ["log"];
    text = `log("MSG", customerId, orderId, ex)`;
    getMessageValueForKey.mockResolvedValue("A {0}, B {1}");

    executeCommand.mockImplementation(async (_command: string, uri: any) => {
      if (uri?.fsPath === "/fake/Doc.java") {
        return [makeLocationLink("/fake/CustomThrowable.java")];
      }
      throw new Error("base lookup failed");
    });
    openTextDocument.mockResolvedValue({
      uri: { fsPath: "/fake/CustomThrowable.java", toString: () => "/fake/CustomThrowable.java" },
      lineCount: 1,
      lineAt: () => ({ text: "class CustomThrowable extends BaseThrowable {" }),
    });

    await validatePlaceholders(doc, collection);
    assert.strictEqual(seen.length, 1);
    assert.strictEqual(seen[0].length, 1);
  });

  it("基底型の型解決結果が undefined の場合は安全側で診断すること", async () => {
    patterns = ["log"];
    text = `log("MSG", customerId, orderId, ex)`;
    getMessageValueForKey.mockResolvedValue("A {0}, B {1}");

    executeCommand.mockImplementation(async (_command: string, uri: any) => {
      if (uri?.fsPath === "/fake/Doc.java") {
        return [makeLocationLink("/fake/CustomThrowable.java")];
      }
      return undefined;
    });
    openTextDocument.mockResolvedValue({
      uri: { fsPath: "/fake/CustomThrowable.java", toString: () => "/fake/CustomThrowable.java" },
      lineAt: () => ({ text: "class CustomThrowable extends BaseThrowable {" }),
    });

    await validatePlaceholders(doc, collection);
    assert.strictEqual(seen.length, 1);
    assert.strictEqual(seen[0].length, 1);
  });

  it("基底型を再帰的にたどって RuntimeException に到達した場合は診断されないこと", async () => {
    patterns = ["log"];
    text = `log("MSG", customerId, orderId, ex)`;
    getMessageValueForKey.mockResolvedValue("A {0}, B {1}");

    executeCommand.mockImplementation(async (_command: string, uri: any) => {
      if (uri?.fsPath === "/fake/Doc.java") {
        return [makeLocationLink("/fake/CustomThrowable.java")];
      }
      if (uri?.fsPath === "/fake/CustomThrowable.java") {
        return [makeLocation("/fake/BaseThrowable.java")];
      }
      return [];
    });
    openTextDocument.mockImplementation(async (uri: any) => {
      if (uri?.fsPath === "/fake/CustomThrowable.java") {
        return {
          uri,
          lineCount: 1,
          lineAt: () => ({ text: "class CustomThrowable extends BaseThrowable {" }),
        };
      }
      return {
        uri,
        lineCount: 1,
        lineAt: () => ({ text: "class BaseThrowable extends RuntimeException {" }),
      };
    });

    await validatePlaceholders(doc, collection);
    assert.strictEqual(seen.length, 1);
    assert.strictEqual(seen[0].length, 0);
  });

  it("基底型解決が深すぎる場合は安全側で診断すること", async () => {
    patterns = ["log"];
    text = `log("MSG", customerId, orderId, ex)`;
    getMessageValueForKey.mockResolvedValue("A {0}, B {1}");

    executeCommand.mockImplementation(async (_command: string, uri: any) => {
      const current = uri?.fsPath ?? "/fake/Doc.java";
      if (current === "/fake/Doc.java") {
        return [makeLocationLink("/fake/Type0.java")];
      }
      const match = current.match(/Type(\d+)\.java$/);
      if (!match) {
        return [];
      }
      const idx = Number(match[1]);
      return [makeLocationLink(`/fake/Type${idx + 1}.java`)];
    });
    openTextDocument.mockImplementation(async (uri: any) => {
      const current = uri?.fsPath ?? "/fake/Type0.java";
      const match = current.match(/Type(\d+)\.java$/);
      const idx = match ? Number(match[1]) : 0;
      return {
        uri,
        lineCount: 1,
        lineAt: () => ({ text: `class Type${idx} extends Type${idx + 1} {` }),
      };
    });

    await validatePlaceholders(doc, collection);
    assert.strictEqual(seen.length, 1);
    assert.strictEqual(seen[0].length, 1);
  });

  it("型定義ドキュメントに lineCount がなくても継承解決できること", async () => {
    patterns = ["log"];
    text = `log("MSG", customerId, orderId, ex)`;
    getMessageValueForKey.mockResolvedValue("A {0}, B {1}");

    executeCommand.mockResolvedValue([makeLocation("/fake/RuntimeException.java")]);
    openTextDocument.mockResolvedValue({
      uri: { fsPath: "/fake/RuntimeException.java", toString: () => "/fake/RuntimeException.java" },
      lineAt: () => ({ text: "class RuntimeException {" }),
    });

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
    expect(messages.some((m) => /Placeholders.*\{2\}/.test(m))).toBe(true);
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

  it("配列 + 例外引数（ex）がある場合は診断されないこと", async () => {
    patterns = ["log"];

    // 1) 要素1個 + ex
    text = `log("MSG", new Object[] { "A" }, ex)`;
    getMessageValueForKey.mockResolvedValue("Hi {0}");
    await validatePlaceholders(doc, collection);
    assert.strictEqual(seen.pop()!.length, 0);

    // 2) 要素2個 + ex
    text = `log("MSG", new Object[] { "A", "B" }, ex)`;
    getMessageValueForKey.mockResolvedValue("Hi {0} {1}");
    await validatePlaceholders(doc, collection);
    assert.strictEqual(seen.pop()!.length, 0);

    // 3) 要素3個 + ex
    text = `log("MSG", new Object[] { "A", "B", "C" }, ex)`;
    getMessageValueForKey.mockResolvedValue("Hi {0} {1} {2}");
    await validatePlaceholders(doc, collection);
    assert.strictEqual(seen.pop()!.length, 0);
  });

  it("join() + 例外引数では診断されないこと", async () => {
    patterns = ["log"];
    text = `log("MSG", new Object[] { task.join(","), "X" }, ex)`;
    getMessageValueForKey.mockResolvedValue("Hi {0} {1}");
    await validatePlaceholders(doc, collection);
    assert.strictEqual(seen.pop()!.length, 0);
  });

  it("varargs形式で最後が例外引数の場合は診断されないこと", async () => {
    patterns = ["log"];
    text = `log("MSG", "A", "B", ex)`;
    getMessageValueForKey.mockResolvedValue("Hi {0} {1}");
    await validatePlaceholders(doc, collection);
    assert.strictEqual(seen.pop()!.length, 0);
  });

  it("プレースホルダー1個・引数1個 + 例外は診断されないこと", async () => {
    patterns = ["log"];
    text = `log("MSG", new Object[] { "A" }, ex)`;
    getMessageValueForKey.mockResolvedValue("Hi {0}");
    await validatePlaceholders(doc, collection);
    assert.strictEqual(seen.pop()!.length, 0);
  });

  it("プレースホルダー1個・引数2個 + 例外は診断されること", async () => {
    patterns = ["log"];
    text = `log("MSG", new Object[] { "A", "B" }, ex)`;
    getMessageValueForKey.mockResolvedValue("Hi {0}");
    await validatePlaceholders(doc, collection);
    assert.strictEqual(seen.pop()!.length, 1);
  });

  it("最後が単一変数名でも直前が配列/joinでない場合は除外されること", async () => {
    patterns = ["log"];
    text = `log("MSG", "A", ex)`;
    getMessageValueForKey.mockResolvedValue("Hi {0}");
    await validatePlaceholders(doc, collection);
    assert.strictEqual(seen.pop()!.length, 0);
  });

  it("プレースホルダー番号が重複しても最大番号+1を期待値に使うこと", async () => {
    patterns = ["log"];
    text = `log("MSG", "A", "B")`;
    getMessageValueForKey.mockResolvedValue("Hi {0} {1} {1}");
    await validatePlaceholders(doc, collection);
    // {0}と{1}なので expectedArgCount=2 → 実際2で一致、診断なし
    assert.strictEqual(seen.pop()!.length, 0);
  });

  it("配列リテラル + ex は診断されないこと（要素1個）", async () => {
    patterns = ["log"];
    text = `log("MSG", new Object[] { "A" }, ex)`;
    getMessageValueForKey.mockResolvedValue("Hi {0}");
    await validatePlaceholders(doc, collection);
    assert.strictEqual(seen.pop()!.length, 0);
  });

  it("配列リテラル + ex は診断されないこと（要素3個）", async () => {
    patterns = ["log"];
    text = `log("MSG", new Object[] { "A", "B", "C" }, ex)`;
    getMessageValueForKey.mockResolvedValue("Hi {0} {1} {2}");
    await validatePlaceholders(doc, collection);
    assert.strictEqual(seen.pop()!.length, 0);
  });

  it("join() + ex は診断されないこと", async () => {
    patterns = ["log"];
    text = `log("MSG", taskList.join(","), ex)`;
    getMessageValueForKey.mockResolvedValue("Hi {0} {1}");
    await validatePlaceholders(doc, collection);
    assert.strictEqual(seen.pop()!.length, 0);
  });

  it("join() + 他引数 + ex は診断されないこと", async () => {
    patterns = ["log"];
    text = `log("MSG", new Object[] { task.join(","), "B" }, ex)`;
    getMessageValueForKey.mockResolvedValue("Hi {0} {1}");
    await validatePlaceholders(doc, collection);
    assert.strictEqual(seen.pop()!.length, 0);
  });

  it("varargs + ex は診断されないこと", async () => {
    patterns = ["log"];
    text = `log("MSG", "A", "B", ex)`;
    getMessageValueForKey.mockResolvedValue("Hi {0} {1}");
    await validatePlaceholders(doc, collection);
    assert.strictEqual(seen.pop()!.length, 0);
  });

  it("引数1個 + ex（配列/joinではない）は除外されず診断されないこと", async () => {
    patterns = ["log"];
    text = `log("MSG", "A", ex)`;
    getMessageValueForKey.mockResolvedValue("Hi {0}");
    await validatePlaceholders(doc, collection);
    assert.strictEqual(seen.pop()!.length, 0);
  });

  it("配列リテラル + ex だが要素数がプレースホルダー数と不一致の場合は診断されること", async () => {
    patterns = ["log"];
    text = `log("MSG", new Object[] { "A" }, ex)`;
    getMessageValueForKey.mockResolvedValue("Hi {0} {1}");
    await validatePlaceholders(doc, collection);
    assert.strictEqual(seen.pop()!.length, 1);
  });

  it("join() + ex だがプレースホルダー数が多すぎる場合は診断されること", async () => {
    patterns = ["log"];
    text = `log("MSG", taskList.join(","), ex)`;
    getMessageValueForKey.mockResolvedValue("Hi {0} {1} {2}");
    await validatePlaceholders(doc, collection);
    assert.strictEqual(seen.pop()!.length, 1);
  });

  it("varargs + ex だがプレースホルダー数が多すぎる場合は診断されること", async () => {
    patterns = ["log"];
    text = `log("MSG", "A", "B", ex)`;
    getMessageValueForKey.mockResolvedValue("Hi {0} {1} {2}");
    await validatePlaceholders(doc, collection);
    assert.strictEqual(seen.pop()!.length, 1);
  });

  it("最後が単一変数名だが varargs 形式でプレースホルダー一致する場合は診断されないこと", async () => {
    patterns = ["log"];
    text = `log("MSG", "A", ex)`;
    getMessageValueForKey.mockResolvedValue("Hi {0}");
    await validatePlaceholders(doc, collection);
    assert.strictEqual(seen.pop()!.length, 0);
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
    expect(messages.some((m) => /Placeholders.*\{1\}/.test(m))).toBe(true);
  });

  it("プレースホルダーが連番でない場合（飛び番号）に診断されること", async () => {
    patterns = ["log"];
    text = `log("MSG", "A", "B", "C")`;
    getMessageValueForKey.mockResolvedValue("Hi {0} {2}");

    await validatePlaceholders(doc, collection);

    const messages = getDiagnosticMessages();
    expect(messages.length).toBeGreaterThanOrEqual(1);
    expect(messages.some((m) => /Placeholders.*\{0\}.*\{2\}/.test(m))).toBe(
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
    expect(messages.some((m) => /Placeholders.*\{2\}.*\{5\}/.test(m))).toBe(
      true
    );
  });

  // ===== argBuilderPatterns テスト =====
  // NOTE: 設定項目は削除済みだが、同等の引数数検証を回帰テストとして維持する。

  it("argBuilderPattern にマッチするメソッド呼び出し相当は引数数推論で検証されること", async () => {
    patterns = ["log"];
    text = `log("MSG", buildArgs(requestUri))`;
    getMessageValueForKey.mockResolvedValue("Hi {0}");

    await validatePlaceholders(doc, collection);
    assert.strictEqual(seen.length, 1);
    assert.strictEqual(seen[0].length, 0);
  });

  it("argBuilderPattern にマッチする相当呼び出しで引数数不一致はエラーになること", async () => {
    patterns = ["log"];
    text = `log("MSG", buildArgs(requestUri))`;
    getMessageValueForKey.mockResolvedValue("Hi {0} {1}");

    await validatePlaceholders(doc, collection);
    assert.strictEqual(seen.length, 1);
    assert.strictEqual(seen[0].length, 1);
    expect(seen[0][0].message).toMatch(/Placeholder count.*argument count/);
  });

  it("Object[] を返すヘルパーを varargs に渡した場合は診断されないこと", async () => {
    patterns = ["infrastructureLogger.log"];
    text = `
      infrastructureLogger.log("PLF1031", buildOperatorArgs(requestUri));

      private Object[] buildOperatorArgs(String requestUri) {
          return new Object[] { requestUri, DbUserType.OPERATOR.name() };
      }
    `;
    getMessageValueForKey.mockResolvedValue(
      "Context type [{1}] was set. (URI = [{0}])"
    );

    await validatePlaceholders(doc, collection);
    assert.strictEqual(seen.length, 1);
    assert.strictEqual(seen[0].length, 0);
  });

  it("ヘルパーメソッド引数なし + 呼び出し引数なし（Object[]返却）は診断されないこと", async () => {
    patterns = ["infrastructureLogger.log"];
    text = `
      infrastructureLogger.log("PLF1031", buildOperatorArgs());

      private Object[] buildOperatorArgs() {
          return new Object[] { requestUri, DbUserType.OPERATOR.name() };
      }
    `;
    getMessageValueForKey.mockResolvedValue(
      "Context type [{1}] was set. (URI = [{0}])"
    );

    await validatePlaceholders(doc, collection);
    assert.strictEqual(seen.length, 1);
    assert.strictEqual(seen[0].length, 0);
  });

  it("ヘルパーメソッド引数なし + 呼び出し引数ありは不一致診断になること", async () => {
    patterns = ["infrastructureLogger.log"];
    text = `
      infrastructureLogger.log("PLF1031", buildOperatorArgs(requestUri));

      private Object[] buildOperatorArgs() {
          return new Object[] { requestUri, DbUserType.OPERATOR.name() };
      }
    `;
    getMessageValueForKey.mockResolvedValue(
      "Context type [{1}] was set. (URI = [{0}])"
    );

    await validatePlaceholders(doc, collection);
    assert.strictEqual(seen.length, 1);
    assert.strictEqual(seen[0].length, 1);
    expect(seen[0][0].message).toMatch(/Placeholder count.*argument count/);
  });

  it("ヘルパーメソッド引数あり + 呼び出し引数なしは不一致診断になること", async () => {
    patterns = ["infrastructureLogger.log"];
    text = `
      infrastructureLogger.log("PLF1031", buildOperatorArgs());

      private Object[] buildOperatorArgs(String requestUri) {
          return new Object[] { requestUri, DbUserType.OPERATOR.name() };
      }
    `;
    getMessageValueForKey.mockResolvedValue(
      "Context type [{1}] was set. (URI = [{0}])"
    );

    await validatePlaceholders(doc, collection);
    assert.strictEqual(seen.length, 1);
    assert.strictEqual(seen[0].length, 1);
    expect(seen[0][0].message).toMatch(/Placeholder count.*argument count/);
  });

  it("同名ヘルパーが非配列戻り値のみの場合は配列推論せず不一致診断になること", async () => {
    patterns = ["infrastructureLogger.log"];
    text = `
      infrastructureLogger.log("PLF1031", buildOperatorArgs(requestUri));

      private String buildOperatorArgs(String requestUri) {
          return requestUri;
      }
    `;
    getMessageValueForKey.mockResolvedValue("Context type [{1}] was set. (URI = [{0}])");

    await validatePlaceholders(doc, collection);
    assert.strictEqual(seen.length, 1);
    assert.strictEqual(seen[0].length, 1);
    expect(seen[0][0].message).toMatch(/Placeholder count.*argument count/);
  });

  it("複雑な Object[] return（コメント・引用符・ジェネリクス・匿名クラス）でも要素数推論できること", async () => {
    patterns = ["infrastructureLogger.log"];
    text = `
      infrastructureLogger.log("PLF1031", buildOperatorArgs(mapArg, marker, textArg));

      private Object[] buildOperatorArgs(
          java.util.Map<String, java.util.List<Integer>> mapArg,
          char marker,
          String textArg
      ) {
          return new Object[] {
              mapArg.get("k"), // line comment
              /* block comment */ 'x',
              "a\\\"b",
              arr[0],
              helper(one, two),
              new Object() { public String toString() { return "v"; } }
          };
      }
    `;
    getMessageValueForKey.mockResolvedValue("A{0}B{1}C{2}D{3}E{4}F{5}");

    await validatePlaceholders(doc, collection);
    assert.strictEqual(seen.length, 1);
    assert.strictEqual(seen[0].length, 0);
  });


  it("Object[] 戻り値でも return が new でない場合は配列推論せず不一致診断になること", async () => {
    patterns = ["infrastructureLogger.log"];
    text = `
      infrastructureLogger.log("PLF1031", buildOperatorArgs(requestUri));

      private Object[] buildOperatorArgs(String requestUri) {
          Object[] arr = new Object[] { requestUri, opType };
          return arr;
      }
    `;
    getMessageValueForKey.mockResolvedValue("Context type [{1}] was set. (URI = [{0}])");

    await validatePlaceholders(doc, collection);
    assert.strictEqual(seen.length, 1);
    assert.strictEqual(seen[0].length, 1);
    expect(seen[0][0].message).toMatch(/Placeholder count.*argument count/);
  });

  it("new Object[2] のような配列生成式は初期化子推論せず不一致診断になること", async () => {
    patterns = ["infrastructureLogger.log"];
    text = `
      infrastructureLogger.log("PLF1031", buildOperatorArgs(requestUri));

      private Object[] buildOperatorArgs(String requestUri) {
          return new Object[2];
      }
    `;
    getMessageValueForKey.mockResolvedValue("Context type [{1}] was set. (URI = [{0}])");

    await validatePlaceholders(doc, collection);
    assert.strictEqual(seen.length, 1);
    assert.strictEqual(seen[0].length, 1);
    expect(seen[0][0].message).toMatch(/Placeholder count.*argument count/);
  });


  it("修飾付き呼び出し（Utils.buildArgs）も引数数推論で扱えること", async () => {
    patterns = ["log"];
    text = `log("MSG", Utils.buildArgs(a, b))`;
    getMessageValueForKey.mockResolvedValue("Hi {0} {1}");

    await validatePlaceholders(doc, collection);
    assert.strictEqual(seen.length, 1);
    assert.strictEqual(seen[0].length, 0);
  });

  it("未登録メソッド相当でも引数数推論で検証されること", async () => {
    patterns = ["log"];
    text = `log("MSG", someOtherMethod(x))`;
    getMessageValueForKey.mockResolvedValue("Hi {0} {1}");

    await validatePlaceholders(doc, collection);
    assert.strictEqual(seen.length, 1);
    assert.strictEqual(seen[0].length, 1);
    expect(seen[0][0].message).toMatch(/Placeholder count.*argument count/);
  });

  it("buildArgs(x) は単一引数として一致すること", async () => {
    patterns = ["log"];
    text = `log("MSG", buildArgs(x))`;
    getMessageValueForKey.mockResolvedValue("Hi {0}");

    await validatePlaceholders(doc, collection);
    assert.strictEqual(seen.length, 1);
    assert.strictEqual(seen[0].length, 0);
  });

  it("複数引数の helper 呼び出しを正しく検証できること", async () => {
    patterns = ["log"];
    text = `log("MSG", createLogParams(a, b))`;
    getMessageValueForKey.mockResolvedValue("Hi {0} {1}");

    await validatePlaceholders(doc, collection);
    assert.strictEqual(seen.length, 1);
    assert.strictEqual(seen[0].length, 0);
  });

  it("this.buildArgs() のような this 修飾付き呼び出しを扱えること", async () => {
    patterns = ["log"];
    text = `log("MSG", this.buildArgs(requestUri))`;
    getMessageValueForKey.mockResolvedValue("Hi {0}");

    await validatePlaceholders(doc, collection);
    assert.strictEqual(seen.length, 1);
    assert.strictEqual(seen[0].length, 0);
  });

  it("深いパッケージ修飾（a.b.c.buildArgs）でも扱えること", async () => {
    patterns = ["log"];
    text = `log("MSG", com.example.Utils.buildArgs(a, b, c))`;
    getMessageValueForKey.mockResolvedValue("Hi {0} {1} {2}");

    await validatePlaceholders(doc, collection);
    assert.strictEqual(seen.length, 1);
    assert.strictEqual(seen[0].length, 0);
  });

  it("emptyArgs() は 0 引数として扱われること", async () => {
    patterns = ["log"];
    text = `log("MSG", emptyArgs())`;
    getMessageValueForKey.mockResolvedValue("Hello");

    await validatePlaceholders(doc, collection);
    assert.strictEqual(seen.length, 1);
    assert.strictEqual(seen[0].length, 0);
  });

  it("emptyArgs() でプレースホルダーがある場合はエラーになること", async () => {
    patterns = ["log"];
    text = `log("MSG", emptyArgs())`;
    getMessageValueForKey.mockResolvedValue("Hi {0}");

    await validatePlaceholders(doc, collection);
    assert.strictEqual(seen.length, 1);
    assert.strictEqual(seen[0].length, 1);
    expect(seen[0][0].message).toMatch(/Placeholder count.*argument count/);
  });

  it("helper + 例外引数（ex）が末尾にある場合は ex が除外されること", async () => {
    patterns = ["log"];
    text = `log("MSG", buildArgs(requestUri), ex)`;
    getMessageValueForKey.mockResolvedValue("Hi {0}");

    await validatePlaceholders(doc, collection);
    assert.strictEqual(seen.length, 1);
    assert.strictEqual(seen[0].length, 0);
  });

  it("helper + locale 引数が末尾にある場合は locale が除外されること", async () => {
    patterns = ["log"];
    text = `log("MSG", buildArgs(requestUri), Locale.JAPAN)`;
    getMessageValueForKey.mockResolvedValue("Hi {0}");

    await validatePlaceholders(doc, collection);
    assert.strictEqual(seen.length, 1);
    assert.strictEqual(seen[0].length, 0);
  });

  it("メソッド名の前にスペースがある場合（buildArgs (x)）も扱えること", async () => {
    patterns = ["log"];
    text = `log("MSG", buildArgs (requestUri))`;
    getMessageValueForKey.mockResolvedValue("Hi {0}");

    await validatePlaceholders(doc, collection);
    assert.strictEqual(seen.length, 1);
    assert.strictEqual(seen[0].length, 0);
  });

  it("同一ファイルに複数 helper 呼び出しがある場合、それぞれ検証されること", async () => {
    patterns = ["log"];
    text = `log("MSG1", buildArgs(a)); log("MSG2", createParams(a, b))`;
    getMessageValueForKey
      .mockResolvedValueOnce("Hi {0}")
      .mockResolvedValueOnce("Hi {0} {1}");

    await validatePlaceholders(doc, collection);
    assert.strictEqual(seen.length, 1);
    assert.strictEqual(seen[0].length, 0);
  });

  it("同一ファイルで一方が一致・他方が不一致の場合、不一致のみエラーになること", async () => {
    patterns = ["log"];
    text = `log("MSG1", buildArgs(a)); log("MSG2", createParams(a, b))`;
    getMessageValueForKey
      .mockResolvedValueOnce("Hi {0}")
      .mockResolvedValueOnce("Hi {0} {1} {2}");

    await validatePlaceholders(doc, collection);
    assert.strictEqual(seen.length, 1);
    assert.strictEqual(seen[0].length, 1);
    expect(seen[0][0].message).toMatch(/Placeholder count \(3\).*argument count \(2\)/);
  });

  it("配列リテラルが優先され、helper 呼び出し推論は適用されないこと", async () => {
    patterns = ["log"];
    text = `log("MSG", new Object[] { "A", "B" })`;
    getMessageValueForKey.mockResolvedValue("Hi {0} {1}");

    await validatePlaceholders(doc, collection);
    assert.strictEqual(seen.length, 1);
    assert.strictEqual(seen[0].length, 0);
  });

  it("メソッド名に特殊文字（$）が含まれていても引数数推論できること", async () => {
    patterns = ["log"];
    text = `log("MSG", build$Args(x))`;
    getMessageValueForKey.mockResolvedValue("Hi {0}");

    await validatePlaceholders(doc, collection);
    assert.strictEqual(seen.length, 1);
    assert.strictEqual(seen[0].length, 0);
  });

});
