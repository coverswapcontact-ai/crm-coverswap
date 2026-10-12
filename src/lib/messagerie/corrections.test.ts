import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { preparerBaseEssai } from "@/test/base-essai";

preparerBaseEssai();
process.env.UPLOADS_DIR = mkdtempSync(path.join(tmpdir(), "coverswap-m25-corrections-"));
process.env.TACHES_DESACTIVEES = "1";
process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3001";
process.env.NEXTAUTH_SECRET = "secret-des-essais-de-la-messagerie";

/**
 * Mission 25, corrections du 12/10 (après la première file du jour) : un seul message par client, le plus avancé ;
 * le prénom seulement s'il est fiable ; « Appels à passer » sans dossiers perdus, sans vieux rappels (proposés « Sans
 * suite »), sans les clients qui ont déjà un message dans la file ; 8 propositions par jour au plus. Et la migration
 * qui remet les messages déjà préparés aux nouvelles règles. Noms et numéros fictifs (plage 06 39 98).
 */

let prisma: typeof import("@/lib/prisma").default;
let vues: typeof import("./vues");
let analyse: typeof import("./analyse");
let gestes: typeof import("./gestes");
let suivis: typeof import("./suivis");
let alertes: typeof import("./alertes");
let horaires: typeof import("./horaires");

const JOUR = 86_400_000;
let horloge: Date;

before(async () => {
  prisma = (await import("@/lib/prisma")).default;
  for (const cle of ["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID", "NTFY_TOPIC", "RESEND_API_KEY", "ANTHROPIC_API_KEY"]) process.env[cle] = "";
  await (await import("@/lib/base/preparation")).preparerBase();
  vues = await import("./vues");
  analyse = await import("./analyse");
  gestes = await import("./gestes");
  suivis = await import("./suivis");
  alertes = await import("./alertes");
  horaires = await import("./horaires");
  alertes.definirAlertesEssai(() => undefined);
  const parametres = await import("@/lib/parametres/service");
  suivis.oublierLancement();
  await parametres.enregistrerParametre({ cle: "MESSAGERIE_LANCEMENT", valeur: new Date(Date.now() - 60_000).toISOString(), valableDu: new Date("2026-01-01"), source: "essai" });
  // Un mardi ou un mercredi à 10 h après maintenant : l'horloge des essais (horaires de travail).
  let jour = horaires.momentParis(new Date(Date.now() + JOUR)).jour;
  while (![2, 3].includes(horaires.semaineDuJour(jour)) || horaires.estFerie(jour)) jour = horaires.jourSuivant(jour);
  horloge = horaires.instantParis(jour, 10 * 60);
});

after(async () => {
  alertes.definirAlertesEssai(null);
  await prisma.$disconnect();
});

const lead = (prenom: string, telephone: string, donnees: Record<string, unknown> = {}) => prisma.lead.create({ data: { prenom, nom: "Fiction", telephone, ville: "Lattes", source: "META_ADS", typeProjet: "CUISINE", ...donnees } });
const suiviDuLead = async (leadId: string) => (await suivis.suiviPour({ leadId }))!;
const toutAnnuler = () => prisma.messagePrepare.updateMany({ where: { statut: { in: ["PREVU", "A_ENVOYER", "A_VALIDER"] } }, data: { statut: "ANNULE", motif: "essai : on repart de zéro" } });

/** Un message préparé posé directement (comme ceux de la première file du jour). */
let numeroMessage = 0;
function messagePose(suiviId: string, code: string, cle: string, statut: string, texte: string, prevuLe: Date, telephone: string) {
  numeroMessage++;
  return prisma.messagePrepare.create({ data: { suiviId, code, cle, canal: "SMS", destinataire: telephone, texte, texteValide: texte, prevuLe, statut, douceur: statut === "A_VALIDER", raison: `essai ${numeroMessage}` } });
}

