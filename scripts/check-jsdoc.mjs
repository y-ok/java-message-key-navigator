import fs from "node:fs";
import path from "node:path";
import * as ts from "typescript";

const srcRoot = path.resolve(process.cwd(), "src");

/**
 * Returns whether a node has a leading JSDoc block.
 *
 * @param {ts.Node} node
 * @returns {boolean}
 */
function hasJSDoc(node) {
  return Array.isArray(node.jsDoc) && node.jsDoc.length > 0;
}

/**
 * Returns the normalized parameter name text for comparison.
 *
 * @param {ts.ParameterDeclaration} parameter
 * @param {ts.SourceFile} sourceFile
 * @returns {string}
 */
function getParameterName(parameter, sourceFile) {
  return parameter.name.getText(sourceFile).replace(/^\.\.\./, "").trim();
}

/**
 * Converts a JSDoc comment field into plain text.
 *
 * @param {string | ts.NodeArray<ts.JSDocComment> | undefined} comment
 * @returns {string}
 */
function normalizeCommentText(comment) {
  if (typeof comment === "string") {
    return comment.trim();
  }
  if (Array.isArray(comment)) {
    return comment
      .map((part) => (typeof part === "string" ? part : part.text))
      .join("")
      .trim();
  }
  return "";
}

/**
 * Collects documented parameter metadata from JSDoc tags.
 *
 * @param {ts.Node} node
 * @returns {Map<string, boolean>}
 */
function getDocumentedParamMap(node) {
  const params = new Map();
  for (const tag of ts.getJSDocTags(node)) {
    if (!ts.isJSDocParameterTag(tag)) {
      continue;
    }
    const name = tag.name.getText().replace(/^\.\.\./, "").trim();
    if (name.length > 0) {
      params.set(name, normalizeCommentText(tag.comment).length > 0);
    }
  }
  return params;
}

/**
 * Returns undocumented parameter names for a callable declaration.
 *
 * @param {ts.SignatureDeclarationBase} node
 * @param {ts.SourceFile} sourceFile
 * @returns {{ missingTags: string[]; missingDescriptions: string[] }}
 */
function getMissingParamNames(node, sourceFile) {
  const documented = getDocumentedParamMap(node);
  const missingTags = [];
  const missingDescriptions = [];
  for (const parameter of node.parameters) {
    const name = getParameterName(parameter, sourceFile);
    if (!documented.has(name)) {
      missingTags.push(name);
      continue;
    }
    if (!documented.get(name)) {
      missingDescriptions.push(name);
    }
  }
  return { missingTags, missingDescriptions };
}

/**
 * Recursively lists TypeScript source files under a directory.
 *
 * @param {string} dir
 * @returns {string[]}
 */
function collectTsFiles(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectTsFiles(full));
      continue;
    }
    if (entry.isFile() && full.endsWith(".ts") && !full.endsWith(".d.ts")) {
      files.push(full);
    }
  }
  return files;
}

/**
 * Formats a missing JSDoc item to a user-facing error line.
 *
 * @param {ts.SourceFile} sourceFile
 * @param {ts.Node} node
 * @param {string} label
 * @returns {string}
 */
function formatMissing(sourceFile, node, label) {
  const pos = sourceFile.getLineAndCharacterOfPosition(
    node.getStart(sourceFile)
  );
  const rel = path.relative(process.cwd(), sourceFile.fileName);
  return `${rel}:${pos.line + 1} Missing JSDoc on ${label}`;
}

const missing = [];

for (const filePath of collectTsFiles(srcRoot)) {
  const sourceText = fs.readFileSync(filePath, "utf8");
  const sourceFile = ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.ESNext,
    true
  );

  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name) {
      if (!hasJSDoc(statement)) {
        missing.push(
          formatMissing(sourceFile, statement, `function ${statement.name.text}`)
        );
      } else {
        const { missingTags, missingDescriptions } = getMissingParamNames(
          statement,
          sourceFile
        );
        if (missingTags.length > 0) {
          missing.push(
            formatMissing(
              sourceFile,
              statement,
              `function ${statement.name.text} missing @param: ${missingTags.join(", ")}`
            )
          );
        }
        if (missingDescriptions.length > 0) {
          missing.push(
            formatMissing(
              sourceFile,
              statement,
              `function ${statement.name.text} missing @param description: ${missingDescriptions.join(", ")}`
            )
          );
        }
      }
      continue;
    }

    if (ts.isClassDeclaration(statement) && statement.name) {
      if (!hasJSDoc(statement)) {
        missing.push(
          formatMissing(sourceFile, statement, `class ${statement.name.text}`)
        );
      }

      for (const member of statement.members) {
        if (!ts.isMethodDeclaration(member) || !member.name) {
          continue;
        }
        if (!hasJSDoc(member)) {
          const methodName = member.name.getText(sourceFile);
          missing.push(
            formatMissing(
              sourceFile,
              member,
              `method ${statement.name.text}.${methodName}`
            )
          );
          continue;
        }

        const methodName = member.name.getText(sourceFile);
        const { missingTags, missingDescriptions } = getMissingParamNames(
          member,
          sourceFile
        );
        if (missingTags.length > 0) {
          missing.push(
            formatMissing(
              sourceFile,
              member,
              `method ${statement.name.text}.${methodName} missing @param: ${missingTags.join(", ")}`
            )
          );
        }
        if (missingDescriptions.length > 0) {
          missing.push(
            formatMissing(
              sourceFile,
              member,
              `method ${statement.name.text}.${methodName} missing @param description: ${missingDescriptions.join(", ")}`
            )
          );
        }
      }
    }
  }
}

if (missing.length > 0) {
  console.error("JSDoc check failed:\n");
  for (const line of missing) {
    console.error(`- ${line}`);
  }
  process.exitCode = 1;
}
