// test/utils.test.ts

/**
 * まず最初に、fs.existsSync を jest.fn() で置き換えておく
 */
jest.mock("fs", () => {
  const real = jest.requireActual("fs");
  return {
    ...real,
    existsSync: jest.fn(),
  };
});

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { strict as assert } from "assert";
import * as vscode from "vscode";

// vscode モジュールのモック
jest.mock("vscode", () => ({
  __esModule: true,
  workspace: {
    workspaceFolders: undefined as any,
    getConfiguration: jest.fn(),
    findFiles: jest.fn(),
    openTextDocument: jest.fn(),
    applyEdit: jest.fn(),
  },
  window: {
    showErrorMessage: jest.fn(),
    showWarningMessage: jest.fn(),
    showInformationMessage: jest.fn(),
    createOutputChannel: jest.fn(),
    showTextDocument: jest.fn(),
  },
  Selection: class {
    constructor(public start: any, public end: any) {}
  },
  Uri: { file: (fsPath: string) => ({ fsPath }) },
  Position: class {
    constructor(public line: number, public character: number) {}
  },
  Range: class {
    constructor(public start: any, public end: any) {}
  },
}));

// outputChannel モック
jest.mock("../src/outputChannel", () => ({
  __esModule: true,
  outputChannel: { appendLine: jest.fn(), clear: jest.fn() },
}));

import {
  loadPropertyDefinitions,
  getAllPropertyKeys,
  getPropertyValue,
  isPropertyDefined,
  getCustomPatterns,
  findPropertyLocation,
  isExcludedFile,
  addPropertyKey,
  findPropertiesFiles,
  readPropertiesFile,
  getMessageValueForKey,
} from "../src/utils";

