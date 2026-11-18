/**
 * @file Where the data file lives when no --data or CARNET_DATA is given.
 *
 * - Portable mode: when a `data` folder sits next to the app (the project, or an
 *   unzipped download), the data goes there. Handy on a USB stick, and how a
 *   development checkout works.
 * - Otherwise, the usual per-user application data folder, so that installing a new
 *   version (unzipping it anywhere) never touches the data:
 *     Windows  %APPDATA%\Carnet de Kamas\carnet.json
 *     macOS    ~/Library/Application Support/Carnet de Kamas/carnet.json
 *     Linux    $XDG_DATA_HOME/carnet-de-kamas/carnet.json (default ~/.local/share)
 */

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { posix, win32 } from "node:path";

export const APP_NAME = "Carnet de Kamas";
export const DATA_FILE_NAME = "carnet.json";

/**
 * @param {{appDir: string, platform?: string, env?: Record<string, string|undefined>, home?: string, exists?: (path: string) => boolean}} options
 *   `appDir`: the folder holding server/ and src/; the rest is injectable for tests
 * @returns {string} absolute path of the data file
 */
export function defaultDataFile({
  appDir,
  platform = process.platform,
  env = process.env,
  home = homedir(),
  exists = existsSync,
}) {
  const path = platform === "win32" ? win32 : posix;
  const portable = path.join(appDir, "data");
  if (exists(portable)) return path.join(portable, DATA_FILE_NAME);
  return path.join(userDataDir({ platform, env, home }), DATA_FILE_NAME);
}

/**
 * The per-user application data folder for this app.
 * @param {{platform: string, env: Record<string, string|undefined>, home: string}} options
 * @returns {string}
 */
export function userDataDir({ platform, env, home }) {
  if (platform === "win32") return win32.join(env.APPDATA || win32.join(home, "AppData", "Roaming"), APP_NAME);
  if (platform === "darwin") return posix.join(home, "Library", "Application Support", APP_NAME);
  return posix.join(env.XDG_DATA_HOME || posix.join(home, ".local", "share"), "carnet-de-kamas");
}
