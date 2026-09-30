import assert from "node:assert/strict";
import crypto from "node:crypto";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, beforeEach, describe, test } from "node:test";
import { NextRequest } from "next/server";
import { MESSAGES_ECHEC } from "@/lib/site/erreurs-generation";
import { preparerBaseEssai } from "@/test/base-essai";

preparerBaseEssai();
process.env.UPLOADS_DIR = mkdtempSync(path.join(tmpdir(), "coverswap-m15-"));

/**
 * Mission 15 (partie 1) — génération du simulateur du site asynchrone, visible, reprenable : POST /api/simulate crée
 * un TravailSimulation et répond 202 ; la tâche SIMULATION_SITE (voie longue de l'exécuteur) génère puis pose PRETE
 * ou ECHEC ; GET /api/simulate?id=&p= suit ; « Me prévenir » crée le lead du parcours et UN mail à la fin. OpenAI
 * est SIMULÉ (générateur injecté) : aucun appel réseau, aucune image générée. Noms fictifs.
 */

let prisma: typeof import("@/lib/prisma").default;
let route: typeof import("@/app/api/simulate/route");
let routeImage: typeof import("@/app/api/simulate/image/route");
let routePrevenir: typeof import("@/app/api/simulate/prevenir/route");
let travaux: typeof import("@/lib/simulations/travaux");
let lecture: typeof import("@/lib/simulations/travaux-lecture");
let prevenir: typeof import("@/lib/simulations/prevenir");
let executeur: typeof import("@/lib/taches/executeur");
let registre: typeof import("@/lib/taches/registre");
let file: typeof import("@/lib/taches/file");
let envoi: typeof import("@/lib/mail/envoi");
let interrupteurs: typeof import("@/lib/automatismes/interrupteurs");
let simulationsSite: typeof import("@/lib/site/simulations");

const SECRET = "secret-partage-des-essais";
// 1 pixel PNG : assez pour écrire un fichier et le relire.
const PIXEL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const PIXEL_OCTETS = Buffer.from(PIXEL.split(",")[1], "base64");
const PROMPT = "TASK: TEXTURE REPLACEMENT ON A REAL PHOTOGRAPH (essai)";
const SWATCHES = ["https://ssi.s3.fr-par.scw.cloud/essai/NE31.jpg"];
const REFERENCES = [{ zone: "credence", libelle: "Crédence", ref: "NE31", nom: "Chêne clair" }];

let appelsGenerateur = 0;
let reponseGenerateur: () => Promise<import("@/lib/simulations/generation").ResultatGeneration> = async () => ({ ok: true, image: PIXEL_OCTETS, type: "image/png", avant: null, taille: "1024x1024", dureeMs: 1234, usage: { texte: 10, image: 20, sortie: 30 }, coutDollars: 0.02, generationId: null });
let mails: { a: string; objet: string; pieces: number; texte: string }[] = [];

function signer(exp: number, parcoursId: string, prompt = PROMPT, swatchUrls = SWATCHES): string {
  return crypto.createHmac("sha256", SECRET).update(`${prompt}\n${swatchUrls.join(",")}\n${exp}\np:${parcoursId}`).digest("hex");
}
let numeroParcours = 0;
const parcours = () => `aaaaaaaa-1500-4000-8000-${String(++numeroParcours).padStart(12, "0")}`;

function requete(corps: unknown, options: { ip?: string; origin?: string } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json", "x-forwarded-for": options.ip ?? "203.0.113.1" };
  if (options.origin) headers.origin = options.origin;
  return new NextRequest("http://localhost/api/simulate", { method: "POST", body: JSON.stringify(corps), headers });
}
function corpsValide(parcoursId: string, extra: Record<string, unknown> = {}) {
  const exp = Date.now() + 60_000;
  return { prompt: PROMPT, swatchUrls: SWATCHES, sig: signer(exp, parcoursId), exp, parcoursId, projet: "cuisine", references: REFERENCES, page: "/simulateur", source: "instagram", photo_base64: PIXEL, asynchrone: true, ...extra };
}
const suivre = (id: string, p: string) => route.GET(new NextRequest(`http://localhost/api/simulate?id=${id}&p=${p}`));
async function creer(parcoursId: string, ip = "203.0.113.1"): Promise<{ travailId: string; attenteEstimeeS: number }> {
  const reponse = await route.POST(requete(corpsValide(parcoursId), { ip }));
  assert.equal(reponse.status, 202);
  return (await reponse.json()) as { travailId: string; attenteEstimeeS: number };
}
const travailDe = (id: string) => prisma.travailSimulation.findUniqueOrThrow({ where: { id } });
/** Les tâches laissées en file par un test (quota, réclamation double…) n'entrent pas dans le suivant. */
async function viderLaFile() {
  await executeur.attendreTachesLongues();
  await prisma.tache.updateMany({ where: { statut: "EN_ATTENTE" }, data: { statut: "ANNULEE", termineLe: new Date() } });
}

