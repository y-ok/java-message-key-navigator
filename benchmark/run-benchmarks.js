#!/usr/bin/env node
const fs = require("fs");
const os = require("os");
const path = require("path");
const Module = require("module");
const minimatchPkg = require("minimatch");

const minimatch =
  typeof minimatchPkg === "function"
    ? minimatchPkg
    : minimatchPkg.minimatch;

const JAVA_INCLUDE_PATTERN = "**/src/main/java/**/*.java";
const JAVA_EXCLUDE_PATTERN =
  "**/{test,tests,src/test/**,src/generated/**,build/**,out/**,target/**}/**";

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function toMB(bytes) {
  return bytes / (1024 * 1024);
}

function round(value, digits = 2) {
  const p = 10 ** digits;
  return Math.round(value * p) / p;
}

function normalizePath(value) {
  return value.replace(/\\/g, "/");
}

function makeGlobMatcher(pattern) {
  const normalizedPattern = normalizePath(pattern);
  return (filePath) =>
    minimatch(normalizePath(filePath), normalizedPattern, {
      dot: true,
      nobrace: false,
      noglobstar: false,
      noext: false,
      nonegate: true,
      nocomment: true,
      matchBase: false,
    });
}

function listFilesRecursively(rootDir) {
  const files = [];
  const stack = [rootDir];

  while (stack.length > 0) {
    const cur = stack.pop();
    const entries = fs.readdirSync(cur, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(cur, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile()) {
        files.push(fullPath);
      }
    }
  }

  return files;
}

function buildLineOffsets(text) {
  const offsets = [0];
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) {
      offsets.push(i + 1);
    }
  }
  return offsets;
}

function positionAt(offset, textLength, lineOffsets, PositionCtor) {
  const boundedOffset = Math.max(0, Math.min(offset, textLength));
  let low = 0;
  let high = lineOffsets.length - 1;

  while (low < high) {
    const mid = Math.floor((low + high + 1) / 2);
    if (lineOffsets[mid] <= boundedOffset) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }

  const line = low;
  const character = boundedOffset - lineOffsets[line];
  return new PositionCtor(line, character);
}

function offsetAt(pos, textLength, lineOffsets) {
  if (pos.line <= 0) {
    return Math.max(0, Math.min(pos.character, textLength));
  }
  const line = Math.min(pos.line, lineOffsets.length - 1);
  const base = lineOffsets[line];
  const off = base + Math.max(0, pos.character);
  return Math.max(0, Math.min(off, textLength));
}

function detectLanguageId(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".java") {
    return "java";
  }
  if (ext === ".properties") {
    return "properties";
  }
  return "plaintext";
}

function createDocument(filePath, vscodeStub) {
  const text = fs.readFileSync(filePath, "utf8");
  const lines = text.split(/\r?\n/);
  const lineOffsets = buildLineOffsets(text);

  return {
    uri: vscodeStub.Uri.file(filePath),
    languageId: detectLanguageId(filePath),
    getText: () => text,
    positionAt: (off) =>
      positionAt(off, text.length, lineOffsets, vscodeStub.Position),
    offsetAt: (pos) => offsetAt(pos, text.length, lineOffsets),
    lineAt: (line) => ({
      text: lines[line] ?? "",
    }),
    save: async () => true,
  };
}

function collectResourceUsage() {
  const ru = process.resourceUsage();
  const mem = process.memoryUsage();
  return {
    userCpuUs: ru.userCPUTime,
    systemCpuUs: ru.systemCPUTime,
    fsReadOps: ru.fsRead,
    fsWriteOps: ru.fsWrite,
    rss: mem.rss,
    heapUsed: mem.heapUsed,
  };
}