/** Un dossier ouvert avant la mise en service, devis en ligne depuis douze jours, jamais ouvert. */
async function dossierAvecVieuxDevis(prenom: string, telephone: string) {
  const dossier = await prisma.dossier.create({
    data: { clientNom: `${prenom} Fiction`, clientAdresse: "1 rue des Essais", clientCp: "34970", clientVille: "Lattes", clientTelephone: telephone, objet: "Recouvrement de cuisine", source: "ENTRANT", etape: "DEVIS_ENVOYE", createdAt: new Date(Date.now() - 30 * JOUR) },
  });
  const devis = await prisma.document.create({ data: { dossierId: dossier.id, type: "DEVIS", numero: `2026-98${String(numeroMessage++).padStart(2, "0")}`, dateEmission: new Date(Date.now() - 12 * JOUR), objet: "Cuisine", lignes: "[]", totalHt: 1800, acomptePct: 30, statut: "ENVOYE", visibleEspace: true } });
  await prisma.dossierEvenement.create({ data: { dossierId: dossier.id, type: "DEVIS_ENVOYE", direction: "INTERNE", contenu: "Devis mis en ligne", metadata: JSON.stringify({ documentId: devis.id }), createdAt: new Date(Date.now() - 12 * JOUR) } });
  return (await suivis.suiviPour({ dossierId: dossier.id }))!;
}

describe("Corrections du 12/10 — « Appels à passer » et « Sans suite »", () => {
  const ids: Record<string, string> = {};
  test("un vieux rappel devient « Sans suite », un dossier perdu n'est plus appelé, une carte par client", async () => {
    const vieux = await lead("Paul", "0639980101", { dernierAppelLe: new Date(horloge.getTime() - 10 * JOUR), rappelLe: new Date(horloge.getTime() - 10 * JOUR), statut: "CONTACTE" });
    const recent = await lead("Rose", "0639980102", { dernierAppelLe: new Date(horloge.getTime() - 3 * JOUR), rappelLe: new Date(horloge.getTime() - 2 * JOUR), statut: "CONTACTE" });
    const perdu = await prisma.dossier.create({
      data: { clientNom: "Lucie Fiction", clientAdresse: "2 rue des Essais", clientCp: "34970", clientVille: "Lattes", clientTelephone: "0639980103", objet: "Cuisine", source: "ENTRANT", etape: "PERDU", motifPerte: "PRIX", perteLe: new Date(), prochaineAction: "Rappeler", prochaineActionDate: new Date(horloge.getTime() - JOUR) },
    });
    const jumeauA = await lead("Noé", "0639980104");
    const jumeauB = await lead("Noé", "06 39 98 01 04");
    const proposition = await lead("Iris", "0639980105", { dernierAppelLe: new Date(horloge.getTime() - 3 * JOUR), rappelLe: new Date(horloge.getTime() - JOUR), statut: "CONTACTE" });
    for (const [nom, l] of Object.entries({ vieux, recent, jumeauA, jumeauB, proposition })) ids[nom] = (await suiviDuLead(l.id)).id;
    ids.perdu = (await suivis.suiviPour({ dossierId: perdu.id }))!.id;
    await messagePose(ids.proposition, "P2", `P2:suivi:${ids.proposition}`, "A_VALIDER", "Bonjour Iris, avez-vous pu prendre 2 ou 3 photos de votre cuisine ?", new Date(horloge.getTime() - 3_600_000), "+33639980105");

    const { cartes } = await vues.fileDuJour(horloge);
    const de = (id: string) => cartes.filter((c) => c.suiviId === id);
    assert.deepEqual(de(ids.vieux).map((c) => [c.genre, c.cle, c.classer]), [["PROPOSITION", `sans-suite:${ids.vieux}`, "SANS_SUITE"]], "rappel de plus de 7 jours : proposé « Sans suite »");
    assert.match(de(ids.vieux)[0].raison, /^Rappel prévu le .+, sans nouvelles depuis : le classer « Sans suite » \?$/);
    assert.deepEqual(de(ids.recent).map((c) => c.genre), ["APPEL"], "rappel d'avant-hier : à appeler");
    assert.deepEqual(de(ids.perdu), [], "dossier perdu : jamais dans les appels");
    assert.equal(cartes.filter((c) => c.telephone === "+33639980104").length, 1, "deux fiches, un numéro : une seule carte");
    assert.deepEqual(de(ids.proposition).map((c) => c.genre), ["PROPOSITION"], "un message à valider n'est pas aussi un appel");
    assert.equal(new Set(cartes.map((c) => c.suiviId)).size, cartes.length, "une carte par client");
  });

  test("« Classer sans suite » : le lead passe perdu (plus de réponse), la carte s'en va", async () => {
    const { POST } = await import("@/app/api/messagerie/conversations/[suiviId]/route");
    const { NextRequest } = await import("next/server");
    const reponse = await POST(new NextRequest(`http://localhost:3001/api/messagerie/conversations/${ids.vieux}`, { method: "POST", body: JSON.stringify({ action: "sans-suite" }), headers: { "content-type": "application/json" } }), { params: Promise.resolve({ suiviId: ids.vieux }) });
    assert.equal(reponse.status, 200);
    assert.deepEqual(await reponse.json(), { classe: "LEAD" });
    const suivi = await prisma.suivi.findUniqueOrThrow({ where: { id: ids.vieux } });
    const fiche = await prisma.lead.findUniqueOrThrow({ where: { id: suivi.leadId! } });
    assert.equal(fiche.statut, "PERDU");
    assert.equal(fiche.motifPerte, "SANS_REPONSE");
    assert.ok((await prisma.ligneJournalSuivi.findMany({ where: { suiviId: ids.vieux } })).some((l) => l.texte === "Contact classé sans suite (plus de réponse)"));
    assert.ok(!(await vues.fileDuJour(horloge)).cartes.some((c) => c.suiviId === ids.vieux));
    assert.deepEqual(await (await gestes.classerSansSuite(ids.vieux, horloge)), { classe: null }, "déjà classé : rien ne bouge");
  });
});

