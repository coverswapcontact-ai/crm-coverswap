import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { EspaceResume } from "@/lib/espace/suivi-types";
import { jourRelatif } from "./dates";
import { faitDeLaMain, ligneProchaineAction, ligneQuiQuoi, ligneSituation, phraseMain, pieceLisible, quandProchaineAction, signauxLisibles, situationDe, situationDeCandidat, type DossierPourSituation } from "./situation";

/** Mission 22 (A3) — les trois lignes de situation d'un dossier, en phrases (règle 5), et le jour relatif. */
const maintenant = new Date("2026-10-06T14:30:00.000Z"); // mardi 6 octobre 2026, 16 h 30 à Paris

const dossier = (p: Partial<DossierPourSituation> = {}): DossierPourSituation => ({
  clientNom: "Client Essai",
  clientVille: "Lattes",
  etape: "DEVIS_ENVOYE",
  prestations: { CUISINE: ["facades-hautes"], SDB: [] },
  main: "CLIENT",
  mainLe: "2026-10-02T07:00:00.000Z",
  mainMotif: "Devis envoyé : en attente de sa réponse",
  prochaineAction: "Relancer",
  prochaineActionDate: "2026-10-12T00:00:00.000Z",
  ...p,
});
const espace = (p: Partial<Pick<EspaceResume, "devis" | "accord" | "signaux">> = {}): Pick<EspaceResume, "devis" | "accord" | "signaux"> => ({ devis: null, accord: false, signaux: [], ...p });

describe("jourRelatif : un jour en phrase", () => {
  test("aujourd'hui, demain, hier, le jour de la semaine, il y a N jours, puis la date", () => {
    assert.equal(jourRelatif("2026-10-06T00:00:00.000Z", maintenant), "aujourd'hui");
    assert.equal(jourRelatif("2026-10-07T00:00:00.000Z", maintenant), "demain");
    assert.equal(jourRelatif("2026-10-05T00:00:00.000Z", maintenant), "hier");
    assert.equal(jourRelatif("2026-10-09T00:00:00.000Z", maintenant), "vendredi");
    assert.equal(jourRelatif("2026-10-12T00:00:00.000Z", maintenant), "lundi");
    assert.equal(jourRelatif("2026-10-13T00:00:00.000Z", maintenant), "le 13 oct.");
    assert.equal(jourRelatif("2026-10-03T00:00:00.000Z", maintenant), "il y a 3 jours");
    assert.equal(jourRelatif("2026-09-20T00:00:00.000Z", maintenant), "le 20 sept.");
    assert.equal(jourRelatif("2025-12-24T00:00:00.000Z", maintenant), "le 24 déc. 2025");
    assert.equal(jourRelatif("n'importe quoi", maintenant), "");
  });
});

describe("ligne 1 : qui / quoi", () => {
  test("le nom, la pièce en minuscules, la ville ; les morceaux vides sautent", () => {
    assert.equal(pieceLisible({ CUISINE: [], SDB: [] }), "cuisine, salle de bain");
    assert.equal(pieceLisible({}), "");
    assert.equal(ligneQuiQuoi(dossier()), "Client Essai, cuisine, salle de bain, Lattes");
    assert.equal(ligneQuiQuoi(dossier({ prestations: {}, clientVille: "" })), "Client Essai");
  });
});

describe("ligne 2 : où en est-on, depuis quand, pourquoi", () => {
  test("la main en phrase : à moi, chez le client, à relancer, perdu, terminé", () => {
    assert.equal(phraseMain(dossier({ etape: "QUALIFICATION", main: "MOI" }), maintenant), "À toi de jouer");
    assert.equal(phraseMain(dossier(), maintenant), "Chez le client");
    assert.equal(phraseMain(dossier({ prochaineActionDate: "2026-10-01T00:00:00.000Z" }), maintenant), "Chez le client, à relancer");
    assert.equal(phraseMain(dossier({ etape: "PERDU" }), maintenant), "Dossier perdu");
    assert.equal(phraseMain(dossier({ etape: "ENCAISSE" }), maintenant), "Dossier terminé");
  });

  test("le fait : le motif de la main en minuscule initiale ; rien quand ce n'est que l'étape", () => {
    assert.equal(faitDeLaMain("Devis envoyé : en attente de sa réponse"), "devis envoyé : en attente de sa réponse");
    assert.equal(faitDeLaMain("Étape « Signé »"), null);
    assert.equal(faitDeLaMain(""), null);
    assert.equal(faitDeLaMain(null), null);
  });

  test("ce que dit l'espace : le devis relu, puis les signaux actifs (jamais les gris, jamais HESITE en double)", () => {
    assert.deepEqual(signauxLisibles(null), []);
    assert.deepEqual(signauxLisibles(espace({ devis: { numero: "2026-041", consultations: 1 } })), []);
    assert.deepEqual(signauxLisibles(espace({ devis: { numero: "2026-041", consultations: 3 }, signaux: [{ code: "HESITE", libelle: "Devis relu 3 fois sans signer", ton: "rouge" }, { code: "NON_ENVOYE", libelle: "Lien pas encore envoyé", ton: "gris" }, { code: "DATE_A_FIXER", libelle: "Accord donné : date du chantier à fixer", ton: "rouge" }] })), ["devis 2026-041 relu 3 fois", "accord donné : date du chantier à fixer"]);
    assert.deepEqual(signauxLisibles(espace({ devis: { numero: "2026-041", consultations: 3 }, accord: true })), [], "signé : plus de « relu »");
  });

  test("la ligne entière", () => {
    assert.equal(ligneSituation(dossier(), espace({ devis: { numero: "2026-041", consultations: 2 } }), maintenant), "Chez le client depuis vendredi 9 h — devis envoyé : en attente de sa réponse, devis 2026-041 relu 2 fois");
    assert.equal(ligneSituation(dossier({ mainMotif: "Étape « Devis envoyé »" }), null, maintenant), "Chez le client depuis vendredi 9 h");
    assert.equal(ligneSituation(dossier({ mainLe: "2026-09-20T07:00:00.000Z", mainMotif: null }), null, maintenant), "Chez le client depuis 16 jours");
    assert.equal(ligneSituation(dossier({ etape: "PERDU", mainMotif: "Dossier perdu" }), null, maintenant), "Dossier perdu — dossier perdu");
    assert.equal(ligneSituation(dossier({ mainLe: null, mainMotif: null }), null, maintenant), "Chez le client");
  });
});

