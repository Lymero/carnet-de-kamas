import { test } from "node:test";
import assert from "node:assert/strict";
import { escapeHtml, normalize, plural } from "../src/js/domain/text.js";

test("normalize ignores case, accents, ligatures and punctuation", () => {
  assert.equal(normalize("Coiffe d’Ogivol"), "coiffe d ogivol");
  assert.equal(normalize("COIFFE D'OGIVOL"), "coiffe d ogivol");
  assert.equal(normalize("  Étoffe   Mystérieuse "), "etoffe mysterieuse");
  assert.equal(normalize("Cœur de Bouftou"), "coeur de bouftou");
  assert.equal(normalize(null), "");
});

test("escapeHtml escapes every character that matters in text and attributes", () => {
  assert.equal(
    escapeHtml(`<a href="x" title='y'>&</a>`),
    "&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;",
  );
  assert.equal(escapeHtml(42), "42");
  assert.equal(escapeHtml(undefined), "");
});

test("plural follows French rules (0 and 1 are singular)", () => {
  assert.equal(plural(1, "vente"), "1 vente");
  assert.equal(plural(0, "vente"), "0 vente");
  assert.equal(plural(2, "vente"), "2 ventes");
  assert.equal(plural(3, "opération importée", "opérations importées"), "3 opérations importées");
});
