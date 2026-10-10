import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { NextRequest } from "next/server";
import { preparerBaseEssai } from "@/test/base-essai";

preparerBaseEssai();
process.env.UPLOADS_DIR = mkdtempSync(path.join(tmpdir(), "coverswap-m18-a4-"));

/**
 * Mission 18 (A4) — un seul système de relance. Les quatre séquences de mails (désactivées) sont retirées du code et des
 * interrupteurs (leurs lignes restent en base) ; la désinscription reste, dans son module. La demande d'avis après
 * chantier et la réactivation à 6 mois deviennent des types de relance proposables : un SMS à copier, une fois chacune,
 * dans la feuille Relances, les tâches de Lucas et « lister » RELANCES ; la copie les compte (« noter_sms » aussi). La
 * réactivation exige l'accord aux messages commerciaux et aucune désinscription. `fetch` est remplacé : une requête
 * réseau fait échouer le test. Rien ne part (canaux vidés par `preparerBaseEssai`). Noms fictifs.
 */

let prisma: typeof import("@/lib/prisma").default;
let avis: typeof import("@/lib/relances/avis");
let reactivation: typeof import("@/lib/relances/reactivation");
let proposables: typeof import("@/lib/relances/proposables");
let copie: typeof import("@/lib/sms/copie");
let proposition: typeof import("@/lib/sms/proposition");
let liens: typeof import("@/lib/espace/liens");
let detection: typeof import("@/lib/a-faire/detection");
let achevement: typeof import("@/lib/a-faire/achevement");
let interrupteurs: typeof import("@/lib/automatismes/interrupteurs");
let parametres: typeof import("@/lib/parametres/service");
let catalogue: typeof import("@/lib/assistant/catalogue");
let execution: typeof import("@/lib/assistant/execution");
let session: import("@/lib/assistant/execution").Session;

const fetchOrigine = globalThis.fetch;
const RACINE = path.resolve(__dirname, "..", "..", "..");
const JOUR = 86_400_000;
const ilYa = (jours: number) => new Date(Date.now() - jours * JOUR);

let numero = 0;
const telephone = () => `+3361418${String(++numero).padStart(4, "0")}`;

/** Un chantier fini : client, dossier « Facturé » et son espace ; le passage en Facturé daté il y a `jours` jours. */
async function chantierFini(nom: string, jours: number, passage: { de?: string | null; nature?: string } = {}) {
  const client = await prisma.client.create({ data: { nom, prenom: nom.split(" ")[0], source: "ENTRANT", premierContactLe: ilYa(90) } });
  const dossier = await prisma.dossier.create({
    data: { clientNom: nom, clientAdresse: "5 rue des Essais", clientCp: "34000", clientVille: "Montpellier", clientTelephone: telephone(), objet: "Recouvrement de cuisine", source: "ENTRANT", etape: "FACTURE", clientId: client.id },
  });
  const { espace } = await liens.ouvrirEspace(dossier.id);
  const metadata = { de: passage.de === undefined ? "CHANTIER" : passage.de, vers: "FACTURE", nature: passage.nature ?? "SUIVANTE" };
  await prisma.dossierEvenement.create({ data: { dossierId: dossier.id, type: "CHANGEMENT_ETAPE", direction: "INTERNE", contenu: "Chantier → Facturé", metadata: JSON.stringify(metadata), createdAt: ilYa(jours) } });
  return { dossierId: dossier.id, espaceId: espace.id, clientId: client.id, telephone: dossier.clientTelephone };
}

