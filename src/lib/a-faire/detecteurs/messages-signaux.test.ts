import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { preparerBaseEssai } from "@/test/base-essai";
import { dateCourte } from "@/lib/commun/format";

preparerBaseEssai();
process.env.UPLOADS_DIR = mkdtempSync(path.join(tmpdir(), "coverswap-a-faire-signaux-"));

/**
 * Mission 17 (partie A) — les détecteurs des messages et des signaux : MAIL, ESPACE_MESSAGES, PROPOSITIONS, RELANCES,
 * SIGNAUX, passés par le moteur (detection.ts › passeComplete) ; et les signaux de l'écran Espaces, devenus une vue des
 * tâches (tâche écartée, prochaine action posée à la main). Instants fixes injectés ; noms fictifs.
 */

type SourceTache = import("../types").SourceTache;

let prisma: typeof import("@/lib/prisma").default;
let avecActeur: typeof import("@/lib/journal/contexte").avecActeur;
let detection: typeof import("../detection");
let reponses: typeof import("../reponses");
let relances: typeof import("./relances");
let vues: typeof import("@/lib/mail/vues");
let boite: typeof import("@/lib/mail/boite");
let v2: typeof import("@/lib/mail/v2");
let messages: typeof import("@/lib/espace/messages");
let liens: typeof import("@/lib/espace/liens");
let suivi: typeof import("@/lib/espace/suivi");
let validation: typeof import("@/lib/validation/service");
let main: typeof import("@/lib/dossiers/main");
let manuelle: typeof import("@/lib/dossiers/prochaine-action-manuelle");

const LUCAS = { acteur: "HUMAIN:lucas@coverswap.fr" };
/** Lundi 28/09/2026, 10 h à Paris (heure d'été). Dans le passé de l'horloge réelle : ce que les services datent eux-mêmes vient après. */
const LUNDI = new Date("2026-09-28T08:00:00.000Z");
const MIN = 60_000;
const H = 3_600_000;
const J = 86_400_000;
const plus = (base: Date, ms: number) => new Date(base.getTime() + ms);
const fetchOriginal = globalThis.fetch;

let numero = 0;
const unique = () => `${Date.now().toString(36)}${++numero}`;

async function unDossier(nom: string, donnees: Record<string, unknown> = {}) {
  return prisma.dossier.create({ data: { clientNom: nom, clientAdresse: "1 rue des Essais", clientCp: "34000", clientVille: "Montpellier", clientTelephone: `+336${String(10000000 + ++numero).slice(-8)}`, objet: "Cuisine", source: "ENTRANT", ...donnees } });
}
async function unLead(prenom: string) {
  return prisma.lead.create({ data: { prenom, nom: "Essai", telephone: `+3361${String(100000 + ++numero).padStart(7, "0")}`, ville: "Lattes", source: "META_ADS" } });
}
async function unMail(donnees: Record<string, unknown>) {
  const id = unique();
  return prisma.message.create({ data: { canal: "EMAIL", compte: "crm", identifiantCanal: `essai-${id}`, filCanal: `fil-${id}`, sens: "ENTRANT", de: "client@exemple.test", recuLe: plus(LUNDI, -2 * H), classe: "CLIENT", ...donnees } });
}
async function unDevis(dossierId: string, numeroDevis: string, donnees: Record<string, unknown> = {}) {
  const emis = plus(LUNDI, -7 * J);
  return prisma.document.create({ data: { dossierId, type: "DEVIS", numero: numeroDevis, dateEmission: emis, createdAt: emis, objet: "Cuisine", lignes: "[]", totalHt: 4200, acomptePct: 30, statut: "ENVOYE", ...donnees } });
}

const tache = (cle: string) => prisma.tacheAFaire.findUniqueOrThrow({ where: { cle } });
const toutRetirer = () => prisma.tacheAFaire.updateMany({ where: { archiveLe: null }, data: { archiveLe: new Date(), archiveMotif: "essai suivant" } });