async function measureScenario(name, fn, items = 1) {
  if (typeof global.gc === "function") {
    global.gc();
  }

  const realReadFileSync = fs.readFileSync;
  const realWriteFileSync = fs.writeFileSync;
  let readCalls = 0;
  let writeCalls = 0;
  let readBytes = 0;
  let writeBytes = 0;

  fs.readFileSync = function patchedReadFileSync(...args) {
    const data = realReadFileSync.apply(fs, args);
    readCalls += 1;
    if (typeof data === "string") {
      readBytes += Buffer.byteLength(data, "utf8");
    } else if (Buffer.isBuffer(data)) {
      readBytes += data.length;
    }
    return data;
  };

  fs.writeFileSync = function patchedWriteFileSync(...args) {
    const data = args[1];
    writeCalls += 1;
    if (typeof data === "string") {
      writeBytes += Buffer.byteLength(data, "utf8");
    } else if (Buffer.isBuffer(data)) {
      writeBytes += data.length;
    } else if (ArrayBuffer.isView(data)) {
      writeBytes += data.byteLength;
    }
    return realWriteFileSync.apply(fs, args);
  };

  const before = collectResourceUsage();
  const t0 = process.hrtime.bigint();
  let extras;
  let t1;
  let after;

  try {
    extras = await fn();
    t1 = process.hrtime.bigint();
    after = collectResourceUsage();
  } finally {
    fs.readFileSync = realReadFileSync;
    fs.writeFileSync = realWriteFileSync;
  }

  const wallMs = Number(t1 - t0) / 1e6;
  const cpuUserMs = (after.userCpuUs - before.userCpuUs) / 1000;
  const cpuSystemMs = (after.systemCpuUs - before.systemCpuUs) / 1000;
  const cpuTotalMs = cpuUserMs + cpuSystemMs;

  return {
    name,
    items,
    wallMs,
    cpuUserMs,
    cpuSystemMs,
    cpuTotalMs,
    cpuWallRatio: wallMs > 0 ? cpuTotalMs / wallMs : 0,
    throughputPerSec: wallMs > 0 ? (items * 1000) / wallMs : 0,
    fsReadOps: after.fsReadOps - before.fsReadOps,
    fsWriteOps: after.fsWriteOps - before.fsWriteOps,
    readCalls,
    writeCalls,
    readBytesMB: toMB(readBytes),
    writeBytesMB: toMB(writeBytes),
    rssDeltaMB: toMB(after.rss - before.rss),
    heapDeltaMB: toMB(after.heapUsed - before.heapUsed),
    ...extras,
  };
}

function applyStrictThresholds(threshold, strictMultiplier, strictMode) {
  if (!strictMode) {
    return { ...threshold };
  }
  const strictMaxKeys = new Set([
    "maxWallMs",
    "maxCpuTotalMs",
    "maxRssDeltaMB",
    "maxHeapDeltaMB",
    "maxFsReadOps",
    "maxFsWriteOps",
    "maxReadBytesMB",
    "maxWriteBytesMB",
  ]);
  const strictMinKeys = new Set(["minThroughputPerSec"]);
  const adjusted = { ...threshold };
  for (const [k, v] of Object.entries(adjusted)) {
    if (typeof v !== "number") {
      continue;
    }
    if (strictMaxKeys.has(k)) {
      adjusted[k] = v * strictMultiplier.maxMetrics;
    } else if (strictMinKeys.has(k)) {
      adjusted[k] = v * strictMultiplier.minMetrics;
    }
  }
  return adjusted;
}

