#!/usr/bin/env node
/**
 * @file Copies the offline text reader (Tesseract, compiled to WebAssembly) and its
 * English and French models from node_modules into src/vendor/tesseract/, where the
 * page loads them: no network is ever needed to read a screenshot.
 *
 * Run after changing the pinned versions of tesseract.js, tesseract.js-core or
 * @tesseract.js-data/* in package.json: npm run vendor:ocr
 *
 * Only what the page uses is copied: the ES module, its worker, the two LSTM-only
 * builds of the engine (with and without SIMD; the worker picks one) and the
 * "best_int" models (small, and as accurate as the larger ones on chat text).
 */

import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const modules = `${root}node_modules/`;
const target = `${root}src/vendor/tesseract/`;

const files = {
  "tesseract.esm.min.js": "tesseract.js/dist/tesseract.esm.min.js",
  "worker.min.js": "tesseract.js/dist/worker.min.js",
  "LICENSE-tesseract.js.txt": "tesseract.js/LICENSE.md",
  "core/tesseract-core-lstm.wasm.js": "tesseract.js-core/tesseract-core-lstm.wasm.js",
  "core/tesseract-core-simd-lstm.wasm.js": "tesseract.js-core/tesseract-core-simd-lstm.wasm.js",
  "core/LICENSE.txt": "tesseract.js-core/LICENSE",
  "lang/eng.traineddata.gz": "@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz",
  "lang/fra.traineddata.gz": "@tesseract.js-data/fra/4.0.0_best_int/fra.traineddata.gz",
};

await rm(target, { recursive: true, force: true });
for (const [to, from] of Object.entries(files)) {
  await mkdir(new URL(".", `file://${target}${to}`), { recursive: true });
  await cp(`${modules}${from}`, `${target}${to}`);
  console.log(`src/vendor/tesseract/${to}`);
}

const version = async (name) => JSON.parse(await readFile(`${modules}${name}/package.json`, "utf8")).version;
await writeFile(
  `${target}NOTICE.txt`,
  `Offline text reader for chat screenshots (src/js/ui/screenshot-ocr.js).
Copied from node_modules by scripts/vendor-ocr.js (npm run vendor:ocr); do not edit.

tesseract.js ${await version("tesseract.js")}, tesseract.js-core ${await version("tesseract.js-core")}:
  Apache License 2.0 (LICENSE-tesseract.js.txt, core/LICENSE.txt).
  https://github.com/naptha/tesseract.js
lang/eng.traineddata.gz, lang/fra.traineddata.gz: Tesseract "best_int" models
  (@tesseract.js-data/eng and /fra ${await version("@tesseract.js-data/fra")}), from tesseract-ocr/tessdata_best,
  Apache License 2.0. https://github.com/tesseract-ocr/tessdata_best
`,
);
