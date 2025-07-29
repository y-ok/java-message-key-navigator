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
import { outputChannel } from "../src/outputChannel";

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
  ViewColumn: { One: 1 },
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
  describe("loadPropertyDefinitions / キャッシュ取得", () => {
    let tmpDir: string;
    let propFile: string;

    beforeEach(async () => {
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

      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (vscode.workspace as any).workspaceFolders = [
        { uri: vscode.Uri.file(tmpDir) },
      ];
      (vscode.workspace.findFiles as jest.Mock).mockResolvedValue([
        vscode.Uri.file(propFile),
      ]);

      await loadPropertyDefinitions(["**/*.properties"]);
    });

    it("プロパティキーと値が正しくキャッシュされる", () => {
      const keys = getAllPropertyKeys();
      assert.deepStrictEqual(new Set(keys), new Set(["key1", "key2"]));
      assert.strictEqual(getPropertyValue("key1"), "val1");
      assert.strictEqual(getPropertyValue("key2"), "val2");
      assert.strictEqual(isPropertyDefined("key1"), true);
      assert.strictEqual(isPropertyDefined("missing"), false);
    });

    it("存在しないファイルは読み込みからスキップされる", async () => {
      const tmp2 = fs.mkdtempSync(path.join(os.tmpdir(), "test-utils-"));
      (vscode.workspace as any).workspaceFolders = [
        { uri: vscode.Uri.file(tmp2) },
      ];
      const missing = path.join(tmp2, "no.properties");
      (vscode.workspace.findFiles as jest.Mock).mockResolvedValue([
        vscode.Uri.file(missing),
      ]);
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

    it("呼び出しパターンとアノテーションパターンの正規表現を生成する", () => {
      const patterns = getCustomPatterns();
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
      (vscode.workspace as any).workspaceFolders = [
        { uri: vscode.Uri.file(tmpDir) },
      ];
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      jest.spyOn(vscode.workspace, "getConfiguration").mockReturnValue({
        get: () => [path.join(tmpDir, "*.properties")],
      } as any);
    });

    it("fs.existsSync=false の場合はスキップして null を返す", async () => {
      (vscode.workspace.findFiles as jest.Mock).mockResolvedValue([
        vscode.Uri.file(path.join(tmpDir, "no.properties")),
      ]);
      (fs.existsSync as jest.Mock).mockReturnValue(false);

      const loc = await findPropertyLocation("any");
      assert.strictEqual(loc, null);
    });

    it("キーが見つからない場合は null を返す", async () => {
      (vscode.workspace.findFiles as jest.Mock).mockResolvedValue([
        vscode.Uri.file(propFile),
      ]);
      const loc = await findPropertyLocation("missing");
      assert.strictEqual(loc, null);
    });

    it("キーが見つかればファイルパスと行位置を返す", async () => {
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

  describe("addPropertyKey の動作", () => {
    let tmpDir: string;
    let propFile: string;

    beforeEach(() => {
      // テスト用ディレクトリとプロパティファイルを用意
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "test-utils-"));
      propFile = path.join(tmpDir, "app.properties");
      fs.writeFileSync(propFile, ["aaa=1", "ccc=3"].join("\n"));

      // existsSync はデフォルト true
      (fs.existsSync as jest.Mock).mockReturnValue(true);

      // findFiles は常に自ファイルを返す
      (vscode.workspace.findFiles as jest.Mock).mockResolvedValue([
        vscode.Uri.file(propFile),
      ]);

      // openTextDocument / showTextDocument のスタブ
      (vscode.workspace.openTextDocument as jest.Mock).mockResolvedValue({
        lineAt: () => ({ text: "ccc=3" }),
        getText: () => fs.readFileSync(propFile, "utf8"),
        uri: { fsPath: propFile },
        save: jest.fn(),
      } as any);
      (vscode.window.showTextDocument as jest.Mock).mockResolvedValue({
        selection: undefined,
        revealRange: jest.fn(),
      } as any);
    });

    afterEach(() => {
      jest.clearAllMocks();
    });

    it("globでマッチなしならエラーを表示する", async () => {
      (vscode.workspace.findFiles as jest.Mock).mockResolvedValue([]);
      await addPropertyKey("foo", "no.glob");
      assert.strictEqual(
        (vscode.window.showErrorMessage as jest.Mock).mock.calls[0][0],
        "❌ Property file not found: no.glob"
      );
    });

    it("絶対パスかつ existsSync=false ならエラーを表示する", async () => {
      const abs = path.join(tmpDir, "doesNotExist.properties");
      // fileToUse の existsSync
      (fs.existsSync as jest.Mock)
        .mockReturnValueOnce(false) // fileToUse チェック
        .mockReturnValueOnce(false); // targetPath チェック（今回は同じパスを返す設定）
      (vscode.workspace.findFiles as jest.Mock).mockResolvedValue([
        vscode.Uri.file(abs),
      ]);

      await addPropertyKey("foo", abs);
      assert.strictEqual(
        (vscode.window.showErrorMessage as jest.Mock).mock.calls[0][0],
        `❌ Property file not found: ${abs}`
      );
    });

    it("キー重複なら警告を表示しファイルは変更されない", async () => {
      await addPropertyKey("aaa", propFile);
      assert.strictEqual(
        (vscode.window.showWarningMessage as jest.Mock).mock.calls[0][0],
        `⚠️ "aaa" already exists in ${path.basename(propFile)}.`
      );
      assert.deepStrictEqual(fs.readFileSync(propFile, "utf8").split("\n"), [
        "aaa=1",
        "ccc=3",
      ]);
    });

    it("新規キーをソート順で挿入し保存→再オープンを行う", async () => {
      await addPropertyKey("bbb", propFile);
      assert.deepStrictEqual(fs.readFileSync(propFile, "utf8").split(/\r?\n/), [
        "aaa=1",
        "bbb=",
        "ccc=3",
      ]);
      assert.ok(
        (vscode.window.showInformationMessage as jest.Mock).mock.calls.length >
          0
      );
      assert.ok(
        (vscode.workspace.openTextDocument as jest.Mock).mock.calls.length > 0
      );
      assert.ok(
        (vscode.window.showTextDocument as jest.Mock).mock.calls.length > 0
      );
    });

    it("コメント行に同じキーがあっても新規に追加される", async () => {
      fs.writeFileSync(propFile, ["# aaa=comment", "ccc=3"].join("\n"));
      await addPropertyKey("aaa", propFile);
      const lines = fs.readFileSync(propFile, "utf8").split(/\r?\n/);
      assert.ok(lines.includes("aaa="));
    });

    it("不正行があってもキーを正常に追加する", async () => {
      fs.writeFileSync(propFile, ["ccc=3", "BAD_LINE"].join("\n"));
      await addPropertyKey("bbb", propFile);
      const lines = fs.readFileSync(propFile, "utf8").split(/\r?\n/);
      assert.ok(lines.includes("bbb="));
      assert.ok(lines.includes("BAD_LINE"));
    });

    it("findFilesでヒットしたが targetPath が存在しない場合は第２のエラー分岐を実行する", async () => {
      const fakePath = path.join(tmpDir, "fake.properties");
      // fileToUse を相対パターンとし、existsSync は最初 fileToUse チェックで false、
      // 次に targetPath(fakePath) チェックでも false を返す
      (fs.existsSync as jest.Mock)
        .mockReturnValueOnce(false) // fileToUse
        .mockReturnValueOnce(false); // targetPath
      (vscode.workspace.findFiles as jest.Mock).mockResolvedValue([
        vscode.Uri.file(fakePath),
      ]);

      await addPropertyKey("newKey", "*.properties");
      assert.strictEqual(
        (vscode.window.showErrorMessage as jest.Mock).mock.calls[0][0],
        `❌ Property file not found: ${fakePath}`
      );
    });

    it("辞書順に追加される", async () => {
      await addPropertyKey("bbb", propFile);
      const lines = fs.readFileSync(propFile, "utf8").split(/\r?\n/);
      assert.deepStrictEqual(lines, ["aaa=1", "bbb=", "ccc=3"]);
    });

    it("プロパティファイルを開き editor が返ってきたら selection/revealRange が呼ばれる", async () => {
      // showTextDocument が返すエディタをモック
      const mockEditor: any = {
        selection: undefined,
        revealRange: jest.fn(),
      };
      (vscode.window.showTextDocument as jest.Mock).mockResolvedValueOnce(
        mockEditor
      );

      // addPropertyKey 実行（beforeEach で propFile は ["aaa=1","ccc=3"]）
      await addPropertyKey("bbb", propFile);

      // editor.selection がセットされている
      expect(mockEditor.selection).toBeDefined();
      // revealRange が呼ばれている
      expect(mockEditor.revealRange).toHaveBeenCalled();
    });

    it("次のキーが keyLineMap にないときは allLines.length を使ってファイル末尾に挿入される", async () => {
      // 1) 一時ファイルを準備
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "test-utils-"));
      const file = path.join(tmp, "fallback.properties");
      // 存在する内容: b=1 (mapに入る), badline (mapに入らない), c=2 (mapに入る)
      fs.writeFileSync(file, ["b=1", "badline", "c=2"].join("\n"), "utf-8");

      // 2) config でこのファイルを検索対象にする
      jest.spyOn(vscode.workspace, "getConfiguration").mockReturnValue({
        get: (_section: string, _def: string[]) => [file],
      } as any);
      (vscode.workspace.findFiles as jest.Mock).mockResolvedValue([
        vscode.Uri.file(file),
      ]);

      // 3) openTextDocument/showTextDocument のスタブ
      (vscode.workspace.openTextDocument as jest.Mock).mockResolvedValue({
        lineAt: (_: number) => ({ text: "" }),
        getText: () => fs.readFileSync(file, "utf-8"),
        uri: { fsPath: file },
        save: jest.fn(),
      } as any);
      const mockEd: any = { selection: undefined, revealRange: jest.fn() };
      (vscode.window.showTextDocument as jest.Mock).mockResolvedValue(mockEd);

      // 4) 新キー "ba" を挿入 (ソート順 ["b","ba","badline","c"] → nextKey="badline" → mapに無い)
      await addPropertyKey("ba", file);

      // 5) 末尾に "ba=" が追加されていること
      const lines = fs.readFileSync(file, "utf-8").split(/\r?\n/);
      assert.deepStrictEqual(lines, ["b=1", "badline", "c=2", "ba="]);
    });

    it("showTextDocument が undefined を返した場合、selection/revealRange をスキップしてエラーにしない", async () => {
      // showTextDocument が undefined を返すようにセット
      (vscode.window.showTextDocument as jest.Mock).mockResolvedValueOnce(
        undefined
      );

      // 問題なく完了すること
      await addPropertyKey("xyz", propFile);

      // エラー表示は出ていないこと
      expect(
        vscode.window.showErrorMessage as jest.Mock
      ).not.toHaveBeenCalled();
      // 情報表示は出ていること（挿入自体は行われているはず）
      expect(
        vscode.window.showInformationMessage as jest.Mock
      ).toHaveBeenCalled();
    });
  });

  describe("findPropertiesFiles / readPropertiesFile / getMessageValueForKey", () => {
    let tmpDir: string, f1: string, f2: string;

    beforeEach(() => {
      // テスト用ディレクトリとプロパティファイルを作成
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "test-utils-"));
      f1 = path.join(tmpDir, "one.properties");
      f2 = path.join(tmpDir, "two.properties");
      fs.writeFileSync(f1, "k1=v1\nk2=v2");
      fs.writeFileSync(f2, "k3=v3\nk4=v4");

      // workspace.getConfiguration のモック
      jest.spyOn(vscode.workspace, "getConfiguration").mockReturnValue({
        get: () => [path.join(tmpDir, "*.properties")],
      } as any);

      // findFiles のモック
      (vscode.workspace.findFiles as jest.Mock).mockResolvedValue([
        vscode.Uri.file(f1),
        vscode.Uri.file(f2),
      ]);

      // openTextDocument のモック実装：可変長引数で受け取り、args[0] を Uri として扱う
      jest
        .spyOn(vscode.workspace as any, "openTextDocument")
        .mockImplementation(async (...args: any[]) => {
          const uri = args[0] as vscode.Uri;
          return {
            getText: () => fs.readFileSync(uri.fsPath, "utf8"),
          };
        });
    });

    it("findPropertiesFiles は一致する URI を返す", async () => {
      const uris = await findPropertiesFiles();
      assert.deepStrictEqual(uris.map((u) => u.fsPath).sort(), [f1, f2].sort());
    });

    it("readPropertiesFile は行配列を返す", async () => {
      const { lines } = await readPropertiesFile(vscode.Uri.file(f1));
      assert.deepStrictEqual(lines, ["k1=v1", "k2=v2"]);
    });

    it("getMessageValueForKey は最初の一致を返す", async () => {
      assert.strictEqual(await getMessageValueForKey("k1"), "v1");
      assert.strictEqual(await getMessageValueForKey("k3"), "v3");
    });

    it("getMessageValueForKey は未定義キーで undefined を返す", async () => {
      assert.strictEqual(await getMessageValueForKey("missing"), undefined);
    });
  });

  // ── test/utils.test.ts の末尾に追記 ──

  describe("findPropertiesFiles – propertyFileGlobs デフォルト値", () => {
    it("設定未指定 → globs が []（default） → 空の URI 配列を返す", async () => {
      // config.get で defaultValue (= []) を返すようにモック
      jest.spyOn(vscode.workspace, "getConfiguration").mockReturnValue({
        get: (_section: string, defaultValue: any) => defaultValue,
      } as any);

      // findFiles が呼ばれてもしない想定なので空
      (vscode.workspace.findFiles as jest.Mock).mockResolvedValue([]);

      const uris = await findPropertiesFiles();
      assert.deepStrictEqual(uris, []);
    });
  });

  describe("findPropertyLocation – propertyFileGlobs デフォルト値", () => {
    it("設定未指定 → customGlobs が [] → for-of をスキップして null を返す", async () => {
      jest.spyOn(vscode.workspace, "getConfiguration").mockReturnValue({
        get: (_section: string, defaultValue: any) => defaultValue,
      } as any);

      // findFiles は呼び出されないので何を返しても OK
      (vscode.workspace.findFiles as jest.Mock).mockResolvedValue([]);

      const loc = await findPropertyLocation("ANY_KEY");
      assert.strictEqual(loc, null);
    });
  });

  describe("readPropertiesFile 空ファイル分岐 (allLines.length)", () => {
    it("内容ゼロバイトの .properties は [''] を返し、length=1 になる", async () => {
      // 空ファイルを作成
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "empty-"));
      const emptyPath = path.join(tmp, "empty.properties");
      fs.writeFileSync(emptyPath, "");

      const { lines } = await readPropertiesFile(vscode.Uri.file(emptyPath));
      // split(/\r?\n/) の結果は [""] なので length=1
      assert.deepStrictEqual(lines, [""]);
      assert.strictEqual(lines.length, 1);
    });
  });

  describe("findPropertiesFiles / propertyFileGlobs デフォルト", () => {
    it("設定未指定 → globs が空配列となり、空の URI 配列を返す", async () => {
      // config.get の mock が defaultValue を正しく返すようにする
      jest.spyOn(vscode.workspace, "getConfiguration").mockReturnValue({
        get: (_section: string, defaultValue: string[]) => defaultValue,
      } as any);

      // findFiles が呼ばれても何も返さない（呼ばれないはず）
      (vscode.workspace.findFiles as jest.Mock).mockResolvedValue([
        vscode.Uri.file("/should/not/be/used.properties"),
      ]);

      const uris = await findPropertiesFiles();
      assert.deepStrictEqual(uris, []);
    });

    it("設定あり → globs に従って findFiles を呼び出し、その結果を返す", async () => {
      // f1, f2 は describe ブロック外で定義済みと仮定
      const f1 = vscode.Uri.file("/tmp/a.properties");
      const f2 = vscode.Uri.file("/tmp/b.properties");
      jest.spyOn(vscode.workspace, "getConfiguration").mockReturnValue({
        get: (_section: string, _defaultValue: string[]) => ["**/*.properties"],
      } as any);
      (vscode.workspace.findFiles as jest.Mock).mockResolvedValueOnce([f1, f2]);

      const uris = await findPropertiesFiles();
      assert.deepStrictEqual(uris.map((u) => u.fsPath).sort(), [
        "/tmp/a.properties",
        "/tmp/b.properties",
      ]);
    });
  });

  describe("findPropertyLocation / propertyFileGlobs デフォルト", () => {
    it("設定未指定 → customGlobs が空配列となり、null を返す", async () => {
      jest.spyOn(vscode.workspace, "getConfiguration").mockReturnValue({
        get: (_section: string, defaultValue: string[]) => defaultValue,
      } as any);

      // findFiles が呼ばれても何も返さない（呼ばれないはず）
      (vscode.workspace.findFiles as jest.Mock).mockResolvedValue([
        vscode.Uri.file("/should/not/be/used.properties"),
      ]);

      const loc = await findPropertyLocation("anyKey");
      assert.strictEqual(loc, null);
    });
  });

  // ── 1) loadPropertyDefinitions の customPropertyGlobs 分岐 ──
  describe("loadPropertyDefinitions – customPropertyGlobs が指定された場合", () => {
    it("customPropertyGlobs を優先して読み込み、config.get は呼ばれない", async () => {
      // 1) 一時ディレクトリと .properties を作成
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "test-utils-"));
      const file = path.join(tmp, "custom.properties");
      fs.writeFileSync(file, "ckey=cval\n");

      // 2) config.get が呼ばれたらエラーを投げるようにモック
      const getSpy = jest.fn(() => {
        throw new Error("should not call");
      });
      jest
        .spyOn(vscode.workspace, "getConfiguration")
        .mockReturnValue({ get: getSpy } as any);

      // 3) findFiles が custom globs を受け取って自ファイルを返す
      (vscode.workspace.findFiles as jest.Mock).mockResolvedValue([
        vscode.Uri.file(file),
      ]);

      // 4) customPropertyGlobs に tmp/*.properties を渡す
      await loadPropertyDefinitions([path.join(tmp, "*.properties")]);

      // 5) キャッシュに ckey→cval が入っていること
      expect(getPropertyValue("ckey")).toBe("cval");

      // config.get は一切呼ばれていない
      expect(getSpy).not.toHaveBeenCalled();
    });
  });

  // ── 2) findPropertyLocation の line.text.length 分岐 ──
  describe("findPropertyLocation – position.character に line.text.length を使う", () => {
    it("行末の文字数を character にセットする", async () => {
      // 1) 一時ディレクトリと .properties を用意
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "test-utils-"));
      const file = path.join(tmp, "app.properties");
      fs.writeFileSync(file, ["foo=123", "bar=XYZ"].join("\n"), "utf-8");

      // 2) customPropertyGlobs に自ファイルを指定
      jest.spyOn(vscode.workspace, "getConfiguration").mockReturnValue({
        get: (_: string, def: string[]) => [path.join(tmp, "*.properties")],
      } as any);
      (vscode.workspace.findFiles as jest.Mock).mockResolvedValue([
        vscode.Uri.file(file),
      ]);

      // 3) "bar" を探す
      const loc = await findPropertyLocation("bar");

      expect(loc).not.toBeNull();
      // line=1 (0-origin)
      expect(loc!.position.line).toBe(1);
      // lines[1] === "bar=XYZ", length === 7
      expect(loc!.position.character).toBe("bar=XYZ".length);
    });
  });

  // ── utils.ts のカバレッジギャップを埋める追加テスト ──

  describe("loadPropertyDefinitions – config.get fallback 分岐", () => {
    it("引数なし(customPropertyGlobs=[]) → config.get の値を使って読み込み、キャッシュされる", async () => {
      // 1) 一時ディレクトリと .properties を用意
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "test-utils-"));
      const file = path.join(tmp, "cfg.properties");
      fs.writeFileSync(file, "k1=v1\nk2=v2", "utf-8");

      // 2) config.get でここを返すようにモック
      jest.spyOn(vscode.workspace, "getConfiguration").mockReturnValue({
        get: (_section: string, defaultValue: string[]) => [
          path.join(tmp, "*.properties"),
        ],
      } as any);

      // 3) findFiles は先ほどの URI を返す
      (vscode.workspace.findFiles as jest.Mock).mockResolvedValue([
        vscode.Uri.file(file),
      ]);

      // 4) カスタム引数なしで呼び出し
      await loadPropertyDefinitions();

      // 5) キャッシュが正しくとれていること
      assert.strictEqual(getPropertyValue("k1"), "v1");
      assert.strictEqual(getPropertyValue("k2"), "v2");
    });
  });

  describe("addPropertyKey keyLineMap フォールバック (allLines.length) 分岐", () => {
    it("次のキーが keyLineMap にないときは allLines.length を使って末尾に挿入される", async () => {
      // 1) 一時ファイルを用意 (badline が混ざってる)
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "test-utils-"));
      const file = path.join(tmp, "mixed.properties");
      fs.writeFileSync(file, ["b=1", "badline", "c=2"].join("\n"), "utf-8");

      // 2) workspace.findFiles→このファイルを返す
      jest.spyOn(vscode.workspace, "getConfiguration").mockReturnValue({
        get: (_: string, def: string[]) => [file],
      } as any);
      (vscode.workspace.findFiles as jest.Mock).mockResolvedValue([
        vscode.Uri.file(file),
      ]);

      // 3) ここでも openTextDocument/showTextDocument を最低限モック
      (vscode.workspace.openTextDocument as jest.Mock).mockResolvedValue({
        lineAt: (_: any) => ({ text: "" }),
        getText: () => fs.readFileSync(file, "utf-8"),
        uri: { fsPath: file },
        save: jest.fn(),
      } as any);
      const mockEd: any = { selection: undefined, revealRange: jest.fn() };
      (vscode.window.showTextDocument as jest.Mock).mockResolvedValue(mockEd);

      // 4) addPropertyKey で "a" を挿入
      await addPropertyKey("a", file);

      // 5) 挿入結果を検証
      const lines = fs.readFileSync(file, "utf-8").split(/\r?\n/);
      // badline は map にないので末尾に "a=" が入っている
      assert.deepStrictEqual(lines, ["a=", "b=1", "badline", "c=2"]);
    });
  });

  describe("addPropertyKey propEd フォールバック (eqIdx<0 → line.text.length) 分岐", () => {
    it("挿入行の text に '=' がないときはキャレットを行末(line.text.length)に移動する", async () => {
      // 1) 元ファイルを用意
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "test-utils-"));
      const file = path.join(tmp, "demo.properties");
      fs.writeFileSync(file, ["x=1", "y=2"].join("\n"), "utf-8");

      // 2) findFiles → file
      jest.spyOn(vscode.workspace, "getConfiguration").mockReturnValue({
        get: (_: string, def: string[]) => [file],
      } as any);
      (vscode.workspace.findFiles as jest.Mock).mockResolvedValue([
        vscode.Uri.file(file),
      ]);

      // 3) openTextDocument の stub: 挿入後の propDoc.lineAt は '=' を含まない
      (vscode.workspace.openTextDocument as jest.Mock).mockResolvedValue({
        lineAt: (_: number) => ({ text: "noequals" }),
        getText: () => fs.readFileSync(file, "utf-8"),
        uri: { fsPath: file },
        save: jest.fn(),
      } as any);

      // 4) showTextDocument の stub: editor オブジェクトをキャプチャ
      const mockEd: any = { selection: undefined, revealRange: jest.fn() };
      (vscode.window.showTextDocument as jest.Mock).mockResolvedValue(mockEd);

      // 5) 挿入実行
      await addPropertyKey("z", file);

      // 6) propEd.selection.character が line.text.length (9) になっている
      const expectedLen = "noequals".length;
      assert.strictEqual(mockEd.selection.start.character, expectedLen);
      assert.ok(mockEd.revealRange.mock.calls.length > 0);
    });
  });

  describe("loadPropertyDefinitions – config.get & OR-fallback “none” 分岐", () => {
    it("customPropertyGlobs が空→config.get の glob を使い、findFiles 結果 0 件で “none” フォールバックされる", async () => {
      // config.get でこのパターンを返すようにモック
      jest.spyOn(vscode.workspace, "getConfiguration").mockReturnValue({
        get: (_section: string, defaultValue: string[]) => ["**/*.foo"],
      } as any);

      // findFiles が常に空配列を返す
      (vscode.workspace.findFiles as jest.Mock).mockResolvedValue([]);

      // ログをキャプチャ
      const logs: string[] = [];
      (outputChannel.appendLine as jest.Mock).mockImplementation((msg) => {
        logs.push(msg);
      });

      // 引数なしで呼び出し（customPropertyGlobs = []）
      await loadPropertyDefinitions();

      // 「→ found: none」が出力されているはず
      expect(logs.some((l) => l.match(/→ found: none$/))).toBeTruthy();
    });
  });

  describe("addPropertyKey – eqIdx>=0 分岐 (‘=’ の直後にカーソル移動)", () => {
    it("挿入行に ‘=’ が含まれるときは eqIdx+1 がキャレット位置になる", async () => {
      // 1) ファイル準備
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "test-utils-"));
      const file = path.join(tmp, "demo_eq.properties");
      fs.writeFileSync(file, ["x=1", "y=2"].join("\n"), "utf-8");

      // 2) workspace.findFiles→このファイル
      jest.spyOn(vscode.workspace, "getConfiguration").mockReturnValue({
        get: (_s: string, _d: string[]) => [file],
      } as any);
      (vscode.workspace.findFiles as jest.Mock).mockResolvedValue([
        vscode.Uri.file(file),
      ]);

      // 3) openTextDocument→propDoc.lineAt を stub。挿入行 ("z=") に合わせて返す。
      (vscode.workspace.openTextDocument as jest.Mock).mockResolvedValue({
        lineAt: (idx: number) => {
          // 新キー 'z' を 末尾（idx=2）にスプライスすると、
          // allLines = ["x=1","y=2"] → splice(2,0,"z=")
          // 挿入行は idx===2
          return { text: idx === 2 ? "z=" : "" };
        },
        getText: () => fs.readFileSync(file, "utf-8"),
        uri: { fsPath: file },
        save: jest.fn(),
      } as any);

      // 4) showTextDocument→editor stub
      const mockEd: any = { selection: undefined, revealRange: jest.fn() };
      (vscode.window.showTextDocument as jest.Mock).mockResolvedValue(mockEd);

      // 5) 実行: 新キー 'z' を追加
      await addPropertyKey("z", file);

      // 6) selection.character は '=' の index( idx===2 の "z=" → eqIdx=1 ) +1 = 2
      expect(mockEd.selection.start.character).toBe(2);
      expect(mockEd.revealRange).toHaveBeenCalled();
    });
  });

  describe("loadPropertyDefinitions デフォルトパラメータ時の propertyFileGlobs フォールバック", () => {
    it("引数なしで呼び出すと設定から globs を取得してキャッシュに登録される", async () => {
      // テスト用の一時ディレクトリ・プロパティファイルを用意
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "test-utils-"));
      const propFile = path.join(tmpDir, "fallback.properties");
      fs.writeFileSync(propFile, "fbkey=fbval");

      // config.get("propertyFileGlobs", []) がこのパターンを返すようにモック
      jest.spyOn(vscode.workspace, "getConfiguration").mockReturnValue({
        get: (section: string, defaultValue: any) =>
          section === "propertyFileGlobs"
            ? [`${tmpDir}/*.properties`]
            : defaultValue,
      } as any);

      // findFiles, existsSync 周りをモック
      (vscode.workspace.findFiles as jest.Mock).mockResolvedValue([
        vscode.Uri.file(propFile),
      ]);
      (fs.existsSync as jest.Mock).mockReturnValue(true);

      // 引数なしで呼び出す
      await loadPropertyDefinitions();

      // キャッシュに登録されていることを確認
      assert.strictEqual(getPropertyValue("fbkey"), "fbval");
    });
  });
});