function evaluateThresholds(metrics, threshold) {
  const failures = [];
  const checks = [
    ["maxWallMs", metrics.wallMs, "<="],
    ["maxCpuTotalMs", metrics.cpuTotalMs, "<="],
    ["maxRssDeltaMB", metrics.rssDeltaMB, "<="],
    ["maxHeapDeltaMB", metrics.heapDeltaMB, "<="],
    ["maxFsReadOps", metrics.fsReadOps, "<="],
    ["maxFsWriteOps", metrics.fsWriteOps, "<="],
    ["maxReadBytesMB", metrics.readBytesMB, "<="],
    ["maxWriteBytesMB", metrics.writeBytesMB, "<="],
    ["maxOpenJavaDocCalls", metrics.openJavaDocCalls, "<="],
    ["minOpenJavaDocCalls", metrics.openJavaDocCalls, ">="],
    ["minReadBytesMB", metrics.readBytesMB, ">="],
    ["minWriteBytesMB", metrics.writeBytesMB, ">="],
    ["minThroughputPerSec", metrics.throughputPerSec, ">="],
  ];

  for (const [name, actual, op] of checks) {
    if (!(name in threshold) || typeof actual !== "number") {
      continue;
    }
    const expected = threshold[name];
    if (op === "<=" && actual > expected) {
      failures.push(`${name}: actual=${round(actual)} > threshold=${expected}`);
    }
    if (op === ">=" && actual < expected) {
      failures.push(`${name}: actual=${round(actual)} < threshold=${expected}`);
    }
  }

  return failures;
}

function printScenario(metrics, threshold, failures) {
  const status = failures.length === 0 ? "PASS" : "FAIL";
  console.log(`\n[${status}] ${metrics.name}`);
  console.log(`  items            : ${metrics.items}`);
  console.log(`  wallMs           : ${round(metrics.wallMs)}`);
  console.log(`  cpuUserMs        : ${round(metrics.cpuUserMs)}`);
  console.log(`  cpuSystemMs      : ${round(metrics.cpuSystemMs)}`);
  console.log(`  cpuTotalMs       : ${round(metrics.cpuTotalMs)}`);
  console.log(`  cpu/wall ratio   : ${round(metrics.cpuWallRatio)}`);
  console.log(`  throughput/sec   : ${round(metrics.throughputPerSec)}`);
  console.log(`  fsReadOps        : ${metrics.fsReadOps}`);
  console.log(`  fsWriteOps       : ${metrics.fsWriteOps}`);
  console.log(`  readCalls        : ${metrics.readCalls}`);
  console.log(`  writeCalls       : ${metrics.writeCalls}`);
  console.log(`  readBytesMB      : ${round(metrics.readBytesMB)}`);
  console.log(`  writeBytesMB     : ${round(metrics.writeBytesMB)}`);
  if (typeof metrics.openJavaDocCalls === "number") {
    console.log(`  openJavaDocCalls : ${metrics.openJavaDocCalls}`);
  }
  console.log(`  rssDeltaMB       : ${round(metrics.rssDeltaMB)}`);
  console.log(`  heapDeltaMB      : ${round(metrics.heapDeltaMB)}`);

  if (typeof metrics.totalDatasetMB === "number") {
    console.log(`  totalDatasetMB   : ${round(metrics.totalDatasetMB)}`);
  }

  console.log("  thresholds:");
  for (const [k, v] of Object.entries(threshold)) {
    console.log(`    - ${k}: ${v}`);
  }

  if (failures.length > 0) {
    console.log("  violations:");
    for (const line of failures) {
      console.log(`    - ${line}`);
    }
  }
}

function createWorkspaceDataset(baseDir, name, javaCount, propertyFileCount = 20) {
  const root = path.join(baseDir, name);
  const javaRoot = path.join(root, "src", "main", "java", "bench");
  const propRoot = path.join(root, "src", "main", "resources", "i18n");
  fs.mkdirSync(javaRoot, { recursive: true });
  fs.mkdirSync(propRoot, { recursive: true });

  const javaFiles = [];
  const propertyFiles = [];
  let totalBytes = 0;

  for (let i = 0; i < javaCount; i++) {
    const pkgDir = path.join(javaRoot, `p${Math.floor(i / 200)}`);
    fs.mkdirSync(pkgDir, { recursive: true });
    const fp = path.join(pkgDir, `C${i}.java`);
    const content = [
      `package bench.p${Math.floor(i / 200)};`,
      `public class C${i} {`,
      "  void run(Object logger) {",
      `    logger.log(\"K${i}\");`,
      "  }",
      "}",
      "",
    ].join("\n");
    fs.writeFileSync(fp, content, "utf8");
    totalBytes += Buffer.byteLength(content);
    javaFiles.push(fp);
  }

  const keysPerProperty = Math.ceil(javaCount / propertyFileCount);
  for (let p = 0; p < propertyFileCount; p++) {
    const start = p * keysPerProperty;
    const end = Math.min(javaCount, start + keysPerProperty);
    if (start >= end) {
      break;
    }
    const fp = path.join(propRoot, `messages_${p}.properties`);
    const lines = ["# benchmark generated"];
    for (let k = start; k < end; k++) {
      lines.push(`K${k}=Message_${k}`);
    }
    const content = `${lines.join("\n")}\n`;
    fs.writeFileSync(fp, content, "utf8");
    totalBytes += Buffer.byteLength(content);
    propertyFiles.push(fp);
  }

  return {
    root,
    javaCount,
    javaFiles,
    propertyFiles,
    propertyGlob: path.join(propRoot, "**/*.properties"),
    totalBytes,
  };
}

