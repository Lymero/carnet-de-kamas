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

## Using it

The app is published as a Claude artifact. Open it from claude.ai while signed in;
your data is stored with the artifact and follows you across devices.

**Add a trade.** Fill the left form. Amounts accept `250k`, `1.8m`, `1 850 000`, `1,850,000.00`.

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
are the original sheet's plus _Prix de vente_ and _Date de vente_, so pasting the backup into
_Importer depuis Sheets_ restores every figure (recipe breakdowns are not included). If the
browser blocks the clipboard, the text opens in a dialog to copy by hand.

Sharing: the page starts private. If you share it, other people can **view** it; only
the owner can change data (database rule `write: owner`).

## Project layout

```
carnet-de-kamas/
├── README.md, CHANGELOG.md
├── package.json            npm scripts (see Development) and pinned dev tools
├── eslint.config.js        lint rules (undefined names, unused code)
├── jsconfig.json           type checking of the JSDoc annotations
├── .prettierrc.json        formatting (Prettier); .editorconfig for editors
├── .github/workflows/      CI: npm run check + coverage on Node 22 and 24
├── docs/
│   ├── ARCHITECTURE.md     layers, data flow, design decisions
│   └── DATA-MODEL.md       stored documents, validation, catalog format
├── scripts/
│   └── build_catalog.py    regenerates src/data/dofus-data.json from game data
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
└── tests/                  node:test suites (*.test.js) and the catalog script test (test_*.py)
```

## Development

Requirements: Node.js ≥ 22 and Python 3 (catalog build, its test, and the local server).
The app has no runtime dependencies and no build step: the browser loads the ES modules
directly. The dev tools (ESLint, Prettier, TypeScript for type checking) are pinned in
`package-lock.json`.

```bash
npm ci                   # install the pinned dev tools
npm run check            # format check, lint, type check, JS and Python tests
npm run serve            # http://localhost:8000 (ES modules need http://, not file://)
```

| Script                  | What it does                                                     |
| ----------------------- | ---------------------------------------------------------------- |
| `npm run check`         | Everything below except coverage. CI runs it on every push / PR. |
| `npm run format`        | Rewrites files with Prettier (`format:check` only verifies).     |
| `npm run lint`          | ESLint.                                                          |
| `npm run typecheck`     | `tsc` over `src/js` using the JSDoc types; emits nothing.        |
| `npm test`              | `node:test` suites in `tests/*.test.js`.                         |
| `npm run test:py`       | `unittest` for `scripts/build_catalog.py`.                       |
| `npm run test:coverage` | JS tests with coverage; fails under 90 % lines / 85 % branches.  |

Run locally, the page has no `db` capability and falls back to an in-memory store:
everything works, nothing is saved, and the status line says so.

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
- `npm run check` must pass before committing or publishing.

### Updating the item catalog

After a game update, download `dofus.sqlite` from
[ledouxm/dofus-sqlite releases](https://github.com/ledouxm/dofus-sqlite/releases) (keep it out
of the repository; `*.sqlite` is git-ignored) and run:

```bash
npm run build:catalog -- path/to/dofus.sqlite
```

The output has one item or recipe per line, so the commit diff lists what the game update changed.
See the docstring in `scripts/build_catalog.py` for what is included and how recipes are read.

### Publishing

The published files are the contents of `src/` (paths relative to it: `index.html`,
`css/app.css`, `js/...`, `data/dofus-data.json`). Republish to the same artifact so the
stored data is kept. The page declares two capabilities:

```json
{ "db": { "rules": [{ "path": "", "read": "view", "write": "owner" }] }, "user": {} }
```

## Limits

- **No live HDV prices.** Ankama publishes no market API, and tools that read the game
  client break the terms of use. Prices are what you type; unit prices are remembered.
- **Recipes come from data-mined game files.** Check quantities the first time you use a recipe.
  `src/data/dofus-data.json` is derived from Ankama's game client: keep that in mind before
  making the repository public.
- Rows imported from the old spreadsheet have no sale date; they count in the month of the trade date.
