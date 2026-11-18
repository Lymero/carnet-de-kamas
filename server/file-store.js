/**
 * @file The local data file: every trade and remembered price, in one JSON file.
 *
 * Shape (pretty-printed, so it can be read, diffed and backed up by hand; see docs/DATA-MODEL.md):
 *   { "version": 1, "trades": { "<id>": { ...trade document } }, "prices": { "<ingredientId>": price } }
 *
 * The file is read once and kept in memory. Every change is applied to a copy,
 * written to a temporary file, flushed to disk and renamed over the old file, one
 * change at a time: a crash or power cut leaves the old or the new file, never half
 * of one, and memory only changes once the file has. Opening the store copies the
 * previous file to "<name>.backup.json" first.
 */

import { copyFile, mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";

export const FILE_VERSION = 1;

/** @typedef {{version: number, trades: Record<string, object>, prices: Record<string, number>}} DataFile */

/**
 * @param {string} file  absolute path of the data file (created on first write)
 * @param {{backup?: boolean}} [options]
 */
export async function openFileStore(file, { backup = true } = {}) {
  const { state: initial, existed } = await load(file);
  if (backup && existed) await copyFile(file, backupPath(file));

  let state = initial;
  let queue = Promise.resolve();

  /**
   * Queues a change. `change` edits a copy of the data and returns false when it
   * changed nothing (no write then).
   * @param {(draft: DataFile) => boolean} change
   * @returns {Promise<void>}
   */
  function mutate(change) {
    const task = queue.then(async () => {
      const draft = structuredClone(state);
      if (change(draft) === false) return;
      await writeAtomic(file, `${JSON.stringify(draft, null, 2)}\n`);
      state = draft;
    });
    queue = task.catch(() => {}); // a failed write must not block the next ones
    return task;
  }

  return {
    file,
    /** Current trades by id. Read-only: change them through the methods below. */
    trades: () => state.trades,
    /** Current remembered prices by ingredient id. Read-only. */
    prices: () => state.prices,
    /** @param {string} id @param {object} doc */
    putTrade: (id, doc) =>
      mutate((draft) => {
        draft.trades[id] = doc;
        return true;
      }),
    /** @param {string} id */
    deleteTrade: (id) =>
      mutate((draft) => {
        if (!(id in draft.trades)) return false;
        delete draft.trades[id];
        return true;
      }),
    /** @param {Record<string, number>} changes */
    mergePrices: (changes) =>
      mutate((draft) => {
        Object.assign(draft.prices, changes);
        return true;
      }),
    /** Resolves once every queued write has finished (used before exiting). */
    flush: () => queue,
  };
}

/** @param {string} file */
export function backupPath(file) {
  return file.replace(/(\.json)?$/i, ".backup.json");
}

/**
 * Reads the data file. A missing file is an empty notebook; an unreadable one is an
 * error, so that it is never overwritten by mistake.
 * @param {string} file
 * @returns {Promise<{state: DataFile, existed: boolean}>}
 */
async function load(file) {
  let text;
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return { state: { version: FILE_VERSION, trades: {}, prices: {} }, existed: false };
    throw error;
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch (error) {
    throw new Error(
      `${file} is not valid JSON (${error.message}). It was left untouched: fix it, or restore ${backupPath(file)}.`,
      { cause: error },
    );
  }
  const isRecord = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
  if (!isRecord(data) || !isRecord(data.trades ?? {}) || !isRecord(data.prices ?? {})) {
    throw new Error(`${file} does not look like a Carnet de Kamas data file. It was left untouched.`);
  }
  if (typeof data.version === "number" && data.version > FILE_VERSION) {
    throw new Error(
      `${file} was written by a newer version of Carnet de Kamas (format ${data.version}). Update the app.`,
    );
  }
  return { state: { version: FILE_VERSION, trades: data.trades ?? {}, prices: data.prices ?? {} }, existed: true };
}

/**
 * Replaces `file` with `text` atomically: temporary file, fsync, rename.
 * Renaming can fail briefly on Windows while another program (an antivirus, a
 * backup tool) has the file open, so that is retried a few times.
 * @param {string} file
 * @param {string} text
 */
async function writeAtomic(file, text) {
  await mkdir(dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  const handle = await open(temp, "w");
  try {
    await handle.writeFile(text, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  for (let attempt = 1; ; attempt += 1) {
    try {
      await rename(temp, file);
      return;
    } catch (error) {
      if (attempt >= 5 || !["EPERM", "EBUSY", "EACCES"].includes(error.code)) {
        await rm(temp, { force: true });
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 50 * attempt));
    }
  }
}
