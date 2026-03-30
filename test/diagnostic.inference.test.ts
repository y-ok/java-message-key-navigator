import { strict as assert } from "assert";

const executeCommand = jest.fn();

const getMessageValueForKey = jest.fn();
const getAllPropertyKeys = jest.fn();
jest.mock("../src/utils", () => ({
  __esModule: true,
  getMessageValueForKey,
  getAllPropertyKeys,
}));

jest.mock("../src/outputChannel", () => ({
  __esModule: true,
  outputChannel: { appendLine: jest.fn(), clear: jest.fn() },
}));

jest.mock("vscode", () => ({
  __esModule: true,
  workspace: { getConfiguration: jest.fn(), openTextDocument: jest.fn() },
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
import type { DiagnosticCollection, TextDocument } from "vscode";
import { validatePlaceholders } from "../src/diagnostic";

describe("validatePlaceholders inference mode", () => {
  let seen: any[][];
  let doc: TextDocument;
  let text: string;

  beforeEach(() => {
    jest.clearAllMocks();
    seen = [];
    text = "";
    doc = {
      languageId: "java",
      getText: () => text,
      positionAt: (offset: number) => ({
        line: 0,
        character: offset,
        translate: (_l: number, c: number) => ({ line: 0, character: offset + c }),
      }),
      uri: { fsPath: "/fake/Doc.java" },
    } as any;

    getAllPropertyKeys.mockReturnValue(["MSG_OK", "MSG_TWO"]);
    executeCommand.mockResolvedValue([]);
  });

  it("infers message method and helper arg count when settings are empty", async () => {
    text = [
      `appLogger.warn("MSG_OK", buildArgs(requestUri));`,
      `appLogger.warn("MSG_TWO", createLogParams(a, b));`,
    ].join("\n");
    getMessageValueForKey
      .mockResolvedValueOnce("Hi {0}")
      .mockResolvedValueOnce("Hi {0} {1}");

    const collection = {
      set: (_uri: any, diags: any[]) => seen.push(diags),
    } as unknown as DiagnosticCollection;
    await validatePlaceholders(doc, collection);

    assert.strictEqual(seen.length, 1);
    assert.strictEqual(seen[0].length, 0);
  });

  it("reports mismatch when inferred helper arg count differs from placeholders", async () => {
    text = `appLogger.warn("MSG_TWO", buildArgs(a));`;
    getMessageValueForKey.mockResolvedValue("Hi {0} {1}");

    const collection = {
      set: (_uri: any, diags: any[]) => seen.push(diags),
    } as unknown as DiagnosticCollection;
    await validatePlaceholders(doc, collection);

    assert.strictEqual(seen.length, 1);
    assert.strictEqual(seen[0].length, 1);
    assert.ok(seen[0][0].message.includes("Placeholder count (2)"));
  });
});
