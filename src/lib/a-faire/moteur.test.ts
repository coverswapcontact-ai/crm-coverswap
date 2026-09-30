import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { preparerBaseEssai } from "@/test/base-essai";

preparerBaseEssai();
process.env.UPLOADS_DIR = mkdtempSync(path.join(tmpdir(), "coverswap-a-faire-"));

/**
 * Mission 17 (partie A) — le cœur des tâches de Lucas : moteur (création, fusion, coche du CRM, retours), réponses
 * (Fait, Plus tard, Pas à faire, Annuler, apprentissage), prochaine action manuelle (vigueur et main), lecture (tri,
 * « Aujourd'hui », « j'ai 15 minutes »). Instants fixes injectés ; noms fictifs.
 */

type Detection = import("./types").Detection;
type TacheVue = import("./types").TacheVue;

let prisma: typeof import("@/lib/prisma").default;
let avecActeur: typeof import("@/lib/journal/contexte").avecActeur;
let moteur: typeof import("./moteur");
let reponses: typeof import("./reponses");
let lecture: typeof import("./lecture");
let vigueur: typeof import("./vigueur");
let detection: typeof import("./detection");
let durees: typeof import("./durees");
let detecteurs: typeof import("./detecteurs");
let types: typeof import("./types");
let dossiers: typeof import("@/lib/dossiers/dossiers");
let main: typeof import("@/lib/dossiers/main");
let validation: typeof import("@/lib/validation/service");
let format: typeof import("@/lib/commun/format");

const LUCAS = { acteur: "HUMAIN:lucas@coverswap.fr" };
/** Mercredi 30/09/2026, 10 h à Paris (heure d'été). */
const MERCREDI = new Date("2026-09-30T08:00:00.000Z");
const MIN = 60_000;
const H = 3_600_000;
const J = 86_400_000;
const plus = (base: Date, ms: number) => new Date(base.getTime() + ms);
const fetchOriginal = globalThis.fetch;

let numero = 0;
const unique = () => `${Date.now().toString(36)}${++numero}`;

async function unDossier(nom: string, donnees: Record<string, unknown> = {}) {
  return prisma.dossier.create({ data: { clientNom: nom, clientAdresse: "1 rue des Essais", clientCp: "34000", clientVille: "Montpellier", clientTelephone: "+33600000000", objet: "Cuisine", source: "ENTRANT", ...donnees } });
}
async function unLead(prenom: string) {
  return prisma.lead.create({ data: { prenom, nom: "Essai", telephone: `+3361${String(100000 + numero++).padStart(7, "0")}`, ville: "Lattes", source: "META_ADS" } });
}
async function unMail(leadId: string, donnees: Record<string, unknown> = {}) {
  const id = unique();
  return prisma.message.create({ data: { canal: "EMAIL", compte: "crm", identifiantCanal: `essai-${id}`, filCanal: `fil-${id}`, sens: "ENTRANT", de: "client@exemple.test", recuLe: plus(MERCREDI, -2 * H), leadId, classe: "CLIENT", ...donnees } });
}

/** Une détection d'essai : sujet déduit du dossier ou du lead, raccourci « dossier ». */
function detectionDe(p: Partial<Detection> & Pick<Detection, "cle" | "type">): Detection {
  const sujet = p.sujet ?? (p.dossierId ? { type: "DOSSIER" as const, id: p.dossierId } : p.leadId ? { type: "LEAD" as const, id: p.leadId } : { type: "SYSTEME" as const, id: null });
  return { source: "DOSSIERS", titre: `${p.type} · Essai`, raison: "essai", niveau: 3, depuis: plus(MERCREDI, -J), raccourci: { genre: "DOSSIER", libelle: "Ouvrir" }, ...p, sujet };
}

const tache = (cle: string) => prisma.tacheAFaire.findUniqueOrThrow({ where: { cle } });
/** Chaque essai part d'une liste vide : les tâches des essais précédents sont retirées (archivées). */
const toutRetirer = () => prisma.tacheAFaire.updateMany({ where: { archiveLe: null }, data: { archiveLe: new Date(), archiveMotif: "essai suivant" } });
const RIEN = { crees: 0, misesAJour: 0, cochees: 0, rouvertes: 0, ecartees: 0 };

before(async () => {
  process.env.NEXTAUTH_SECRET = "secret-de-session-pour-les-essais";
  process.env.SITE_URL = "https://coverswap.fr";
  process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3001";
  globalThis.fetch = (async (url: unknown) => {
    throw new Error(`Aucune requête réseau dans les essais (${String(url)})`);
  }) as typeof fetch;
  prisma = (await import("@/lib/prisma")).default;
  avecActeur = (await import("@/lib/journal/contexte")).avecActeur;
  moteur = await import("./moteur");
  reponses = await import("./reponses");
  lecture = await import("./lecture");
  vigueur = await import("./vigueur");
  detection = await import("./detection");
  durees = await import("./durees");
  detecteurs = await import("./detecteurs");
  types = await import("./types");
  dossiers = await import("@/lib/dossiers/dossiers");
  main = await import("@/lib/dossiers/main");
  validation = await import("@/lib/validation/service");
  format = await import("@/lib/commun/format");
  await (await import("@/lib/base/preparation")).preparerBase();
});

after(async () => {
  globalThis.fetch = fetchOriginal;
  await prisma.$disconnect();
});