function clearOutModuleCache(outDir) {
  const prefix = `${path.resolve(outDir)}${path.sep}`;
  for (const k of Object.keys(require.cache)) {
    if (k.startsWith(prefix)) {
      delete require.cache[k];
    }
  }
}

function createBenchmarkRuntime({
  workspaceRoot,
  propertyFileGlobs,
  messagePatterns,
  annotationPatterns,
}) {
  const commandHandlers = new Map();
  const callbacks = {
    open: [],
    change: [],
    save: [],
    close: [],
    config: [],
    activeEditor: [],
  };
  const watchers = [];

  const stats = {
    findFilesCalls: 0,
    openTextDocumentCalls: 0,
    openJavaDocCalls: 0,
    openPropertiesDocCalls: 0,
    diagnosticSetCalls: 0,
    diagnosticDeleteCalls: 0,
  };

  const matcherCache = new Map();
  const uriCache = new Map();

  function toUri(fp) {
    if (!uriCache.has(fp)) {
      uriCache.set(fp, {
        fsPath: fp,
        toString: () => fp,
      });
    }
    return uriCache.get(fp);
  }

  function disposable(fn) {
    return {
      dispose: fn || (() => undefined),
    };
  }

  class Position {
    constructor(line, character) {
      this.line = line;
      this.character = character;
    }

    translate(lineDelta = 0, characterDelta = 0) {
      return new Position(this.line + lineDelta, this.character + characterDelta);
    }
  }

  class Range {
    constructor(start, end) {
      this.start = start;
      this.end = end;
    }
  }

  class Selection {
    constructor(start, end) {
      this.start = start;
      this.end = end;
    }
  }

  class Diagnostic {
    constructor(range, message, severity) {
      this.range = range;
      this.message = message;
      this.severity = severity;
      this.code = undefined;
      this.source = undefined;
    }
  }

  class MarkdownString {
    constructor(value) {
      this.value = value;
    }
  }

  class CompletionItem {
    constructor(label, kind) {
      this.label = label;
      this.kind = kind;
      this.insertText = undefined;
      this.documentation = undefined;
    }
  }

  class WorkspaceEdit {}

  const outputChannel = {
    appendLine: () => undefined,
    clear: () => undefined,
  };

  const diagnosticsByName = new Map();

  const configValues = {
    "java-message-key-navigator.propertyFileGlobs": propertyFileGlobs,
    "java-message-key-navigator.messageKeyExtractionPatterns": messagePatterns,
    "java-message-key-navigator.annotationKeyExtractionPatterns":
      annotationPatterns,
  };

  function registerCallback(bucket, cb) {
    callbacks[bucket].push(cb);
    return disposable(() => {
      const idx = callbacks[bucket].indexOf(cb);
      if (idx >= 0) {
        callbacks[bucket].splice(idx, 1);
      }
    });
  }

  function getMatcher(pattern) {
    if (!matcherCache.has(pattern)) {
      matcherCache.set(pattern, makeGlobMatcher(pattern));
    }
    return matcherCache.get(pattern);
  }

  const vscodeStub = {
    Position,
    Range,
    Selection,
    Diagnostic,
    MarkdownString,
    CompletionItem,
    WorkspaceEdit,
    CompletionItemKind: {
      Value: 12,
    },
    CodeActionKind: {
      QuickFix: { value: "quickfix" },
    },
    DiagnosticSeverity: {
      Error: 0,
      Warning: 1,
      Information: 2,
      Hint: 3,
    },
    ViewColumn: {
      One: 1,
    },
    Uri: {
      file: (fp) => toUri(fp),
    },
    window: {
      activeTextEditor: undefined,
      createOutputChannel: () => outputChannel,
      showErrorMessage: () => undefined,
      showWarningMessage: () => undefined,
      showInformationMessage: () => undefined,
      showQuickPick: async (items) => items?.[0],
      showTextDocument: async () => ({
        selection: undefined,
        revealRange: () => undefined,
      }),
      onDidChangeActiveTextEditor: (cb) => registerCallback("activeEditor", cb),
    },
    workspace: {
      workspaceFolders: [],
      getConfiguration: (section) => ({
        get: (key, defaultValue) => {
          const fullKey = `${section}.${key}`;
          if (Object.prototype.hasOwnProperty.call(configValues, fullKey)) {
            return configValues[fullKey];
          }
          return defaultValue;
        },
      }),
      findFiles: async (includePattern, excludePattern) => {
        stats.findFilesCalls += 1;
        const include = getMatcher(includePattern);
        const exclude = excludePattern ? getMatcher(excludePattern) : null;
        const files = listFilesRecursively(workspaceRoot);
        return files
          .filter((fp) => include(fp) && (!exclude || !exclude(fp)))
          .map((fp) => toUri(fp));
      },
      openTextDocument: async (target) => {
        const fp = typeof target === "string" ? target : target.fsPath;
        stats.openTextDocumentCalls += 1;
        const lang = detectLanguageId(fp);
        if (lang === "java") {
          stats.openJavaDocCalls += 1;
        } else if (lang === "properties") {
          stats.openPropertiesDocCalls += 1;
        }
        return createDocument(fp, vscodeStub);
      },
      asRelativePath: (uri) => path.relative(workspaceRoot, uri.fsPath),
      applyEdit: async () => true,
      onDidOpenTextDocument: (cb) => registerCallback("open", cb),
      onDidChangeTextDocument: (cb) => registerCallback("change", cb),
      onDidSaveTextDocument: (cb) => registerCallback("save", cb),
      onDidCloseTextDocument: (cb) => registerCallback("close", cb),
      onDidChangeConfiguration: (cb) => registerCallback("config", cb),
      createFileSystemWatcher: (pattern) => {
        const entry = {
          pattern,
          create: [],
          change: [],
          del: [],
        };
        watchers.push(entry);
        return {
          onDidCreate: (cb) => {
            entry.create.push(cb);
            return disposable();
          },
          onDidChange: (cb) => {
            entry.change.push(cb);
            return disposable();
          },
          onDidDelete: (cb) => {
            entry.del.push(cb);
            return disposable();
          },
          dispose: () => undefined,
        };
      },
    },
    languages: {
      createDiagnosticCollection: (name) => {
        const store = new Map();
        const coll = {
          clear: () => {
            store.clear();
          },
          set: (uri, diagnostics) => {
            stats.diagnosticSetCalls += 1;
            store.set(uri.fsPath, diagnostics);
          },
          delete: (uri) => {
            stats.diagnosticDeleteCalls += 1;
            store.delete(uri.fsPath);
          },
          dispose: () => {
            store.clear();
          },
        };
        diagnosticsByName.set(name, coll);
        return coll;
      },
      registerHoverProvider: () => disposable(),
      registerDefinitionProvider: () => disposable(),
      registerCodeActionsProvider: () => disposable(),
      registerCompletionItemProvider: () => disposable(),
    },
    commands: {
      registerCommand: (name, handler) => {
        commandHandlers.set(name, handler);
        return disposable(() => {
          commandHandlers.delete(name);
        });
      },
    },
  };

  const outDir = path.join(path.resolve(__dirname, ".."), "out");
  clearOutModuleCache(outDir);

  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === "vscode") {
      return vscodeStub;
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  let extensionMod;
  try {
    extensionMod = require(path.join(outDir, "extension.js"));
  } finally {
    Module._load = originalLoad;
  }

  async function waitForIdle(iterations = 40) {
    for (let i = 0; i < iterations; i++) {
      await new Promise((resolve) => setImmediate(resolve));
    }
  }

  async function activate() {
    const context = {
      subscriptions: [],
    };
    await extensionMod.activate(context);
    await waitForIdle();
  }

  async function runValidateAll() {
    const cmd = commandHandlers.get("java-message-key-navigator.validateAll");
    if (!cmd) {
      throw new Error("validateAll command is not registered");
    }
    await cmd();
    await waitForIdle();
  }

  async function emitWatcherChange(filePath) {
    const uri = toUri(filePath);
    for (const w of watchers) {
      const matches = getMatcher(w.pattern)(filePath);
      if (!matches) {
        continue;
      }
      for (const cb of w.change) {
        cb(uri);
      }
    }
    await waitForIdle();
  }

  async function emitDidSave(filePath, languageId) {
    const doc = {
      uri: toUri(filePath),
      languageId,
      getText: () => fs.readFileSync(filePath, "utf8"),
    };
    for (const cb of callbacks.save) {
      cb(doc);
    }
    await waitForIdle();
  }

  return {
    stats,
    activate,
    runValidateAll,
    emitWatcherChange,
    emitDidSave,
  };
}

