import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { CATALOGUE_MESSAGES, VARIABLES_MESSAGE, definitionMessage, lignesDuCatalogue } from "./catalogue";
import { controlerTexte, texteControle } from "./controleur";
import { garder } from "./garde";
import { estFerie, fenetreTravail, heurePermise, instantParis, joursFeries, momentParis, paques, quandRappelLisible, quandReponseLisible, veilleA18h } from "./horaires";
import { ligneClient, ligneSituation, ouEnEstParRegles } from "./ou-en-est";
import { planifier } from "./planificateur";
import { classerMessage, dateDite, lireNote, teintesDites } from "./regles";
import { lienSms, pieceDe, plateformeDe, prenomFiable, remplirTexte } from "./texte";
import { FAITS_VIDES, type EtatSuivi } from "./types";
import { zoneDe } from "./zone";

/**
 * Mission 25 — la messagerie, par ses règles pures : la liste validée, les horaires et les fériés, la zone, le prénom
 * fiable, le contrôleur, le classement des messages, la lecture des notes, la garde de silence, le planificateur et
 * « Où on en est ». Noms et numéros fictifs.
 */

const paris = (jour: string, heure: string) => instantParis(jour, Number(heure.slice(0, 2)) * 60 + Number(heure.slice(3, 5)));
const JOUR = 86_400_000;

function etatDeBase(modif: Partial<EtatSuivi> = {}): EtatSuivi {
  const lancement = paris("2026-10-10", "08:00");
  return {
    suiviId: "s1",
    lancement,
    cible: { leadId: "l1", dossierId: null, clientId: null },
    nom: "Camille Essai",
    prenom: "Camille",
    telephone: "+33639980018",
    mobile: true,
    email: null,
    stop: false,
    piece: pieceDe(["CUISINE"]),
    familles: ["CUISINE"],
    zone: "PROCHE",
    ville: "Lattes",
    lead: { id: "l1", creeLe: paris("2026-10-12", "10:00"), source: "META_ADS", statut: "NOUVEAU", tentatives: 0, dernierAppelLe: null, rappelLe: null, perteLe: null, motifPerte: null, archive: false, priorite: null },
    dossier: null,
    espace: null,
    photos: { nombre: 0, premiereLe: null, derniereLe: null },
    simulations: [],
    simulationsVuesLe: null,
    simulationFaiteSurLeSite: false,
    devis: [],
    accord: null,
    acompte: null,
    chantierFiniLe: null,
    avisLe: null,
    consentementCommercial: false,
    appels: [],
    tentativesSansReponse: 0,
    dernierGesteClientLe: null,
    messagesClient: [],
    attendReponse: false,
    rappel: null,
    pause: null,
    envois: [],
    premierSms: true,
    faits: { ...FAITS_VIDES },
    messages: [],
    demarrageDoux: false,
    validationForcee: false,
    ...modif,
  };
}

const dossier = (etape: string, modif: Partial<NonNullable<EtatSuivi["dossier"]>> = {}): NonNullable<EtatSuivi["dossier"]> => ({
  id: "d1",
  ouvertLe: paris("2026-10-12", "10:05"),
  etape,
  perteLe: null,
  motifPerte: null,
  dateChantier: null,
  heureChantier: null,
  archive: false,
  main: null,
  mainMotif: null,
  prochaineAction: null,
  prochaineActionDate: null,
  montantEstime: null,
  ...modif,
});

