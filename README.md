# Java Message Key Navigator

**Java Message Key Navigator** is a VS Code extension designed to supercharge your Java internationalization (I18N) workflow. Hover over any I18N method call to instantly preview the corresponding value from your `.properties` files, and use ⌘/Ctrl + click to jump straight to its definition. When a key is missing, you’ll see an automatic warning plus a one-click quick fix that inserts the new key in the correct sorted order—no more manual file edits or guesswork. With customizable extraction patterns and support for multiple property-file globs, this extension keeps your message keys organized and your development flow uninterrupted.


---

## 🚀 Key Features

- **Hover Previews**  
  Place your cursor on any call like
  ```java
  infrastructureLogger.log("PLF1001");
  ````

and see the localized message right in the editor.

* **Go to Definition**
  ⌘ Click (macOS) / Ctrl Click jumps you straight to where that key is declared in your `.properties` files.

* **Undefined Key Detection & Quick Fixes**
  ⚠️ If you refer to a key that isn’t defined anywhere, you’ll get a warning—and a one-click fix to insert it.
  Under the hood, the quick-fix runs a function that:

  1. **Resolves** your glob or path to an actual `.properties` file.
  2. **Reads** every line, strips comments/blanks, and builds a list of existing keys.
  3. **Checks** for duplicates (aborts with a warning if the key already exists).
  4. **Determines** the correct insert position by finding the first existing key lexicographically greater than yours—so if you add `PLF4997` after `PLF4998`, it inserts right before `PLF4998`.
  5. **Splices** the new entry into the file, **rewrites** it in one go, **reopens** the file, and **moves** your cursor to the newly added line.

* **Custom Extraction Patterns**
  Configure your own method-call patterns (regex) for pulling out I18N keys, e.g.

  ```json
  "java-message-key-navigator.messageKeyExtractionPatterns": [
    "infrastructureLogger\\.log",
    "appLogger\\.warn"
  ]
  ```

* **Multi-File Support**
  Point the extension at any number of `.properties` file globs, for example:

  ```json
  "java-message-key-navigator.propertyFileGlobs": [
    "src/main/resources/message*.properties",
    "src/main/resources/validation/**/*.properties"
  ]
  ```

---

## ⚙️ Configuration

Add these to your **User** or **Workspace** `settings.json`:

```jsonc
{
  // Which method calls carry your I18N keys (regex)
  "java-message-key-navigator.messageKeyExtractionPatterns": [
    "infrastructureLogger\\.log",
    "appLogger\\.warn"
  ],

  // Which .properties files to read & write (glob patterns)
  "java-message-key-navigator.propertyFileGlobs": [
    "src/main/resources/message*.properties",
    "src/main/resources/validation/**/*.properties"
  ]
}
```

| Setting                                | Description                                                                         |
| -------------------------------------- | ----------------------------------------------------------------------------------- |
| `messageKeyExtractionPatterns` (array) | Regex patterns for method calls to scan for keys                                    |
| `propertyFileGlobs` (array)            | Glob patterns for your `.properties` files to include in look-up and auto-insertion |

---

## 📖 Usage

1. **Hover**
   Hover over any supported method call to see the message value inline.
2. **Definition**
   ⌘ Click / Ctrl Click to jump to the exact line in the `.properties` file.
3. **Quick Fix**
   When you see “Undefined message key” warnings, click the lightbulb or press `⌨️ Cmd/Ctrl + .` to add the missing key in the correct sorted position of your chosen file.

---

## 🛠 Maintenance

1. **Clone & install**

   ```bash
   git clone https://github.com/y-ok/java-message-key-navigator.git
   cd java-message-key-navigator
   npm install
   ```
2. **Build & package**

   ```bash
   npm run build
   ```
3. **Run in VS Code**

   * Open this folder in VS Code
   * Press **F5** to launch a fresh Extension Development Host
4. **Or install the VSIX**

   ```bash
   code --install-extension java-message-key-navigator-(version).vsix
   ```

---

## 🛡 License

This project is released under the [MIT License](LICENSE).
Feel free to fork, adapt, and share!

---

## Credits

This extension is a fork of [TOMATOofGOHAN/java-i18n-ally](https://github.com/TOMATOofGOHAN/java-i18n-ally) (MIT License).
Thank you [TOMATOofGOHAN](https://github.com/TOMATOofGOHAN) for the original work!
