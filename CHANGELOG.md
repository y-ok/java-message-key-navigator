# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

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