describe("Mission 25 — la liste validée", () => {
  test("41 messages : 32 du moteur (20 Auto, 12 Validation), « comme convenu », 8 réponses rapides", () => {
    const moteur = CATALOGUE_MESSAGES.filter((m) => m.groupe !== "RAPIDES" && m.code !== "CC");
    assert.equal(moteur.length, 32);
    assert.equal(moteur.filter((m) => m.mode === "AUTO").length, 20);
    assert.equal(moteur.filter((m) => m.mode === "VALIDATION").length, 12);
    assert.equal(CATALOGUE_MESSAGES.filter((m) => m.groupe === "RAPIDES").length, 8);
    assert.equal(CATALOGUE_MESSAGES.length, 41);
  });
  test("textes validés, mot pour mot (échantillon) ; seul A1 se présente ; variables connues seulement", () => {
    assert.equal(definitionMessage("A1").textes.defaut, "{bonjour} Lucas de CoverSwap. Merci pour votre demande ! Je vous appelle {quand_rappel}. Pour gagner du temps, envoyez-moi 2 ou 3 photos de votre {piece} en réponse à ce message.");
    assert.equal(definitionMessage("D3").textes.defaut, "{bonjour} avez-vous des questions sur le devis ? Je peux l'ajuster si besoin (teintes, surfaces…). Un appel de 5 minutes suffit souvent.");
    assert.equal(definitionMessage("C2").textes.defaut, "Petit rappel : j'arrive demain à {heure} pour votre chantier. Pensez simplement à ranger ce qui encombre. Pas besoin de vider les placards ni de faire le ménage, je m'occupe de tout. À demain !");
    assert.equal(definitionMessage("E2").textes.defaut, "Bien reçu, merci ! Je vous réponds {quand_reponse}.");
    for (const ligne of lignesDuCatalogue()) {
      if (ligne.code !== "A1") assert.ok(!/Lucas de CoverSwap/.test(ligne.texte), `${ligne.cle} se présente`);
      for (const v of ligne.texte.match(/\{(\w+)\}/g) ?? []) assert.ok((VARIABLES_MESSAGE as readonly string[]).includes(v.slice(1, -1)), `${ligne.cle} : ${v}`);
    }
  });
});

describe("Mission 25 — horaires et jours fériés", () => {
  test("Pâques et les fériés 2026, 2027", () => {
    assert.equal(paques(2026), "2026-04-05");
    assert.equal(paques(2027), "2027-03-28");
    assert.deepEqual(joursFeries(2026).filter((j) => j > "2026-04-01" && j < "2026-06-01"), ["2026-04-06", "2026-05-01", "2026-05-08", "2026-05-14", "2026-05-25"]);
    assert.ok(estFerie("2026-11-11") && estFerie("2026-12-25") && !estFerie("2026-10-12"));
  });
  test("fenêtres : semaine 9 h – 19 h 30, samedi 9 h 30 – 12 h 30, dimanche et férié fermés", () => {
    assert.deepEqual(fenetreTravail("2026-10-12"), { debut: 540, fin: 1170 });
    assert.deepEqual(fenetreTravail("2026-10-17"), { debut: 570, fin: 750 });
    assert.equal(fenetreTravail("2026-10-18"), null);
    assert.equal(fenetreTravail("2026-11-11"), null);
  });
  test("hors horaires : le jour permis suivant entre 9 h 30 et 10 h 30, étalé ; réponses de 8 h 30 à 21 h", () => {
    const dimanche = heurePermise(paris("2026-10-18", "15:00"), "TRAVAIL", "x");
    assert.equal(momentParis(dimanche).jour, "2026-10-19");
    assert.ok(momentParis(dimanche).minutes >= 570 && momentParis(dimanche).minutes < 630);
    const vendrediSoir = heurePermise(paris("2026-10-16", "20:00"), "TRAVAIL", "y");
    assert.equal(momentParis(vendrediSoir).jour, "2026-10-17");
    const samediApresMidi = heurePermise(paris("2026-10-17", "13:00"), "TRAVAIL", "z");
    assert.equal(momentParis(samediApresMidi).jour, "2026-10-19");
    const veilleFerie = heurePermise(paris("2026-11-10", "20:00"), "TRAVAIL", "z");
    assert.equal(momentParis(veilleFerie).jour, "2026-11-12", "le 11 novembre saute");
    assert.equal(heurePermise(paris("2026-10-13", "11:00"), "TRAVAIL").getTime(), paris("2026-10-13", "11:00").getTime());
    assert.equal(momentParis(heurePermise(paris("2026-10-18", "22:00"), "REACTIF")).minutes, 510, "réponse le lendemain 8 h 30");
    assert.equal(heurePermise(paris("2026-10-18", "20:00"), "REACTIF").getTime(), paris("2026-10-18", "20:00").getTime(), "dimanche 20 h : permis pour une réponse");
  });
  test("{quand_rappel} et {quand_reponse}", () => {
    assert.equal(quandRappelLisible(paris("2026-10-13", "10:00")), "dans la journée");
    assert.equal(quandRappelLisible(paris("2026-10-13", "18:00")), "demain matin");
    assert.equal(quandRappelLisible(paris("2026-10-17", "13:00")), "lundi matin");
    assert.equal(quandReponseLisible(paris("2026-10-17", "20:00")), "lundi matin");
    assert.equal(quandReponseLisible(paris("2026-10-13", "20:00")), "demain matin");
  });
  test("C2 : la veille à 18 h, un lundi : le samedi midi", () => {
    assert.equal(veilleA18h("2026-10-14").getTime(), paris("2026-10-13", "18:00").getTime());
    assert.equal(veilleA18h("2026-10-19").getTime(), paris("2026-10-17", "12:00").getTime());
  });
});

