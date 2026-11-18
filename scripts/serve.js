#!/usr/bin/env node
/**
 * @file Static file server for src/, for local use and the end-to-end tests.
 * ES modules need http:// (not file://). No dependencies.
 *
 * Usage: node scripts/serve.js [port]   (default 8000; PORT also works)
 */

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../src/", import.meta.url));
const PORT = Number(process.argv[2] ?? process.env.PORT ?? 8000);
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

const server = createServer(async (req, res) => {
  const { pathname } = new URL(req.url ?? "/", "http://localhost");
  let decoded;
  try {
    decoded = decodeURIComponent(pathname === "/" ? "/index.html" : pathname);
  } catch {
    res.writeHead(400).end(); // malformed percent-encoding
    return;
  }
  const file = normalize(join(ROOT, decoded));
  // Refuse anything that resolves outside src/ (e.g. "/..%5cpackage.json").
  if (!file.startsWith(ROOT.endsWith(sep) ? ROOT : ROOT + sep)) {
    res.writeHead(403).end();
    return;
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, {
      "content-type": TYPES[extname(file)] ?? "application/octet-stream",
      "cache-control": "no-store",
    });
    res.end(body);
  } catch {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("Not found");
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Serving src/ at http://localhost:${PORT}/`);
});
