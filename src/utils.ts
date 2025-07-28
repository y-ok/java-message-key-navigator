import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { outputChannel } from "./outputChannel";

// ── モジュール内キャッシュ ─────────────────────────────────
let propertyCache: Record<string, string> = {};

/**
 * Globパターンでマッチする .properties ファイルを読み込み、
 * キー→値 をキャッシュします。
 * @param customPropertyGlobs テスト時や動的指定用のグロブ配列
 */
export async function loadPropertyDefinitions(
  customPropertyGlobs: string[] = []
): Promise<void> {
  // 1) キャッシュ初期化
  propertyCache = {};

  // 2) パターン配列を決定（引数がなければ設定値を読む）
  const config = vscode.workspace.getConfiguration(
    "java-message-key-navigator"
  );
  const globs: string[] =
    customPropertyGlobs.length > 0
      ? customPropertyGlobs
      : config.get<string[]>("propertyFileGlobs", []);

  // 3) 各グロブで findFiles → 読み込み
  for (const pattern of globs) {
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
        .filter((l) => l.trim() && !l.startsWith("#"))
        .forEach((line) => {
          const [key, ...valueParts] = line.split("=");
          propertyCache[key.trim()] = valueParts.join("=").trim();
        });
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

  // 1) 既存のメソッド呼び出し用パターンを組み立て
  const methodPatterns = config.get<string[]>(
    "messageKeyExtractionPatterns",
    []
  );
  const invocationRegexes = [...methodPatterns, "messageSource.getMessage"].map(
    (method) => {
      const esc = method.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return new RegExp(`(?:[\\w$]+\\.)?${esc}\\(\\s*['"]([^'"]+)['"]`, "g");
    }
  );

  // 2) アノテーション用の正規表現パターンをそのままコンパイル
  const annotationPatterns = config.get<string[]>(
    "annotationKeyExtractionPatterns",
    []
  );
  const annotationRegexes = annotationPatterns.map(
    (pat) => new RegExp(pat, "g")
  );

  // 3) 両者を結合して返却
  return [...invocationRegexes, ...annotationRegexes];
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
  // 1) 元のソースURIをキャプチャ（使用しない場合は省略可）
  const sourceUri = vscode.window.activeTextEditor?.document.uri;

  // 2) glob→実ファイル解決
  let targetPath = fileToUse;
  if (!path.isAbsolute(fileToUse) || !fs.existsSync(fileToUse)) {
    const uris = await vscode.workspace.findFiles(fileToUse);
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

  // 3) ファイルを読み込んで行を取得
  const raw = fs.readFileSync(targetPath, "utf-8");
  const allLines = raw.split(/\r?\n/);
  const label = path.basename(targetPath);

  // 空行・コメントを除外して既存キー一覧を取得
  const keys = allLines
    .map((line) => line.split("=", 1)[0].trim())
    .filter((k) => k && !k.startsWith("#"));

  // 4) 重複チェック
  if (keys.includes(key)) {
    vscode.window.showWarningMessage(`⚠️ "${key}" already exists in ${label}.`);
    return;
  }

  // --- 5) 挿入位置を決定するためのキー→行番号マップを作成 ---
  const keyLineMap = new Map<string, number>();
  allLines.forEach((line, idx) => {
    const rawKey = line.split("=", 1)[0].trim();
    if (rawKey && !rawKey.startsWith("#") && line.includes("=")) {
      keyLineMap.set(rawKey, idx);
    }
  });

  // ソートした全キー＋新規キー
  const allKeysSorted = [...keys, key].sort((a, b) => a.localeCompare(b));
  const newIdx = allKeysSorted.indexOf(key);

  let insertIdx: number;
  if (newIdx === allKeysSorted.length - 1) {
    // 新キーが最後ならファイル末尾
    insertIdx = allLines.length;
  } else {
    // 新キーの次のキーの行番号
    const nextKey = allKeysSorted[newIdx + 1];
    insertIdx = keyLineMap.get(nextKey) ?? allLines.length;
  }

  // 6) 配列に挿入 & 保存
  allLines.splice(insertIdx, 0, `${key}=`);
  fs.writeFileSync(targetPath, allLines.join(os.EOL), "utf-8");
  vscode.window.showInformationMessage(
    `✅ Added "${key}" to ${label}! (line ${insertIdx + 1})`
  );

  // 7) キャッシュ更新
  await loadPropertyDefinitions([targetPath]);

  // 8) プロパティファイルを１画面で開く
  const propDoc = await vscode.workspace.openTextDocument(targetPath);
  const propEd = await vscode.window.showTextDocument(propDoc, {
    viewColumn: vscode.ViewColumn.One,
    preserveFocus: false,
    preview: false,
  });

  // 9) 挿入行の "=" 右側へカーソルを移動
  if (propEd) {
    // VSCode API で正確に行を取得
    const line = propDoc.lineAt(insertIdx);
    // 行テキスト中の "=" の位置を探し、見つかればその右、なければ行末
    const eqIdx = line.text.indexOf("=");
    const eqPos = eqIdx >= 0 ? eqIdx + 1 : line.text.length;
    const pos = new vscode.Position(insertIdx, eqPos);
    propEd.selection = new vscode.Selection(pos, pos);
    propEd.revealRange(new vscode.Range(pos, pos));
  }

  outputChannel.appendLine(
    `📍 Added ${key}= to ${label} at line ${insertIdx + 1}`
  );
}

/** settings の propertyFileGlobs から .properties を全取得 */
export async function findPropertiesFiles(): Promise<vscode.Uri[]> {
  const globs = vscode.workspace
    .getConfiguration("java-message-key-navigator")
    .get<string[]>("propertyFileGlobs", []);
  const uris: vscode.Uri[] = [];
  for (const glob of globs) {
    const found = await vscode.workspace.findFiles(glob);
    uris.push(...found);
  }
  return uris;
}

/** URI の .properties を行ごとに読み込んで返す */
export async function readPropertiesFile(
  uri: vscode.Uri
): Promise<{ lines: string[] }> {
  const doc = await vscode.workspace.openTextDocument(uri);
  return { lines: doc.getText().split(/\r?\n/) };
}

/** キーに対応する値（右辺）を最初にヒットした .properties から返却 */
export async function getMessageValueForKey(
  key: string
): Promise<string | undefined> {
  for (const uri of await findPropertiesFiles()) {
    const { lines } = await readPropertiesFile(uri);
    for (const line of lines) {
      const m = line.match(/^([^=]+)=(.*)$/);
      if (m && m[1] === key) {
        return m[2].trim();
      }
    }
  }
  return undefined;
}

/**
 * 指定ファイルパスが、チェック対象外ディレクトリ配下かどうかを判定する
 * @param filePath 絶対パス or ワークスペースルートからのパス
 */
export function isExcludedFile(filePath: string): boolean {
  const excludedDirs = [
    "/.git/",
    "/node_modules/",
    "/target/",
    "/build/",
    "/out/",
    "/dist/",
    "/tmp/",
    "/temp/",
    "/src/test/",
    "/src/generated/",
  ];
  // Windowsでも動作するようパス区切りをnormalize
  const normalized = filePath.replace(/\\/g, "/");
  return excludedDirs.some((dir) => normalized.includes(dir));
}