before(async () => {
  process.env.SIMULATE_TOKEN_SECRET = SECRET;
  process.env.OPENAI_API_KEY = "cle-factice-jamais-appelee";
  process.env.OPENAI_BASE_URL = "http://127.0.0.1:9/jamais";
  process.env.SITE_URL = "https://coverswap.fr";
  process.env.TACHES_DESACTIVEES = "1";
  for (const cle of ["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID", "NTFY_TOPIC", "RESEND_API_KEY", "EMAIL_FROM"]) delete process.env[cle];
  prisma = (await import("@/lib/prisma")).default;
  route = await import("@/app/api/simulate/route");
  routeImage = await import("@/app/api/simulate/image/route");
  routePrevenir = await import("@/app/api/simulate/prevenir/route");
  travaux = await import("@/lib/simulations/travaux");
  lecture = await import("@/lib/simulations/travaux-lecture");
  prevenir = await import("@/lib/simulations/prevenir");
  executeur = await import("@/lib/taches/executeur");
  registre = await import("@/lib/taches/registre");
  file = await import("@/lib/taches/file");
  envoi = await import("@/lib/mail/envoi");
  interrupteurs = await import("@/lib/automatismes/interrupteurs");
  simulationsSite = await import("@/lib/site/simulations");
  // Mission 15 (partie 2) : les références sont confrontées aux échantillons signés — catalogue posé à la main, aucun appel au site.
  (await import("@/lib/simulateur/catalogue")).definirCatalogueEssai([{ id: "NE31", nom: "Chêne clair", famille: "bois", categorie: "Wood", finition: "Soft", image: SWATCHES[0], tags: ["chêne"] }]);
  await (await import("@/lib/base/preparation")).preparerBase();
  travaux.enregistrerTachesSimulationSite();
  travaux.definirGenerateurEssai(async () => {
    appelsGenerateur += 1;
    return reponseGenerateur();
  });
  envoi.definirEnvoyeurMailEssai({
    nom: "essai",
    async envoyer(message) {
      mails.push({ a: message.a, objet: message.objet, pieces: message.pieces?.length ?? 0, texte: message.texte });
      return { identifiant: `essai-${mails.length}` };
    },
  });
});
beforeEach(() => {
  appelsGenerateur = 0;
  mails = [];
});
after(async () => {
  travaux.definirGenerateurEssai(null);
  envoi.oublierEnvoyeurMailEssai();
  await prisma.$disconnect();
});

describe("POST /api/simulate — nouveau contrat asynchrone", () => {
  test("création → 202 { travailId, attenteEstimeeS }, travail EN_ATTENTE avec sa photo sur le volume, tâche SIMULATION_SITE en file", async () => {
    const p = parcours();
    const { travailId, attenteEstimeeS } = await creer(p);
    assert.equal(attenteEstimeeS, 75, "sans historique : 75 s");
    const t = await travailDe(travailId);
    assert.deepEqual([t.statut, t.parcoursId, t.projet, t.promptTexte, t.etape, t.demarreLe], ["EN_ATTENTE", p, "cuisine", PROMPT, null, null]);
    assert.deepEqual(JSON.parse(t.references), REFERENCES);
    assert.deepEqual(JSON.parse(t.swatchUrls), SWATCHES);
    assert.equal(t.photoPath, `site/${p}/travaux/${travailId}.jpg`);
    assert.ok(existsSync(path.join(process.env.UPLOADS_DIR!, t.photoPath!)));
    const tache = await prisma.tache.findUniqueOrThrow({ where: { cle: `simulation-site:${travailId}` } });
    assert.deepEqual([tache.type, tache.statut, tache.tentativesMax, JSON.parse(tache.charge)], ["SIMULATION_SITE", "EN_ATTENTE", 1, { travailId }]);
    assert.equal(appelsGenerateur, 0, "rien n'est généré dans la requête");
  });

  test("ordre des vérifications : expiration, signature, puis quota — une signature fausse ne consomme rien ; le quota se lit ensuite", async () => {
    const ip = "203.0.113.50";
    const p = parcours();
    const expire = Date.now() - 1000;
    const perime = await route.POST(requete({ ...corpsValide(p), exp: expire, sig: signer(expire, p) }, { ip }));
    assert.equal(perime.status, 401);
    assert.equal(((await perime.json()) as { reason: string }).reason, "expired");
    const { LIMITE_SIMULATIONS } = await import("@/lib/acces/limite-site");
    for (let i = 0; i < LIMITE_SIMULATIONS.parIp; i++) {
      const forgee = await route.POST(requete({ ...corpsValide(p), sig: "00".repeat(32) }, { ip }));
      assert.equal(forgee.status, 401);
      assert.equal(((await forgee.json()) as { reason: string }).reason, "bad-signature");
    }
    assert.equal((await route.POST(requete(corpsValide(p), { ip }))).status, 202, "les requêtes forgées n'ont rien décompté");
    // Le quota tient toujours : depuis une autre adresse, la 16e vraie demande est refusée.
    const ip2 = "203.0.113.51";
    for (let i = 0; i < LIMITE_SIMULATIONS.parIp; i++) assert.equal((await route.POST(requete(corpsValide(parcours()), { ip: ip2 }))).status, 202);
    const refus = await route.POST(requete(corpsValide(parcours()), { ip: ip2 }));
    assert.equal(refus.status, 429);
    assert.equal(((await refus.json()) as { reason: string }).reason, "ip-quota");
    await viderLaFile();
  });

  test("origine étrangère → 403 (POST et GET) ; localhost hors production accepté", async () => {
    const p = parcours();
    assert.equal((await route.POST(requete(corpsValide(p), { origin: "https://pirate.example" }))).status, 403);
    assert.equal((await route.GET(new NextRequest(`http://localhost/api/simulate?id=abcdefghijkl&p=${p}`, { headers: { origin: "https://pirate.example" } }))).status, 403);
    const local = await route.POST(requete(corpsValide(p), { origin: "http://localhost:3000" }));
    assert.equal(local.status, 202);
    assert.equal(local.headers.get("access-control-allow-origin"), "http://localhost:3000");
    assert.match(local.headers.get("access-control-allow-methods") ?? "", /GET/);
  });

  test("ancien contrat synchrone (sans « asynchrone ») : retiré en partie 4 — 400 « contrat », rien de généré", async () => {
    const p = parcours();
    const { asynchrone: _retire, ...ancien } = corpsValide(p);
    void _retire;
    const reponse = await route.POST(requete(ancien, { ip: "203.0.113.60" }));
    assert.equal(reponse.status, 400);
    const corps = (await reponse.json()) as { reason: string; error: string };
    assert.equal(corps.reason, "contrat");
    assert.match(corps.error, /rechargez la page/);
    assert.equal(appelsGenerateur, 0);
    assert.equal(await prisma.travailSimulation.count({ where: { parcoursId: p } }), 0);
  });
});