/** Un contact perdu (« sans suite ») il y a `jours` jours (null : sans date), avec sa fiche client et son adresse. */
async function contactPerdu(prenom: string, jours: number | null, options: { accord?: boolean; clientId?: string } = {}) {
  const email = `${prenom.toLowerCase()}.${++numero}@exemple.fr`;
  const clientId =
    options.clientId ?? (await prisma.client.create({ data: { nom: `${prenom} Perdu`, prenom, source: "ENTRANT", premierContactLe: ilYa(400) } })).id;
  await prisma.clientEmail.create({ data: { clientId, adresse: email, principale: !options.clientId } });
  if (options.accord) await prisma.consentementMail.create({ data: { clientId, statut: "ACCORDE", moyen: "FORMULAIRE_SITE", recueilliLe: ilYa(300), preuve: "case cochée (essai)" } });
  const lead = await prisma.lead.create({ data: { prenom, nom: "Perdu", email, telephone: telephone(), ville: "Lattes", source: "SITE_WEB", statut: "PERDU", clientId, perteLe: jours === null ? null : ilYa(jours) } });
  return { leadId: lead.id, clientId, email, telephone: lead.telephone };
}

const avisDe = async (dossierId: string) => (await avis.relancesAvisProposables()).find((a) => a.dossierId === dossierId);
const reactivationDe = async (leadId: string) => (await reactivation.relancesReactivationProposables()).find((r) => r.leadId === leadId);
const tache = (cle: string) => prisma.tacheAFaire.findUniqueOrThrow({ where: { cle } });

async function passeRelances() {
  const bilan = await detection.passeComplete(new Date(), { sources: ["RELANCES"] });
  for (const s of bilan.sources) assert.ok(s.couverte, `source ${s.source} non couverte : ${s.erreur ?? ""}`);
}

async function appeler(nom: string, entree: Record<string, unknown>) {
  const outil = catalogue.outilParNom(nom);
  assert.ok(outil, `outil inconnu : ${nom}`);
  return execution.executerOutil(outil, entree, session);
}

/** Les fichiers .ts et .tsx de `src`, essais exclus. */
function sources(dossier = path.join(RACINE, "src")): string[] {
  return readdirSync(dossier).flatMap((nom) => {
    const chemin = path.join(dossier, nom);
    if (statSync(chemin).isDirectory()) return sources(chemin);
    return /\.tsx?$/.test(nom) && !/\.test\.ts$/.test(nom) ? [chemin] : [];
  });
}

before(async () => {
  process.env.NEXTAUTH_SECRET = "secret-de-session-pour-les-essais";
  process.env.ESPACE_CLIENT_SECRET = "secret-espace-des-essais";
  process.env.SITE_URL = "https://coverswap.fr";
  process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3001";
  process.env.TACHES_DESACTIVEES = "1";
  for (const cle of ["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID", "NTFY_TOPIC", "RESEND_API_KEY"]) process.env[cle] = ""; // vide, pas supprimée : Prisma reprendrait la valeur de .env
  globalThis.fetch = (async (url: unknown) => {
    throw new Error(`Aucune requête réseau dans les essais (${String(url)})`);
  }) as typeof fetch;
  prisma = (await import("@/lib/prisma")).default;
  avis = await import("@/lib/relances/avis");
  reactivation = await import("@/lib/relances/reactivation");
  proposables = await import("@/lib/relances/proposables");
  copie = await import("@/lib/sms/copie");
  proposition = await import("@/lib/sms/proposition");
  liens = await import("@/lib/espace/liens");
  detection = await import("@/lib/a-faire/detection");
  achevement = await import("@/lib/a-faire/achevement");
  interrupteurs = await import("@/lib/automatismes/interrupteurs");
  parametres = await import("@/lib/parametres/service");
  catalogue = await import("@/lib/assistant/catalogue");
  execution = await import("@/lib/assistant/execution");
  await (await import("@/lib/base/preparation")).preparerBase();
  session = await execution.ouvrirSession({ jetonId: null, clientNom: "essai", utilisateur: "essai" });
});

after(async () => {
  globalThis.fetch = fetchOrigine;
  await prisma.$disconnect();
});

