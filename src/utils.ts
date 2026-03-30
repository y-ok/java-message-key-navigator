import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { outputChannel } from "./outputChannel";
import {
  inferAnnotationRegexSources,
  inferMethodPatterns,
} from "./inference";

/**
 * In-memory cache of resolved message keys and property values.
 */
let propertyCache: Record<string, string> = {};

/**
 * Loads `.properties` files matched by the configured globs into memory.
 *
 * @param customPropertyGlobs Optional glob overrides used by tests or dynamic
 * configuration flows.
 */
export async function loadPropertyDefinitions(
  customPropertyGlobs: string[] = []
): Promise<void> {
  // 1) Reset the in-memory cache.
  propertyCache = {};

  // 2) Choose the glob list, falling back to workspace settings when needed.
  const config = vscode.workspace.getConfiguration(
    "java-message-key-navigator"
  );
  const globs: string[] =
    customPropertyGlobs.length > 0
      ? customPropertyGlobs
      : config.get<string[]>("propertyFileGlobs", []);

  // 3) Expand each glob and load every matching properties file.
  for (const pattern of globs) {
    outputChannel.appendLine(`🔍 findFiles pattern: ${pattern}`);
    const uris = await vscode.workspace.findFiles(pattern);
    outputChannel.appendLine(
      `  → found: ${uris.map((u) => u.fsPath).join(", ") || "none"}`
    );
    for (const uri of uris) {
      const fp = uri.fsPath;
      if (!fs.existsSync(fp)) {continue;}
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
 * Returns every property key currently present in the cache.
 */
export function getAllPropertyKeys(): string[] {
  return Object.keys(propertyCache);
}

/**
 * Returns whether the given key exists in the in-memory cache.
 */
export function isPropertyDefined(key: string): boolean {
  return Object.prototype.hasOwnProperty.call(propertyCache, key);
}

/**
 * Returns the cached property value for the given key.
 */
export function getPropertyValue(key: string): string | undefined {
  return propertyCache[key];
}

/**
 * Builds extraction regexes from the extension configuration.
 */
export function getCustomPatterns(documentText = ""): RegExp[] {
  const definedKeys = new Set(getAllPropertyKeys());
  const shouldInfer = documentText.trim().length > 0;
  const inferredMethods = shouldInfer
    ? inferMethodPatterns(documentText, definedKeys)
    : [];
  const inferredAnnotationPatterns = shouldInfer
    ? inferAnnotationRegexSources(documentText, definedKeys)
    : [];

  const invocationRegexes = [...inferredMethods, "messageSource.getMessage"].map(
    (method) => {
      const esc = method.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return new RegExp(`(?:[\\w$]+\\.)?${esc}\\(\\s*['"]([^'"]+)['"]`, "g");
    }
  );

  // 2) Compile inferred annotation regex patterns.
  const annotationRegexes = inferredAnnotationPatterns.map((pat) =>
    new RegExp(pat, "g")
  );

  // 3) Return the combined pattern list.
  return [...invocationRegexes, ...annotationRegexes];
}

/**
 * Finds the location of the first properties entry that defines the key.
 */
export async function findPropertyLocation(
  key: string
): Promise<{ filePath: string; range: vscode.Range } | null> {
  const config = vscode.workspace.getConfiguration(
    "java-message-key-navigator"
  );
  const customGlobs = config.get<string[]>("propertyFileGlobs", []);
  for (const pattern of customGlobs) {
    const uris = await vscode.workspace.findFiles(pattern);
    for (const uri of uris) {
      const fp = uri.fsPath;
      if (!fs.existsSync(fp)) {continue;}
      const lines = fs.readFileSync(fp, "utf-8").split(/\r?\n/);
      const idx = lines.findIndex((l) => l.trim().startsWith(`${key}=`));
      if (idx !== -1) {
        const keyStart = lines[idx].indexOf(key);
        return {
          filePath: fp,
          range: new vscode.Range(
            new vscode.Position(idx, keyStart),
            new vscode.Position(idx, keyStart + key.length)
          ),
        };
      }
    }
  }
  return null;
}

/**
 * Inserts a new property key into the selected file and moves the cursor to
 * the value position.
 */
export async function addPropertyKey(key: string, fileToUse: string) {
  // 1) Capture the source URI from the active editor.
  const sourceUri = vscode.window.activeTextEditor?.document.uri;

  // 2) Resolve a glob or relative path to a concrete properties file.
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

  // 3) Read the file while preserving its original line ending style.
  const raw = fs.readFileSync(targetPath, "utf-8");
  const eol = raw.includes("\r\n") ? "\r\n" : "\n";
  const allLines = raw.split(/\r?\n/);
  const label = path.basename(targetPath);

  // Build the list of existing keys, excluding blank lines and comments.
  const keys = allLines
    .map((line) => line.split("=", 1)[0].trim())
    .filter((k) => k && !k.startsWith("#"));

  // 4) Reject duplicate keys.
  if (keys.includes(key)) {
    vscode.window.showWarningMessage(`⚠️ "${key}" already exists in ${label}.`);
    return;
  }

  // 5) Build a key-to-line-number map used to choose the insertion point.
  const keyLineMap = new Map<string, number>();
  allLines.forEach((line, idx) => {
    const rawKey = line.split("=", 1)[0].trim();
    if (rawKey && !rawKey.startsWith("#") && line.includes("=")) {
      keyLineMap.set(rawKey, idx);
    }
  });

  // Combine and sort existing keys with the new key.
  const allKeysSorted = [...keys, key].sort((a, b) => a.localeCompare(b));
  const newIdx = allKeysSorted.indexOf(key);

  let insertIdx: number;
  if (newIdx === allKeysSorted.length - 1) {
    // Insert at the end when the new key sorts last.
    insertIdx = allLines.length;
  } else {
    // Otherwise insert before the next key in sorted order.
    const nextKey = allKeysSorted[newIdx + 1];
    insertIdx = keyLineMap.get(nextKey) ?? allLines.length;
  }

  // 6) Insert the new line and save the file.
  allLines.splice(insertIdx, 0, `${key}=`);
  fs.writeFileSync(targetPath, allLines.join(eol), "utf-8");
  vscode.window.showInformationMessage(
    `✅ Added "${key}" to ${label}! (line ${insertIdx + 1})`
  );

  // 7) Update only the new key in cache without rebuilding other entries.
  propertyCache[key] = "";

  // 8) Open the properties file in the primary editor column.
  const propDoc = await vscode.workspace.openTextDocument(targetPath);
  const propEd = await vscode.window.showTextDocument(propDoc, {
    viewColumn: vscode.ViewColumn.One,
    preserveFocus: false,
    preview: false,
  });

  // 9) Move the caret to the value position on the inserted line.
  if (propEd) {
    // Read the inserted line back from the VS Code document.
    const line = propDoc.lineAt(insertIdx);
    // Place the caret after "=" when present, otherwise at the end of the line.
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

/**
 * Returns every `.properties` file matched by the configured globs.
 */
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

/**
 * Opens a properties file and returns its contents split into lines.
 */
export async function readPropertiesFile(
  uri: vscode.Uri
): Promise<{ lines: string[] }> {
  const doc = await vscode.workspace.openTextDocument(uri);
  return { lines: doc.getText().split(/\r?\n/) };
}

/**
 * Returns the first property value found for the given key.
 */
export async function getMessageValueForKey(
  key: string
): Promise<string | undefined> {
  const cached = getPropertyValue(key);
  if (cached !== undefined) {
    return cached;
  }

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
 * Returns whether the given file path should be excluded from validation.
 *
 * @param filePath Absolute path or workspace-relative path.
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
  // Normalize path separators so the check works on Windows as well.
  const normalized = filePath.replace(/\\/g, "/");
  return excludedDirs.some((dir) => normalized.includes(dir));
}
