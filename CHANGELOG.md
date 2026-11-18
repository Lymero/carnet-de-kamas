# Changelog

## Unreleased

### Added

- **Local mode, the new normal way to run the app**: `npm start` serves it at
  http://localhost:8000 and saves everything in `data/carnet.json` on this computer (one readable
  JSON file, atomic writes, a backup at each start, git-ignored). Open tabs stay in sync. The
  server has no dependencies, only answers this computer, and refuses requests from other sites.
  The claude.ai artifact mode still works.

- End-to-end browser tests (`npm run test:e2e`, Playwright with the installed Chrome) covering
  every view, the dialogs, import/export, themes, phone widths, the cloud code path and read-only
  mode; they run in CI and fail on any page error.
- Git hooks, enabled by `npm install`: `npm run check` before each commit, and
  `npm run check:all` (coverage and browser tests included) before each push.

### Fixed

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