describe("moteur : création, fusion, coche du CRM", () => {
  test("une détection répétée ne crée pas de doublon, et un second passage identique n'écrit rien", async () => {
    await toutRetirer();
    const d = await unDossier("Doublon");
    const det = detectionDe({ cle: `DEVIS:dossier:${d.id}`, type: "DEVIS", dossierId: d.id });
    const premier = await moteur.reconcilier([det], { sources: ["DOSSIERS"], maintenant: MERCREDI });
    assert.equal(premier.crees, 1);
    const ligne = await tache(det.cle);
    assert.equal(ligne.statut, "A_FAIRE");
    assert.equal(ligne.dureeMin, 10);
    assert.equal(ligne.dossierId, d.id);
    assert.deepEqual(await moteur.reconcilier([det], { sources: ["DOSSIERS"], maintenant: MERCREDI }), RIEN);
    assert.deepEqual(await moteur.reconcilier([{ ...det }, { ...det }], { sources: ["DOSSIERS"], maintenant: MERCREDI }), RIEN);
    assert.equal(await prisma.tacheAFaire.count({ where: { cle: det.cle } }), 1);
    assert.equal((await tache(det.cle)).updatedAt.getTime(), ligne.updatedAt.getTime(), "aucune écriture inutile");
    // Un changement de titre est repris (et seulement lui).
    const change = await moteur.reconcilier([{ ...det, titre: "Faire le devis · Doublon" }], { sources: ["DOSSIERS"], maintenant: plus(MERCREDI, H) });
    assert.deepEqual(change, { ...RIEN, misesAJour: 1 });
    assert.equal((await tache(det.cle)).titre, "Faire le devis · Doublon");
  });

  test("fusion par clé : la source la plus récente donne le raccourci ; niveau le plus urgent, montant le plus grand ; toutes les sources rangées", async () => {
    await toutRetirer();
    const d = await unDossier("Fusion");
    const cle = `REPONDRE:dossier:${d.id}`;
    const base = { cle, type: "REPONDRE" as const, dossierId: d.id };
    const parSms = detectionDe({ ...base, source: "DOSSIERS", niveau: 1, montant: 5000, depuis: plus(MERCREDI, -3 * H), titre: "Répondre · Fusion (SMS)", raccourci: { genre: "SMS", libelle: "Répondre par SMS" }, donnees: { sms: true } });
    const parMail = detectionDe({ ...base, source: "MAIL", niveau: 2, montant: null, depuis: plus(MERCREDI, -5 * H), titre: "Répondre · Fusion (mail)", raccourci: { genre: "MAIL", libelle: "Répondre", messageId: "m-essai" }, donnees: { messageIds: ["m-essai"] } });
    const parEspace = detectionDe({ ...base, source: "ESPACE_MESSAGES", niveau: 2, montant: 1200, depuis: plus(MERCREDI, -1 * H), titre: "Répondre · Fusion", raccourci: { genre: "ESPACE", libelle: "Répondre dans l'espace", dossierId: d.id }, donnees: { espaceDossierId: d.id } });
    const bilan = await moteur.reconcilier([parSms, parMail, parEspace], { sources: ["DOSSIERS", "MAIL", "ESPACE_MESSAGES"], maintenant: MERCREDI });
    assert.equal(bilan.crees, 1);
    const ligne = await tache(cle);
    assert.equal(ligne.source, "ESPACE_MESSAGES");
    assert.equal(ligne.titre, "Répondre · Fusion");
    assert.equal(JSON.parse(ligne.raccourci).genre, "ESPACE");
    assert.equal(ligne.niveau, 1);
    assert.equal(ligne.montant, 5000);
    assert.equal(ligne.depuis.getTime(), plus(MERCREDI, -5 * H).getTime(), "l'origine du besoin : la plus ancienne");
    assert.deepEqual(JSON.parse(ligne.donnees), { espaceDossierId: d.id, messageIds: ["m-essai"], sms: true, sourcesVues: ["DOSSIERS", "ESPACE_MESSAGES", "MAIL"] });
    // L'ordre des détections ne change rien : le passage suivant n'écrit pas.
    assert.deepEqual(await moteur.reconcilier([parEspace, parMail, parSms], { sources: ["DOSSIERS", "MAIL", "ESPACE_MESSAGES"], maintenant: MERCREDI }), RIEN);
  });

  test("coche du CRM par absence, avec la preuve lue en base (« devis 2026-043 déposé ») et la durée réelle ; la condition revient → à faire", async () => {
    await toutRetirer();
    const d = await unDossier("Devis");
    const det = detectionDe({ cle: `DEVIS:dossier:${d.id}`, type: "DEVIS", dossierId: d.id, titre: "Faire le devis · Devis" });
    await moteur.reconcilier([det], { sources: ["DOSSIERS"], maintenant: MERCREDI });
    const creee = await tache(det.cle);
    assert.equal(await durees.noterCommencement(creee.id, plus(MERCREDI, 50 * MIN)), true);
    await prisma.document.create({ data: { dossierId: d.id, type: "DEVIS", numero: `2026-043`, dateEmission: MERCREDI, objet: "Cuisine", lignes: "[]", totalHt: 4200, statut: "ENVOYE", origine: "REPRISE", visibleEspace: true } });
    // Une autre source en échec ce passage (MAIL non couverte) : ses tâches ne bougent pas.
    const mail = detectionDe({ cle: `LIRE_MAIL:essai-${unique()}`, type: "LIRE_MAIL", source: "MAIL", niveau: 5 });
    await moteur.reconcilier([mail], { sources: ["MAIL"], maintenant: MERCREDI });
    const bilan = await moteur.reconcilier([], { sources: ["DOSSIERS"], maintenant: plus(MERCREDI, H) });
    assert.deepEqual(bilan, { ...RIEN, cochees: 1 });
    const cochee = await tache(det.cle);
    assert.equal(cochee.statut, "FAITE");
    assert.equal(cochee.reponse, "FAIT");
    assert.equal(cochee.reponduPar, types.ACTEUR_TACHES);
    assert.equal(cochee.reponseTexte, "coché par le CRM : devis 2026-043 déposé");
    assert.equal(cochee.dureeReelleSec, 600, "ouvert à 10 h 50, coché à 11 h : 10 minutes");
    assert.equal((await tache(mail.cle)).statut, "A_FAIRE", "une source non couverte n'est pas cochée");
    assert.equal(lecture.versVue(cochee).reponduParLisible, "le CRM");
    // Repasser ne recoche pas.
    assert.deepEqual(await moteur.reconcilier([], { sources: ["DOSSIERS"], maintenant: plus(MERCREDI, H) }), RIEN);
    // Le détecteur la revoit (devis annulé, par exemple) : cochée par le CRM, elle revient.
    const retour = await moteur.reconcilier([det], { sources: ["DOSSIERS"], maintenant: plus(MERCREDI, 2 * H) });
    assert.deepEqual(retour, { ...RIEN, rouvertes: 1 });
    assert.equal((await tache(det.cle)).statut, "A_FAIRE");
  });

  test("autres preuves : encaissement (euros), date du chantier, simulation publiée, mail archivé", async () => {
    await toutRetirer();
    const d = await unDossier("Preuves");
    const encaisser = detectionDe({ cle: `ENCAISSER:dossier:${d.id}`, type: "ENCAISSER", dossierId: d.id, niveau: 1 });
    const date = detectionDe({ cle: `DATE_CHANTIER:dossier:${d.id}`, type: "DATE_CHANTIER", dossierId: d.id, niveau: 1 });
    const lead = await unLead("Archive");
    const message = await unMail(lead.id);
    const repondre = detectionDe({ cle: `REPONDRE:lead:${lead.id}`, type: "REPONDRE", source: "MAIL", leadId: lead.id, depuis: plus(MERCREDI, -2 * H), raccourci: { genre: "MAIL", libelle: "Répondre", messageId: message.id } });
    await moteur.reconcilier([encaisser, date, repondre], { sources: ["DOSSIERS", "MAIL"], maintenant: MERCREDI });
    await prisma.encaissement.create({ data: { dossierId: d.id, payeur: "Preuves", montant: 1200, recuLe: MERCREDI } });
    await prisma.dossier.update({ where: { id: d.id }, data: { dateChantier: new Date("2026-10-12T12:00:00.000Z") } });
    await prisma.message.update({ where: { id: message.id }, data: { traiteLe: MERCREDI } });
    await moteur.reconcilier([], { sources: ["DOSSIERS", "MAIL"], maintenant: plus(MERCREDI, H) });
    assert.equal((await tache(encaisser.cle)).reponseTexte, `coché par le CRM : encaissement de ${format.euros(1200)} saisi`);
    assert.equal((await tache(date.cle)).reponseTexte, "coché par le CRM : date posée au 12/10");
    assert.equal((await tache(repondre.cle)).reponseTexte, "coché par le CRM : mail archivé");
  });

  test("un mail reporté (snooze) met la tâche « Plus tard » jusqu'à sa date, sans la cocher ; à l'échéance elle revient en tête", async () => {
    await toutRetirer();
    const lead = await unLead("Reporte");
    const jusqua = plus(MERCREDI, 2 * J);
    const message = await unMail(lead.id, { snoozeJusqua: jusqua });
    const det = detectionDe({ cle: `REPONDRE:lead:${lead.id}`, type: "REPONDRE", source: "MAIL", leadId: lead.id, niveau: 1, raccourci: { genre: "MAIL", libelle: "Répondre", messageId: message.id } });
    await moteur.reconcilier([det], { sources: ["MAIL"], maintenant: MERCREDI });
    const bilan = await moteur.reconcilier([], { sources: ["MAIL"], maintenant: plus(MERCREDI, H) });
    assert.deepEqual(bilan, { ...RIEN, misesAJour: 1 });
    const reportee = await tache(det.cle);
    assert.equal(reportee.statut, "PLUS_TARD");
    assert.equal(reportee.plusTardJusqua?.getTime(), jusqua.getTime());
    assert.equal(reportee.reponseTexte, "coché par le CRM : mail reporté au 02/10");
    assert.deepEqual(await moteur.reconcilier([], { sources: ["MAIL"], maintenant: plus(MERCREDI, 2 * H) }), RIEN, "rien de plus au passage suivant");
    // Le report échu : le détecteur revoit le fil (« Revenu »), la tâche revient, datée du retour.
    const retour = plus(MERCREDI, 3 * J);
    assert.deepEqual(await moteur.reconcilier([det], { sources: ["MAIL"], maintenant: retour }), { ...RIEN, rouvertes: 1 });
    const revenue = await tache(det.cle);
    assert.equal(revenue.statut, "A_FAIRE");
    assert.equal(revenue.revenueLe?.getTime(), retour.getTime());
  });

  test("sujet disparu (contact archivé, dossier perdu) → « Pas à faire », raison SUJET_DISPARU", async () => {
    await toutRetirer();
    const lead = await unLead("Disparu");
    const d = await unDossier("Perdu");
    const appeler = detectionDe({ cle: `APPELER:lead:${lead.id}`, type: "APPELER", source: "LEADS", leadId: lead.id, niveau: 2 });
    const devis = detectionDe({ cle: `DEVIS:dossier:${d.id}`, type: "DEVIS", dossierId: d.id });
    await moteur.reconcilier([appeler, devis], { sources: ["LEADS", "DOSSIERS"], maintenant: MERCREDI });
    await prisma.lead.update({ where: { id: lead.id }, data: { archiveLe: MERCREDI, archiveMotif: "essai" } });
    await prisma.dossier.update({ where: { id: d.id }, data: { etape: "PERDU" } });
    const bilan = await moteur.reconcilier([], { sources: ["LEADS", "DOSSIERS"], maintenant: plus(MERCREDI, H) });
    assert.equal(bilan.cochees, 2);
    for (const [cle, texte] of [
      [appeler.cle, "coché par le CRM : contact archivé"],
      [devis.cle, "coché par le CRM : dossier perdu"],
    ]) {
      const ligne = await tache(cle);
      assert.equal(ligne.statut, "PAS_A_FAIRE");
      assert.equal(ligne.reponseRaison, "SUJET_DISPARU");
      assert.equal(ligne.reponseTexte, texte);
    }
  });

  test("« Pas à faire » par Lucas n'est pas recréé jusqu'au prochain événement du client (une relecture du devis ne compte pas), puis l'est", async () => {
    await toutRetirer();
    const d = await unDossier("Silence");
    const det = detectionDe({ cle: `REPONDRE:dossier:${d.id}`, type: "REPONDRE", dossierId: d.id, niveau: 1 });
    await moteur.reconcilier([det], { sources: ["DOSSIERS"], maintenant: MERCREDI });
    const { id } = await tache(det.cle);
    const r = await avecActeur(LUCAS, () => reponses.repondreTache(id, { reponse: "PAS_A_FAIRE", raison: "PAS_DE_REPONSE_A_FAIRE" }, plus(MERCREDI, 10 * MIN)));
    assert.equal(r.tache.statut, "PAS_A_FAIRE");
    assert.equal(r.tache.reponduParLisible, "Lucas");
    assert.equal(r.effet, null, "rien à faire sur la source (ni mail, ni espace)");
    await prisma.dossierEvenement.create({ data: { dossierId: d.id, type: "ESPACE_DEVIS_CONSULTE", direction: "ENTRANT", contenu: "Devis relu", createdAt: plus(MERCREDI, 30 * MIN) } });
    assert.deepEqual(await moteur.reconcilier([det], { sources: ["DOSSIERS"], maintenant: plus(MERCREDI, H) }), RIEN);
    assert.equal((await tache(det.cle)).statut, "PAS_A_FAIRE");
    await prisma.dossierEvenement.create({ data: { dossierId: d.id, type: "MAIL_RECU", direction: "ENTRANT", contenu: "Mail du client", createdAt: plus(MERCREDI, 2 * H) } });
    assert.deepEqual(await moteur.reconcilier([det], { sources: ["DOSSIERS"], maintenant: plus(MERCREDI, 3 * H) }), { ...RIEN, rouvertes: 1 });
    assert.equal((await tache(det.cle)).statut, "A_FAIRE");
  });

  test("un sujet SYSTEME répondu à la main revient si la condition tient encore 24 h après", async () => {
    await toutRetirer();
    const det = detectionDe({ cle: `SYSTEME:essai-${unique()}`, type: "SYSTEME", source: "SYSTEME", niveau: 4, sujet: { type: "SYSTEME", id: null } });
    await moteur.reconcilier([det], { sources: ["SYSTEME"], maintenant: MERCREDI });
    const { id } = await tache(det.cle);
    await avecActeur(LUCAS, () => reponses.repondreTache(id, { reponse: "FAIT" }, MERCREDI));
    assert.deepEqual(await moteur.reconcilier([det], { sources: ["SYSTEME"], maintenant: plus(MERCREDI, 23 * H) }), RIEN);
    assert.deepEqual(await moteur.reconcilier([det], { sources: ["SYSTEME"], maintenant: plus(MERCREDI, 25 * H) }), { ...RIEN, rouvertes: 1 });
  });
});