/** Un passage des détecteurs demandés, par le moteur ; chaque source doit être couverte (un détecteur en échec fait échouer l'essai). */
async function passe(sources: SourceTache[], maintenant = LUNDI) {
  const bilan = await detection.passeComplete(maintenant, { sources });
  for (const s of bilan.sources) assert.ok(s.couverte, `source ${s.source} non couverte : ${s.erreur ?? ""}`);
  return bilan.reconciliation;
}
const executerFile = async (cle: string) => reponses.executerEffet(JSON.parse((await prisma.tache.findUniqueOrThrow({ where: { cle } })).charge));
const codes = async (dossierId: string, maintenant = LUNDI, bruts = false) => ((await suivi.listerEspaces(maintenant, {}, { signauxBruts: bruts })).find((l) => l.dossierId === dossierId)?.signaux ?? []).map((s) => s.code);

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
  relances = await import("./relances");
  vues = await import("@/lib/mail/vues");
  boite = await import("@/lib/mail/boite");
  v2 = await import("@/lib/mail/v2");
  messages = await import("@/lib/espace/messages");
  liens = await import("@/lib/espace/liens");
  suivi = await import("@/lib/espace/suivi");
  validation = await import("@/lib/validation/service");
  main = await import("@/lib/dossiers/main");
  manuelle = await import("@/lib/dossiers/prochaine-action-manuelle");
  await (await import("@/lib/base/preparation")).preparerBase();
});

after(async () => {
  globalThis.fetch = fetchOriginal;
  await prisma.$disconnect();
});