describe("tâche SIMULATION_SITE et suivi", () => {
  test("la tâche passe EN_COURS puis PRETE : SimulationSite créée, dureeMs posé ; GET rend l'image en data URL et /image la sert ; mauvais parcours → 404", async () => {
    await viderLaFile();
    const p = parcours();
    const { travailId } = await creer(p);
    const enAttente = (await (await suivre(travailId, p)).json()) as { statut: string; etape: string | null; attenteEstimeeS: number };
    assert.deepEqual([enAttente.statut, enAttente.etape, enAttente.attenteEstimeeS], ["EN_ATTENTE", null, 75]);
    assert.equal((await suivre(travailId, parcours())).status, 404, "un autre parcours ne voit rien");
    assert.equal((await suivre("zzzzzzzzzzzz", p)).status, 404);

    const photoTravail = path.join(process.env.UPLOADS_DIR!, `site/${p}/travaux/${travailId}.jpg`);
    assert.ok(existsSync(photoTravail));
    await executeur.executerTour();
    await executeur.attendreTachesLongues();
    assert.equal(appelsGenerateur, 1);
    const t = await travailDe(travailId);
    assert.deepEqual([t.statut, t.etape, t.erreurRaison], ["PRETE", "rendu", null]);
    assert.ok(t.demarreLe && t.termineLe && t.dureeMs !== null && t.dureeMs >= 0);
    assert.ok(t.simulationSiteId);
    // La photo du travail ne sert plus (la SimulationSite garde l'avant) : effacée du volume, dossier travaux/ retiré.
    assert.equal(t.photoPath, null);
    assert.equal(existsSync(photoTravail), false, "photo du travail effacée après PRETE");
    assert.equal(existsSync(path.dirname(photoTravail)), false, "dossier travaux/ vide retiré");
    const simulation = await prisma.simulationSite.findUniqueOrThrow({ where: { id: t.simulationSiteId! } });
    assert.deepEqual([simulation.parcoursId, simulation.projet, simulation.referenceChoisie, simulation.dureeMs], [p, "cuisine", "NE31", 1234]);
    assert.ok(simulation.imageAfterPath && existsSync(path.join(process.env.UPLOADS_DIR!, simulation.imageAfterPath)));
    assert.equal((await prisma.tache.findUniqueOrThrow({ where: { cle: `simulation-site:${travailId}` } })).statut, "TERMINEE");

    const reponse = await suivre(travailId, p);
    assert.equal(reponse.headers.get("cache-control"), "no-store");
    const pret = (await reponse.json()) as { statut: string; etape: string; image: string; imageAvant: string | null; simulationSiteId: string; references: unknown };
    assert.deepEqual([pret.statut, pret.etape, pret.simulationSiteId], ["PRETE", "rendu", t.simulationSiteId]);
    assert.match(pret.image, /^data:image\/png;base64,/);
    assert.match(pret.imageAvant ?? "", /^data:image\/jpeg;base64,/, "la photo avant, gardée au format du rendu");
    assert.deepEqual(pret.references, REFERENCES);

    const image = await routeImage.GET(new NextRequest(`http://localhost/api/simulate/image?id=${travailId}&p=${p}&quoi=apres`));
    assert.equal(image.status, 200);
    assert.equal(image.headers.get("content-type"), "image/png");
    assert.equal(Buffer.from(await image.arrayBuffer()).length, PIXEL_OCTETS.length);
    assert.equal((await routeImage.GET(new NextRequest(`http://localhost/api/simulate/image?id=${travailId}&p=${parcours()}&quoi=apres`))).status, 404);
    // La médiane des durées sert d'attente annoncée (arrondie, jamais sous 15 s).
    assert.equal(await lecture.attenteEstimeeS(), Math.max(15, Math.round(t.dureeMs! / 1000)));
    assert.equal(lecture.medianeEnSecondes([]), 75);
    assert.equal(lecture.medianeEnSecondes([90_000, 30_000, 60_000]), 60);
    assert.equal(lecture.medianeEnSecondes([40_000, 80_000]), 60);
  });

  test("échec classé : ECHEC + raison + message lisibles au suivi et dans « Sur le site cette semaine »", async () => {
    const p = parcours();
    const { travailId } = await creer(p);
    reponseGenerateur = async () => ({ ok: false, dureeMs: 10, status: 503, raison: "service-indisponible", message: MESSAGES_ECHEC["service-indisponible"] });
    try {
      await executeur.executerTour();
      await executeur.attendreTachesLongues();
    } finally {
      reponseGenerateur = async () => ({ ok: true, image: PIXEL_OCTETS, type: "image/png", avant: null, taille: "1024x1024", dureeMs: 1234, usage: { texte: 10, image: 20, sortie: 30 }, coutDollars: 0.02, generationId: null });
    }
    const t = await travailDe(travailId);
    assert.deepEqual([t.statut, t.erreurRaison], ["ECHEC", "service-indisponible"]);
    const suivi = (await (await suivre(travailId, p)).json()) as { statut: string; erreur?: { raison: string; message: string } };
    assert.equal(suivi.statut, "ECHEC");
    assert.equal(suivi.erreur?.raison, "service-indisponible");
    assert.ok(suivi.erreur?.message);
    const recents = await lecture.travauxSiteRecents(7);
    const ligne = recents.lignes.find((l) => l.id === travailId);
    assert.deepEqual([ligne?.statut, ligne?.erreurRaison, ligne?.projetLibelle, ligne?.teintes, ligne?.prevenir], ["ECHEC", "service-indisponible", "Cuisine", "Crédence : Chêne clair (NE31)", false]);
    assert.ok(recents.enEchec >= 1);
  });

  test("réclamation double (redéploiement pendant la génération) : ECHEC « interrompue » sans rappeler OpenAI ; un travail fini ne bouge plus", async () => {
    const p = parcours();
    const { travailId } = await creer(p);
    await prisma.travailSimulation.update({ where: { id: travailId }, data: { statut: "EN_COURS", demarreLe: new Date(Date.now() - 30_000), etape: "rendu" } });
    const resultat = await travaux.executerTravailSimulation(travailId);
    assert.deepEqual(resultat, { statut: "ECHEC", raison: "interrompue" });
    assert.equal(appelsGenerateur, 0, "OpenAI n'est pas rappelé");
    const t = await travailDe(travailId);
    assert.deepEqual([t.statut, t.erreurRaison, t.erreurMessage], ["ECHEC", "interrompue", lecture.MESSAGE_INTERROMPUE]);
    assert.deepEqual(await travaux.executerTravailSimulation(travailId), { statut: "INCHANGE", raison: "ECHEC" });
    assert.equal(appelsGenerateur, 0);
    await viderLaFile();
  });

  test("délai de la tâche dépassé (signal) : ECHEC « delai » tout de suite ; un travail EN_COURS trop vieux se lit aussi en échec", async () => {
    const p = parcours();
    const { travailId } = await creer(p);
    let liberer: () => void = () => undefined;
    reponseGenerateur = () => new Promise((resoudre) => {
      liberer = () => resoudre({ ok: false, dureeMs: 1, status: 502, raison: "surcharge", message: "tard" });
    });
    const controleur = new AbortController();
    try {
      const execution = travaux.executerTravailSimulation(travailId, controleur.signal);
      await new Promise((r) => setTimeout(r, 20));
      controleur.abort();
      assert.deepEqual(await execution, { statut: "ECHEC", raison: "delai" });
    } finally {
      liberer();
      reponseGenerateur = async () => ({ ok: true, image: PIXEL_OCTETS, type: "image/png", avant: null, taille: "1024x1024", dureeMs: 1234, usage: { texte: 10, image: 20, sortie: 30 }, coutDollars: 0.02, generationId: null });
    }
    assert.equal((await travailDe(travailId)).erreurRaison, "delai");

    const perdu = await prisma.travailSimulation.create({ data: { parcoursId: p, projet: "meubles", statut: "EN_COURS", demarreLe: new Date(Date.now() - 11 * 60_000), swatchUrls: "[]" } });
    assert.equal(lecture.statutLu(perdu).statut, "ECHEC");
    assert.equal(lecture.statutLu(perdu).erreur?.raison, "delai");
    assert.equal(lecture.statutLu({ ...perdu, demarreLe: new Date() }).statut, "EN_COURS");
    await viderLaFile();
  });

  test("purge à 30 jours : photo du travail effacée, ligne archivée sans IP ni consigne, le suivi répond « purgee » ; un travail récent reste", async () => {
    const p = parcours();
    const { travailId: vieux } = await creer(p);
    const { travailId: recent } = await creer(p);
    await viderLaFile();
    const ilYA31Jours = new Date(Date.now() - 31 * 24 * 3600 * 1000);
    await prisma.travailSimulation.update({ where: { id: vieux }, data: { statut: "ECHEC", erreurRaison: "erreur", createdAt: ilYA31Jours } });
    const photoVieux = path.join(process.env.UPLOADS_DIR!, `site/${p}/travaux/${vieux}.jpg`);
    const photoRecent = path.join(process.env.UPLOADS_DIR!, `site/${p}/travaux/${recent}.jpg`);
    assert.ok(existsSync(photoVieux) && existsSync(photoRecent));
    assert.equal(await simulationsSite.purgerTravauxSimulation(), 1);
    assert.equal(existsSync(photoVieux), false, "photo effacée");
    assert.ok(existsSync(photoRecent), "le travail récent garde sa photo");
    const archive = await travailDe(vieux);
    assert.ok(archive.archiveLe);
    assert.deepEqual([archive.photoPath, archive.ipOrigine, archive.promptTexte, archive.statut], [null, null, null, "ECHEC"]);
    const suivi = await suivre(vieux, p);
    assert.equal(suivi.status, 200, "la ligne existe toujours : jamais de suppression");
    const corps = (await suivi.json()) as { statut: string; erreur?: { raison: string; message: string } };
    assert.deepEqual([corps.statut, corps.erreur?.raison, corps.erreur?.message], ["ECHEC", "purgee", lecture.MESSAGE_PURGEE]);
    assert.equal(((await (await suivre(recent, p)).json()) as { statut: string }).statut, "EN_ATTENTE");
    assert.equal(await simulationsSite.purgerTravauxSimulation(), 0, "rien à purger une seconde fois");
  });

  test("volume inaccessible : la photo n'est pas écrite → ECHEC « stockage » (pas « photo refusée »), générateur jamais appelé, quota rendu", async () => {
    const ip = "203.0.113.80";
    const dossierSain = process.env.UPLOADS_DIR!;
    // Un FICHIER à la place du dossier des téléversements : toute écriture échoue (ENOTDIR), comme un volume plein ou sans droit.
    const fichier = path.join(dossierSain, "pas-un-dossier");
    writeFileSync(fichier, "x");
    process.env.UPLOADS_DIR = fichier;
    let travailId: string;
    try {
      ({ travailId } = await creer(parcours(), ip));
    } finally {
      process.env.UPLOADS_DIR = dossierSain;
    }
    const t = await travailDe(travailId);
    assert.deepEqual([t.statut, t.erreurRaison, t.erreurMessage, t.photoPath], ["ECHEC", "stockage", lecture.MESSAGE_STOCKAGE, null]);
    assert.equal(await prisma.tache.count({ where: { cle: `simulation-site:${travailId}` } }), 0, "aucune tâche mise en file");
    assert.equal(appelsGenerateur, 0);
    const suivi = (await (await suivre(travailId, t.parcoursId)).json()) as { erreur?: { raison: string; message: string } };
    assert.equal(suivi.erreur?.raison, "stockage");
    assert.doesNotMatch(suivi.erreur?.message ?? "", /sombre|floue/, "le message n'accuse pas la photo du visiteur");
    // Le quota a été rendu : cette adresse dispose encore de toutes ses simulations du jour.
    const { LIMITE_SIMULATIONS } = await import("@/lib/acces/limite-site");
    for (let i = 0; i < LIMITE_SIMULATIONS.parIp; i++) assert.equal((await route.POST(requete(corpsValide(parcours()), { ip }))).status, 202, `simulation ${i + 1} acceptée`);
    assert.equal((await route.POST(requete(corpsValide(parcours()), { ip }))).status, 429);
    // Une photo vide, elle, reste « photo refusée » (c'est la photo, pas le volume).
    const reponse = await route.POST(requete(corpsValide(parcours(), { photo_base64: "data:image/png;base64,QUJD" }), { ip: "203.0.113.81" }));
    assert.equal(reponse.status, 202);
    const refusee = await travailDe(((await reponse.json()) as { travailId: string }).travailId);
    assert.deepEqual([refusee.statut, refusee.erreurRaison], ["ECHEC", "photo-refusee"]);
    await viderLaFile();
  });
});

