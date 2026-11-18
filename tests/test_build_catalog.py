"""Tests for scripts/build_catalog.py against a tiny SQLite file shaped like the dofus-sqlite export.

Run: python3 -m unittest discover -s tests -p "test_*.py"   (or: npm run test:py)
"""

from __future__ import annotations

import io
import json
import sqlite3
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

import build_catalog  # noqa: E402

SCHEMA = """
create table translations (id integer, lang text, value text);
create table ItemTypeData (id integer, nameId integer, categoryId integer);
create table ItemData (id integer, nameId integer, typeId integer, level integer);
create table WeaponData (id integer, nameId integer, typeId integer, level integer);
create table RecipeData (id integer, resultId integer, quantities text);
create table RecipeData_ingredientIds_junction (RecipeData_id integer, target_id integer);
"""


def make_export(path: Path) -> None:
    con = sqlite3.connect(path)
    con.executescript(SCHEMA)
    con.executemany(
        "insert into translations values (?, ?, ?)",
        [
            (1, "fr", "Cape"),
            (2, "fr", "Ressource"),
            (3, "fr", "Quête"),
            (10, "fr", "Cape d'Ogivol"),
            (11, "fr", "Étoffe"),
            (12, "fr", "Fil"),
            (13, "fr", "#placeholder"),
            (14, "fr", "Clé de quête"),
            (15, "fr", "Arc"),
            (16, "fr", "Arc Hidsad"),
            (10, "en", "Ogivol Cloak"),
        ],
    )
    con.executemany(
        "insert into ItemTypeData values (?, ?, ?)",
        [(100, 1, 0), (101, 2, 2), (102, 3, 3), (103, 15, 0)],  # category 3 is not tradable
    )
    con.executemany(
        "insert into ItemData values (?, ?, ?, ?)",
        [(1000, 10, 100, 186), (1001, 11, 101, 150), (1002, 12, 101, 1), (1003, 13, 101, 1), (1004, 14, 102, 1)],
    )
    con.execute("insert into WeaponData values (2000, 16, 103, 60)")
    con.executemany(
        "insert into RecipeData values (?, ?, ?)",
        [
            (1, 1000, "[8, 2]"),  # kept
            (2, 1000, "[1]"),  # duplicate result: skipped
            (3, 2000, "[1, 1]"),  # one ingredient for two quantities: skipped
            (4, 1004, "[1]"),  # result not tradable: ignored
        ],
    )
    con.executemany(
        "insert into RecipeData_ingredientIds_junction values (?, ?)",
        [(1, 1001), (1, 1002), (2, 1002), (3, 1001), (4, 1001)],
    )
    con.commit()
    con.close()


class BuildCatalogTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.db = Path(self.tmp.name) / "dofus.sqlite"
        make_export(self.db)

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def test_build_keeps_tradable_named_items_sorted_by_name(self) -> None:
        catalog, _ = build_catalog.build(self.db)
        self.assertEqual(catalog["types"], ["Arc", "Cape", "Ressource"])
        names = [row[1] for row in catalog["items"]]
        self.assertEqual(names, ["Arc Hidsad", "Cape d'Ogivol", "Fil", "Étoffe"])
        self.assertIn([1000, "Cape d'Ogivol", 186, 1], catalog["items"])

    def test_build_pairs_ingredients_with_quantities_and_counts_skips(self) -> None:
        catalog, skipped = build_catalog.build(self.db)
        self.assertEqual(catalog["recipes"], {"1000": [[1001, 8], [1002, 2]]})
        self.assertEqual(skipped, {"mismatched": 1, "duplicate": 1})

    def test_dumps_is_valid_json_with_one_entry_per_line(self) -> None:
        catalog, _ = build_catalog.build(self.db)
        text = build_catalog.dumps(catalog)
        self.assertEqual(json.loads(text), catalog)
        self.assertIn('\n[1000,"Cape d\'Ogivol",186,1],\n', text)
        self.assertIn('\n"1000":[[1001,8],[1002,2]]\n', text)

    def test_main_writes_the_target_file(self) -> None:
        target = Path(self.tmp.name) / "out.json"
        with redirect_stdout(io.StringIO()) as out:
            self.assertEqual(build_catalog.main(["build_catalog.py", str(self.db), str(target)]), 0)
        self.assertIn("skipped 1 mismatched and 1 duplicate", out.getvalue())
        self.assertEqual(len(json.loads(target.read_text(encoding="utf-8"))["items"]), 4)


if __name__ == "__main__":
    unittest.main()
