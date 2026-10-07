import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { DossierResume } from "@/lib/dossiers/types";
import { comparerCeQuiMattend, coteDe, couleurBarre, dansLeSegment, decouperLignes, demandePourGeste, gesteDeLaLigne, phrasePage, telephoneComposable, trierCeQuiMattend, vueDuSegment } from "./dossiers";

/**
 * Mission 22 (A4) — les règles pures de la liste Dossiers v2 : la segmentation Chez moi / Chez le client (la même
 * règle que `mainDe`), la barre de couleur, le tri « ce qui m'attend », le geste principal d'une ligne et la demande
 * d'ouverture du panneau qui l'exécute, cinq lignes puis « Voir les N autres », les pages en phrase.
 */
const maintenant = new Date("2026-10-07T10:00:00.000Z");

function dossier(partiel: Partial<DossierResume>): DossierResume {
  return {
    id: "d1",
    clientNom: "Client A",
    clientVille: "Ville",
    objet: "Cuisine",
    etape: "QUALIFICATION",
    source: "SITE",
    montantEstime: null,
    montantDernierDevis: null,
    prochaineAction: null,
    prochaineActionDate: null,
    etapeAvantSortie: null,
    aCompleter: 0,
    attenteClient: 0,
    main: null,
    mainLe: null,
    mainMotif: null,
    ouvertLe: "2026-10-01T10:00:00.000Z",
    createdAt: "2026-10-01T10:00:00.000Z",
    updatedAt: "2026-10-01T10:00:00.000Z",
    prestations: {},
    teintes: {},
    ...partiel,
  } as DossierResume;
}

describe("segments : Chez moi · Chez le client · Tous · Archives", () => {
  test("la vue serveur de chaque segment : « Chez moi » = le filtre « À faire »", () => {
    assert.equal(vueDuSegment("MOI"), "A_FAIRE");
    assert.equal(vueDuSegment("CLIENT"), "EN_COURS");
    assert.equal(vueDuSegment("TOUS"), "TOUS");
    assert.equal(vueDuSegment("ARCHIVES"), "EN_COURS");
  });

  test("de quel côté est le dossier : à moi (main ou client en retard), chez le client, plus personne", () => {
    assert.equal(coteDe(dossier({ etape: "QUALIFICATION" }), maintenant), "MOI");
    assert.equal(coteDe(dossier({ etape: "DEVIS_ENVOYE" }), maintenant), "CLIENT");
    assert.equal(coteDe(dossier({ etape: "DEVIS_ENVOYE", main: "MOI" }), maintenant), "MOI");
    // Le client a la main, mais la relance est dépassée : à moi de relancer.
    assert.equal(coteDe(dossier({ etape: "DEVIS_ENVOYE", prochaineActionDate: "2026-10-01T09:00:00.000Z" }), maintenant), "MOI");
    assert.equal(coteDe(dossier({ etape: "PERDU" }), maintenant), "AUCUNE");
    assert.equal(coteDe(dossier({ etape: "ENCAISSE" }), maintenant), "AUCUNE");
  });

  test("dans le segment : Chez moi et Chez le client s'excluent, Tous prend tout, Archives rien (le volet de la v1)", () => {
    const moi = dossier({ etape: "SIMULATION" });
    const client = dossier({ etape: "SIGNE" });
    assert.equal(dansLeSegment(moi, "MOI", maintenant), true);
    assert.equal(dansLeSegment(moi, "CLIENT", maintenant), false);
    assert.equal(dansLeSegment(client, "CLIENT", maintenant), true);
    assert.equal(dansLeSegment(client, "MOI", maintenant), false);
    assert.equal(dansLeSegment(client, "TOUS", maintenant), true);
    assert.equal(dansLeSegment(client, "ARCHIVES", maintenant), false);
  });

  test("la barre de couleur : vert chez moi, gris chez le client, rouge pour l'argent en retard et le perdu", () => {
    assert.equal(couleurBarre(dossier({ etape: "QUALIFICATION" }), maintenant), "MOI");
    assert.equal(couleurBarre(dossier({ etape: "DEVIS_ENVOYE" }), maintenant), "CLIENT");
    assert.equal(couleurBarre(dossier({ etape: "PERDU" }), maintenant), "ROUGE");
    assert.equal(couleurBarre(dossier({ etape: "FACTURE", prochaineActionDate: "2026-09-20T09:00:00.000Z" }), maintenant), "ROUGE");
    // Une facture pas encore échue : chez moi (c'est à moi d'encaisser), pas rouge.
    assert.equal(couleurBarre(dossier({ etape: "FACTURE", prochaineActionDate: "2026-10-20T09:00:00.000Z" }), maintenant), "MOI");
    assert.equal(couleurBarre(dossier({ etape: "ENCAISSE" }), maintenant), "CLIENT");
  });
});

