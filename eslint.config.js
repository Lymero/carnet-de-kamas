// Lint rules: catch undefined names and unused code; formatting is Prettier's job.
import js from "@eslint/js";
import globals from "globals";

export default [
  { ignores: ["playwright-report/", "test-results/", "coverage/", "src-tauri/target/", "src-tauri/gen/"] },
  js.configs.recommended,
  {
    files: ["src/js/**/*.js"],
    languageOptions: { ecmaVersion: 2023, sourceType: "module", globals: globals.browser },
  },
  {
    files: ["tests/**/*.js", "scripts/**/*.js", "server/**/*.js", "*.config.js"],
    languageOptions: { ecmaVersion: 2023, sourceType: "module", globals: globals.node },
  },
  {
    // End-to-end tests also run code in the page (page.evaluate, init scripts).
    files: ["tests/e2e/**/*.js", "tests/desktop/**/*.js"],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
];