describe("Mission 25 — zone (25 km de Pérols)", () => {
  test("ville et code postal", () => {
    assert.equal(zoneDe("Pérols", "34470").zone, "PROCHE");
    assert.equal(zoneDe("Montpellier", null).zone, "PROCHE");
    assert.equal(zoneDe("st jean de vedas", null).zone, "PROCHE");
    assert.equal(zoneDe("Non renseignée", "34130").zone, "PROCHE", "tout le 34130 est proche");
    assert.equal(zoneDe("Sète", "34200").zone, "LOIN");
    assert.equal(zoneDe(null, "75011").zone, "LOIN");
    assert.equal(zoneDe(null, "34999").zone, "INCONNUE");
    assert.equal(zoneDe("Lunel", null).zone, "PROCHE");
  });
});

describe("Mission 25 — texte : prénom fiable, pièce, liens", () => {
  test("prénom fiable : un vrai prénom, sinon « Bonjour, »", () => {
    assert.equal(prenomFiable([{ prenom: "MARIE" }]), "Marie");
    assert.equal(prenomFiable([{ prenom: "jean-pierre" }]), "Jean-Pierre");
    assert.equal(prenomFiable([{ prenom: "Inconnu" }, { prenom: "Madame" }]), null);
    assert.equal(prenomFiable([{ prenom: "Marie Dupont" }]), null, "deux mots : prénom et nom mêlés");
    assert.equal(prenomFiable([{ prenom: "Durand", nom: "Durand" }]), null);
    assert.equal(prenomFiable([{ prenom: "J" }]), null);
    assert.equal(prenomFiable([{ prenom: null }, { prenom: "Léa" }]), "Léa");
  });
  test("pièce accordée, pièce inconnue", () => {
    const s2 = definitionMessage("S2").textes.defaut;
    assert.equal(remplirTexte(s2, { bonjour: "Bonjour,", lien: "https://x/e/a" }, pieceDe(["MEUBLES"])).texte, "Bonjour, votre simulation est prête ! Découvrez votre mobilier rénové ici : https://x/e/a Dites-moi ce que vous en pensez.");
    assert.ok(remplirTexte(definitionMessage("C3").textes.defaut, {}, pieceDe([], "PRO")).texte.includes("votre nouveau local"));
    assert.ok(remplirTexte(definitionMessage("A2").textes.defaut, { bonjour: "Bonjour," }, pieceDe([])).texte.includes("votre projet de rénovation"));
    const { manquantes } = remplirTexte(definitionMessage("C1").textes.defaut, { date_chantier: "mardi 20 octobre" }, pieceDe(["CUISINE"]));
    assert.deepEqual(manquantes, ["heure"]);
  });
  test("Ouvrir Messages : format iPhone et Android", () => {
    assert.equal(lienSms("+33639980018", "Bonjour, ça va ?", "IOS"), "sms:+33639980018&body=Bonjour%2C%20%C3%A7a%20va%20%3F");
    assert.equal(lienSms("+33639980018", "Ok", "ANDROID"), "sms:+33639980018?body=Ok");
    assert.equal(plateformeDe("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)"), "IOS");
    assert.equal(plateformeDe("Mozilla/5.0 (Linux; Android 14)"), "ANDROID");
  });
});

