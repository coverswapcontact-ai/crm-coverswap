import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { CODE_SMS_LIBRE, libelleMoisCourant, moisDuLivre, moyenDeRelance, phraseCheque, phraseFacture, phraseRetard, plageDuMois, propositionRelanceFacture, sommeMontants, texteRelanceFacture, troisNombres } from "./argent";

/**
 * Mission 22 (A4) — les règles pures d'Argent v2 : les trois nombres du mois (le rouge seulement s'il reste une
 * facture en retard), la plage du mois courant, les phrases de l'encours et des chèques, le texte du geste « Relancer »
 * (court, sans nom de client) et le moyen de relance.
 */
const maintenant = new Date("2026-10-07T10:00:00.000Z");

describe("les trois nombres", () => {
  test("à encaisser, encaissé ce mois, dépensé ce mois ; rouge seulement avec une facture en retard", () => {
    const sansRetard = troisNombres({ encours: { total: 4200, lignes: [{ joursRetard: 0 }, { joursRetard: null }] }, encaisseMois: 3100, depenseMois: 800 });
    assert.deepEqual(
      sansRetard.map((n) => [n.cle, n.libelle, n.montant, n.retard]),
      [
        ["A_ENCAISSER", "À encaisser", 4200, false],
        ["ENCAISSE_MOIS", "Encaissé ce mois", 3100, false],
        ["DEPENSE_MOIS", "Dépensé ce mois", 800, false],
      ]
    );
    const avecRetard = troisNombres({ encours: { total: 4200, lignes: [{ joursRetard: 12 }] }, encaisseMois: 0, depenseMois: 0 });
    assert.deepEqual(
      avecRetard.map((n) => n.retard),
      [true, false, false]
    );
  });

  test("la plage du mois courant (Paris), son libellé, la somme au centime", () => {
    assert.deepEqual(plageDuMois(maintenant), { du: "2026-10-01", au: "2026-10-07" });
    // Le 31 octobre à 23 h 30 UTC, c'est déjà le 1er novembre à Paris.
    assert.deepEqual(plageDuMois(new Date("2026-10-31T23:30:00.000Z")), { du: "2026-11-01", au: "2026-11-01" });
    assert.equal(libelleMoisCourant(maintenant), "octobre 2026");
    assert.equal(sommeMontants([{ montant: 0.1 }, { montant: 0.2 }]), 0.3);
    assert.equal(sommeMontants([]), 0);
  });
});

describe("l'encours et les chèques, en phrases", () => {
  test("« en retard de 12 jours » (rouge), « échéance inconnue », rien avant l'échéance", () => {
    assert.deepEqual(phraseRetard({ joursRetard: 12, tranche: "J30" }), { texte: "en retard de 12 jours", retard: true });
    assert.deepEqual(phraseRetard({ joursRetard: 1, tranche: "J30" }), { texte: "en retard de 1 jour", retard: true });
    assert.deepEqual(phraseRetard({ joursRetard: null, tranche: "INCONNUE" }), { texte: "échéance inconnue", retard: false });
    assert.equal(phraseRetard({ joursRetard: 0, tranche: "NON_ECHUE" }), null);
  });

  test("« émise il y a 3 jours · déjà réglé 200 € sur 1 200 € »", () => {
    assert.equal(phraseFacture({ emiseLe: "2026-10-04", regle: 200, montant: 1200 }, maintenant), "émise il y a 3 jours · déjà réglé 200,00 € sur 1 200,00 €");
    assert.equal(phraseFacture({ emiseLe: null, regle: 0, montant: 100 }, maintenant), "date d'émission inconnue");
  });

  test("« 450 € · Payeur · n° 123 · reçu hier », vieux au-delà de 15 jours", () => {
    assert.deepEqual(phraseCheque({ montant: 450, payeur: "Payeur A", reference: "123", recuLe: "2026-10-06", joursDepuisReception: 1 }, maintenant), { texte: "450,00 € · Payeur A · n° 123 · reçu hier", vieux: false });
    assert.equal(phraseCheque({ montant: 450, payeur: "Payeur A", reference: null, recuLe: "2026-09-10", joursDepuisReception: 27 }, maintenant).vieux, true);
  });

  test("les mois du livre, du plus récent au plus ancien, sans les mois vides ni les mois à venir", () => {
    const parMois = [100, 0, 300, 0, 0, 0, 0, 0, 0, 1000, 5000, 6000];
    assert.deepEqual(
      moisDuLivre(parMois, 2026, maintenant).map((m) => [m.mois, m.libelle, m.montant]),
      [
        [10, "Octobre", 1000],
        [3, "Mars", 300],
        [1, "Janvier", 100],
      ]
    );
    assert.equal(moisDuLivre(parMois, 2025, maintenant).length, 5);
  });
});

describe("« Relancer » une facture : le SMS prêt à copier", () => {
  test("un texte court, sans nom de client, avec le numéro et le reste dû ; un seul SMS", () => {
    const texte = texteRelanceFacture({ numero: "F-2026-041", reste: 1250.5 });
    assert.ok(texte.includes("F-2026-041"));
    assert.ok(texte.includes("1 250,50 €"));
    // Un seul SMS (160 caractères) avec un numéro de facture de la longueur habituelle.
    assert.ok(texte.length <= 160, `${texte.length} caractères`);
    assert.doesNotMatch(texte, /Bonjour [A-Z][a-z]+ /, "pas de prénom ni de nom dans le texte");
  });

  test("la proposition pour l'écran SMS : code libre, tracée sur le dossier, jamais sur un lead", () => {
    const proposition = propositionRelanceFacture({ numero: "F-1", reste: 100, client: "Client A", dossierId: "d1", telephone: "06 00 00 00 00" });
    assert.equal(proposition.code, CODE_SMS_LIBRE);
    assert.equal(CODE_SMS_LIBRE, "LIBRE");
    assert.equal(proposition.dossierId, "d1");
    assert.equal(proposition.leadId, null);
    assert.equal(proposition.telephone, "06 00 00 00 00");
    assert.equal(proposition.texte, texteRelanceFacture({ numero: "F-1", reste: 100 }));
    assert.equal(proposition.relance, undefined);
  });

  test("le moyen : SMS avec numéro et dossier, mail avec dossier seul, à la main hors CRM", () => {
    assert.equal(moyenDeRelance({ dossierId: "d1", telephone: "06" }), "SMS");
    assert.equal(moyenDeRelance({ dossierId: "d1", telephone: null }), "MAIL");
    assert.equal(moyenDeRelance({ dossierId: null, telephone: "06" }), "MAIN");
  });
});
