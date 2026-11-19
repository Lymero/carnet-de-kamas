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

## Installing it

Download the installer for your system from the
[latest release](https://github.com/Lymero/carnet-de-kamas/releases/latest) and run it:

- **Windows**: `Carnet de Kamas_<version>_x64-setup.exe` (or the `.msi`). Windows SmartScreen may
  warn that the publisher is unknown: _Informations complémentaires_ › _Exécuter quand même_.
- **macOS**: the `.dmg`. The first time, macOS refuses an app from an unidentified developer:
  open _Réglages Système_ › _Confidentialité et sécurité_ and click _Ouvrir quand même_.
- **Linux**: the `.AppImage` (make it executable, then run it) or the `.deb`.

Nothing else is needed: the app opens in its own window. The warnings come from the installers
not being signed with a paid certificate.

**Your data** is one file, `carnet.json`, in your per-user folder: `%APPDATA%\Carnet de Kamas\`
on Windows, `~/Library/Application Support/Carnet de Kamas/` on macOS,
`~/.local/share/carnet-de-kamas/` on Linux. Hover the status line (top right) to see the exact
path.

- One readable JSON file with every trade and remembered price (format in
  [docs/DATA-MODEL.md](docs/DATA-MODEL.md)). Copy it to back up; replace it, with the app
  closed, to restore.
- Each start copies the previous file to `carnet.backup.json` next to it.
- Writes are atomic: a crash or power cut cannot leave a half-written file.
- It never leaves your computer. Updating or uninstalling the app does not touch it.

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
turns it back on. To craft several at once, set the **×** next to the recipe title (e.g. 10):
ingredient quantities, runes, the investment and the planned sale are all multiplied, while
unit prices stay per unit. For runes, you can also type your kamas before and after buying
them (_Kamas avant_ / _après_): the difference becomes the runes cost of the whole operation.

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
are the original sheet's plus _Prix de vente_, _Date de vente_ and _Taxe HDV_, so pasting the
backup into _Importer depuis Sheets_ restores every figure (recipe breakdowns are not
included). If the clipboard is blocked, the text opens in a dialog to copy by hand.

## Running it in a browser instead

From a copy of this repository, with [Node.js](https://nodejs.org/) 22 or newer:

```bash
npm start
```

Then open **http://localhost:8000** and leave the terminal open (Ctrl+C stops it). Options:
`npm start -- --port 8080`, `npm start -- --data D:/kamas/carnet.json`. The local server keeps
the same data file as the desktop app, in the same place, except in "portable mode": when a
`data` folder sits next to the app (as in a project folder used this way before), the data goes
to `data/carnet.json`. The terminal prints the path. Several tabs can be open at once; a change
in one appears in the others. Don't run the desktop app and the server on the same file at the
same time: each would overwrite the other's changes.

The server has no dependencies, only answers this computer (127.0.0.1) and refuses requests
from other web sites. Served any other way (a plain file server, for example), the page keeps
data in memory only, and the status line says so.

## Project layout

```
carnet-de-kamas/
├── README.md, CHANGELOG.md
├── package.json            npm scripts (see Development) and pinned dev tools
├── eslint.config.js        lint rules (undefined names, unused code)
├── jsconfig.json           type checking of the JSDoc annotations
├── playwright.config.js    browser tests (tests/e2e/)
├── playwright.desktop.config.js  tests of the built desktop app (tests/desktop/)
├── .prettierrc.json        formatting (Prettier); .editorconfig for editors
├── .github/workflows/      CI on every push; installers on every version tag
├── docs/
│   ├── ARCHITECTURE.md     layers, data flow, design decisions
│   └── DATA-MODEL.md       data file, validation, catalog format
├── src/                    the app itself (shown by the desktop shell or a browser)
│   ├── index.html          static shell
│   ├── css/app.css         design tokens + styles (light & dark)
│   ├── fonts/              Barlow and Barlow Condensed (SIL Open Font License)
│   ├── data/dofus-data.json item catalog (generated)
│   └── js/
│       ├── main.js         bootstrap and wiring
│       ├── config.js       constants
│       ├── state.js        observable app state
│       ├── actions.js      every user change (validate → store)
│       ├── router.js       #en-cours / #historique / #analyse
│       ├── domain/         pure logic: trade, kamas, dates, stats, sheet-io, text
│       ├── data/           catalog, stores, the data file and its desktop access
│       └── ui/             DOM: form, autocomplete, summary, chart, dialogs, views/
├── src-tauri/              the desktop shell (Tauri, Rust): window, data file commands, installers
├── server/                 the local server for browsers (npm start), no dependencies
│   ├── main.js             command line: port, data file
│   ├── app.js              serves src/ and the data API (/api/...)
│   ├── node-file.js        the data file on disk: atomic writes, backup
│   └── paths.js            default data location (portable or per-user)
├── scripts/
│   ├── build_catalog.py    regenerates src/data/dofus-data.json from game data
│   └── render-icon.js      regenerates the app icons from src-tauri/icons/app-icon.svg
├── data/                   portable-mode data file (git-ignored)
└── tests/                  node:test suites (*.test.js), the catalog script test (test_*.py)
    ├── e2e/                Playwright tests of the page (*.spec.js) and their fixtures
    └── desktop/            Playwright tests of the built desktop app (Windows)
```

## Development

Requirements: Node.js ≥ 22, Python 3 (catalog build and its test), Google Chrome (browser
tests), and for the desktop app [Rust](https://rustup.rs) plus the
[Tauri prerequisites](https://tauri.app/start/prerequisites/) of your system. The web app has
no runtime dependencies and no build step: the desktop shell and browsers load the ES modules
in `src/` directly. The dev tools (ESLint, Prettier, TypeScript for type checking, Playwright,
the Tauri CLI) are pinned in `package-lock.json`, the Rust crates in `src-tauri/Cargo.lock`.

```bash
npm ci                   # install the pinned dev tools and enable the git hooks
npm run desktop          # the desktop app in a development window
npm start                # or the app in a browser, at http://localhost:8000
npm run check            # format check, lint, type check, JS and Python tests
npm run check:all        # everything, including Rust and the browser tests
```

| Script                  | What it does                                                        |
| ----------------------- | ------------------------------------------------------------------- |
| `npm run desktop`       | `tauri dev`: the desktop app, on the data file in your user folder. |
| `npm start`             | The local server (`server/main.js`): the app plus its data API.     |
| `npm run check`         | The five scripts below, from `format` to `test:py`.                 |
| `npm run format`        | Rewrites files with Prettier (`format:check` only verifies).        |
| `npm run lint`          | ESLint.                                                             |
| `npm run typecheck`     | `tsc` over `src/js` using the JSDoc types; emits nothing.           |
| `npm test`              | `node:test` suites in `tests/*.test.js`.                            |
| `npm run test:py`       | `unittest` for `scripts/build_catalog.py`.                          |
| `npm run check:rust`    | `cargo fmt --check`, `clippy -D warnings` and `cargo test`.         |
| `npm run test:coverage` | JS tests with coverage; fails under 90 % lines / 85 % branches.     |
| `npm run test:e2e`      | Playwright tests in `tests/e2e/` against the served page.           |
| `npm run build:desktop` | `tauri build`: the app and its installers, in `src-tauri/target/`.  |
| `npm run test:desktop`  | The built app driven through WebView2 (Windows; build it first).    |
| `npm run check:all`     | `check`, `check:rust`, `test:coverage` and `test:e2e`.              |
| `npm run icons`         | Regenerates the icons from `src-tauri/icons/app-icon.svg`.          |
| `npm run build:catalog` | Regenerates the item catalog (see below).                           |

CI runs `check` and `test:coverage` on Node 22 and 24, `test:e2e`, and on Windows `check:rust`
and a build of the app, for every push to `main` and every pull request. Failed browser runs
upload the Playwright report and traces. `test:desktop` runs locally only (see Making a release):
WebView2 on GitHub's runners ignores the DevTools arguments it needs.

`npm run desktop` and the built app use the data file in your user folder. To try something on
a copy, set `CARNET_DATA` to another file first.

### Automatic checks

`npm ci` (or `npm install`) points git at the hooks in `.githooks/`:

- **pre-commit** runs `npm run check` (a few seconds);
- **pre-push** runs `npm run check:all`, the Rust and browser tests included.

A failing check stops the commit or push. To skip once in an emergency, use `--no-verify`; CI
still runs everything. The hooks check the working tree, so stash unrelated edits before a
partial commit.

### Conventions

- `domain/` is pure: no DOM, no network, no globals. It is what the tests cover.
- UI modules never write to storage; they call `actions`, which validate and persist.
  The store's snapshot then updates `state`, which re-renders the UI (one-way flow).
- Stored data is untrusted: `normalizeTrade` checks every field's type and shape, and every
  string that reaches `innerHTML` also goes through `escapeHtml` (`esc`).
- Amounts are whole kamas (`number`), dates are ISO strings (`YYYY-MM-DD`) of real calendar days.
- User-facing text is French; identifiers, comments and docs are English.
- Public functions carry JSDoc types, checked by `npm run typecheck`.
- Formatting is Prettier's (120 columns) and `rustfmt`'s; don't hand-format.
- `npm run check` must pass before committing (the pre-commit hook enforces it), and
  `npm run check:all` before pushing.

### Updating the item catalog

After a game update, download `dofus.sqlite` from
[ledouxm/dofus-sqlite releases](https://github.com/ledouxm/dofus-sqlite/releases) (keep it out
of the repository; `*.sqlite` is git-ignored) and run:

```bash
npm run build:catalog -- path/to/dofus.sqlite
```

The output has one item or recipe per line, so the commit diff lists what the game update changed.
See the docstring in `scripts/build_catalog.py` for what is included and how recipes are read.

### Making a release

1. Move the _Unreleased_ entries of `CHANGELOG.md` under a new `## X.Y.Z (date)` heading, and set
   the same `version` in `package.json` (the desktop app takes its version from it).
2. On Windows, check the real app: `npm run build:desktop && npm run test:desktop`.
3. Commit, then tag and push: `git tag -a vX.Y.Z -m "Carnet de Kamas X.Y.Z" && git push origin main vX.Y.Z`.
4. The _Release_ workflow (`.github/workflows/release.yml`) checks that the tag, `package.json`
   and `CHANGELOG.md` agree and runs the checks and browser tests. It then builds the installers
   on Windows, macOS and Linux into a draft release, and publishes it once all are uploaded,
   with that version's CHANGELOG section as notes.

## Limits

- **No live HDV prices.** Ankama publishes no market API, and tools that read the game
  client break the terms of use. Prices are what you type; unit prices are remembered.
- **Recipes come from data-mined game files.** Check quantities the first time you use a recipe.
  `src/data/dofus-data.json` is derived from Ankama's game client.
- Rows imported from the old spreadsheet have no sale date; they count in the month of the trade date.
