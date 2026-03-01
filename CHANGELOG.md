# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

---

## [1.0.12] - 2026-03-01

### Fixed
- Fixed false-positive placeholder diagnostics in `diagnostic.ts`:
  - Logger and label lookup calls with trailing locale arguments (for example `LabelUtils.getLabel("KEY", localeContext.getLocale())`) are no longer counted as placeholder arguments.
  - Duplicate placeholder diagnostics are now deduplicated when overlapping extraction patterns match the same invocation.
  - Placeholder validation skips non-string first arguments such as `MessageFormat.format(msgTemplate, ...)`.
- Fixed duplicate diagnostics during `Validate All Files` by reusing the normal `messages` / `placeholders` diagnostic collections instead of a separate collection.

### Changed
- Bumped extension version to **1.0.12**.
- Added GitHub Actions CI with lint, tests, coverage artifact upload, and Codecov upload.
- Updated `README.md`:
  - Added release / CI / coverage badges.
  - Replaced inline HTML images with Markdown images and added alt text.
  - Clarified configuration behavior differences for extraction patterns.

### Added
- Added regression tests covering:
  - trailing locale arguments,
  - duplicate extraction pattern matches,
  - pattern normalization with a trailing `(`.
- Added root `tsconfig.json` so editors resolve the test configuration consistently.

## [1.0.11] - 2026-02-07

### Changed
- Bumped extension version to **1.0.11**.
- Improved placeholder validation in `diagnostic.ts` to avoid false positives for logger-style exception arguments when message placeholders are zero:
  - `log("KEY", e)`, `log("KEY", ex)`, `log("KEY", exceptionObj)` and similar names containing `exception` / `throwable` / `cause` / `error` are treated as non-placeholder arguments.
- Refined `validateAll` flow in `extension.ts`:
  - Reuses a dedicated `DiagnosticCollection` instead of recreating it per command run.
  - Reloads latest `propertyFileGlobs` configuration at command execution time.
  - Updated timeout typing to `ReturnType<typeof setTimeout>` for cross-runtime compatibility.
- Updated `README.md` to align with implementation details:
  - Clarified `messageKeyExtractionPatterns` as method identifier strings (with examples such as `infrastructureLogger.log`).
  - Added note about exception-argument handling in placeholder validation.
  - Documented the `Validate All Files` command usage.
  - Fixed JSONC configuration sample formatting.

### Added
- Added regression tests in `test/diagnostic.test.ts` for:
  - no diagnostic on `log("MSG", e)` with zero placeholders,
  - no diagnostic on `log("MSG", exceptionObj)` with zero placeholders,
  - diagnostic remains for normal single argument (e.g. `log("MSG", arg1)`).
- Extended `test/extension.test.ts` to cover `validateAll` behavior with updated diagnostic collection handling and `propertyFileGlobs` fallback.

---

## [1.0.10] - 2025-10-26

### Added
- New command **“Java Message Key Navigator: Validate All Files”**  
  → Scans all Java files under `src/main/java` and validates:
  - Undefined message keys (`validateProperties`)
  - Placeholder count and numbering (`validatePlaceholders`)
- Automatically excludes test, generated, and build directories from validation.
- Command is available via the Command Palette (`Ctrl+Shift+P` → “Validate All Files”).

### Changed
- Updated test suite (`extension.test.ts`) to fully cover the new `validateAll` command:
  - Normal case: all files validated and completion message shown.
  - Excluded files are skipped correctly.
  - Validation continues even if one file fails to open.
- Updated `package.json` to register the new command.
- Bumped extension version to **1.0.10**.

---

## [1.0.8] - 2025-07-29

### Added

* Validation to ensure message placeholders (e.g. `{0}`, `{1}`, …) in `.properties` values:

  * Start from `{0}`,
  * Are sequential (e.g. `{0}, {1}, {2}` is valid, but `{1}` or `{0}, {2}` is invalid).
* When placeholder format is incorrect, a new diagnostic message is shown:

  ```
  ⚠️ プレースホルダーは {0} から始まり連番である必要がありますが、不正な順序です: {1}, {3}
  ```

### Changed

* Enhanced `validatePlaceholders` to emit multiple diagnostics if:

  * The argument count does not match the placeholder count, and
  * The placeholder numbering is incorrect.
