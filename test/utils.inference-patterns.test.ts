import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { strict as assert } from "assert";
import * as vscode from "vscode";

jest.mock("vscode", () => ({
  __esModule: true,
  workspace: {
    getConfiguration: jest.fn(),
    findFiles: jest.fn(),
    openTextDocument: jest.fn(),
  },
  window: {
    createOutputChannel: jest.fn(),
    showErrorMessage: jest.fn(),
    showWarningMessage: jest.fn(),
    showInformationMessage: jest.fn(),
    showTextDocument: jest.fn(),
  },
  Uri: { file: (fsPath: string) => ({ fsPath }) },
  Position: class {
    constructor(public line: number, public character: number) {}
  },
  Range: class {
    constructor(public start: any, public end: any) {}
  },
  Selection: class {
    constructor(public start: any, public end: any) {}
  },
  ViewColumn: { One: 1 },
}));

jest.mock("../src/outputChannel", () => ({
  __esModule: true,
  outputChannel: { appendLine: jest.fn(), clear: jest.fn() },
}));

import { getCustomPatterns, loadPropertyDefinitions } from "../src/utils";

describe("getCustomPatterns inference", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("infers method and annotation patterns when both settings are empty", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "infer-patterns-"));
    const propFile = path.join(tmpDir, "messages.properties");
    fs.writeFileSync(propFile, "MSG_START=a\nMSG_END=b\n");

    (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
      get: (section: string, def: any) => {
        if (section === "propertyFileGlobs") {
          return [`${tmpDir}/*.properties`];
        }
        return def;
      },
    });
    (vscode.workspace.findFiles as jest.Mock).mockResolvedValue([
      vscode.Uri.file(propFile),
    ]);

    await loadPropertyDefinitions();
    const text = [
      `appLogger.warn("MSG_START");`,
      `@LogStartEnd(start = "MSG_END")`,
    ].join("\n");

    const regexes = getCustomPatterns(text);
    assert.ok(regexes.some((re) => re.test(`appLogger.warn("MSG_START")`)));
    assert.ok(
      regexes.some((re) => re.test(`@LogStartEnd(start = "MSG_END")`)),
      `inferred annotation regexes: ${regexes.map((r) => r.source).join(", ")}`
    );
    assert.ok(regexes.some((re) => re.test(`messageSource.getMessage("K")`)));
  });

  it("falls back to messageSource pattern when inference source is insufficient", () => {
    (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
      get: (_section: string, def: any) => def,
    });

    const regexes = getCustomPatterns("");
    assert.strictEqual(regexes.length, 1);
    assert.ok(regexes[0].test(`messageSource.getMessage("X")`));
  });
});
