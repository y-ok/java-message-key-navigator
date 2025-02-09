import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { outputChannel } from "./outputChannel";

// ✅ messages.properties のパスを取得
export function getPropertiesFilePath(): string {
  return path.join(
    vscode.workspace.rootPath || "",
    "src/main/resources/messages.properties"
  );
}

// ✅ すべてのキーを取得
export function getAllPropertyKeys(): string[] {
  const propertiesPath = getPropertiesFilePath();
  if (!fs.existsSync(propertiesPath)) return [];

  const content = fs.readFileSync(propertiesPath, "utf-8");
  return content
    .split("\n")
    .map((line) => line.split("=")[0].trim())
    .filter((key) => key.length > 0);
}

// ✅ メッセージキーの値を取得
export function getPropertyValue(key: string): string | null {
  const properties = getProperties();
  return properties[key] || null;
}

// ✅ propertiesファイルを読み込む
function getProperties(): { [key: string]: string } {
  const propertiesPath = getPropertiesFilePath();
  if (!fs.existsSync(propertiesPath)) return {};

  const content = fs.readFileSync(propertiesPath, "utf-8");
  return Object.fromEntries(
    content
      .split("\n")
      .map((line) => line.split("=").map((v) => v.trim()))
      .filter(([k, v]) => k && v)
  );
}

// ✅ メッセージキーが存在するかチェック
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
    line.trim().startsWith(`${key} =`)
  );

  if (lineIndex !== -1) {
    return {
      filePath: propertiesPath,
      position: new vscode.Position(lineIndex, 0),
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
    (method) => new RegExp(`${method}\\(\\s*\"([^\"]+)\"`, "g")
  );
}

// ✅ 未定義のキーを properties に追加 & 追加後にジャンプ + カーソルを末尾に配置
export async function addPropertyKey(key: string) {
  const propertiesPath = getPropertiesFilePath();
  const newEntry = `\n${key}=`;

  try {
    // ✅ messages.properties にキーを追加
    fs.appendFileSync(propertiesPath, newEntry, "utf-8");

    vscode.window.showInformationMessage(
      `✅ messages.properties に "${key}" を追加しました！`
    );

    // ✅ messages.properties を開く
    const document = await vscode.workspace.openTextDocument(propertiesPath);
    const editor = await vscode.window.showTextDocument(document);

    // ✅ 追加したキーの位置を検索
    const content = document.getText().split("\n");
    const lineIndex = content.findIndex((line) =>
      line.trim().startsWith(`${key} =`)
    );

    if (lineIndex !== -1) {
      const position = new vscode.Position(lineIndex, `${key}=`.length);
      editor.selection = new vscode.Selection(position, position);
      editor.revealRange(new vscode.Range(position, position));

      // ✅ フォーカスをエディタに設定
      await vscode.commands.executeCommand(
        "workbench.action.focusActiveEditorGroup"
      );

      outputChannel.appendLine(
        `📍 ${key} を追加 & カーソルを設定: ${lineIndex}行目`
      );
    }
  } catch (error) {
    vscode.window.showErrorMessage(`❌ メッセージキー追加失敗: ${error}`);
    outputChannel.appendLine(`❌ エラー: ${error}`);
  }
}
