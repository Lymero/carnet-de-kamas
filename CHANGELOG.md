# Changelog

## Unreleased

### Added

- **Investment from chat screenshots**: pick, drop or paste screenshots of the game chat and
  the app reads the purchase lines (`N x [Item] (price kamas)`) to fill the investment. The
  text is read on the computer (Tesseract, bundled), with no internet connection. Each line
  is shown with its picture in an editable list; unsure readings, missed lines and lines
  repeated across overlapping screenshots are flagged before the total is used.

## 3.0.1 (2026-11-18)

### Fixed

- The 3.0.0 release was published without its installers. This release has them, for Windows,
  macOS and Linux.

## 3.0.0 (2026-11-18)

### Added

- **Desktop app** (Tauri): installers of a few MB for Windows (NSIS and MSI, in French), macOS
  (universal `.dmg`) and Linux (`.AppImage`, `.deb`). No Node.js or browser needed: the app
  opens in its own window and keeps the same data file, in the same per-user folder. A second
  launch focuses the window already open, so the file has a single writer.
- The fonts ship with the app: no request to Google Fonts, and it works offline.
- Tests of the real desktop app (`npm run test:desktop`, Windows), Rust format, lint and unit
  tests (`npm run check:rust`), all run in CI; the release workflow builds the installers for
  the three systems.

### Changed

- The data file's rules live in one module shared by the desktop app and the local server
  (`src/js/data/data-file.js`); only the disk access differs (Rust commands, Node).
- `npm start` still runs the app in a browser, on the same data file.

### Removed

- The Claude artifact mode: its storage, the read-only "viewer" mode and the capability
  detection.
- The zip download with launchers, replaced by the installers, and the server's `--open`
  option.

## 2.2.0 (2026-11-18)

### Added

- **Local mode**: `npm start` (or the launchers below) serves the app at http://localhost:8000
  and saves everything in one JSON file on this computer, with atomic writes, a backup at each
  start, and open tabs kept in sync. The server has no dependencies, only answers this
  computer, and refuses requests from other sites. The claude.ai artifact mode still works.
- **A download to share the app**: each GitHub release has a zip with the app, the server,
  double-click launchers (Windows `.cmd`, macOS/Linux `.command`) and a French install guide
  (`LISEZMOI.txt`). Only Node.js is needed. Launching the app while it already runs just opens
  the browser on it.
- **Calculations in every kamas field**: `1.2m + 350k + 80k`, `3 x 450k`, `(2.6m - 100k) / 2`.
  The result shows under the field while typing and replaces the calculation on leaving it.
- **Taxe HDV** on each trade: 2 % when listed, 1 % when the price was updated, or none. That
  share of the price is deducted from the profit everywhere. It is chosen in the form (2 % by
  default, then the last choice), when recording a sale, or in the edit dialog, and is exported
  and imported as a _Taxe HDV_ column. Existing trades are unchanged.
- Data location: the per-user application folder (`%APPDATA%\Carnet de Kamas` on Windows, and
  the equivalents on macOS and Linux), unless a `data` folder sits next to the app (portable
  mode: an existing project folder keeps its `data/carnet.json`).
- For development: end-to-end browser tests (`npm run test:e2e`, Playwright with the installed
  Chrome); git hooks enabled by `npm install` (`npm run check` before each commit,
  `npm run check:all` before each push); and a release workflow (`npm run build:release`
  builds the download, pushing a `vX.Y.Z` tag publishes it).

### Changed

- `npm start` replaces `npm run serve`, and the server prints its messages in French.

### Fixed

- Thousands in amounts are visible again: they were grouped with a narrow no-break space, which
  the app's font has no glyph for, so `1 850 000` showed as `1850000`.
- Amount fields no longer ask phones for a number pad, which has neither `k`/`m` nor operators.
- On phones, the history and analysis tables no longer widen the whole page: they scroll inside
  their card.

## 2.1.0 (2026-11-18)

Correctness and robustness fixes from a full review, plus project tooling. Stored data is unchanged
and older documents still load.

