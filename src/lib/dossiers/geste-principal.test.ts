import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { TacheVue } from "@/lib/a-faire/types";
import type { EspaceResume } from "@/lib/espace/suivi-types";
import { cibleDuDefilement, RUBRIQUES_V2, rubriqueDeLEtape, rubriqueDemandee, TITRES_RUBRIQUES } from "@/lib/v2/rubriques-dossier";
import { ETAPES, RUBRIQUES_DOSSIER } from "./constants";
import { autresGestes, brouillonAPublier, gestePrincipal, libellePassage, tachePrete, type DossierPourGeste } from "./geste-principal";

/**
 * Mission 22 (A3) — la règle pure du bouton principal d'un dossier (un seul bouton vert : la tâche d'Aujourd'hui du
 * dossier, sinon le geste de l'étape), les autres gestes, et la rubrique ouverte par étape. Aucune base, aucun composant.
 */
const maintenant = new Date("2026-10-06T14:30:00.000Z");

const dossier = (p: Partial<DossierPourGeste> = {}): DossierPourGeste => ({ etape: "QUALIFICATION", etapeAvantSortie: null, dateChantier: null, photos: [], ...p });
const espace = (signaux: EspaceResume["signaux"] = []): Pick<EspaceResume, "signaux"> => ({ signaux });
const tache = (p: Partial<TacheVue> = {}): TacheVue => ({ id: "t1", statut: "A_FAIRE", plusTardJusqua: null, raccourci: { genre: "SMS", libelle: "Copier le SMS" }, donnees: {}, ...p }) as TacheVue;