describe("Mission 25 — le contrôleur", () => {
  const contexte: import("./controleur").ContexteControle = { lienAttendu: null, premierContact: false, prenom: "Camille", permis: [] };
  test("un texte sage passe", () => {
    assert.deepEqual(controlerTexte("Bonjour Camille, merci pour votre retour ! Je regarde et je reviens vers vous très vite.", contexte), []);
  });
  test("chaque règle casse", () => {
    const regles = (t: string, c = contexte) => controlerTexte(t, c).map((e) => e.regle);
    assert.ok(regles("Bonjour, la pose coûte 1 200 € HT.").includes("MONTANT"));
    assert.ok(regles("Bonjour, je vous fais 10 % de remise.").includes("POURCENTAGE"));
    assert.ok(regles("Bonjour, c'est offert.").includes("MOT_INTERDIT"));
    assert.ok(regles("Bonjour, je passe mardi ?").includes("DATE"));
    assert.ok(regles("Bonjour, tu peux m'envoyer une photo ?").includes("TUTOIEMENT"));
    assert.ok(regles("Bonjour, notre assistant vous répond.").includes("IA"));
    assert.ok(regles("Bonjour, c'est Lucas de CoverSwap.").includes("PRESENTATION"));
    assert.ok(regles("Bonjour Marie, merci.").includes("PRENOM"));
    assert.ok(regles("Bonjour, une question ? Et une autre ?").includes("QUESTIONS"));
    assert.ok(regles("Voici : https://exemple.fr").includes("LIEN_ETRANGER"));
    assert.ok(regles("Merci.", { ...contexte, lienAttendu: "https://crm/e/abc" }).includes("LIEN_ABSENT"));
    assert.ok(regles("x".repeat(330)).includes("LONGUEUR"));
  });
  test("une valeur venue du CRM est permise ; un texte refusé laisse partir le texte validé", () => {
    assert.deepEqual(controlerTexte("Bonjour, je passe mardi 20 octobre comme prévu.", { ...contexte, permis: ["mardi 20 octobre"] }), []);
    const r = texteControle("Bonjour, c'est gratuit !", "Bien reçu, je regarde et je reviens vers vous très vite.", contexte);
    assert.equal(r.ia, false);
    assert.equal(r.texte, "Bien reçu, je regarde et je reviens vers vous très vite.");
    assert.ok(r.ecart?.includes("interdit"));
  });
});

