/**
 * @file The data file on disk for the local server: a `DiskFile` (see
 * src/js/data/data-file.js) over Node's file system.
 *
 * Writes are atomic: a temporary file is written, flushed to disk and renamed over
 * the old one, so a crash or power cut leaves the old or the new file, never half of
 * one. Renaming can fail briefly on Windows while another program (an antivirus, a
 * backup tool) has the file open, so that is retried a few times.
 */

import { copyFile, mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { backupPath } from "../src/js/data/data-file.js";

/**
 * @param {string} path  absolute path of the data file
 * @returns {import("../src/js/data/data-file.js").DiskFile}
 */
export function nodeFile(path) {
  return {
    path,
    async read() {
      try {
        return await readFile(path, "utf8");
      } catch (error) {
        if (error.code === "ENOENT") return null;
        throw error;
      }
    },
    write: (text) => writeAtomic(path, text),
    backup: () => copyFile(path, backupPath(path)),
  };
}

/**
 * @param {string} path
 * @param {string} text
 */
async function writeAtomic(path, text) {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  const handle = await open(temp, "w");
  try {
    await handle.writeFile(text, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  for (let attempt = 1; ; attempt += 1) {
    try {
      await rename(temp, path);
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
