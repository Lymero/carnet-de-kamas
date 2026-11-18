#!/usr/bin/env node
/**
 * @file Builds the folder people download to run Carnet de Kamas on their own computer:
 * dist/carnet-de-kamas-<version>/ holding the app (src/), the local server (server/),
 * the double-click launchers and the French install guide (from release/). Running it
 * needs Node.js only: the server has no dependencies, so there is nothing to install.
 *
 * The release workflow (.github/workflows/release.yml) zips that folder and attaches
 * it to a GitHub release.
 *
 * Usage: node scripts/build-release.js [outDir]   (default: dist)
 */

import { chmod, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT = fileURLToPath(new URL("..", import.meta.url));
const LAUNCHERS = ["Carnet de Kamas.cmd", "Carnet de Kamas.command"];
const GUIDE = "LISEZMOI.txt";

/**
 * @param {{projectDir?: string, outDir?: string}} [options]
 * @returns {Promise<{name: string, dir: string}>}
 */
export async function buildRelease({ projectDir = PROJECT, outDir = join(PROJECT, "dist") } = {}) {
  const pkg = JSON.parse(await readFile(join(projectDir, "package.json"), "utf8"));
  const name = `carnet-de-kamas-${pkg.version}`;
  const dir = join(outDir, name);

  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  await cp(join(projectDir, "src"), join(dir, "src"), { recursive: true });
  await cp(join(projectDir, "server"), join(dir, "server"), { recursive: true });
  for (const launcher of LAUNCHERS) await cp(join(projectDir, "release", launcher), join(dir, launcher));
  await chmod(join(dir, "Carnet de Kamas.command"), 0o755); // kept by the zip built on Linux

  const guide = await readFile(join(projectDir, "release", GUIDE), "utf8");
  await writeFile(join(dir, GUIDE), guide.replaceAll("{{version}}", pkg.version));

  // What Node needs to run the server ("type": "module"); nothing for development.
  const runtime = {
    name: pkg.name,
    version: pkg.version,
    description: pkg.description,
    private: true,
    type: "module",
    engines: pkg.engines,
    scripts: { start: "node server/main.js --open" },
  };
  await writeFile(join(dir, "package.json"), `${JSON.stringify(runtime, null, 2)}\n`);
  return { name, dir };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const outDir = process.argv[2] ? resolve(process.argv[2]) : undefined;
  const { dir } = await buildRelease({ outDir });
  console.log(`Built ${dir}`);
}