describe("gestePrincipal : la tâche d'Aujourd'hui d'abord, sinon le geste de l'étape", () => {
  test("une tâche à faire du dossier : son raccourci, quel que soit l'état du dossier", () => {
    const g = gestePrincipal({ detail: dossier({ etape: "CHANTIER" }), espace: null, tache: tache(), maintenant });
    assert.deepEqual([g.genre, g.libelle, g.raccourci?.genre, g.tache?.id], ["TACHE", "Copier le SMS", "SMS", "t1"]);
  });

  test("Qualification : « Appeler » sans photo, « Préparer la simulation » dès qu'une photo est reçue", () => {
    assert.deepEqual(gestePrincipal({ detail: dossier(), espace: null, tache: null, maintenant }), { genre: "APPEL", libelle: "Appeler" });
    assert.deepEqual(gestePrincipal({ detail: dossier({ photos: [{}] }), espace: null, tache: null, maintenant }), { genre: "SIMULATEUR", libelle: "Préparer la simulation" });
  });

  test("Simulation : « Publier la simulation » s'il y a un brouillon dans l'espace, sinon « Faire le devis »", () => {
    const brouillon = espace([{ code: "BROUILLONS", libelle: "1 brouillon à publier", ton: "ambre" }]);
    assert.ok(brouillonAPublier(brouillon));
    assert.ok(!brouillonAPublier(espace([{ code: "HESITE", libelle: "Devis relu 2 fois sans signer", ton: "ambre" }])));
    assert.ok(!brouillonAPublier(null));
    assert.deepEqual(gestePrincipal({ detail: dossier({ etape: "SIMULATION" }), espace: brouillon, tache: null, maintenant }), { genre: "PUBLIER", libelle: "Publier la simulation" });
    assert.deepEqual(gestePrincipal({ detail: dossier({ etape: "SIMULATION" }), espace: espace(), tache: null, maintenant }), { genre: "DEVIS", libelle: "Faire le devis" });
    assert.deepEqual(gestePrincipal({ detail: dossier({ etape: "SIMULATION" }), espace: null, tache: null, maintenant }).genre, "DEVIS");
  });

  test("Devis envoyé et Relance : « Relancer »", () => {
    for (const etape of ["DEVIS_ENVOYE", "RELANCE"] as const) assert.deepEqual(gestePrincipal({ detail: dossier({ etape }), espace: null, tache: null, maintenant }), { genre: "RELANCER", libelle: "Relancer" }, etape);
  });

  test("Signé : « Fixer la date du chantier » ; la date déjà posée : « Passer en planifié »", () => {
    assert.deepEqual(gestePrincipal({ detail: dossier({ etape: "SIGNE" }), espace: null, tache: null, maintenant }), { genre: "DATE_CHANTIER", libelle: "Fixer la date du chantier" });
    assert.deepEqual(gestePrincipal({ detail: dossier({ etape: "SIGNE", dateChantier: "2026-10-20T00:00:00.000Z" }), espace: null, tache: null, maintenant }), { genre: "ETAPE", libelle: "Passer en planifié", etape: "PLANIFIE" });
  });

  test("Planifié → « Passer en chantier » ; Chantier → « Facturer » ; Facturé → « Encaisser » ; Encaissé → « Demander un avis »", () => {
    assert.deepEqual(gestePrincipal({ detail: dossier({ etape: "PLANIFIE" }), espace: null, tache: null, maintenant }), { genre: "ETAPE", libelle: "Passer en chantier", etape: "CHANTIER" });
    assert.deepEqual(gestePrincipal({ detail: dossier({ etape: "CHANTIER" }), espace: null, tache: null, maintenant }), { genre: "FACTURE", libelle: "Facturer" });
    assert.deepEqual(gestePrincipal({ detail: dossier({ etape: "FACTURE" }), espace: null, tache: null, maintenant }), { genre: "ENCAISSER", libelle: "Encaisser" });
    assert.deepEqual(gestePrincipal({ detail: dossier({ etape: "ENCAISSE" }), espace: null, tache: null, maintenant }), { genre: "AVIS", libelle: "Demander un avis" });
  });

  test("Perdu et En pause : « Reprendre » à l'étape quittée, à défaut en Qualification", () => {
    assert.deepEqual(gestePrincipal({ detail: dossier({ etape: "PERDU", etapeAvantSortie: "DEVIS_ENVOYE" }), espace: null, tache: null, maintenant }), { genre: "REPRISE", libelle: "Reprendre en « Devis envoyé »", etape: "DEVIS_ENVOYE" });
    assert.deepEqual(gestePrincipal({ detail: dossier({ etape: "EN_PAUSE" }), espace: null, tache: null, maintenant }), { genre: "REPRISE", libelle: "Reprendre en « Qualification »", etape: "QUALIFICATION" });
  });

  test("chaque étape a un geste et un libellé en phrase (ni code, ni capitales)", () => {
    for (const etape of ETAPES) {
      const g = gestePrincipal({ detail: dossier({ etape }), espace: null, tache: null, maintenant });
      assert.ok(g.libelle.length > 3 && g.libelle !== g.libelle.toUpperCase(), etape);
      assert.notEqual(g.genre, "TACHE");
    }
  });
});

describe("tachePrete : quelle tâche du dossier porte le bouton", () => {
  test("la première à faire ; un Plus tard dont l'heure est passée compte ; un Plus tard à venir non ; rien sinon", () => {
    assert.equal(tachePrete([tache({ id: "a" }), tache({ id: "b" })], maintenant)?.id, "a");
    assert.equal(tachePrete([tache({ id: "p", statut: "PLUS_TARD", plusTardJusqua: "2026-10-06T08:00:00.000Z" })], maintenant)?.id, "p");
    assert.equal(tachePrete([tache({ id: "p", statut: "PLUS_TARD", plusTardJusqua: "2026-10-07T08:00:00.000Z" })], maintenant), null);
    assert.equal(tachePrete([tache({ id: "f", statut: "FAITE" })], maintenant), null);
    assert.equal(tachePrete([], maintenant), null);
    assert.equal(tachePrete(undefined, maintenant), null);
  });
});

