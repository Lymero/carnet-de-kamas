/**
 * @file The data file: every trade and remembered price, in one JSON file. Used by the
 * local server (server/node-file.js gives it the disk) and by the desktop app
 * (tauri-file.js), so both follow exactly the same rules.
 *
 * Shape (pretty-printed, so it can be read, diffed and backed up by hand; see docs/DATA-MODEL.md):
 *   { "version": 1, "trades": { "<id>": { ...trade document } }, "prices": { "<ingredientId>": price } }
 *
 * The file is read once and kept in memory. Every change is applied to a copy and the
 * whole file is written through `DiskFile.write`, which replaces it atomically; memory
 * only changes once the write has succeeded, and writes happen one at a time. Opening
 * copies the previous file to "<name>.backup.json" first. A file that cannot be read
 * is an error and is never overwritten.
 *
 * Error messages are in French: they reach whoever uses the app.
 */

const FILE_VERSION = 1;

/**
 * Access to the data file, provided by the platform (server/node-file.js, tauri-file.js).
 * @typedef {Object} DiskFile
 * @property {string} path                            where the file is, for messages
 * @property {() => Promise<string|null>} read        its text, or null when it does not exist
 * @property {(text: string) => Promise<void>} write  replaces the whole file atomically (creating folders)
 * @property {() => Promise<void>} backup             copies it to `backupPath(path)`
 */

/** @typedef {{version: number, trades: Record<string, object>, prices: Record<string, number>}} Contents */

/**
 * @typedef {Object} DataFile
 * @property {string} path
 * @property {() => Record<string, object>} trades   current trade documents by id (read-only)
 * @property {() => Record<string, number>} prices   current remembered prices (read-only)
 * @property {(id: string, doc: object) => Promise<void>} putTrade
 * @property {(id: string) => Promise<void>} deleteTrade
 * @property {(changes: Record<string, number>) => Promise<void>} mergePrices
 * @property {() => Promise<void>} flush             resolves once queued writes are done
 */

/**
 * @param {DiskFile} file
 * @param {{backup?: boolean}} [options]
 * @returns {Promise<DataFile>}
 */
export async function openDataFile(file, { backup = true } = {}) {
  const text = await file.read();
  let state = parse(text, file.path);
  if (backup && text !== null) await file.backup();
  let queue = Promise.resolve();

  /**
   * Queues a change. `change` edits a copy of the contents and returns false when it
   * changed nothing (no write then).
   * @param {(draft: Contents) => boolean} change
   * @returns {Promise<void>}
   */
  function mutate(change) {
    const task = queue.then(async () => {
      const draft = structuredClone(state);
      if (change(draft) === false) return;
      await file.write(`${JSON.stringify(draft, null, 2)}\n`);
      state = draft;
    });
    queue = task.catch(() => {}); // a failed write must not block the next ones
    return task;
  }

  return {
    path: file.path,
    trades: () => state.trades,
    prices: () => state.prices,
    putTrade: (id, doc) =>
      mutate((draft) => {
        draft.trades[id] = doc;
        return true;
      }),
    deleteTrade: (id) =>
      mutate((draft) => {
        if (!(id in draft.trades)) return false;
        delete draft.trades[id];
        return true;
      }),
    mergePrices: (changes) =>
      mutate((draft) => {
        Object.assign(draft.prices, changes);
        return true;
      }),
    flush: () => queue,
  };
}

/**
 * Where the backup of a data file goes: "carnet.json" → "carnet.backup.json".
 * The desktop shell (src-tauri/src/lib.rs) follows the same rule.
 * @param {string} path
 */
export function backupPath(path) {
  return path.replace(/(\.json)?$/i, ".backup.json");
}

/**
 * Reads the file's text. Missing (null) is an empty notebook; anything unreadable throws.
 * @param {string|null} text
 * @param {string} path  for messages
 * @returns {Contents}
 */
function parse(text, path) {
  if (text === null) return { version: FILE_VERSION, trades: {}, prices: {} };
  let data;
  try {
    data = JSON.parse(text);
  } catch (error) {
    throw new Error(
      `${path} n'est pas un JSON valide (${error.message}). Il n'a pas été modifié : corrige-le, ou remets la sauvegarde ${backupPath(path)}.`,
      { cause: error },
    );
  }
  const isRecord = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
  if (!isRecord(data) || !isRecord(data.trades ?? {}) || !isRecord(data.prices ?? {})) {
    throw new Error(`${path} ne ressemble pas à un fichier de Carnet de Kamas. Il n'a pas été modifié.`);
  }
  if (typeof data.version === "number" && data.version > FILE_VERSION) {
    throw new Error(
      `${path} vient d'une version plus récente de Carnet de Kamas (format ${data.version}). Mets l'app à jour.`,
    );
  }
  return { version: FILE_VERSION, trades: data.trades ?? {}, prices: data.prices ?? {} };
}
