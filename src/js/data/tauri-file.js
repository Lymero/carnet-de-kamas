/**
 * @file The data file for the desktop app: a `DiskFile` (see data-file.js) backed by the
 * commands of the Tauri shell (src-tauri/src/lib.rs). The shell decides where the file
 * is and writes it atomically; the page can neither choose another path nor touch any
 * other file.
 */

/**
 * @param {{invoke: (command: string, args?: Record<string, unknown>) => Promise<any>}} core
 *   `window.__TAURI__.core`
 * @returns {Promise<import("./data-file.js").DiskFile>}
 */
export async function tauriFile(core) {
  const path = await core.invoke("data_file_path");
  return {
    path,
    read: () => core.invoke("read_data"),
    write: (text) => core.invoke("write_data", { contents: text }),
    backup: () => core.invoke("backup_data"),
  };
}
