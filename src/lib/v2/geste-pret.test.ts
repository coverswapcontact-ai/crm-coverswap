import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { Raccourci, TacheVue } from "@/lib/a-faire/types";
import { ENSUITE_VISIBLES, MINUTES_V2, PLUS_TARD_VISIBLES, decouper, libelleVoirAutres, messageReponse, ouvertes, phraseVide } from "./aujourdhui";
import { estSensible, gestePret, libelleBalayageDroite, numeroDe, raccourciDe, sansRaccourci, valideDansLaLigne } from "./geste-pret";

/**
 * Mission 22 (A2) — la règle pure du « geste prêt » (quel bouton principal, quel libellé, à partir d'une tâche) et la
 * logique pure d'Aujourd'hui (découpe en blocs, bornes, ligne de réponse). Aucune base, aucun composant.
 */
function tache(raccourci: Partial<Raccourci> & { genre: Raccourci["genre"] }, donnees: Record<string, unknown> = {}, type: TacheVue["type"] = "APPELER"): Pick<TacheVue, "raccourci" | "donnees" | "type"> {
  return { raccourci: { libelle: "Faire", ...raccourci }, donnees, type };
}

describe("gestePret : un seul bouton principal par carte", () => {
  test("un appel avec un numéro lisible : un lien tel: ; sans numéro : l'action (la fiche, où le numéro se corrige)", () => {
    const g = gestePret(tache({ genre: "APPEL", libelle: "Appeler", telephone: "06 11 22 33 44" }));
    assert.deepEqual([g.forme, g.libelle, g.href, g.telephone], ["APPEL", "Appeler", "tel:0611223344", "06 11 22 33 44"]);
    assert.equal(numeroDe(tache({ genre: "APPEL", telephone: "12" })), null);
    assert.equal(gestePret(tache({ genre: "APPEL", libelle: "Appeler", telephone: null })).forme, "ACTION");
  });

  test("une proposition qui se valide d'un geste : Valider ; une sensible : « Relire et valider » vers son aperçu", () => {
    const simple = tache({ genre: "VALIDER", libelle: "Valider", propositionId: "p1" });
    assert.ok(valideDansLaLigne(simple));
    assert.deepEqual([gestePret(simple).forme, gestePret(simple).libelle], ["VALIDER", "Valider"]);
    assert.equal(libelleBalayageDroite(simple), "Valider");
    const sensible = tache({ genre: "VALIDER", libelle: "Valider", propositionId: "p2" }, { sensible: true });
    assert.ok(estSensible(sensible));
    assert.ok(!valideDansLaLigne(sensible));
    assert.equal(raccourciDe(sensible).libelle, "Relire et valider");
    const g = gestePret(sensible);
    assert.deepEqual([g.forme, g.libelle, g.href, g.sensible], ["RELIRE", "Relire et valider", "/validation?proposition=p2", true]);
    assert.equal(libelleBalayageDroite(sensible), "Relire");
    // La proposition peut venir des données du détecteur.
    assert.ok(estSensible(tache({ genre: "VALIDER" }, { sensible: true, propositionId: "p3" })));
  });

  test("une tâche à moi sans rien à ouvrir : Fait ; une page externe : un lien dans un nouvel onglet ; une page du CRM : l'action", () => {
    const vide = tache({ genre: "PAGE", libelle: "Ouvrir", href: null });
    assert.ok(sansRaccourci(vide));
    assert.deepEqual([gestePret(vide).forme, gestePret(vide).libelle, gestePret(vide).genre], ["FAIT", "Fait", null]);
    assert.equal(libelleBalayageDroite(vide), "Fait");
    const externe = gestePret(tache({ genre: "PAGE", libelle: "Ouvrir la facturation", href: "https://exemple.test/", externe: true }));
    assert.deepEqual([externe.forme, externe.href], ["LIEN_EXTERNE", "https://exemple.test/"]);
    const interne = gestePret(tache({ genre: "PAGE", libelle: "Ouvrir les réglages", href: "/parametres" }));
    assert.deepEqual([interne.forme, interne.genre, interne.href], ["ACTION", "PAGE", null]);
  });

  test("les autres raccourcis gardent leur libellé et leur genre (icône)", () => {
    for (const genre of ["SMS", "MAIL", "ESPACE", "SIMULATEUR", "DEVIS", "RELANCE_MAIL", "PLANIFIER", "ENCAISSER", "DOSSIER", "LEAD", "COHERENCE"] as const) {
      const g = gestePret(tache({ genre, libelle: `Geste ${genre}` }));
      assert.deepEqual([g.forme, g.libelle, g.genre, g.href], ["ACTION", `Geste ${genre}`, genre, null], genre);
    }
  });
});