describe("prochaine action manuelle (« j'attends sa modification visuelle »)", () => {
  test("posée par Lucas : événement, main au client, message ancien traité ; ses détections écartées sauf PROCHAINE_ACTION ; un geste du client la lève", async () => {
    await toutRetirer();
    const d = await unDossier("Visuel");
    const maintenant = () => new Date();
    await prisma.dossierEvenement.create({ data: { dossierId: d.id, type: "MAIL_RECU", direction: "ENTRANT", contenu: "Mail du client", createdAt: plus(maintenant(), -2 * J) } });
    await main.recalculerMain(d.id);
    assert.match((await prisma.dossier.findUniqueOrThrow({ where: { id: d.id } })).mainMotif ?? "", /^Répondre à Visuel/);
    const repondre = detectionDe({ cle: `REPONDRE:dossier:${d.id}`, type: "REPONDRE", dossierId: d.id, niveau: 1 });
    await moteur.reconcilier([repondre], { sources: ["DOSSIERS"], maintenant: plus(maintenant(), -H) });

    await avecActeur(LUCAS, () => dossiers.modifierDossier(d.id, { prochaineAction: "Attendre sa modification visuelle", prochaineActionDate: "2026-10-05" }));
    const pose = await prisma.dossier.findUniqueOrThrow({ where: { id: d.id } });
    assert.equal(pose.prochaineActionManuelle, "Attendre sa modification visuelle");
    assert.equal(pose.prochaineActionPar, LUCAS.acteur);
    assert.ok(pose.prochaineActionManuelleLe);
    const evenement = await prisma.dossierEvenement.findFirstOrThrow({ where: { dossierId: d.id, type: "PROCHAINE_ACTION_MANUELLE" } });
    assert.equal(evenement.direction, "INTERNE");
    assert.equal(JSON.parse(evenement.metadata).action, "Attendre sa modification visuelle");
    assert.equal(pose.main, "CLIENT", "le texte dit d'attendre : la main passe au client");
    assert.equal(pose.mainMotif, "Attendre sa modification visuelle");
    // Même texte réécrit : rien de neuf (pas de second événement).
    await avecActeur(LUCAS, () => dossiers.modifierDossier(d.id, { prochaineAction: "Attendre sa modification visuelle" }));
    assert.equal(await prisma.dossierEvenement.count({ where: { dossierId: d.id, type: "PROCHAINE_ACTION_MANUELLE" } }), 1);

    const t1 = plus(maintenant(), H);
    const enVigueur = await vigueur.actionsManuellesEnVigueur(t1, [d.id]);
    assert.equal(enVigueur.get(d.id)?.action, "Attendre sa modification visuelle");
    const devis = detectionDe({ cle: `DEVIS:dossier:${d.id}`, type: "DEVIS", dossierId: d.id });
    const prochaine = detectionDe({ cle: `PROCHAINE_ACTION:dossier:${d.id}`, type: "PROCHAINE_ACTION", dossierId: d.id, niveau: 2, titre: "Attendre sa modification visuelle · Visuel" });
    const systeme = detectionDe({ cle: `SYSTEME:essai-${unique()}`, type: "SYSTEME", source: "SYSTEME", dossierId: d.id, niveau: 5 });
    const bilan = await moteur.reconcilier([repondre, devis, prochaine, systeme], { sources: ["DOSSIERS", "SYSTEME"], maintenant: t1 });
    assert.equal(bilan.ecartees, 2);
    assert.equal(bilan.crees, 2, "PROCHAINE_ACTION et SYSTEME passent");
    assert.equal(bilan.cochees, 1);
    const ecartee = await tache(repondre.cle);
    assert.equal(ecartee.statut, "FAITE");
    assert.equal(ecartee.reponseTexte, "coché par le CRM : prochaine action posée à la main (« Attendre sa modification visuelle »)");
    assert.equal(await prisma.tacheAFaire.count({ where: { cle: devis.cle } }), 0);
    assert.equal((await tache(prochaine.cle)).statut, "A_FAIRE");

    // Le client écrit : la vigueur tombe, la main revient à Lucas, les tâches du dossier reviennent.
    await prisma.dossierEvenement.create({ data: { dossierId: d.id, type: "MAIL_RECU", direction: "ENTRANT", contenu: "Voici mes retours", createdAt: plus(maintenant(), 2 * H) } });
    const t3 = plus(maintenant(), 3 * H);
    assert.equal((await vigueur.actionsManuellesEnVigueur(t3, [d.id])).size, 0);
    await main.recalculerMain(d.id);
    assert.equal((await prisma.dossier.findUniqueOrThrow({ where: { id: d.id } })).main, "MOI");
    const suite = await moteur.reconcilier([repondre, devis, systeme], { sources: ["DOSSIERS", "SYSTEME"], maintenant: t3 });
    assert.deepEqual(suite, { ...RIEN, crees: 1, rouvertes: 1, cochees: 1 });
    assert.equal((await tache(repondre.cle)).statut, "A_FAIRE");
    assert.equal((await tache(prochaine.cle)).statut, "FAITE");
  });

  test("la main : PROCHAINE_ACTION_MANUELLE, REPONSE_INUTILE et REPONDU_HORS_CRM répondent ; seule la première passe la main", () => {
    const ev = (type: string, metadata: Record<string, unknown> = {}) => ({ type, direction: "INTERNE", metadata: JSON.stringify(metadata), contenu: "" });
    for (const type of ["PROCHAINE_ACTION_MANUELLE", "REPONSE_INUTILE", "REPONDU_HORS_CRM"]) assert.equal(main.estReponse(ev(type)), true, type);
    assert.deepEqual(main.passageDeMain(ev("PROCHAINE_ACTION_MANUELLE", { action: "Rappeler lundi pour le coloris" })), { qui: "MOI", motif: "Rappeler lundi pour le coloris" });
    assert.deepEqual(main.passageDeMain(ev("PROCHAINE_ACTION_MANUELLE", { action: "J'attends ses photos" })), { qui: "CLIENT", motif: "J'attends ses photos" });
    assert.equal(main.passageDeMain(ev("REPONSE_INUTILE")), null);
    assert.equal(main.passageDeMain(ev("REPONDU_HORS_CRM")), null);
    assert.ok(main.TYPES_MAIN.includes("PROCHAINE_ACTION_MANUELLE"));
  });
});

