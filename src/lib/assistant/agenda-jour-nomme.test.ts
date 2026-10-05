import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { preparerBaseEssai } from "@/test/base-essai";

preparerBaseEssai();

/** Un jour nommé (« lundi ») dit ce même jour : le jour même si l'heure visée est à venir, sinon la semaine suivante. */
describe("lireDateDictee : un jour nommé dit ce jour-là", () => {
  // Lundi 5 octobre 2026, 10 h à Paris (heure d'été).
  const LUNDI_10H = new Date("2026-10-05T08:00:00.000Z");
  const paris = (d: Date | null) => d?.toLocaleString("fr-FR", { timeZone: "Europe/Paris", weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });

  test("« lundi » à 9 h par défaut, dit lundi à 10 h : le lundi suivant", async () => {
    const { lireDateDictee } = await import("@/lib/assistant/agenda");
    assert.equal(paris(lireDateDictee("lundi", LUNDI_10H, 9)), "lundi 12 octobre à 09:00");
  });

  test("« lundi 14h », dit lundi à 10 h : aujourd'hui à 14 h", async () => {
    const { lireDateDictee } = await import("@/lib/assistant/agenda");
    assert.equal(paris(lireDateDictee("lundi 14h", LUNDI_10H)), "lundi 5 octobre à 14:00");
  });

  test("« mardi », dit lundi : le lendemain ; « lundi prochain » : la semaine suivante", async () => {
    const { lireDateDictee } = await import("@/lib/assistant/agenda");
    assert.equal(paris(lireDateDictee("mardi", LUNDI_10H, 9)), "mardi 6 octobre à 09:00");
    assert.equal(paris(lireDateDictee("lundi prochain 14h", LUNDI_10H)), "lundi 12 octobre à 14:00");
  });
});