async function runIntegrationValidateAllScenario(dataset, name) {
  const runtime = createBenchmarkRuntime({
    workspaceRoot: dataset.root,
    propertyFileGlobs: [dataset.propertyGlob],
    messagePatterns: ["logger.log"],
    annotationPatterns: [],
  });

  await runtime.activate();
  const openBefore = runtime.stats.openJavaDocCalls;
  await runtime.runValidateAll();

  return {
    openJavaDocCalls: runtime.stats.openJavaDocCalls - openBefore,
    totalDatasetMB: toMB(dataset.totalBytes),
  };
}

async function runIntegrationIncrementalJavaChangeScenario(dataset, name) {
  const runtime = createBenchmarkRuntime({
    workspaceRoot: dataset.root,
    propertyFileGlobs: [dataset.propertyGlob],
    messagePatterns: ["logger.log"],
    annotationPatterns: [],
  });

  await runtime.activate();
  await runtime.runValidateAll();

  const target = dataset.javaFiles[Math.floor(dataset.javaFiles.length / 2)];
  const current = fs.readFileSync(target, "utf8");
  const changed = `${current}// incremental benchmark\n`;
  const openBefore = runtime.stats.openJavaDocCalls;

  return {
    execute: async () => {
      fs.writeFileSync(target, changed, "utf8");
      await runtime.emitWatcherChange(target);
      return {
        openJavaDocCalls: runtime.stats.openJavaDocCalls - openBefore,
      };
    },
  };
}