describe("réponses : apprentissage, Annuler, Plus tard", () => {
  test("trois « Pas à faire » de même type et même raison en 30 jours proposent une règle (pas avant, pas deux fois) ; validée, elle retient la création", async () => {
    await toutRetirer();
    const ids: string[] = [];
    for (let i = 0; i < 4; i++) {
      const d = await unDossier(`Simulation ${i}`);
      const det = detectionDe({ cle: `SIMULATION:dossier:${d.id}`, type: "SIMULATION", dossierId: d.id });
      await moteur.reconcilier([det], { sources: [], maintenant: MERCREDI });
      ids.push((await tache(det.cle)).id);
    }
    const repondre = (id: string, i: number) => avecActeur(LUCAS, () => reponses.repondreTache(id, { reponse: "PAS_A_FAIRE", raison: "CLIENT_LE_FAIT" }, plus(MERCREDI, i * MIN)));
    assert.equal((await repondre(ids[0], 1)).regle, null);
    assert.equal((await repondre(ids[1], 2)).regle, null);
    const troisieme = await repondre(ids[2], 3);
    assert.equal(troisieme.regle?.creee, true);
    const quatrieme = await repondre(ids[3], 4);
    assert.deepEqual(quatrieme.regle, { propositionId: troisieme.regle!.propositionId, creee: false });
    const proposition = await prisma.proposition.findUniqueOrThrow({ where: { id: troisieme.regle!.propositionId } });
    assert.equal(proposition.type, "REGLE_TACHE");
    assert.equal(proposition.statut, "EN_ATTENTE");
    assert.equal(proposition.cleUnicite, "regle-tache:SIMULATION:CLIENT_LE_FAIT");
    assert.equal(proposition.auteur, types.ACTEUR_TACHES);
    assert.equal(proposition.titre, "Préparer la simulation : attendre 3 jours avant de la proposer (raison : le client la fait souvent lui-même)");
    // Un « Pas à faire » d'une autre raison ne compte pas pour celle-ci.
    assert.equal(await prisma.proposition.count({ where: { type: "REGLE_TACHE" } }), 1);

    const validee = await avecActeur(LUCAS, () => validation.validerProposition(proposition.id));
    assert.equal(validee.statut, "EXECUTEE");
    const regle = await prisma.regleTache.findFirstOrThrow({ where: { type: "SIMULATION", raison: "CLIENT_LE_FAIT" } });
    assert.equal(regle.effet, "ATTENDRE");
    assert.equal(regle.delaiJours, 3);
    assert.equal(regle.par, LUCAS.acteur);
    // La règle : une simulation dont le besoin a moins de 3 jours n'est pas créée ; plus ancienne, si.
    const recente = await unDossier("Recente");
    const ancienne = await unDossier("Ancienne");
    const bilan = await moteur.reconcilier(
      [
        detectionDe({ cle: `SIMULATION:dossier:${recente.id}`, type: "SIMULATION", dossierId: recente.id, depuis: MERCREDI }),
        detectionDe({ cle: `SIMULATION:dossier:${ancienne.id}`, type: "SIMULATION", dossierId: ancienne.id, depuis: plus(MERCREDI, -4 * J) }),
      ],
      { sources: ["DOSSIERS"], maintenant: plus(MERCREDI, H) }
    );
    assert.equal(bilan.crees, 1);
    assert.equal(bilan.ecartees, 1);
    // Et la règle existe : un quatrième « Pas à faire » n'en repropose pas.
    assert.equal(await reponses.proposerRegleSiBesoin("SIMULATION", "CLIENT_LE_FAIT", plus(MERCREDI, H)), null);
    await prisma.regleTache.updateMany({ where: { archiveLe: null }, data: { archiveLe: new Date(), archiveMotif: "fin de l'essai" } });
  });

  test("« Pas à faire » : raison adaptée au type, « autre » précisé, client perdu avec son motif", async () => {
    await toutRetirer();
    const lead = await unLead("Raisons");
    const det = detectionDe({ cle: `APPELER:lead:${lead.id}`, type: "APPELER", source: "LEADS", leadId: lead.id });
    await moteur.reconcilier([det], { sources: [], maintenant: MERCREDI });
    const { id } = await tache(det.cle);
    const refus = (entree: import("./reponses").EntreeReponse) => assert.rejects(avecActeur(LUCAS, () => reponses.repondreTache(id, entree, MERCREDI)), (e: Error) => e.name === "ErreurMetier");
    await refus({ reponse: "PAS_A_FAIRE" });
    await refus({ reponse: "PAS_A_FAIRE", raison: "CLIENT_LE_FAIT" });
    await refus({ reponse: "PAS_A_FAIRE", raison: "AUTRE", texte: "x" });
    await refus({ reponse: "PAS_A_FAIRE", raison: "CLIENT_PERDU" });
    await refus({ reponse: "PLUS_TARD" });
    const r = await avecActeur(LUCAS, () => reponses.repondreTache(id, { reponse: "PAS_A_FAIRE", raison: "CLIENT_PERDU", motifPerte: "HORS_ZONE" }, MERCREDI));
    assert.equal(r.tache.reponseRaison, "CLIENT_PERDU");
    assert.equal(r.tache.reponseTexte, "hors zone");
    assert.ok(r.effet, "le contact passe sans suite par la file d'effets");
    const file = await prisma.tache.findUniqueOrThrow({ where: { cle: r.effet!.cle } });
    const resultat = await reponses.executerEffet(JSON.parse(file.charge));
    assert.deepEqual(resultat.faits, ["contact classé sans suite"]);
    const classe = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
    assert.equal(classe.statut, "PERDU");
    assert.equal(classe.motifPerte, "HORS_ZONE");
  });

  test("« Annuler » : restaure l'état, annule l'effet encore en attente ; après son départ, défait le fil archivé", async () => {
    await toutRetirer();
    const lead = await unLead("Annuler");
    const message = await unMail(lead.id);
    const det = detectionDe({ cle: `REPONDRE:lead:${lead.id}`, type: "REPONDRE", source: "MAIL", leadId: lead.id, niveau: 1, raccourci: { genre: "MAIL", libelle: "Répondre", messageId: message.id } });
    await moteur.reconcilier([det], { sources: [], maintenant: MERCREDI });
    const { id } = await tache(det.cle);

    const fait = await avecActeur(LUCAS, () => reponses.repondreTache(id, { reponse: "FAIT" }, MERCREDI));
    assert.equal(fait.tache.statut, "FAITE");
    assert.equal(fait.effet?.cle, `a-faire-effet:${id}:1`);
    assert.equal(fait.effet?.apres, plus(MERCREDI, 6_000).toISOString());
    const enAttente = await prisma.tache.findUniqueOrThrow({ where: { cle: fait.effet!.cle } });
    assert.equal(enAttente.statut, "EN_ATTENTE");
    assert.equal(enAttente.type, "A_FAIRE_EFFET");

    const annule = await avecActeur(LUCAS, () => reponses.annulerReponse(id, plus(MERCREDI, 3_000)));
    assert.equal(annule.effetAnnule, true);
    assert.equal(annule.tache.statut, "A_FAIRE");
    assert.equal(annule.tache.reponse, null);
    assert.equal(annule.tache.reponduLe, null);
    assert.equal((await prisma.tache.findUniqueOrThrow({ where: { cle: fait.effet!.cle } })).statut, "ANNULEE");
    assert.equal((await tache(det.cle)).precedent, null);
    // Parti malgré tout (course) : il voit la réponse annulée et ne fait rien.
    assert.match((await reponses.executerEffet(JSON.parse(enAttente.charge))).resume, /annulée/);
    assert.equal((await prisma.message.findUniqueOrThrow({ where: { id: message.id } })).traiteLe, null);
    await assert.rejects(avecActeur(LUCAS, () => reponses.annulerReponse(id, MERCREDI)), /Rien à annuler/);

    // Deuxième réponse : l'effet part (fil archivé), puis « Annuler » le défait.
    const encore = await avecActeur(LUCAS, () => reponses.repondreTache(id, { reponse: "FAIT" }, plus(MERCREDI, MIN)));
    assert.equal(encore.effet?.cle, `a-faire-effet:${id}:2`);
    const file = await prisma.tache.findUniqueOrThrow({ where: { cle: encore.effet!.cle } });
    const resultat = await reponses.executerEffet(JSON.parse(file.charge));
    assert.deepEqual(resultat.faits, ["fil archivé"]);
    assert.ok((await prisma.message.findUniqueOrThrow({ where: { id: message.id } })).traiteLe);
    await prisma.tache.update({ where: { id: file.id }, data: { statut: "TERMINEE", resultat: JSON.stringify(resultat) } });
    const defait = await avecActeur(LUCAS, () => reponses.annulerReponse(id, plus(MERCREDI, 2 * MIN)));
    assert.equal(defait.effetAnnule, false);
    assert.deepEqual(defait.defaits, ["fil désarchivé"]);
    assert.deepEqual(defait.nonDefaits, []);
    assert.equal((await prisma.message.findUniqueOrThrow({ where: { id: message.id } })).traiteLe, null);
    assert.equal((await tache(det.cle)).statut, "A_FAIRE");
  });

  test("« Plus tard » : CE_SOIR, DEMAIN, LUNDI, SEMAINE et une date, à l'heure de Paris", async () => {
    assert.equal(reponses.jusquaPlusTard({ quand: "CE_SOIR" }, MERCREDI).toISOString(), "2026-09-30T16:00:00.000Z");
    assert.equal(reponses.jusquaPlusTard({ quand: "CE_SOIR" }, new Date("2026-09-30T17:00:00.000Z")).toISOString(), "2026-09-30T19:00:00.000Z", "après 18 h : 21 h");
    assert.equal(reponses.jusquaPlusTard({ quand: "DEMAIN" }, MERCREDI).toISOString(), "2026-10-01T07:00:00.000Z");
    assert.equal(reponses.jusquaPlusTard({ quand: "LUNDI" }, MERCREDI).toISOString(), "2026-10-05T07:00:00.000Z");
    assert.equal(reponses.jusquaPlusTard({ quand: "LUNDI" }, new Date("2026-10-05T08:00:00.000Z")).toISOString(), "2026-10-12T07:00:00.000Z", "un lundi : le suivant");
    assert.equal(reponses.jusquaPlusTard({ quand: "SEMAINE" }, MERCREDI).toISOString(), "2026-10-07T07:00:00.000Z");
    assert.equal(reponses.jusquaPlusTard({ date: "2026-10-27" }, MERCREDI).toISOString(), "2026-10-27T08:00:00.000Z", "9 h, heure d'hiver");
    assert.throws(() => reponses.jusquaPlusTard({ date: "2026-09-29" }, MERCREDI), /passée/);

    await toutRetirer();
    const d = await unDossier("Plus tard");
    const det = detectionDe({ cle: `DEVIS:dossier:${d.id}`, type: "DEVIS", dossierId: d.id });
    await moteur.reconcilier([det], { sources: [], maintenant: MERCREDI });
    const { id } = await tache(det.cle);
    const r = await avecActeur(LUCAS, () => reponses.repondreTache(id, { reponse: "PLUS_TARD", quand: "DEMAIN", raison: "ATTEND_CLIENT" }, MERCREDI));
    assert.equal(r.tache.statut, "PLUS_TARD");
    assert.equal(r.tache.plusTardJusqua, "2026-10-01T07:00:00.000Z");
    assert.equal(r.tache.reponseRaison, "ATTEND_CLIENT");
  });
});

