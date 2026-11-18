/**
 * @file The local server: serves the app from src/ and, given a store, a small JSON
 * API over the data file. No dependencies.
 *
 * API (all under /api/, JSON in and out; see docs/ARCHITECTURE.md):
 *   GET    /api/info          { app, store: "file" }: lets the page detect the API
 *   GET    /api/trades        { trades: { <id>: document } }
 *   PUT    /api/trades/<id>   body: document               → 204
 *   DELETE /api/trades/<id>                                → 204
 *   GET    /api/prices        { p: { <ingredientId>: price } }
 *   PATCH  /api/prices        body: { p: { <ingredientId>: price } }, merged → 204
 *   GET    /api/events        server-sent events: "change" after every trade write,
 *                             its data being the writer's X-Client-Id
 *
 * The server only listens on 127.0.0.1. Requests whose Host is not this server, or
 * that come from another site (Origin), are refused, so a web page open in the same
 * browser cannot read or change the data (including through DNS rebinding). Writes
 * must be application/json, which browsers never send cross-site without a CORS
 * preflight, and this server answers no preflight.
 */

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};
const BODY_LIMIT = 1024 * 1024;
const ID = /^[A-Za-z0-9_-]{1,128}$/;
const CLIENT_ID = /^[A-Za-z0-9-]{1,64}$/;
const KEEP_ALIVE_MS = 25_000;

class HttpError extends Error {
  /** @param {number} status @param {string} message */
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/**
 * @param {{root: string, store?: import("../src/js/data/data-file.js").DataFile|null}} options
 *   `root`: folder served as the site; without `store`, only files are served (no API).
 * @returns {import("node:http").Server}
 */
export function createApp({ root, store = null }) {
  const rootDir = root.endsWith(sep) ? root : root + sep;
  /** @type {Set<import("node:http").ServerResponse>} */
  const listeners = new Set();

  const server = createServer(async (req, res) => {
    res.setHeader("x-content-type-options", "nosniff");
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      if (store && url.pathname.startsWith("/api/")) await handleApi(req, res, url.pathname);
      else await serveFile(req, res, url.pathname);
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      if (status === 500) console.error(error);
      if (!res.headersSent) sendJson(res, status, { error: status === 500 ? "Internal error" : error.message });
      else res.end();
    }
  });

  const keepAlive = setInterval(() => listeners.forEach((res) => res.write(": keep-alive\n\n")), KEEP_ALIVE_MS);
  keepAlive.unref(); // never keeps the process alive on its own
  // Event streams stay open, so closing needs server.closeAllConnections() after close().
  server.on("close", () => clearInterval(keepAlive));

  /** @param {string} writer  the X-Client-Id of the request that changed the data */
  function broadcast(writer) {
    listeners.forEach((res) => res.write(`event: change\ndata: ${writer}\n\n`));
  }

  /**
   * @param {import("node:http").IncomingMessage} req
   * @param {import("node:http").ServerResponse} res
   * @param {string} pathname
   */
  async function handleApi(req, res, pathname) {
    checkSameOrigin(req, server);
    const [, , resource, id, extra] = pathname.split("/");
    if (extra !== undefined) throw new HttpError(404, "Not found");
    const writer = CLIENT_ID.test(String(req.headers["x-client-id"] ?? "")) ? String(req.headers["x-client-id"]) : "";
    const route = `${req.method} ${resource}${id === undefined ? "" : "/:id"}`;

    switch (route) {
      case "GET info":
        return sendJson(res, 200, { app: "carnet-de-kamas", store: "file" });
      case "GET trades":
        return sendJson(res, 200, { trades: store.trades() });
      case "PUT trades/:id": {
        const doc = await readJson(req);
        if (!ID.test(id)) throw new HttpError(400, "Invalid trade id");
        if (!isRecord(doc)) throw new HttpError(400, "A trade must be a JSON object");
        await store.putTrade(id, doc);
        broadcast(writer);
        return sendEmpty(res);
      }
      case "DELETE trades/:id":
        if (!ID.test(id)) throw new HttpError(400, "Invalid trade id");
        await store.deleteTrade(id);
        broadcast(writer);
        return sendEmpty(res);
      case "GET prices":
        return sendJson(res, 200, { p: store.prices() });
      case "PATCH prices": {
        const body = await readJson(req);
        const changes = isRecord(body) ? body.p : null;
        const valid =
          isRecord(changes) &&
          Object.entries(changes).every(
            ([key, price]) => /^\d{1,12}$/.test(key) && Number.isInteger(price) && price >= 0,
          );
        if (!valid) throw new HttpError(400, "Prices must be { p: { <ingredientId>: whole kamas } }");
        await store.mergePrices(changes);
        return sendEmpty(res);
      }
      case "GET events":
        res.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-store",
          connection: "keep-alive",
        });
        res.write(": connected\n\n");
        listeners.add(res);
        req.on("close", () => listeners.delete(res));
        return;
      default:
        throw new HttpError(["info", "trades", "prices", "events"].includes(resource) ? 405 : 404, "Not supported");
    }
  }

  /**
   * @param {import("node:http").IncomingMessage} req
   * @param {import("node:http").ServerResponse} res
   * @param {string} pathname
   */
  async function serveFile(req, res, pathname) {
    if (req.method !== "GET" && req.method !== "HEAD") throw new HttpError(405, "Method not allowed");
    let decoded;
    try {
      decoded = decodeURIComponent(pathname === "/" ? "/index.html" : pathname);
    } catch {
      throw new HttpError(400, "Malformed URL");
    }
    const file = normalize(join(rootDir, decoded));
    // Refuse anything that resolves outside the site folder (e.g. "/..%5cpackage.json").
    if (!file.startsWith(rootDir)) throw new HttpError(403, "Forbidden");
    let body;
    try {
      body = await readFile(file);
    } catch {
      throw new HttpError(404, "Not found");
    }
    res.writeHead(200, {
      "content-type": TYPES[extname(file)] ?? "application/octet-stream",
      "cache-control": "no-store",
    });
    res.end(req.method === "HEAD" ? undefined : body);
  }

  return server;
}

/**
 * Refuses API requests not addressed to this server by a page it served.
 * @param {import("node:http").IncomingMessage} req
 * @param {import("node:http").Server} server
 */
function checkSameOrigin(req, server) {
  const address = server.address();
  const port = address && typeof address === "object" ? address.port : 0;
  const allowed = [`127.0.0.1:${port}`, `localhost:${port}`];
  if (!allowed.includes(String(req.headers.host))) throw new HttpError(403, "Unexpected Host");
  const origin = req.headers.origin;
  if (origin !== undefined && !allowed.some((host) => origin === `http://${host}`)) {
    throw new HttpError(403, "Cross-origin requests are not allowed");
  }
}

/**
 * Reads a JSON request body (at most 1 MiB, Content-Type application/json).
 * @param {import("node:http").IncomingMessage} req
 */
async function readJson(req) {
  if (!/^application\/json\b/i.test(String(req.headers["content-type"] ?? ""))) {
    throw new HttpError(415, "Content-Type must be application/json");
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > BODY_LIMIT) throw new HttpError(413, "Request body too large");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "Invalid JSON");
  }
}

/** @param {unknown} value */
function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** @param {import("node:http").ServerResponse} res @param {number} status @param {unknown} body */
function sendJson(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

/** @param {import("node:http").ServerResponse} res */
function sendEmpty(res) {
  res.writeHead(204, { "cache-control": "no-store" });
  res.end();
}
