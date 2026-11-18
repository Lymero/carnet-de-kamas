#!/usr/bin/env node
/**
 * @file Runs Carnet de Kamas in the browser: serves the app and keeps the data file
 * (src/js/data/data-file.js, on disk through server/node-file.js; default location in
 * server/paths.js). The desktop app does the same without this server.
 *
 * Usage: node server/main.js [--port 8000] [--data path/to/carnet.json] [--static]
 *   --port    port to listen on, on 127.0.0.1 only (default 8000, or $PORT)
 *   --data    data file (default: see server/paths.js, or $CARNET_DATA)
 *   --static  serve the files only, without the data API: the page then keeps its
 *             data in memory (used by the in-memory end-to-end tests)
 *
 * Messages are in French, for whoever runs the app.
 */

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { openDataFile } from "../src/js/data/data-file.js";
import { createApp } from "./app.js";
import { nodeFile } from "./node-file.js";
import { defaultDataFile } from "./paths.js";

const MIN_NODE_MAJOR = 22;
if (Number(process.versions.node.split(".")[0]) < MIN_NODE_MAJOR) {
  console.error(
    `Carnet de Kamas a besoin de Node.js ${MIN_NODE_MAJOR} ou plus récent (installé : ${process.version}).`,
  );
  process.exit(1);
}

const APP_DIR = fileURLToPath(new URL("..", import.meta.url));

const { values } = parseArgs({
  options: {
    port: { type: "string" },
    data: { type: "string" },
    static: { type: "boolean", default: false },
  },
});
const port = Number(values.port ?? process.env.PORT ?? 8000);
const url = `http://localhost:${port}/`;

if (await alreadyRunning(port)) {
  console.log(`Carnet de Kamas est déjà lancé : ${url}`);
  process.exit(0);
}

let store = null;
if (!values.static) {
  const dataFile = resolve(values.data ?? process.env.CARNET_DATA ?? defaultDataFile({ appDir: APP_DIR }));
  try {
    store = await openDataFile(nodeFile(dataFile));
  } catch (error) {
    console.error(`Impossible d'ouvrir le fichier de données : ${error.message}`);
    process.exit(1);
  }
}

const server = createApp({ root: resolve(APP_DIR, "src"), store });

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(`Le port ${port} est déjà utilisé par un autre programme. Choisis-en un autre avec --port.`);
    process.exit(1);
  }
  throw error;
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Carnet de Kamas est lancé : ${url}`);
  console.log(store ? `Données : ${store.path}` : "Mode fichiers seuls : rien n'est enregistré.");
  console.log("Laisse cette fenêtre ouverte pendant que tu utilises l'app ; Ctrl+C pour l'arrêter.");
});

// Let a write in progress reach the disk before exiting.
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    await store?.flush();
    process.exit(0);
  });
}

/**
 * True when Carnet de Kamas (not some other program) already answers on this port.
 * @param {number} port
 */
async function alreadyRunning(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/info`, { signal: AbortSignal.timeout(1000) });
    return response.ok && (await response.json()).app === "carnet-de-kamas";
  } catch {
    return false;
  }
}
