import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { codesEnPhrase, datesEnPhrase, heureEnPhrase, phraseV2, titreV2 } from "./phrases";

/**
 * Mission 22 (correctifs du 07/10, É12) — `phraseV2` relit une phrase de la v1 pour la v2 : dates relatives, codes en
 * libellés, heures en « 10 h 12 ». Instant de référence : mercredi 7 octobre 2026, 12 h à Paris (10 h UTC).
 */
const maintenant = new Date("2026-10-07T10:00:00.000Z");

describe("phraseV2 : des phrases, pas des codes", () => {
  test("une date du jour, d'hier, de la semaine, plus ancienne ; avec l'année ; « le » et « du » restent lisibles", () => {
    assert.equal(datesEnPhrase("reçu le 07/10", maintenant), "reçu aujourd'hui");
    assert.equal(datesEnPhrase("appelé le 06/10, sans rappel daté", maintenant), "appelé hier, sans rappel daté");
    assert.equal(datesEnPhrase("signé le 04/10/2026, acompte promis", maintenant), "signé il y a 3 jours, acompte promis");
    assert.equal(datesEnPhrase("3 photos reçues le 28/09", maintenant), "3 photos reçues le 28 sept.");
    assert.equal(datesEnPhrase("accord du 28/09", maintenant), "accord du 28 sept.");
  });

  test("une date avec son heure devient relative avec l'heure : « hier 14 h », « lundi 9 h 30 », « il y a 2 h »", () => {
    assert.equal(datesEnPhrase("rappel prévu le 06/10 à 14 h", maintenant), "rappel prévu hier 14 h");
    assert.equal(datesEnPhrase("« Question » · reçu le 05/10 à 9 h 30", maintenant), "« Question » · reçu lundi 9 h 30");
    assert.equal(datesEnPhrase("relu le 03/10 à 11 h", maintenant), "relu samedi 11 h");
    assert.equal(datesEnPhrase("reçu le 07/10 à 10:00", maintenant), "reçu il y a 2 h");
    assert.equal(datesEnPhrase("proposée le 08/10 à 9 h", maintenant), "proposée demain 9 h");
  });

  test("une date sans année à venir de plus de 60 jours est lue dans l'année d'avant (tâche de décembre relue en janvier)", () => {
    const janvier = new Date("2027-01-05T10:00:00.000Z");
    assert.equal(datesEnPhrase("arrivé le 28/12", janvier), "arrivé le 28 déc. 2026");
    assert.equal(datesEnPhrase("prévue le 20/01", janvier), "prévue le 20 janv.");
  });

  test("les codes en capitales prennent leur libellé ; les sigles d'usage et les codes inconnus restent", () => {
    assert.equal(codesEnPhrase("NOTE ajoutée"), "note ajoutée");
    assert.equal(codesEnPhrase("passé en DEVIS_ENVOYE"), "passé en devis envoyé");
    assert.equal(codesEnPhrase("raison ATTEND_CLIENT"), "raison j'attends le client");
    assert.equal(codesEnPhrase("SMS reçu, PDF joint, CRM à jour"), "SMS reçu, PDF joint, CRM à jour");
    assert.equal(codesEnPhrase("code INCONNU_ICI"), "code INCONNU_ICI");
    assert.equal(codesEnPhrase("Appeler Nom"), "Appeler Nom");
  });

  test("« 10:12 » s'écrit « 10 h 12 », « 10:00 » s'écrit « 10 h » ; une heure impossible reste", () => {
    assert.equal(heureEnPhrase("fait par le gérant à 10:12"), "fait par le gérant à 10 h 12");
    assert.equal(heureEnPhrase("à 09:00"), "à 9 h");
    assert.equal(heureEnPhrase("score 25:99"), "score 25:99");
  });

  test("phraseV2 enchaîne les trois et remplace le point médian par une virgule ; titreV2 par un tiret ; vide reste vide ; une phrase propre ne change pas", () => {
    assert.equal(phraseV2("« Re: Vos disponibilités » · sans réponse depuis le 22/09", maintenant), "« Re: Vos disponibilités », sans réponse depuis le 22 sept.");
    assert.equal(phraseV2("pas à faire : déjà fait hors CRM · à 10:12", maintenant), "pas à faire : déjà fait hors CRM, à 10 h 12");
    assert.equal(titreV2("Appeler · Nom Essai", maintenant), "Appeler — Nom Essai");
    assert.equal(titreV2("Valider · NOTE à relire", maintenant), "Valider — note à relire");
    assert.equal(titreV2("", maintenant), "");
    assert.equal(phraseV2("NOTE le 06/10 à 18:40", maintenant), "note hier 18 h 40");
    assert.equal(phraseV2(null, maintenant), "");
    assert.equal(phraseV2("", maintenant), "");
    assert.equal(phraseV2("Chez le client depuis vendredi 9 h — devis envoyé", maintenant), "Chez le client depuis vendredi 9 h — devis envoyé");
  });
});
