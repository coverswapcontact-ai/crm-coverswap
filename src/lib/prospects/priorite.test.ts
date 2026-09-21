import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { comparerPourRappel, departementDuCodePostal, lireDelai, lireDepartements, lireOccupation, lireTailleCuisine, qualifier } from "./priorite";

const ZONE = { departements: ["34"], proches: ["30", "11"] };
const r = (question: string, reponse: string) => ({ question, reponse });

describe("lecture du formulaire", () => {
  test("propriétaire ou locataire, que la réponse soit dans la question ou dans le choix", () => {
    assert.equal(lireOccupation([r("Êtes-vous propriétaire ?", "Oui")]), "PROPRIETAIRE");
    assert.equal(lireOccupation([r("Êtes-vous propriétaire ?", "Non")]), "LOCATAIRE");
    assert.equal(lireOccupation([r("Vous êtes", "Locataire")]), "LOCATAIRE");
    assert.equal(lireOccupation([r("etes_vous_proprietaire_ou_locataire_?", "Propriétaire")]), "PROPRIETAIRE");
    assert.equal(lireOccupation([r("Quelle pièce ?", "Cuisine")]), null);
  });

  test("délai : court jusqu'à trois mois, moyen jusqu'à six, lointain au-delà", () => {
    const delai = (reponse: string) => lireDelai([r("Quand souhaitez-vous réaliser les travaux ?", reponse)]).delai;
    assert.equal(delai("Dès que possible"), "COURT");
    assert.equal(delai("Dans les 3 mois"), "COURT");
    assert.equal(delai("Moins d'1 mois"), "COURT");
    assert.equal(delai("3 à 6 mois"), "MOYEN");
    assert.equal(delai("Plus de 6 mois"), "LOINTAIN");
    assert.equal(delai("Je me renseigne"), "LOINTAIN");
    assert.equal(delai("Je ne sais pas encore"), "INDETERMINE");
    assert.equal(lireDelai([r("Quelle pièce ?", "Cuisine")]).delai, "INDETERMINE");
  });

  test("taille de la cuisine gardée telle que répondue", () => {
    assert.equal(lireTailleCuisine([r("Quelle est la taille de votre cuisine ?", "Moyenne (5 à 10 façades)")]), "Moyenne (5 à 10 façades)");
    assert.equal(lireTailleCuisine([r("Êtes-vous propriétaire ?", "Oui")]), null);
  });

  test("départements", () => {
    assert.equal(departementDuCodePostal("34470"), "34");
    assert.equal(departementDuCodePostal("97110"), "971");
    assert.equal(departementDuCodePostal("Ablis"), null);
    assert.deepEqual(lireDepartements("34, 30 ; 11 / 2A"), ["34", "30", "11", "2A"]);
    assert.deepEqual(lireDepartements("aucun"), []);
  });
});

describe("les quatre classes de Lucas", () => {
  const formulaire = (occupation: string, delai: string) => [r("Êtes-vous propriétaire ou locataire ?", occupation), r("Quel est le délai de votre projet ?", delai)];

  test("prioritaire : propriétaire, délai court, dans la zone", () => {
    const q = qualifier({ codePostal: "34470", reponses: formulaire("Propriétaire", "Dès que possible") }, ZONE);
    assert.equal(q.priorite, "PRIORITAIRE");
    assert.match(q.motif, /propriétaire · délai court .* · dans la zone \(34\)/);
  });

  test("standard : propriétaire, délai indéterminé, dans la zone — le département voisin compte", () => {
    assert.equal(qualifier({ codePostal: "30000", reponses: formulaire("Propriétaire", "Je ne sais pas encore") }, ZONE).priorite, "STANDARD");
    assert.equal(qualifier({ codePostal: "34000", reponses: formulaire("Propriétaire", "3 à 6 mois") }, ZONE).priorite, "STANDARD");
    // A fait une simulation : Prioritaire d'office, même locataire ou sans délai — sauf hors zone.
    assert.equal(qualifier({ codePostal: "34000", reponses: formulaire("Locataire", "Dans un an"), simulation: true }, ZONE).priorite, "PRIORITAIRE");
    assert.match(qualifier({ codePostal: "34000", simulation: true }, ZONE).motif, /simulation/);
    assert.equal(qualifier({ codePostal: "59000", simulation: true }, ZONE).priorite, "A_ECARTER");
  });

  test("secondaire : locataire, ou délai lointain", () => {
    assert.equal(qualifier({ codePostal: "34000", reponses: formulaire("Locataire", "Dès que possible") }, ZONE).priorite, "SECONDAIRE");
    assert.equal(qualifier({ codePostal: "34000", reponses: formulaire("Propriétaire", "Plus de 6 mois") }, ZONE).priorite, "SECONDAIRE");
  });

  test("à écarter : hors zone, quoi que dise le formulaire", () => {
    const q = qualifier({ codePostal: "78660", reponses: formulaire("Propriétaire", "Dès que possible") }, ZONE);
    assert.equal(q.priorite, "A_ECARTER");
    assert.match(q.motif, /hors zone \(78\)/);
  });

  test("ce qu'on ne sait pas ne pénalise pas : sans code postal ni réponse, standard", () => {
    const q = qualifier({ codePostal: null, reponses: [] }, ZONE);
    assert.equal(q.priorite, "STANDARD");
    assert.equal(q.zone, "INCONNUE");
  });

  test("zone jamais saisie : personne n'est hors zone sur une règle absente", () => {
    const q = qualifier({ codePostal: "78660", reponses: [] }, { departements: [], proches: [] });
    assert.equal(q.zone, "INCONNUE");
    assert.equal(q.priorite, "STANDARD");
  });

  test("une demande de devis venue du site passe devant", () => {
    assert.equal(qualifier({ codePostal: "34970", reponses: [], devisDemande: true }, ZONE).priorite, "PRIORITAIRE");
    assert.equal(qualifier({ codePostal: "75001", reponses: [], devisDemande: true }, ZONE).priorite, "A_ECARTER");
  });
});

describe("ordre de rappel", () => {
  test("la classe d'abord, puis le plus récent ; un contact jamais classé passe avant les secondaires", () => {
    const lignes = [
      { id: "secondaire", priorite: "SECONDAIRE", recuLe: "2026-09-21T10:00:00Z" },
      { id: "ecarte", priorite: "A_ECARTER", recuLe: "2026-09-21T11:00:00Z" },
      { id: "prioritaire-ancien", priorite: "PRIORITAIRE", recuLe: "2026-09-20T08:00:00Z" },
      { id: "non-classe", priorite: null, recuLe: "2026-09-21T09:00:00Z" },
      { id: "prioritaire-recent", priorite: "PRIORITAIRE", recuLe: "2026-09-21T08:00:00Z" },
      { id: "standard", priorite: "STANDARD", recuLe: "2026-09-19T08:00:00Z" },
    ];
    assert.deepEqual(lignes.sort(comparerPourRappel).map((l) => l.id), ["prioritaire-recent", "prioritaire-ancien", "standard", "non-classe", "secondaire", "ecarte"]);
  });
});
