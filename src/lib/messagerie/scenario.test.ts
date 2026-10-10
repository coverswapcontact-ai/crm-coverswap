import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { preparerBaseEssai } from "@/test/base-essai";

preparerBaseEssai();
process.env.UPLOADS_DIR = mkdtempSync(path.join(tmpdir(), "coverswap-m25-"));
process.env.TACHES_DESACTIVEES = "1";
process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3001";
process.env.NEXTAUTH_SECRET = "secret-des-essais-de-la-messagerie";

/**
 * Mission 25 — le scénario de bout en bout du cahier (« Démo Messagerie », numéro de la plage de fiction 06 39 98) :
 * lead reçu → A1 prêt et alerte ; note après appel « intéressée, veut du chêne clair » → P1 ; photos rapportées → S1 ;
 * simulation publiée → S2 ; « j'adore, vous pouvez passer ? » → deux créneaux ; devis en ligne → D1 ; « c'est trop
 * cher » → alerte, brouillon prudent, budget sensible ; note « signe dans 2 semaines » → pause, rappel, « comme
 * convenu » au jour J. À chaque étape : « Où on en est » juste et une ligne de journal de plus. Puis : rejouer sans
 * doublon, STOP, pause générale, démarrage en douceur. Sans IA (règles fixes), avec un faux modèle ensuite.
 */

let prisma: typeof import("@/lib/prisma").default;
let analyse: typeof import("./analyse");
let gestes: typeof import("./gestes");
let moteur: typeof import("./moteur");
let suivis: typeof import("./suivis");
let alertes: typeof import("./alertes");
let horaires: typeof import("./horaires");
let parametres: typeof import("@/lib/parametres/service");

const recues: import("./alertes").AlerteMessagerie[] = [];
const JOUR = 86_400_000;

/** Un jour de semaine à 10 h (heure de Paris), après maintenant : l'horloge du scénario (les horaires de travail s'y appliquent). */
function prochainMatinDeSemaine(): Date {
  let instant = new Date(Date.now() + 3_600_000);
  for (let i = 0; i < 10; i++) {
    const jour = horaires.momentParis(instant).jour;
    const semaine = horaires.semaineDuJour(jour);
    const candidat = horaires.instantParis(jour, 10 * 60);
    if (semaine >= 1 && semaine <= 4 && !horaires.estFerie(jour) && candidat.getTime() > Date.now() + 60_000) return candidat;
    instant = new Date(horaires.instantParis(horaires.jourSuivant(jour), 0).getTime() + 3_600_000);
  }
  throw new Error("pas de matin de semaine trouvé");
}

let horloge: Date;
const avancer = (minutes: number) => (horloge = new Date(horloge.getTime() + minutes * 60_000));

async function photoJpeg(): Promise<File> {
  const sharp = (await import("sharp")).default;
  const tampon = await sharp({ create: { width: 64, height: 48, channels: 3, background: { r: 120, g: 110, b: 100 } } }).jpeg().toBuffer();
  return new File([new Uint8Array(tampon)], "cuisine.jpg", { type: "image/jpeg" });
}

const journalDe = async (suiviId: string) => (await prisma.ligneJournalSuivi.findMany({ where: { suiviId }, orderBy: { le: "asc" } })).map((l) => `${l.acteur} · ${l.texte}`);
const ouEnEstDe = async (suiviId: string) => JSON.parse((await prisma.suivi.findUniqueOrThrow({ where: { id: suiviId } })).ouEnEst) as { situation: string; client: string; suite: string };
const messages = (suiviId: string) => prisma.messagePrepare.findMany({ where: { suiviId }, orderBy: { createdAt: "asc" } });
const dernier = async (suiviId: string, code: string) => (await messages(suiviId)).filter((m) => m.code === code).at(-1);

before(async () => {
  prisma = (await import("@/lib/prisma")).default;
  for (const cle of ["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID", "NTFY_TOPIC", "RESEND_API_KEY", "ANTHROPIC_API_KEY"]) process.env[cle] = "";
  await (await import("@/lib/base/preparation")).preparerBase();
  analyse = await import("./analyse");
  gestes = await import("./gestes");
  moteur = await import("./moteur");
  suivis = await import("./suivis");
  alertes = await import("./alertes");
  horaires = await import("./horaires");
  parametres = await import("@/lib/parametres/service");
  alertes.definirAlertesEssai((a) => recues.push(a));
  analyse.definirCreneauxEssai(async () => ["mardi 13 octobre", "jeudi 15 octobre"]);
  horloge = prochainMatinDeSemaine();
  suivis.oublierLancement();
  await parametres.enregistrerParametre({ cle: "MESSAGERIE_LANCEMENT", valeur: new Date(Date.now() - 60_000).toISOString(), valableDu: new Date("2026-01-01"), source: "essai" });
});