describe("plus de séquences de mails : un seul système de relance", () => {
  test("les automatismes n'ont plus de séquence (aucune ligne SequenceMail créée) ; un code SEQUENCE_ est inconnu ; plus de travail « sequences-mail »", async () => {
    const liste = await interrupteurs.listerAutomatismes();
    assert.ok(liste.length > 0);
    assert.equal(liste.filter((a) => a.code.startsWith("SEQUENCE_") || (a.famille as string) === "SEQUENCE").length, 0);
    assert.equal(await prisma.sequenceMail.count(), 0, "lister les automatismes ne crée plus les séquences");
    await assert.rejects(interrupteurs.reglerAutomatisme("SEQUENCE_AVIS", true, "HUMAIN:essai"), /Automatisme inconnu/);
    assert.equal(await prisma.sequenceMail.count(), 0);

    const { enregistrerTousLesTraitements } = await import("@/lib/taches/traitements");
    const { travauxPeriodiques } = await import("@/lib/taches/registre");
    enregistrerTousLesTraitements();
    const noms = travauxPeriodiques().map((t) => t.nom);
    assert.ok(noms.includes("propositions-relances"), "le système de relance des devis tourne toujours");
    assert.equal(noms.includes("sequences-mail"), false);
  });

  test("le code des séquences est retiré (modèles Prisma gardés) ; MAIL_EXPEDITEUR n'est plus un paramètre, une ancienne ligne en base est ignorée", async () => {
    assert.equal(existsSync(path.join(RACINE, "src", "lib", "mail", "sequences.ts")), false);
    const coupables = sources().filter((f) => /mail\/sequences|listerSequences|avancerSequences|assurerSequences|sequenceMail\.|inscriptionSequence\.(create|update)/.test(readFileSync(f, "utf8")));
    assert.deepEqual(coupables.map((f) => path.relative(RACINE, f)), []);
    const schema = readFileSync(path.join(RACINE, "prisma", "schema.prisma"), "utf8");
    for (const modele of ["SequenceMail", "EtapeSequence", "InscriptionSequence", "Desinscription"]) assert.match(schema, new RegExp(`^model ${modele} \\{`, "m"), `${modele} gardé (db push au démarrage)`);

    const { DEFINITIONS_PARAMETRES } = await import("@/lib/parametres/definitions");
    assert.equal("MAIL_EXPEDITEUR" in DEFINITIONS_PARAMETRES, false);
    assert.equal(DEFINITIONS_PARAMETRES.DELAI_RELANCE_AVIS.groupe, "COMMERCIAL");
    await prisma.parametre.create({ data: { cle: "MAIL_EXPEDITEUR", valeur: JSON.stringify("ancienne@exemple.fr"), valableDu: ilYa(30) } });
    const ecran = await parametres.parametresPourEcran();
    assert.equal(ecran.some((p) => (p.cle as string) === "MAIL_EXPEDITEUR"), false);
    assert.ok(ecran.some((p) => p.cle === "DELAI_RELANCE_AVIS"));
    const { NATURES_ENVOI } = await import("@/lib/mail/envoi-crm");
    assert.ok((NATURES_ENVOI as readonly string[]).includes("SEQUENCE"), "les anciennes lignes EnvoiMail se relisent");
  });

  test("la désinscription reste : POST /api/site/desinscription (page du site) l'enregistre, définitive", async () => {
    const { lienDesinscription } = await import("@/lib/mail/desinscription");
    const lien = new URL(lienDesinscription("Lou.Desinscrite@exemple.fr"));
    const { POST } = await import("@/app/api/site/desinscription/route");
    const reponse = await POST(new NextRequest("http://localhost/api/site/desinscription", { method: "POST", body: JSON.stringify({ e: lien.searchParams.get("e"), j: lien.searchParams.get("j") }), headers: { "content-type": "application/json", origin: "https://coverswap.fr" } }));
    assert.equal(reponse.status, 200);
    assert.equal((await prisma.desinscription.findUniqueOrThrow({ where: { adresse: "lou.desinscrite@exemple.fr" } })).source, "LIEN");
  });
});