describe("Mission 25 — classer un message du client, lire une note", () => {
  test("le tableau du cahier", () => {
    assert.equal(classerMessage("Merci !"), "MERCI");
    assert.equal(classerMessage("👍"), "MERCI");
    assert.equal(classerMessage("STOP"), "STOP");
    assert.equal(classerMessage("Je ne trouve plus le lien de mon espace"), "LIEN_PERDU");
    assert.equal(classerMessage("J'adore, vous pouvez passer ?"), "VISITE");
    assert.equal(classerMessage("Je suis dispo jeudi après-midi pour un appel"), "DISPONIBILITES");
    assert.equal(classerMessage("Ça coûte combien à peu près ?"), "PRIX");
    assert.equal(classerMessage("C'est trop cher pour nous"), "TROP_CHER");
    assert.equal(classerMessage("Ça se décolle déjà, je suis déçue"), "MECONTENTEMENT");
    assert.equal(classerMessage("Combien de temps ça tient ?"), "QUESTION_GENERALE");
    assert.equal(classerMessage("Je regarde ce soir avec mon mari"), "AUTRE");
    assert.equal(classerMessage("", { photos: 3 }), "PHOTOS");
  });
  test("dates dites : « dans 2 semaines » depuis le samedi 10/10 → le 24/10 à 10 h", () => {
    const samedi = paris("2026-10-10", "09:31");
    const date = dateDite("Elle signe dans 2 semaines", samedi)!;
    assert.equal(momentParis(date).jour, "2026-10-24");
    assert.equal(momentParis(date).minutes, 600);
    assert.equal(momentParis(dateDite("rappeler demain", samedi)!).jour, "2026-10-12", "dimanche sauté");
    assert.equal(momentParis(dateDite("le 24/10", samedi)!).jour, "2026-10-24");
    assert.equal(momentParis(dateDite("jeudi 14h", samedi)!).minutes, 840);
    assert.equal(dateDite("rien de daté", samedi), null);
  });
  test("la note de l'exemple : rappel au 24/10, « comme convenu », chêne clair, son mari", () => {
    const lecture = lireNote("Elle signe dans 2 semaines, veut du chêne clair, son mari valide.", paris("2026-10-10", "09:31"));
    assert.equal(momentParis(lecture.rappel!.le).jour, "2026-10-24");
    assert.equal(lecture.rappel!.motif, "COMME_CONVENU");
    assert.deepEqual(lecture.faits.teintesEvoquees, ["chêne clair"]);
    assert.equal(lecture.faits.decideur, "son mari");
    assert.deepEqual(teintesDites("plutôt noir mat ou béton"), ["noir mat", "béton"]);
    assert.equal(lireNote("Trouve ça cher, hésite", new Date()).sensible, true);
  });
});

