import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { applicationGooglePubliee, dureeRestante, echeanceJetonGoogle } from "./echeance";

const HEURE = 3_600_000;

describe("échéance de la connexion Google", () => {
  const depuis = new Date("2026-09-10T12:00:00Z");
  const le = (iso: string) => echeanceJetonGoogle({ depuis }, { maintenant: new Date(iso) });

  test("mode Test : 7 jours après l'autorisation ; rappel à 48 h, insistant à 24 h, puis expirée", () => {
    assert.equal(le("2026-09-12T12:00:00Z").expireLe, "2026-09-17T12:00:00.000Z");
    assert.equal(le("2026-09-15T11:59:00Z").niveau, "LOINTAINE");
    assert.equal(le("2026-09-15T12:00:00Z").niveau, "PROCHE", "48 h pile");
    assert.equal(le("2026-09-16T12:00:00Z").niveau, "IMMINENTE", "24 h pile");
    assert.equal(le("2026-09-17T12:00:00Z").niveau, "EXPIREE");
    assert.equal(le("2026-09-20T08:00:00Z").resteMs! < 0, true);
  });

  test("un refus de Google coupe la connexion avant les 7 jours ; application publiée : plus d'échéance", () => {
    const coupee = echeanceJetonGoogle({ depuis, derniereErreur: "Accès révoqué ou expiré côté Google : reconnecter." }, { maintenant: new Date("2026-09-11T00:00:00Z") });
    assert.deepEqual([coupee.niveau, coupee.coupee], ["EXPIREE", true]);

    const publiee = echeanceJetonGoogle({ depuis }, { maintenant: new Date("2026-12-01T00:00:00Z"), modeTest: false });
    assert.deepEqual([publiee.niveau, publiee.expireLe, publiee.resteMs], ["LOINTAINE", null, null]);
    assert.equal(applicationGooglePubliee({ GOOGLE_APPLICATION_PUBLIEE: "1" }), true);
    assert.equal(applicationGooglePubliee({}), false, "par défaut, mode Test");
  });

  test("durée restante lisible", () => {
    assert.equal(dureeRestante(44 * HEURE + 10 * 60_000), "1 j 20 h");
    assert.equal(dureeRestante(48 * HEURE), "2 j");
    assert.equal(dureeRestante(5 * HEURE + 59 * 60_000), "5 h");
    assert.equal(dureeRestante(20 * 60_000), "moins d'une heure");
    assert.equal(dureeRestante(-5), "moins d'une heure");
  });
});