describe("lecture : tri, « Aujourd'hui », lots, « j'ai 15 minutes »", () => {
  const vue = (p: Partial<TacheVue> & { id: string }): TacheVue => ({
    cle: p.id,
    type: "DEVIS",
    source: "DOSSIERS",
    sujetType: "DOSSIER",
    sujetId: null,
    leadId: null,
    dossierId: null,
    clientId: null,
    titre: p.id,
    raison: "",
    niveau: 3,
    montant: null,
    depuis: MERCREDI.toISOString(),
    echeance: null,
    dureeMin: 5,
    raccourci: { genre: "DOSSIER", libelle: "Ouvrir" },
    donnees: {},
    lot: null,
    lotLibelle: null,
    statut: "A_FAIRE",
    reponse: null,
    reponseRaison: null,
    reponseTexte: null,
    reponduLe: null,
    reponduParLisible: null,
    plusTardJusqua: null,
    revenueLe: null,
    ...p,
  });

  test("tri : revenue du jour en tête, puis niveau, montant (sans montant en dernier), ancienneté", () => {
    const jour = (n: number) => plus(MERCREDI, n * J).toISOString();
    const taches = [
      vue({ id: "g", niveau: 3, revenueLe: jour(-1) }),
      vue({ id: "d", niveau: 2, montant: 99_999 }),
      vue({ id: "c", niveau: 1, montant: null, depuis: jour(-5) }),
      vue({ id: "a", niveau: 1, montant: 800, depuis: jour(-2) }),
      vue({ id: "b", niveau: 1, montant: 5000, depuis: jour(-1) }),
      vue({ id: "f", niveau: 5, revenueLe: plus(MERCREDI, -H).toISOString() }),
      vue({ id: "e", niveau: 1, montant: 5000, depuis: jour(-3) }),
      vue({ id: "h", niveau: 4, statut: "PLUS_TARD", plusTardJusqua: plus(MERCREDI, -MIN).toISOString() }),
    ];
    assert.deepEqual(lecture.trierTaches(taches, MERCREDI).map((t) => t.id), ["h", "f", "e", "b", "a", "c", "d", "g"]);
    assert.deepEqual(taches.map((t) => t.id)[0], "g", "le tableau reçu n'est pas modifié");
  });

  test("« Aujourd'hui » (10 au plus), le reste et les lots à part, le badge, et « j'ai 15 minutes » (glouton qui saute ce qui ne tient pas)", async () => {
    await toutRetirer();
    const leads = await Promise.all([unLead("Un"), unLead("Deux"), unLead("Trois")]);
    const d = await unDossier("Plan");
    const anciens = await Promise.all([unLead("Ancien"), unLead("Vieux")]);
    const lot = { cle: "anciens-leads", libelle: "ancien lead à classer|anciens leads à classer" };
    await moteur.reconcilier(
      [
        ...leads.map((l, i) => detectionDe({ cle: `APPELER:lead:${l.id}`, type: "APPELER", source: "LEADS", leadId: l.id, niveau: 2, depuis: plus(MERCREDI, -(i + 1) * H) })),
        detectionDe({ cle: `DEVIS:dossier:${d.id}`, type: "DEVIS", dossierId: d.id }),
        detectionDe({ cle: `LIRE_MAIL:essai-${unique()}`, type: "LIRE_MAIL", source: "MAIL", niveau: 5 }),
        ...anciens.map((l) => detectionDe({ cle: `CLASSER_LEAD:lead:${l.id}`, type: "CLASSER_LEAD", source: "LEADS", leadId: l.id, niveau: 5, lot })),
      ],
      { sources: [], maintenant: MERCREDI }
    );
    for (let i = 0; i < 8; i++) await avecActeur(LUCAS, () => reponses.ajouterTache({ titre: `Tâche à moi ${i + 1}` }, MERCREDI));

    const plan = await lecture.planMinutes(15, MERCREDI);
    assert.equal(plan.utilisees, 15);
    assert.deepEqual(
      plan.groupes.map((g) => [g.famille, g.libelle]),
      [
        ["APPELS", "3 appels · 9 min"],
        ["MANUELLE", "1 tâche à moi · 5 min"],
        ["LIRE_MAIL", "1 mail à lire · 1 min"],
      ]
    );
    assert.equal(plan.taches.length, 5);

    const liste = await lecture.listeTaches(MERCREDI);
    assert.equal(liste.aujourdhui.length, 10);
    assert.equal(liste.plusTard.length, 3);
    assert.deepEqual(liste.aujourdhui.slice(0, 4).map((t) => t.type), ["APPELER", "APPELER", "APPELER", "DEVIS"]);
    assert.equal(liste.aujourdhui[0].leadId, leads[2].id, "à niveau et montant égaux : le plus ancien d'abord");
    assert.deepEqual(liste.lots, [{ cle: "anciens-leads", libelle: "2 anciens leads à classer", nombre: 2, dureeMin: 2, types: ["CLASSER_LEAD"] }]);
    assert.equal(liste.compteurs.enLot, 2);
    assert.equal(liste.compteurs.minutesAujourdhui, 3 * 3 + 10 + 6 * 5);
    assert.equal(await lecture.compterAujourdhui(MERCREDI), 10);
    assert.equal((await lecture.tachesDuLot("anciens-leads", MERCREDI)).length, 2);

    // « Tout classer » : les deux anciens contacts passent sans suite par la file d'effets ; « Annuler » les remet.
    const classement = await avecActeur(LUCAS, () => reponses.classerLot("anciens-leads", MERCREDI));
    assert.deepEqual(classement, { classees: 2, effets: 2, laissees: 0 });
    const liste2 = await lecture.listeTaches(MERCREDI);
    assert.equal(liste2.lots.length, 0);
    assert.equal(liste2.faitAujourdhui.length, 2);
    assert.equal(liste2.faitAujourdhui[0].reponseRaison, "CLASSE_EN_LOT");
    const retour = await avecActeur(LUCAS, () => reponses.annulerLot("anciens-leads", MERCREDI));
    assert.equal(retour.restaurees, 2);
    assert.equal((await lecture.listeTaches(MERCREDI)).lots[0]?.nombre, 2);
    assert.equal(await prisma.tache.count({ where: { cle: { startsWith: "a-faire-effet:" }, statut: "ANNULEE", type: "A_FAIRE_EFFET", charge: { contains: anciens[0].id } } }), 1);
  });

  test("un « Plus tard » échu revient en tête le jour de son retour (détecté ou non : tâche à moi)", async () => {
    await toutRetirer();
    const urgent = await unDossier("Urgent");
    const menage = await unDossier("Menage");
    const detUrgent = detectionDe({ cle: `DATE_CHANTIER:dossier:${urgent.id}`, type: "DATE_CHANTIER", dossierId: urgent.id, niveau: 1, montant: 9000 });
    const detMenage = detectionDe({ cle: `COHERENCE:dossier:${menage.id}`, type: "COHERENCE", source: "COHERENCE", dossierId: menage.id, niveau: 5 });
    await moteur.reconcilier([detUrgent, detMenage], { sources: [], maintenant: MERCREDI });
    const idMenage = (await tache(detMenage.cle)).id;
    const reportee = await avecActeur(LUCAS, () => reponses.repondreTache(idMenage, { reponse: "PLUS_TARD", quand: "DEMAIN" }, MERCREDI));
    assert.equal(reportee.tache.statut, "PLUS_TARD");
    const manuelle = await avecActeur(LUCAS, () => reponses.ajouterTache({ titre: "Relire la politique de confidentialité", raison: "reste de la mission 16" }, MERCREDI));
    await avecActeur(LUCAS, () => reponses.repondreTache(manuelle.id, { reponse: "PLUS_TARD", quand: "DEMAIN" }, MERCREDI));

    const mercredi = await lecture.listeTaches(MERCREDI);
    assert.deepEqual(mercredi.aujourdhui.map((t) => t.cle), [detUrgent.cle]);
    assert.equal(mercredi.plusTard.length, 2);
    assert.equal(mercredi.demain, 2);

    const jeudi = new Date("2026-10-01T08:00:00.000Z");
    const bilan = await moteur.reconcilier([detUrgent, detMenage], { sources: ["DOSSIERS", "COHERENCE"], maintenant: jeudi });
    assert.equal(bilan.rouvertes, 2, "la reportée détectée, et la tâche à moi (jamais détectée)");
    const revenue = await tache(detMenage.cle);
    assert.equal(revenue.statut, "A_FAIRE");
    assert.equal(revenue.revenueLe?.getTime(), jeudi.getTime());
    const liste = await lecture.listeTaches(jeudi);
    assert.deepEqual(liste.aujourdhui.map((t) => t.cle), [manuelle.cle, detMenage.cle, detUrgent.cle], "revenues en tête (par niveau), l'urgente ensuite");
  });
});

