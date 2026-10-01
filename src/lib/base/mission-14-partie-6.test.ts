import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { preparerBaseEssai } from "@/test/base-essai";

preparerBaseEssai();
process.env.UPLOADS_DIR = mkdtempSync(path.join(tmpdir(), "coverswap-m14-p6-"));

/**
 * Mission 14 (29/09/2026), partie 6 — les relances : un seul circuit. Un devis
 * sans réponse propose le SMS à copier (toujours) et le mail à valider (s'il y a
 * une adresse) ; la copie compte (deux au plus, tous canaux), passe le dossier en
 * « Relance » et annule le mail du même rang. Un espace ouvert sans photo ni
 * simulation propose le SMS du lien. Le libellé d'attente de l'espace dit ce qui
 * manque vraiment. L'ancien circuit (SMS envoyés par le fournisseur) est retiré.
 * Noms fictifs.
 */

let prisma: typeof import("@/lib/prisma").default;
let proposables: typeof import("@/lib/relances/proposables");
let relances: typeof import("@/lib/relances/service");
let photos: typeof import("@/lib/relances/photos");
let copie: typeof import("@/lib/sms/copie");
let proposition: typeof import("@/lib/sms/proposition");
let liens: typeof import("@/lib/espace/liens");
let suivi: typeof import("@/lib/espace/suivi");
let etapes: typeof import("@/lib/espace/etapes");
let simulations: typeof import("@/lib/simulations/dossier");
let main: typeof import("@/lib/dossiers/main");
let migration: typeof import("@/lib/base/migrations/mission-14-partie-6");
let execution: typeof import("@/lib/assistant/execution");
let NextRequest: typeof import("next/server").NextRequest;

const JOUR = 86_400_000;
const dans = (jours: number) => new Date(Date.now() + jours * JOUR);
const ilYa = (jours: number) => new Date(Date.now() - jours * JOUR);

let numero = 0;
const lead = (prenom: string, donnees: Record<string, unknown> = {}) =>
  prisma.lead.create({ data: { prenom, nom: "Six", telephone: `+3361406${String(++numero).padStart(4, "0")}`, ville: "Lattes", source: "META_ADS", ...donnees } });

/** Un lead, son dossier et son espace, ouvert il y a `jours` jours (jamais ouvert par le client). */
async function contact(prenom: string, jours: number, donnees: Record<string, unknown> = {}) {
  const l = await lead(prenom, donnees);
  const ouvert = await liens.ouvrirEspaceDuContact(l.id);
  await prisma.espaceClient.update({ where: { id: ouvert.espace.id }, data: { createdAt: ilYa(jours) } });
  return { leadId: l.id, dossierId: ouvert.dossierId, espaceId: ouvert.espace.id };
}

let rangDevis = 600;
/** Un dossier en « Devis envoyé » et son devis, émis et remis au client il y a `jours` jours. */
async function dossierAvecDevis(nom: string, entree: { email: string | null; jours: number }) {
  const client = await prisma.client.create({ data: { nom, prenom: nom.split(" ")[0], source: "ENTRANT", premierContactLe: new Date() } });
  const dossier = await prisma.dossier.create({
    data: { clientNom: nom, clientAdresse: "3 rue des Essais", clientCp: "34000", clientVille: "Montpellier", clientTelephone: `06000006${String(++numero).padStart(2, "0")}`, clientEmail: entree.email, objet: "Recouvrement de salle de bains", source: "ENTRANT", etape: "DEVIS_ENVOYE", clientId: client.id },
  });
  const quand = ilYa(entree.jours);
  const devis = await prisma.document.create({
    data: { dossierId: dossier.id, clientId: client.id, type: "DEVIS", numero: `2026-${++rangDevis}`, dateEmission: quand, createdAt: quand, objet: "Meuble vasque", lignes: "[]", totalHt: 630, acomptePct: 30, statut: "ENVOYE" },
  });
  return { dossierId: dossier.id, devisId: devis.id, numero: devis.numero! };
}

const devisDe = async (dossierId: string, maintenant = new Date()) => (await proposables.relancesProposables(maintenant)).devis.find((d) => d.dossierId === dossierId);
const photosDe = async (dossierId: string, maintenant = new Date()) => (await photos.relancesPhotosProposables(maintenant)).find((p) => p.dossierId === dossierId);
const dossierDe = (id: string) => prisma.dossier.findUniqueOrThrow({ where: { id } });
const ligneEspace = async (dossierId: string) => (await suivi.listerEspaces()).find((l) => l.dossierId === dossierId)!;
const texteVoirRelances = async () => {
  const session = await execution.ouvrirSession({ jetonId: null, clientNom: "essai", utilisateur: "essai" });
  return (await execution.executerOutil((await import("@/lib/assistant/outils/lister")).outilLister as unknown as import("@/lib/assistant/definition").DefinitionOutil<Record<string, unknown>>, { liste: "RELANCES" }, session)).texte;
};
/** Copie le SMS proposé, tel quel (l'écran SMS envoie la relance rendue par la proposition). */
const copier = (sms: import("@/lib/sms/catalogue").PropositionSms, dossierId: string, maintenant = new Date()) =>
  copie.noterSmsCopie({ code: sms.code, texte: sms.texte, dossierId, relance: sms.relance, origine: "ECRAN" }, maintenant);

