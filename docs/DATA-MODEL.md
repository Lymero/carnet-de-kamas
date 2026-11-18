# Data model

## Stored documents

The app stores documents in one of two places, with the same shapes:

- **Local data file** (`npm start`, the normal way to run it): `data/carnet.json`, described
  in [Local data file](#local-data-file) below.
- **Claude artifact database** (when published on claude.ai): paths with an even number of
  segments are documents, odd ones are collections.

```
trades/<id>         one Trade per document
settings/prices     remembered unit prices for the recipe helper
```

### `trades/<id>`

| Field           | Type                                          | Required           | Meaning                                               |
| --------------- | --------------------------------------------- | ------------------ | ----------------------------------------------------- |
| `date`          | `"YYYY-MM-DD"`                                | yes                | Day the item was crafted or bought.                   |
| `item`          | string                                        | yes                | Item name, normally the French in-game name.          |
| `cat`           | `"craft"` \| `"resale"`                       | yes                | _Craft/FM_ or _Achat/revente_.                        |
| `cost`          | integer ≥ 0                                   | yes                | Kamas invested, including runes for FM.               |
| `expected`      | integer ≥ 0                                   | yes                | Planned sale price.                                   |
| `sold`          | boolean                                       | yes                | Sold or still listed.                                 |
| `soldPrice`     | integer \| null                               | when sold          | Real sale price.                                      |
| `soldDate`      | `"YYYY-MM-DD"` \| null                        | no                 | Sale day; null for rows imported from the old sheet.  |
| `hdvTax`        | `2` \| `1` \| `0`                             | no                 | Auction-house tax in % (listed, price updated, none). |
| `recipe`        | `[ingredientId, quantity, unitPrice\|null][]` | no                 | Ingredient breakdown at the time of the craft.        |
| `runes`         | integer                                       | no                 | Runes / forgemagie spend included in `cost`.          |
| `source`        | `"sheet"`                                     | no                 | Set on rows imported from a spreadsheet.              |
| `schemaVersion` | integer                                       | written by the app | Currently `1`.                                        |
| `updatedAt`     | ISO timestamp                                 | written by the app | Last write.                                           |

Ids: `s001`…`s033` for the rows imported at set-up; new trades use `t<time><random>`.

**Derived values (never stored):** price = `sold ? soldPrice : expected`;
tax = round(price × `hdvTax` / 100) (`auctionTax`; rates in `HDV_TAX`, `config.js`; absent = 0);
profit = price − cost − tax; margin % = profit / cost. See `src/js/domain/trade.js`. The tax is
derived rather than stored, so it follows any change of price.

**Validation on write** (`validateTrade`, the same rules for the form, edits, sales and imports):
`item` is non-empty and at most 200 characters; `date` and `soldDate` are real calendar days;
`soldDate`, when known, is not before `date`; amounts are whole and non-negative.

**Reading** (`normalizeTrade`): stored documents are treated as untrusted. Missing or malformed
fields get safe defaults (an invalid `date` becomes `1970-01-01`, an invalid `soldDate` becomes
null), malformed `recipe` lines are dropped, and a non-numeric `runes` or non-string `source` is
ignored. Unknown fields are kept, so a newer version's documents survive an edit by an older one.

**Compatibility:** because of that defensive reading, documents written before `schemaVersion`
existed still load. When the shape
changes, bump `SCHEMA_VERSION` in `config.js`, keep `normalizeTrade` able to read the old
shape, and note it in `CHANGELOG.md`.

### `settings/prices`

```json
{ "p": { "13157": 12500, "14928": 3200 } }
```

Ingredient id → last unit price typed, in kamas. The document is created on the first save,
then each save is a merge (`update({ p: { <id>: price } })`) of only the prices that changed, so
prices saved from another device, or not loaded yet, are kept.

### Access rules (artifact only)

```json
{ "db": { "rules": [{ "path": "", "read": "view", "write": "owner" }] } }
```

Anyone the page is shared with can read; only the owner writes.

## Local data file

`data/carnet.json` by default (`--data` or `CARNET_DATA` to change it), written by
`server/file-store.js`, pretty-printed so it can be read and diffed:

```json
{
  "version": 1,
  "trades": {
    "s001": { "date": "2026-08-20", "item": "Ceinture du Minotot", "cat": "craft", "cost": 173796, "...": "..." }
  },
  "prices": { "13157": 12500 }
}
```

- `trades` holds the `trades/<id>` documents above, keyed by id; `prices` is the `p` map of
  `settings/prices`.
- `version` is the file format (currently 1). A file from a newer version, or one that is not
  valid JSON, is refused at start and left untouched.
- Every change rewrites the file atomically (temporary file, fsync, rename), one at a time.
- Each start copies the previous file to `carnet.backup.json` next to it.
- The server checks the shape of what it stores (ids, a JSON object per trade, whole
  non-negative prices); the field-level rules are `validateTrade`'s, applied in the browser.

## Item catalog (`src/data/dofus-data.json`)

Generated by `scripts/build_catalog.py`; read-only at runtime.

```json
{
  "types": ["Amulette", "Anneau", "..."],
  "items": [[13131, "Cape d'Ogivol", 186, 20], "..."],
  "recipes": { "13131": [[9281, 1], [14928, 3], "..."] }
}
```

- `items[i] = [id, name, level, index into types]`, sorted by name; ~11,000 items.
- `recipes[resultId] = [[ingredientId, quantity], ...]`; ~4,500 recipes.
- Ingredient ids are item ids, so their names come from `items`.
- The file has one item or recipe per line, so regenerating it gives a readable git diff.

## Spreadsheet export (`toTsv`)

Tab-separated, oldest first, with this header:

```
Date | Item | Catégorie | Investissement | Vente potentielle | Bénéfice | Bénéfice % | Vendu ? | Prix de vente | Date de vente | Taxe HDV
```

The first eight columns are the original spreadsheet's, so old and new pastes import the same
way. _Bénéfice_ is realised for sold rows and expected otherwise, after the tax. _Taxe HDV_ is the
rate (`2 %`, `1 %`, `0 %`); on import a ticked box (`TRUE`, `VRAI`…) also means 2 %. _Prix de vente_ and _Date de vente_ are empty for unsold rows. `parseSheetPaste` reads all of them back, so an export
re-imports without loss except for `recipe`, `runes` and `updatedAt`.
