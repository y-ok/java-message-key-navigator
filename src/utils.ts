import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { outputChannel } from "./outputChannel";

// ── モジュール内キャッシュ ─────────────────────────────────
let propertyCache: Record<string, string> = {};

/**
 * settings.json の java-message-key-navigator.propertyFileGlobs で指定された
 * Glob パターンでマッチする .properties ファイルだけを読み込み、
 * キー→値 をキャッシュします。
 */
export async function loadPropertyDefinitions(
  customPropertyGlobs: string[] = []
): Promise<void> {
  propertyCache = {};
  const workspaceFolders = vscode.workspace.workspaceFolders || [];

  for (const folder of workspaceFolders) {
    for (const pattern of customPropertyGlobs) {
      outputChannel.appendLine(`🔍 findFiles pattern: ${pattern}`);
      const uris = await vscode.workspace.findFiles(pattern);
      outputChannel.appendLine(
        `  → found: ${uris.map((u) => u.fsPath).join(", ") || "none"}`
      );
      for (const uri of uris) {
        const fp = uri.fsPath;
        if (!fs.existsSync(fp)) continue;
        outputChannel.appendLine(`🔄 Loading properties: ${fp}`);
        const content = fs.readFileSync(fp, "utf-8");
        content
          .split(/\r?\n/)
          .filter((l) => l && !l.startsWith("#"))
          .forEach((line) => {
            const [key, ...valueParts] = line.split("=");
            propertyCache[key.trim()] = valueParts.join("=").trim();
          });
      }
    }
  }
}

/**
 * キャッシュされたすべてのキーを返します。
 */
export function getAllPropertyKeys(): string[] {
  return Object.keys(propertyCache);
}

/**
 * 指定したキーがキャッシュ内に定義されているかチェックします。
 */
export function isPropertyDefined(key: string): boolean {
  return Object.prototype.hasOwnProperty.call(propertyCache, key);
}

/**
 * キャッシュからキーの値を取得します。
 */
export function getPropertyValue(key: string): string | undefined {
  return propertyCache[key];
}

/**
 * settings.json の java-message-key-navigator.messageKeyExtractionPatterns を元に
 * メッセージキー抽出用の正規表現リストを返します。
 */
export function getCustomPatterns(): RegExp[] {
  const config = vscode.workspace.getConfiguration(
    "java-message-key-navigator"
  );
  const messageKeyExtractionPatterns = config.get<string[]>(
    "messageKeyExtractionPatterns",
    []
  );
  const methods = [...messageKeyExtractionPatterns, "messageSource.getMessage"];
  return methods.map((method) => {
    const esc = method.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`(?:[\\w$]+\\.)?${esc}\\(\\s*['"]([^'"]+)['"]`, "g");
    outputChannel.appendLine(`🔍 pattern: ${re}`);
    return re;
  });
}

/**
 * 指定したキーが定義されているファイルと位置を返します。
 * propertyFileGlobs にマッチしたファイルのみを検索対象とします。
 */
export async function findPropertyLocation(
  key: string
): Promise<{ filePath: string; position: vscode.Position } | null> {
  const config = vscode.workspace.getConfiguration(
    "java-message-key-navigator"
  );
  const customGlobs = config.get<string[]>("propertyFileGlobs", []);
  for (const pattern of customGlobs) {
    const uris = await vscode.workspace.findFiles(pattern);
    for (const uri of uris) {
      const fp = uri.fsPath;
      if (!fs.existsSync(fp)) continue;
      const lines = fs.readFileSync(fp, "utf-8").split(/\r?\n/);
      const idx = lines.findIndex((l) => l.trim().startsWith(`${key}=`));
      if (idx !== -1) {
        return {
          filePath: fp,
          position: new vscode.Position(idx, lines[idx].length),
        };
      }
    }
  }
  return null;
}

/**
 * QuickFix から呼ばれて、指定ファイルのソート順に従い
 * 指定キーを適切な位置に挿入＆カーソル移動します。
 */
export async function addPropertyKey(key: string, fileToUse: string) {
  // fileToUse が glob の場合は実ファイルパスを解決
  let targetPath = fileToUse;
  if (!path.isAbsolute(fileToUse) || !fs.existsSync(fileToUse)) {
    const uris = await vscode.workspace.findFiles(fileToUse, undefined, 1);
    if (uris.length === 0) {
      vscode.window.showErrorMessage(
        `❌ Property file not found: ${fileToUse}`
      );
      return;
    }
    targetPath = uris[0].fsPath;
  }

  if (!fs.existsSync(targetPath)) {
    vscode.window.showErrorMessage(`❌ Property file not found: ${targetPath}`);
    return;
  }

  const label = path.basename(targetPath);
  const raw = fs.readFileSync(targetPath, "utf-8");
  const allLines = raw.split(/\r?\n/);

  // 既存キー一覧を取得（空行・コメント除外）
  const keys = allLines
    .map((l) => l.split("=")[0].trim())
    .filter((k) => k && !k.startsWith("#"));

  // 重複チェック
  if (keys.includes(key)) {
    vscode.window.showWarningMessage(`⚠️ "${key}" already exists in ${label}.`);
    return;
  }

  // 挿入位置を決定：新キーより大きい最初の既存キー行の直前
  let insertIdx = allLines.length;
  for (const existingKey of keys) {
    if (existingKey > key) {
      insertIdx = allLines.findIndex((l) =>
        l.trim().startsWith(existingKey + "=")
      );
      break;
    }
  }

  // ファイル行配列に挿入
  allLines.splice(insertIdx, 0, `${key}=`);

  // 上書き保存
  fs.writeFileSync(targetPath, allLines.join(os.EOL), "utf-8");
  vscode.window.showInformationMessage(
    `✅ Added "${key}" to ${label}! (line ${insertIdx + 1})`
  );

  // カーソル移動
  await new Promise((r) => setTimeout(r, 100));
  const doc = await vscode.workspace.openTextDocument(targetPath);
  const editor = await vscode.window.showTextDocument(doc);
  const line = insertIdx;
  const pos = new vscode.Position(line, key.length + 1);
  editor.selection = new vscode.Selection(pos, pos);
  editor.revealRange(new vscode.Range(pos, pos));

  outputChannel.appendLine(`📍 Added ${key}= to ${label} at line ${line + 1}`);
}