describe("MAIL : les fils « À traiter »", () => {
  test("Répondre · Nom sur le lead, Lire · Expéditeur pour l'administratif, Relancer par mail après 5 jours ; pas de doublon", async () => {
    await toutRetirer();
    const ninon = await unLead("Ninon");
    const question = await unMail({ leadId: ninon.id, objet: "Question sur le devis", recuLe: plus(LUNDI, -J) });
    const facture = await unMail({ de: "facturation@fournisseur.test", deNom: "Fournisseur Essai", classe: "ADMINISTRATIF", objet: "Facture de septembre", lu: false });
    const oscar = await unLead("Oscar");
    const fil = `fil-${unique()}`;
    await unMail({ leadId: oscar.id, filCanal: fil, objet: "Vos disponibilités", recuLe: plus(LUNDI, -10 * J) });
    const envoye = await unMail({ leadId: oscar.id, filCanal: fil, sens: "SORTANT", de: "lucas@coverswap.fr", objet: "Re: Vos disponibilités", recuLe: plus(LUNDI, -6 * J) });

    const bilan = await passe(["MAIL"]);
    assert.ok(bilan.crees >= 3);
    const repondre = await tache(`REPONDRE:lead:${ninon.id}`);
    assert.equal(repondre.type, "REPONDRE");
    assert.equal(repondre.titre, "Répondre · Ninon Essai");
    // Relecture : date absolue (un « reçu hier » réécrivait la tâche d'un passage à l'autre).
    assert.equal(repondre.raison, "« Question sur le devis » · reçu le 27/09 à 10 h");
    assert.equal(repondre.niveau, 1);
    assert.equal(repondre.leadId, ninon.id);
    assert.equal(repondre.depuis.getTime(), question.recuLe.getTime());
    assert.deepEqual(JSON.parse(repondre.raccourci), { genre: "MAIL", libelle: "Répondre", messageId: question.id, href: `/mail?mail=${question.id}&repondre=1` });
    assert.deepEqual(JSON.parse(repondre.donnees), { messageId: question.id, messageIds: [question.id] });

    const lire = await tache(`LIRE_MAIL:fil:${facture.filCanal}`);
    assert.deepEqual([lire.titre, lire.raison, lire.niveau, lire.sujetType, lire.dureeMin], ["Lire · Fournisseur Essai", "Facture de septembre", 5, "SYSTEME", 1]);

    const relance = await tache(`REPONDRE:lead:${oscar.id}`);
    assert.equal(relance.titre, "Relancer par mail · Oscar Essai");
    assert.equal(relance.raison, "« Re: Vos disponibilités » · sans réponse depuis le 22/09");
    assert.equal(relance.niveau, 2);
    assert.equal(relance.depuis.getTime(), envoye.recuLe.getTime());

    // Une détection répétée ne crée pas de doublon, et n'écrit rien.
    const avant = await prisma.tacheAFaire.count();
    const second = await passe(["MAIL"]);
    assert.deepEqual([second.crees, second.misesAJour, second.cochees], [0, 0, 0]);
    assert.equal(await prisma.tacheAFaire.count(), avant);
  });

  test("mail répondu (message sortant après l'entrant) → coché « réponse partie le … » ; mail archivé → coché", async () => {
    await toutRetirer();
    const paula = await unLead("Paula");
    const recu = await unMail({ leadId: paula.id, objet: "Rendez-vous", recuLe: plus(LUNDI, -3 * H) });
    await passe(["MAIL"]);
    assert.equal((await tache(`REPONDRE:lead:${paula.id}`)).statut, "A_FAIRE");
    await unMail({ leadId: paula.id, filCanal: recu.filCanal, sens: "SORTANT", de: "lucas@coverswap.fr", objet: "Re: Rendez-vous", recuLe: plus(LUNDI, -H) });
    await passe(["MAIL"]);
    const repondue = await tache(`REPONDRE:lead:${paula.id}`);
    assert.equal(repondue.statut, "FAITE");
    assert.equal(repondue.reponduPar, "SYSTEME:taches-a-faire");
    // Relecture : une preuve du jour se lit à l'heure (« Fait aujourd'hui »).
    assert.equal(repondue.reponseTexte, "coché par le CRM : réponse partie à 09:00");

    const quentin = await unLead("Quentin");
    const autre = await unMail({ leadId: quentin.id, objet: "Merci" });
    await passe(["MAIL"]);
    assert.equal((await tache(`REPONDRE:lead:${quentin.id}`)).statut, "A_FAIRE");
    await boite.archiverFil(autre.id);
    await passe(["MAIL"]);
    const archivee = await tache(`REPONDRE:lead:${quentin.id}`);
    assert.deepEqual([archivee.statut, archivee.reponseTexte], ["FAITE", "coché par le CRM : mail archivé"]);
  });

  test("fil reporté → « Plus tard » jusqu'au report ; revenu → de nouveau à faire, en tête", async () => {
    await toutRetirer();
    const rose = await unLead("Rose");
    const recu = await unMail({ leadId: rose.id, objet: "Question" });
    await passe(["MAIL"]);
    const cle = `REPONDRE:lead:${rose.id}`;
    assert.equal((await tache(cle)).statut, "A_FAIRE");
    const jusqua = plus(LUNDI, 2 * J);
    await v2.snoozer(recu.id, jusqua);
    await passe(["MAIL"]);
    const reportee = await tache(cle);
    assert.equal(reportee.statut, "PLUS_TARD");
    assert.equal(reportee.plusTardJusqua?.getTime(), jusqua.getTime());
    const apres = plus(jusqua, MIN);
    await passe(["MAIL"], apres);
    const revenue = await tache(cle);
    assert.equal(revenue.statut, "A_FAIRE");
    assert.equal(revenue.revenueLe?.getTime(), apres.getTime());
    assert.match(revenue.raison, /revenu du report/);
  });

  test("« Pas à faire » : le fil sort d'« À traiter » et ne revient pas ; un nouveau mail du client fait revenir la tâche", async () => {
    await toutRetirer();
    const sacha = await unLead("Sacha");
    const recu = await unMail({ leadId: sacha.id, objet: "Pour info" });
    await passe(["MAIL"]);
    const cle = `REPONDRE:lead:${sacha.id}`;
    const r = await avecActeur(LUCAS, async () => reponses.repondreTache((await tache(cle)).id, { reponse: "PAS_A_FAIRE", raison: "PAS_DE_REPONSE_A_FAIRE" }, LUNDI));
    assert.deepEqual((await executerFile(r.effet!.cle)).faits, ["fil archivé"]);
    const aTraiter = vues.filtrerVue(await vues.conversations(plus(LUNDI, H)), "A_TRAITER");
    assert.equal(aTraiter.some((l) => l.fil === recu.filCanal), false, "le fil est sorti d'« À traiter »");
    for (const quand of [plus(LUNDI, H), plus(LUNDI, J)]) {
      await passe(["MAIL"], quand);
      const t = await tache(cle);
      assert.deepEqual([t.statut, t.reponduPar], ["PAS_A_FAIRE", LUCAS.acteur], "ne revient pas tant que le client n'écrit pas");
    }
    await unMail({ leadId: sacha.id, filCanal: recu.filCanal, objet: "Re: Pour info", recuLe: plus(LUNDI, J + H) });
    await passe(["MAIL"], plus(LUNDI, J + 2 * H));
    const revenue = await tache(cle);
    assert.equal(revenue.statut, "A_FAIRE");
    assert.equal(revenue.reponse, null);
    assert.equal(revenue.raison, "« Re: Pour info » · reçu le 29/09 à 11 h");
  });
});

