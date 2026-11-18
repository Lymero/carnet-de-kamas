// Where the end-to-end test servers run (shared by playwright.config.js and the tests).
import { tmpdir } from "node:os";
import { join } from "node:path";

export const PORTS = Object.freeze({ static: 4173, local: 4174 });
export const STATIC_URL = `http://127.0.0.1:${PORTS.static}/`;
export const LOCAL_URL = `http://127.0.0.1:${PORTS.local}/`;

/** Data file of the local test server: in the system temp folder, emptied before each run. */
export const E2E_DATA_FILE = join(tmpdir(), "carnet-de-kamas-e2e", "carnet.json").replaceAll("\\", "/");
