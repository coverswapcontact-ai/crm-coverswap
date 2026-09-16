import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { preparerBaseEssai } from "@/test/base-essai";

preparerBaseEssai();

let prisma: typeof import("@/lib/prisma").default;
let service: typeof import("./service");

before(async () => {
  prisma = (await import("@/lib/prisma")).default;
  service = await import("./service");
  await (await import("@/lib/base/preparation")).preparerBase();
});

after(async () => {
  await prisma.$disconnect();
});

describe("paramètres datés", () => {
  test("aucune valeur par défaut : un paramètre absent est exigé", async () => {
    await assert.rejects(
      () => service.exigerParametres(["TAUX_COTISATIONS_SOCIALES", "PERIODICITE_DECLARATION"]),
      (erreur: unknown) => {
        assert.ok(erreur instanceof service.ParametresManquants);
        assert.equal(erreur.status, 428);
        assert.deepEqual(erreur.details?.parametresManquants, ["TAUX_COTISATIONS_SOCIALES", "PERIODICITE_DECLARATION"]);
        return true;
      }
    );
  });

  test("la valeur d'une date est celle en vigueur à cette date", async () => {
    await service.enregistrerParametre({ cle: "TAUX_COTISATIONS_SOCIALES", valeur: "21,2", valableDu: new Date("2026-01-01"), source: "Essai" });
    await service.enregistrerParametre({ cle: "TAUX_COTISATIONS_SOCIALES", valeur: 21.5, valableDu: new Date("2026-07-01") });
    assert.equal(await service.lireParametre("TAUX_COTISATIONS_SOCIALES", new Date("2026-03-15")), 21.2);
    assert.equal(await service.lireParametre("TAUX_COTISATIONS_SOCIALES", new Date("2026-08-01")), 21.5);
    assert.equal(await service.lireParametre("TAUX_COTISATIONS_SOCIALES", new Date("2025-12-31")), null);
    await assert.rejects(() => service.exigerParametres(["TAUX_COTISATIONS_SOCIALES"], new Date("2025-06-01")), /À renseigner/);
  });

  test("valeurs contrôlées selon leur nature", async () => {
    await assert.rejects(() => service.enregistrerParametre({ cle: "TAUX_CFP", valeur: 150, valableDu: new Date() }), /entre 0 et 100/);
    await assert.rejects(() => service.enregistrerParametre({ cle: "PERIODICITE_DECLARATION", valeur: "ANNUELLE", valableDu: new Date() }), /choix invalide/);
    await assert.rejects(() => service.enregistrerParametre({ cle: "DELAI_PAIEMENT_PROFESSIONNELS", valeur: 30.5, valableDu: new Date() }), /jours invalide/);
    await assert.rejects(() => service.enregistrerParametre({ cle: "INCONNU", valeur: 1, valableDu: new Date() }), /Paramètre inconnu/);
  });

  test("une saisie ne se modifie pas : on en ajoute une nouvelle", async () => {
    const ligne = await prisma.parametre.findFirstOrThrow({ where: { cle: "TAUX_COTISATIONS_SOCIALES" } });
    await assert.rejects(
      () => prisma.parametre.update({ where: { id: ligne.id }, data: { valeur: "30" } }),
      /ne se modifie pas/
    );
    await assert.rejects(() => prisma.parametre.delete({ where: { id: ligne.id } }), /Suppression interdite/);
  });
});
