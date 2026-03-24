import { strict as assert } from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const findFiles = jest.fn();
const getConfiguration = jest.fn();
const openTextDocument = jest.fn();

jest.mock("vscode", () => ({
  __esModule: true,
  workspace: {
    findFiles,
    getConfiguration,
    openTextDocument,
  },
}));

jest.mock("../src/outputChannel", () => ({
  __esModule: true,
  outputChannel: {
    appendLine: jest.fn(),
  },
}));

import { getMessageValueForKey, loadPropertyDefinitions } from "../src/utils";

describe("getMessageValueForKey cache fast-path", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getConfiguration.mockReturnValue({
      get: jest.fn().mockReturnValue([]),
    });
  });

  it("キャッシュに値がある場合は findPropertiesFiles/readPropertiesFile を辿らない", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "jmk-cache-fastpath-"));
    const filePath = path.join(tmpDir, "messages.properties");
    fs.writeFileSync(filePath, "HELLO=world\n", "utf-8");

    try {
      findFiles.mockResolvedValueOnce([{ fsPath: filePath }]);
      await loadPropertyDefinitions([path.join(tmpDir, "*.properties")]);
      const findFilesCallsBefore = findFiles.mock.calls.length;

      const value = await getMessageValueForKey("HELLO");

      assert.strictEqual(value, "world");
      assert.strictEqual(findFiles.mock.calls.length, findFilesCallsBefore);
      assert.strictEqual(openTextDocument.mock.calls.length, 0);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