describe("ESPACE_MESSAGES : ce que le client écrit dans son espace", () => {
  test("Répondre · Nom par dossier ; pas de doublon ; marqué lu → coché ; répondu dans l'espace → coché « réponse partie »", async () => {
    await toutRetirer();
    const durand = await unDossier("Durand Essai");
    await prisma.messageEspace.create({ data: { dossierId: durand.id, auteur: "CLIENT", source: "MESSAGE", texte: "Pouvez-vous changer la teinte ?", createdAt: plus(LUNDI, -2 * H) } });
    await passe(["ESPACE_MESSAGES"]);
    const cle = `REPONDRE:dossier:${durand.id}`;
    const vue = await tache(cle);
    assert.deepEqual([vue.titre, vue.raison, vue.niveau, vue.source], ["Répondre · Durand Essai", "« Pouvez-vous changer la teinte ? » · le 28/09 à 8 h", 1, "ESPACE_MESSAGES"]);
    assert.deepEqual(JSON.parse(vue.raccourci), { genre: "ESPACE", libelle: "Répondre dans l'espace", dossierId: durand.id, rubrique: "messages", href: `/dossiers?dossier=${durand.id}&rubrique=messages&repondre=1` });
    assert.deepEqual(JSON.parse(vue.donnees), { espaceDossierId: durand.id });
    assert.equal((await passe(["ESPACE_MESSAGES"])).crees, 0);
    assert.equal(await prisma.tacheAFaire.count({ where: { cle } }), 1);

    await messages.marquerMessagesLus(durand.id);
    await passe(["ESPACE_MESSAGES"]);
    assert.deepEqual([(await tache(cle)).statut, (await tache(cle)).reponseTexte], ["FAITE", "coché par le CRM : message lu"]);

    const martin = await unDossier("Martin Essai");
    await liens.ouvrirEspace(martin.id);
    await prisma.messageEspace.create({ data: { dossierId: martin.id, auteur: "CLIENT", source: "MESSAGE", texte: "Quand passez-vous ?", createdAt: plus(LUNDI, -H) } });
    await passe(["ESPACE_MESSAGES"]);
    const cleMartin = `REPONDRE:dossier:${martin.id}`;
    assert.equal((await tache(cleMartin)).statut, "A_FAIRE");
    await avecActeur(LUCAS, () => messages.repondreDansLEspace(martin.id, "Bonjour, jeudi matin."));
    await passe(["ESPACE_MESSAGES"]);
    const repondue = await tache(cleMartin);
    assert.equal(repondue.statut, "FAITE");
    assert.match(repondue.reponseTexte ?? "", /^coché par le CRM : réponse partie le \d\d\/\d\d$/);
  });

  test("un message déjà répondu par un autre canal (SMS copié après lui) n'est plus une tâche, même non lu", async () => {
    await toutRetirer();
    const d = await unDossier("Canal Essai");
    await prisma.messageEspace.create({ data: { dossierId: d.id, auteur: "CLIENT", source: "MESSAGE", texte: "Merci", createdAt: plus(LUNDI, -3 * H) } });
    await prisma.dossierEvenement.create({ data: { dossierId: d.id, type: "SMS_COPIE", direction: "SORTANT", contenu: "SMS copié : « Avec plaisir »", metadata: "{}", createdAt: plus(LUNDI, -H) } });
    await passe(["ESPACE_MESSAGES"]);
    assert.equal(await prisma.tacheAFaire.count({ where: { cle: `REPONDRE:dossier:${d.id}` } }), 0);
  });
});

