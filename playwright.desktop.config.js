// Tests of the built desktop app (npm run test:desktop). See tests/desktop/.
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/desktop",
  workers: 1,
  // Starting the app can be slow on a fresh machine (see tests/desktop/app.spec.js).
  timeout: 120_000,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: { trace: "retain-on-failure" },
});