describe("« ce qui m'attend » : le tri", () => {
  test("les retards en tête, puis par date, puis sans date par dernière activité, les terminés en dernier", () => {
    const retard = dossier({ id: "retard", etape: "RELANCE", prochaineActionDate: "2026-09-30T09:00:00.000Z" });
    const demain = dossier({ id: "demain", etape: "QUALIFICATION", prochaineActionDate: "2026-10-08T09:00:00.000Z" });
    const aujourdhui = dossier({ id: "aujourdhui", etape: "SIMULATION", prochaineActionDate: "2026-10-07T09:00:00.000Z" });
    const sansDateRecent = dossier({ id: "recent", etape: "QUALIFICATION", updatedAt: "2026-10-06T10:00:00.000Z" });
    const sansDateAncien = dossier({ id: "ancien", etape: "QUALIFICATION", updatedAt: "2026-09-01T10:00:00.000Z" });
    const perdu = dossier({ id: "perdu", etape: "PERDU", prochaineActionDate: "2026-09-01T09:00:00.000Z" });
    const tries = trierCeQuiMattend([perdu, sansDateAncien, demain, sansDateRecent, aujourdhui, retard], maintenant);
    assert.deepEqual(
      tries.map((d) => d.id),
      ["retard", "aujourdhui", "demain", "recent", "ancien", "perdu"]
    );
    assert.equal(comparerCeQuiMattend(maintenant)(retard, retard), 0);
  });
});

describe("le geste principal d'une ligne et la demande d'ouverture du panneau", () => {
  test("la règle du panneau, sans tâche : Appeler, Préparer la simulation dès une photo, Fixer la date, Passer en planifié", () => {
    assert.equal(gesteDeLaLigne(dossier({ etape: "QUALIFICATION" }), maintenant).libelle, "Appeler");
    assert.equal(gesteDeLaLigne(dossier({ etape: "QUALIFICATION", nbPhotos: 2 }), maintenant).genre, "SIMULATEUR");
    assert.equal(gesteDeLaLigne(dossier({ etape: "SIGNE" }), maintenant).genre, "DATE_CHANTIER");
    assert.equal(gesteDeLaLigne(dossier({ etape: "SIGNE", dateChantier: "2026-10-20T12:00:00.000Z" }), maintenant).libelle, "Passer en planifié");
    assert.equal(gesteDeLaLigne(dossier({ etape: "FACTURE" }), maintenant).genre, "ENCAISSER");
    assert.equal(gesteDeLaLigne(dossier({ etape: "EN_PAUSE", etapeAvantSortie: "DEVIS_ENVOYE" }), maintenant).libelle, "Reprendre en « Devis envoyé »");
  });

  test("la demande d'ouverture : devis, facture, encaissement, date, étape, relance, avis ; rien pour Appeler, Simulateur, Publier", () => {
    assert.deepEqual(demandePourGeste({ genre: "DEVIS", libelle: "Faire le devis" }), { rubrique: "devis", devis: "nouveau" });
    assert.deepEqual(demandePourGeste({ genre: "FACTURE", libelle: "Facturer" }), { rubrique: "devis", geste: "FACTURE" });
    assert.deepEqual(demandePourGeste({ genre: "ENCAISSER", libelle: "Encaisser" }), { rubrique: "encaisser", geste: "ENCAISSER" });
    assert.deepEqual(demandePourGeste({ genre: "DATE_CHANTIER", libelle: "Fixer la date du chantier" }), { rubrique: "etape", geste: "DATE_CHANTIER" });
    assert.deepEqual(demandePourGeste({ genre: "ETAPE", libelle: "Passer en chantier", etape: "CHANTIER" }), { rubrique: "etape", etape: "CHANTIER" });
    assert.deepEqual(demandePourGeste({ genre: "REPRISE", libelle: "Reprendre", etape: "SIMULATION" }), { rubrique: "etape", etape: "SIMULATION" });
    assert.deepEqual(demandePourGeste({ genre: "RELANCER", libelle: "Relancer" }), { rubrique: "devis", geste: "RELANCER" });
    assert.deepEqual(demandePourGeste({ genre: "AVIS", libelle: "Demander un avis" }), { rubrique: "encaisser", geste: "AVIS" });
    assert.equal(demandePourGeste({ genre: "APPEL", libelle: "Appeler" }), null);
    assert.equal(demandePourGeste({ genre: "SIMULATEUR", libelle: "Préparer la simulation" }), null);
    assert.equal(demandePourGeste({ genre: "PUBLIER", libelle: "Publier la simulation" }), null);
  });

  test("le numéro composable", () => {
    assert.deepEqual(telephoneComposable("06 12 34 56 78"), { lisible: "06 12 34 56 78", href: "tel:0612345678" });
    assert.equal(telephoneComposable(""), null);
    assert.equal(telephoneComposable(undefined), null);
    assert.equal(telephoneComposable("12"), null);
  });
});

describe("deux niveaux : cinq lignes puis « Voir les N autres », les pages en phrase", () => {
  test("decouperLignes", () => {
    const lignes = [1, 2, 3, 4, 5, 6, 7];
    assert.deepEqual(decouperLignes(lignes, false), { visibles: [1, 2, 3, 4, 5], reste: 2 });
    assert.deepEqual(decouperLignes(lignes, true), { visibles: lignes, reste: 0 });
    assert.deepEqual(decouperLignes([1, 2], false), { visibles: [1, 2], reste: 0 });
  });

  test("phrasePage", () => {
    assert.equal(phrasePage(1, 50, 40), "");
    assert.equal(phrasePage(2, 50, 180), "Page 2 sur 4, dossiers 51 à 100 sur 180");
    assert.equal(phrasePage(4, 50, 180), "Page 4 sur 4, dossiers 151 à 180 sur 180");
  });
});