describe("PROPOSITIONS : ce qui attend une validation", () => {
  test("Valider · titre, niveau selon le type ; relance de devis laissée à RELANCES ; validée ailleurs → cochée ; « Fait » → validée", async () => {
    await toutRetirer();
    const d = await unDossier("Valide Essai");
    const note = (titre: string) => prisma.proposition.create({ data: { type: "NOTE_DOSSIER", titre, resume: "n", contenu: JSON.stringify({ dossierId: d.id, texte: "Coloris choisi : chêne" }), auteur: "AGENT:mail", statut: "EN_ATTENTE", dossierId: d.id, createdAt: plus(LUNDI, -H) } });
    const premiere = await note("Noter le coloris choisi par le client dans le dossier de la cuisine du rez-de-chaussée");
    const regle = await prisma.proposition.create({ data: { type: "REGLE_TRI", titre: "Toujours ranger les mails de @pub.test", resume: "r", contenu: JSON.stringify({ cible: "@pub.test", action: "RANGER", motif: "publicité", origine: "ASSISTANT" }), auteur: "ASSISTANT:claude", statut: "EN_ATTENTE" } });
    const relanceMail = await prisma.proposition.create({ data: { type: "ENVOI_MAIL", titre: "Relance du devis", resume: "r", contenu: JSON.stringify({ motif: "RELANCE_DEVIS", a: "client@exemple.test", objet: "Votre devis", texte: "Bonjour", dossierId: d.id }), auteur: "SYSTEME:relances", statut: "EN_ATTENTE", dossierId: d.id } });
    await passe(["PROPOSITIONS"]);

    const t = await tache(`VALIDER:proposition:${premiere.id}`);
    assert.equal(t.titre, "Valider · Noter le coloris choisi par le client dans le dossier de la…");
    assert.equal(t.niveau, 3);
    assert.deepEqual([t.sujetType, t.dossierId], ["DOSSIER", d.id]);
    assert.match(t.raison, /· proposée le 28\/09 à 9 h$/);
    assert.deepEqual(JSON.parse(t.raccourci), { genre: "VALIDER", libelle: "Valider", propositionId: premiere.id, dossierId: d.id, href: "/validation" });
    assert.deepEqual(JSON.parse(t.donnees), { propositionId: premiere.id, sensible: false });
    const r = await tache(`VALIDER:proposition:${regle.id}`);
    assert.deepEqual([r.niveau, r.sujetType], [5, "SYSTEME"]);
    assert.equal(await prisma.tacheAFaire.count({ where: { cle: `VALIDER:proposition:${relanceMail.id}` } }), 0, "la relance est portée par RELANCES");

    // Validée ailleurs (écran À valider) : cochée par le CRM.
    await avecActeur(LUCAS, () => validation.validerProposition(premiere.id));
    await passe(["PROPOSITIONS"]);
    assert.deepEqual([(await tache(t.cle)).statut, (await tache(t.cle)).reponseTexte], ["FAITE", "coché par le CRM : proposition validée"]);

    // « Fait » dans Tâches sur une proposition non sensible : elle est validée (et exécutée).
    const seconde = await note("Noter la teinte");
    await passe(["PROPOSITIONS"]);
    const fait = await avecActeur(LUCAS, async () => reponses.repondreTache((await tache(`VALIDER:proposition:${seconde.id}`)).id, { reponse: "FAIT" }, LUNDI));
    assert.deepEqual((await executerFile(fait.effet!.cle)).faits, ["proposition validée et exécutée"]);
    assert.equal((await prisma.proposition.findUniqueOrThrow({ where: { id: seconde.id } })).statut, "EXECUTEE");
  });

  test("relecture : une proposition SENSIBLE n'a pas « Valider » dans la ligne — « Relire et valider » ouvre l'aperçu (mail) ou la page de validation", async () => {
    await toutRetirer();
    const d = await unDossier("Sensible Essai");
    const mail = await prisma.proposition.create({ data: { type: "ENVOI_MAIL", titre: "Répondre au client", resume: "r", contenu: JSON.stringify({ motif: "REPONSE", a: "client@exemple.test", objet: "Votre projet", texte: "Bonjour", dossierId: d.id }), auteur: "AGENT:mail", statut: "EN_ATTENTE", dossierId: d.id } });
    const inconnue = await prisma.proposition.create({ data: { type: "TYPE_INCONNU_ESSAI", titre: "Quelque chose de neuf", resume: "r", contenu: "{}", auteur: "AGENT:mail", statut: "EN_ATTENTE" } });
    await passe(["PROPOSITIONS"]);
    const tMail = await tache(`VALIDER:proposition:${mail.id}`);
    assert.equal(JSON.parse(tMail.donnees).sensible, true);
    assert.deepEqual(JSON.parse(tMail.raccourci), { genre: "RELANCE_MAIL", libelle: "Relire et valider", propositionId: mail.id, dossierId: d.id });
    const tAutre = await tache(`VALIDER:proposition:${inconnue.id}`);
    assert.deepEqual(JSON.parse(tAutre.raccourci), { genre: "PAGE", libelle: "Relire et valider", propositionId: inconnue.id, dossierId: null, href: `/validation?proposition=${inconnue.id}` });
    // Le serveur refuse toujours « Fait » sur une validation sensible (elle passe par son aperçu).
    await assert.rejects(() => avecActeur(LUCAS, () => reponses.repondreTache(tMail.id, { reponse: "FAIT" }, LUNDI)), (e: Error & { status?: number }) => e.status === 409);
    await prisma.proposition.updateMany({ where: { id: { in: [mail.id, inconnue.id] } }, data: { statut: "ANNULEE" } });
  });
});

