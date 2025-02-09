import * as fs from "fs";
import * as os from "os"; // OSごとの改行コード対応
import * as path from "path";
import * as vscode from "vscode";
import { outputChannel } from "./outputChannel";

// ✅ `messages.properties` のパスを取得
export function getPropertiesFilePath(): string {
  return path.join(
    vscode.workspace.rootPath || "",
    "src/main/resources/messages.properties"
  );
}

// ✅ すべてのメッセージキーを取得
export function getAllPropertyKeys(): string[] {
  const propertiesPath = getPropertiesFilePath();
  if (!fs.existsSync(propertiesPath)) return [];

  const content = fs.readFileSync(propertiesPath, "utf-8");
  return content
    .split("\n")
    .map((line) => line.split("=")[0].trim()) // "=" の前のキーのみ取得
    .filter((key) => key.length > 0);
}

// ✅ メッセージキーの値を取得
export function getPropertyValue(key: string): string | null {
  const properties = getProperties();
  return properties[key] || null;
}

// ✅ `messages.properties` を読み込む
function getProperties(): { [key: string]: string } {
  const propertiesPath = getPropertiesFilePath();
  if (!fs.existsSync(propertiesPath)) return {};

  const content = fs.readFileSync(propertiesPath, "utf-8");

  return Object.fromEntries(
    content
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("#")) // 空行・コメント行を無視
      .map((line) => {
        const [key, ...valueParts] = line.split("="); // `=` で分割
        const value = valueParts.join("=").trim(); // `=` を含む値も正しく結合

        return [key.trim(), value]; // **valueが空でもOKに変更**
      })
  );
}

// ✅ メッセージキーが定義されているかチェック
export function isPropertyDefined(key: string): boolean {
  return Object.hasOwn(getProperties(), key);
}

// ✅ メッセージキーの定義位置を取得
export function findPropertyLocation(
  key: string
): { filePath: string; position: vscode.Position } | null {
  const propertiesPath = getPropertiesFilePath();
  if (!fs.existsSync(propertiesPath)) return null;

  const content = fs.readFileSync(propertiesPath, "utf-8").split("\n");
  const lineIndex = content.findIndex((line) =>
    line.trim().startsWith(`${key}=`)
  );

  if (lineIndex !== -1) {
    const lineText = content[lineIndex]; // 対象行の全文を取得
    const valueStartIndex = key.length + 1; // `=` の **右側の開始位置**
    const valueEndIndex = lineText.length; // 値の **末尾**

    // ✅ `key=xxx` の `xxx` の末尾にカーソルを配置
    return {
      filePath: propertiesPath,
      position: new vscode.Position(lineIndex, valueEndIndex),
    };
  }
  return null;
}

// ✅ カスタムメソッドの正規表現を取得
export function getCustomPatterns(): RegExp[] {
  const config = vscode.workspace.getConfiguration("java-i18n-ally");
  const customMethods = config.get<string[]>("customMethods", []);
  const methods = [...customMethods, "messageSource.getMessage"];

  return methods.map(
    (method) => new RegExp(`${method}\\(\\s*\\"([^\\"]+)\\"`, "g")
  );
}

// ✅ 未定義のキーを `messages.properties` に追加 & 追加後にジャンプ + カーソルを "=" の右側に配置
export async function addPropertyKey(key: string) {
  const propertiesPath = getPropertiesFilePath();
  const newEntry = `${key}=`; // OSごとの改行コードを適用せず追加（手動で行末に改行）

  try {
    // ✅ `messages.properties` を開いて、現在の行数を取得
    let document = await vscode.workspace.openTextDocument(propertiesPath);
    const initialLineCount = document.lineCount;

    // ✅ 既に存在するキーを追加しないようチェック
    const existingKeys = getAllPropertyKeys();
    if (existingKeys.includes(key)) {
      vscode.window.showWarningMessage(
        `⚠️ "${key}" はすでに messages.properties に存在します。`
      );
      return;
    }

    // ✅ messages.properties の末尾にキーを追加（手動で `\n` を加える）
    fs.appendFileSync(propertiesPath, os.EOL + newEntry, "utf-8");

    vscode.window.showInformationMessage(
      `✅ messages.properties に "${key}" を追加しました！`
    );

    // ✅ `document` を再取得して最新の状態に更新
    await new Promise((resolve) => setTimeout(resolve, 100)); // 小さな遅延を挟む
    document = await vscode.workspace.openTextDocument(propertiesPath);
    const editor = await vscode.window.showTextDocument(document);

    // ✅ 追加したキーの **行番号** を取得（`initialLineCount` がそのまま追加行になる）
    const lineIndex = initialLineCount;

    // ✅ `key=` の `=` の **右側** にカーソルを配置
    const position = new vscode.Position(lineIndex, key.length + 1);
    editor.selection = new vscode.Selection(position, position);
    editor.revealRange(new vscode.Range(position, position));

    // ✅ フォーカスをエディタに設定
    await vscode.commands.executeCommand(
      "workbench.action.focusActiveEditorGroup"
    );

    outputChannel.appendLine(
      `📍 ${key}= を追加 & カーソルを "=" の右側に設定: ${lineIndex}行目`
    );
  } catch (error) {
    vscode.window.showErrorMessage(`❌ メッセージキー追加失敗: ${error}`);
    outputChannel.appendLine(`❌ エラー: ${error}`);
  }
}
