// End-to-end tests: the real page in a real browser (npm run test:e2e). See tests/e2e/.
import { defineConfig } from "@playwright/test";
import { E2E_DATA_FILE, LOCAL_URL, PORTS, STATIC_URL } from "./tests/e2e/servers.js";

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: STATIC_URL,
    // The installed Google Chrome (preinstalled on GitHub's Ubuntu runners): no browser download.
    channel: "chrome",
    locale: "fr-FR",
    timezoneId: "Europe/Paris",
    trace: "retain-on-failure",
  },
  webServer: [
    {
      // Files only: each test starts with an empty in-memory notebook.
      command: `node server/main.js --static --port ${PORTS.static}`,
      url: STATIC_URL,
      reuseExistingServer: !process.env.CI,
    },
    {
      // Full local server, on a throwaway data file emptied before each run (never the real one).
      command:
        `node -e "require('fs').rmSync(process.argv[1], { force: true })" "${E2E_DATA_FILE}"` +
        ` && node server/main.js --port ${PORTS.local} --data "${E2E_DATA_FILE}"`,
      url: LOCAL_URL,
      reuseExistingServer: false,
    },
  ],
});
