import { strict as assert } from "assert";

jest.mock("vscode", () => ({
  __esModule: true,
  Diagnostic: jest.fn(),
  DiagnosticSeverity: {
    Warning: 1,
    Error: 2,
  },
  Range: jest.fn().mockImplementation((start: any, end: any) => ({
    start,
    end,
  })),
}));

jest.mock("../src/utils", () => ({
  __esModule: true,
  loadPropertyDefinitions: jest.fn(),
  getCustomPatterns: jest.fn(),
  isPropertyDefined: jest.fn(),
}));

jest.mock("../src/outputChannel", () => ({
  __esModule: true,
  outputChannel: {
    appendLine: jest.fn(),
  },
}));

import * as utils from "../src/utils";
import { validateProperties } from "../src/PropertyValidator";

describe("validateProperties reload option", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (utils.getCustomPatterns as jest.Mock).mockReturnValue([]);
    (utils.isPropertyDefined as jest.Mock).mockReturnValue(true);
    (utils.loadPropertyDefinitions as jest.Mock).mockResolvedValue(undefined);
  });

  it("reloadPropertyDefinitions=false なら loadPropertyDefinitions を呼ばない", async () => {
    const document: any = {
      uri: { fsPath: "/src/A.java" },
      getText: () => "",
      positionAt: (n: number) => ({ line: 0, character: n }),
    };
    const diagnostics: any = {
      set: jest.fn(),
    };

    await validateProperties(
      document,
      diagnostics,
      ["**/*.properties"],
      { reloadPropertyDefinitions: false }
    );

    assert.strictEqual(
      (utils.loadPropertyDefinitions as jest.Mock).mock.calls.length,
      0
    );
  });

  it("オプション省略時は loadPropertyDefinitions を呼ぶ", async () => {
    const document: any = {
      uri: { fsPath: "/src/A.java" },
      getText: () => "",
      positionAt: (n: number) => ({ line: 0, character: n }),
    };
    const diagnostics: any = {
      set: jest.fn(),
    };

    await validateProperties(document, diagnostics, ["**/*.properties"]);

    assert.strictEqual(
      (utils.loadPropertyDefinitions as jest.Mock).mock.calls.length,
      1
    );
  });
});
