import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultDataFile, userDataDir } from "../server/paths.js";

const none = () => false;

test("the data file goes to the per-user application folder of each system", () => {
  assert.equal(
    defaultDataFile({
      appDir: "C:\\Apps\\carnet",
      platform: "win32",
      env: { APPDATA: "C:\\Users\\ana\\AppData\\Roaming" },
      home: "C:\\Users\\ana",
      exists: none,
    }),
    "C:\\Users\\ana\\AppData\\Roaming\\Carnet de Kamas\\carnet.json",
  );
  assert.equal(
    defaultDataFile({ appDir: "/Applications/carnet", platform: "darwin", env: {}, home: "/Users/ana", exists: none }),
    "/Users/ana/Library/Application Support/Carnet de Kamas/carnet.json",
  );
  assert.equal(
    defaultDataFile({ appDir: "/opt/carnet", platform: "linux", env: {}, home: "/home/ana", exists: none }),
    "/home/ana/.local/share/carnet-de-kamas/carnet.json",
  );
  assert.equal(
    userDataDir({ platform: "linux", env: { XDG_DATA_HOME: "/data/ana" }, home: "/home/ana" }),
    "/data/ana/carnet-de-kamas",
  );
  assert.equal(
    userDataDir({ platform: "win32", env: {}, home: "C:\\Users\\ana" }),
    "C:\\Users\\ana\\AppData\\Roaming\\Carnet de Kamas",
    "without %APPDATA%",
  );
});

test("a data folder next to the app switches to portable mode", () => {
  const exists = (path) => path === "/media/usb/carnet/data";
  assert.equal(
    defaultDataFile({ appDir: "/media/usb/carnet", platform: "linux", env: {}, home: "/home/ana", exists }),
    "/media/usb/carnet/data/carnet.json",
  );
});
