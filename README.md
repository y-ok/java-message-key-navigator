
# Java I18N Ally 🌍

**Javaプロジェクトの国際化（I18N）対応を強化するVSCode拡張機能**<br/>
*A VSCode extension for mapping Java string literals to property keys for internationalization (I18N).*

---

## 🚀 Features / 機能

- 🔍 **Hover Support / ホバーサポート**

  `messageSource.getMessage("key")` にカーソルを当てると、対応する `messages.properties` の値を表示<br/>
  Hovering over `messageSource.getMessage("key")` displays the corresponding value from the `messages.properties` file.

- 🔗 **Go to Definition / 定義へジャンプ**

  Ctrl+クリック（macOSではCmd+クリック）でプロパティの定義へ直接移動  
  Ctrl+Click (or Cmd+Click on macOS) jumps directly to the property's definition.

- ⚠️ **Undefined Key Warning / 未定義キーの警告**

  存在しないプロパティキーを警告として表示し、クイックフィックスを提供<br/>
  Displays warnings for missing property keys and provides quick fixes.

- 🛠 **Quick Fix Support / クイックフィックス機能**

  `messages.properties` に未定義キーを追加、または類似の既存キーに変更可能<br/>
  Add missing keys to `messages.properties` or replace them with similar existing keys.

- 🔧 **Custom Method Patterns / カスタムメソッドパターン対応**

  設定ファイルで、I18Nキーを抽出するメソッドを自由に追加可能<br/>
  Configure additional method patterns for extracting I18N keys via settings.

---

## 📦 Installation / インストール手順

1. **Clone the repository / リポジトリをクローン:**

   ```sh
   git clone https://github.com/TOMATOofGOHAN/java-i18n-ally.git
   ```

2. **Navigate to the project directory / プロジェクトディレクトリへ移動:**

   ```sh
   cd java-i18n-ally
   ```

3. **Install dependencies / 依存パッケージをインストール:**

   ```sh
   npm install
   ```

4. **Build the extension / 拡張機能をビルド:**

   ```sh
   npm run build
   ```

5. **Run in VSCode / VSCodeで拡張機能を起動:**
   - **Open the project in VSCode / プロジェクトをVSCodeで開く**
   - **Press `F5` to launch the extension in a new VSCode window / `F5` を押して、新しいVSCodeウィンドウで拡張機能を実行**

---

## ⚙️ Configuration / 設定方法

**Customize method patterns for I18N key detection in `settings.json`.**<br/>
**`settings.json` にカスタムメソッドを追加して、I18Nキーの取得対象を拡張できます:**

```json
{
  "java-i18n-ally.customMethods": [
    "MessageUtils.log",
    "MessageUtils.debug",
    "MessageUtils.warn",
    "MessageUtils.error"
  ]
}
```

---

## 📜 License / ライセンス

This project is licensed under the [MIT License](LICENSE).<br/>
このプロジェクトは [MIT License](LICENSE) のもとで提供されています。