before(async () => {
  prisma = (await import("@/lib/prisma")).default;
  for (const cle of ["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID", "NTFY_TOPIC", "RESEND_API_KEY"]) process.env[cle] = ""; // vide, pas supprimée : Prisma reprendrait la valeur de .env
  process.env.NEXTAUTH_SECRET = "secret-de-session-pour-les-essais";
  process.env.SITE_URL = "https://coverswap.fr";
  process.env.TACHES_DESACTIVEES = "1";
  proposables = await import("@/lib/relances/proposables");
  relances = await import("@/lib/relances/service");
  photos = await import("@/lib/relances/photos");
  copie = await import("@/lib/sms/copie");
  proposition = await import("@/lib/sms/proposition");
  liens = await import("@/lib/espace/liens");
  suivi = await import("@/lib/espace/suivi");
  etapes = await import("@/lib/espace/etapes");
  simulations = await import("@/lib/simulations/dossier");
  main = await import("@/lib/dossiers/main");
  migration = await import("@/lib/base/migrations/mission-14-partie-6");
  execution = await import("@/lib/assistant/execution");
  NextRequest = (await import("next/server")).NextRequest;
  await (await import("@/lib/base/preparation")).preparerBase();
});
after(async () => {
  await prisma.$disconnect();
});

describe("relance de devis : le SMS à copier (toujours), le mail s'il y a une adresse", () => {
  test("sans e-mail, six jours après le devis (délai 5) : SMS RELANCE_DEVIS_1 ; copié → 1 relance, « Relance », main au client ; puis RELANCE_DEVIS_2 ; puis plus rien", async () => {
    const b = await dossierAvecDevis("Brochet Anaïs", { email: null, jours: 6 });
    const premiere = await devisDe(b.dossierId);
    assert.ok(premiere, "le client sans e-mail est dans les relances");
    assert.deepEqual([premiere.proposable, premiere.rang, premiere.relancesFaites, premiere.adresse, premiere.mail], [true, 1, 0, null, null]);
    assert.equal(premiere.sms?.code, "RELANCE_DEVIS_1");
    assert.equal(premiere.sms?.texte, "Bonjour, c'est Lucas de CoverSwap. Avez-vous pu regarder votre devis ? Il est toujours dans votre espace client. Je reste disponible si vous avez des questions.");
    assert.deepEqual(premiere.sms?.relance, { documentId: b.devisId, rang: 1 });
    assert.equal(premiere.sms?.telephone, (await dossierDe(b.dossierId)).clientTelephone);

    // La copie (l'écran SMS envoie la relance rendue par la proposition) compte la relance.
    await copie.noterSmsCopie({ code: premiere.sms!.code, texte: premiere.sms!.texte, dossierId: b.dossierId, relance: premiere.sms!.relance, origine: "ECRAN" });
    const d = await dossierDe(b.dossierId);
    assert.deepEqual([d.etape, d.main, d.mainMotif], ["RELANCE", "CLIENT", "Relance envoyée : en attente de sa réponse"]);
    const passage = await prisma.dossierEvenement.findFirstOrThrow({ where: { dossierId: b.dossierId, type: "CHANGEMENT_ETAPE" }, orderBy: { createdAt: "desc" } });
    assert.equal(JSON.parse(passage.metadata).nature, "AUTOMATIQUE");
    assert.equal(await devisDe(b.dossierId), undefined, "le délai repart de la relance");
    const liste = (await relances.listerRelances()).devis.find((x) => x.dossierId === b.dossierId)!;
    assert.deepEqual([liste.relancesFaites, liste.rang, liste.proposable], [1, 2, false]);

    // Six jours plus tard : la seconde, la dernière.
    const seconde = await devisDe(b.dossierId, dans(6));
    assert.deepEqual([seconde?.rang, seconde?.sms?.code], [2, "RELANCE_DEVIS_2"]);
    await copie.noterSmsCopie({ code: seconde!.sms!.code, texte: seconde!.sms!.texte, dossierId: b.dossierId, relance: seconde!.sms!.relance, origine: "ECRAN" }, dans(6));
    assert.equal(await devisDe(b.dossierId, dans(30)), undefined, "deux relances au plus, tous canaux confondus");
    const fin = (await relances.listerRelances(dans(30))).devis.find((x) => x.dossierId === b.dossierId)!;
    assert.deepEqual([fin.relancesFaites, fin.prochaineProposableLe, fin.sms], [2, null, null]);
  });

  test("avec e-mail : le mail proposé par la passe ET le SMS listés ; la copie du SMS annule le mail du même rang ; un mail parti fait tomber le SMS de ce rang", async () => {
    const a = await dossierAvecDevis("Arnaud Céleste", { email: "celeste@exemple.test", jours: 6 });
    await relances.proposerRelances();
    const mail1 = await prisma.proposition.findUniqueOrThrow({ where: { cleUnicite: `relance:${a.devisId}:1` } });
    const ligne = (await devisDe(a.dossierId))!;
    assert.deepEqual([ligne.sms?.code, ligne.mail?.propositionId, ligne.mail?.a], ["RELANCE_DEVIS_1", mail1.id, "celeste@exemple.test"]);

    await copie.noterSmsCopie({ code: ligne.sms!.code, texte: ligne.sms!.texte, dossierId: a.dossierId, relance: ligne.sms!.relance, origine: "ECRAN" });
    const annule = await prisma.proposition.findUniqueOrThrow({ where: { id: mail1.id } });
    assert.deepEqual([annule.statut, annule.commentaireRejet], ["ANNULEE", "Relance faite par SMS"]);
    assert.equal((await dossierDe(a.dossierId)).etape, "RELANCE");
    // Le rang suivant : le mail n° 2 (et le SMS n° 2) six jours après la relance par SMS.
    await relances.proposerRelances(dans(6));
    const mail2 = await prisma.proposition.findUniqueOrThrow({ where: { cleUnicite: `relance:${a.devisId}:2` } });
    assert.match(JSON.parse(mail2.contenu).texte, /une dernière fois/);
    const rang2 = (await devisDe(a.dossierId, dans(6)))!;
    assert.deepEqual([rang2.rang, rang2.sms?.code, rang2.mail?.propositionId], [2, "RELANCE_DEVIS_2", mail2.id]);

    // Un autre devis : le mail de relance n° 1 part (la trace MAIL_ENVOYE de l'envoi) → le SMS n° 1 disparaît.
    const c = await dossierAvecDevis("Cordier Basile", { email: "basile@exemple.test", jours: 6 });
    await relances.proposerRelances();
    const mailC = await prisma.proposition.findUniqueOrThrow({ where: { cleUnicite: `relance:${c.devisId}:1` } });
    const smsC = (await devisDe(c.dossierId))!.sms!;
    assert.equal(smsC.code, "RELANCE_DEVIS_1");
    await prisma.proposition.update({ where: { id: mailC.id }, data: { statut: "EXECUTEE" } });
    await prisma.dossierEvenement.create({ data: { dossierId: c.dossierId, type: "MAIL_ENVOYE", direction: "SORTANT", contenu: "Relance du devis", metadata: JSON.stringify({ propositionId: mailC.id, motif: "RELANCE_DEVIS", a: "basile@exemple.test", documentIds: [c.devisId] }) } });
    assert.equal(await devisDe(c.dossierId), undefined, "le mail parti compte : plus de SMS n° 1");
    await assert.rejects(copier(smsC, c.dossierId), /Le mail de relance n° 1 de ce devis est déjà parti : la relance est faite/, "le SMS n° 1 resté ouvert ne compte pas une seconde fois");
    assert.deepEqual([(await devisDe(c.dossierId, dans(6)))?.rang, (await devisDe(c.dossierId, dans(6)))?.sms?.code], [2, "RELANCE_DEVIS_2"]);
  });

  test("un mail de relance validé (en file) vaut relance faite : la ligne sort, la copie du SMS est refusée ; en échec, le SMS reste et sa copie annule le mail", async () => {
    const v = await dossierAvecDevis("Vasseur Iris", { email: "iris@exemple.test", jours: 6 });
    await relances.proposerRelances();
    const mail = await prisma.proposition.findUniqueOrThrow({ where: { cleUnicite: `relance:${v.devisId}:1` } });
    const sms = (await devisDe(v.dossierId))!.sms!;
    // Validé : l'exécution attend son tour dans la file (VALIDEE jusqu'à l'envoi).
    await prisma.proposition.update({ where: { id: mail.id }, data: { statut: "VALIDEE", decideLe: new Date(), decidePar: "HUMAIN:lucas@coverswap.fr" } });
    assert.equal(await devisDe(v.dossierId), undefined, "le mail validé part : plus rien à proposer");
    const enFile = (await relances.listerRelances()).devis.find((x) => x.dossierId === v.dossierId)!;
    assert.deepEqual([enFile.proposable, enFile.sms, enFile.mail, enFile.mailTraite], [false, null, null, { propositionId: mail.id, statut: "VALIDEE" }]);
    assert.match(await texteVoirRelances(), new RegExp(`Vasseur Iris : .* — mail de relance n° 1 validé, en cours d'envoi \\[proposition:${mail.id}\\] : la relance est faite \\[dossier:${v.dossierId}\\]`));
    await assert.rejects(copier(sms, v.dossierId), /Le mail de relance n° 1 de ce devis est validé et part : la relance est faite, pas de SMS en plus/);
    assert.equal(await prisma.dossierEvenement.count({ where: { dossierId: v.dossierId, type: "SMS_COPIE" } }), 0, "rien n'est tracé");

    // En échec (boîte coupée) : la relance reste à faire ; le SMS copié annule le mail, qui ne pourra plus être réessayé.
    await prisma.proposition.update({ where: { id: mail.id }, data: { statut: "ECHEC", erreurExecution: "Aucun envoi de mail configuré" } });
    const echec = (await devisDe(v.dossierId))!;
    assert.deepEqual([echec.proposable, echec.sms?.code, echec.mailTraite?.statut], [true, "RELANCE_DEVIS_1", "ECHEC"]);
    assert.match(await texteVoirRelances(), new RegExp(`Vasseur Iris : .* relance n° 1 proposable\\. SMS \\(RELANCE_DEVIS_1\\) : « [^»]* »\\. Mail de relance en échec \\[proposition:${mail.id}\\] : le réessayer depuis « À valider », ou copier le SMS \\(qui l'annule\\)`));
    await copier(echec.sms!, v.dossierId);
    const annule = await prisma.proposition.findUniqueOrThrow({ where: { id: mail.id } });
    assert.deepEqual([annule.statut, annule.commentaireRejet], ["ANNULEE", "Relance faite par SMS"]);
    const apres = (await relances.listerRelances()).devis.find((x) => x.dossierId === v.dossierId)!;
    assert.deepEqual([apres.relancesFaites, apres.rang, apres.proposable], [1, 2, false], "une seule relance comptée");
  });

  test("un mail de relance annulé (ou rejeté, expiré) n'est jamais reproposé : « voir_relances » le dit, « relancer » refuse clairement, le SMS reste", async () => {
    const x = await dossierAvecDevis("Xavier Lou", { email: "lou@exemple.test", jours: 6 });
    await relances.proposerRelances();
    const mail = await prisma.proposition.findUniqueOrThrow({ where: { cleUnicite: `relance:${x.devisId}:1` } });
    await prisma.proposition.update({ where: { id: mail.id }, data: { statut: "ANNULEE", decideLe: new Date(), commentaireRejet: "Il a appelé, il réfléchit" } });
    const ligne = (await devisDe(x.dossierId))!;
    assert.deepEqual([ligne.proposable, ligne.sms?.code, ligne.mail, ligne.mailTraite], [true, "RELANCE_DEVIS_1", null, { propositionId: mail.id, statut: "ANNULEE" }]);
    const texte = await texteVoirRelances();
    assert.match(texte, new RegExp(`Xavier Lou : .* relance n° 1 proposable\\. SMS \\(RELANCE_DEVIS_1\\) : « [^»]* »\\. Mail de ce rang déjà annulé : pas de nouveau mail, le SMS suffit \\[dossier:${x.dossierId}\\]`));
    assert.doesNotMatch(texte, /Xavier Lou[^\n]*prochaine passe/);
    await assert.rejects(relances.relancerDevis(x.dossierId, { forcer: true, apercuSeulement: true }), /Le mail de relance n° 1 du devis .* a été annulé : il ne sera pas reproposé ; la relance reste possible par SMS/);
    assert.deepEqual(await relances.proposerRelances().then(() => prisma.proposition.findUniqueOrThrow({ where: { id: mail.id } })).then((p) => p.statut), "ANNULEE", "la passe ne le recrée pas");
  });

  test("une adresse archivée (erronée) ne compte pas : SMS seul, aucun mail proposé", async () => {
    const z = await dossierAvecDevis("Zeller Noé", { email: null, jours: 6 });
    const { clientId } = await dossierDe(z.dossierId);
    await prisma.clientEmail.create({ data: { clientId: clientId!, adresse: "ancienne@exemple.test", principale: true, archiveLe: new Date(), archiveMotif: "Adresse erronée" } });
    const ligne = (await devisDe(z.dossierId))!;
    assert.deepEqual([ligne.adresse, ligne.sms?.code, ligne.mail], [null, "RELANCE_DEVIS_1", null]);
    await relances.proposerRelances();
    assert.equal(await prisma.proposition.count({ where: { cleUnicite: `relance:${z.devisId}:1` } }), 0, "aucun mail vers l'adresse archivée");
    await assert.rejects(relances.relancerDevis(z.dossierId, { forcer: true, apercuSeulement: true }), /Aucune adresse e-mail pour Zeller Noé/);
  });

  test("un numéro qui a répondu STOP : pas de SMS de relance (le mail seul s'il y en a un), pas de relance photos", async () => {
    const { normaliserTelephone } = await import("@/lib/clients/normalisation");
    const stop = async (telephone: string) => prisma.conversationSms.create({ data: { numero: normaliserTelephone(telephone)!, stopLe: new Date(), stopTexte: "STOP" } });
    const sansMail = await dossierAvecDevis("Stoppa Léon", { email: null, jours: 6 });
    const avecMail = await dossierAvecDevis("Stoppa Rose", { email: "rose@exemple.test", jours: 6 });
    for (const d of [sansMail, avecMail]) await stop((await dossierDe(d.dossierId)).clientTelephone);

    const etat = (await relances.listerRelances()).devis.find((x) => x.dossierId === sansMail.dossierId)!;
    assert.deepEqual([etat.proposable, etat.stop, etat.sms], [true, true, null]);
    assert.equal(await devisDe(sansMail.dossierId), undefined, "ni SMS ni mail : pas dans la feuille");
    await relances.proposerRelances();
    const ligne = (await devisDe(avecMail.dossierId))!;
    assert.deepEqual([ligne.stop, ligne.sms, typeof ligne.mail?.propositionId], [true, null, "string"], "le mail seul");
    const texte = await texteVoirRelances();
    assert.match(texte, new RegExp(`Stoppa Léon : .* relance n° 1 proposable\\. Pas de SMS : il a répondu STOP\\. Pas de mail : pas d'adresse e-mail, relancer par téléphone \\[dossier:${sansMail.dossierId}\\]`));
    assert.match(texte, new RegExp(`Stoppa Rose : .* relance n° 1 proposable\\. Pas de SMS : il a répondu STOP\\. Mail : relance n° 1 PROPOSÉE, à valider`));

    const espace = await contact("Stéphan", 4);
    await stop((await prisma.lead.findUniqueOrThrow({ where: { id: espace.leadId } })).telephone);
    assert.equal(await photosDe(espace.dossierId), undefined, "la relance photos n'est qu'un SMS : rien pour un numéro en STOP");
  });

  test("manager_operations compte les relances dues depuis la même liste : une relance faite par SMS n'est plus due, les espaces sans photo sont comptés", async () => {
    const m = await dossierAvecDevis("Martel Ugo", { email: null, jours: 6 });
    await contact("Mona", 5);
    const operations = await import("@/lib/assistant/analyses/operations");
    const liste = await proposables.relancesProposables();
    const ops = await operations.analyseOperations();
    assert.deepEqual([ops.relances.nombreDevisDus, ops.relances.nombrePhotosDues], [liste.devis.length, liste.photos.length]);
    assert.ok(ops.relances.nombrePhotosDues >= 1);
    await copier(liste.devis.find((d) => d.dossierId === m.dossierId)!.sms!, m.dossierId);
    assert.equal((await operations.analyseOperations()).relances.nombreDevisDus, ops.relances.nombreDevisDus - 1, "relancé par SMS : plus dû");
  });

  test("« voir_relances » : le dossier sans e-mail en « Devis envoyé » est présent avec son SMS une fois le délai passé, avec la date sinon ; les relances photos suivent", async () => {
    const pret = await dossierAvecDevis("Bouvier Léna", { email: null, jours: 6 });
    const tot = await dossierAvecDevis("Bouvier Tom", { email: null, jours: 2 });
    const espace = await contact("Solal", 4);
    const session = await execution.ouvrirSession({ jetonId: null, clientNom: "essai", utilisateur: "essai" });
    const { texte } = await execution.executerOutil((await import("@/lib/assistant/outils/lister")).outilLister as unknown as import("@/lib/assistant/definition").DefinitionOutil<Record<string, unknown>>, { liste: "RELANCES" }, session);
    assert.match(texte, new RegExp(`Bouvier Léna : devis ${pret.numero} .* — relance n° 1 proposable\\. SMS \\(RELANCE_DEVIS_1\\) : « Bonjour, c'est Lucas de CoverSwap\\. Avez-vous pu regarder votre devis \\?[^»]*»\\. Pas de mail : pas d'adresse e-mail, le SMS suffit \\[dossier:${pret.dossierId}\\]`));
    assert.match(texte, new RegExp(`Bouvier Tom : devis ${tot.numero} .* — prochaine relance proposable le \\d{2}/\\d{2}/\\d{4} \\(par SMS : pas d'adresse e-mail\\) \\[dossier:${tot.dossierId}\\]`));
    assert.match(texte, /relances? photos proposables? :/);
    assert.match(texte, new RegExp(`Solal Six : espace ouvert il y a 4 jours, ni photo ni simulation — relance photos n° 1 \\(lien jamais envoyé\\)\\. SMS \\(LIEN_ESPACE\\) : « Bonjour Solal, .*https://coverswap\\.fr/e/[A-Za-z0-9_-]+ » \\[dossier:${espace.dossierId}\\]`));
  });

  test("GET /api/relances rend relancesProposables (toutes, ou celles d'un dossier)", async () => {
    const b = await dossierAvecDevis("Roche Maëlys", { email: null, jours: 7 });
    const { GET } = await import("@/app/api/relances/route");
    const tout = (await (await GET(new NextRequest("http://localhost/api/relances"))).json()) as import("@/lib/relances/proposables").RelancesProposables;
    assert.ok(tout.devis.some((d) => d.dossierId === b.dossierId));
    assert.equal(tout.total, tout.devis.length + tout.photos.length);
    const un = (await (await GET(new NextRequest(`http://localhost/api/relances?dossierId=${b.dossierId}`))).json()) as import("@/lib/relances/proposables").RelancesProposables;
    assert.deepEqual([un.total, un.devis.map((d) => d.dossierId), un.devis[0].sms?.code], [1, [b.dossierId], "RELANCE_DEVIS_1"]);
  });
});

