import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { dateExacte, dateRelative, depuisLisible, heureLisible } from "./dates";

/** Mission 22 (A1) — les dates de la v2 en phrases, heure de Paris (été : UTC+2 ; hiver : UTC+1). */
const maintenant = new Date("2026-10-06T14:30:00.000Z"); // mardi 6 octobre 2026, 16 h 30 à Paris

describe("dateRelative : un moment passé en phrase", () => {
  test("à l'instant, il y a N min, il y a N h le même jour", () => {
    assert.equal(dateRelative("2026-10-06T14:29:40.000Z", maintenant), "à l'instant");
    assert.equal(dateRelative("2026-10-06T14:18:00.000Z", maintenant), "il y a 12 min");
    assert.equal(dateRelative("2026-10-06T11:30:00.000Z", maintenant), "il y a 3 h");
    assert.equal(dateRelative("2026-10-05T23:30:00.000Z", maintenant), "il y a 15 h", "1 h 30 à Paris : encore aujourd'hui");
  });

  test("hier avec l'heure, puis le jour de la semaine, puis la date", () => {
    assert.equal(dateRelative("2026-10-05T16:40:00.000Z", maintenant), "hier 18 h 40");
    assert.equal(dateRelative("2026-10-05T21:59:00.000Z", maintenant), "hier 23 h 59");
    assert.equal(dateRelative("2026-10-02T07:00:00.000Z", maintenant), "vendredi 9 h");
    assert.equal(dateRelative("2026-09-30T07:00:00.000Z", maintenant), "mercredi 9 h", "6 jours : encore le jour de la semaine");
    assert.equal(dateRelative("2026-09-29T07:00:00.000Z", maintenant), "le 29 sept. 9 h", "7 jours : la date");
    assert.equal(dateRelative("2025-12-24T17:05:00.000Z", maintenant), "le 24 déc. 2025 18 h 05", "autre année : avec l'année");
  });

  test("un moment à venir : dans N min, dans N h, demain, le jour", () => {
    assert.equal(dateRelative("2026-10-06T14:50:00.000Z", maintenant), "dans 20 min");
    assert.equal(dateRelative("2026-10-06T17:30:00.000Z", maintenant), "dans 3 h");
    assert.equal(dateRelative("2026-10-07T07:00:00.000Z", maintenant), "demain 9 h");
    assert.equal(dateRelative("2026-10-09T07:00:00.000Z", maintenant), "vendredi 9 h");
  });

  test("une date illisible rend une chaîne vide ; un Date est accepté", () => {
    assert.equal(dateRelative("n'importe quoi", maintenant), "");
    assert.equal(dateRelative(new Date("2026-10-06T14:18:00.000Z"), maintenant), "il y a 12 min");
  });
});

describe("heureLisible, dateExacte, depuisLisible", () => {
  test("9 h, 18 h 30 ; la date exacte en toutes lettres pour le survol", () => {
    assert.equal(heureLisible(new Date("2026-10-06T07:00:00.000Z")), "9 h");
    assert.equal(heureLisible(new Date("2026-10-06T16:30:00.000Z")), "18 h 30");
    assert.equal(dateExacte("2026-10-05T16:40:00.000Z"), "lundi 5 octobre 2026 à 18 h 40");
    assert.equal(dateExacte("rien"), "");
  });

  test("depuis hier 18 h 40, depuis 3 h, depuis 9 jours", () => {
    assert.equal(depuisLisible("2026-10-05T16:40:00.000Z", maintenant), "depuis hier 18 h 40");
    assert.equal(depuisLisible("2026-10-06T11:30:00.000Z", maintenant), "depuis 3 h");
    assert.equal(depuisLisible("2026-09-27T11:30:00.000Z", maintenant), "depuis 9 jours");
  });
});
