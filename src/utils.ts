import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";

// メッセージキーの値を取得
export function getPropertyValue(key: string): string | null {
  const properties = getProperties();
  return properties[key] || null;
}

// propertiesファイルを読み込む
function getProperties(): { [key: string]: string } {
  const propertiesPath = path.join(
    vscode.workspace.rootPath || "",
    "src/main/resources/messages.properties"
  );

  if (!fs.existsSync(propertiesPath)) {
    return {};
  }

  const content = fs.readFileSync(propertiesPath, "utf-8");
  const properties: { [key: string]: string } = {};

  content.split("\n").forEach((line, index) => {
    const match = line.match(/^\s*(.+?)\s*=\s*(.+)\s*$/);
    if (match) {
      properties[match[1].trim()] = match[2].trim();
    } else if (line.trim() !== "" && !line.startsWith("#")) {
    }
  });
  return properties;
}

// キーの定義位置を取得
export function findPropertyLocation(
  key: string
): { filePath: string; position: vscode.Position } | null {
  const propertiesPath = path.join(
    vscode.workspace.rootPath || "",
    "src/main/resources/messages.properties"
  );

  if (!fs.existsSync(propertiesPath)) {
    return null;
  }

  const content = fs.readFileSync(propertiesPath, "utf-8").split("\n");
  const lineIndex = content.findIndex((line) =>
    line.trim().match(new RegExp(`^\\s*${key}\\s*=`, "i"))
  );

  if (lineIndex !== -1) {
    return {
      filePath: propertiesPath,
      position: new vscode.Position(lineIndex, 0),
    };
  }
  return null;
}

// メッセージキーが存在するかチェック
export function isPropertyDefined(key: string): boolean {
  return getProperties().hasOwnProperty(key);
}

/**
 * ユーザー設定のカスタムメソッドを取得し、正規表現に変換
 */
export function getCustomPatterns(): RegExp[] {
  // ✅ ① デフォルトのメソッド（messageSource.getMessage のみ）
  const defaultMethods = [
    "MessageSource.getMessage",
    "messageSource.getMessage",
  ];

  // ✅ ② ユーザーが追加したカスタムメソッドを取得
  const config = vscode.workspace.getConfiguration("java-i18n-ally");
  const customMethods = config.get<string[]>("customMethods", []);

  // ✅ ③ デフォルト + カスタムメソッドを統合
  const methods = [...defaultMethods, ...customMethods];

  // ✅ ④ 各メソッドに対応する正規表現を作成
  return methods.map(
    (method) => new RegExp(`${method}\\(\\s*\"([^\"]+)\"`, "g")
  );
}

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

// ✅ 未定義のキーを properties に追加 & 追加後にジャンプ + カーソルを末尾に配置
export async function addPropertyKey(key: string) {
  const propertiesPath = getPropertiesFilePath();
  const newEntry = `\n${key} = `;

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
      const position = new vscode.Position(lineIndex, `${key} = `.length);
      editor.selection = new vscode.Selection(position, position);
      editor.revealRange(new vscode.Range(position, position));

      // ✅ フォーカスをエディタに設定
      await vscode.commands.executeCommand(
        "workbench.action.focusActiveEditorGroup"
      );
    }
  } catch (error) {
    vscode.window.showErrorMessage(`❌ メッセージキー追加失敗: ${error}`);
  }
}
