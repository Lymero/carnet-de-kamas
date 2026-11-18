// An in-memory `DiskFile` (see src/js/data/data-file.js) for tests: records writes and
// backups, and can be told to fail the next write.

/**
 * @param {string|null} [initial]  the file's text; null when it does not exist
 * @param {string} [path]
 */
export function memoryFile(initial = null, path = "/home/ana/Carnet de Kamas/carnet.json") {
  let text = initial;
  let failNext = false;
  const writes = [];
  let backups = 0;
  /** @type {import("../src/js/data/data-file.js").DiskFile} */
  const file = {
    path,
    read: async () => text,
    async write(next) {
      if (failNext) {
        failNext = false;
        throw new Error("disque plein");
      }
      writes.push(next);
      text = next;
    },
    async backup() {
      backups += 1;
    },
  };
  return {
    file,
    text: () => text,
    writes,
    backups: () => backups,
    failNextWrite() {
      failNext = true;
    },
  };
}