describe("Mission 25 — le planificateur", () => {
  const apres = (etat: EtatSuivi, quand: Date) => planifier(etat, null, quand);
  test("nouveau lead Meta après la mise en service → A1 tout de suite ; un lead d'avant → rien", () => {
    const etat = etatDeBase();
    const plan = apres(etat, paris("2026-10-12", "10:00"));
    assert.deepEqual(plan.intentions.map((i) => i.code), ["A1"]);
    assert.equal(plan.intentions[0].cle, "A1:lead:l1");
    const ancien = etatDeBase({ lead: { ...etatDeBase().lead!, creeLe: paris("2026-10-01", "10:00") } });
    assert.deepEqual(apres(ancien, paris("2026-10-12", "10:00")).intentions, []);
  });
  test("appels sans réponse : A2 (2 min après), A4 (le lendemain de A2), A5 (deux jours après A4)", () => {
    const appel = (jour: string, h: string) => ({ le: paris(jour, h), issue: "PAS_DE_REPONSE", repondu: false });
    const etat = etatDeBase({ appels: [appel("2026-10-12", "11:00")] });
    const a2 = apres(etat, paris("2026-10-12", "11:01")).intentions.find((i) => i.code === "A2")!;
    assert.equal(a2.voulu.getTime(), paris("2026-10-12", "11:02").getTime());
    const etat2 = etatDeBase({ appels: [appel("2026-10-12", "11:00"), appel("2026-10-12", "16:00")], envois: [{ le: paris("2026-10-12", "11:05"), code: "A2", canal: "SMS", relance: false, etape: "CONTACT" }] });
    const voulu = apres(etat2, paris("2026-10-12", "16:01")).intentions.find((i) => i.code === "A4")!.voulu;
    assert.equal(momentParis(voulu).jour, "2026-10-13", "A4 pas avant le lendemain de A2");
  });
  test("le client répond après l'appel : plus de A2", () => {
    const etat = etatDeBase({ appels: [{ le: paris("2026-10-12", "11:00"), issue: "PAS_DE_REPONSE", repondu: false }], dernierGesteClientLe: paris("2026-10-12", "11:01") });
    assert.ok(!apres(etat, paris("2026-10-12", "11:03")).intentions.some((i) => i.code === "A2"));
  });
  test("devis : D1 tout de suite, D2 deux jours après s'il n'est pas ouvert, D3 sinon (quatre jours après l'ouverture)", () => {
    const devis = { id: "dv1", numero: "2026-047", totalHt: 2200, enLigneLe: paris("2026-10-12", "10:00"), premiereOuvertureLe: null, consultations: 0, consulteLe: null };
    const etat = etatDeBase({ lead: { ...etatDeBase().lead!, source: "AUTRE" }, dossier: dossier("DEVIS_ENVOYE"), devis: [devis], cible: { leadId: "l1", dossierId: "d1", clientId: null } });
    const plan = apres(etat, paris("2026-10-12", "10:01"));
    assert.deepEqual(plan.intentions.map((i) => i.code), ["D1"]);
    assert.equal(plan.aVenir?.code, "D2", "D2 à venir, préparé la veille de son heure");
    const plus2 = apres({ ...etat, envois: [{ le: paris("2026-10-12", "10:05"), code: "D1", canal: "SMS", relance: false, etape: null }] }, paris("2026-10-14", "10:06"));
    assert.ok(plus2.intentions.some((i) => i.code === "D2"));
    const ouvert = { ...etat, devis: [{ ...devis, consultations: 2, premiereOuvertureLe: paris("2026-10-13", "20:00") }] };
    const plan3 = apres(ouvert, paris("2026-10-17", "20:01"));
    assert.ok(plan3.intentions.some((i) => i.code === "D3"));
    assert.ok(!plan3.intentions.some((i) => i.code === "D2"));
  });
  test("un D2 préparé devient obsolète quand le devis est ouvert", () => {
    const devis = { id: "dv1", numero: "2026-047", totalHt: 2200, enLigneLe: paris("2026-10-12", "10:00"), premiereOuvertureLe: paris("2026-10-14", "08:00"), consultations: 1, consulteLe: paris("2026-10-14", "08:00") };
    const etat = etatDeBase({ dossier: dossier("DEVIS_ENVOYE"), devis: [devis], cible: { leadId: "l1", dossierId: "d1", clientId: null }, messages: [{ id: "m1", code: "D2", cle: "D2:dv1", statut: "PREVU", prevuLe: paris("2026-10-14", "10:00"), envoyeLe: null, createdAt: paris("2026-10-13", "10:00"), ouvertLe: null, nonConfirmeLe: null, reponse: false, douceur: false }] });
    const plan = apres(etat, paris("2026-10-14", "09:00"));
    assert.deepEqual(plan.annulations, [{ messageId: "m1", motif: "le devis a été ouvert" }]);
  });
  test("« comme convenu » préparé pour le jour du rappel ; dossier perdu « trop cher » : R1 à 60 jours", () => {
    const etat = etatDeBase({ pause: { jusquau: paris("2026-10-24", "10:00"), motif: "COMME_CONVENU" }, dossier: dossier("DEVIS_ENVOYE"), cible: { leadId: "l1", dossierId: "d1", clientId: null } });
    const plan = apres(etat, paris("2026-10-23", "10:00"));
    const cc = plan.intentions.find((i) => i.code === "CC")!;
    assert.equal(momentParis(cc.voulu).jour, "2026-10-24");
    const perdu = etatDeBase({ dossier: dossier("PERDU", { perteLe: paris("2026-08-01", "10:00"), motifPerte: "PRIX" }), cible: { leadId: "l1", dossierId: "d1", clientId: null } });
    assert.deepEqual(apres(perdu, paris("2026-09-30", "10:00")).intentions.map((i) => i.code), ["R1"]);
  });
});