after(async () => {
  alertes.definirAlertesEssai(null);
  analyse.definirCreneauxEssai(null);
  await prisma.$disconnect();
});

describe("Mission 25 — le scénario « Démo Messagerie »", () => {
  let suiviId = "";
  let leadId = "";
  let nbLignes = 0;
  const uneLigneDePlus = async (etape: string) => {
    const lignes = await journalDe(suiviId);
    assert.ok(lignes.length > nbLignes, `${etape} : une ligne de journal de plus`);
    nbLignes = lignes.length;
    return lignes;
  };

  test("1. lead reçu → A1 prêt, alerte, « Où on en est »", async () => {
    const lead = await prisma.lead.create({ data: { prenom: "Camille", nom: "Démo", telephone: "0639980018", ville: "Lattes", codePostal: "34970", source: "META_ADS", typeProjet: "CUISINE" } });
    leadId = lead.id;
    assert.ok((await moteur.balayer(horloge, new Date(Date.now() - 60_000))) >= 1, "le balayage voit le nouveau lead");
    const suivi = (await prisma.suivi.findFirst({ where: { leadId } }))!;
    suiviId = suivi.id;
    await analyse.analyserSuivi(suiviId, horloge);
    const a1 = (await dernier(suiviId, "A1"))!;
    assert.equal(a1.statut, "A_ENVOYER");
    assert.equal(a1.canal, "SMS");
    assert.equal(a1.destinataire, "+33639980018");
    assert.equal(a1.texte, "Bonjour Camille, Lucas de CoverSwap. Merci pour votre demande ! Je vous appelle dans la journée. Pour gagner du temps, envoyez-moi 2 ou 3 photos de votre cuisine en réponse à ce message.");
    // Premier SMS à ce numéro : la mention STOP s'ajoute à l'envoi (et à l'écran), pas au texte préparé.
    const vues = await import("./vues");
    assert.ok((await vues.premiersSms([suiviId])).has(suiviId));
    assert.match(vues.texteAEnvoyer(a1, true), / STOP pour ne plus recevoir nos SMS\.$/);
    assert.ok(recues.some((r) => r.titre === "Message prêt pour Camille Démo" && r.chemin === `/messagerie?message=${a1.id}`));
    const ouEnEst = await ouEnEstDe(suiviId);
    assert.match(ouEnEst.situation, /^Lead du \d\d\/\d\d \(Meta\), pas encore appelé\.$/);
    assert.equal(ouEnEst.suite, "Toi : envoyer A1 (nouveau lead).");
    const lignes = await uneLigneDePlus("lead");
    assert.ok(lignes.some((l) => l === "CRM · Lead reçu (Meta)"));
    assert.ok(lignes.some((l) => l.startsWith("IA · A1 · Nouveau lead préparé")));
  });

  test("1 bis. ✅ Envoyé : inscrit dans la conversation, le lead reste « À appeler »", async () => {
    const a1 = (await dernier(suiviId, "A1"))!;
    avancer(3);
    await gestes.confirmerEnvoi(a1.id, {}, horloge);
    const envoye = await prisma.messagePrepare.findUniqueOrThrow({ where: { id: a1.id } });
    assert.equal(envoye.statut, "ENVOYE");
    assert.match(envoye.texteEnvoye ?? "", / STOP pour ne plus recevoir nos SMS\.$/, "le premier SMS parti porte la mention STOP");
    const vues = await import("./vues");
    assert.ok(!(await vues.premiersSms([suiviId])).has(suiviId), "le suivant ne la portera pas");
    assert.equal((await prisma.lead.findUniqueOrThrow({ where: { id: leadId } })).dernierContactLe, null, "A1 n'est pas un contact");
    await uneLigneDePlus("A1 envoyé");
  });

  test("2. note après appel « intéressée, veut du chêne clair » → P1 avec le lien, la teinte retenue", async () => {
    avancer(60);
    const r = await gestes.apresAppel({ suiviId, issue: "INTERESSE", note: "Intéressée, veut du chêne clair" }, horloge);
    suiviId = r.suiviId;
    const suivi = await prisma.suivi.findUniqueOrThrow({ where: { id: suiviId } });
    assert.ok(suivi.dossierId, "le suivi est passé au dossier ouvert par « Intéressé »");
    const p1 = (await dernier(suiviId, "P1"))!;
    assert.ok(p1, "P1 préparé");
    assert.match(p1.texte, /^Merci pour notre échange ! Comme convenu, voici votre espace : déposez-y 2 ou 3 photos de votre cuisine et je vous prépare votre simulation\. https?:\/\/\S+\/e\/\S+$/);
    const faits = JSON.parse(suivi.faits) as { teintesEvoquees: string[] };
    assert.deepEqual(faits.teintesEvoquees, ["chêne clair"]);
    assert.match((await ouEnEstDe(suiviId)).client, /chêne clair/);
    await uneLigneDePlus("appel");
    await gestes.confirmerEnvoi(p1.id, {}, avancer(2));
  });

  test("3. photos rapportées → S1, rangées dans son espace", async () => {
    avancer(120);
    const r = await gestes.rapporterReponse({ suiviId, texte: "", recuLe: horloge, photos: [await photoJpeg()] }, horloge);
    assert.equal(r.photos, 1);
    const s1 = (await dernier(suiviId, "S1"))!;
    assert.equal(s1.texte, "Merci, j'ai bien reçu vos photos ! Je prépare votre simulation et je vous préviens dès qu'elle est prête.");
    assert.equal(s1.statut, "A_ENVOYER");
    assert.match((await ouEnEstDe(suiviId)).situation, /^Photos reçues le \d\d\/\d\d, simulation à préparer\./);
    await uneLigneDePlus("photos");
    await gestes.confirmerEnvoi(s1.id, {}, avancer(1));
  });

  test("4. simulation publiée → S2", async () => {
    avancer(240);
    const suivi = await prisma.suivi.findUniqueOrThrow({ where: { id: suiviId } });
    const espace = await prisma.espaceClient.findUniqueOrThrow({ where: { dossierId: suivi.dossierId! } });
    await prisma.simulationEspace.create({ data: { espaceId: espace.id, dossierId: suivi.dossierId!, chemin: "essai/rendu.jpg", source: "API", statut: "PUBLIEE", publieeLe: new Date() } });
    await prisma.dossierEvenement.create({ data: { dossierId: suivi.dossierId!, type: "ESPACE_SIMULATION_DEPOSEE", direction: "SORTANT", contenu: "Simulation publiée", metadata: "{}" } });
    await prisma.dossier.update({ where: { id: suivi.dossierId! }, data: { etape: "SIMULATION" } });
    await analyse.analyserSuivi(suiviId, horloge);
    const s2 = (await dernier(suiviId, "S2"))!;
    assert.ok(s2, "S2 préparé");
    assert.ok(s2.texte.includes("cuisine rénovée"));
    assert.ok(/\/e\//.test(s2.texte), "le lien de l'espace");
    await uneLigneDePlus("simulation");
    await gestes.confirmerEnvoi(s2.id, {}, avancer(1));
  });

  test("5. « j'adore, vous pouvez passer ? » → la visite avec deux créneaux de l'agenda", async () => {
    avancer(90);
    const r = await gestes.rapporterReponse({ suiviId, texte: "J'adore ! Vous pouvez passer ?", recuLe: horloge }, horloge);
    assert.ok(r.proposee, "une réponse proposée");
    assert.equal(r.proposee!.code, "Q5");
    assert.equal(r.proposee!.texte, "Je peux passer vous montrer les échantillons. Plutôt mardi 13 octobre ou jeudi 15 octobre ?");
    assert.equal(r.proposee!.statut, "A_ENVOYER");
    await uneLigneDePlus("visite");
    await gestes.confirmerEnvoi(r.proposee!.id, {}, avancer(1));
  });

  test("6. devis mis en ligne → D1", async () => {
    avancer(24 * 60);
    const suivi = await prisma.suivi.findUniqueOrThrow({ where: { id: suiviId } });
    const devis = await prisma.document.create({ data: { dossierId: suivi.dossierId!, type: "DEVIS", numero: "2026-9901", dateEmission: new Date(), objet: "Recouvrement de cuisine", lignes: "[]", totalHt: 2200, acomptePct: 30, statut: "ENVOYE", visibleEspace: true } });
    await prisma.dossierEvenement.create({ data: { dossierId: suivi.dossierId!, type: "DEVIS_ENVOYE", direction: "INTERNE", contenu: "Devis 2026-9901 mis en ligne", metadata: JSON.stringify({ documentId: devis.id, presentation: true, canal: "ESPACE" }) } });
    await prisma.dossier.update({ where: { id: suivi.dossierId! }, data: { etape: "DEVIS_ENVOYE" } });
    await analyse.analyserSuivi(suiviId, horloge);
    const d1 = (await dernier(suiviId, "D1"))!;
    assert.ok(d1.texte.startsWith("Bonjour Camille, votre devis est prêt dans votre espace : "));
    assert.match((await ouEnEstDe(suiviId)).situation, /^Devis 2 200 € HT en ligne le \d\d\/\d\d, pas encore ouvert, sans réponse\./);
    await uneLigneDePlus("devis");
    await gestes.confirmerEnvoi(d1.id, {}, avancer(1));
  });

  test("7. « c'est trop cher » → alerte, brouillon prudent, budget sensible", async () => {
    avancer(180);
    const avant = recues.length;
    const r = await gestes.rapporterReponse({ suiviId, texte: "C'est trop cher pour nous", recuLe: horloge }, horloge);
    assert.ok(recues.slice(avant).some((a) => a.titre === "Camille Démo trouve ça cher"));
    assert.equal(r.proposee!.texte, "Bien reçu, je regarde et je reviens vers vous très vite.");
    const suivi = await prisma.suivi.findUniqueOrThrow({ where: { id: suiviId } });
    assert.equal((JSON.parse(suivi.faits) as { budget: string }).budget, "SENSIBLE");
    assert.equal(suivi.validationForcee, true, "ses messages passent en Validation");
    assert.match((await ouEnEstDe(suiviId)).client, /trouve ça cher/);
    await uneLigneDePlus("trop cher");
    await gestes.confirmerEnvoi(r.proposee!.id, {}, avancer(1));
  });

  test("8. note « signe dans 2 semaines » → pause, rappel, « comme convenu » au jour J", async () => {
    avancer(30);
    await gestes.ajouterNote({ suiviId, texte: "Elle signe dans 2 semaines, son mari valide." }, horloge);
    const suivi = await prisma.suivi.findUniqueOrThrow({ where: { id: suiviId } });
    assert.equal(suivi.pauseMotif, "COMME_CONVENU");
    const jourJ = horaires.momentParis(suivi.pauseJusquau!).jour;
    const attendu = horaires.prochainJourPermis(horaires.jourSuivant(horaires.momentParis(horloge).jour, 14));
    assert.equal(jourJ, attendu);
    const dossier = await prisma.dossier.findUniqueOrThrow({ where: { id: suivi.dossierId! } });
    assert.match(dossier.prochaineAction ?? "", /^Rappeler/);
    assert.match((await ouEnEstDe(suiviId)).suite, /^Toi : rappeler /);
    await uneLigneDePlus("note");
    // La veille du jour J : « comme convenu » se prépare ; le jour J à 10 h, il est prêt.
    const veille = horaires.instantParis(horaires.jourSuivant(jourJ, -1), 10 * 60);
    await analyse.analyserSuivi(suiviId, veille);
    const cc = (await dernier(suiviId, "CC"))!;
    assert.ok(cc, "CC préparé");
    assert.equal(cc.texte, "Bonjour Camille, comme convenu, je reviens vers vous pour votre devis. Avez-vous pu y réfléchir ?");
    assert.equal(cc.mode, "VALIDATION");
    await moteur.traiterEcheances(horaires.instantParis(jourJ, 10 * 60));
    assert.equal((await prisma.messagePrepare.findUniqueOrThrow({ where: { id: cc.id } })).statut, "A_ENVOYER");
  });

  test("rejouer l'analyse n'écrit ni ligne ni message de plus", async () => {
    const lignes = (await journalDe(suiviId)).length;
    const nombre = (await messages(suiviId)).length;
    await analyse.analyserSuivi(suiviId, avancer(1));
    await analyse.analyserSuivi(suiviId, horloge);
    assert.equal((await messages(suiviId)).length, nombre);
    assert.equal((await journalDe(suiviId)).length, lignes);
  });
});

describe("Mission 25 — STOP, pause générale, démarrage en douceur, plafonds", () => {
  before(() => {
    horloge = prochainMatinDeSemaine();
  });
  test("STOP rapporté : tout s'arrête, définitivement", async () => {
    const lead = await prisma.lead.create({ data: { prenom: "Inès", nom: "Démo", telephone: "0639980019", ville: "Mauguio", source: "META_ADS" } });
    const suivi = (await suivis.suiviPour({ leadId: lead.id }))!;
    await analyse.analyserSuivi(suivi.id, horloge);
    assert.ok((await messages(suivi.id)).some((m) => m.code === "A1" && m.statut === "A_ENVOYER"));
    const r = await gestes.rapporterReponse({ suiviId: suivi.id, texte: "STOP" }, avancer(5));
    assert.equal(r.suiviId, suivi.id);
    const apres = await messages(suivi.id);
    assert.ok(apres.every((m) => !["PREVU", "A_ENVOYER", "A_VALIDER"].includes(m.statut)), "plus rien d'ouvert");
    assert.ok((await prisma.suivi.findUniqueOrThrow({ where: { id: suivi.id } })).stopLe);
    await assert.rejects(() => gestes.preparerMessageLibre({ suiviId: suivi.id, texte: "Bonjour" }, horloge), /STOP/);
  });

  test("« Tout mettre en pause » : aucune préparation ; relancé : A1 arrive", async () => {
    await gestes.toutMettreEnPause(true, new Date());
    const lead = await prisma.lead.create({ data: { prenom: "Hugo", nom: "Démo", telephone: "0639980020", ville: "Pérols", source: "SITE_DEVIS" } });
    const suivi = (await suivis.suiviPour({ leadId: lead.id }))!;
    await analyse.analyserSuivi(suivi.id, horloge);
    assert.equal((await messages(suivi.id)).length, 0);
    assert.equal((await moteur.passeMoteur(horloge)).pause, true);
    await gestes.toutMettreEnPause(false, new Date(Date.now() + 1000));
    await analyse.analyserSuivi(suivi.id, new Date(horloge.getTime() + 2000));
    assert.ok((await messages(suivi.id)).some((m) => m.code === "A1"));
  });

  test("dossier ouvert avant la mise en service : des propositions seulement, sans alerte", async () => {
    const dossier = await prisma.dossier.create({
      data: { clientNom: "Léon Démo", clientAdresse: "1 rue de l'Essai", clientCp: "34970", clientVille: "Lattes", clientTelephone: "0639980021", objet: "Recouvrement de cuisine", source: "ENTRANT", etape: "DEVIS_ENVOYE", createdAt: new Date(Date.now() - 30 * JOUR) },
    });
    const devis = await prisma.document.create({ data: { dossierId: dossier.id, type: "DEVIS", numero: "2026-9902", dateEmission: new Date(Date.now() - 12 * JOUR), objet: "Cuisine", lignes: "[]", totalHt: 1800, acomptePct: 30, statut: "ENVOYE", visibleEspace: true } });
    await prisma.dossierEvenement.create({ data: { dossierId: dossier.id, type: "DEVIS_ENVOYE", direction: "INTERNE", contenu: "Devis mis en ligne", metadata: JSON.stringify({ documentId: devis.id }), createdAt: new Date(Date.now() - 12 * JOUR) } });
    const suivi = (await suivis.suiviPour({ dossierId: dossier.id }))!;
    assert.equal(suivi.demarrageDoux, true);
    const avant = recues.length;
    await analyse.analyserSuivi(suivi.id, horloge);
    const proposes = await messages(suivi.id);
    assert.ok(proposes.length >= 1, "une relance de devis proposée");
    assert.ok(proposes.every((m) => m.statut === "A_VALIDER" && m.douceur));
    await moteur.notifierPrets(new Date(horloge.getTime() + 20 * 60_000));
    assert.ok(!recues.slice(avant).some((a) => a.titre.includes("Léon")), "pas d'alerte pour une proposition");
    await gestes.validerProposition(proposes[0].id, horloge);
    assert.equal((await prisma.messagePrepare.findUniqueOrThrow({ where: { id: proposes[0].id } })).statut, "A_ENVOYER");
  });

  test("19 h 30 sans confirmation : non confirmé, il revient en tête", async () => {
    const lead = await prisma.lead.create({ data: { prenom: "Zoé", nom: "Démo", telephone: "0639980022", ville: "Lattes", source: "META_ADS" } });
    const suivi = (await suivis.suiviPour({ leadId: lead.id }))!;
    await analyse.analyserSuivi(suivi.id, horloge);
    const a1 = (await messages(suivi.id)).find((m) => m.code === "A1")!;
    const soir = horaires.instantParis(horaires.momentParis(horloge).jour, 19 * 60 + 45);
    assert.ok((await moteur.marquerNonConfirmes(soir)) >= 1);
    assert.ok((await prisma.messagePrepare.findUniqueOrThrow({ where: { id: a1.id } })).nonConfirmeLe);
  });
});
