import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { LigneLead } from "@/lib/prospects/leads";
import { adresseDuSegment, ecartesDeLaFile, etatLead, fileDAppels, phraseDossiersClient, phraseResultat, segmentDeLaListe, vueDuSegment } from "./personnes";

/**
 * Mission 22 (A4) — les règles pures de Personnes v2 : les segments et leurs adresses (celles de la v1), l'état d'un
 * lead en une phrase, la ligne d'un client, la phrase d'un résultat de recherche, la file des appels à la suite.
 */
const maintenant = new Date("2026-10-07T10:00:00.000Z");

function lead(partiel: Partial<LigneLead>): LigneLead {
  return {
    id: "l1",
    nom: "Contact A",
    prenom: "",
    telephone: "06 00 00 00 00",
    telephoneLien: "tel:+33600000000",
    email: null,
    ville: "Ville",
    codePostal: null,
    source: "SITE_DEVIS",
    libelleSource: "Site : demande de devis",
    campagne: null,
    publicite: null,
    formulaire: null,
    projet: "Cuisine",
    recuLe: "2026-10-07T08:00:00.000Z",
    priorite: null,
    prioriteMotif: null,
    statut: "NOUVEAU",
    reponses: [],
    message: null,
    attendDepuis: null,
    appels: 0,
    dernierAppel: null,
    dernierAppelLe: null,
    dernierContactLe: null,
    tentatives: 0,
    rappelLe: null,
    enRetard: false,
    aAppeler: true,
    conversationId: null,
    smsNonLus: 0,
    photos: 0,
    simulation: false,
    dossierId: null,
    dossierMain: null,
    simulations: [],
    archiveLe: null,
    archiveMotif: null,
    doublon: null,
    notesAppel: [],
    ...partiel,
  };
}

describe("segments et adresses (les adresses de la v1 ne changent pas)", () => {
  test("?liste= → segment, et retour", () => {
    assert.equal(segmentDeLaListe("appeler"), "A_APPELER");
    assert.equal(segmentDeLaListe("rappeler"), "A_RAPPELER");
    assert.equal(segmentDeLaListe("sans-suite"), "SANS_SUITE");
    assert.equal(segmentDeLaListe("archives"), "ARCHIVES");
    assert.equal(segmentDeLaListe(undefined), "A_APPELER");
    assert.equal(segmentDeLaListe("autre", "CLIENTS"), "CLIENTS");
    assert.equal(segmentDeLaListe(["appeler"]), "A_APPELER");
  });

  test("l'adresse d'un segment : /clients, /leads?liste=…, avec ?q= s'il y a une recherche", () => {
    assert.equal(adresseDuSegment("CLIENTS"), "/clients");
    assert.equal(adresseDuSegment("A_APPELER"), "/leads?liste=appeler");
    assert.equal(adresseDuSegment("A_RAPPELER"), "/leads?liste=rappeler");
    assert.equal(adresseDuSegment("SANS_SUITE"), "/leads?liste=sans-suite");
    assert.equal(adresseDuSegment("ARCHIVES", " dupont "), "/leads?liste=archives&q=dupont");
    assert.equal(adresseDuSegment("CLIENTS", "06 12"), "/clients?q=06+12");
  });

  test("la vue de listerLeads : les quatre listes, rien pour les clients", () => {
    assert.equal(vueDuSegment("A_APPELER"), "A_APPELER");
    assert.equal(vueDuSegment("ARCHIVES"), "ARCHIVES");
    assert.equal(vueDuSegment("CLIENTS"), null);
  });
});

describe("l'état d'un lead en une phrase", () => {
  test("attend un appel, à rappeler (à venir ou dépassé), appelé, contacté, arrivé", () => {
    assert.equal(etatLead(lead({ attendDepuis: "2026-10-07T09:48:00.000Z" }), maintenant), "attend un appel depuis 12 min");
    assert.equal(etatLead(lead({ rappelLe: "2026-10-08T07:00:00.000Z" }), maintenant), "à rappeler demain 9 h");
    assert.equal(etatLead(lead({ rappelLe: "2026-10-06T16:00:00.000Z", enRetard: true }), maintenant), "à rappeler depuis hier 18 h");
    assert.equal(etatLead(lead({ dernierAppelLe: "2026-10-07T07:00:00.000Z" }), maintenant), "appelé il y a 3 h");
    assert.equal(etatLead(lead({ dernierContactLe: "2026-10-05T07:00:00.000Z" }), maintenant), "contacté lundi 9 h");
    assert.equal(etatLead(lead({}), maintenant), "arrivé il y a 2 h");
  });

  test("les compléments : tentatives sans réponse, a un dossier ; sans suite ; archivé", () => {
    assert.equal(etatLead(lead({ rappelLe: "2026-10-08T07:00:00.000Z", tentatives: 2, dossierId: "d1" }), maintenant), "à rappeler demain 9 h, 2 tentatives sans réponse, a un dossier");
    assert.equal(etatLead(lead({ statut: "PERDU" }), maintenant), "sans suite");
    assert.equal(etatLead(lead({ archiveLe: "2026-10-06T16:00:00.000Z", archiveMotif: "Hors zone" }), maintenant), "archivé hier 18 h, Hors zone");
    // Aucune capitale espacée, aucun sigle.
    assert.doesNotMatch(etatLead(lead({ tentatives: 1 }), maintenant), /[A-Z]{3,}/);
  });
});

describe("clients, résultats, file d'appels", () => {
  test("« 2 dossiers, 1 en cours »", () => {
    assert.equal(phraseDossiersClient(0, 0), "aucun dossier");
    assert.equal(phraseDossiersClient(1, 0), "1 dossier");
    assert.equal(phraseDossiersClient(2, 1), "2 dossiers, 1 en cours");
  });

  test("« Dossier · Ville · Devis envoyé »", () => {
    assert.equal(phraseResultat({ type: "DOSSIER", ville: "Ville", etat: "Devis envoyé" }), "Dossier — Ville, Devis envoyé");
    assert.equal(phraseResultat({ type: "LEAD", ville: null, etat: "À traiter" }), "Contact — À traiter");
    assert.equal(phraseResultat({ type: "CLIENT", ville: "", etat: "2 dossiers" }), "Client — 2 dossiers");
  });

  test("la file des appels : jamais appelés sans les « à écarter » (simulations d'abord) ; rappels en retard ; rien ailleurs", () => {
    const a = lead({ id: "a", aAppeler: true });
    const b = lead({ id: "b", aAppeler: true, simulation: true });
    const c = lead({ id: "c", aAppeler: true, priorite: "A_ECARTER" });
    const d = lead({ id: "d", aAppeler: false, enRetard: true });
    assert.deepEqual(fileDAppels("A_APPELER", [a, b, c, d]).map((l) => l.id), ["b", "a"]);
    assert.equal(ecartesDeLaFile("A_APPELER", [a, b, c, d]), 1);
    assert.deepEqual(fileDAppels("A_RAPPELER", [a, b, c, d]).map((l) => l.id), ["d"]);
    assert.deepEqual(fileDAppels("CLIENTS", [a, b, c, d]), []);
    assert.equal(ecartesDeLaFile("A_RAPPELER", [c]), 0);
  });
});
