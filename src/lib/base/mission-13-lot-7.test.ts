import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { dateCourte, euros, heure, jour, jourAvecAnnee, jourHeure, jourHeureCourt, jourLong, quand } from "@/lib/commun/format";

/**
 * Mission 13 (29/09/2026), lot 7 — un seul `format.ts` pour les dates et les
 * montants, en heure de Paris quelle que soit la machine ; les écrans et les
 * outils de l'assistant n'ont plus d'aide locale (`euros`, `jour`, `heure`, `quand`).
 */

const espaces = (texte: string | null) => texte?.replace(/\s/g, " ") ?? null;

describe("format.ts : montants", () => {
  test("euros : sans décimales inutiles, deux sur demande, séparateur de milliers", () => {
    assert.equal(espaces(euros(1250)), "1 250 €");
    assert.equal(euros(12.5), "12,5 €");
    assert.equal(euros(12.5, 2), "12,50 €");
    assert.equal(euros(12, 2), "12,00 €");
    assert.equal(euros(12.345), "12,35 €");
  });
});

describe("format.ts : dates en heure de Paris", () => {
  const t = "2026-09-12T12:05:00.000Z"; // 14:05 à Paris (heure d'été)
  test("jour, jour avec année, jour long, date courte", () => {
    assert.equal(jour(t), "12 sept.");
    assert.equal(jourAvecAnnee(t), "12 sept. 2026");
    assert.equal(jourLong(t), "12 septembre 2026");
    assert.equal(dateCourte(t), "12/09/2026");
    assert.equal(dateCourte("2026-09-12"), "12/09/2026", "une date seule ne change pas de jour");
    assert.equal(jour(null), null);
    assert.equal(jour(""), null);
    assert.equal(dateCourte("pas une date"), null);
  });
  test("heures : le rendu serveur (UTC) donne la même heure que le téléphone", () => {
    assert.equal(heure(t), "14:05");
    assert.match(jourHeure(t), /^12 sept\.,? 14:05$/);
    assert.match(jourHeureCourt(t), /^12\/09,? 14:05$/);
    assert.equal(heure("2026-01-15T12:05:00.000Z"), "13:05", "heure d'hiver");
  });
  test("quand : relatif pour les listes", () => {
    const maintenant = new Date("2026-09-12T15:00:00.000Z"); // 17:00 à Paris
    assert.equal(quand("2026-09-12T14:59:40.000Z", maintenant), "à l'instant");
    assert.equal(quand("2026-09-12T14:48:00.000Z", maintenant), "il y a 12 min");
    assert.equal(quand("2026-09-12T12:05:00.000Z", maintenant), "il y a 3 h");
    assert.equal(quand("2026-09-11T20:00:00.000Z", maintenant), "hier");
    assert.equal(quand("2026-09-08T20:00:00.000Z", maintenant), "il y a 4 jours");
    assert.equal(quand("2026-08-01T20:00:00.000Z", maintenant), "1 août");
    assert.equal(quand("2025-08-01T20:00:00.000Z", maintenant), "1 août 2025");
    assert.equal(quand(null, maintenant), null);
    assert.equal(quand("2026-09-12T14:48:00.000Z", maintenant.getTime()), "il y a 12 min", "le « maintenant » peut être un nombre");
  });
});
