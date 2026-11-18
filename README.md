# Carnet de Kamas

A tracker for Dofus crafting/forgemagie and resale profits. It replaces a manually
maintained spreadsheet with:

- **Quick entry** with item-name autocomplete (your own items first, then the full game catalog).
- **Recipe cost helper**: pick a craftable item, enter unit prices once (they are remembered),
  add runes/FM spend, and the investment is computed for you.
- **En cours**: what you have listed at the HDV, with how long each item has been for sale.
- **Historique**: every trade, searchable, filterable and sortable, with totals.
- **Analyse**: craft vs. resale, realised profit per month, results per item.
- **Spreadsheet import/export** by copy-paste, so old data comes in and backups go out.

The interface is in French, as are the item names; code and docs are in English.

## Running it

Requirements: [Node.js](https://nodejs.org/) 22 or newer. In the project folder:

```bash
npm start
```

Then open **http://localhost:8000** and leave the terminal open while you use the app
(Ctrl+C stops it). Options: `npm start -- --port 8080`, `npm start -- --data D:/kamas/carnet.json`.

**Your data** is in `data/carnet.json` in the project folder (the terminal prints the exact
path when the server starts):

- One readable JSON file with every trade and remembered price (format in
  [docs/DATA-MODEL.md](docs/DATA-MODEL.md)). Copy it to back up; replace it, with the server
  stopped, to restore.
- Each start copies the previous file to `data/carnet.backup.json` first.
- Writes are atomic: a crash or power cut cannot leave a half-written file.
- It never leaves your computer, and git ignores the `data/` folder, so it is never committed.
- Several tabs can be open at once: a change in one appears in the others.

The server only answers this computer (127.0.0.1) and refuses requests from other web sites.
Opened another way (from a plain file server, for example), the page keeps data in memory only,
and the status line says so.

## Using it

**Add a trade.** Fill the left form. Amounts accept `250k`, `1.8m`, `1 850 000`, `1,850,000.00`.

**Calculate in any amount field.** Type `1.2m + 350k + 80k` (craft + FM + extras), `3 x 450k`,
`(2.6m - 100k) / 2`: operators `+ - * /` (also `x`, `×`, `÷`) and parentheses. The result shows
under the field while you type and replaces the calculation when you leave the field.

**Auction-house tax.** Pick the _Taxe HDV_ paid on the trade: **2 %** when the item is put up
for sale (the default), **1 %** when its price was updated, or none. That share of the price is
deducted from the profit: of the planned price until the item sells, then of the real sale
price. The preview shows the amount. The form remembers your last choice, and the rate can
be changed when recording the sale (_Vendu_) or in the edit dialog. Trades recorded before
this option have no tax.

**Price a craft.** Pick a craftable item with type _Craft / FM_ and enter unit prices in the
recipe box. Editing the investment by hand stops the auto-fill; _Utiliser le coût calculé_
turns it back on.

**Record a sale.** _En cours_ → _Vendu_ → confirm the real price and date.

**Fix or delete.** Click any row (or _Modifier_). Delete asks for a second click. Leaving the
sale date empty means "unknown".

**Import old rows.** _Historique_ → _Importer depuis Sheets_, then paste cells copied from the
sheet. The preview says how many rows are new, already present, sold, or unreadable:

- A row counts as sold only when its _Vendu ?_ cell is ticked (`TRUE`, `VRAI`, `oui`, `x`…).
- A row matching an existing trade (same date and investment) is skipped. Each existing trade
  matches one pasted row at most, so two identical crafts made the same day both import.
- Dates must exist and be day-first or ISO (`20/08/2026`, `2026-08-20`); others are rejected.

**Back up.** _Historique_ → _Copier en tableau_, then paste into any spreadsheet. The columns
are the original sheet's plus _Prix de vente_, _Date de vente_ and _Taxe HDV_, so pasting the backup into
_Importer depuis Sheets_ restores every figure (recipe breakdowns are not included). If the
browser blocks the clipboard, the text opens in a dialog to copy by hand.

## Project layout

```
carnet-de-kamas/
├── README.md, CHANGELOG.md
├── package.json            npm scripts (see Development) and pinned dev tools
├── eslint.config.js        lint rules (undefined names, unused code)
├── jsconfig.json           type checking of the JSDoc annotations
├── playwright.config.js    browser tests (tests/e2e/)
├── .prettierrc.json        formatting (Prettier); .editorconfig for editors
├── .github/workflows/      CI: check + coverage on Node 22 and 24, browser tests
├── docs/
│   ├── ARCHITECTURE.md     layers, data flow, design decisions
│   └── DATA-MODEL.md       stored documents, validation, catalog format
├── server/                 the local server (npm start), no dependencies
│   ├── main.js             command line: port, data file
│   ├── app.js              serves src/ and the data API (/api/...)
│   └── file-store.js       the data file: atomic writes, backup
├── scripts/
│   └── build_catalog.py    regenerates src/data/dofus-data.json from game data
├── data/                   your data file (created by npm start; git-ignored)
├── src/                    everything that is published
│   ├── index.html          static shell
│   ├── css/app.css         design tokens + styles (light & dark)
│   ├── data/dofus-data.json item catalog (generated)
│   └── js/
│       ├── main.js         bootstrap and wiring
│       ├── config.js       constants
│       ├── state.js        observable app state
│       ├── actions.js      every user change (validate → store)
│       ├── router.js       #en-cours / #historique / #analyse
│       ├── domain/         pure logic: trade, kamas, dates, stats, sheet-io, text
│       ├── data/           catalog (items, recipes, search) and store (persistence)
│       └── ui/             DOM: form, autocomplete, summary, chart, dialogs, views/
└── tests/                  node:test suites (*.test.js), the catalog script test (test_*.py)
    └── e2e/                Playwright tests (*.spec.js) and their fixtures
```

## Development

Requirements: Node.js ≥ 22, Python 3 (catalog build and its test), and Google Chrome (browser
tests). The app has no runtime dependencies and no build step: the browser loads the ES modules
directly. The dev tools (ESLint, Prettier, TypeScript for type checking, Playwright) are pinned
in `package-lock.json`.

```bash
npm ci                   # install the pinned dev tools and enable the git hooks
npm run check            # format check, lint, type check, JS and Python tests
npm run test:e2e         # the real page in Chrome
npm start                # the app at http://localhost:8000, with your data
```

| Script                  | What it does                                                    |
| ----------------------- | --------------------------------------------------------------- |
| `npm run check`         | The five scripts below, from `format` to `test:py`.             |
| `npm run check:all`     | `check`, then `test:coverage` and `test:e2e`.                   |
| `npm run format`        | Rewrites files with Prettier (`format:check` only verifies).    |
| `npm run lint`          | ESLint.                                                         |
| `npm run typecheck`     | `tsc` over `src/js` using the JSDoc types; emits nothing.       |
| `npm test`              | `node:test` suites in `tests/*.test.js`.                        |
| `npm run test:py`       | `unittest` for `scripts/build_catalog.py`.                      |
| `npm run test:coverage` | JS tests with coverage; fails under 90 % lines / 85 % branches. |
| `npm run test:e2e`      | Playwright tests in `tests/e2e/` against the served page.       |
| `npm start`             | The local server (`server/main.js`): the app plus its data API. |

CI runs `check` and `test:coverage` on Node 22 and 24, and `test:e2e` on Node 24, for every push
to `main` and every pull request. A failed browser run uploads the Playwright report and traces.

### Automatic checks

`npm ci` (or `npm install`) points git at the hooks in `.githooks/`:

- **pre-commit** runs `npm run check` (a few seconds);
- **pre-push** runs `npm run check:all`, the browser tests included.

A failing check stops the commit or push. To skip once in an emergency, use `--no-verify`; CI
still runs everything. The hooks check the working tree, so stash unrelated edits before a
partial commit.

### Conventions

- `domain/` is pure: no DOM, no network, no globals. It is what the tests cover.
- UI modules never write to storage; they call `actions`, which validate and persist.
  The store's snapshot then updates `state`, which re-renders the UI (one-way flow).
- Data read from the database is untrusted: `normalizeTrade` checks every field's type and
  shape, and every string that reaches `innerHTML` also goes through `escapeHtml` (`esc`).
- Amounts are whole kamas (`number`), dates are ISO strings (`YYYY-MM-DD`) of real calendar days.
- User-facing text is French; identifiers, comments and docs are English.
- Public functions carry JSDoc types, checked by `npm run typecheck`.
- Formatting is Prettier's (120 columns); don't hand-format.
- `npm run check` must pass before committing (the pre-commit hook enforces it), and
  `npm run check:all` before publishing.

### Updating the item catalog

After a game update, download `dofus.sqlite` from
[ledouxm/dofus-sqlite releases](https://github.com/ledouxm/dofus-sqlite/releases) (keep it out
of the repository; `*.sqlite` is git-ignored) and run:

```bash
npm run build:catalog -- path/to/dofus.sqlite
```

The output has one item or recipe per line, so the commit diff lists what the game update changed.
See the docstring in `scripts/build_catalog.py` for what is included and how recipes are read.

### Publishing as a Claude artifact (optional)

The app can also run as a claude.ai artifact, storing its data in the artifact database
instead of a file (`createCloudStore`). The published files are the contents of `src/`
(paths relative to it: `index.html`, `css/app.css`, `js/...`, `data/dofus-data.json`);
republish to the same artifact to keep its data. The page declares two capabilities:

```json
{ "db": { "rules": [{ "path": "", "read": "view", "write": "owner" }] }, "user": {} }
```

## Limits

- **No live HDV prices.** Ankama publishes no market API, and tools that read the game
  client break the terms of use. Prices are what you type; unit prices are remembered.
- **Recipes come from data-mined game files.** Check quantities the first time you use a recipe.
  `src/data/dofus-data.json` is derived from Ankama's game client.
- Rows imported from the old spreadsheet have no sale date; they count in the month of the trade date.
