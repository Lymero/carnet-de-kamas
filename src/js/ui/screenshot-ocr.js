/**
 * @file The offline text reader for chat screenshots: Tesseract compiled to
 * WebAssembly, shipped in src/vendor/tesseract/ (scripts/vendor-ocr.js) with its
 * English and French models. Nothing leaves the computer and no network is needed.
 *
 * Before reading, each screenshot is cleaned up for the reader: enlarged when small,
 * turned into dark text on a light background whatever the chat theme (coloured text
 * on a dark background is the game's default), in shades of grey. It is read three
 * times, with the greys more or less darkened: each version trips the reader on
 * different digits, so purchases.js keeps the prices most readings agree on.
 *
 * Loaded only when a screenshot is read: the engine and models are a few MB.
 */

/** Where the vendored reader is, next to the app's own files. */
const VENDOR = new URL("../../vendor/tesseract/", import.meta.url);
/** Screenshots narrower than this are enlarged twice: the chat's small text reads better. */
const ENLARGE_BELOW = 800;
/** Largest canvas drawn (pixels), so a huge screenshot cannot exhaust memory. */
const MAX_PIXELS = 16_000_000;
/**
 * Each reading darkens the greys by one of these powers (1: unchanged). Chosen on real
 * screenshots: together they halve the misread prices of any single reading.
 */
const READINGS = [1, 1.6, 2.2];

/**
 * @typedef {Object} ReadScreenshot
 * @property {import("../domain/purchases.js").OcrLine[][]} readings  for each reading, every line
 *   found, top to bottom, in screenshot pixels
 * @property {ImageBitmap} image  the screenshot, to show each line's picture
 */

/**
 * @returns {{read: (file: Blob) => Promise<ReadScreenshot>, close: () => Promise<void>}}
 *   `close` frees the engine (a few tens of MB); `read` starts it again when needed.
 */
export function createScreenshotReader() {
  /** @type {Promise<any>|null} */
  let worker = null;

  async function start() {
    // A computed URL keeps the type checker out of the minified file.
    const url = new URL("tesseract.esm.min.js", VENDOR).href;
    const { default: Tesseract } = await import(url);
    return Tesseract.createWorker("eng+fra", Tesseract.OEM.LSTM_ONLY, {
      workerPath: new URL("worker.min.js", VENDOR).href,
      corePath: new URL("core/", VENDOR).href,
      langPath: new URL("lang/", VENDOR).href,
      workerBlobURL: false,
      gzip: true,
      cacheMethod: "none",
    });
  }

  return {
    async read(file) {
      worker ??= start();
      const image = await createImageBitmap(file);
      const readings = [];
      for (const darken of READINGS) {
        const { canvas, scale } = prepare(image, darken);
        const { data } = await (await worker).recognize(canvas, {}, { blocks: true, text: false });
        readings.push(linesOf(data, scale));
      }
      return { readings, image };
    },
    async close() {
      const running = worker;
      worker = null;
      if (running) await (await running).terminate();
    },
  };
}

/**
 * The lines the reader found, top to bottom, in screenshot pixels.
 * @param {any} data  the reader's result
 * @param {number} scale  how much the screenshot was enlarged
 * @returns {import("../domain/purchases.js").OcrLine[]}
 */
function linesOf(data, scale) {
  /** @type {import("../domain/purchases.js").OcrLine[]} */
  const lines = (data.blocks ?? []).flatMap((block) =>
    block.paragraphs.flatMap((paragraph) =>
      paragraph.lines.map((line) => ({
        text: line.text.trim(),
        words: line.words.map((word) => ({ text: word.text, confidence: word.confidence })),
        box: { x0: line.bbox.x0 / scale, y0: line.bbox.y0 / scale, x1: line.bbox.x1 / scale, y1: line.bbox.y1 / scale },
      })),
    ),
  );
  return lines.sort((a, b) => a.box.y0 - b.box.y0);
}

/**
 * Draws the screenshot as the reader reads best: dark text on white, in greys,
 * enlarged when small. On a dark background the brightest channel of each pixel is the
 * text, whatever its colour; on a light one, the darkest. `darken` above 1 darkens the
 * greys, thickening faint strokes.
 * @param {ImageBitmap} image
 * @param {number} darken
 * @returns {{canvas: HTMLCanvasElement, scale: number}}
 */
function prepare(image, darken) {
  let scale = image.width < ENLARGE_BELOW ? 2 : 1;
  if (image.width * image.height * scale * scale > MAX_PIXELS) scale = 1;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(image.width * scale);
  canvas.height = Math.round(image.height * scale);
  const context = /** @type {CanvasRenderingContext2D} */ (canvas.getContext("2d", { willReadFrequently: true }));
  context.imageSmoothingQuality = "high";
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  const p = pixels.data;
  let sum = 0;
  for (let i = 0; i < p.length; i += 4) sum += 0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2];
  const dark = sum / (p.length / 4) < 128;
  for (let i = 0; i < p.length; i += 4) {
    const v = dark ? 255 - Math.max(p[i], p[i + 1], p[i + 2]) : Math.min(p[i], p[i + 1], p[i + 2]);
    p[i] = p[i + 1] = p[i + 2] = darken === 1 ? v : 255 * (v / 255) ** darken;
  }
  context.putImageData(pixels, 0, 0);
  return { canvas, scale };
}