### Fixed

- Import no longer drops identical trades made the same day: duplicate detection now counts
  occurrences, so each existing trade matches at most one pasted row.
- Remembered prices can no longer be erased: saves merge only the changed prices into
  `settings/prices` instead of replacing the document (which could happen before it had loaded).
- A pasted sheet without a _Vendu ?_ column no longer marks every row as sold.
- Impossible dates (`2026-13-45`, `31/02/2026`) and month-first dates are rejected, on import and
  everywhere else; a sale dated before its trade is refused.
- The backup export re-imports without loss: new _Prix de vente_ and _Date de vente_ columns, and
  _Vente potentielle_ now holds the planned price.
- Stored data is validated when read (`normalizeTrade`), and the two places that put stored values
  into the page unescaped (date cells, recipe quantities) now escape them.
- Error messages in the edit dialog are visible above the dialog instead of dimmed behind it.
- A live update no longer wipes the sale price being typed in _En cours_, nor steals focus from the
  history filters; loading the catalog no longer re-renders the views.
- Start-up: a failing `user` capability no longer disables cloud storage; a start-up error is
  shown instead of an endless "Chargement…"; read-only viewers no longer keep a stale
  "connexion lente" warning; the trades listener recovers when the host drops it (`unavailable`).
- Edit dialog: an unreadable sale price is an error instead of silently becoming the planned price;
  the sale date can be cleared; ticking _Vendu_ fills in price and date; Enter saves.
- An interrupted import resumes exactly after the rows already saved.
- Negative unit prices and rune costs are ignored; recipe inputs are disabled for viewers.
- If the browser blocks the clipboard, the export opens in a dialog to copy by hand.
- Primary buttons meet WCAG AA contrast (accent `#966710`, 4.9:1); the toast is a permanent live
  region, so screen readers announce it; the dialog is labelled by its title.
- `build_catalog.py` no longer crashes printing its summary on non-UTF-8 Windows consoles.

### Changed

- The catalog is written one item or recipe per line (same data), so updates diff cleanly;
  `build_catalog.py` reports skipped recipes, keeps the first of duplicate recipes, and sorts
  deterministically.
- Node.js ≥ 22 (Node 20 reached end of life in April 2026).

### Added

- Type checking of the JSDoc annotations (`npm run typecheck`), Prettier (`npm run format`),
  `.editorconfig`, `.gitattributes`, a fuller `.gitignore`, a committed lockfile, and a CI
  workflow running `npm run check` and coverage on Node 22 and 24.
- Tests for dates, text, state, router, chart, the cloud store (against a fake `db`), import
  resumption, price merging, and the catalog build script (Python). Coverage thresholds:
  90 % lines, 85 % branches.

## 2.0.0 (2026-11-18)

Restructured for maintainability. Same features, same stored data.

- Split the single HTML page into ES modules: `domain/` (pure logic), `data/` (catalog, store),
  `actions.js`, `state.js`, `router.js` and `ui/`.
- Storage behind a `TradeStore` interface with cloud and in-memory implementations;
  transient errors retried with backoff.
- Validation centralised in `validateTrade`; all writes go through `actions.js`.
- Documents now carry `schemaVersion` and `updatedAt`; older documents still load.
- History toolbar keeps focus while filtering; sortable headers are real buttons (keyboard accessible).
- Import retry no longer duplicates rows saved before a failure.
- Catalog build script (`scripts/build_catalog.py`) with documented data source.
- Item search ignores apostrophes and punctuation: "coiffe d og" finds "Coiffe d'Ogivol".
- French plurals in counts ("1 vente", "2 ventes").
- ESLint (`npm run lint`), 26 unit tests (`npm test`), README, architecture and data-model docs.

## 1.0.0 (2026-11-18)

- First version: entry form with autocomplete and recipe cost helper, En cours / Historique /
  Analyse views, spreadsheet import and export, storage in the artifact database.
- 33 trades imported from the original spreadsheet (Chevalure → Chevelure de Tal Kasha).
