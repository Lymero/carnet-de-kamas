#!/usr/bin/env python3
"""Build src/data/dofus-data.json, the item catalog used for autocomplete and recipes.

Source: the community-maintained Dofus 3 SQLite export
https://github.com/ledouxm/dofus-sqlite (download dofus.sqlite from its Releases page).
It is extracted from the game client, so names and recipes follow the latest game version.

Usage:
    python3 scripts/build_catalog.py path/to/dofus.sqlite [src/data/dofus-data.json]

Output shape (read by src/js/data/catalog.js):
    {
      "types":   ["Amulette", ...],                    # item type names (French)
      "items":   [[id, "Nom", level, typeIndex], ...], # sorted by name
      "recipes": {"<resultId>": [[ingredientId, quantity], ...]}  # sorted by id
    }
The file is written with one item or recipe per line: still compact, and a game
update shows up in git as a readable list of changed lines. Output is deterministic.

Which items are included: equipment, consumables and resources
(ItemTypeData.categoryId 0, 1 and 2), i.e. everything that can be traded at the HDV.
Placeholder names starting with "#" or "[" are skipped.

Ingredient order: the export stores recipe ingredients in a junction table and the
quantities as a JSON array on the recipe. The junction rows are inserted in the
original array order, so ordering by rowid pairs each ingredient with its quantity.
Recipes whose ingredient and quantity counts differ are dropped rather than guessed;
when several recipes produce the same item, the first one is kept. Both are counted
in the summary line.
"""

from __future__ import annotations

import json
import sqlite3
import sys
from contextlib import closing
from pathlib import Path

TRADABLE_CATEGORIES = (0, 1, 2)  # equipment, consumables, resources
ITEM_TABLES = ("ItemData", "WeaponData")
LANG = "fr"
DEFAULT_TARGET = Path(__file__).resolve().parent.parent / "src" / "data" / "dofus-data.json"


def build(db_path: Path) -> tuple[dict, dict[str, int]]:
    """Reads the SQLite export. Returns the catalog and counts of skipped recipes."""
    with closing(sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)) as con:
        names: dict[int, str | None] = {}

        def name(name_id) -> str | None:
            key = int(name_id)
            if key not in names:
                row = con.execute("select value from translations where id=? and lang=?", (key, LANG)).fetchone()
                names[key] = row[0] if row else None
            return names[key]

        types = {
            type_id: (name(name_id) or "", category)
            for type_id, name_id, category in con.execute("select id, nameId, categoryId from ItemTypeData")
        }

        items: dict[int, tuple[str, int, str]] = {}
        for table in ITEM_TABLES:
            for item_id, name_id, type_id, level in con.execute(f"select id, nameId, typeId, level from {table}"):
                type_name, category = types.get(type_id, ("", None))
                if category not in TRADABLE_CATEGORIES:
                    continue
                item_name = name(name_id)
                if not item_name or item_name[0] in "#[":
                    continue
                items[item_id] = (item_name, level, type_name)

        skipped = {"mismatched": 0, "duplicate": 0}
        recipes: dict[int, list[list[int]]] = {}
        for recipe_id, result_id, quantities in con.execute("select id, resultId, quantities from RecipeData order by id"):
            if result_id not in items:
                continue
            ingredients = [
                row[0]
                for row in con.execute(
                    "select target_id from RecipeData_ingredientIds_junction where RecipeData_id=? order by rowid",
                    (recipe_id,),
                )
            ]
            counts = json.loads(quantities)
            if len(counts) != len(ingredients):
                skipped["mismatched"] += 1
                continue
            if result_id in recipes:
                skipped["duplicate"] += 1
                continue
            recipes[result_id] = [[i, q] for i, q in zip(ingredients, counts)]

    type_names = sorted({t for _, _, t in items.values()})
    type_index = {t: i for i, t in enumerate(type_names)}
    rows = sorted(([i, n, lvl, type_index[t]] for i, (n, lvl, t) in items.items()), key=lambda r: (r[1], r[0]))
    catalog = {
        "types": type_names,
        "items": rows,
        "recipes": {str(result_id): recipes[result_id] for result_id in sorted(recipes)},
    }
    return catalog, skipped


def dumps(catalog: dict) -> str:
    """Serialises the catalog with one item or recipe per line (see module docstring)."""

    def compact(value) -> str:
        return json.dumps(value, ensure_ascii=False, separators=(",", ":"))

    items = ",\n".join(compact(row) for row in catalog["items"])
    recipes = ",\n".join(f"{compact(key)}:{compact(value)}" for key, value in catalog["recipes"].items())
    return f'{{"types":{compact(catalog["types"])},\n"items":[\n{items}\n],\n"recipes":{{\n{recipes}\n}}}}\n'


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        print(__doc__, file=sys.stderr)
        return 1
    source = Path(argv[1])
    target = Path(argv[2]) if len(argv) > 2 else DEFAULT_TARGET
    catalog, skipped = build(source)
    target.write_text(dumps(catalog), encoding="utf-8", newline="\n")
    # ASCII only: a Windows console or pipe may not be UTF-8.
    print(
        f"{len(catalog['items'])} items, {len(catalog['recipes'])} recipes -> {target} "
        f"({target.stat().st_size // 1024} KB); skipped {skipped['mismatched']} mismatched "
        f"and {skipped['duplicate']} duplicate recipes"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
