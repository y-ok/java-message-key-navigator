# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

---

## [1.1.0] - 2026-03-30

### Added (1.1.0)

- Added inference-based key context detection (`src/inference.ts`) for:
  - message-key invocation methods inferred from Java source and loaded keys,
  - annotation key attributes inferred from Java annotations.
- Added placeholder argument-count inference for helper calls that pass
  `Object[]`-style return values to logger/message methods.
- Added inference-focused regression tests:
  - `test/inference.test.ts`,
  - `test/diagnostic.inference.test.ts`,
  - `test/CompletionProvider.inference.test.ts`,
  - `test/utils.inference-patterns.test.ts`.

### Changed (1.1.0)

- Bumped extension version to **1.1.0**.
- Updated completion, hover/definition key extraction helpers, and placeholder
  validation to use inferred contexts instead of user-provided extraction
  patterns.
- Updated benchmark runtime and validation cache tests to align with
  inference-based behavior.
- Updated `README.md` to document automatic context inference and the simplified
  configuration surface.

### Removed (1.1.0)

- Removed configuration-driven extraction settings:
  - `messageKeyExtractionPatterns`,
  - `annotationKeyExtractionPatterns`,
  - `argBuilderPatterns`.
- Removed related fallback/config-branch handling that depended on those
  settings.

### Fixed (1.1.0)

- Fixed placeholder mismatch false positives for helper-call arguments where
  the helper method returns `Object[]` elements matching message placeholders.

---

## [1.0.17] - 2026-03-29

### Fixed (1.0.17)

- Fixed false-positive placeholder diagnostics for pure varargs calls with a
  trailing identifier by resolving only trailing excess arguments through type
  definitions and ignoring them only when they resolve to throwable types.
- Fixed placeholder validation so unresolved or non-throwable trailing
  arguments stay on the safe side and continue to produce mismatch diagnostics
  instead of being silently discarded.

### Changed (1.0.17)

- Bumped extension version to **1.0.17**.
- Added JSDoc comments across all files under `src/` and translated remaining
  source-code comments to English.
- Expanded regression coverage for throwable argument resolution, validation
  edge cases, and watcher/configuration branches. The test suite now maintains
  **100%** statement, branch, function, and line coverage.

---

## [1.0.16] - 2026-03-28

### Fixed (1.0.16)

- Fixed `addPropertyKey` destroying the entire property cache by replacing
  `loadPropertyDefinitions([targetPath])` (which overwrote the cache with a
  single file) with `propertyCache[key] = ""` to append only the new key.
- Fixed `addPropertyKey` corrupting line endings by replacing `os.EOL` with
  automatic detection of the original line ending style (CRLF or LF).
- Fixed `argBuilderPatterns` configuration changes not triggering
  revalidation by adding it to the `onDidChangeConfiguration` handler.
- Fixed property file external changes (e.g. git pull) not being detected
  by adding `FileSystemWatcher` instances for each `propertyFileGlobs` entry.
  Watchers are recreated when the glob configuration changes.

### Refactored (1.0.16)

- Removed unused `findFiles` / `getConfiguration` calls and broken
  `globs[0]` fallback from `PropertiesQuickFixProvider`. The command
  handler already performs its own file search via `showQuickPick`, so
  the provider now passes only `[key]` as the command argument.

### Changed (1.0.16)

- Bumped extension version to **1.0.16**.
- Replaced `mockClear()` with `mockReset()` in tests to prevent state
  pollution between test cases.

---

## [1.0.15] - 2026-03-28

### Added (1.0.15)

- New `argBuilderPatterns` setting for placeholder validation. When
  argument arrays are built by helper methods (e.g. `buildArgs(requestUri)`)
  instead of inline `new Object[] {…}`, the extension can now use a
  configured argument count for validation.
- Each entry defines a `pattern` (method name) and `argCount` (number of
  arguments it produces). Matches bare calls, qualified calls
  (`Utils.buildArgs(…)`), and `this.buildArgs(…)`.

### Changed (1.0.15)

- Bumped extension version to **1.0.15**.
- Updated `README.md` with `argBuilderPatterns` feature description,
  configuration example, and detailed usage guide.

---

## [1.0.14] - 2026-03-25

### Changed (1.0.14)

- Bumped extension version to **1.0.14**.
- Updated `README.md` to clarify that Go to Definition lands on the
  exact message key definition in `.properties` files.

### Fixed (1.0.14)

- Fixed Go to Definition so it targets the message-key range itself,
  instead of placing the cursor at the end of the `.properties` line.
- Added regression test coverage for key-range based property
  navigation.

## [1.0.13] - 2026-03-24

### Added (1.0.13)

- Added workspace-wide Java validation caching so message-key and
  placeholder diagnostics also cover Java files that are not currently
  open in the editor.
- Added incremental revalidation hooks for Java file changes,
  `.properties` updates, and relevant configuration changes.
- Added regression tests for:
  - cached Java validation and incremental refresh behavior,
  - optional property-definition reload skipping in
    `validateProperties`,
  - cached property value lookup fast paths.
