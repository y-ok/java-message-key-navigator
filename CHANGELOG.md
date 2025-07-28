# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

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