describe("demande d'avis après chantier : un type de relance", () => {
  test("DELAI_RELANCE_AVIS jours (7) après la fin du chantier, jusqu'à 60 jours : SMS DEMANDE_AVIS avec le lien de l'espace (#apres) ; copié → compté, plus proposé (une fois), l'étape ne bouge pas", async () => {
    const tot = await chantierFini("Avistot Essai", 3);
    const pret = await chantierFini("Avispret Essai", 8);
    const vieux = await chantierFini("Avisvieux Essai", 61);
    assert.equal(await avisDe(tot.dossierId), undefined, "le délai n'est pas écoulé");
    assert.equal(await avisDe(vieux.dossierId), undefined, "au-delà de 60 jours, on ne demande plus");
    const a = await avisDe(pret.dossierId);
    assert.ok(a);
    assert.deepEqual([a.rang, a.relancesFaites, a.mailParti, a.joursDepuisFin, a.espaceId], [1, 0, false, 8, pret.espaceId]);
    assert.equal(a.sms?.code, "DEMANDE_AVIS");
    assert.match(a.sms!.texte, /^Bonjour Avispret, merci encore pour votre confiance\. Si le résultat vous plaît, votre avis nous aide beaucoup : il se donne en un clic depuis votre espace : https:\/\/coverswap\.fr\/e\/[A-Za-z0-9_-]+#apres$/);
    assert.deepEqual(a.sms?.relance, { type: "AVIS", rang: 1 });

    const note = await copie.noterSmsCopie({ code: a.sms!.code, texte: a.sms!.texte, dossierId: pret.dossierId, relance: a.sms!.relance, origine: "ECRAN" });
    assert.deepEqual([note.cible, note.lien], ["DOSSIER", true]);
    const trace = await prisma.dossierEvenement.findUniqueOrThrow({ where: { id: note.id } });
    assert.deepEqual(JSON.parse(trace.metadata).relance, { type: "AVIS", rang: 1 });
    assert.equal((await prisma.dossier.findUniqueOrThrow({ where: { id: pret.dossierId } })).etape, "FACTURE", "une demande d'avis n'est pas une relance de devis");
    assert.equal(await avisDe(pret.dossierId), undefined, "une seule demande");
  });

  test("la fin du chantier : le mail « projet terminé » parti d'abord, sinon le passage en Facturé depuis une étape en cours (ni retour, ni reprise) ; ni avis donné, ni STOP, ni espace désactivé", async () => {
    const mail = await chantierFini("Avismail Essai", 20);
    const envoi = await prisma.envoiMail.create({ data: { cle: `notif:PROJET_TERMINE:${mail.dossierId}`, nature: "NOTIFICATION", modele: "PROJET_TERMINE", statut: "ENVOYE", a: "avismail@exemple.fr", objet: "Votre chantier est terminé : merci !", texte: "…", dossierId: mail.dossierId, envoyeLe: ilYa(2) } });
    assert.equal(await avisDe(mail.dossierId), undefined, "le mail est parti il y a 2 jours : le délai court depuis lui");
    await prisma.envoiMail.update({ where: { id: envoi.id }, data: { envoyeLe: ilYa(9) } });
    assert.deepEqual([(await avisDe(mail.dossierId))?.mailParti, (await avisDe(mail.dossierId))?.joursDepuisFin], [true, 9]);

    const reprise = await chantierFini("Avisreprise Essai", 10, { nature: "REPRISE" });
    const ouverture = await chantierFini("Avisouverture Essai", 10, { de: null });
    assert.equal(await avisDe(reprise.dossierId), undefined, "un dossier repris déjà fini");
    assert.equal(await avisDe(ouverture.dossierId), undefined, "un dossier ouvert directement en Facturé");

    const donne = await chantierFini("Avisdonne Essai", 10);
    await prisma.espaceClient.update({ where: { id: donne.espaceId }, data: { avisLe: ilYa(1), avis: JSON.stringify({ note: 5 }) } });
    const stop = await chantierFini("Avisstop Essai", 10);
    await prisma.conversationSms.create({ data: { numero: stop.telephone, stopLe: ilYa(1), stopTexte: "STOP" } });
    const ferme = await chantierFini("Avisferme Essai", 10);
    await prisma.espaceClient.update({ where: { id: ferme.espaceId }, data: { revoqueLe: ilYa(1) } });
    for (const d of [donne, stop, ferme]) assert.equal(await avisDe(d.dossierId), undefined);
  });

  test("une tâche « Demander un avis · Nom » (niveau 3, SMS) ; copiée → cochée « SMS de demande d'avis copié » ; un SMS d'avis ne coche ni la relance d'un devis ni celle des photos", async () => {
    const d = await chantierFini("Avistache Essai", 9);
    await passeRelances();
    const cle = `RELANCER_AVIS:dossier:${d.dossierId}`;
    const t = await tache(cle);
    assert.deepEqual([t.titre, t.niveau, t.source, t.dureeMin, t.statut], ["Demander un avis · Avistache Essai", 3, "RELANCES", 1, "A_FAIRE"]);
    assert.match(t.raison, /^chantier terminé le \d{2}\/\d{2}, pas encore d'avis$/);
    assert.deepEqual(JSON.parse(t.raccourci).sms, { action: "RELANCE_AVIS", dossierId: d.dossierId, relance: { type: "AVIS", rang: 1 } });

    // L'écran SMS demande le SMS (action + relance), puis le copie tel quel.
    const sms = await proposition.proposerSms({ action: "RELANCE_AVIS", dossierId: d.dossierId, relance: { type: "AVIS", rang: 1 } });
    await copie.noterSmsCopie({ code: sms.code, texte: sms.texte, dossierId: d.dossierId, relance: sms.relance, origine: "ECRAN" });
    // Les autres relances d'un même dossier, lues par la coche du CRM : un SMS d'avis n'en fait aucune.
    const fausse = (type: string) => ({ id: "essai", type, leadId: null, dossierId: d.dossierId, clientId: null, depuis: ilYa(1), raccourci: "{}", donnees: "{}", source: "RELANCES" }) as Parameters<typeof achevement.issueDeLAbsence>[0];
    assert.equal((await achevement.issueDeLAbsence(fausse("RELANCER_DEVIS"), new Date())).texte, achevement.TEXTE_PAR_DEFAUT);
    assert.equal((await achevement.issueDeLAbsence(fausse("RELANCER_PHOTOS"), new Date())).texte, achevement.TEXTE_PAR_DEFAUT);

    await passeRelances();
    const faite = await tache(cle);
    assert.equal(faite.statut, "FAITE");
    assert.match(faite.reponseTexte ?? "", /^coché par le CRM : SMS de demande d'avis copié à \d{2}:\d{2}$/);
  });
});

describe("réactivation à 6 mois : un type de relance, avec l'accord du contact", () => {
  test("sans accord aux messages commerciaux : jamais (ni proposée, ni SMS, ni copie) ; avec l'accord en cours : SMS REACTIVATION sans lien ; un retrait ou une désinscription l'arrêtent", async () => {
    const denis = await contactPerdu("Denis", 200);
    assert.equal(await reactivationDe(denis.leadId), undefined, "sans accord : jamais");
    await assert.rejects(proposition.proposerSms({ action: "REACTIVATION", leadId: denis.leadId }), /n'a pas donné son accord aux messages commerciaux/);
    await assert.rejects(copie.noterSmsCopie({ code: "REACTIVATION", texte: "Bonjour Denis", leadId: denis.leadId, relance: { type: "REACTIVATION", rang: 1 }, origine: "ECRAN" }), /pas de réactivation/);

    await prisma.consentementMail.create({ data: { clientId: denis.clientId, statut: "ACCORDE", moyen: "ORAL", recueilliLe: ilYa(250), preuve: "accord dit au téléphone (essai)" } });
    const r = await reactivationDe(denis.leadId);
    assert.ok(r);
    assert.deepEqual([r.rang, r.joursDepuisPerte, r.nom, r.clientId], [1, 200, "Denis Perdu", denis.clientId]);
    assert.equal(r.sms?.code, "REACTIVATION");
    assert.equal(r.sms?.texte, "Bonjour Denis, où en est votre projet de rénovation ? S'il est toujours d'actualité, répondez-moi ici. STOP pour ne plus en recevoir.");
    assert.equal(r.sms?.lien, undefined);
    assert.deepEqual(r.sms?.relance, { type: "REACTIVATION", rang: 1 });

    // La déclaration la plus récente décide.
    await prisma.consentementMail.create({ data: { clientId: denis.clientId, statut: "RETIRE", moyen: "EMAIL", recueilliLe: ilYa(1) } });
    assert.equal(await reactivationDe(denis.leadId), undefined, "accord retiré");

    const emma = await contactPerdu("Emma", 200, { accord: true });
    assert.ok(await reactivationDe(emma.leadId));
    await prisma.desinscription.create({ data: { adresse: emma.email, source: "LIEN" } });
    assert.equal(await reactivationDe(emma.leadId), undefined, "désinscrite : plus jamais");
    await assert.rejects(proposition.proposerSms({ action: "REACTIVATION", leadId: emma.leadId }), /s'est désinscrit/);

    const stop = await contactPerdu("Stopa", 200, { accord: true });
    await prisma.conversationSms.create({ data: { numero: stop.telephone, stopLe: ilYa(10), stopTexte: "STOP" } });
    assert.equal(await reactivationDe(stop.leadId), undefined, "un numéro en STOP n'a pas de SMS");
  });

  test("la date de la perte : celle du lead, sinon celle de son dossier perdu, jamais `updatedAt` ; moins de 180 jours ou client revenu : rien ; un client, une réactivation", async () => {
    const recent = await contactPerdu("Fanny", 100, { accord: true });
    assert.equal(await reactivationDe(recent.leadId), undefined, "perdu depuis 100 jours");

    const sansDate = await contactPerdu("Gilles", null, { accord: true });
    await prisma.$executeRawUnsafe(`UPDATE "Lead" SET "updatedAt" = ? WHERE "id" = ?`, ilYa(300).getTime(), sansDate.leadId);
    assert.equal(await reactivationDe(sansDate.leadId), undefined, "sans date de perte : pas de réactivation (updatedAt n'en est pas une)");

    const parDossier = await contactPerdu("Hugo", null, { accord: true });
    await prisma.dossier.create({ data: { leadId: parDossier.leadId, clientId: parDossier.clientId, clientNom: "Hugo Perdu", clientAdresse: "", clientCp: "", clientVille: "Lattes", clientTelephone: parDossier.telephone, objet: "Recouvrement de cuisine", source: "ENTRANT", etape: "PERDU", perteLe: ilYa(190) } });
    assert.equal((await reactivationDe(parDossier.leadId))?.joursDepuisPerte, 190, "la date du dossier perdu");

    const revenu = await contactPerdu("Ines", 200, { accord: true });
    await prisma.dossier.create({ data: { clientId: revenu.clientId, clientNom: "Ines Perdu", clientAdresse: "", clientCp: "", clientVille: "Lattes", clientTelephone: revenu.telephone, objet: "Salle de bains", source: "ENTRANT", etape: "QUALIFICATION" } });
    assert.equal(await reactivationDe(revenu.leadId), undefined, "le client a un dossier vivant");

    const ancien = await contactPerdu("Jules", 300, { accord: true });
    const second = await contactPerdu("Jules", 200, { clientId: ancien.clientId });
    const deJules = (await reactivation.relancesReactivationProposables()).filter((x) => x.clientId === ancien.clientId);
    assert.deepEqual(deJules.map((x) => x.leadId), [second.leadId], "un client, une réactivation : son contact perdu le plus récent");
  });

  test("tâche « Reprendre contact · Nom » sur le lead ; copiée : tracée sur le lead même avec un dossier perdu, une seule fois, et la tâche est cochée « faite », pas « sans suite »", async () => {
    const kim = await contactPerdu("Kim", 220, { accord: true });
    const perdu = await prisma.dossier.create({ data: { leadId: kim.leadId, clientId: kim.clientId, clientNom: "Kim Perdu", clientAdresse: "", clientCp: "", clientVille: "Lattes", clientTelephone: kim.telephone, objet: "Cuisine", source: "ENTRANT", etape: "PERDU", perteLe: ilYa(220) } });
    await passeRelances();
    const cle = `REACTIVER:lead:${kim.leadId}`;
    const t = await tache(cle);
    assert.deepEqual([t.titre, t.niveau, t.statut, t.leadId, t.dossierId], ["Reprendre contact · Kim Perdu", 3, "A_FAIRE", kim.leadId, null]);
    assert.deepEqual(JSON.parse(t.raccourci).sms, { action: "REACTIVATION", leadId: kim.leadId, relance: { type: "REACTIVATION", rang: 1 } });

    const sms = await proposition.proposerSms({ action: "REACTIVATION", leadId: kim.leadId, relance: { type: "REACTIVATION", rang: 1 } });
    assert.equal(sms.dossierId, perdu.id, "le contact est lu par son dossier perdu (non archivé)");
    const note = await copie.noterSmsCopie({ code: sms.code, texte: sms.texte, leadId: sms.leadId, dossierId: sms.dossierId, relance: sms.relance, origine: "ECRAN" });
    assert.deepEqual([note.cible, note.dossierId, note.leadId], ["CONTACT", null, kim.leadId]);
    const echange = await prisma.interaction.findUniqueOrThrow({ where: { id: note.id } });
    assert.ok(echange.contenu.startsWith(reactivation.PREFIXE_TRACE_REACTIVATION));
    assert.equal(await prisma.dossierEvenement.count({ where: { dossierId: perdu.id, type: "SMS_COPIE" } }), 0);
    assert.equal(await reactivationDe(kim.leadId), undefined, "une seule réactivation");

    await passeRelances();
    const faite = await tache(cle);
    assert.equal(faite.statut, "FAITE");
    assert.match(faite.reponseTexte ?? "", /^coché par le CRM : SMS de réactivation copié à \d{2}:\d{2}$/);
  });
});

describe("la même liste partout : feuille Relances, point du jour, assistant", () => {
  test("relancesProposables : devis, photos, avis, réactivations, et le total ; la fiche d'un dossier n'a pas de réactivation ; GET /api/relances les rend", async () => {
    const d = await chantierFini("Avisliste Essai", 10);
    const l = await contactPerdu("Lina", 200, { accord: true });
    const tout = await proposables.relancesProposables();
    assert.ok(tout.avis.some((a) => a.dossierId === d.dossierId));
    assert.ok(tout.reactivations.some((r) => r.leadId === l.leadId));
    assert.equal(tout.total, tout.devis.length + tout.photos.length + tout.avis.length + tout.reactivations.length);
    const duDossier = await proposables.relancesProposables(new Date(), { dossierId: d.dossierId });
    assert.deepEqual([duDossier.avis.map((a) => a.dossierId), duDossier.reactivations.length, duDossier.total], [[d.dossierId], 0, 1]);

    const { GET } = await import("@/app/api/relances/route");
    const lue = (await (await GET(new NextRequest("http://localhost/api/relances"))).json()) as import("@/lib/relances/proposables").RelancesProposables;
    assert.ok(lue.avis.some((a) => a.dossierId === d.dossierId));
    assert.ok(lue.reactivations.some((r) => r.leadId === l.leadId));
    const { resumeDuJour } = await import("@/lib/agenda/resume");
    assert.equal((await resumeDuJour()).relancesProposables, tout.total);
  });

  test("« lister » RELANCES rend les demandes d'avis et les réactivations, même sans devis en attente ; « noter_sms » DEMANDE_AVIS et REACTIVATION les comptent", async () => {
    const d = await chantierFini("Avismcp Essai", 11);
    const l = await contactPerdu("Maud", 210, { accord: true });
    const r = await appeler("lister", { liste: "RELANCES" });
    assert.match(r.texte, /^Aucun devis en attente de réponse/);
    assert.match(r.texte, /demandes? d'avis proposables? \(7 jours après la fin du chantier, valeur par défaut, une fois\) :/);
    assert.match(r.texte, new RegExp(`- Avismcp Essai : chantier terminé le \\d{2}/\\d{2}/\\d{4}, pas encore d'avis — demande d'avis proposable\\. SMS \\(DEMANDE_AVIS\\) : « Bonjour Avismcp, [^»]*#apres » \\[dossier:${d.dossierId}\\]`));
    assert.match(r.texte, /réactivations? proposables? \(contacts sans suite depuis 180 jours, une fois\) :/);
    assert.match(r.texte, new RegExp(`- Maud Perdu : sans suite depuis le \\d{2}/\\d{2}/\\d{4} \\(210 jours\\), d'accord pour les messages commerciaux — réactivation proposable\\. SMS \\(REACTIVATION\\) : « Bonjour Maud, [^»]* » \\[lead:${l.leadId}\\]`));
    const duDossier = await appeler("lister", { liste: "RELANCES", filtres: { dossier_id: d.dossierId } });
    assert.match(duDossier.texte, /^Relances du dossier :\n- Avismcp Essai : /);

    const avisNote = await appeler("noter_sms", { dossierId: d.dossierId, code: "DEMANDE_AVIS" });
    assert.match(avisNote.texte, /^Noté : SMS DEMANDE_AVIS envoyé à .* \(écrit dans l'histoire du dossier, lien de l'espace communiqué : la main passe au client, demande d'avis comptée \(une seule\)\)\./);
    assert.equal(await avisDe(d.dossierId), undefined);
    const reactNote = await appeler("noter_sms", { leadId: l.leadId, code: "REACTIVATION" });
    assert.match(reactNote.texte, /^Noté : SMS REACTIVATION envoyé à .* \(écrit dans les échanges du lead, réactivation comptée \(une seule\)\)\./);
    assert.equal(await reactivationDe(l.leadId), undefined);
  });

  test("« etat_crm » PARAMETRES : plus d'interrupteur de séquence ; le délai DELAI_RELANCE_AVIS se lit et se règle ; « manager_operations » compte les avis et réactivations dus", async () => {
    const automatismes = await appeler("etat_crm", { partie: "PARAMETRES", automatismes: true });
    assert.doesNotMatch(automatismes.texte, /SEQUENCE_|Séquence de mails/);
    const commercial = await appeler("etat_crm", { partie: "PARAMETRES", groupe: "COMMERCIAL" });
    assert.match(commercial.texte, /DELAI_RELANCE_AVIS/);
    assert.doesNotMatch((await appeler("etat_crm", { partie: "PARAMETRES", groupe: "AGENT" })).texte, /MAIL_EXPEDITEUR/);

    const ops = await appeler("manager_operations", {});
    const relances = (ops.donnees as { relances: Record<string, unknown> }).relances;
    const liste = await proposables.relancesProposables();
    assert.deepEqual([relances.nombreAvisDus, relances.nombreReactivationsDues], [liste.avis.length, liste.reactivations.length]);
    assert.equal("sequencesEnCours" in relances, false);
    assert.match(ops.texte, /avis à demander/);

    // Le délai se règle : 3 jours rendent proposable un chantier fini il y a 4 jours.
    const court = await chantierFini("Avisdelai Essai", 4);
    assert.equal(await avisDe(court.dossierId), undefined);
    await parametres.enregistrerParametre({ cle: "DELAI_RELANCE_AVIS", valeur: 3, valableDu: ilYa(1), source: "essai" });
    assert.equal((await avisDe(court.dossierId))?.joursDepuisFin, 4);
  });
});