describe("Mission 25 — la garde de silence", () => {
  const message = (code: string, prevuLe: Date) => ({ id: "m9", code, cle: `${code}:x`, canal: "SMS", prevuLe });
  test("STOP, horaires, réponse au client", () => {
    assert.equal(garder(etatDeBase({ stop: true }), message("A1", new Date()), new Date()).decision, "ANNULER");
    const dimanche = paris("2026-10-18", "15:00");
    assert.equal(garder(etatDeBase(), message("D2", dimanche), dimanche).decision, "REPORTER");
    assert.equal(garder(etatDeBase(), message("A1", dimanche), dimanche).decision, "ENVOYER", "A1 répond au client : tous les jours");
  });
  test("relances : client qui a écrit, appel de moins de 72 h, envoi de moins de 48 h, trois par étape, main à Lucas", () => {
    const mardi = paris("2026-10-13", "10:00");
    const base = etatDeBase({ dossier: dossier("DEVIS_ENVOYE"), cible: { leadId: "l1", dossierId: "d1", clientId: null } });
    const ecrit = garder({ ...base, dernierGesteClientLe: paris("2026-10-12", "16:02"), envois: [{ le: paris("2026-10-12", "15:20"), code: "D1", canal: "SMS", relance: false, etape: null }] }, message("D2", mardi), mardi);
    assert.equal(ecrit.decision, "REPORTER");
    assert.ok(ecrit.decision === "REPORTER" && ecrit.motif.includes("a répondu le 12/10"));
    const appel = garder({ ...base, appels: [{ le: paris("2026-10-12", "17:00"), issue: "A_RAPPELER", repondu: true }] }, message("D2", mardi), mardi);
    assert.ok(appel.decision === "REPORTER" && appel.motif.startsWith("appel le"));
    const recent = garder({ ...base, envois: [{ le: paris("2026-10-12", "15:00"), code: "D1", canal: "SMS", relance: false, etape: null }] }, message("D2", mardi), mardi);
    assert.ok(recent.decision === "REPORTER" && recent.motif.includes("48 h"));
    const trois = Array.from({ length: 3 }, (_, i) => ({ le: new Date(mardi.getTime() - (10 + i * 3) * JOUR), code: "D4", canal: "SMS" as const, relance: true, etape: "DEVIS" as const }));
    assert.equal(garder({ ...base, envois: trois }, message("D5", mardi), mardi).decision, "RETENIR");
    assert.ok(garder({ ...base, attendReponse: true }, message("D4", mardi), mardi).decision === "REPORTER");
    assert.equal(garder({ ...base, dossier: dossier("PERDU") }, message("D4", mardi), mardi).decision, "ANNULER");
  });
});

describe("Mission 25 — « Où on en est » par les règles", () => {
  test("un lead jamais appelé : « Lead du 12/10 (Meta), pas encore appelé. », jamais vide, 240 caractères au plus", () => {
    const etat = etatDeBase();
    assert.equal(ligneSituation(etat, paris("2026-10-12", "10:30")), "Lead du 12/10 (Meta), pas encore appelé.");
    assert.equal(ligneClient(etat), "Projet : cuisine, à Lattes (à 25 km ou moins).");
    const { ouEnEst } = ouEnEstParRegles(etat, { aVenir: null, proposition: null, aAppeler: null }, paris("2026-10-12", "10:30"));
    assert.ok(ouEnEst.situation && ouEnEst.client && ouEnEst.suite);
    assert.ok(ouEnEst.situation.length + ouEnEst.client.length + ouEnEst.suite.length <= 240);
  });
  test("le devis de l'exemple : montant, date, ouvertures ; le client : teinte, prix, décideur", () => {
    const etat = etatDeBase({
      dossier: dossier("DEVIS_ENVOYE"),
      devis: [{ id: "dv1", numero: "2026-047", totalHt: 2200, enLigneLe: paris("2026-09-30", "10:00"), premiereOuvertureLe: paris("2026-10-01", "10:00"), consultations: 2, consulteLe: paris("2026-10-02", "10:00") }],
      faits: { ...FAITS_VIDES, teintesFavorites: ["noir mat"], budget: "SENSIBLE", decideur: "son mari" },
    });
    assert.equal(ligneSituation(etat, paris("2026-10-10", "10:00")), "Devis 2 200 € HT en ligne le 30/09, ouvert 2 fois, sans réponse.");
    assert.equal(ligneClient(etat), "Veut du noir mat, trouve ça cher, décide avec son mari.");
  });
});
