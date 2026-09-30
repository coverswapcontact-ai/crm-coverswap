import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { preparerBaseEssai } from "@/test/base-essai";

preparerBaseEssai();
process.env.UPLOADS_DIR = mkdtempSync(path.join(tmpdir(), "coverswap-a-faire-dl-"));

/**
 * Mission 17 (partie A) — détecteurs DOSSIERS et LEADS : chaque type de tâche vu dans la base, pas de doublon d'un
 * passage à l'autre, et la coche du CRM quand la condition tombe (devis visible, simulation publiée, date de chantier,
 * encaissement, SMS copié ou mail parti à un lead, lead archivé, prochaine action posée à la main, lot des anciens
 * leads). La règle du contact écrit (`Lead.dernierContactLe`) : un lead à qui on a écrit passe dans « À rappeler » sans
 * date. Instants fixes injectés ; noms fictifs.
 */

let prisma: typeof import("@/lib/prisma").default;
let avecActeur: typeof import("@/lib/journal/contexte").avecActeur;
let detection: typeof import("../detection");
let reponses: typeof import("../reponses");
let lecture: typeof import("../lecture");
let dossiers: typeof import("./dossiers");
let leadsDetecteur: typeof import("./leads");
let leads: typeof import("@/lib/prospects/leads");
let entrants: typeof import("@/lib/prospects/entrants");
let copie: typeof import("@/lib/sms/copie");
let envoi: typeof import("@/lib/mail/envoi");
let envoiCrm: typeof import("@/lib/mail/envoi-crm");
let modification: typeof import("@/lib/dossiers/dossiers");
let simulations: typeof import("@/lib/simulations/dossier");
let encaissements: typeof import("@/lib/encaissements/service");
let pilotage: typeof import("@/lib/commercial/pilotage");
let quand: typeof import("@/lib/commercial/quand");

const LUCAS = { acteur: "HUMAIN:lucas@coverswap.fr" };
/** Lundi 28/09/2026 et mardi 29/09/2026, 10 h à Paris (heure d'été). */
const LUNDI = new Date("2026-09-28T08:00:00.000Z");
const MARDI = new Date("2026-09-29T08:00:00.000Z");
const H = 3_600_000;
const J = 86_400_000;
const plus = (base: Date, ms: number) => new Date(base.getTime() + ms);
const fetchOriginal = globalThis.fetch;

let numero = 0;
const suivant = () => ++numero;

async function unLead(prenom: string, donnees: Record<string, unknown> = {}) {
  return prisma.lead.create({ data: { prenom, nom: "Essai", telephone: `+3361${String(200000 + suivant()).padStart(7, "0")}`, ville: "Lattes", source: "META_ADS", createdAt: plus(MARDI, -5 * J), ...donnees } });
}
async function unDossier(nom: string, donnees: Record<string, unknown> = {}) {
  return prisma.dossier.create({ data: { clientNom: nom, clientAdresse: "1 rue des Essais", clientCp: "34000", clientVille: "Montpellier", clientTelephone: `+3362${String(200000 + suivant()).padStart(7, "0")}`, objet: "Cuisine", source: "ENTRANT", ...donnees } });
}
async function unEspace(dossierId: string) {
  return prisma.espaceClient.create({ data: { code: `essai${suivant()}x${Date.now().toString(36)}`, dossierId, expireLe: plus(MARDI, 60 * J) } });
}
async function uneConversation(donnees: { leadId?: string; recuLe: Date }) {
  return prisma.conversationSms.create({ data: { numero: `+3363${String(200000 + suivant()).padStart(7, "0")}`, leadId: donnees.leadId ?? null, dernierSens: "ENTRANT", dernierMessageLe: donnees.recuLe, dernierExtrait: "Bonjour, vous pouvez me rappeler ?", nonLus: 1 } });
}

const passe = (maintenant: Date) => detection.passeComplete(maintenant, { detecteurs: [dossiers.detecteurDossiers, leadsDetecteur.detecteurLeads] });
const tache = (cle: string) => prisma.tacheAFaire.findUnique({ where: { cle } });
const tacheSure = (cle: string) => prisma.tacheAFaire.findUniqueOrThrow({ where: { cle } });
const raccourciDe = (t: { raccourci: string }) => JSON.parse(t.raccourci) as Record<string, unknown>;
const idsDeLaVue = async (vue: "A_APPELER" | "A_RAPPELER", maintenant: Date) => (await leads.listerLeads({ vue, limite: 500 }, maintenant)).lignes.map((l) => l.id);