describe("ligne 3 : la prochaine action et sa date", () => {
  test("en retard, aujourd'hui, demain, lundi, le 20 oct. ; aucune", () => {
    assert.equal(quandProchaineAction(dossier({ prochaineActionDate: "2026-10-03T00:00:00.000Z" }), maintenant), "en retard de 3 jours");
    assert.equal(quandProchaineAction(dossier({ prochaineActionDate: "2026-10-05T00:00:00.000Z" }), maintenant), "en retard de 1 jour");
    assert.equal(quandProchaineAction(dossier({ prochaineActionDate: "2026-10-06T00:00:00.000Z" }), maintenant), "aujourd'hui");
    assert.equal(quandProchaineAction(dossier({ prochaineActionDate: "2026-10-07T00:00:00.000Z" }), maintenant), "demain");
    assert.equal(quandProchaineAction(dossier(), maintenant), "lundi");
    assert.equal(quandProchaineAction(dossier({ prochaineActionDate: "2026-10-20T00:00:00.000Z" }), maintenant), "le 20 oct.");
    assert.equal(quandProchaineAction(dossier({ prochaineActionDate: null }), maintenant), null);
    // Un dossier perdu ou encaissé n'est jamais « en retard ».
    assert.equal(quandProchaineAction(dossier({ etape: "ENCAISSE", prochaineActionDate: "2026-10-03T00:00:00.000Z" }), maintenant), "il y a 3 jours");
  });

  test("la ligne", () => {
    assert.equal(ligneProchaineAction(dossier(), maintenant), "Relancer — lundi");
    assert.equal(ligneProchaineAction(dossier({ prochaineAction: null }), maintenant), "Action à préciser — lundi");
    assert.equal(ligneProchaineAction(dossier({ prochaineActionDate: null }), maintenant), "Relancer");
    assert.equal(ligneProchaineAction(dossier({ prochaineAction: null, prochaineActionDate: null }), maintenant), "Aucune prochaine action");
  });

  test("situationDe : les trois lignes et l'étape en mots, sans sigle ni capitales espacées", () => {
    const s = situationDe(dossier(), espace(), maintenant);
    assert.deepEqual(s, { quiQuoi: "Client Essai, cuisine, salle de bain, Lattes", etape: "Devis envoyé", situation: "Chez le client depuis vendredi 9 h — devis envoyé : en attente de sa réponse", prochaineAction: "Relancer — lundi" });
    for (const ligne of Object.values(s)) assert.doesNotMatch(ligne, /MAIN|CLIENT ·|·|\b[A-Z]{3,}\b/);
  });
});

describe("situationDeCandidat : un résultat de recherche au même format (correctifs du 07/10)", () => {
  test("un dossier qui porte ses champs : les trois lignes, sans pièce ; un contact, un client, un dossier sans étape : null", () => {
    const maintenant = new Date("2026-10-07T10:00:00.000Z");
    const base = { nom: "Client Essai", ville: "Lattes", etape: "DEVIS_ENVOYE" as const, main: "CLIENT" as const, mainLe: "2026-10-02T07:00:00.000Z", mainMotif: "Devis envoyé : en attente de sa réponse", prochaineAction: "Relancer", prochaineActionDate: "2026-10-12T00:00:00.000Z" };
    assert.deepEqual(situationDeCandidat({ type: "DOSSIER", ...base }, maintenant), {
      quiQuoi: "Client Essai, Lattes",
      etape: "Devis envoyé",
      situation: "Chez le client depuis vendredi 9 h — devis envoyé : en attente de sa réponse",
      prochaineAction: "Relancer — lundi",
    });
    assert.equal(situationDeCandidat({ type: "LEAD", ...base }, maintenant), null);
    assert.equal(situationDeCandidat({ type: "CLIENT", ...base }, maintenant), null);
    assert.equal(situationDeCandidat({ type: "DOSSIER", nom: "Sans", ville: null }, maintenant), null);
    const sansRien = situationDeCandidat({ type: "DOSSIER", nom: "Client Essai", ville: null, etape: "QUALIFICATION" }, maintenant);
    assert.ok(sansRien);
    assert.equal(sansRien.quiQuoi, "Client Essai");
    assert.equal(sansRien.prochaineAction, "Aucune prochaine action");
    for (const ligne of Object.values(sansRien)) assert.doesNotMatch(ligne, /·/);
  });
});