describe("RELANCES : devis et photos", () => {
  test("Relancer le devis · Nom (SMS à copier, puis aperçu du mail quand il attend) ; Relancer pour les photos · Nom", async () => {
    await toutRetirer();
    const d = await unDossier("Relance Essai", { etape: "DEVIS_ENVOYE" });
    const devis = await unDevis(d.id, "2026-901");
    await passe(["RELANCES"]);
    const cle = `RELANCER_DEVIS:dossier:${d.id}`;
    const t = await tache(cle);
    assert.deepEqual([t.titre, t.raison, t.niveau, t.montant, t.dureeMin], ["Relancer le devis · Relance Essai", `devis 2026-901 envoyé le ${dateCourte(devis.dateEmission!).slice(0, 5)}, 1re relance`, 2, 4200, 2]);
    const raccourci = JSON.parse(t.raccourci);
    assert.equal(raccourci.genre, "SMS");
    assert.deepEqual(raccourci.sms, { action: "RELANCE_DEVIS", dossierId: d.id, relance: { documentId: devis.id, rang: 1 } });
    // Relecture : le SMS n'est plus préparé à chaque passage (l'écran SMS et « taches » le préparent) ; l'occurrence du besoin
    // est le devis et le rang de la relance.
    assert.equal(JSON.parse(t.donnees).texteSms, undefined);
    assert.equal(JSON.parse(t.donnees).occurrence, `${devis.id}:1`);

    const mail = await prisma.proposition.create({ data: { type: "ENVOI_MAIL", titre: "Relance", resume: "r", contenu: JSON.stringify({ motif: "RELANCE_DEVIS", documentIds: [devis.id], a: "client@exemple.test", objet: "Votre devis", texte: "Bonjour" }), auteur: "SYSTEME:relances", statut: "EN_ATTENTE", dossierId: d.id, cleUnicite: `relance:${devis.id}:1` } });
    await passe(["RELANCES", "PROPOSITIONS"]);
    const avecMail = await tache(cle);
    assert.deepEqual(JSON.parse(avecMail.raccourci), { genre: "RELANCE_MAIL", libelle: "Relire le mail de relance", propositionId: mail.id, dossierId: d.id });
    assert.equal(JSON.parse(avecMail.donnees).propositionId, mail.id);
    assert.equal(await prisma.tacheAFaire.count({ where: { cle: `VALIDER:proposition:${mail.id}` } }), 0);

    const photos = await unDossier("Photos Essai");
    const { espace } = await liens.ouvrirEspace(photos.id);
    await prisma.espaceClient.update({ where: { id: espace.id }, data: { createdAt: plus(LUNDI, -5 * J) } });
    await passe(["RELANCES"]);
    const p = await tache(`RELANCER_PHOTOS:dossier:${photos.id}`);
    assert.deepEqual([p.titre, p.raison, p.niveau], ["Relancer pour les photos · Photos Essai", `espace ouvert le ${dateCourte(plus(LUNDI, -5 * J)).slice(0, 5)}, sans photo, 1re relance`, 3]);
    assert.deepEqual(JSON.parse(p.raccourci).sms, { action: "RELANCE_PHOTOS", dossierId: photos.id, relance: { type: "PHOTOS", rang: 1 } });
  });

  test("le détecteur n'écrit rien, même sur un espace d'avant l'espace permanent d'un dossier sans fiche client", async () => {
    const ancien = await unDossier("Ancien Essai");
    await prisma.espaceClient.create({ data: { code: `anc${unique()}`.slice(0, 12), dossierId: ancien.id, expireLe: plus(LUNDI, 60 * J), createdAt: plus(LUNDI, -6 * J) } });
    const compter = async () => [await prisma.client.count(), await prisma.espacePermanent.count(), await prisma.dossierEvenement.count(), (await prisma.espaceClient.findUniqueOrThrow({ where: { dossierId: ancien.id } })).permanentId];
    const avant = await compter();
    const detections = await relances.detecteurRelances.detecter({ maintenant: LUNDI, vigueur: new Map() });
    assert.ok(detections.some((v) => v.cle === `RELANCER_PHOTOS:dossier:${ancien.id}`));
    assert.deepEqual(await compter(), avant);
    assert.equal((await prisma.dossier.findUniqueOrThrow({ where: { id: ancien.id } })).clientId, null);
  });
});

