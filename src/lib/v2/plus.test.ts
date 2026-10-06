import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { libelleDansPlus, phraseEnAttente } from "./plus";

/** Mission 22 (A5) — le menu « Plus » : ce qui attend, en phrase, jamais en badge. */
describe("phraseEnAttente : un nombre en phrase, rien sous 1", () => {
  test("1, 3, 120 → « N en attente » ; 0, négatif, absent, NaN → rien", () => {
    assert.equal(phraseEnAttente(1), "1 en attente");
    assert.equal(phraseEnAttente(3), "3 en attente");
    assert.equal(phraseEnAttente(120), "120 en attente");
    assert.equal(phraseEnAttente(2.9), "2 en attente", "un entier, toujours");
    for (const rien of [0, -1, null, undefined, Number.NaN, Number.POSITIVE_INFINITY]) assert.equal(phraseEnAttente(rien), null, String(rien));
  });
});

describe("libelleDansPlus : « À valider — 3 en attente », sinon le libellé seul", () => {
  test("avec et sans attente", () => {
    assert.equal(libelleDansPlus("À valider", 3), "À valider — 3 en attente");
    assert.equal(libelleDansPlus("À valider", 1), "À valider — 1 en attente");
    assert.equal(libelleDansPlus("À valider", 0), "À valider");
    assert.equal(libelleDansPlus("À valider"), "À valider");
    assert.equal(libelleDansPlus("Boîte mail", 5), "Boîte mail — 5 en attente", "la règle ne connaît pas l'écran : c'est la navigation qui ne l'applique qu'à À valider");
  });
});
