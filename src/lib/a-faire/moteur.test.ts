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
    aClient: false,
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
    assert.deepEqual(classement, { classees: 2, effets: 2, laissees: 0, le: MERCREDI.toISOString() });
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
    assert.deepEqual(classement, { classees: 1, effets: 1, laissees: 1, le: jeudi.toISOString() });
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

  test("« Fait » sur APPELER puis RAPPELER : le dernier APPEL avance (pas un contact écrit) ; « Annuler » remet la date d'avant", async () => {
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
    // Relecture : « Fait » sur un appel note un APPEL (dernierAppelLe) — la fiche ne dit plus « contacté par écrit ».
    assert.deepEqual(resultat.faits, ["appel noté sur la fiche"]);
    const apres = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
    assert.equal(apres.dernierAppelLe?.getTime(), lundi.getTime());
    assert.equal(apres.dernierContactLe, null, "aucun contact écrit n'est inventé");
    await terminer(second.effet!.cle, resultat);
    const idRappeler = (await tache(rappeler.cle)).id;
    const annule = await avecActeur(LUCAS, () => reponses.annulerReponse(idRappeler, plus(lundi, MIN)));
    assert.deepEqual(annule.defaits, ["appel retiré de la fiche"]);
    assert.equal((await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).dernierAppelLe?.getTime(), MERCREDI.getTime(), "la date d'avant, pas rien");
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

describe("relecture adverse (mission 17 A) : défauts confirmés, corrigés", () => {
  const executerFile = async (cle: string) => reponses.executerEffet(JSON.parse((await prisma.tache.findUniqueOrThrow({ where: { cle } })).charge));
  const terminer = async (cle: string, resultat: unknown) => prisma.tache.update({ where: { cle }, data: { statut: "TERMINEE", resultat: JSON.stringify(resultat) } });
  const detecteursDe = (...sources: string[]) => detecteurs.DETECTEURS.filter((x) => sources.includes(x.source));
  const passe = (maintenant: Date, ...sources: import("./types").SourceTache[]) => detection.passeComplete(maintenant, { sources, detecteurs: detecteursDe(...sources) });
  const ligne = (cle: string) => prisma.tacheAFaire.findUnique({ where: { cle } });
  const faitParLucas = (cle: string, le: Date) => prisma.tacheAFaire.update({ where: { cle }, data: { statut: "FAITE", reponse: "FAIT", reponduLe: le, reponduPar: LUCAS.acteur } });

  test("PROCHAINE_ACTION : « Fait » lève l'action posée à la main (le dossier revient au suivi) ; « Annuler » la remet ; une action reposée est un besoin nouveau", async () => {
    await toutRetirer();
    const d = await unDossier("Leve Essai", { etape: "SIGNE", prochaineAction: "Rappeler pour la date", prochaineActionManuelle: "Rappeler pour la date", prochaineActionManuelleLe: plus(MERCREDI, -J), prochaineActionDate: plus(MERCREDI, -2 * H), prochaineActionPar: LUCAS.acteur });
    const cle = `PROCHAINE_ACTION:dossier:${d.id}`;
    const cleDate = `DATE_CHANTIER:dossier:${d.id}`;
    await passe(MERCREDI, "DOSSIERS");
    assert.equal((await tache(cle)).statut, "A_FAIRE");
    assert.equal(await ligne(cleDate), null, "muet tant que l'action tient");

    const fait = await avecActeur(LUCAS, async () => reponses.repondreTache((await tache(cle)).id, { reponse: "FAIT" }, plus(MERCREDI, MIN)));
    const resultat = await executerFile(fait.effet!.cle);
    assert.deepEqual(resultat.faits, ["prochaine action retirée du dossier"]);
    await terminer(fait.effet!.cle, resultat);
    const leve = await prisma.dossier.findUniqueOrThrow({ where: { id: d.id } });
    assert.deepEqual([leve.prochaineAction, leve.prochaineActionDate, leve.prochaineActionManuelle, leve.prochaineActionManuelleLe], [null, null, null, null]);
    await passe(plus(MERCREDI, 10 * MIN), "DOSSIERS");
    assert.equal((await tache(cleDate)).statut, "A_FAIRE", "le dossier n'est plus invisible : la date du chantier revient");

    // « Annuler » remet l'action telle qu'elle était.
    const annule = await avecActeur(LUCAS, async () => reponses.annulerReponse((await tache(cle)).id, plus(MERCREDI, 11 * MIN)));
    assert.deepEqual(annule.defaits, ["prochaine action remise sur le dossier"]);
    const remise = await prisma.dossier.findUniqueOrThrow({ where: { id: d.id } });
    assert.deepEqual([remise.prochaineAction, remise.prochaineActionManuelle, remise.prochaineActionManuelleLe?.getTime()], ["Rappeler pour la date", "Rappeler pour la date", plus(MERCREDI, -J).getTime()]);

    // Ce que « Annuler » ne peut pas défaire se dit en français (plus de « action manuelle : … »).
    const refait = await avecActeur(LUCAS, async () => reponses.repondreTache((await tache(cle)).id, { reponse: "FAIT" }, plus(MERCREDI, 12 * MIN)));
    await terminer(refait.effet!.cle, await executerFile(refait.effet!.cle));
    await prisma.dossier.update({ where: { id: d.id }, data: { prochaineAction: "Envoyer les créneaux", prochaineActionManuelle: "Envoyer les créneaux", prochaineActionManuelleLe: plus(MERCREDI, 20 * MIN), prochaineActionDate: plus(MERCREDI, 2 * J), prochaineActionPar: LUCAS.acteur } });
    const second = await avecActeur(LUCAS, async () => reponses.annulerReponse((await tache(cle)).id, plus(MERCREDI, 21 * MIN)));
    assert.deepEqual(second.nonDefaits, ["prochaine action à remettre sur le dossier : une autre prochaine action a été posée depuis"]);

    // Répondue « Fait » par Lucas, puis une AUTRE action posée à la main : besoin nouveau (occurrence), la tâche revient.
    await faitParLucas(cle, plus(MERCREDI, 22 * MIN));
    await passe(plus(MERCREDI, 2 * J + H), "DOSSIERS");
    const revenue = await tache(cle);
    assert.deepEqual([revenue.statut, revenue.titre, revenue.reponse], ["A_FAIRE", "Envoyer les créneaux · Leve Essai", null]);
  });

  test("une même clé, des besoins successifs : la 2e relance revient après un « Fait » sur la 1re ; même occurrence : rien ; tâche d'avant les occurrences : le besoin né après la réponse", async () => {
    await toutRetirer();
    const d = await unDossier("Relance Essai");
    const cle = `RELANCER_DEVIS:dossier:${d.id}`;
    const det = (depuis: Date, rangRelance: number, occurrence?: string): Detection => detectionDe({ cle, type: "RELANCER_DEVIS", source: "RELANCES", dossierId: d.id, niveau: 2, depuis, titre: "Relancer le devis · Relance Essai", raison: `${rangRelance}e relance`, donnees: occurrence ? { occurrence } : {} });
    await moteur.reconcilier([det(MERCREDI, 1, "doc:1")], { sources: ["RELANCES"], maintenant: MERCREDI, vigueur: new Map() });
    await faitParLucas(cle, plus(MERCREDI, 5 * MIN));
    // Toujours la 1re (le SMS n'est pas encore compté) : rien ne bouge.
    assert.equal((await moteur.reconcilier([det(MERCREDI, 1, "doc:1")], { sources: ["RELANCES"], maintenant: plus(MERCREDI, H), vigueur: new Map() })).rouvertes, 0);
    await moteur.reconcilier([], { sources: ["RELANCES"], maintenant: plus(MERCREDI, J), vigueur: new Map() });
    const bilan = await moteur.reconcilier([det(plus(MERCREDI, 7 * J), 2, "doc:2")], { sources: ["RELANCES"], maintenant: plus(MERCREDI, 7 * J), vigueur: new Map() });
    assert.equal(bilan.rouvertes, 1);
    assert.deepEqual([(await tache(cle)).statut, (await tache(cle)).raison, (await tache(cle)).reponse], ["A_FAIRE", "2e relance", null]);

    // Une tâche close avant les occurrences : revient si le besoin est né après la réponse, pas avant.
    const e = await unDossier("Ancienne Essai");
    const cleE = `ENCAISSER:dossier:${e.id}`;
    const enc = (depuis: Date, occurrence: string) => detectionDe({ cle: cleE, type: "ENCAISSER", dossierId: e.id, niveau: 1, depuis, donnees: { occurrence } });
    await moteur.reconcilier([detectionDe({ cle: cleE, type: "ENCAISSER", dossierId: e.id, niveau: 1, depuis: plus(MERCREDI, -3 * J) })], { sources: [], maintenant: MERCREDI, vigueur: new Map() });
    await faitParLucas(cleE, MERCREDI);
    assert.equal((await moteur.reconcilier([enc(plus(MERCREDI, -3 * J), "ACOMPTE")], { sources: [], maintenant: plus(MERCREDI, H), vigueur: new Map() })).rouvertes, 0);
    assert.equal((await moteur.reconcilier([enc(plus(MERCREDI, 20 * J), "SOLDE:facture")], { sources: [], maintenant: plus(MERCREDI, 20 * J), vigueur: new Map() })).rouvertes, 1, "le solde, après l'acompte");
    assert.equal(moteur.besoinNouveau({ donnees: JSON.stringify({ occurrence: "a" }), reponduLe: MERCREDI }, { donnees: { occurrence: "a" }, depuis: plus(MERCREDI, J) }), false);
  });

  test("RAPPELER (lead) : un nouveau rappel après « Fait » revient ; la vue des espaces ne masque qu'une même occurrence (« Lien expiré » après « Envoyer le lien »)", async () => {
    await toutRetirer();
    const lead = await prisma.lead.create({ data: { prenom: "Rappel", nom: "Occurrence", telephone: "+33611119999", ville: "Lattes", source: "META_ADS", createdAt: plus(MERCREDI, -3 * J), dernierAppelLe: plus(MERCREDI, -2 * J), rappelLe: plus(MERCREDI, 4 * H) } });
    const cle = `RAPPELER:lead:${lead.id}`;
    await passe(MERCREDI, "LEADS");
    assert.equal((await tache(cle)).statut, "A_FAIRE");
    assert.equal(lireJson((await tache(cle)).donnees).occurrence, plus(MERCREDI, 4 * H).toISOString());
    await faitParLucas(cle, plus(MERCREDI, 5 * H));
    await passe(plus(MERCREDI, 6 * H), "LEADS");
    assert.equal((await tache(cle)).statut, "FAITE", "même rappel : rien de neuf");
    await prisma.lead.update({ where: { id: lead.id }, data: { rappelLe: plus(MERCREDI, J + H) } });
    await passe(plus(MERCREDI, J + 2 * H), "LEADS");
    const revenu = await tache(cle);
    assert.deepEqual([revenu.statut, revenu.raison], ["A_FAIRE", "rappel prévu le 01/10 à 11 h"]);

    const { lireVueDesTaches } = await import("./vue-espaces");
    const d = await unDossier("Lien Essai");
    const cleLien = `ENVOYER_LIEN:dossier:${d.id}`;
    await prisma.tacheAFaire.create({ data: { cle: cleLien, type: "ENVOYER_LIEN", source: "SIGNAUX", sujetType: "DOSSIER", sujetId: d.id, dossierId: d.id, titre: "Envoyer le lien · Lien Essai", raison: "lien pas encore envoyé", niveau: 3, depuis: MERCREDI, dureeMin: 1, donnees: JSON.stringify({ occurrence: "NON_ENVOYE:2026-09-30T08:00:00.000Z" }), statut: "FAITE", reponse: "FAIT", reponduLe: MERCREDI, reponduPar: LUCAS.acteur } });
    const vue = await lireVueDesTaches(plus(MERCREDI, H), [cleLien], []);
    assert.equal(vue.ecartee(cleLien, "NON_ENVOYE:2026-09-30T08:00:00.000Z"), true, "le signal auquel Lucas a répondu reste masqué");
    assert.equal(vue.ecartee(cleLien, "EXPIRE:2026-10-30T08:00:00.000Z"), false, "« Lien expiré » : un autre besoin, affiché");
  });

  test("sources lues en entier : 300 rappels datés ne font pas cocher « Appeler » d'un lead neuf ; propositions et messages d'espace sans limite", async () => {
    await toutRetirer();
    const neuf = await prisma.lead.create({ data: { prenom: "Tronque", nom: "Essai", telephone: "+33655556666", ville: "Lattes", source: "META_ADS", createdAt: plus(MERCREDI, -30 * MIN) } });
    await passe(MERCREDI, "LEADS");
    const cle = `APPELER:lead:${neuf.id}`;
    assert.equal((await tache(cle)).statut, "A_FAIRE");
    await prisma.lead.createMany({ data: Array.from({ length: 300 }, (_, i) => ({ prenom: `R${i}`, nom: "Rappel", telephone: `+3367${String(1000000 + i).slice(-7)}0`, ville: "Lattes", source: "META_ADS", rappelLe: plus(MERCREDI, 30 * J), dernierAppelLe: plus(MERCREDI, -J) })) });
    const bilan = await passe(plus(MERCREDI, 15 * MIN), "LEADS");
    assert.equal((await tache(cle)).statut, "A_FAIRE", "lu, donc pas coché par absence");
    assert.equal(bilan.reconciliation.cochees, 0);
    await prisma.lead.updateMany({ where: { nom: "Rappel", prenom: { startsWith: "R" } }, data: { archiveLe: MERCREDI, archiveMotif: "essai" } });

    const d = await unDossier("Messages Essai");
    await prisma.proposition.createMany({ data: Array.from({ length: 501 }, (_, i) => ({ type: "NOTE_DOSSIER", titre: `Note ${i}`, resume: "r", contenu: "{}", auteur: "AGENT:essai", statut: "EN_ATTENTE" })) });
    await prisma.messageEspace.createMany({ data: Array.from({ length: 501 }, (_, i) => ({ dossierId: d.id, auteur: "CLIENT", texte: `Message ${i}`, source: "MESSAGE" })) });
    assert.ok((await validation.listerPropositions({ statuts: ["EN_ATTENTE"], limite: null })).length >= 501);
    const { messagesEspace } = await import("@/lib/espace/messages");
    assert.ok((await messagesEspace({ nonLus: true, limite: null })).length >= 501);
    await prisma.proposition.updateMany({ where: { auteur: "AGENT:essai" }, data: { statut: "ANNULEE" } });
    await prisma.messageEspace.updateMany({ where: { dossierId: d.id }, data: { luLe: MERCREDI } });
  });

  test("« Appeler » d'un lead qui a écrit : coché « il a écrit : à lui répondre » (jamais « SMS copié ») ; « Répondre » à faire", async () => {
    await toutRetirer();
    const lead = await prisma.lead.create({ data: { prenom: "Ecrit", nom: "Essai", telephone: "+33633334444", ville: "Lattes", source: "META_ADS", createdAt: plus(MERCREDI, -60 * MIN) } });
    await passe(MERCREDI, "LEADS");
    const cle = `APPELER:lead:${lead.id}`;
    assert.equal((await tache(cle)).statut, "A_FAIRE");
    const conv = await prisma.conversationSms.create({ data: { numero: lead.telephone, leadId: lead.id, dernierMessageLe: plus(MERCREDI, 5 * MIN), dernierExtrait: "Rappelez-moi", dernierSens: "ENTRANT", nonLus: 1 } });
    await prisma.sms.create({ data: { conversationId: conv.id, sens: "ENTRANT", texte: "Rappelez-moi après 18 h", statut: "RECU", recuLe: plus(MERCREDI, 5 * MIN), createdAt: plus(MERCREDI, 5 * MIN) } });
    await prisma.interaction.create({ data: { leadId: lead.id, type: "SMS", contenu: "SMS reçu : Rappelez-moi après 18 h", createdAt: plus(MERCREDI, 5 * MIN) } });
    await passe(plus(MERCREDI, 15 * MIN), "LEADS");
    const appeler = await tache(cle);
    assert.deepEqual([appeler.statut, appeler.reponseTexte], ["FAITE", "coché par le CRM : il a écrit : à lui répondre"]);
    assert.equal((await tache(`REPONDRE:lead:${lead.id}`)).statut, "A_FAIRE");
    // Plus rien à répondre (conversation close ailleurs) : le « SMS reçu » n'est pas une « réponse partie ».
    await prisma.conversationSms.update({ where: { id: conv.id }, data: { dernierSens: "SORTANT" } });
    await passe(plus(MERCREDI, 30 * MIN), "LEADS");
    assert.equal((await tache(`REPONDRE:lead:${lead.id}`)).reponseTexte, "coché par le CRM : plus rien à faire");
  });

  test("preuves datées après la naissance du besoin : un vieux devis, un vieil appel ne cochent rien ; une preuve du jour se lit à l'heure", async () => {
    await toutRetirer();
    const d = await unDossier("Preuve Essai");
    await prisma.document.create({ data: { dossierId: d.id, type: "DEVIS", numero: "2026-701", dateEmission: plus(MERCREDI, -20 * J), createdAt: plus(MERCREDI, -20 * J), objet: "Cuisine", lignes: "[]", totalHt: 1000, statut: "ENVOYE", visibleEspace: true } });
    const devis = detectionDe({ cle: `DEVIS:dossier:${d.id}`, type: "DEVIS", dossierId: d.id, depuis: plus(MERCREDI, -J) });
    await moteur.reconcilier([devis], { sources: ["DOSSIERS"], maintenant: MERCREDI, vigueur: new Map() });
    await moteur.reconcilier([], { sources: ["DOSSIERS"], maintenant: plus(MERCREDI, H), vigueur: new Map() });
    assert.equal((await tache(devis.cle)).reponseTexte, "coché par le CRM : plus rien à faire", "le devis d'il y a 20 jours n'est pas la preuve");

    const lead = await prisma.lead.create({ data: { prenom: "Vieil", nom: "Appel", telephone: "+33644445555", ville: "Lattes", source: "META_ADS", dernierAppelLe: plus(MERCREDI, -10 * J) } });
    const appeler = detectionDe({ cle: `APPELER:lead:${lead.id}`, type: "APPELER", source: "LEADS", leadId: lead.id, depuis: plus(MERCREDI, -2 * H) });
    await moteur.reconcilier([appeler], { sources: ["LEADS"], maintenant: MERCREDI, vigueur: new Map() });
    await moteur.reconcilier([], { sources: ["LEADS"], maintenant: plus(MERCREDI, H), vigueur: new Map() });
    assert.equal((await tache(appeler.cle)).reponseTexte, "coché par le CRM : plus rien à faire");

    const lead2 = await prisma.lead.create({ data: { prenom: "Neuf", nom: "Appel", telephone: "+33644446666", ville: "Lattes", source: "META_ADS", dernierAppelLe: plus(MERCREDI, 30 * MIN) } });
    const appeler2 = detectionDe({ cle: `APPELER:lead:${lead2.id}`, type: "APPELER", source: "LEADS", leadId: lead2.id, depuis: plus(MERCREDI, -2 * H) });
    await moteur.reconcilier([appeler2], { sources: ["LEADS"], maintenant: MERCREDI, vigueur: new Map() });
    await moteur.reconcilier([], { sources: ["LEADS"], maintenant: plus(MERCREDI, H), vigueur: new Map() });
    assert.equal((await tache(appeler2.cle)).reponseTexte, "coché par le CRM : appel noté à 10:30", "du jour : l'heure (Paris)");
  });

  test("une seule tâche par besoin : un SMS d'un client à deux dossiers → un seul « Répondre » (le dossier le plus récent) ; HESITE repris par la relance", async () => {
    await toutRetirer();
    const client = await prisma.client.create({ data: { nom: "Double Essai", source: "SITE", premierContactLe: plus(MERCREDI, -10 * J) } });
    const a = await unDossier("Double Essai", { clientId: client.id, etape: "SIMULATION", clientTelephone: "+33600000077", createdAt: plus(MERCREDI, -5 * J) });
    const b = await unDossier("Double Essai", { clientId: client.id, etape: "SIMULATION", clientTelephone: "+33600000077", objet: "Salle de bain", createdAt: plus(MERCREDI, -2 * J) });
    await prisma.conversationSms.create({ data: { numero: "+33600000077", clientId: client.id, dernierMessageLe: plus(MERCREDI, -H), dernierExtrait: "Bonjour ?", dernierSens: "ENTRANT", nonLus: 1 } });
    await passe(MERCREDI, "DOSSIERS");
    const repondre = await prisma.tacheAFaire.findMany({ where: { type: "REPONDRE", dossierId: { in: [a.id, b.id] }, archiveLe: null } });
    assert.deepEqual(repondre.map((t) => t.dossierId), [b.id]);

    const d = await unDossier("Hesite Essai");
    const hesite = detectionDe({ cle: `HESITE:dossier:${d.id}`, type: "HESITE", source: "SIGNAUX", dossierId: d.id, niveau: 2, titre: "Appeler · Hesite Essai", raison: "devis relu 4 fois sans signer" });
    await moteur.reconcilier([hesite], { sources: ["SIGNAUX"], maintenant: MERCREDI, vigueur: new Map() });
    const relance = detectionDe({ cle: `RELANCER_DEVIS:dossier:${d.id}`, type: "RELANCER_DEVIS", source: "RELANCES", dossierId: d.id, niveau: 2, titre: "Relancer le devis · Hesite Essai", raison: "devis 2026-044 envoyé le 23/09, 1re relance" });
    await moteur.reconcilier([hesite, relance], { sources: ["SIGNAUX", "RELANCES"], maintenant: plus(MERCREDI, H), vigueur: new Map() });
    assert.equal((await tache(relance.cle)).raison, "devis 2026-044 envoyé le 23/09, 1re relance · devis relu 4 fois sans signer");
    assert.deepEqual([(await tache(hesite.cle)).statut, (await tache(hesite.cle)).reponseTexte], ["FAITE", "coché par le CRM : reprise dans « Relancer le devis · Hesite Essai »"]);
    // La relance faite (plus proposable), HESITE revient (coché par le CRM : la condition revient).
    await moteur.reconcilier([hesite], { sources: ["SIGNAUX", "RELANCES"], maintenant: plus(MERCREDI, 2 * H), vigueur: new Map() });
    assert.equal((await tache(hesite.cle)).statut, "A_FAIRE");
  });

  test("« Préparer la simulation » n'est pas proposée quand une simulation attend d'être publiée (brouillon) : « Publier » la reprend", async () => {
    await toutRetirer();
    const d = await unDossier("Brouillon Essai", { photos: JSON.stringify(["a.jpg", "b.jpg"]) });
    await passe(MERCREDI, "DOSSIERS");
    assert.equal((await tache(`SIMULATION:dossier:${d.id}`)).statut, "A_FAIRE");
    const espace = await prisma.espaceClient.create({ data: { code: `brouillon${unique()}`, dossierId: d.id, expireLe: plus(MERCREDI, 60 * J) } });
    await prisma.simulationEspace.create({ data: { espaceId: espace.id, dossierId: d.id, chemin: "rendu.jpg", statut: "BROUILLON" } });
    await passe(plus(MERCREDI, H), "DOSSIERS");
    const simulation = await tache(`SIMULATION:dossier:${d.id}`);
    assert.deepEqual([simulation.statut, simulation.reponseTexte], ["FAITE", "coché par le CRM : simulation préparée, à publier"]);
  });

  test("raisons en dates absolues : deux passages de plus (15 min, 2 h) n'écrivent rien (LEADS, MAIL, ESPACE_MESSAGES, PROPOSITIONS)", async () => {
    await toutRetirer();
    const lead = await prisma.lead.create({ data: { prenom: "Stable", nom: "Essai", telephone: "+33611112222", ville: "Lattes", source: "META_ADS", createdAt: plus(MERCREDI, -10 * MIN) } });
    await unMail(lead.id, { recuLe: plus(MERCREDI, -20 * MIN) });
    const d = await unDossier("Stable Essai");
    await prisma.messageEspace.create({ data: { dossierId: d.id, auteur: "CLIENT", texte: "Une question", source: "MESSAGE", createdAt: plus(MERCREDI, -15 * MIN) } });
    await prisma.proposition.create({ data: { type: "NOTE_DOSSIER", titre: "Noter l'appel", resume: "r", contenu: "{}", auteur: "AGENT:essai-stable", statut: "EN_ATTENTE", createdAt: plus(MERCREDI, -5 * MIN) } });
    const sources = ["LEADS", "MAIL", "ESPACE_MESSAGES", "PROPOSITIONS"] as const;
    const b1 = await passe(MERCREDI, ...sources);
    assert.ok(b1.reconciliation.crees >= 4);
    for (const apres of [15 * MIN, 2 * H]) {
      const b = await passe(plus(MERCREDI, apres), ...sources);
      // (« écartées » : les tâches retirées des essais précédents, que les détecteurs voient encore.)
      assert.deepEqual({ ...b.reconciliation, ecartees: 0 }, RIEN, `rien à écrire après ${apres / MIN} min`);
    }
    await prisma.proposition.updateMany({ where: { auteur: "AGENT:essai-stable" }, data: { statut: "ANNULEE" } });
    await prisma.messageEspace.updateMany({ where: { dossierId: d.id }, data: { luLe: MERCREDI } });
  });

  test("« Tout classer » puis « Annuler » : seul le classement de cet instant revient, jamais celui d'un autre jour", async () => {
    await toutRetirer();
    const lot = { cle: "anciens-leads", libelle: "ancien|anciens" };
    const classer = (lead: { id: string }) => detectionDe({ cle: `CLASSER_LEAD:lead:${lead.id}`, type: "CLASSER_LEAD", source: "LEADS", leadId: lead.id, niveau: 5, lot });
    const lundi = [await unLead("Ancien1"), await unLead("Ancien2")];
    await moteur.reconcilier(lundi.map(classer), { sources: [], maintenant: MERCREDI, vigueur: new Map() });
    const premier = await avecActeur(LUCAS, () => reponses.classerLot("anciens-leads", MERCREDI));
    assert.equal(premier.le, MERCREDI.toISOString());
    for (const t of await prisma.tache.findMany({ where: { type: "A_FAIRE_EFFET", statut: "EN_ATTENTE", charge: { contains: "PERTE_LEAD" } } })) await terminer(t.cle, await executerFile(t.cle));
    assert.equal((await prisma.lead.findUniqueOrThrow({ where: { id: lundi[0].id } })).statut, "PERDU");

    const vendredi = plus(MERCREDI, 2 * J);
    const nouveau = await unLead("Ancien3");
    await moteur.reconcilier([classer(nouveau)], { sources: [], maintenant: vendredi, vigueur: new Map() });
    const second = await avecActeur(LUCAS, () => reponses.classerLot("anciens-leads", vendredi));
    const r = await avecActeur(LUCAS, () => reponses.annulerLot("anciens-leads", plus(vendredi, MIN), second.le));
    assert.equal(r.restaurees, 1);
    assert.equal((await tache(classer(nouveau).cle)).statut, "A_FAIRE");
    assert.equal((await tache(classer(lundi[0]).cle)).statut, "PAS_A_FAIRE", "le classement de mercredi reste");
    assert.equal((await prisma.lead.findUniqueOrThrow({ where: { id: lundi[0].id } })).statut, "PERDU");
    // Sans instant : le dernier classement seulement.
    await avecActeur(LUCAS, () => reponses.classerLot("anciens-leads", plus(vendredi, H)));
    assert.equal((await avecActeur(LUCAS, () => reponses.annulerLot("anciens-leads", plus(vendredi, 2 * H)))).restaurees, 1);
  });

  test("« Client perdu » : seulement quand il y a un client (liste et serveur) ; « Ignorer » une validation n'apprend rien", async () => {
    await toutRetirer();
    assert.equal(types.raisonsPasAFaire("REPONDRE", { aClient: false }).includes("CLIENT_PERDU"), false);
    assert.equal(types.raisonsPasAFaire("REPONDRE", { aClient: true }).includes("CLIENT_PERDU"), true);
    assert.deepEqual(types.raisonsPasAFaire("REPONDRE"), types.raisonsPasAFaire("REPONDRE", { aClient: true }));
    const fil = detectionDe({ cle: `REPONDRE:fil:x${unique()}`, type: "REPONDRE", source: "MAIL", niveau: 3, raccourci: { genre: "MAIL", libelle: "Répondre", href: "/mail" } });
    await moteur.reconcilier([fil], { sources: [], maintenant: MERCREDI, vigueur: new Map() });
    const t = await tache(fil.cle);
    assert.equal(lecture.versVue(t).aClient, false);
    await assert.rejects(
      () => avecActeur(LUCAS, () => reponses.repondreTache(t.id, { reponse: "PAS_A_FAIRE", raison: "CLIENT_PERDU", motifPerte: "PRIX" }, MERCREDI)),
      (e: Error & { status?: number }) => e.status === 400 && /aucun client/.test(e.message)
    );
    assert.equal((await tache(fil.cle)).statut, "A_FAIRE");

    for (let i = 0; i < 3; i++) {
      const det = detectionDe({ cle: `VALIDER:proposition:essai-${unique()}`, type: "VALIDER", source: "PROPOSITIONS" });
      await moteur.reconcilier([det], { sources: [], maintenant: MERCREDI, vigueur: new Map() });
      const r = await avecActeur(LUCAS, async () => reponses.repondreTache((await tache(det.cle)).id, { reponse: "PAS_A_FAIRE", raison: "PAS_PERTINENT" }, plus(MERCREDI, i * MIN)));
      assert.equal(r.regle, null, `validation ${i} : aucune règle`);
    }
  });

  test("la même action reposée par Lucas après un geste du client tient de nouveau le dossier (sans geste : rien de neuf)", async () => {
    await toutRetirer();
    const d = await unDossier("Repose Essai");
    const texte = "J'attends sa modification visuelle";
    await avecActeur(LUCAS, () => dossiers.modifierDossier(d.id, { prochaineAction: texte, prochaineActionDate: "2026-10-07" }));
    const futur = new Date(Date.now() + H);
    assert.equal((await vigueur.actionsManuellesEnVigueur(futur, [d.id])).has(d.id), true);
    const posee = (await prisma.dossier.findUniqueOrThrow({ where: { id: d.id } })).prochaineActionManuelleLe!;
    // Même texte, autre date, sans geste du client : rien de neuf (pas d'événement de plus).
    await avecActeur(LUCAS, () => dossiers.modifierDossier(d.id, { prochaineAction: texte, prochaineActionDate: "2026-10-08" }));
    assert.equal((await prisma.dossier.findUniqueOrThrow({ where: { id: d.id } })).prochaineActionManuelleLe?.getTime(), posee.getTime());
    // Le client écrit : la vigueur tombe ; Lucas repose la même action : elle tient de nouveau.
    await prisma.dossierEvenement.create({ data: { dossierId: d.id, type: "ESPACE_MESSAGE", direction: "ENTRANT", contenu: "Voici ma réponse", createdAt: new Date(posee.getTime() + 1_000) } });
    assert.equal((await vigueur.actionsManuellesEnVigueur(futur, [d.id])).has(d.id), false);
    await new Promise((r) => setTimeout(r, 1_100));
    await avecActeur(LUCAS, () => dossiers.modifierDossier(d.id, { prochaineAction: texte, prochaineActionDate: "2026-10-09" }));
    assert.equal((await vigueur.actionsManuellesEnVigueur(new Date(Date.now() + H), [d.id])).has(d.id), true);
    assert.equal(await prisma.dossierEvenement.count({ where: { dossierId: d.id, type: "PROCHAINE_ACTION_MANUELLE" } }), 2);
  });
});

function lireJson(texte: string): Record<string, unknown> {
  return JSON.parse(texte) as Record<string, unknown>;
}