describe("SIGNAUX : les signaux des espaces clients", () => {
  let lien: { id: string; clientId: string };
  let hesite: { id: string };

  test("chaque signal rend sa tâche ; deux signaux de même clé n'en font qu'une ; pas de doublon", async () => {
    await toutRetirer();
    const d = await unDossier("Lien Essai");
    const { espace, permanent } = await liens.ouvrirEspace(d.id);
    lien = { id: d.id, clientId: permanent.clientId };
    await prisma.simulationEspace.create({ data: { espaceId: espace.id, dossierId: d.id, chemin: "essai.jpg", statut: "BROUILLON", source: "API" } });
    await prisma.espacePermanent.update({ where: { id: permanent.id }, data: { projetDemandeLe: plus(LUNDI, -J) } });

    const signe = await unDossier("Accord Essai");
    await liens.ouvrirEspace(signe.id);
    const devisSigne = await unDevis(signe.id, "2026-902");
    await prisma.accordDevis.create({ data: { dossierId: signe.id, documentId: devisSigne.id, numeroDevis: "2026-902", totalHt: 4200, nomSignataire: "Accord Essai", mention: "Bon pour accord", createdAt: plus(LUNDI, -2 * J) } });

    const demande = await unDossier("Demande Essai");
    const ouvert = await liens.ouvrirEspace(demande.id);
    await prisma.espaceClient.update({ where: { id: ouvert.espace.id }, data: { propositionDemandeeLe: plus(LUNDI, -J), propositionMessage: "Plus clair, svp", simulationsDemandeesLe: plus(LUNDI, -2 * J) } });

    const relu = await unDossier("Hesite Essai");
    hesite = { id: relu.id };
    await liens.ouvrirEspace(relu.id);
    await unDevis(relu.id, "2026-903", { consultations: 4, consulteLe: plus(LUNDI, -3 * H) });

    await passe(["SIGNAUX"]);
    const envoyer = await tache(`ENVOYER_LIEN:dossier:${d.id}`);
    assert.deepEqual([envoyer.titre, envoyer.raison, envoyer.niveau], ["Envoyer le lien · Lien Essai", "lien pas encore envoyé", 3]);
    assert.deepEqual(JSON.parse(envoyer.raccourci).sms, { action: "ENVOYER_LIEN", dossierId: d.id });
    const publier = await tache(`PUBLIER:dossier:${d.id}`);
    assert.deepEqual([publier.titre, publier.raison, publier.niveau], ["Publier la simulation · Lien Essai", "1 brouillon à publier", 3]);
    const projet = await tache(`DEMANDE_CLIENT:client:${permanent.clientId}`);
    assert.deepEqual([projet.titre, projet.niveau, projet.sujetType], ["Ouvrir un nouveau projet · Lien Essai", 1, "CLIENT"]);

    const date = await tache(`DATE_CHANTIER:dossier:${signe.id}`);
    assert.deepEqual([date.titre, date.raison, date.niveau, date.source], ["Fixer la date du chantier · Accord Essai", "accord donné le 26/09, date à fixer", 1, "SIGNAUX"]);
    assert.equal(JSON.parse(date.raccourci).genre, "PLANIFIER");

    const autre = await tache(`DEMANDE_CLIENT:dossier:${demande.id}`);
    assert.equal(autre.titre, "Préparer une autre proposition · Demande Essai");
    assert.equal(autre.raison, "autre proposition demandée : « Plus clair, svp » ; demande d'autres simulations (0 faite)");
    assert.equal(autre.depuis.getTime(), plus(LUNDI, -2 * J).getTime());
    assert.deepEqual(JSON.parse(autre.donnees), { signaux: ["PROPOSITION_DEMANDEE", "SIMULATIONS_DEMANDEES"] });

    const appel = await tache(`HESITE:dossier:${relu.id}`);
    assert.deepEqual([appel.titre, appel.raison, appel.niveau], ["Appeler · Hesite Essai", "devis relu 4 fois sans signer", 2]);
    assert.equal(JSON.parse(appel.raccourci).genre, "APPEL");

    assert.deepEqual([(await passe(["SIGNAUX"])).crees, (await passe(["SIGNAUX"])).misesAJour], [0, 0]);
  });

  test("vue des espaces : une tâche écartée masque son signal (les signaux bruts le gardent) ; « Plus tard » jusqu'à sa date ou au geste du client", async () => {
    assert.ok(lien && hesite, "l'essai précédent a posé les dossiers");
    const envoyer = await tache(`ENVOYER_LIEN:dossier:${lien.id}`);
    await avecActeur(LUCAS, () => reponses.repondreTache(envoyer.id, { reponse: "PAS_A_FAIRE", raison: "PAS_PERTINENT" }, LUNDI));
    assert.equal((await codes(lien.id)).includes("NON_ENVOYE"), false);
    assert.equal((await codes(lien.id, LUNDI, true)).includes("NON_ENVOYE"), true);
    assert.equal((await codes(lien.id)).includes("BROUILLONS"), true, "les autres signaux restent");
    await passe(["SIGNAUX"]);
    assert.equal((await tache(envoyer.cle)).statut, "PAS_A_FAIRE", "le détecteur la voit encore : elle n'est ni cochée ni rouverte");

    // Le signal du client : « projet de plus demandé » écarté → masqué, et l'attente ne le dit plus.
    const projet = await tache(`DEMANDE_CLIENT:client:${lien.clientId}`);
    const client = async () => (await suivi.listerClientsEspaces(LUNDI)).find((c) => c.clientId === lien.clientId)!;
    assert.equal((await client()).attente.libelle, "Accorder un projet de plus, ou l'appeler");
    await avecActeur(LUCAS, () => reponses.repondreTache(projet.id, { reponse: "PAS_A_FAIRE", raison: "DEJA_FAIT" }, LUNDI));
    const apres = await client();
    assert.equal(apres.signaux.some((s) => s.code === "PROJET_DEMANDE"), false);
    assert.notEqual(apres.attente.libelle, "Accorder un projet de plus, ou l'appeler");

    // « Plus tard » : masqué jusqu'à sa date ; un geste du client le fait revenir sans attendre.
    const appel = await tache(`HESITE:dossier:${hesite.id}`);
    await avecActeur(LUCAS, () => reponses.repondreTache(appel.id, { reponse: "PLUS_TARD", quand: "DEMAIN" }, LUNDI));
    assert.equal((await codes(hesite.id)).includes("HESITE"), false);
    assert.equal((await codes(hesite.id, plus(LUNDI, 2 * J))).includes("HESITE"), true, "« Plus tard » échu : le signal revient");
    await prisma.dossierEvenement.create({ data: { dossierId: hesite.id, type: "ESPACE_MESSAGE", direction: "ENTRANT", contenu: "Message du client depuis son espace : « Une question »", metadata: "{}", createdAt: plus(LUNDI, H) } });
    assert.equal((await codes(hesite.id, plus(LUNDI, 2 * H))).includes("HESITE"), true, "le client s'est manifesté : le signal revient");
  });

  test("prochaine action posée à la main (« j'attends sa modification visuelle ») : plus de « Répondre à … », plus de date à fixer rouge, aucune tâche ; le client écrit → tout revient", async () => {
    await toutRetirer();
    const d = await unDossier("Attente Essai");
    await liens.ouvrirEspace(d.id);
    const devis = await unDevis(d.id, "2026-904");
    await prisma.accordDevis.create({ data: { dossierId: d.id, documentId: devis.id, numeroDevis: "2026-904", totalHt: 4200, nomSignataire: "Attente Essai", mention: "Bon pour accord", createdAt: plus(LUNDI, -2 * J) } });
    await prisma.dossierEvenement.create({ data: { dossierId: d.id, type: "ESPACE_MESSAGE", direction: "ENTRANT", contenu: "Message du client depuis son espace : « Je vous envoie une photo »", metadata: "{}", createdAt: plus(LUNDI, -H) } });
    await main.recalculerMain(d.id);
    const avant = (await suivi.listerEspaces(LUNDI)).find((l) => l.dossierId === d.id)!;
    assert.equal(avant.attente.libelle, "Répondre à Attente Essai");
    assert.ok(avant.signaux.some((s) => s.code === "DATE_A_FIXER"));

    const action = "J'attends sa modification visuelle";
    await prisma.dossier.update({ where: { id: d.id }, data: { prochaineAction: action } });
    assert.equal(await avecActeur(LUCAS, () => manuelle.noterProchaineActionManuelle(d.id, { action, avant: null, date: null }, LUNDI)), true);
    const pendant = (await suivi.listerEspaces(LUNDI)).find((l) => l.dossierId === d.id)!;
    assert.deepEqual(pendant.attente, { qui: "CLIENT", libelle: action });
    assert.deepEqual(pendant.signaux.filter((s) => s.ton !== "gris"), [], "aucun signal rouge ni ambre");
    assert.ok((await codes(d.id, LUNDI, true)).includes("DATE_A_FIXER"), "les signaux bruts le voient toujours");
    await passe(["SIGNAUX"]);
    assert.equal(await prisma.tacheAFaire.count({ where: { dossierId: d.id, statut: "A_FAIRE" } }), 0, "aucune tâche sur ce dossier");

    await prisma.dossierEvenement.create({ data: { dossierId: d.id, type: "ESPACE_MESSAGE", direction: "ENTRANT", contenu: "Message du client depuis son espace : « Voilà ma photo »", metadata: "{}", createdAt: plus(LUNDI, H) } });
    const ensuite = plus(LUNDI, 2 * H);
    assert.ok((await codes(d.id, ensuite)).includes("DATE_A_FIXER"), "le client a écrit : la prochaine action n'est plus en vigueur");
    await passe(["SIGNAUX"], ensuite);
    assert.equal((await tache(`DATE_CHANTIER:dossier:${d.id}`)).statut, "A_FAIRE");
  });
});