describe("autresGestes : le reste des passages, déposer un PDF, modifier la prochaine action, archiver en dernier", () => {
  test("Planifié : les passages sauf « Chantier » (déjà le bouton principal), suggérés d'abord ; perdu en phrase", () => {
    const d = dossier({ etape: "PLANIFIE" });
    const autres = autresGestes(d, gestePrincipal({ detail: d, espace: null, tache: null, maintenant }));
    const etapes = autres.filter((g) => g.genre === "ETAPE").map((g) => g.etape);
    assert.ok(!etapes.includes("CHANTIER"), "pas le passage du bouton principal");
    assert.deepEqual(etapes.slice(0, 2), ["PERDU", "EN_PAUSE"], "les suggérés d'abord");
    assert.equal(etapes.length, ETAPES.length - 2);
    assert.deepEqual(autres.slice(-3).map((g) => g.genre), ["DEPOSER_PDF", "PROCHAINE_ACTION", "ARCHIVER"]);
    assert.equal(autres.find((g) => g.etape === "PERDU")?.libelle, "Marquer perdu");
    assert.equal(autres.find((g) => g.etape === "SIGNE")?.libelle, "Passer en « Signé »");
  });

  test("Perdu : la reprise à l'étape quittée est le bouton principal, les autres reprises restent", () => {
    const d = dossier({ etape: "PERDU", etapeAvantSortie: "SIGNE" });
    const autres = autresGestes(d, gestePrincipal({ detail: d, espace: null, tache: null, maintenant }));
    const etapes = autres.filter((g) => g.genre === "ETAPE").map((g) => g.etape);
    assert.ok(!etapes.includes("SIGNE"));
    assert.equal(autres.find((g) => g.etape === "QUALIFICATION")?.libelle, "Reprendre en « Qualification »");
    assert.equal(libellePassage("EN_PAUSE", "PERDU"), "Marquer perdu");
    assert.equal(libellePassage("QUALIFICATION", "EN_PAUSE"), "Mettre en pause");
  });

  test("avec une tâche en bouton principal, tous les passages d'étape restent disponibles", () => {
    const d = dossier({ etape: "SIGNE" });
    const autres = autresGestes(d, gestePrincipal({ detail: d, espace: null, tache: tache(), maintenant }));
    assert.equal(autres.filter((g) => g.genre === "ETAPE").length, ETAPES.length - 1);
  });
});

describe("rubriques du panneau v2 : une seule ouverte par étape, les raccourcis ?rubrique= conservés", () => {
  test("la rubrique de l'étape", () => {
    assert.equal(rubriqueDeLEtape("QUALIFICATION"), "photos");
    assert.equal(rubriqueDeLEtape("SIMULATION"), "simulations");
    for (const e of ["DEVIS_ENVOYE", "RELANCE", "SIGNE"] as const) assert.equal(rubriqueDeLEtape(e), "devis", e);
    for (const e of ["PLANIFIE", "CHANTIER", "PERDU", "EN_PAUSE"] as const) assert.equal(rubriqueDeLEtape(e), "etapes", e);
    for (const e of ["FACTURE", "ENCAISSE"] as const) assert.equal(rubriqueDeLEtape(e), "paiements", e);
    for (const e of ETAPES) assert.ok(RUBRIQUES_V2.includes(rubriqueDeLEtape(e)), e);
  });

  test("chaque ?rubrique= de la v1 vise une rubrique v2 et une cible de défilement ; les titres sont des phrases", () => {
    for (const r of RUBRIQUES_DOSSIER) {
      assert.ok(RUBRIQUES_V2.includes(rubriqueDemandee(r)), r);
      assert.ok(cibleDuDefilement(r).every((id) => id.startsWith("rubrique-")), r);
    }
    assert.equal(rubriqueDemandee("messages"), "espace");
    assert.deepEqual(cibleDuDefilement("messages"), ["rubrique-messages", "rubrique-espace"]);
    assert.deepEqual(cibleDuDefilement("encaisser"), ["rubrique-paiements"]);
    for (const r of RUBRIQUES_V2) {
      const titre = TITRES_RUBRIQUES[r];
      assert.ok(titre.length > 3 && titre !== titre.toUpperCase(), r);
    }
    assert.equal(RUBRIQUES_V2.length, 13);
  });
});