* Hardened all related tests to:

  * Allow multiple diagnostics per source line,
  * Match error messages by pattern instead of fixed count,
  * Ensure consistent `C1` (branch) coverage for `validateMessagePlaceholders`.
* Bumped extension version to **1.0.8**.

---

## [1.0.7] - 2025-07-29

### Changed
- Bumped extension version to **1.0.7**.  
- Cleaned up and clarified step comments in `utils.addPropertyKey`:  
  - Made “capture source URI” note optional,  
  - Simplified file‐reading and key‐listing descriptions,  
  - Renumbered insertion/map/cache/open/cursor steps,  
  - Removed leftover debug output blocks.  
- Always open the properties file in `ViewColumn.One` when revealing after QuickFix.  
- Streamlined cursor placement in `addPropertyKey` to use `lineAt(insertIdx)` for reliable positioning immediately after the `=`.

---

## [1.0.6] - 2025-07-29

### Changed

* Bumped extension version to **1.0.6** and updated `vscode` dependency to `^1.1.37`.
* Refactored **HoverProvider** to support multiple capture groups (e.g. `start`/`end`/`exception` in `@LogStartEnd`) and cleaned up hover-workflow logging.
* Converted **PropertiesQuickFixProvider** to async, fetching `propertyFileGlobs` from settings, passing the target file path to the add-key command, and registering code actions accordingly.
* Overhauled **utils.addPropertyKey** for:

  * Sorted insertion of new keys into `.properties` (preserving comments/empty lines),
  * Cache invalidation and reload via `loadPropertyDefinitions`,
  * Precise cursor placement immediately after the `=` on the inserted line.
* Streamlined **extension.ts** activation:

  * Integrated `loadPropertyDefinitions` and `isExcludedFile` checks,
  * Restructured the `addPropertyKey` command handler to open, edit, save, and reveal the properties file,
  * Improved validation scheduling for properties and placeholders.

### Added

* Full Jest test coverage for **utils**, **HoverProvider**, **PropertiesQuickFixProvider**, **diagnostics**, and **extension** flows, with complete VS Code API mocks for isolated unit testing.

---

## [1.0.5] - 2025-07-27

### Changed
- Migrated to Jest for all unit testing; removed Mocha legacy config.
- Added comprehensive unit tests with full coverage for all major modules:
  - utils, PropertyValidator, diagnostic, CompletionProvider, HoverProvider, DefinitionProvider, PropertiesQuickFixProvider, outputChannel, and extension entrypoint.
- All VS Code APIs and extension dependencies are fully mocked for reliable, isolated testing.
- Split TypeScript configuration into `tsconfig.build.json` (build) and `tsconfig.test.json` (test).
- Updated `.gitignore` to include `coverage/` and `package-lock.json`.
- Updated `package.json`:
  - Improved test and build scripts.
  - Added/updated relevant devDependencies for Jest and testing support.
  - Enhanced `clean` script to remove all generated files.
- Improved output channel initialization formatting and robustness.
- Improved development DX: all core logic now thoroughly unit tested and CI-ready.
- Version bump: 1.0.5

---

## [1.0.4] - 2025-07-01

### Added
- Support for extracting I18N keys from annotation attributes (e.g., `start`, `end`, `exception` in `@LogStartEnd`) via the new `annotationKeyExtractionPatterns` configuration.

---

## [1.0.3] - 2025-06-30

### Added
- Placeholder count validation: highlights mismatches between `{0}`, `{1}`, … placeholders in `.properties` and the number of arguments passed in code.
- Support for generic array literal calls (`new Object[] {…}`, `new String[] {…}`, etc.) and varargs calls (e.g. `infrastructureLogger.log("KEY", arg1, arg2, …)`).

---

## [1.0.2] - 2025-06-30

### Added
- When an undefined message key is detected, you can now choose the target `.properties` file to insert the new key if multiple property files are present.
- Updated usage documentation and screenshots in `README.md` to illustrate the new multi-file selection feature.

---

## [1.0.1] - 2025-06-29

### Changed
- Updated `README.md` with improved usage instructions and examples.

---

## [1.0.0] - 2025-06-29

### Added
- Initial release of **Java Message Key Navigator** 🎉
- Supports navigation from `ResourceBundle.getString()` to corresponding key in `.properties` files.
- Validation of message keys in Java source files.
- Hover support to show translations when hovering over message keys.
- Quick fixes for missing or invalid message keys.
- Command palette integration to quickly jump to keys.