describe("relance photos : un espace ouvert sans photo ni simulation", () => {
  test("ouvert il y a 4 jours, rien reçu : proposée (LIEN_ESPACE sans lien communiqué, LIEN_ESPACE_RAPPEL sinon) ; 2 jours : pas encore ; copiée : comptée, deux au plus", async () => {
    const jamais = await contact("Ninon", 4);
    const p = await photosDe(jamais.dossierId);
    assert.ok(p, "proposée");
    assert.deepEqual([p.rang, p.lienCommunique, p.sms?.code, p.sms?.relance], [1, false, "LIEN_ESPACE", { type: "PHOTOS", rang: 1 }]);
    assert.match(p.sms!.texte, /^Bonjour Ninon, c'est Lucas de CoverSwap\. Comme convenu, voici votre espace personnel pour votre projet : .* https:\/\/coverswap\.fr\/e\/[A-Za-z0-9_-]+$/);
    assert.equal(await photosDe((await contact("Tristan", 2)).dossierId), undefined, "deux jours seulement : pas encore");

    // Le lien lui a été communiqué (SMS copié) il y a 4 jours : « à nouveau ».
    const recu = await contact("Maëlle", 5);
    const lien = await proposition.proposerSms({ action: "LIEN_ESPACE", dossierId: recu.dossierId });
    const note = await copie.noterSmsCopie({ code: lien.code, texte: lien.texte, dossierId: recu.dossierId, origine: "ECRAN" });
    await prisma.dossierEvenement.update({ where: { id: note.id }, data: { createdAt: ilYa(4) } });
    const rappel = (await photosDe(recu.dossierId))!;
    assert.deepEqual([rappel.lienCommunique, rappel.sms?.code], [true, "LIEN_ESPACE_RAPPEL"]);
    assert.equal(rappel.sms?.texte, `Bonjour Maëlle, c'est Lucas de CoverSwap. Voici à nouveau le lien de votre espace, tout votre projet y est à jour : ${lien.lien}`);
    // Communiqué il y a un jour seulement : le délai court depuis le lien.
    await prisma.dossierEvenement.update({ where: { id: note.id }, data: { createdAt: ilYa(1) } });
    assert.equal(await photosDe(recu.dossierId), undefined);
    await prisma.dossierEvenement.update({ where: { id: note.id }, data: { createdAt: ilYa(4) } });

    // La copie de la relance compte (metadata.relance.type = PHOTOS) ; la seconde quatre jours plus tard ; puis plus rien.
    const relance1 = await copie.noterSmsCopie({ code: rappel.sms!.code, texte: rappel.sms!.texte, dossierId: recu.dossierId, relance: rappel.sms!.relance, origine: "ECRAN" });
    assert.deepEqual(JSON.parse((await prisma.dossierEvenement.findUniqueOrThrow({ where: { id: relance1.id } })).metadata).relance, { type: "PHOTOS", rang: 1 });
    assert.equal(await photosDe(recu.dossierId), undefined, "le délai repart de la relance");
    const seconde = (await photosDe(recu.dossierId, dans(4)))!;
    assert.deepEqual([seconde.rang, seconde.relancesFaites], [2, 1]);
    await copie.noterSmsCopie({ code: seconde.sms!.code, texte: seconde.sms!.texte, dossierId: recu.dossierId, relance: seconde.sms!.relance, origine: "ECRAN" }, dans(4));
    assert.equal(await photosDe(recu.dossierId, dans(30)), undefined, "deux relances photos au plus");
    // Une relance photos sans dossier est refusée.
    await assert.rejects(copie.noterSmsCopie({ code: "LIEN_ESPACE_RAPPEL", texte: rappel.sms!.texte, leadId: (await lead("Yvon")).id, relance: { type: "PHOTOS", rang: 1 }, origine: "ECRAN" }), /Une relance photos se note sur son dossier/);
  });

  test("écartée avec une simulation du site rangée, une simulation du lead, une simulation dans l'espace ou une photo ; espace désactivé ou dossier plus loin : écartée", async () => {
    const site = await contact("Liliane", 4, { source: "SITE_SIMULATEUR" });
    await prisma.simulation.create({ data: { leadId: site.leadId, dossierId: site.dossierId, imageAfterPath: "simulations/essai/apres.png", imageBeforePath: "simulations/essai/avant.jpg" } });
    await simulations.synchroniserSimulationsSite(site.dossierId);
    assert.equal(await photosDe(site.dossierId), undefined, "simulation du site rangée : pas de relance photos");

    const duLead = await contact("Gaspard", 4);
    await prisma.simulation.create({ data: { leadId: duLead.leadId, imageAfterPath: "simulations/essai/apres-2.png" } });
    assert.equal(await photosDe(duLead.dossierId), undefined, "simulation portée par son lead, pas encore rangée");

    const duSiteRattachee = await contact("Honorine", 4);
    await prisma.simulationSite.create({ data: { parcoursId: "parcours-essai-6", projet: "cuisine", leadId: duSiteRattachee.leadId, rattacheeLe: new Date() } });
    assert.equal(await photosDe(duSiteRattachee.dossierId), undefined, "simulation du site rattachée à son lead");

    const sansRendu = await contact("Hector", 4);
    await prisma.simulation.create({ data: { leadId: sansRendu.leadId, dossierId: sansRendu.dossierId } });
    assert.equal(await photosDe(sansRendu.dossierId), undefined, "simulation rangée sans rendu (génération échouée)");
    // Rien de publié dans son espace (l'étape reste « Photos ») : le libellé ne le dit pas pour autant « en attente de ses photos ».
    for (const c of [duLead, duSiteRattachee, sansRendu]) {
      const ligne = await ligneEspace(c.dossierId);
      assert.deepEqual([ligne.etape, ligne.attente.qui, ligne.attente.libelle], ["PHOTOS", "CLIENT", "Espace ouvert : en attente de son projet"]);
    }

    const dansLEspace = await contact("Ivan", 4);
    await prisma.simulationEspace.create({ data: { espaceId: dansLEspace.espaceId, dossierId: dansLEspace.dossierId, chemin: "simulations/essai/client.png", source: "CLIENT", statut: "PUBLIEE" } });
    assert.equal(await photosDe(dansLEspace.dossierId), undefined, "simulation faite dans son espace");

    const photo = await contact("Jade", 4);
    await prisma.dossier.update({ where: { id: photo.dossierId }, data: { photos: JSON.stringify(["dossiers/x/photos/a-12345678.jpg"]) } });
    assert.equal(await photosDe(photo.dossierId), undefined, "une photo reçue");

    const revoque = await contact("Kilian", 4);
    await prisma.espaceClient.update({ where: { id: revoque.espaceId }, data: { revoqueLe: new Date() } });
    assert.equal(await photosDe(revoque.dossierId), undefined, "espace désactivé");
    const plusLoin = await contact("Lison", 4);
    await prisma.dossier.update({ where: { id: plusLoin.dossierId }, data: { etape: "DEVIS_ENVOYE" } });
    assert.equal(await photosDe(plusLoin.dossierId), undefined, "le dossier a dépassé la simulation");
  });
});

describe("le libellé d'attente de l'espace dit ce qui manque vraiment", () => {
  test("les motifs des événements de lien ne supposent plus rien ; l'espace lit son étape (photos, projet…)", async () => {
    const lu = (type: string, metadata: Record<string, unknown> = {}) => main.passageDeMain({ type, direction: "INTERNE", metadata: JSON.stringify(metadata), contenu: "" });
    assert.deepEqual(lu("ESPACE_LIEN_CREE"), { qui: "CLIENT", motif: "Espace ouvert : en attente du client" });
    assert.deepEqual(lu("ESPACE_LIEN_COMMUNIQUE"), { qui: "CLIENT", motif: "Lien de son espace envoyé : en attente du client" });
    assert.deepEqual(lu("SMS_COPIE", { texte: "Bonjour, c'est Lucas.", relance: { documentId: "d1", rang: 1 } }), { qui: "CLIENT", motif: "Relance envoyée : en attente de sa réponse" });
    assert.deepEqual(lu("SMS_COPIE", { texte: "Votre espace : https://coverswap.fr/e/AB12CD-xyz", relance: { type: "PHOTOS", rang: 1 } }), { qui: "CLIENT", motif: "Lien de son espace envoyé : en attente du client" });
    for (const motif of ["Espace ouvert : en attente du client", "Lien de son espace envoyé : en attente du client", "Nouveau lien envoyé : en attente du client", "Espace ouvert : en attente de ses photos et de son projet", "Lien de son espace communiqué : en attente de ses photos"]) assert.equal(main.estMotifDeLien(motif), true, motif);
    for (const motif of ["Devis envoyé : en attente de sa réponse", "Répondre à Ninon Six", "Simulation publiée : en attente de son retour"]) assert.equal(main.estMotifDeLien(motif), false, motif);
    assert.deepEqual(
      (["PHOTOS", "PROJET", "SIMULATIONS", "DEVIS", "ATTENTE_DEVIS"] as const).map((e) => etapes.attenteDuClient(e)),
      ["Espace ouvert : en attente de ses photos", "Espace ouvert : en attente de son projet", "Espace ouvert : en attente de son choix de simulation", "Devis envoyé : en attente de sa réponse", "Devis en préparation"]
    );
    assert.equal(etapes.attenteDuClient("PHOTOS", { simulation: true }), "Espace ouvert : en attente de son projet", "une simulation faite, même pas publiée chez lui");

    const nu = await contact("Octavie", 1);
    const ligne = await ligneEspace(nu.dossierId);
    assert.deepEqual([(await dossierDe(nu.dossierId)).mainMotif, ligne.etape, ligne.attente.qui, ligne.attente.libelle], ["Espace ouvert : en attente du client", "PHOTOS", "CLIENT", "Espace ouvert : en attente de ses photos"]);
  });

  test("cas « simulation du site » : un lead du simulateur dont la simulation est rangée n'est jamais « en attente de ses photos » ; le lien envoyé ne change rien", async () => {
    const s = await contact("Stella", 3, { source: "SITE_SIMULATEUR" });
    await prisma.simulation.create({ data: { leadId: s.leadId, dossierId: s.dossierId, imageAfterPath: "simulations/essai/apres-3.png", imageBeforePath: "simulations/essai/avant-3.jpg" } });
    await simulations.synchroniserSimulationsSite(s.dossierId);
    await main.recalculerMain(s.dossierId);
    let ligne = await ligneEspace(s.dossierId);
    assert.equal(ligne.etape, "PROJET");
    assert.deepEqual([ligne.attente.qui, ligne.attente.libelle], ["CLIENT", "Espace ouvert : en attente de son projet"]);
    assert.doesNotMatch(ligne.attente.libelle, /photos/);

    const lien = await proposition.proposerSms({ action: "ENVOYER_LIEN", dossierId: s.dossierId });
    assert.equal(lien.code, "LIEN_ESPACE_SIMULATION");
    await copie.noterSmsCopie({ code: lien.code, texte: lien.texte, dossierId: s.dossierId, origine: "ECRAN" });
    ligne = await ligneEspace(s.dossierId);
    assert.equal((await dossierDe(s.dossierId)).mainMotif, "Lien de son espace envoyé : en attente du client");
    assert.equal(ligne.attente.libelle, "Espace ouvert : en attente de son projet");
    // Un ancien motif rangé sur le dossier (avant la partie 6) se lit de même.
    await prisma.dossier.update({ where: { id: s.dossierId }, data: { mainMotif: "Espace ouvert : en attente de ses photos et de son projet" } });
    assert.equal((await ligneEspace(s.dossierId)).attente.libelle, "Espace ouvert : en attente de son projet");
  });
});

describe("migration relances-un-circuit-14-6 et retrait de l'ancien circuit", () => {
  test("modèles de l'ancien circuit archivés, DELAI_RELANCE_PHOTOS posé, anciens motifs relus, propositions SMS intactes ; rejouable", async () => {
    // Passée au démarrage (preparerBase) : le délai est posé à 3 jours.
    assert.ok(await prisma.migrationDonnees.findUnique({ where: { nom: "relances-un-circuit-14-6" } }));
    assert.deepEqual(await photos.lireDelaiRelancePhotos(), { jours: 3, parametre: true });
    const parametre = await prisma.parametre.findFirstOrThrow({ where: { cle: "DELAI_RELANCE_PHOTOS" } });
    assert.equal(parametre.source, "Mission 14 : valeur de départ");

    // L'état de la production : les modèles de l'ancien circuit en base, une proposition SMS en attente, un ancien motif.
    for (const [rang, code] of migration.CODES_ANCIEN_CIRCUIT.entries()) await prisma.modeleSms.create({ data: { code, libelle: code, texte: `Ancien texte ${code} : {lien}`, ordre: 40 + rang } });
    const c = await contact("Paulette", 1);
    await prisma.dossier.update({ where: { id: c.dossierId }, data: { mainMotif: "Espace ouvert : en attente de ses photos et de son projet" } });
    const conversation = await prisma.conversationSms.create({ data: { numero: "+33614069999", leadId: c.leadId } });
    const ancienne = await prisma.proposition.create({ data: { type: "ENVOI_SMS", auteur: "SYSTEME:relances", titre: "Relancer Paulette : photos non déposées", contenu: JSON.stringify({ motif: "RELANCE_PHOTOS", conversationId: conversation.id, dossierId: c.dossierId, modele: "RELANCE_PHOTOS", texte: "Bonjour" }), dossierId: c.dossierId } });

    const premier = await migration.unSeulCircuit(prisma);
    // Les mains relues : Paulette, et le dossier du test précédent resté sur l'ancien motif.
    assert.deepEqual([premier.modelesArchives, premier.delaiPose], [6, 0]);
    assert.ok(premier.mainsRelues >= 1, String(premier.mainsRelues));
    for (const code of migration.CODES_ANCIEN_CIRCUIT) {
      const modele = await prisma.modeleSms.findUniqueOrThrow({ where: { code } });
      assert.ok(modele.archiveLe, code);
      assert.equal(modele.archiveMotif, "Mission 14 : remplacé par les SMS à copier");
    }
    assert.equal((await dossierDe(c.dossierId)).mainMotif, "Espace ouvert : en attente du client");
    assert.equal((await prisma.proposition.findUniqueOrThrow({ where: { id: ancienne.id } })).statut, "EN_ATTENTE", "les propositions SMS en base restent validables");
    const { listerCatalogue } = await import("@/lib/sms/modeles");
    assert.ok(!(await listerCatalogue()).some((m) => (migration.CODES_ANCIEN_CIRCUIT as readonly string[]).includes(m.code)), "le groupe « Ancien circuit » disparaît de Paramètres → SMS");

    assert.deepEqual(await migration.unSeulCircuit(prisma), { modelesArchives: 0, delaiPose: 0, mainsRelues: 0 });
    const noms = (await import("@/lib/base/migrations")).MIGRATIONS_DONNEES.map((m) => m.nom);
    assert.ok(noms.indexOf("relances-un-circuit-14-6") > noms.indexOf("catalogue-sms-14-5") && noms.includes("catalogue-sms-14-5"), noms.join(", "));
  });

  test("sans valeur en vigueur, 3 jours (valeur du code) ; le travail « relances-sms » n'est plus enregistré", async () => {
    // Avant le 29/09/2026 (date d'effet posée par la migration), aucune valeur : le défaut du code.
    assert.deepEqual(await photos.lireDelaiRelancePhotos(new Date("2026-09-20T12:00:00Z")), { jours: 3, parametre: false });

    const { enregistrerTousLesTraitements } = await import("@/lib/taches/traitements");
    const { travauxPeriodiques } = await import("@/lib/taches/registre");
    enregistrerTousLesTraitements();
    const noms = travauxPeriodiques().map((t) => t.nom);
    assert.ok(noms.includes("propositions-relances"));
    assert.ok(!noms.includes("relances-sms"), "l'ancien circuit ne tourne plus");
  });
});