- Added integration benchmark tooling and thresholds for:
  - full validation at `5000` / `10000` Java files,
  - incremental Java change handling,
  - `.properties` save revalidation behavior.
- Added GitHub Actions release automation for tag-based VSIX packaging
  and publishing.

### Changed (1.0.13)

- Bumped extension version to **1.0.13**.
- Refined validation flow in `extension.ts` to reuse cached
  fingerprints and avoid unnecessary full rescans.
- Updated benchmark output handling to write the latest JSON result
  under `dist/benchmark/last-result.json`.
- Tightened VSIX packaging with `.vscodeignore` so benchmark,
  coverage, and other development-only files are excluded from release
  artifacts.
- Updated development dependencies used by lint, test, benchmark, and
  packaging workflows.
- Updated `README.md` maintenance documentation for:
  - benchmark purpose, scope, and outputs,
  - CI and release workflow behavior.

### Fixed (1.0.13)

- Fixed the previous limitation where normal background validation only
  covered Java files that had been opened in the editor.
- Fixed stale validation state by removing cached entries and
  diagnostics when tracked Java files disappear from the workspace.

## [1.0.12] - 2026-03-01

### Fixed (1.0.12)

- Fixed false-positive placeholder diagnostics in `diagnostic.ts`:
  - Logger and label lookup calls with trailing locale arguments, for
    example `LabelUtils.getLabel("KEY", localeContext.getLocale())`,
    are no longer counted as placeholder arguments.
  - Duplicate placeholder diagnostics are now deduplicated when
    overlapping extraction patterns match the same invocation.
  - Placeholder validation skips non-string first arguments such as
    `MessageFormat.format(msgTemplate, ...)`.
- Fixed duplicate diagnostics during `Validate All Files` by reusing
  the normal `messages` / `placeholders` diagnostic collections
  instead of a separate collection.

### Changed (1.0.12)

- Bumped extension version to **1.0.12**.
- Added GitHub Actions CI with lint, tests, coverage artifact upload,
  and Codecov upload.
- Updated `README.md`:
  - Added release / CI / coverage badges.
  - Replaced inline HTML images with Markdown images and added alt
    text.
  - Clarified configuration behavior differences for extraction
    patterns.

### Added (1.0.12)

- Added regression tests covering:
  - trailing locale arguments,
  - duplicate extraction pattern matches,
  - pattern normalization with a trailing `(`.
- Added root `tsconfig.json` so editors resolve the test
  configuration consistently.

## [1.0.11] - 2026-02-07

### Changed (1.0.11)

- Bumped extension version to **1.0.11**.
- Improved placeholder validation in `diagnostic.ts` to avoid false
  positives for logger-style exception arguments when message
  placeholders are zero:
  - `log("KEY", e)`, `log("KEY", ex)`, and `log("KEY", exceptionObj)`,
    plus similar names containing `exception`, `throwable`, `cause`, or
    `error`, are treated as non-placeholder arguments.
- Refined `validateAll` flow in `extension.ts`:
  - Reuses a dedicated `DiagnosticCollection` instead of recreating it
    per command run.
  - Reloads latest `propertyFileGlobs` configuration at command
    execution time.
  - Updated timeout typing to `ReturnType<typeof setTimeout>` for
    cross-runtime compatibility.
- Updated `README.md` to align with implementation details:
  - Clarified `messageKeyExtractionPatterns` as method identifier
    strings, with examples such as `infrastructureLogger.log`.
  - Added note about exception-argument handling in placeholder
    validation.
  - Documented the `Validate All Files` command usage.
  - Fixed JSONC configuration sample formatting.

### Added (1.0.11)

- Added regression tests in `test/diagnostic.test.ts` for:
  - no diagnostic on `log("MSG", e)` with zero placeholders,
  - no diagnostic on `log("MSG", exceptionObj)` with zero
    placeholders,
  - diagnostic remains for normal single argument, for example
    `log("MSG", arg1)`.
- Extended `test/extension.test.ts` to cover `validateAll` behavior
  with updated diagnostic collection handling and `propertyFileGlobs`
  fallback.

---

## [1.0.10] - 2025-10-26

### Added (1.0.10)

- New command **"Java Message Key Navigator: Validate All Files"**.
  This scans all Java files under `src/main/java` and validates:
  - undefined message keys via `validateProperties`,
  - placeholder count and numbering via `validatePlaceholders`.
- Automatically excludes test, generated, and build directories from
  validation.
- Command is available via the Command Palette,
  `Ctrl+Shift+P` -> "Validate All Files".

### Changed (1.0.10)

- Updated test suite `extension.test.ts` to fully cover the new
  `validateAll` command:
  - Normal case: all files validated and completion message shown.
  - Excluded files are skipped correctly.
  - Validation continues even if one file fails to open.
- Updated `package.json` to register the new command.
- Bumped extension version to **1.0.10**.

---

## [1.0.8] - 2025-07-29

### Added (1.0.8)

- Validation to ensure message placeholders, for example `{0}` and
  `{1}`, in `.properties` values:
  - start from `{0}`,
  - are sequential, for example `{0}, {1}, {2}` is valid, but `{1}` or
    `{0}, {2}` is invalid.