describe("Corrections du 12/10 — démarrage en douceur : 8 propositions par jour, une par client", () => {
  const douces: string[] = [];
  before(() => toutAnnuler());
  test("neuf vieux dossiers : D4 seul pour chacun (pas D2), 8 « À valider », le neuvième au jour ouvré suivant", async () => {
    for (let i = 0; i < 9; i++) {
      const suivi = await dossierAvecVieuxDevis(["Agathe", "Bruno", "Capucine", "Hugo", "Inès", "Jade", "Léon", "Maé", "Yves"][i], `06399801${10 + i}`);
      assert.equal(suivi.demarrageDoux, true);
      await analyse.analyserSuivi(suivi.id, new Date(horloge.getTime() + i * 60_000));
      douces.push(suivi.id);
    }
    const messages = await prisma.messagePrepare.findMany({ where: { suiviId: { in: douces } } });
    assert.deepEqual([...new Set(messages.map((m) => m.code))], ["D4"], "D2 et D4 voulus ensemble : D4, le plus avancé, seul");
    assert.equal(messages.length, 9);
    const aValider = messages.filter((m) => m.statut === "A_VALIDER");
    assert.equal(aValider.length, 8);
    assert.ok(aValider.every((m) => m.douceur && m.proposeLe));
    const neuvieme = messages.find((m) => m.statut === "PREVU")!;
    assert.equal(neuvieme.motif, "8 propositions par jour au plus");
    assert.ok(horaires.momentParis(neuvieme.prevuLe).jour > horaires.momentParis(horloge).jour, "pas aujourd'hui : un jour ouvré suivant");
    const { cartes, compteurs } = await vues.fileDuJour(new Date(horloge.getTime() + 10 * 60_000));
    assert.equal(compteurs.PROPOSITION, 8);
    assert.ok(cartes.filter((c) => c.genre === "PROPOSITION").every((c) => c.message?.code === "D4"));
  });

  test("le lendemain : le neuvième passe s'il reste de la place (une validée), jamais plus de 8 en attente", async () => {
    const premier = await prisma.messagePrepare.findFirstOrThrow({ where: { suiviId: douces[0], statut: "A_VALIDER" } });
    await gestes.validerProposition(premier.id, horloge);
    const lendemain = horaires.instantParis(horaires.jourSuivant(horaires.momentParis(horloge).jour), 11 * 60);
    await (await import("./moteur")).traiterEcheances(lendemain);
    assert.equal(await prisma.messagePrepare.count({ where: { suiviId: { in: douces }, statut: "A_VALIDER" } }), 8);
    assert.equal(await prisma.messagePrepare.count({ where: { suiviId: { in: douces }, statut: "PREVU" } }), 0);
  });

  test("le client écrit : sa relance repasse « prévue », sa réponse seule dans la file", async () => {
    const suiviId = douces[1];
    const d4 = await prisma.messagePrepare.findFirstOrThrow({ where: { suiviId, code: "D4" } });
    assert.equal(d4.statut, "A_VALIDER");
    const r = await gestes.rapporterReponse({ suiviId, texte: "Je regarde ce soir avec mon mari", recuLe: new Date(horloge.getTime() + 20 * 60_000) }, new Date(horloge.getTime() + 21 * 60_000));
    assert.ok(r.proposee, "une réponse proposée");
    const apres = await prisma.messagePrepare.findUniqueOrThrow({ where: { id: d4.id } });
    assert.equal(apres.statut, "PREVU");
    assert.ok(apres.prevuLe.getTime() > horloge.getTime() + 21 * 60_000, "la garde la fait attendre");
    const { cartes } = await vues.fileDuJour(new Date(horloge.getTime() + 22 * 60_000));
    assert.deepEqual(cartes.filter((c) => c.suiviId === suiviId).map((c) => c.genre), ["REPONSE"]);
  });
});