before(async () => {
  process.env.NEXTAUTH_SECRET = "secret-de-session-pour-les-essais";
  process.env.SITE_URL = "https://coverswap.fr";
  process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3001";
  globalThis.fetch = (async (url: unknown) => {
    throw new Error(`Aucune requête réseau dans les essais (${String(url)})`);
  }) as typeof fetch;
  prisma = (await import("@/lib/prisma")).default;
  avecActeur = (await import("@/lib/journal/contexte")).avecActeur;
  detection = await import("../detection");
  reponses = await import("../reponses");
  lecture = await import("../lecture");
  dossiers = await import("./dossiers");
  leadsDetecteur = await import("./leads");
  leads = await import("@/lib/prospects/leads");
  entrants = await import("@/lib/prospects/entrants");
  copie = await import("@/lib/sms/copie");
  envoi = await import("@/lib/mail/envoi");
  envoiCrm = await import("@/lib/mail/envoi-crm");
  modification = await import("@/lib/dossiers/dossiers");
  simulations = await import("@/lib/simulations/dossier");
  encaissements = await import("@/lib/encaissements/service");
  pilotage = await import("@/lib/commercial/pilotage");
  quand = await import("@/lib/commercial/quand");
  await (await import("@/lib/base/preparation")).preparerBase();
});

after(async () => {
  globalThis.fetch = fetchOriginal;
  envoi.oublierEnvoyeurMailEssai();
  await prisma.$disconnect();
});

