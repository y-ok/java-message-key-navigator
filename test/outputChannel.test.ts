// test/outputChannel.test.ts

/**
 * 1) 最初に vscode モックを定義（jest.mock はファイル先頭で自動的に hoist されます）
 */
jest.mock("vscode", () => {
  let fakeChannel: any;
  return {
    __esModule: true,
    __setFakeChannel: (chan: any) => {
      fakeChannel = chan;
    },
    window: {
      createOutputChannel: () => fakeChannel,
    },
  };
});

import { strict as assert } from "assert";

describe("initializeOutputChannel", () => {
  let messages: string[];
  let cleared: boolean;
  let stubChannel: Partial<import("vscode").OutputChannel>;
  let vscodeMock: {
    __setFakeChannel: (chan: Partial<import("vscode").OutputChannel>) => void;
  };

  beforeEach(() => {
    // 2) テスト前にモジュールキャッシュを完全クリア
    jest.resetModules();

    // 3) fresh な vscode モックを取得して stubChannel を注入
    vscodeMock = require("vscode");
    messages = [];
    cleared = false;
    stubChannel = {
      appendLine(msg: string) {
        messages.push(msg);
      },
      clear() {
        cleared = true;
      },
    };
    vscodeMock.__setFakeChannel(stubChannel);
  });

  it("creates a new OutputChannel on first call", () => {
    // 4) テスト対象モジュールを require（fresh なモックが内部で使われる）
    const output = require("../src/outputChannel");
    output.initializeOutputChannel();

    // fakeChannel がセットされているか
    assert.strictEqual(output.outputChannel, stubChannel);

    // メッセージにタイトルが含まれているか
    assert.ok(
      messages.some((m) => m.includes("Java Message Key Navigator")),
      `Expected title log, got ${JSON.stringify(messages)}`
    );
  });

  it("clears existing OutputChannel on subsequent calls", () => {
    const output = require("../src/outputChannel");
    // 既に stubChannel がセットされている状態を作る
    output.outputChannel = stubChannel;
    output.initializeOutputChannel();

    // clear() が呼び出されたか
    assert.ok(cleared, "Expected stubChannel.clear() to have been called");
  });
});