describe("Corrections du 12/10 — le prénom fiable, en vrai", () => {
  const a1 = async (leadId: string) => {
    const suivi = await suiviDuLead(leadId);
    await analyse.analyserSuivi(suivi.id, horloge);
    return (await prisma.messagePrepare.findFirstOrThrow({ where: { suiviId: suivi.id, code: "A1" } })).texte;
  };
  test("un surnom dans le champ prénom : « Bonjour, »", async () => {
    assert.match(await a1((await lead("Loulou", "0639980130")).id), /^Bonjour, Lucas de CoverSwap\./);
  });
  test("lead et fiche client aux noms différents : « Bonjour, »", async () => {
    const fiche = await prisma.client.create({ data: { nom: "Marie Exemple", prenom: "Marie", nomFamille: "Exemple", source: "AUTRE", premierContactLe: new Date() } });
    assert.match(await a1((await lead("Paul", "0639980131", { clientId: fiche.id })).id), /^Bonjour, Lucas de CoverSwap\./);
  });
  test("un vrai prénom, séparé du nom, les fiches d'accord : « Bonjour Paul, »", async () => {
    assert.match(await a1((await lead("Paul", "0639980132")).id), /^Bonjour Paul, Lucas de CoverSwap\./);
  });
});

describe("Corrections du 12/10 — la migration des messages déjà préparés", () => {
  test("doublons annulés (le plus avancé reste), salutations corrigées, 8 propositions, rejouable", async () => {
    await toutAnnuler();
    const { corrigerLesMessagesPrepares } = await import("@/lib/base/migrations/mission-25-corrections");
    const surnom = await suiviDuLead((await lead("Titi", "0639980140")).id);
    const t0 = new Date(horloge.getTime() - 2 * 3_600_000);
    const d2 = await messagePose(surnom.id, "D2", "D2:dv-essai", "A_VALIDER", "Bonjour Titi, avez-vous pu regarder votre devis ?", t0, "+33639980140");
    const d4 = await messagePose(surnom.id, "D4", "D4:dv-essai", "A_VALIDER", "Bonjour Titi, je reviens vers vous pour votre devis : une question ?", new Date(t0.getTime() + 60_000), "+33639980140");
    const autres: string[] = [];
    for (let i = 0; i < 9; i++) {
      const s = await suiviDuLead((await lead("Paul", `06399801${41 + i}`)).id);
      autres.push((await messagePose(s.id, "P2", `P2:suivi:${s.id}`, "A_VALIDER", "Bonjour Paul, avez-vous pu prendre 2 ou 3 photos de votre cuisine ?", new Date(t0.getTime() + (2 + i) * 60_000), `+336399801${41 + i}`)).id);
    }
    const premier = await corrigerLesMessagesPrepares(prisma, horloge);
    assert.deepEqual(premier, { remplaces: 1, salutations: 1, remisEnAttente: 2, propositions: 8 });
    const d2Apres = await prisma.messagePrepare.findUniqueOrThrow({ where: { id: d2.id } });
    assert.equal(d2Apres.statut, "ANNULE");
    assert.equal(d2Apres.motif, "remplacé par D4 : un seul message à la fois");
    const d4Apres = await prisma.messagePrepare.findUniqueOrThrow({ where: { id: d4.id } });
    assert.equal(d4Apres.texte, "Bonjour, je reviens vers vous pour votre devis : une question ?");
    assert.equal(d4Apres.statut, "A_VALIDER");
    assert.ok(d4Apres.proposeLe);
    const enAttente = await prisma.messagePrepare.findMany({ where: { id: { in: autres }, statut: "PREVU" } });
    assert.deepEqual(enAttente.map((m) => m.id).sort(), autres.slice(-2).sort(), "les deux derniers repassent « prévus »");
    assert.ok((await prisma.ligneJournalSuivi.findMany({ where: { suiviId: surnom.id } })).some((l) => l.texte === "D2 annulé : remplacé par D4 : un seul message à la fois"));
    assert.deepEqual(await corrigerLesMessagesPrepares(prisma, new Date(horloge.getTime() + 60_000)), { remplaces: 0, salutations: 0, remisEnAttente: 0, propositions: 8 }, "rejouée : rien ne bouge");
  });
});