describe("« Me prévenir »", () => {
  const demander = (corps: unknown, ip = "203.0.113.70") => routePrevenir.POST(new NextRequest("http://localhost/api/simulate/prevenir", { method: "POST", body: JSON.stringify(corps), headers: { "content-type": "application/json", "x-forwarded-for": ip } }));

  test("e-mail : lead du parcours créé UNE fois (source SITE_SIMULATEUR, note, consentement, alerte), adresse sur le travail ; PRETE → un seul mail (rendu joint, lien avec travail ET parcours), jamais deux", async () => {
    const p = parcours();
    const { travailId } = await creer(p);
    const alertesAvant = await prisma.alerteEnvoi.count({ where: { origine: "lead-site" } });
    assert.equal((await demander({ travailId, parcoursId: p, email: "camille.essai@example.test" })).status, 400, "consentement exigé");
    const autreParcours = await demander({ travailId, parcoursId: parcours(), email: "camille.essai@example.test", consentement: true });
    assert.equal(autreParcours.status, 404, "autre parcours : rien");
    assert.match(((await autreParcours.json()) as { error: string }).error, /relancez-la/, "le message dit quoi faire");
    const invalide = await demander({ travailId, parcoursId: p, email: "pas-une-adresse", consentement: true });
    assert.equal(invalide.status, 400);
    assert.match(((await invalide.json()) as { error: string }).error, /vérifiez-la/);
    const ok = await demander({ travailId, parcoursId: p, email: "Camille.Essai@example.test ", consentement: true, consentementTexte: "Case cochée sur le site (essai)" });
    assert.equal(ok.status, 200);
    assert.deepEqual(await ok.json(), { ok: true, notifie: false });
    assert.equal((await demander({ travailId, parcoursId: p, email: "camille.essai@example.test", consentement: true })).status, 200, "rejouable");
    const leads = await prisma.lead.findMany({ where: { parcoursId: p } });
    assert.equal(leads.length, 1, "un seul lead");
    assert.deepEqual([leads[0].source, leads[0].email, leads[0].typeProjet, leads[0].prenom], ["SITE_SIMULATEUR", "camille.essai@example.test", "CUISINE", "Inconnu"]);
    const notes = await prisma.interaction.findMany({ where: { leadId: leads[0].id, type: "NOTE" } });
    assert.equal(notes.length, 1, "une seule note");
    assert.match(notes[0].contenu, /^En attente du rendu : a demandé à être prévenu par e-mail \(camille\.essai@example\.test\)\. Simulation cuisine : Crédence : Chêne clair \(NE31\)\.$/);
    // Comme par le webhook : la case cochée est enregistrée UNE fois (preuve = son texte), et Lucas est alerté une fois.
    assert.ok(leads[0].clientId, "lead rattaché à un client");
    const consentements = await prisma.consentementMail.findMany({ where: { clientId: leads[0].clientId! } });
    assert.equal(consentements.length, 1, "un seul consentement malgré la demande rejouée");
    assert.deepEqual([consentements[0].statut, consentements[0].moyen, consentements[0].preuve], ["ACCORDE", "FORMULAIRE_SITE", "Case cochée sur le site (essai)"]);
    assert.equal(await prisma.alerteEnvoi.count({ where: { origine: "lead-site" } }), alertesAvant + 1, "une alerte pour le nouveau contact, pas deux");
    const t = await travailDe(travailId);
    assert.deepEqual([t.notifierEmail, t.notifierTelephone, t.leadId, t.notifieLe], ["camille.essai@example.test", null, leads[0].id, null]);
    assert.equal(mails.length, 0, "rien ne part avant le rendu");

    await executeur.executerTour();
    await executeur.attendreTachesLongues();
    assert.equal((await travailDe(travailId)).statut, "PRETE");
    assert.equal(mails.length, 1);
    assert.deepEqual([mails[0].a, mails[0].objet, mails[0].pieces], ["camille.essai@example.test", "Votre simulation CoverSwap est prête", 1]);
    assert.ok(mails[0].texte.includes(`https://coverswap.fr/simulateur?reprise=${travailId}&p=${p}`), "le lien porte le travail ET le parcours (autre appareil, sans mémoire locale)");
    assert.equal(prevenir.lienDeReprise("cmun000000000001", p), `https://coverswap.fr/simulateur?reprise=cmun000000000001&p=${p}`);
    assert.ok((await travailDe(travailId)).notifieLe);
    assert.deepEqual(await prevenir.notifierTravailPret(travailId), { envoye: false, raison: "Déjà envoyé." });
    assert.equal((await demander({ travailId, parcoursId: p, email: "camille.essai@example.test", consentement: true })).status, 200);
    assert.equal(mails.length, 1, "jamais deux");
    // La simulation a rejoint la fiche du lead (rattachement au lead du parcours).
    assert.ok((await prisma.simulationSite.findUniqueOrThrow({ where: { id: (await travailDe(travailId)).simulationSiteId! } })).leadId === leads[0].id);
    const trace = await prisma.interaction.findMany({ where: { leadId: leads[0].id, type: "EMAIL" } });
    assert.equal(trace.length, 1);
    // Le rendu se lit toujours par adresse après le rattachement (les fichiers ont été déplacés sous le lead).
    assert.equal((await routeImage.GET(new NextRequest(`http://localhost/api/simulate/image?id=${travailId}&p=${p}`))).status, 200);
  });

  test("téléphone seul : lead créé, note « aucun SMS automatique », alerte à Lucas, aucun mail ; demande après PRETE → mail tout de suite", async () => {
    const p = parcours();
    const { travailId } = await creer(p);
    const alertesAvant = await prisma.alerteEnvoi.count({ where: { origine: "lead-site" } });
    assert.equal((await demander({ travailId, parcoursId: p, telephone: "06 12 34 56 78", consentement: true })).status, 200);
    const lead = await prisma.lead.findFirstOrThrow({ where: { parcoursId: p } });
    assert.equal(lead.telephone, "+33612345678");
    assert.match((await prisma.interaction.findFirstOrThrow({ where: { leadId: lead.id, type: "NOTE" } })).contenu, /par téléphone \(\+33612345678\) — aucun SMS automatique : à rappeler quand le rendu est prêt/);
    assert.equal(await prisma.alerteEnvoi.count({ where: { origine: "lead-site" } }), alertesAvant + 1, "le téléphone de Lucas sonne : c'est lui qui rappelle");
    await executeur.executerTour();
    await executeur.attendreTachesLongues();
    assert.equal((await travailDe(travailId)).statut, "PRETE");
    assert.equal(mails.length, 0, "téléphone seul : rien ne part");
    // Il donne finalement son adresse alors que c'est prêt : le mail part maintenant, même lead.
    const tard = await demander({ travailId, parcoursId: p, telephone: "0612345678", email: "camille.tard@example.test", consentement: true });
    assert.deepEqual(await tard.json(), { ok: true, notifie: true });
    assert.equal(mails.length, 1);
    assert.equal(await prisma.lead.count({ where: { parcoursId: p } }), 1);
    assert.equal((await prisma.lead.findFirstOrThrow({ where: { parcoursId: p } })).email, "camille.tard@example.test");
  });

  test("e-mail d'abord, puis un numéro : le numéro rejoint la fiche du lead (pas seulement la note), et Lucas est alerté pour ce numéro", async () => {
    const p = parcours();
    const { travailId } = await creer(p);
    assert.equal((await demander({ travailId, parcoursId: p, email: "camille.numero@example.test", consentement: true })).status, 200);
    const lead = await prisma.lead.findFirstOrThrow({ where: { parcoursId: p } });
    assert.equal(lead.telephone, "", "créé avec l'adresse seule");
    const alertesAvant = await prisma.alerteEnvoi.count({ where: { origine: "lead-site" } });
    assert.equal((await demander({ travailId, parcoursId: p, email: "camille.numero@example.test", telephone: "06 98 76 54 32", consentement: true })).status, 200);
    const relu = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
    assert.deepEqual([relu.telephone, relu.email], ["+33698765432", "camille.numero@example.test"]);
    assert.equal(await prisma.lead.count({ where: { parcoursId: p } }), 1, "même lead");
    assert.deepEqual([(await travailDe(travailId)).notifierTelephone, (await travailDe(travailId)).notifierEmail], ["+33698765432", "camille.numero@example.test"]);
    assert.equal(await prisma.alerteEnvoi.count({ where: { origine: "lead-site" } }), alertesAvant + 1, "un numéro à rappeler : Lucas le voit");
    await viderLaFile();
  });

  test("anonymisation RGPD : les travaux du parcours du lead partent aussi, même sans « Me prévenir » (photo, IP, consigne effacées)", async () => {
    const p = parcours();
    const { travailId } = await creer(p);
    await viderLaFile();
    const anonymisation = await import("@/lib/rgpd/anonymisation");
    const client = await prisma.client.create({ data: { nom: "Effacee", prenom: "Camille", source: "ENTRANT", premierContactLe: new Date() } });
    // Le lead vient du webhook (demande de devis après la simulation) : même parcours, aucun leadId sur le travail.
    await prisma.lead.create({ data: { nom: "Effacee", prenom: "Camille", telephone: "0600000015", email: "camille.effacee@example.test", ville: "Pérols", source: "SITE_SIMULATEUR", parcoursId: p, clientId: client.id } });
    assert.equal((await travailDe(travailId)).leadId, null);
    const apercu = await anonymisation.apercuAnonymisation(client.id);
    assert.equal(apercu.efface.photos, 1, "la photo du travail est comptée dans ce qui part");
    await prisma.$transaction((tx) => anonymisation.anonymiserDansTransaction(tx, client.id, { decidePar: "essai" }), { timeout: 60_000 });
    const t = await travailDe(travailId);
    assert.deepEqual([t.photoPath, t.ipOrigine, t.promptTexte, t.notifierEmail, t.references], [null, null, null, null, "[]"]);
    assert.deepEqual([t.projet, t.statut], ["cuisine", "EN_ATTENTE"], "projet et statut gardés");
    const effacement = await prisma.tache.findUniqueOrThrow({ where: { cle: `rgpd-effacement:${client.id}` } });
    assert.ok((JSON.parse(effacement.charge) as { chemins: string[] }).chemins.includes(`site/${p}/travaux/${travailId}.jpg`), "le fichier est dans la tâche d'effacement");
  });

  test("interrupteur NOTIF_SIMULATION_SITE_PRETE coupé → pas de mail ; il se lit et se règle comme les autres automatismes", async () => {
    const liste = await interrupteurs.listerAutomatismes();
    assert.equal(liste.find((a) => a.code === "NOTIF_SIMULATION_SITE_PRETE")?.actif, true, "actif par défaut");
    const reglage = await interrupteurs.reglerAutomatisme("NOTIF_SIMULATION_SITE_PRETE", false, "essai");
    assert.deepEqual([reglage.avant.actif, reglage.apres.actif], [true, false]);
    assert.equal(await prevenir.notificationSitePreteActive(), false);
    try {
      const p = parcours();
      const { travailId } = await creer(p);
      assert.equal((await demander({ travailId, parcoursId: p, email: "camille.coupe@example.test", consentement: true })).status, 200);
      await executeur.executerTour();
      await executeur.attendreTachesLongues();
      const t = await travailDe(travailId);
      assert.deepEqual([t.statut, t.notifieLe, mails.length], ["PRETE", null, 0]);
      assert.deepEqual(await prevenir.notifierTravailPret(travailId), { envoye: false, raison: "Interrupteur NOTIF_SIMULATION_SITE_PRETE coupé." });
    } finally {
      await interrupteurs.reglerAutomatisme("NOTIF_SIMULATION_SITE_PRETE", true, "essai");
    }
    assert.equal(await prevenir.notificationSitePreteActive(), true);
  });
});

