// jest.config.js
/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  // ← globals を削除し、transform に移動
  transform: {
    // 拡張子 .ts もしくは .tsx のファイルを ts-jest で処理
    "^.+\\.(t|j)sx?$": [
      "ts-jest",
      {
        tsconfig: "tsconfig.test.json",
      },
    ],
  },
  testMatch: ["**/test/**/*.test.ts"],
  moduleNameMapper: {
    // vscode を空モジュール（自前の stub）に置き換え
    "^vscode$": "<rootDir>/test/vscode.mock.ts",
  },
  // カバレッジを収集したいファイル
  collectCoverageFrom: ["src/**/*.ts", "!src/**/*.d.ts"],
  // カバレッジレポート出力先ディレクトリ
  coverageDirectory: "coverage",
  // 出力するレポート形式
  coverageReporters: ["text", "lcov", "html"],
};