describe("passage complet", () => {
  test("un détecteur en échec : sa source n'est pas couverte, ses tâches ne sont pas cochées ; les autres passent", async () => {
    await toutRetirer();
    const lead = await unLead("Panne");
    const detMail = detectionDe({ cle: `REPONDRE:lead:${lead.id}`, type: "REPONDRE", source: "MAIL", leadId: lead.id, niveau: 1 });
    await moteur.reconcilier([detMail], { sources: [], maintenant: MERCREDI });
    const d = await unDossier("Passage");
    const bilan = await detection.passeComplete(plus(MERCREDI, H), {
      detecteurs: [
        { source: "MAIL", detecter: async () => Promise.reject(new Error("boîte injoignable")) },
        { source: "DOSSIERS", detecter: async () => [detectionDe({ cle: `DEVIS:dossier:${d.id}`, type: "DEVIS", dossierId: d.id, source: "LEADS" })] },
      ],
    });
    assert.deepEqual(bilan.sources.map((s) => [s.source, s.couverte]), [["MAIL", false], ["DOSSIERS", true]]);
    assert.equal(bilan.sources[0].erreur, "boîte injoignable");
    assert.equal(bilan.reconciliation.crees, 1);
    assert.equal((await tache(detMail.cle)).statut, "A_FAIRE");
    assert.equal((await tache(`DEVIS:dossier:${d.id}`)).source, "DOSSIERS", "la source est celle du détecteur");
    assert.match(detection.resumePasse(bilan), /1 créée/);
  });

  test("les détecteurs : un par source, chacun rend une liste", async () => {
    const sources = detecteurs.DETECTEURS.map((d) => d.source);
    assert.deepEqual([...sources].sort(), [...types.SOURCES_TACHE].sort());
    const contexte = { maintenant: MERCREDI, vigueur: new Map() };
    // Mission 17 (partie A, lot 2) : les détecteurs sont écrits (ils ne sont plus vides) ; chacun est essayé dans son fichier.
    for (const d of detecteurs.DETECTEURS) assert.ok(Array.isArray(await d.detecter(contexte)), d.source);
    assert.equal(detecteurs.cleTache("REPONDRE", { type: "DOSSIER", id: "d1" }), "REPONDRE:dossier:d1");
    assert.equal(detecteurs.cleTache("SYSTEME", { type: "SYSTEME", id: null }, "jeton-meta"), "SYSTEME:jeton-meta");
  });
});