describe("aujourdhui : blocs, bornes, ligne de réponse", () => {
  const t = (id: string, statut: TacheVue["statut"] = "A_FAIRE") => ({ id, statut }) as TacheVue;

  test("Maintenant = la première, Ensuite = les cinq suivantes, le reste derrière « Voir les N autres »", () => {
    assert.deepEqual([ENSUITE_VISIBLES, PLUS_TARD_VISIBLES, [...MINUTES_V2]], [5, 3, [5, 15, 30]]);
    const huit = ["a", "b", "c", "d", "e", "f", "g", "h"].map((id) => t(id));
    const blocs = decouper(huit);
    assert.equal(blocs.maintenant?.id, "a");
    assert.deepEqual(blocs.ensuite.map((x) => x.id), ["b", "c", "d", "e", "f"]);
    assert.deepEqual(blocs.autres.map((x) => x.id), ["g", "h"]);
    assert.deepEqual(decouper([]), { maintenant: null, ensuite: [], autres: [] });
    assert.equal(libelleVoirAutres(2), "Voir les 2 autres");
    assert.equal(libelleVoirAutres(1), "Voir l'autre");
  });

  test("ouvertes : aujourd'hui et plus tard non reportées ; phraseVide", () => {
    assert.deepEqual([...ouvertes({ aujourdhui: [t("a")], plusTard: [t("b"), t("c", "PLUS_TARD")] })], ["a", "b"]);
    assert.equal(phraseVide(0), "Rien à faire maintenant.");
    assert.equal(phraseVide(1), "Rien à faire maintenant. Demain : 1 tâche revient.");
    assert.equal(phraseVide(3), "Rien à faire maintenant. Demain : 3 tâches reviennent.");
  });

  test("la ligne écrite après un geste : Fait, Validé, Plus tard · revient…, Ignoré, Pas à faire · raison", () => {
    const maintenant = Date.parse("2026-10-06T08:00:00.000Z");
    const appel = tache({ genre: "APPEL", libelle: "Appeler", telephone: "0611223344" });
    assert.equal(messageReponse(appel, { reponse: "FAIT" }, null, maintenant), "Fait");
    assert.equal(messageReponse(tache({ genre: "VALIDER", propositionId: "p" }, {}, "VALIDER"), { reponse: "FAIT" }, null, maintenant), "Validé");
    assert.equal(messageReponse(appel, { reponse: "PLUS_TARD", quand: "DEMAIN" }, { plusTardJusqua: "2026-10-07T07:00:00.000Z" }, maintenant), "Plus tard · revient demain 9 h");
    assert.equal(messageReponse(appel, { reponse: "PLUS_TARD", quand: "DEMAIN" }, null, maintenant), "Plus tard");
    assert.equal(messageReponse(tache({ genre: "VALIDER", propositionId: "p" }, {}, "VALIDER"), { reponse: "PAS_A_FAIRE", raison: "PAS_PERTINENT" }, null, maintenant), "Ignoré");
    assert.equal(messageReponse(appel, { reponse: "PAS_A_FAIRE", raison: "DEJA_FAIT" }, null, maintenant), "Pas à faire · déjà fait hors crm");
    assert.equal(messageReponse(appel, { reponse: "PAS_A_FAIRE", raison: "AUTRE", texte: "parce que" }, null, maintenant), "Pas à faire · autre");
  });
});