describe("utils.ts", () => {
  describe("loadPropertyDefinitions / cache getters", () => {
    let tmpDir: string;
    let propFile: string;

    beforeEach(async () => {
      // 一時ディレクトリと .properties を準備
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "test-utils-"));
      propFile = path.join(tmpDir, "test.properties");
      fs.writeFileSync(
        propFile,
        `
        # コメント行
        key1=val1
        key2=val2
        `.trim()
      );

      // fs.existsSync はデフォルト true
      (fs.existsSync as jest.Mock).mockReturnValue(true);

      // workspaceFolders と findFiles のスタブ
      (vscode.workspace as any).workspaceFolders = [
        { uri: vscode.Uri.file(tmpDir) },
      ];
      (vscode.workspace.findFiles as jest.Mock).mockResolvedValue([
        vscode.Uri.file(propFile),
      ]);

      // キャッシュロード
      await loadPropertyDefinitions(["**/*.properties"]);
    });

    it("caches property keys and values correctly", () => {
      const keys = getAllPropertyKeys();
      assert.deepStrictEqual(new Set(keys), new Set(["key1", "key2"]));
      assert.strictEqual(getPropertyValue("key1"), "val1");
      assert.strictEqual(getPropertyValue("key2"), "val2");
      assert.strictEqual(isPropertyDefined("key1"), true);
      assert.strictEqual(isPropertyDefined("missing"), false);
    });

    it("skips non-existent files when loading property definitions", async () => {
      // 新たに別ディレクトリを workspaceFolders にセット
      const tmp2 = fs.mkdtempSync(path.join(os.tmpdir(), "test-utils-"));
      (vscode.workspace as any).workspaceFolders = [
        { uri: vscode.Uri.file(tmp2) },
      ];
      const missing = path.join(tmp2, "no.properties");
      // findFiles で存在しないファイルを返す
      (vscode.workspace.findFiles as jest.Mock).mockResolvedValue([
        vscode.Uri.file(missing),
      ]);
      // existsSync は false
      (fs.existsSync as jest.Mock).mockReturnValue(false);

      await loadPropertyDefinitions(["**/*.properties"]);
      const keysAfter = getAllPropertyKeys();
      assert.deepStrictEqual(keysAfter, [], "Missing file should be skipped");
    });
  });

  describe("getCustomPatterns", () => {
    let cfg: jest.SpyInstance;
    beforeEach(() => {
      cfg = jest.spyOn(vscode.workspace, "getConfiguration").mockReturnValue({
        get: (section: string) => {
          if (section === "messageKeyExtractionPatterns")
            return ["foo.bar", "baz"];
          if (section === "annotationKeyExtractionPatterns")
            return ['@Ann\\("([^"]+)"\\)'];
          return [];
        },
      } as any);
    });
    afterEach(() => cfg.mockRestore());

    it("builds invocation + annotation regexes", () => {
      const patterns = getCustomPatterns();
      // foo.bar, baz, built-in messageSource.getMessage, annotation の4つ
      assert.strictEqual(patterns.length, 4);
      assert.ok(patterns[0].test('foo.bar("x")'));
      assert.ok(patterns[1].test('baz("y")'));
      assert.ok(patterns[2].test('messageSource.getMessage("z")'));
      assert.ok(patterns[3].test('@Ann("v")'));
    });
  });

  describe("findPropertyLocation", () => {
    let tmpDir: string;
    let propFile: string;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "test-utils-"));
      propFile = path.join(tmpDir, "app.properties");
      fs.writeFileSync(propFile, ["a=1", "b=2", "c=3"].join("\n"));
      // デフォルト workspaceFolders
      (vscode.workspace as any).workspaceFolders = [
        { uri: vscode.Uri.file(tmpDir) },
      ];
      // existsSync default true
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      // getConfiguration default glob
      jest.spyOn(vscode.workspace, "getConfiguration").mockReturnValue({
        get: () => [path.join(tmpDir, "*.properties")],
      } as any);
    });

    it("skips non-existent files when fs.existsSync=false", async () => {
      (vscode.workspace.findFiles as jest.Mock).mockResolvedValue([
        vscode.Uri.file(path.join(tmpDir, "no.properties")),
      ]);
      (fs.existsSync as jest.Mock).mockReturnValue(false);

      const loc = await findPropertyLocation("any");
      assert.strictEqual(loc, null);
    });

    it("returns null when key not found in real file", async () => {
      (vscode.workspace.findFiles as jest.Mock).mockResolvedValue([
        vscode.Uri.file(propFile),
      ]);
      const loc = await findPropertyLocation("missing");
      assert.strictEqual(loc, null);
    });

    it("finds key position when key exists", async () => {
      (vscode.workspace.findFiles as jest.Mock).mockResolvedValue([
        vscode.Uri.file(propFile),
      ]);
      const loc = await findPropertyLocation("b");
      assert.ok(loc);
      assert.strictEqual(loc!.filePath, propFile);
      assert.strictEqual(loc!.position.line, 1);
    });
  });

  describe("isExcludedFile", () => {
    for (const [p, ex] of [
      ["/.git/x", true],
      ["C:\\node_modules\\y", true],
      ["/src/Main.java", false],
    ] as const) {
      it(`${p} → ${ex}`, () => {
        assert.strictEqual(isExcludedFile(p), ex);
      });
    }
  });

  describe("addPropertyKey", () => {
    let tmpDir: string, propFile: string;
    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "test-utils-"));
      propFile = path.join(tmpDir, "app.properties");
      fs.writeFileSync(propFile, ["aaa=1", "ccc=3"].join("\n"));
      // existsSync default true
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      // findFiles → 常に自ファイルを返す
      (vscode.workspace.findFiles as jest.Mock).mockResolvedValue([
        vscode.Uri.file(propFile),
      ]);
      // openTextDocument / showTextDocument のスタブ
      (vscode.workspace.openTextDocument as jest.Mock).mockResolvedValue({
        lineAt: () => ({ range: { end: { line: 0, character: 0 } } }),
        lineCount: 1,
        getText: () => fs.readFileSync(propFile, "utf8"),
        uri: { fsPath: propFile },
        save: jest.fn(),
      } as any);
      (vscode.window.showTextDocument as jest.Mock).mockResolvedValue({
        selection: undefined,
        revealRange: jest.fn(),
      } as any);
    });

    afterEach(() => jest.clearAllMocks());

    it("glob で 0 件 → error", async () => {
      (vscode.workspace.findFiles as jest.Mock).mockResolvedValue([]);
      await addPropertyKey("foo", "no.glob");
      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
        "❌ Property file not found: no.glob"
      );
    });

    it("絶対パスかつ existsSync=false → error", async () => {
      const abs = path.join(tmpDir, "no.properties");
      (fs.existsSync as jest.Mock).mockReturnValueOnce(false);
      (vscode.workspace.findFiles as jest.Mock).mockResolvedValue([]);
      await addPropertyKey("foo", abs);
      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
        `❌ Property file not found: ${abs}`
      );
    });

    it("キー重複 → warning", async () => {
      await addPropertyKey("aaa", propFile);
      expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
        `⚠️ "aaa" already exists in ${path.basename(propFile)}.`
      );
      // 中身は変わらず
      assert.deepStrictEqual(fs.readFileSync(propFile, "utf8").split("\n"), [
        "aaa=1",
        "ccc=3",
      ]);
    });

    it("新規挿入・save・再オープン", async () => {
      await addPropertyKey("bbb", propFile);
      // ファイル中身
      assert.deepStrictEqual(fs.readFileSync(propFile, "utf8").split(/\r?\n/), [
        "aaa=1",
        "bbb=",
        "ccc=3",
      ]);
      expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
        `✅ Added "bbb" to ${path.basename(propFile)}! (line 2)`
      );
      // ドキュメント再オープン
      expect(vscode.workspace.openTextDocument).toHaveBeenCalledWith(propFile);
      expect(vscode.window.showTextDocument).toHaveBeenCalled();
    });

    it("shows error when glob returns a path that doesn’t exist (hits targetPath error branch)", async () => {
      // fileToUse にマッチせず → findFiles ブランチへ
      const globPattern = "whatever.properties";
      const fakePath = path.join(tmpDir, "not_there.properties");

      // ① fileToUse (= globPattern) の existsSync を false
      // ② targetPath (= fakePath) の existsSync も false
      (fs.existsSync as jest.Mock)
        .mockReturnValueOnce(false) // fileToUse チェック
        .mockReturnValueOnce(false); // targetPath チェック

      // findFiles が fakePath を返す
      (vscode.workspace.findFiles as jest.Mock).mockResolvedValue([
        vscode.Uri.file(fakePath),
      ]);

      await addPropertyKey("foo", globPattern);

      // targetPath エラー分岐を確実に踏む
      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
        `❌ Property file not found: ${fakePath}`
      );
    });

    it("コメント行に同じキーが含まれていても、新たにキーが追加されること", async () => {
      // コメント行に同じキーを含む状態で書き込み
      fs.writeFileSync(propFile, ["# aaa=これはコメント", "ccc=3"].join("\n"));

      // 実行：コメント内にあっても aaa は未定義とみなすべき
      await addPropertyKey("aaa", propFile);

      // 結果：aaa= が追加されること
      const lines = fs.readFileSync(propFile, "utf8").split(/\r?\n/);
      expect(lines).toContain("aaa=");
      expect(lines).toContain("ccc=3");

      // 警告メッセージは出ないこと
      expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
    });

    it("= を含まない不正な行があっても、キーが正常に追加されること", async () => {
      fs.writeFileSync(propFile, ["ccc=3", "MALFORMED_LINE"].join("\n"));
      await addPropertyKey("bbb", propFile);
      const lines = fs.readFileSync(propFile, "utf8").split(/\r?\n/);
      expect(lines).toContain("bbb=");
      expect(lines).toContain("ccc=3");
      expect(lines).toContain("MALFORMED_LINE");
    });
  });

  describe("findPropertiesFiles / readPropertiesFile / getMessageValueForKey", () => {
    let tmpDir: string, f1: string, f2: string;
    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "test-utils-"));
      f1 = path.join(tmpDir, "one.properties");
      f2 = path.join(tmpDir, "two.properties");
      fs.writeFileSync(f1, "k1=v1\nk2=v2");
      fs.writeFileSync(f2, "k3=v3\nk4=v4");
      jest.spyOn(vscode.workspace, "getConfiguration").mockReturnValue({
        get: () => [path.join(tmpDir, "*.properties")],
      } as any);
      (vscode.workspace.findFiles as jest.Mock).mockResolvedValue([
        vscode.Uri.file(f1),
        vscode.Uri.file(f2),
      ]);
      // openTextDocument
      jest
        .spyOn(vscode.workspace as any, "openTextDocument")
        .mockImplementation(async (...args: any[]) => {
          const uri = args[0] as vscode.Uri;
          return {
            getText: () => fs.readFileSync(uri.fsPath, "utf8"),
          };
        });
    });

    it("findPropertiesFiles", async () => {
      const uris = await findPropertiesFiles();
      assert.deepStrictEqual(uris.map((u) => u.fsPath).sort(), [f1, f2].sort());
    });

    it("readPropertiesFile", async () => {
      const { lines } = await readPropertiesFile(vscode.Uri.file(f1));
      assert.deepStrictEqual(lines, ["k1=v1", "k2=v2"]);
    });

    it("getMessageValueForKey", async () => {
      assert.strictEqual(await getMessageValueForKey("k2"), "v2");
      assert.strictEqual(await getMessageValueForKey("k3"), "v3");
      assert.strictEqual(await getMessageValueForKey("missing"), undefined);
    });
  });
});