/** Mission 17 (partie A) — relecture adverse du lot 1 : chaque défaut corrigé a son essai. */
describe("relecture du lot 1 : défauts corrigés", () => {
  const executerFile = async (cle: string) => reponses.executerEffet(JSON.parse((await prisma.tache.findUniqueOrThrow({ where: { cle } })).charge));
  const terminer = async (cle: string, resultat: unknown) => prisma.tache.update({ where: { cle }, data: { statut: "TERMINEE", resultat: JSON.stringify(resultat) } });

  test("fusion : la source la plus récente fournit le raccourci, même DOSSIERS ; une détection qui ne porte que son sujet est soumise à la vigueur", async () => {
    await toutRetirer();
    const d = await unDossier("Sujet seul");
    const cle = `REPONDRE:dossier:${d.id}`;
    const parSms = detectionDe({ cle, type: "REPONDRE", dossierId: d.id, source: "DOSSIERS", depuis: plus(MERCREDI, -H), raccourci: { genre: "SMS", libelle: "Répondre par SMS" } });
    const parMail = detectionDe({ cle, type: "REPONDRE", dossierId: d.id, source: "MAIL", depuis: plus(MERCREDI, -3 * J), raccourci: { genre: "MAIL", libelle: "Répondre" } });
    const [fusionnee] = moteur.fusionnerDetections([parMail, parSms]);
    assert.equal(fusionnee.source, "DOSSIERS");
    assert.equal(fusionnee.raccourci.genre, "SMS", "le SMS d'il y a 1 h, pas le vieux mail");
    assert.equal(fusionnee.depuis.getTime(), plus(MERCREDI, -3 * J).getTime());

    const devis = detectionDe({ cle: `DEVIS:dossier:${d.id}`, type: "DEVIS", sujet: { type: "DOSSIER", id: d.id } });
    assert.equal(devis.dossierId, undefined, "seul le sujet désigne le dossier");
    const enVigueur = new Map([[d.id, { dossierId: d.id, action: "Attendre ses retours", date: null, le: MERCREDI, par: LUCAS.acteur }]]);
    const bilan = await moteur.reconcilier([devis], { sources: ["DOSSIERS"], maintenant: plus(MERCREDI, H), vigueur: enVigueur });
    assert.deepEqual(bilan, { ...RIEN, ecartees: 1 });
    assert.equal(await prisma.tacheAFaire.count({ where: { cle: devis.cle } }), 0);
  });

  test("une source en panne ne fait pas cocher ce qu'une autre voyait aussi ; recouvert par une coche du CRM, le « Plus tard » de Lucas lui est rendu", async () => {
    await toutRetirer();
    const d = await unDossier("Deux sources");
    const cle = `REPONDRE:dossier:${d.id}`;
    const parMail = detectionDe({ cle, type: "REPONDRE", source: "MAIL", dossierId: d.id, niveau: 1, depuis: plus(MERCREDI, -5 * H), raccourci: { genre: "MAIL", libelle: "Répondre" } });
    const parEspace = detectionDe({ cle, type: "REPONDRE", source: "ESPACE_MESSAGES", dossierId: d.id, niveau: 1, depuis: plus(MERCREDI, -H), raccourci: { genre: "ESPACE", libelle: "Répondre" } });
    await moteur.reconcilier([parMail, parEspace], { sources: ["MAIL", "ESPACE_MESSAGES"], maintenant: MERCREDI });
    assert.deepEqual(JSON.parse((await tache(cle)).donnees).sourcesVues, ["ESPACE_MESSAGES", "MAIL"]);
    const { id } = await tache(cle);
    const reportee = await avecActeur(LUCAS, () => reponses.repondreTache(id, { reponse: "PLUS_TARD", quand: "SEMAINE" }, plus(MERCREDI, MIN)));
    const jusqua = reportee.tache.plusTardJusqua;

    // L'espace ne voit plus rien (message lu ailleurs), le détecteur MAIL est en panne : on ne sait pas, rien ne bouge.
    const panne = await detection.passeComplete(plus(MERCREDI, H), {
      detecteurs: [
        { source: "MAIL", detecter: async () => Promise.reject(new Error("boîte injoignable")) },
        { source: "ESPACE_MESSAGES", detecter: async () => [] },
      ],
    });
    assert.equal(panne.reconciliation.cochees, 0);
    assert.equal((await tache(cle)).statut, "PLUS_TARD");
    // Le mail seul la voit encore : elle garde son « Plus tard », sa source devient MAIL.
    await moteur.reconcilier([parMail], { sources: ["MAIL", "ESPACE_MESSAGES"], maintenant: plus(MERCREDI, 2 * H) });
    const parLeMail = await tache(cle);
    assert.equal(parLeMail.statut, "PLUS_TARD");
    assert.equal(parLeMail.source, "MAIL");
    assert.equal(JSON.parse(parLeMail.donnees).sourcesVues, undefined);
    // Plus personne ne la voit : cochée par le CRM (l'état d'avant est rangé).
    assert.deepEqual(await moteur.reconcilier([], { sources: ["MAIL", "ESPACE_MESSAGES"], maintenant: plus(MERCREDI, 3 * H) }), { ...RIEN, cochees: 1 });
    assert.equal((await tache(cle)).statut, "FAITE");
    // Elle revient (condition revenue) : le « Plus tard » de Lucas court encore, il lui est rendu.
    assert.deepEqual(await moteur.reconcilier([parMail], { sources: ["MAIL"], maintenant: plus(MERCREDI, 4 * H) }), { ...RIEN, rouvertes: 1 });
    const rendue = await tache(cle);
    assert.equal(rendue.statut, "PLUS_TARD");
    assert.equal(rendue.plusTardJusqua?.toISOString(), jusqua);
    assert.equal(lecture.versVue(rendue).reponduParLisible, "Lucas");
    assert.deepEqual((await lecture.listeTaches(plus(MERCREDI, 4 * H))).aujourdhui, [], "pas dans « Aujourd'hui » avant sa date");
  });

  test("un mail reporté par le CRM revient « à faire » dès que le détecteur le revoit (report levé)", async () => {
    await toutRetirer();
    const lead = await unLead("Deporte");
    const message = await unMail(lead.id, { snoozeJusqua: plus(MERCREDI, 5 * J) });
    const det = detectionDe({ cle: `REPONDRE:lead:${lead.id}`, type: "REPONDRE", source: "MAIL", leadId: lead.id, niveau: 1, raccourci: { genre: "MAIL", libelle: "Répondre", messageId: message.id } });
    await moteur.reconcilier([det], { sources: ["MAIL"], maintenant: MERCREDI });
    await moteur.reconcilier([], { sources: ["MAIL"], maintenant: plus(MERCREDI, H) });
    assert.equal((await tache(det.cle)).statut, "PLUS_TARD");
    const avant = await prisma.tache.findUnique({ where: { cle: "a-faire:detection" } });
    await avecActeur(LUCAS, async () => (await import("@/lib/mail/v2")).annulerSnooze(message.id));
    const signal = await prisma.tache.findUniqueOrThrow({ where: { cle: "a-faire:detection" } });
    assert.ok(!avant || signal.updatedAt.getTime() > avant.updatedAt.getTime(), "annulerSnooze demande un passage");
    assert.deepEqual(await moteur.reconcilier([det], { sources: ["MAIL"], maintenant: plus(MERCREDI, 2 * H) }), { ...RIEN, rouvertes: 1 });
    const revenue = await tache(det.cle);
    assert.equal(revenue.statut, "A_FAIRE");
    assert.equal(revenue.revenueLe?.getTime(), plus(MERCREDI, 2 * H).getTime());
  });

  test("NE_PLUS_PROPOSER : les tâches ouvertes du type passent « Pas à faire » par le CRM ; la règle retirée, elles reviennent", async () => {
    await toutRetirer();
    const d = await unDossier("Regle");
    const det = detectionDe({ cle: `PUBLIER:dossier:${d.id}`, type: "PUBLIER", dossierId: d.id });
    await moteur.reconcilier([det], { sources: ["DOSSIERS"], maintenant: MERCREDI });
    await avecActeur(LUCAS, () => prisma.regleTache.create({ data: { type: "PUBLIER", raison: "PAS_PERTINENT", effet: "NE_PLUS_PROPOSER", libelle: "Publier la simulation : ne plus la proposer", par: LUCAS.acteur } }));
    assert.deepEqual(await moteur.reconcilier([det], { sources: ["DOSSIERS"], maintenant: plus(MERCREDI, H) }), { ...RIEN, cochees: 1 });
    const ecartee = await tache(det.cle);
    assert.equal(ecartee.statut, "PAS_A_FAIRE");
    assert.equal(ecartee.reponduPar, types.ACTEUR_TACHES);
    assert.equal(ecartee.reponseTexte, "coché par le CRM : règle « Publier la simulation : ne plus la proposer »");
    assert.deepEqual(await moteur.reconcilier([det], { sources: ["DOSSIERS"], maintenant: plus(MERCREDI, 2 * H) }), { ...RIEN, ecartees: 1 });
    await prisma.regleTache.updateMany({ where: { archiveLe: null }, data: { archiveLe: new Date(), archiveMotif: "fin de l'essai" } });
    assert.deepEqual(await moteur.reconcilier([det], { sources: ["DOSSIERS"], maintenant: plus(MERCREDI, 3 * H) }), { ...RIEN, rouvertes: 1 });
    const revenue = await tache(det.cle);
    assert.equal(revenue.statut, "A_FAIRE");
    assert.equal(revenue.reponse, null, "réponse remise à zéro");
    assert.equal(lecture.versVue(revenue).reponseTexte, null);
  });

  test("une détection mal formée : sa source n'est pas couverte, sa tâche n'est pas cochée ; les valides passent", async () => {
    await toutRetirer();
    const d = await unDossier("Mal formee");
    const autre = await unDossier("Bien formee");
    const det = detectionDe({ cle: `DEVIS:dossier:${d.id}`, type: "DEVIS", dossierId: d.id });
    await moteur.reconcilier([det], { sources: ["DOSSIERS"], maintenant: MERCREDI });
    const bilan = await detection.passeComplete(plus(MERCREDI, H), {
      detecteurs: [{ source: "DOSSIERS", detecter: async () => [{ ...det, niveau: 0 as never }, detectionDe({ cle: `SIMULATION:dossier:${autre.id}`, type: "SIMULATION", dossierId: autre.id })] }],
    });
    assert.equal(bilan.sources[0].couverte, false);
    assert.match(bilan.sources[0].erreur ?? "", /1 détection mal formée/);
    assert.deepEqual(bilan.reconciliation, { ...RIEN, crees: 1 });
    assert.equal((await tache(det.cle)).statut, "A_FAIRE");
  });

  test("une tâche rouverte (le client a écrit) : réponse remise à zéro, et l'effet encore en file ne part pas", async () => {
    await toutRetirer();
    const lead = await unLead("Rouverte");
    const message = await unMail(lead.id);
    const det = detectionDe({ cle: `REPONDRE:lead:${lead.id}`, type: "REPONDRE", source: "MAIL", leadId: lead.id, niveau: 1, raccourci: { genre: "MAIL", libelle: "Répondre", messageId: message.id } });
    await moteur.reconcilier([det], { sources: ["MAIL"], maintenant: MERCREDI });
    const { id } = await tache(det.cle);
    const fait = await avecActeur(LUCAS, () => reponses.repondreTache(id, { reponse: "FAIT" }, MERCREDI));
    await unMail(lead.id, { recuLe: plus(MERCREDI, 2_000) });
    assert.deepEqual(await moteur.reconcilier([det], { sources: ["MAIL"], maintenant: plus(MERCREDI, 4_000) }), { ...RIEN, rouvertes: 1 });
    const rouverte = await tache(det.cle);
    assert.equal(rouverte.statut, "A_FAIRE");
    assert.equal(rouverte.reponse, null);
    assert.equal(rouverte.reponduPar, null);
    assert.equal(rouverte.precedent, null);
    assert.match((await executerFile(fait.effet!.cle)).resume, /annulée ou remplacée/);
    assert.equal((await prisma.message.findUniqueOrThrow({ where: { id: message.id } })).traiteLe, null, "le fil (avec le nouveau mail) n'est pas archivé");
  });

  test("lots : un « Plus tard » échu compte et se classe ; un ancien contact qui a un dossier (même signé) n'est jamais classé en lot", async () => {
    await toutRetirer();
    const lot = { cle: `anciens-${unique()}`, libelle: "ancien lead à classer|anciens leads à classer" };
    const seul = await unLead("Seul");
    const signe = await unLead("Signe");
    const dossier = await unDossier("Signe", { leadId: signe.id, etape: "SIGNE" });
    const dets = [seul, signe].map((l) => detectionDe({ cle: `CLASSER_LEAD:lead:${l.id}`, type: "CLASSER_LEAD", source: "LEADS", leadId: l.id, niveau: 5, lot }));
    await moteur.reconcilier(dets, { sources: [], maintenant: MERCREDI });
    await avecActeur(LUCAS, async () => reponses.repondreTache((await tache(dets[0].cle)).id, { reponse: "PLUS_TARD", quand: "DEMAIN" }, MERCREDI));
    const jeudi = new Date("2026-10-01T08:00:00.000Z");
    assert.equal((await lecture.listeTaches(jeudi)).lots.find((l) => l.cle === lot.cle)?.nombre, 2);
    assert.equal((await lecture.tachesDuLot(lot.cle, jeudi)).length, 2, "compté et revu : les mêmes");
    const classement = await avecActeur(LUCAS, () => reponses.classerLot(lot.cle, jeudi));
    assert.deepEqual(classement, { classees: 1, effets: 1, laissees: 1 });
    const effet = await prisma.tache.findFirstOrThrow({ where: { type: "A_FAIRE_EFFET", charge: { contains: (await tache(dets[0].cle)).id } }, orderBy: { createdAt: "desc" } });
    assert.deepEqual((await reponses.executerEffet(JSON.parse(effet.charge))).faits, ["contact classé sans suite"]);
    assert.equal((await prisma.lead.findUniqueOrThrow({ where: { id: seul.id } })).statut, "PERDU");
    assert.equal((await tache(dets[1].cle)).statut, "A_FAIRE", "à revoir une par une");
    assert.equal((await prisma.dossier.findUniqueOrThrow({ where: { id: dossier.id } })).etape, "SIGNE");
  });

  test("« Fait » et proposition : seule une tâche VALIDER la valide, jamais une sensible ; ailleurs elle est rejetée « déjà fait »", async () => {
    await toutRetirer();
    const d = await unDossier("Proposition");
    const envoi = () =>
      prisma.proposition.create({ data: { type: "ENVOI_MAIL", titre: "Réponse", resume: "r", contenu: JSON.stringify({ motif: "REPONSE", a: "client@exemple.test", objet: "Re", texte: "Bonjour", dossierId: d.id }), auteur: "AGENT:mail", statut: "EN_ATTENTE" } });
    const brouillon = await envoi();
    const repondre = detectionDe({ cle: `REPONDRE:dossier:${d.id}`, type: "REPONDRE", source: "MAIL", dossierId: d.id, niveau: 1, donnees: { propositionId: brouillon.id } });
    await moteur.reconcilier([repondre], { sources: [], maintenant: MERCREDI });
    const fait = await avecActeur(LUCAS, async () => reponses.repondreTache((await tache(repondre.cle)).id, { reponse: "FAIT" }, MERCREDI));
    const resultat = await executerFile(fait.effet!.cle);
    assert.deepEqual(resultat.faits, ["proposition ignorée"]);
    assert.match(resultat.resume, /^Tâche REPONDRE /);
    assert.doesNotMatch(resultat.resume, /Essai|Proposition/, "ni titre ni nom dans la file des tâches de fond");
    const rejetee = await prisma.proposition.findUniqueOrThrow({ where: { id: brouillon.id } });
    assert.equal(rejetee.statut, "REJETEE");
    assert.equal(rejetee.motifRejet, "DEJA_FAIT");
    assert.equal(await prisma.tache.count({ where: { cle: `proposition:${brouillon.id}` } }), 0, "aucun envoi mis en file");

    const sensible = await envoi();
    const valider = detectionDe({ cle: `VALIDER:proposition:${sensible.id}`, type: "VALIDER", source: "PROPOSITIONS", dossierId: d.id, donnees: { propositionId: sensible.id } });
    const note = await prisma.proposition.create({ data: { type: "NOTE_DOSSIER", titre: "Note", resume: "n", contenu: JSON.stringify({ dossierId: d.id, texte: "Coloris choisi" }), auteur: "AGENT:mail", statut: "EN_ATTENTE" } });
    const validerNote = detectionDe({ cle: `VALIDER:proposition:${note.id}`, type: "VALIDER", source: "PROPOSITIONS", dossierId: d.id, donnees: { propositionId: note.id } });
    await moteur.reconcilier([valider, validerNote], { sources: [], maintenant: MERCREDI });
    await assert.rejects(avecActeur(LUCAS, async () => reponses.repondreTache((await tache(valider.cle)).id, { reponse: "FAIT" }, MERCREDI)), /À valider/);
    assert.equal((await prisma.proposition.findUniqueOrThrow({ where: { id: sensible.id } })).statut, "EN_ATTENTE");
    const faitNote = await avecActeur(LUCAS, async () => reponses.repondreTache((await tache(validerNote.cle)).id, { reponse: "FAIT" }, MERCREDI));
    assert.deepEqual((await executerFile(faitNote.effet!.cle)).faits, ["proposition validée et exécutée"]);
    assert.equal((await prisma.proposition.findUniqueOrThrow({ where: { id: note.id } })).decidePar, LUCAS.acteur);
  });

  test("« Fait » sur APPELER puis RAPPELER : le dernier contact avance ; « Annuler » remet la date d'avant", async () => {
    await toutRetirer();
    const lead = await unLead("Contact");
    const appeler = detectionDe({ cle: `APPELER:lead:${lead.id}`, type: "APPELER", source: "LEADS", leadId: lead.id, niveau: 2 });
    await moteur.reconcilier([appeler], { sources: [], maintenant: MERCREDI });
    const premier = await avecActeur(LUCAS, async () => reponses.repondreTache((await tache(appeler.cle)).id, { reponse: "FAIT" }, MERCREDI));
    await terminer(premier.effet!.cle, await executerFile(premier.effet!.cle));
    const lundi = plus(MERCREDI, 5 * J);
    const rappeler = detectionDe({ cle: `RAPPELER:lead:${lead.id}`, type: "RAPPELER", source: "LEADS", leadId: lead.id, niveau: 2 });
    await moteur.reconcilier([rappeler], { sources: [], maintenant: lundi });
    const second = await avecActeur(LUCAS, async () => reponses.repondreTache((await tache(rappeler.cle)).id, { reponse: "FAIT" }, lundi));
    const resultat = await executerFile(second.effet!.cle);
    assert.deepEqual(resultat.faits, ["contact noté sur la fiche"]);
    assert.equal((await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).dernierContactLe?.getTime(), lundi.getTime());
    await terminer(second.effet!.cle, resultat);
    const idRappeler = (await tache(rappeler.cle)).id;
    const annule = await avecActeur(LUCAS, () => reponses.annulerReponse(idRappeler, plus(lundi, MIN)));
    assert.deepEqual(annule.defaits, ["contact retiré de la fiche"]);
    assert.equal((await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).dernierContactLe?.getTime(), MERCREDI.getTime(), "la date d'avant, pas rien");
  });

  test("un effet rejoué ne se double pas et garde ses inverses ; « Annuler » défait ce qui est fait même si la file attend un nouvel essai", async () => {
    await toutRetirer();
    const d = await unDossier("Rejoue");
    const message = await prisma.messageEspace.create({ data: { dossierId: d.id, auteur: "CLIENT", source: "MESSAGE", texte: "Merci !" } });
    const det = detectionDe({ cle: `REPONDRE:dossier:${d.id}`, type: "REPONDRE", source: "ESPACE_MESSAGES", dossierId: d.id, niveau: 1, raccourci: { genre: "ESPACE", libelle: "Répondre" }, donnees: { espaceDossierId: d.id } });
    await moteur.reconcilier([det], { sources: [], maintenant: MERCREDI });
    const { id } = await tache(det.cle);
    const r = await avecActeur(LUCAS, () => reponses.repondreTache(id, { reponse: "PAS_A_FAIRE", raison: "PAS_DE_REPONSE_A_FAIRE" }, MERCREDI));
    const premier = await executerFile(r.effet!.cle);
    assert.deepEqual(premier.faits, ["messages de l'espace marqués lus"]);
    // La file réessaie (erreur plus loin, redémarrage) : rien n'est doublé, les inverses sont gardés.
    const second = await executerFile(r.effet!.cle);
    assert.equal(second.inverses.length, 1);
    assert.equal(await prisma.dossierEvenement.count({ where: { dossierId: d.id, type: "REPONSE_INUTILE" } }), 1);
    assert.ok((await prisma.messageEspace.findUniqueOrThrow({ where: { id: message.id } })).luLe);
    // La file attend encore (nouvel essai) : « Annuler » l'annule ET défait ce qui est déjà fait.
    const annule = await avecActeur(LUCAS, () => reponses.annulerReponse(id, plus(MERCREDI, MIN)));
    assert.equal(annule.effetAnnule, true);
    assert.deepEqual(annule.defaits, ["messages de l'espace remis non lus"]);
    assert.equal((await prisma.messageEspace.findUniqueOrThrow({ where: { id: message.id } })).luLe, null);
    assert.equal(await prisma.dossierEvenement.count({ where: { dossierId: d.id, type: "REPONSE_INUTILE" } }), 0, "l'événement est archivé");
  });

  test("apprentissage et main : « client perdu » et « autre » n'apprennent rien ; « En attente de… » passe la main au client ; une PROCHAINE_ACTION validée est manuelle", async () => {
    await toutRetirer();
    for (const raison of ["CLIENT_PERDU", "AUTRE"]) {
      for (let i = 0; i < 3; i++) {
        const lead = await unLead(`Appris ${raison} ${i}`);
        const det = detectionDe({ cle: `APPELER:lead:${lead.id}`, type: "APPELER", source: "LEADS", leadId: lead.id });
        await moteur.reconcilier([det], { sources: [], maintenant: MERCREDI });
        const entree = raison === "AUTRE" ? { reponse: "PAS_A_FAIRE" as const, raison, texte: "numéro faux" } : { reponse: "PAS_A_FAIRE" as const, raison, motifPerte: "HORS_ZONE" };
        const r = await avecActeur(LUCAS, async () => reponses.repondreTache((await tache(det.cle)).id, entree, plus(MERCREDI, i * MIN)));
        assert.equal(r.regle, null, `${raison} ${i}`);
      }
    }
    const ev = (action: string) => ({ type: "PROCHAINE_ACTION_MANUELLE", direction: "INTERNE", metadata: JSON.stringify({ action }), contenu: "" });
    assert.equal(main.passageDeMain(ev("En attente de ses photos"))?.qui, "CLIENT");
    assert.equal(main.passageDeMain(ev("Relancer pour le coloris"))?.qui, "MOI");

    const d = await unDossier("Proposee");
    const proposition = await prisma.proposition.create({ data: { type: "PROCHAINE_ACTION", titre: "Prochaine action", resume: "p", contenu: JSON.stringify({ dossierId: d.id, action: "Attendre ses photos", date: null }), auteur: "AGENT:mail", statut: "EN_ATTENTE" } });
    await avecActeur(LUCAS, () => validation.validerProposition(proposition.id));
    const pose = await prisma.dossier.findUniqueOrThrow({ where: { id: d.id } });
    assert.equal(pose.prochaineActionManuelle, "Attendre ses photos");
    assert.equal(pose.prochaineActionPar, LUCAS.acteur);
    assert.equal(pose.main, "CLIENT");
    assert.equal(await prisma.dossierEvenement.count({ where: { dossierId: d.id, type: "PROCHAINE_ACTION_MANUELLE" } }), 1);
  });
});