describe("détecteurs DOSSIERS et LEADS", () => {
  // Les contacts (sans dossier).
  let lNouveau: { id: string };
  let lDeuxJours: { id: string };
  let lEcarter: { id: string };
  let lRappel: { id: string };
  let lRappel14: { id: string };
  let lDecider: { id: string };
  let lSms: { id: string };
  let lVieux: { id: string };
  let lVieuxAppele: { id: string };
  let lVieuxRappel: { id: string };
  let lVieuxSms: { id: string };
  // Les dossiers.
  let dSms: { id: string; leadId: string | null };
  let dMotif: { id: string };
  let dRappel: { id: string };
  let dSigne: { id: string };
  let dSansAcompte: { id: string };
  let dPromis: { id: string };
  let dSolde: { id: string };
  let dSimulation: { id: string };
  let dDevis: { id: string };
  let dLien: { id: string };
  let dVigueur: { id: string };
  let dVigueurDemain: { id: string };

  before(async () => {
    lNouveau = await unLead("Nouveau", { createdAt: plus(MARDI, -3 * H) });
    lDeuxJours = await unLead("Deuxjours", { createdAt: plus(MARDI, -2 * J) });
    lEcarter = await unLead("Ecarter", { createdAt: plus(MARDI, -2 * J), priorite: "A_ECARTER", prioriteMotif: "Hors zone (Perpignan)" });
    lRappel = await unLead("Rappel", { dernierAppelLe: LUNDI, rappelLe: plus(MARDI, -H), tentatives: 2, statut: "CONTACTE" });
    lRappel14 = await unLead("Quatorze", { dernierAppelLe: LUNDI, rappelLe: quand.aHeureParis(MARDI, 0, 14), statut: "CONTACTE" });
    lDecider = await unLead("Decider", { dernierAppelLe: LUNDI, statut: "CONTACTE" });
    lSms = await unLead("Texto", { createdAt: plus(MARDI, -4 * J), dernierAppelLe: plus(MARDI, -3 * J) });
    await uneConversation({ leadId: lSms.id, recuLe: LUNDI });
    lVieux = await unLead("Vieux", { createdAt: plus(MARDI, -90 * J) });
    lVieuxAppele = await unLead("Vieuxappele", { createdAt: plus(MARDI, -120 * J), dernierAppelLe: plus(MARDI, -70 * J), statut: "CONTACTE" });
    lVieuxRappel = await unLead("Vieuxrappel", { createdAt: plus(MARDI, -100 * J), dernierAppelLe: plus(MARDI, -80 * J), rappelLe: plus(MARDI, 2 * J) });
    lVieuxSms = await unLead("Vieuxsms", { createdAt: plus(MARDI, -100 * J) });
    await uneConversation({ leadId: lVieuxSms.id, recuLe: LUNDI });

    const leadDuDossier = await unLead("Dossiersms", { statut: "CONTACTE" });
    dSms = await unDossier("Sms", { leadId: leadDuDossier.id });
    await uneConversation({ leadId: leadDuDossier.id, recuLe: LUNDI });
    dMotif = await unDossier("Motif", { etape: "DEVIS_ENVOYE", main: "MOI", mainMotif: "Répondre à Motif", mainLe: LUNDI });
    dRappel = await unDossier("Rappel", { prochaineAction: "Rappeler le client", prochaineActionDate: quand.aHeureParis(MARDI, 0, 14), prochaineActionInstant: quand.aHeureParis(MARDI, 0, 14) });

    dSigne = await unDossier("Signe", { etape: "SIGNE", main: "CLIENT" });
    const devisSigne = await prisma.document.create({ data: { dossierId: dSigne.id, type: "DEVIS", numero: "2026-801", dateEmission: plus(LUNDI, -J), objet: "Cuisine", lignes: "[]", totalHt: 4000, acomptePct: 30, statut: "ACCEPTE" } });
    await prisma.document.create({ data: { dossierId: dSigne.id, type: "DEVIS", numero: "2026-800", dateEmission: plus(LUNDI, -2 * J), objet: "Cuisine (variante annulée)", lignes: "[]", totalHt: 9000, acomptePct: 30, statut: "ANNULEE" } });
    await prisma.accordDevis.create({ data: { dossierId: dSigne.id, documentId: devisSigne.id, numeroDevis: "2026-801", totalHt: 4000, acomptePct: 30, nomSignataire: "Signe", mention: "Bon pour accord", createdAt: LUNDI } });

    const changement = (sansAcompte: string) => JSON.stringify({ de: "DEVIS_ENVOYE", vers: "SIGNE", nature: "SUIVANTE", sansAcompte });
    dSansAcompte = await unDossier("Sansacompte", { etape: "PLANIFIE", dateChantier: plus(MARDI, 10 * J) });
    await prisma.dossierEvenement.create({ data: { dossierId: dSansAcompte.id, type: "CHANGEMENT_ETAPE", direction: "INTERNE", contenu: "Signé", metadata: changement("Petit montant"), survenuLe: LUNDI } });
    dPromis = await unDossier("Promis", { etape: "CHANTIER", dateChantier: MARDI });
    await prisma.dossierEvenement.create({ data: { dossierId: dPromis.id, type: "CHANGEMENT_ETAPE", direction: "INTERNE", contenu: "Signé", metadata: changement("Acompte promis, pas encore reçu"), survenuLe: LUNDI } });

    dSolde = await unDossier("Solde", { etape: "FACTURE" });
    const facture = await prisma.document.create({ data: { dossierId: dSolde.id, type: "FACTURE", numero: "F2026-801", dateEmission: LUNDI, objet: "Cuisine", lignes: "[]", totalHt: 2000, statut: "GENERE" } });
    await prisma.numeroDocument.create({ data: { cle: "F:2026:801", numero: "F2026-801", famille: "F", annee: 2026, rang: 801, type: "FACTURE", origine: "CRM", documentId: facture.id, emisLe: LUNDI, montant: 2000 } });

    dSimulation = await unDossier("Simulation", { photos: JSON.stringify(["p1.jpg", "p2.jpg", "p3.jpg"]) });
    await prisma.dossierEvenement.create({ data: { dossierId: dSimulation.id, type: "ESPACE_PHOTOS", direction: "ENTRANT", contenu: "3 photos", survenuLe: LUNDI } });

    dDevis = await unDossier("Devis", { etape: "SIMULATION", montantEstime: 3500 });
    const espaceDevis = await unEspace(dDevis.id);
    await prisma.simulationEspace.create({ data: { espaceId: espaceDevis.id, dossierId: dDevis.id, chemin: "sim.jpg", statut: "PUBLIEE", publieeLe: plus(LUNDI, -J), choisieLe: LUNDI } });

    dLien = await unDossier("Lien", { createdAt: LUNDI });

    dVigueur = await unDossier("Vigueur", {
      photos: JSON.stringify(["v.jpg"]),
      prochaineAction: "attendre sa modification visuelle",
      prochaineActionManuelle: "attendre sa modification visuelle",
      prochaineActionManuelleLe: LUNDI,
      prochaineActionPar: LUCAS.acteur,
      prochaineActionDate: new Date("2026-09-29T12:00:00.000Z"),
    });
    dVigueurDemain = await unDossier("Vigueurdemain", {
      photos: JSON.stringify(["w.jpg"]),
      prochaineAction: "voir avec lui la teinte",
      prochaineActionManuelle: "voir avec lui la teinte",
      prochaineActionManuelleLe: LUNDI,
      prochaineActionDate: new Date("2026-09-30T12:00:00.000Z"),
    });
  });

  test("chaque type est vu : titre « verbe · Nom », raison courte, niveau, montant, raccourci, liens personnels", async () => {
    const bilan = await passe(MARDI);
    assert.deepEqual(
      bilan.sources.map((s) => [s.source, s.couverte]),
      [
        ["DOSSIERS", true],
        ["LEADS", true],
      ]
    );

    // Leads.
    const appeler = await tacheSure(`APPELER:lead:${lNouveau.id}`);
    assert.equal(appeler.titre, "Appeler · Nouveau Essai");
    assert.equal(appeler.niveau, 2, "arrivé il y a moins de 24 h");
    // Relecture : date absolue (heure de Paris), rien ne change d'un passage à l'autre.
    assert.match(appeler.raison, /^arrivé le \d\d\/\d\d à \d+ h( \d\d)? · \S/);
    assert.equal(appeler.source, "LEADS");
    assert.deepEqual([appeler.sujetType, appeler.sujetId, appeler.leadId], ["LEAD", lNouveau.id, lNouveau.id]);
    assert.equal(raccourciDe(appeler).genre, "APPEL");
    assert.match(String(raccourciDe(appeler).href), /^tel:\+33/);
    assert.equal((await tacheSure(`APPELER:lead:${lDeuxJours.id}`)).niveau, 3, "arrivé il y a plus de 24 h");

    const ecarter = await tacheSure(`ECARTER:lead:${lEcarter.id}`);
    assert.deepEqual([ecarter.titre, ecarter.niveau, ecarter.raison], ["Classer · Ecarter Essai (hors zone)", 5, "Hors zone (Perpignan)"]);
    assert.equal(await tache(`APPELER:lead:${lEcarter.id}`), null);

    const rappel = await tacheSure(`RAPPELER:lead:${lRappel.id}`);
    assert.deepEqual([rappel.titre, rappel.niveau, rappel.raison], ["Rappeler · Rappel Essai", 2, "2 appels sans réponse"]);
    assert.match((await tacheSure(`RAPPELER:lead:${lRappel14.id}`)).raison, /^rappel prévu le \d\d\/\d\d à 14 h$/);

    const decider = await tacheSure(`DECIDER:lead:${lDecider.id}`);
    assert.deepEqual([decider.titre, decider.niveau, decider.raison, raccourciDe(decider).genre], ["Décider · Decider Essai", 3, "appelé le 28/09, sans rappel daté", "LEAD"]);

    const repondreLead = await tacheSure(`REPONDRE:lead:${lSms.id}`);
    assert.deepEqual([repondreLead.titre, repondreLead.niveau, repondreLead.raison], ["Répondre · Texto Essai", 1, "SMS reçu le 28/09"]);
    assert.equal(await tache(`DECIDER:lead:${lSms.id}`), null, "un SMS à répondre passe devant");

    // Le lot des anciens leads (hors de la fenêtre de 60 jours du pilotage).
    const vieux = await tacheSure(`CLASSER_LEAD:lead:${lVieux.id}`);
    assert.deepEqual([vieux.titre, vieux.niveau, vieux.lot], ["Classer · Vieux Essai (ancien contact)", 5, "anciens-leads"]);
    assert.match(vieux.raison, /^arrivé le 01\/07\/2026, jamais appelé$/);
    assert.match((await tacheSure(`CLASSER_LEAD:lead:${lVieuxAppele.id}`)).raison, /dernier appel le 21\/07\/2026$/);
    assert.equal(await prisma.tacheAFaire.count({ where: { leadId: lVieuxRappel.id } }), 0, "un rappel daté à venir : rien aujourd'hui, pas de lot");
    assert.equal(await tache(`CLASSER_LEAD:lead:${lVieuxSms.id}`), null);
    assert.equal((await tacheSure(`REPONDRE:lead:${lVieuxSms.id}`)).niveau, 1, "un ancien qui vient d'écrire : à répondre");

    // Dossiers.
    const sms = await tacheSure(`REPONDRE:dossier:${dSms.id}`);
    assert.deepEqual([sms.titre, sms.niveau, sms.raison, sms.dossierId, sms.leadId], ["Répondre · Sms", 1, "SMS reçu le 28/09", dSms.id, dSms.leadId]);
    assert.deepEqual([raccourciDe(sms).genre, raccourciDe(sms).rubrique], ["DOSSIER", "messages"]);
    const motif = await tacheSure(`REPONDRE:dossier:${dMotif.id}`);
    assert.deepEqual([motif.titre, motif.raison, raccourciDe(motif).genre, raccourciDe(motif).rubrique], ["Répondre · Motif", "message sans réponse depuis le 28/09", "ESPACE", "messages"]);

    const rappelDossier = await tacheSure(`RAPPELER:dossier:${dRappel.id}`);
    assert.deepEqual([rappelDossier.titre, rappelDossier.niveau, rappelDossier.raison, raccourciDe(rappelDossier).genre, raccourciDe(rappelDossier).dossierId], ["Rappeler · Rappel", 2, "rappel prévu le 29/09 à 14 h", "APPEL", dRappel.id]);

    const date = await tacheSure(`DATE_CHANTIER:dossier:${dSigne.id}`);
    assert.deepEqual([date.titre, date.niveau, date.raison, date.montant, raccourciDe(date).genre], ["Fixer la date du chantier · Signe", 1, "accord du 28/09", 4000, "PLANIFIER"]);
    const acompte = await tacheSure(`ENCAISSER:dossier:${dSigne.id}`);
    assert.deepEqual([acompte.titre, acompte.niveau, acompte.montant, raccourciDe(acompte).genre, raccourciDe(acompte).rubrique], ["Encaisser l'acompte · Signe", 1, 1200, "ENCAISSER", "encaisser"]);
    assert.equal(await tache(`ENCAISSER:dossier:${dSansAcompte.id}`), null, "sans acompte motivé : rien à encaisser");
    const promis = await tacheSure(`ENCAISSER:dossier:${dPromis.id}`);
    assert.deepEqual([promis.titre, promis.raison], ["Encaisser l'acompte · Promis", "signé le 28/09, acompte promis"]);
    const solde = await tacheSure(`ENCAISSER:dossier:${dSolde.id}`);
    assert.equal(solde.titre, "Encaisser le solde · Solde");
    assert.equal(solde.montant, 2000);
    assert.match(solde.raison, /^reste 2\s000 € sur la facture F2026-801$/);

    const simulation = await tacheSure(`SIMULATION:dossier:${dSimulation.id}`);
    assert.deepEqual([simulation.titre, simulation.niveau, simulation.raison, raccourciDe(simulation).href], ["Préparer la simulation · Simulation", 3, "3 photos reçues le 28/09", `/simulateur?dossier=${dSimulation.id}`]);
    const devis = await tacheSure(`DEVIS:dossier:${dDevis.id}`);
    assert.deepEqual([devis.titre, devis.niveau, devis.raison, devis.montant, raccourciDe(devis).devis, raccourciDe(devis).href], ["Faire le devis · Devis", 3, "simulation choisie le 28/09", 3500, "nouveau", `/dossiers?dossier=${dDevis.id}&devis=nouveau`]);
    const lien = await tacheSure(`ENVOYER_LIEN:dossier:${dLien.id}`);
    assert.equal(lien.titre, "Envoyer le lien · Lien");
    assert.deepEqual(raccourciDe(lien).sms, { action: "ENVOYER_LIEN", dossierId: dLien.id });

    // Prochaine action posée à la main : la seule tâche du dossier, le jour de sa date.
    const action = await tacheSure(`PROCHAINE_ACTION:dossier:${dVigueur.id}`);
    assert.deepEqual([action.titre, action.niveau, action.raison], ["Attendre sa modification visuelle · Vigueur", 2, "prévue le 29/09"]);
    assert.deepEqual((await prisma.tacheAFaire.findMany({ where: { dossierId: dVigueur.id } })).map((t) => t.type), ["PROCHAINE_ACTION"]);
    assert.equal(await prisma.tacheAFaire.count({ where: { dossierId: dVigueurDemain.id } }), 0, "demain : rien aujourd'hui, et rien d'autre tant qu'elle est en vigueur");

    // Aucun titre ne porte de code ni d'identifiant.
    for (const t of await prisma.tacheAFaire.findMany({ where: { source: { in: ["DOSSIERS", "LEADS"] } } })) {
      assert.match(t.titre, / · /, t.titre);
      assert.doesNotMatch(t.titre, /c[a-z0-9]{20,}|dossier:|lead:/, t.titre);
    }
  });

  test("deux passages de suite : aucun doublon, rien de coché", async () => {
    const avant = await prisma.tacheAFaire.count();
    const second = await passe(MARDI);
    assert.equal(second.reconciliation.crees, 0);
    assert.equal(second.reconciliation.cochees, 0);
    assert.equal(await prisma.tacheAFaire.count(), avant);
    const cles = (await prisma.tacheAFaire.findMany({ select: { cle: true } })).map((t) => t.cle);
    assert.equal(new Set(cles).size, cles.length);
  });

  test("devis visible → « Faire le devis » coché par le CRM, avec son numéro", async () => {
    await prisma.document.create({ data: { dossierId: dDevis.id, type: "DEVIS", numero: "2026-802", dateEmission: MARDI, objet: "Cuisine", lignes: "[]", totalHt: 3600, acomptePct: 30, statut: "ENVOYE", origine: "REPRISE" } });
    // Ce que le dépôt fait aussi (documents-existants.ts) : l'étape avance et la main passe au client.
    await prisma.dossier.update({ where: { id: dDevis.id }, data: { etape: "DEVIS_ENVOYE", main: "CLIENT" } });
    await passe(plus(MARDI, H));
    const devis = await tacheSure(`DEVIS:dossier:${dDevis.id}`);
    assert.deepEqual([devis.statut, devis.reponduPar, devis.reponseTexte], ["FAITE", "SYSTEME:taches-a-faire", "coché par le CRM : devis 2026-802 déposé"]);
  });

  test("simulation publiée → « Préparer la simulation » coché", async () => {
    const espace = await unEspace(dSimulation.id);
    const brouillon = await prisma.simulationEspace.create({ data: { espaceId: espace.id, dossierId: dSimulation.id, chemin: "rendu.jpg", statut: "BROUILLON" } });
    await avecActeur(LUCAS, () => simulations.publierSimulations(dSimulation.id, [brouillon.id], { prevenir: false }));
    await passe(plus(MARDI, H));
    const simulation = await tacheSure(`SIMULATION:dossier:${dSimulation.id}`);
    assert.equal(simulation.statut, "FAITE");
    assert.match(simulation.reponseTexte ?? "", /^coché par le CRM : simulation publiée le \d\d\/\d\d$/);
  });

  test("date de chantier posée → « Fixer la date » coché ; encaissement saisi → « Encaisser l'acompte » coché", async () => {
    await avecActeur(LUCAS, () => modification.modifierDossier(dSigne.id, { dateChantier: "2026-10-12" }));
    await passe(plus(MARDI, 2 * H));
    const date = await tacheSure(`DATE_CHANTIER:dossier:${dSigne.id}`);
    assert.deepEqual([date.statut, date.reponseTexte], ["FAITE", "coché par le CRM : date posée au 12/10"]);
    assert.equal((await tacheSure(`ENCAISSER:dossier:${dSigne.id}`)).statut, "A_FAIRE", "l'acompte attend toujours");

    await avecActeur(LUCAS, () => encaissements.enregistrerEncaissement({ dossierId: dSigne.id, paiement: { montant: 1200, moyen: "VIREMENT", recuLe: "2026-09-29", reference: null } }));
    await passe(plus(MARDI, 3 * H));
    const acompte = await tacheSure(`ENCAISSER:dossier:${dSigne.id}`);
    assert.equal(acompte.statut, "FAITE");
    assert.match(acompte.reponseTexte ?? "", /^coché par le CRM : encaissement de 1\s200 € saisi$/);
  });

  test("SMS copié à un lead jamais appelé : il passe dans « À rappeler » sans date, « Appeler » est coché (« SMS copié le jj/mm »)", async () => {
    const instant = plus(MARDI, 4 * H);
    assert.ok((await idsDeLaVue("A_APPELER", instant)).includes(lNouveau.id));
    await avecActeur(LUCAS, () => copie.noterSmsCopie({ code: "LIBRE", texte: "Bonjour, ici Lucas de CoverSwap : je vous rappelle demain.", leadId: lNouveau.id, origine: "ECRAN" }, instant));
    const lead = await prisma.lead.findUniqueOrThrow({ where: { id: lNouveau.id } });
    assert.deepEqual([lead.dernierContactLe?.getTime(), lead.dernierAppelLe, lead.rappelLe], [instant.getTime(), null, null]);
    assert.equal((await idsDeLaVue("A_APPELER", instant)).includes(lNouveau.id), false);
    const ligne = (await leads.listerLeads({ vue: "A_RAPPELER", limite: 500 }, instant)).lignes.find((l) => l.id === lNouveau.id);
    assert.ok(ligne, "dans « À rappeler »");
    assert.deepEqual([ligne.rappelLe, ligne.aAppeler, ligne.dernierContactLe], [null, false, instant.toISOString()]);
    // Le pilotage suit la même règle : plus « Appeler : nouveau contact », mais « Contacté, sans rappel daté ».
    const affaire = (await pilotage.pilotageCommercial(instant)).affaires.find((a) => a.leadId === lNouveau.id);
    assert.equal(affaire?.groupe, "DECIDER");
    assert.match(affaire?.action ?? "", /^Contacté, sans rappel daté/);
    // L'outil de Claude le dit aussi : pas d'appel, mais un contact écrit.
    const { outilLeadsARappeler } = await import("@/lib/assistant/outils/lecture");
    const outil = await outilLeadsARappeler.executer({ limite: 50 }, { sessionId: "essai", commande: null, utilisateur: "essai@local", maintenant: instant });
    assert.match(outil.texte, /- Nouveau Essai .*rappel sans date, aucun appel noté, contacté par écrit le mar\. 29 sept\. 14:00/);

    await passe(plus(instant, H));
    const appeler = await tacheSure(`APPELER:lead:${lNouveau.id}`);
    assert.deepEqual([appeler.statut, appeler.reponduPar], ["FAITE", "SYSTEME:taches-a-faire"]);
    assert.match(appeler.reponseTexte ?? "", /^coché par le CRM : SMS copié le \d\d\/\d\d$/);
    assert.equal((await tacheSure(`DECIDER:lead:${lNouveau.id}`)).raison, "contacté par écrit le 29/09, sans rappel daté");
  });

  test("mail parti à un lead jamais appelé : même règle, « Appeler » coché (« mail parti le jj/mm »)", async () => {
    const instant = plus(MARDI, 6 * H);
    envoi.definirEnvoyeurMailEssai({ nom: "essai", envoyer: async () => ({ identifiant: `gmail-essai-${suivant()}`, fil: `fil-essai-${suivant()}`, compte: "coverswap.contact@gmail.com" }) });
    const { id } = await envoiCrm.programmerEnvoi({ cle: `essai-a-faire-${suivant()}`, nature: "NOUVEAU", a: "deuxjours@exemple.test", objet: "Votre projet de cuisine", texte: "Bonjour, je vous propose un rendez-vous.", leadId: lDeuxJours.id });
    assert.equal((await envoiCrm.executerEnvoi(id)).envoye, true);
    const lead = await prisma.lead.findUniqueOrThrow({ where: { id: lDeuxJours.id } });
    assert.ok(lead.dernierContactLe, "le contact écrit est retenu");
    assert.equal(lead.rappelLe, null);
    assert.equal((await idsDeLaVue("A_APPELER", instant)).includes(lDeuxJours.id), false);
    assert.ok((await idsDeLaVue("A_RAPPELER", instant)).includes(lDeuxJours.id));

    await passe(instant);
    const appeler = await tacheSure(`APPELER:lead:${lDeuxJours.id}`);
    assert.equal(appeler.statut, "FAITE");
    assert.match(appeler.reponseTexte ?? "", /^coché par le CRM : mail parti le \d\d\/\d\d$/);
  });

  test("un contact écrit ne recule jamais : une trace plus ancienne ne remplace pas la date", async () => {
    const { retenirContactEcrit } = await import("@/lib/prospects/contact-ecrit");
    const avant = (await prisma.lead.findUniqueOrThrow({ where: { id: lNouveau.id } })).dernierContactLe!;
    assert.equal(await retenirContactEcrit(lNouveau.id, plus(avant, -J)), false);
    assert.equal((await prisma.lead.findUniqueOrThrow({ where: { id: lNouveau.id } })).dernierContactLe?.getTime(), avant.getTime());
    assert.equal(await retenirContactEcrit(null, MARDI), false);
    // « Noter un échange » : un SMS ou un mail compte, une note non.
    const note = await unLead("Echange", { createdAt: plus(MARDI, -J) });
    await avecActeur(LUCAS, () => entrants.ajouterEchange(note.id, { type: "NOTE", contenu: "Vu sur le salon" }));
    assert.equal((await prisma.lead.findUniqueOrThrow({ where: { id: note.id } })).dernierContactLe, null);
    await avecActeur(LUCAS, () => entrants.ajouterEchange(note.id, { type: "EMAIL", contenu: "Mail envoyé depuis mon téléphone" }));
    assert.ok((await prisma.lead.findUniqueOrThrow({ where: { id: note.id } })).dernierContactLe);
    assert.equal((await idsDeLaVue("A_APPELER", plus(MARDI, 6 * H))).includes(note.id), false);
  });

  test("lead du simulateur : un SMS copié (sur son dossier) le fait sortir d'« À appeler », comme un SMS déjà tracé sur le dossier", async () => {
    const instant = plus(MARDI, 7 * H);
    const simule = await unLead("Simule", { source: "SITE_SIMULATEUR", createdAt: plus(MARDI, -J) });
    const dossierSimule = await unDossier("Simule", { leadId: simule.id });
    const ancien = await unLead("Simuleancien", { source: "SITE_SIMULATEUR", createdAt: plus(MARDI, -J) });
    const dossierAncien = await unDossier("Simuleancien", { leadId: ancien.id });
    const aAppeler = await idsDeLaVue("A_APPELER", instant);
    assert.ok(aAppeler.includes(simule.id) && aAppeler.includes(ancien.id), "jamais appelés : dans « À appeler » malgré leur dossier");

    await avecActeur(LUCAS, () => copie.noterSmsCopie({ code: "LIBRE", texte: "Bonjour, j'ai bien reçu votre simulation.", leadId: simule.id, origine: "ECRAN" }, instant));
    assert.equal(await prisma.dossierEvenement.count({ where: { dossierId: dossierSimule.id, type: "SMS_COPIE" } }), 1, "le SMS va dans le dossier");
    assert.equal((await prisma.lead.findUniqueOrThrow({ where: { id: simule.id } })).dernierContactLe?.getTime(), instant.getTime(), "le lead du dossier est contacté");
    // Une trace d'avant la règle (sans `dernierContactLe`) suffit aussi.
    await prisma.dossierEvenement.create({ data: { dossierId: dossierAncien.id, type: "MAIL_ENVOYE", direction: "SORTANT", contenu: "Mail envoyé" } });
    const apres = await idsDeLaVue("A_APPELER", instant);
    assert.equal(apres.includes(simule.id), false);
    assert.equal(apres.includes(ancien.id), false);
    const aRappeler = await idsDeLaVue("A_RAPPELER", instant);
    assert.equal(aRappeler.includes(simule.id) || aRappeler.includes(ancien.id), false, "avec un dossier, il sort vers son dossier, pas dans « À rappeler »");
  });

  test("lead archivé → sa tâche passe « Pas à faire » (sujet disparu)", async () => {
    await avecActeur(LUCAS, () => entrants.archiverEntrant(lEcarter.id, "essai : hors zone"));
    await passe(plus(MARDI, 8 * H));
    const ecarter = await tacheSure(`ECARTER:lead:${lEcarter.id}`);
    assert.deepEqual([ecarter.statut, ecarter.reponseRaison, ecarter.reponseTexte], ["PAS_A_FAIRE", "SUJET_DISPARU", "coché par le CRM : contact archivé"]);
  });

  test("une prochaine action posée à la main recouvre les autres tâches du dossier ; seule PROCHAINE_ACTION reste", async () => {
    const d = await unDossier("Recouvert", { photos: JSON.stringify(["r.jpg"]) });
    const instant = plus(MARDI, 9 * H);
    await passe(instant);
    assert.equal((await tacheSure(`SIMULATION:dossier:${d.id}`)).statut, "A_FAIRE");
    await prisma.dossier.update({
      where: { id: d.id },
      data: { prochaineAction: "j'attends sa modification visuelle", prochaineActionManuelle: "j'attends sa modification visuelle", prochaineActionManuelleLe: instant, prochaineActionPar: LUCAS.acteur, prochaineActionDate: plus(MARDI, -J) },
    });
    await passe(plus(instant, H));
    const simulation = await tacheSure(`SIMULATION:dossier:${d.id}`);
    assert.equal(simulation.statut, "FAITE");
    assert.match(simulation.reponseTexte ?? "", /prochaine action posée à la main/);
    const action = await tacheSure(`PROCHAINE_ACTION:dossier:${d.id}`);
    assert.deepEqual([action.statut, action.titre, action.raison], ["A_FAIRE", "J'attends sa modification visuelle · Recouvert", "prévue le 28/09, en retard"]);
    assert.deepEqual((await prisma.tacheAFaire.findMany({ where: { dossierId: d.id, statut: "A_FAIRE" } })).map((t) => t.type), ["PROCHAINE_ACTION"]);
  });

  test("lot des anciens leads : une ligne de lot, « Tout classer », et rien ne revient au passage suivant", async () => {
    const instant = plus(MARDI, 11 * H);
    const liste = await lecture.listeTaches(instant);
    const lot = liste.lots.find((l) => l.cle === "anciens-leads");
    assert.ok(lot, "le lot est listé");
    assert.equal(lot.nombre, 2);
    assert.equal(lot.libelle, "2 anciens leads contactés sans suite");
    assert.equal(liste.aujourdhui.some((t) => t.lot), false, "hors d'« Aujourd'hui »");

    const resultat = await avecActeur(LUCAS, () => reponses.classerLot("anciens-leads", instant));
    assert.equal(resultat.classees, 2);
    for (const id of [lVieux.id, lVieuxAppele.id]) {
      const t = await tacheSure(`CLASSER_LEAD:lead:${id}`);
      assert.deepEqual([t.statut, t.reponseRaison], ["PAS_A_FAIRE", "CLASSE_EN_LOT"]);
    }
    await passe(plus(instant, H));
    for (const id of [lVieux.id, lVieuxAppele.id]) assert.equal((await tacheSure(`CLASSER_LEAD:lead:${id}`)).statut, "PAS_A_FAIRE", "classé par Lucas : ne revient pas");
  });
});