describe("voie longue de l'exécuteur", () => {
  test("une tâche longue en cours n'empêche pas une courte de passer ; 3 longues → 2 en cours, 1 en attente, puis la 3e quand une place se libère", async () => {
    await viderLaFile();
    const attentes = new Map<string, () => void>();
    registre.enregistrerTraitement("ESSAI_LONGUE", {
      libelle: "Essai long",
      acteur: "SYSTEME:essai",
      voie: "longue",
      executer: (charge) =>
        new Promise<string>((resoudre) => {
          attentes.set((charge as { n: string }).n, () => resoudre("fini"));
        }),
    });
    registre.enregistrerTraitement("ESSAI_COURTE", { libelle: "Essai court", acteur: "SYSTEME:essai", executer: async () => "vite" });
    for (const n of ["a", "b", "c"]) await file.mettreEnFile({ type: "ESSAI_LONGUE", cle: `longue-${n}`, charge: { n }, priorite: 7 });
    await file.mettreEnFile({ type: "ESSAI_COURTE", cle: "courte-1" });

    await executeur.executerTour();
    const statut = async (cle: string) => (await prisma.tache.findUniqueOrThrow({ where: { cle } })).statut;
    assert.equal(await statut("courte-1"), "TERMINEE", "la courte est passée pendant que les longues tournent");
    // Les longues sont lancées sans être attendues (c'est le principe) : on leur laisse le temps de réclamer leur ligne.
    for (let i = 0; i < 200 && attentes.size < 2; i++) await new Promise((r) => setTimeout(r, 25));
    assert.deepEqual([await statut("longue-a"), await statut("longue-b"), await statut("longue-c")], ["EN_COURS", "EN_COURS", "EN_ATTENTE"]);
    assert.equal(executeur.tachesLonguesEnCours(), 2);
    assert.equal(attentes.size, 2);

    attentes.get("a")!();
    // La place se libère quand la tâche a fini d'écrire son résultat (pas à un délai fixe : la machine peut être chargée).
    for (let i = 0; i < 200 && executeur.tachesLonguesEnCours() !== 1; i++) await new Promise((r) => setTimeout(r, 25));
    assert.equal(executeur.tachesLonguesEnCours(), 1);
    await executeur.executerTour();
    assert.deepEqual([await statut("longue-a"), await statut("longue-c")], ["TERMINEE", "EN_COURS"]);
    assert.equal(executeur.tachesLonguesEnCours(), 2);
    attentes.get("b")!();
    attentes.get("c")!();
    await executeur.attendreTachesLongues();
    assert.deepEqual([await statut("longue-b"), await statut("longue-c")], ["TERMINEE", "TERMINEE"]);
    assert.equal(executeur.tachesLonguesEnCours(), 0);
  });
});