- When placeholder format is incorrect, a new diagnostic message is
  shown:

  ```bash
  ⚠️ プレースホルダーは {0} から始まり連番である必要がありますが、不正な順序です: {1}, {3}
  ```

### Changed (1.0.8)

- Enhanced `validatePlaceholders` to emit multiple diagnostics if:
  - the argument count does not match the placeholder count,
  - the placeholder numbering is incorrect.
- Hardened all related tests to:
  - allow multiple diagnostics per source line,
  - match error messages by pattern instead of fixed count,
  - ensure consistent `C1` branch coverage for
    `validateMessagePlaceholders`.
- Bumped extension version to **1.0.8**.

---

## [1.0.7] - 2025-07-29

### Changed (1.0.7)

- Bumped extension version to **1.0.7**.
- Cleaned up and clarified step comments in `utils.addPropertyKey`:
  - made the "capture source URI" note optional,
  - simplified file-reading and key-listing descriptions,
  - renumbered insertion / map / cache / open / cursor steps,
  - removed leftover debug output blocks.
- Always open the properties file in `ViewColumn.One` when revealing
  after QuickFix.
- Streamlined cursor placement in `addPropertyKey` to use
  `lineAt(insertIdx)` for reliable positioning immediately after the
  `=`.

---

## [1.0.6] - 2025-07-29

### Changed (1.0.6)

- Bumped extension version to **1.0.6** and updated `vscode`
  dependency to `^1.1.37`.
- Refactored **HoverProvider** to support multiple capture groups,
  for example `start`, `end`, and `exception` in `@LogStartEnd`, and
  cleaned up hover-workflow logging.
- Converted **PropertiesQuickFixProvider** to async, fetching
  `propertyFileGlobs` from settings, passing the target file path to
  the add-key command, and registering code actions accordingly.
- Overhauled **utils.addPropertyKey** for:
  - sorted insertion of new keys into `.properties` while preserving
    comments and empty lines,
  - cache invalidation and reload via `loadPropertyDefinitions`,
  - precise cursor placement immediately after the `=` on the inserted
    line.
- Streamlined **extension.ts** activation:
  - integrated `loadPropertyDefinitions` and `isExcludedFile` checks,
  - restructured the `addPropertyKey` command handler to open, edit,
    save, and reveal the properties file,
  - improved validation scheduling for properties and placeholders.

### Added (1.0.6)

- Full Jest test coverage for **utils**, **HoverProvider**,
  **PropertiesQuickFixProvider**, **diagnostics**, and **extension**
  flows, with complete VS Code API mocks for isolated unit testing.

---

## [1.0.5] - 2025-07-27

### Changed (1.0.5)

- Migrated to Jest for all unit testing and removed Mocha legacy
  config.
- Added comprehensive unit tests with full coverage for all major
  modules:
  - `utils`, `PropertyValidator`, `diagnostic`,
    `CompletionProvider`, `HoverProvider`, `DefinitionProvider`,
    `PropertiesQuickFixProvider`, `outputChannel`, and the extension
    entrypoint.
- All VS Code APIs and extension dependencies are fully mocked for
  reliable, isolated testing.
- Split TypeScript configuration into `tsconfig.build.json` for build
  and `tsconfig.test.json` for test.
- Updated `.gitignore` to include `coverage/` and `package-lock.json`.
- Updated `package.json`:
  - improved test and build scripts,
  - added or updated relevant devDependencies for Jest and testing
    support,
  - enhanced the `clean` script to remove all generated files.
- Improved output channel initialization formatting and robustness.
- Improved development DX so all core logic is thoroughly unit tested
  and CI-ready.
- Version bump: 1.0.5

---

## [1.0.4] - 2025-07-01

### Added (1.0.4)

- Support for extracting I18N keys from annotation attributes, for
  example `start`, `end`, and `exception` in `@LogStartEnd`, via the
  new `annotationKeyExtractionPatterns` configuration.

---

## [1.0.3] - 2025-06-30

### Added (1.0.3)

- Placeholder count validation highlights mismatches between
  `{0}`, `{1}`, and other placeholders in `.properties` and the
  number of arguments passed in code.
- Support for generic array literal calls, such as
  `new Object[] {…}` and `new String[] {…}`, plus varargs calls such as
  `infrastructureLogger.log("KEY", arg1, arg2, …)`.

---

## [1.0.2] - 2025-06-30

### Added (1.0.2)

- When an undefined message key is detected, you can now choose the
  target `.properties` file to insert the new key if multiple property
  files are present.
- Updated usage documentation and screenshots in `README.md` to
  illustrate the new multi-file selection feature.

---

## [1.0.1] - 2025-06-29

### Changed (1.0.1)

- Updated `README.md` with improved usage instructions and examples.

---

## [1.0.0] - 2025-06-29

### Added (1.0.0)

- Initial release of **Java Message Key Navigator**.
- Supports navigation from `ResourceBundle.getString()` to the
  corresponding key in `.properties` files.
- Validation of message keys in Java source files.
- Hover support to show translations when hovering over message keys.
- Quick fixes for missing or invalid message keys.
- Command palette integration to quickly jump to keys.
