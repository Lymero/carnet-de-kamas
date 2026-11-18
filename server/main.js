#!/usr/bin/env node
/**
 * @file Runs Carnet de Kamas on this computer: serves the app and keeps the data in a
 * JSON file (see server/file-store.js).
 *
 * Usage: npm start [-- --port 8000] [--data path/to/carnet.json] [--static]
 *   --port    port to listen on, on 127.0.0.1 only (default 8000, or $PORT)
 *   --data    data file (default data/carnet.json in the project, or $CARNET_DATA)
 *   --static  serve the files only, without the data API: the page then keeps its
 *             data in memory (used by the in-memory end-to-end tests)
 */

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { createApp } from "./app.js";
import { openFileStore } from "./file-store.js";

const PROJECT = fileURLToPath(new URL("..", import.meta.url));

const { values } = parseArgs({
  options: { port: { type: "string" }, data: { type: "string" }, static: { type: "boolean", default: false } },
});
const port = Number(values.port ?? process.env.PORT ?? 8000);
const dataFile = resolve(values.data ?? process.env.CARNET_DATA ?? resolve(PROJECT, "data", "carnet.json"));

let store = null;
if (!values.static) {
  try {
    store = await openFileStore(dataFile);
  } catch (error) {
    console.error(`Cannot open the data file: ${error.message}`);
    process.exit(1);
  }
}

const server = createApp({ root: resolve(PROJECT, "src"), store });

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(`Port ${port} is already in use. Is Carnet de Kamas already running? Otherwise use --port.`);
    process.exit(1);
  }
  throw error;
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Carnet de Kamas: http://localhost:${port}/`);
  console.log(store ? `Data file: ${store.file}` : "Static mode: nothing is saved.");
  console.log("Stop with Ctrl+C.");
});

// Let a write in progress reach the disk before exiting.
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    await store?.flush();
    process.exit(0);
  });
}