async function runIntegrationPropertySaveScenario(dataset, name) {
  const runtime = createBenchmarkRuntime({
    workspaceRoot: dataset.root,
    propertyFileGlobs: [dataset.propertyGlob],
    messagePatterns: ["logger.log"],
    annotationPatterns: [],
  });

  await runtime.activate();
  await runtime.runValidateAll();

  const target = dataset.propertyFiles[0];
  const addLine = `BENCH_${Date.now()}=CHANGED\n`;
  const openBefore = runtime.stats.openJavaDocCalls;

  return {
    execute: async () => {
      fs.appendFileSync(target, addLine, "utf8");
      await runtime.emitDidSave(target, "properties");
      return {
        openJavaDocCalls: runtime.stats.openJavaDocCalls - openBefore,
      };
    },
  };
}

async function main() {
  const root = path.resolve(__dirname, "..");
  const thresholdFile = path.join(__dirname, "thresholds.json");
  const cfg = readJson(thresholdFile);
  const strictMode = process.env.BENCH_STRICT === "1";

  const tmpBase = fs.mkdtempSync(
    path.join(os.tmpdir(), "jmk-integration-benchmark-")
  );

  const results = [];
  let hasFailure = false;

  try {
    const ds = cfg.dataset;
    const strictMul = cfg.strictMultiplier;

    const data5000 = createWorkspaceDataset(
      tmpBase,
      "ws5000",
      ds.javaCount5000,
      ds.propertyFileCount5000
    );

    const data10000 = createWorkspaceDataset(
      tmpBase,
      "ws10000",
      ds.javaCount10000,
      ds.propertyFileCount10000
    );

    const m5000 = await measureScenario(
      "integration_validate_all_5000_java",
      async () =>
        runIntegrationValidateAllScenario(data5000, "integration_validate_all_5000_java"),
      data5000.javaCount
    );
    const t5000 = applyStrictThresholds(
      cfg.profiles.integration_validate_all_5000_java,
      strictMul,
      strictMode
    );
    const f5000 = evaluateThresholds(m5000, t5000);
    printScenario(m5000, t5000, f5000);
    results.push({ metrics: m5000, failures: f5000 });
    hasFailure = hasFailure || f5000.length > 0;

    const m10000 = await measureScenario(
      "integration_validate_all_10000_java",
      async () =>
        runIntegrationValidateAllScenario(data10000, "integration_validate_all_10000_java"),
      data10000.javaCount
    );
    const t10000 = applyStrictThresholds(
      cfg.profiles.integration_validate_all_10000_java,
      strictMul,
      strictMode
    );
    const f10000 = evaluateThresholds(m10000, t10000);
    printScenario(m10000, t10000, f10000);
    results.push({ metrics: m10000, failures: f10000 });
    hasFailure = hasFailure || f10000.length > 0;

    const incremental = await runIntegrationIncrementalJavaChangeScenario(
      data10000,
      "integration_incremental_java_change_10000"
    );
    const mInc = await measureScenario(
      "integration_incremental_java_change_10000",
      incremental.execute,
      1
    );
    const tInc = applyStrictThresholds(
      cfg.profiles.integration_incremental_java_change_10000,
      strictMul,
      strictMode
    );
    const fInc = evaluateThresholds(mInc, tInc);
    printScenario(mInc, tInc, fInc);
    results.push({ metrics: mInc, failures: fInc });
    hasFailure = hasFailure || fInc.length > 0;

    const propSave = await runIntegrationPropertySaveScenario(
      data10000,
      "integration_property_save_revalidate_10000"
    );
    const mProp = await measureScenario(
      "integration_property_save_revalidate_10000",
      propSave.execute,
      data10000.javaCount
    );
    const tProp = applyStrictThresholds(
      cfg.profiles.integration_property_save_revalidate_10000,
      strictMul,
      strictMode
    );
    const fProp = evaluateThresholds(mProp, tProp);
    printScenario(mProp, tProp, fProp);
    results.push({ metrics: mProp, failures: fProp });
    hasFailure = hasFailure || fProp.length > 0;

    const resultFile = path.join(root, "dist", "benchmark", "last-result.json");
    fs.mkdirSync(path.dirname(resultFile), { recursive: true });
    fs.writeFileSync(
      resultFile,
      JSON.stringify(
        {
          strictMode,
          node: process.version,
          platform: process.platform,
          arch: process.arch,
          executedAt: new Date().toISOString(),
          results,
        },
        null,
        2
      )
    );

    console.log(`\nBenchmark result JSON: ${resultFile}`);
  } finally {
    fs.rmSync(tmpBase, { recursive: true, force: true });
  }

  if (hasFailure) {
    console.error("\nBenchmark threshold check failed.");
    process.exit(1);
  }

  console.log("\nAll benchmark threshold checks passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
