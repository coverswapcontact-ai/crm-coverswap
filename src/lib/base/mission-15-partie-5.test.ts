import assert from "node:assert/strict";
import { existsSync, mkdtempSync, promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, beforeEach, describe, test } from "node:test";
import { NextRequest } from "next/server";
import { ErreurMetier } from "@/lib/commun/erreurs";
import { preparerBaseEssai } from "@/test/base-essai";

preparerBaseEssai();
process.env.UPLOADS_DIR = mkdtempSync(path.join(tmpdir(), "coverswap-m15-5-"));

/**
 * Mission 15 (partie 5) — l'espace client, même moteur que le site : pièces et zones de la source unique (MURS et le
 * tablier de baignoire proposés), analyse d'une photo du dossier par jeton (même cache par empreinte, réutilisée par la
 * génération), suivi avec l'étape et l'attente estimée, contrôle automatique avant publication (sous le seuil après deux
 * tentatives → BROUILLON + alerte, le client lit « relecture » ; sinon PUBLIEE). OpenAI est SIMULÉ (générateur et vision
 * injectés) : aucun appel réseau, aucune image générée. Noms fictifs.
 */

let prisma: typeof import("@/lib/prisma").default;
let route: typeof import("@/app/api/espace/[jeton]/[[...action]]/route");
let generation: typeof import("@/lib/simulations/generation");
let vision: typeof import("@/lib/simulateur/moteur/vision");
let executeur: typeof import("@/lib/taches/executeur");
let preparation: typeof import("@/lib/simulateur/preparation");
let service: typeof import("@/lib/espace/service");
let simulateurEspace: typeof import("@/lib/espace/simulateur");
let liens: typeof import("@/lib/espace/liens");
let sharp: typeof import("sharp");

const REFERENCES_CATALOGUE = [
  { id: "AB02", nom: "Creamy", famille: "couleur", categorie: "Color", finition: "Soft", image: "https://ssi.s3.fr-par.scw.cloud/essai/ab02.jpg", tags: ["crème"], hex: "#EDE6D6" },
  { id: "D1", nom: "Classic Walnut", famille: "bois", categorie: "Dark", finition: "Soft", image: "https://ssi.s3.fr-par.scw.cloud/essai/d1.jpg", tags: ["noyer"] },
  { id: "AL23", nom: "Grey Marble", famille: "pierre", categorie: "Stone", finition: "Soft", image: "https://ssi.s3.fr-par.scw.cloud/essai/al23.jpg", tags: ["marbre"] },
];

let PHOTO_JPEG: Buffer;
let RENDU_JPEG: Buffer;

const ANALYSE_JSON = {
  description: "A small bathroom seen from the door: a white vanity unit, grey wall tiles and a bath with a panel.",
  zones_visibles: { "meuble-vasque": { visible: true, description: "vanity unit on the left" }, "plan-vasque": { visible: true, description: "white top" }, "carrelage-mural": { visible: true, description: "grey tiles" }, "tablier-baignoire": { visible: false, description: "" } },
  objets: ["a towel", "a mirror"],
  lumiere: { source: "ceiling light", direction: "from above", temperature: "neutral", dominante: "none" },
  format: "paysage",
  qualite_photo: { verdict: "bonne", conseil: "" },
};

let appelsVision: { schema: string }[] = [];
let scoresControle: number[] = [];
let appelsGenerateur: import("@/lib/simulations/generation").EntreeGeneration[] = [];

let horlogeParametres = Date.now() - 3_600_000;
async function poserParametre(cle: string, valeur: string | number) {
  horlogeParametres += 1000;
  await prisma.parametre.create({ data: { cle, valeur: JSON.stringify(valeur), valableDu: new Date(horlogeParametres) } });
}
const DEFAUTS: Record<string, string | number> = { SIMULATEUR_MOTEUR: "V1", SIMULATEUR_SEUIL_CONTROLE: "7", IA_BUDGET_MENSUEL: 1000 };
async function retirerParametre(cle: string) {
  await poserParametre(cle, DEFAUTS[cle]);
}
async function image(largeur: number, hauteur: number, couleur: { r: number; g: number; b: number }): Promise<Buffer> {
  return sharp({ create: { width: largeur, height: hauteur, channels: 3, background: couleur } }).jpeg({ quality: 80 }).toBuffer();
}

let numeroIp = 10;
/** `projet` : le code du projet visé (`?projet=`) — sans lui, le seul projet EN COURS s'ouvre ; un projet figé se vise par son code. */
const requete = (jeton: string, chemin: string, corps?: unknown, methode = corps === undefined ? "GET" : "POST", projet?: string) =>
  new NextRequest(`http://localhost/api/espace/${jeton}${chemin}${projet ? `?projet=${projet}` : ""}`, { method: methode, ...(corps === undefined ? {} : { body: JSON.stringify(corps) }), headers: { "content-type": "application/json", "x-forwarded-for": `203.0.113.${++numeroIp}` } });
const contexte = (jeton: string, chemin: string) => ({ params: Promise.resolve({ jeton, action: chemin.split("/").filter(Boolean) }) });
async function appeler<T>(jeton: string, chemin: string, corps?: unknown, projet?: string): Promise<{ status: number; corps: T }> {
  const r = requete(jeton, chemin, corps, undefined, projet);
  const reponse = corps === undefined ? await route.GET(r, contexte(jeton, chemin)) : await route.POST(r, contexte(jeton, chemin));
  return { status: reponse.status, corps: (await reponse.json()) as T };
}

/** Un dossier avec une photo du client et son espace ouvert ; jeton du lien de l'espace. Un numéro par client : un espace chacun. */
let numeroTelephone = 22_000_000;
async function espaceAvecPhoto(nom: string, octets: Buffer = PHOTO_JPEG, objet = "Recouvrement de salle de bain") {
  const { ajouterPhoto } = await import("@/lib/dossiers/dossiers");
  const dossier = await prisma.dossier.create({ data: { clientNom: nom, clientAdresse: "", clientCp: "34970", clientVille: "Lattes", clientTelephone: `+336${++numeroTelephone}`, objet, source: "ENTRANT", etape: "QUALIFICATION" } });
  const photo = await ajouterPhoto(dossier.id, new File([new Uint8Array(octets)], "piece.jpg", { type: "image/jpeg" }));
  const ouvert = await liens.ouvrirEspace(dossier.id);
  return { dossierId: dossier.id, photoId: photo.id, espace: ouvert.espace, jeton: liens.jetonEspace(ouvert.permanent) };
}

before(async () => {
  process.env.OPENAI_API_KEY = "cle-factice-jamais-appelee";
  process.env.OPENAI_BASE_URL = "http://127.0.0.1:9/jamais";
  process.env.SITE_URL = "http://127.0.0.1:9/jamais-appele";
  process.env.NEXTAUTH_SECRET = "secret-de-session-pour-les-essais";
  process.env.TACHES_DESACTIVEES = "1";
  delete process.env.ESPACE_CLIENT_SECRET;
  for (const cle of ["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID", "NTFY_TOPIC", "RESEND_API_KEY", "EMAIL_FROM"]) process.env[cle] = ""; // vide, pas supprimée : Prisma reprendrait la valeur de .env
  prisma = (await import("@/lib/prisma")).default;
  sharp = (await import("sharp")).default;
  route = await import("@/app/api/espace/[jeton]/[[...action]]/route");
  generation = await import("@/lib/simulations/generation");
  vision = await import("@/lib/simulateur/moteur/vision");
  executeur = await import("@/lib/taches/executeur");
  preparation = await import("@/lib/simulateur/preparation");
  service = await import("@/lib/espace/service");
  simulateurEspace = await import("@/lib/espace/simulateur");
  liens = await import("@/lib/espace/liens");
  await (await import("@/lib/base/preparation")).preparerBase();
  (await import("@/lib/taches/traitements")).enregistrerTousLesTraitements();
  (await import("@/lib/simulateur/catalogue")).definirCatalogueEssai(REFERENCES_CATALOGUE);
  const dossier = path.join(process.env.UPLOADS_DIR!, "simulateur", "echantillons");
  await fs.mkdir(dossier, { recursive: true });
  await fs.writeFile(path.join(dossier, "AB02.jpg"), await image(200, 200, { r: 237, g: 230, b: 214 }));
  await fs.writeFile(path.join(dossier, "D1.jpg"), await image(200, 200, { r: 107, g: 74, b: 50 }));
  await fs.writeFile(path.join(dossier, "AL23.jpg"), await image(200, 200, { r: 170, g: 170, b: 172 }));
  PHOTO_JPEG = await image(1200, 900, { r: 150, g: 150, b: 148 });
  RENDU_JPEG = await image(1536, 1024, { r: 90, g: 80, b: 70 });

  generation.definirGenerateurEssai(async (entree) => {
    appelsGenerateur.push(entree);
    return { ok: true, image: RENDU_JPEG, type: "image/jpeg", avant: null, taille: "1536x1024", dureeMs: 1500, usage: { texte: 100, image: 200, sortie: 300 }, coutDollars: 0.21, generationId: null };
  });
  vision.definirVisionEssai(async (demande) => {
    appelsVision.push({ schema: demande.schema.nom });
    if (demande.schema.nom === "analyse_photo") return { texte: JSON.stringify(ANALYSE_JSON), jetonsEntree: 1200, jetonsSortie: 300 };
    const score = scoresControle.shift() ?? 9;
    return { texte: JSON.stringify({ score, defauts: score < 7 ? [{ type: "texture", detail: "the tile joints are blurred on the left wall" }] : [], commentaire: "" }), jetonsEntree: 800, jetonsSortie: 120 };
  });
});
after(async () => {
  await executeur.attendreTachesLongues();
  await prisma.$disconnect();
});
beforeEach(() => {
  appelsVision = [];
  appelsGenerateur = [];
  scoresControle = [];
});

describe("les pièces de l'espace : la source unique du simulateur", () => {
  test("piecesPourLeClient : MURS et le tablier de baignoire proposés, les familles du projet d'abord, les zones cochées d'abord", () => {
    const pieces = simulateurEspace.piecesPourLeClient(["SDB"], { SDB: [], CUISINE: ["ilot"] });
    assert.deepEqual(pieces.map((p) => p.piece), ["SDB", "CUISINE", "MEUBLES", "MURS", "PRO"], "sa famille d'abord, puis les autres (murs compris)");
    assert.deepEqual(pieces.map((p) => p.id), ["salle-de-bain", "cuisine", "meubles", "mur-plafond", "professionnel"]);
    assert.deepEqual(pieces[0].zones.map((z) => z.zone), ["meuble-vasque", "plan-vasque", "carrelage-mural", "tablier-baignoire"]);
    assert.deepEqual(pieces.find((p) => p.piece === "MURS")!.zones.map((z) => z.zone), ["mur-principal", "mur-accent", "plafond"]);
    assert.ok(pieces.every((p) => p.zones.every((z) => z.libelle && z.description)), "libellé et description de la source unique");
    const cuisine = pieces.find((p) => p.piece === "CUISINE")!;
    assert.deepEqual(cuisine.cochees.sort(), ["meubles-bas", "plan-de-travail"], "l'îlot coché dans son Projet = meubles bas + plan");
    assert.ok(cuisine.cochees.includes(cuisine.zones[0].zone), "les zones cochées viennent en premier");
    assert.ok(!cuisine.zones.some((z) => z.zone === "facades-cuisine"), "jamais la zone composée du site : une teinte par zone");
    assert.deepEqual([pieces[0].duProjet, cuisine.duProjet], [true, false]);
  });

  test("l'état de l'espace porte les pièces, la limite de zones et les relectures ; MURS et tablier sont acceptés à la création", async () => {
    const { espace, photoId } = await espaceAvecPhoto("Espace Murs");
    const etat = await service.etatEspace(espace);
    assert.equal(etat.creation.zonesMax, 4);
    assert.deepEqual(etat.creation.enRelecture, []);
    assert.deepEqual(etat.creation.pieces.map((p) => p.piece), ["CUISINE", "SDB", "MEUBLES", "MURS", "PRO"]);
    assert.ok(etat.creation.pieces.find((p) => p.piece === "SDB")!.zones.some((z) => z.zone === "tablier-baignoire"));
    const murs = await service.creerSimulationClient(espace, { piece: "MURS", photoId, zones: [{ zone: "mur-principal", ref: "AB02" }, { zone: "plafond", ref: "AB02" }] });
    const prepMurs = await preparation.lirePreparation(murs.preparationId);
    assert.deepEqual([prepMurs.typeSurface, prepMurs.statut, prepMurs.zones.map((z) => z.zone)], ["espace-murs", "EN_COURS", ["mur-principal", "plafond"]]);
    assert.ok(murs.attenteEstimeeS >= 15, "l'attente estimée accompagne le lancement");
    // (une seule génération à la fois : c'est l'écran qui l'impose ; le serveur compte celle en cours dans le quota)
    await prisma.preparationSimulation.update({ where: { id: murs.preparationId }, data: { statut: "ECHEC", erreur: "essai" } });
    const sdb = await service.creerSimulationClient(espace, { piece: "SDB", photoId, zones: [{ zone: "tablier-baignoire", ref: "AL23" }] });
    assert.equal((await preparation.lirePreparation(sdb.preparationId)).zones[0].zone, "tablier-baignoire");
    // L'écran d'attente retrouve la photo et les teintes d'une génération en cours, même sur un autre appareil.
    const relu = await service.etatEspace(espace);
    assert.deepEqual(relu.creation.enCours.map((e) => [e.id, e.photoId, e.zones.map((z) => `${z.zone}:${z.ref}`)]), [[sdb.preparationId, photoId, ["tablier-baignoire:AL23"]]]);
  });

  test("route : cinq zones refusées avant tout coût ; la limite vient de la source unique (espace, préparations du CRM)", async () => {
    const { jeton, photoId } = await espaceAvecPhoto("Espace Cinq");
    const zones = ["comptoir-habillage", "comptoir-plateau", "mobilier-pro", "rangements-pro", "habillage-mural"].map((zone) => ({ zone, ref: "AB02" }));
    const { status, corps } = await appeler<{ error: string }>(jeton, "/simulations/creer", { piece: "PRO", photoId, zones });
    assert.equal(status, 400);
    assert.match(corps.error, /4 zones au plus/);
    assert.equal(await prisma.preparationSimulation.count({ where: { origine: "CLIENT", typeSurface: "espace-professionnel" } }), 0);
    // Le schéma des préparations du CRM (route et outil MCP) lit la même limite : plus de « 4 » en dur.
    const { ZONES_MAX } = await import("@/lib/simulateur/zones");
    const lu = preparation.schemaPreparation.safeParse({ dossierId: "d", photoId, typeSurface: "espace-professionnel", zones, mode: "API" });
    assert.equal(lu.success, false);
    assert.match(lu.success ? "" : lu.error.issues[0].message, new RegExp(`${ZONES_MAX} zones au plus`));
  });
});

describe("le suivi d'une création : l'étape et l'attente estimée", () => {
  test("EN_COURS sans étape (file d'attente), puis l'étape ; ECHEC « interrompue » dit au client ; par la route aussi", async () => {
    const { espace, photoId, jeton } = await espaceAvecPhoto("Espace Suivi");
    const { preparationId } = await service.creerSimulationClient(espace, { piece: "SDB", photoId, zones: [{ zone: "meuble-vasque", ref: "D1" }] });
    const debut = await service.suivreCreation(espace, preparationId);
    assert.deepEqual([debut.statut, debut.etape, debut.simulationId], ["EN_COURS", null, null]);
    assert.ok(Number.isFinite(debut.attenteEstimeeS) && debut.attenteEstimeeS >= 15);
    await prisma.preparationSimulation.update({ where: { id: preparationId }, data: { etape: "matieres" } });
    const parLaRoute = await appeler<{ statut: string; etape: string | null; attenteEstimeeS: number }>(jeton, `/simulations/creation/${preparationId}`);
    assert.deepEqual([parLaRoute.status, parLaRoute.corps.statut, parLaRoute.corps.etape], [200, "EN_COURS", "matieres"]);
    assert.equal(typeof parLaRoute.corps.attenteEstimeeS, "number");
    await prisma.preparationSimulation.update({ where: { id: preparationId }, data: { statut: "ECHEC", erreur: preparation.MESSAGE_INTERROMPUE_API } });
    const fin = await service.suivreCreation(espace, preparationId);
    assert.deepEqual([fin.statut, fin.raison], ["ECHEC", "interrompue"]);
    assert.match(fin.message ?? "", /interrompue par une mise à jour du service/);
  });
});

describe("contrôle automatique avant publication", () => {
  test("sous le seuil après deux tentatives → BROUILLON (source CLIENT), alerte à Lucas, le client lit « relecture », le quota n'est compté qu'une fois ; publiée par Lucas → PRETE", async () => {
    await poserParametre("SIMULATEUR_MOTEUR", "V2");
    try {
      const { espace, dossierId, photoId } = await espaceAvecPhoto("Espace Relecture");
      const alertesAvant = await prisma.alerteEnvoi.count({ where: { origine: "espace-client" } });
      scoresControle = [5, 6];
      const { preparationId } = await service.creerSimulationClient(espace, { piece: "SDB", photoId, zones: [{ zone: "meuble-vasque", ref: "D1" }, { zone: "carrelage-mural", ref: "AL23" }] });
      const { simulationId } = await preparation.executerGenerationApi(preparationId);
      assert.ok(simulationId);
      assert.equal(appelsGenerateur.length, 2, "deux tentatives, la meilleure gardée");
      assert.deepEqual(appelsVision.map((a) => a.schema), ["analyse_photo", "controle_rendu", "controle_rendu"]);
      const simulation = await prisma.simulationEspace.findUniqueOrThrow({ where: { id: simulationId! } });
      assert.deepEqual([simulation.source, simulation.statut, simulation.scoreControle, simulation.tentatives, simulation.publieeLe, simulation.vueLe], ["CLIENT", "BROUILLON", 6, 2, null, null]);
      assert.match(simulation.defautsControle ?? "", /tile joints/);
      assert.equal(await prisma.dossierEvenement.count({ where: { dossierId, type: "ESPACE_SIMULATION_RELECTURE" } }), 1);
      assert.equal(await prisma.dossierEvenement.count({ where: { dossierId, type: "ESPACE_SIMULATION_CLIENT" } }), 0);
      assert.equal((await prisma.dossier.findUniqueOrThrow({ where: { id: dossierId } })).etape, "QUALIFICATION", "gardée en brouillon : l'étape suivra sa publication");
      assert.equal(await prisma.alerteEnvoi.count({ where: { origine: "espace-client" } }), alertesAvant + 1, "Lucas est prévenu (aucun canal configuré : rien ne part)");
      // Le client : « relecture », avec l'étape et l'attente ; sa galerie ne la montre pas encore ; le quota ne l'a comptée qu'une fois.
      const suivi = await service.suivreCreation(espace, preparationId);
      assert.deepEqual([suivi.statut, suivi.etape, suivi.simulationId, suivi.message], ["RELECTURE", "rendu", simulationId, simulateurEspace.MESSAGE_RELECTURE]);
      const etat = await service.etatEspace(espace);
      assert.deepEqual(etat.creation.enRelecture.map((r) => r.id), [simulationId]);
      assert.equal(etat.simulations.length, 0, "un brouillon ne se montre pas");
      assert.deepEqual([etat.creation.faites, etat.creation.enCours.length, etat.creation.restantes], [1, 0, etat.creation.gratuites + etat.creation.accordees - 1]);
      // Le CRM la voit avec sa source, son score et ses défauts.
      const { listerSimulationsDossier } = await import("@/lib/simulations/dossier");
      const vue = (await listerSimulationsDossier(dossierId)).simulations.find((s) => s.id === simulationId)!;
      assert.deepEqual([vue.source, vue.statut, vue.scoreControle, vue.sousSeuil, vue.defautsControle.length], ["CLIENT", "BROUILLON", 6, true, 1]);
      // Lucas la publie : le client la retrouve, le quota ne bouge pas.
      const { publierSimulations } = await import("@/lib/simulations/dossier");
      await publierSimulations(dossierId, [simulationId!], { prevenir: false });
      assert.equal((await prisma.dossier.findUniqueOrThrow({ where: { id: dossierId } })).etape, "SIMULATION", "publiée : le dossier passe en Simulation (mission 18, B9)");
      assert.equal((await service.suivreCreation(espace, preparationId)).statut, "PRETE");
      const apres = await service.etatEspace(espace);
      assert.deepEqual([apres.creation.enRelecture, apres.simulations.map((s) => s.id), apres.creation.faites], [[], [simulationId], 1]);
      // Il ne l'a jamais vue : « Nouveau » dans sa galerie, jusqu'à sa première visite (le CRM sait alors qu'elle est vue).
      assert.equal(apres.simulations[0].nouvelle, true, "publiée par Lucas après relecture : nouvelle pour le client");
      await service.noterSimulationsVues(espace);
      const revue = await service.etatEspace(espace);
      assert.deepEqual([revue.simulations[0].nouvelle, Boolean((await prisma.simulationEspace.findUniqueOrThrow({ where: { id: simulationId! } })).vueLe)], [false, true]);
    } finally {
      await retirerParametre("SIMULATEUR_MOTEUR");
    }
  });

  test("au-dessus du seuil : PUBLIEE tout de suite, comme avant", async () => {
    await poserParametre("SIMULATEUR_MOTEUR", "V2");
    try {
      const { espace, dossierId, photoId } = await espaceAvecPhoto("Espace Publiee");
      // Relecture (mission 18) : un lead « Devis demandé » derrière le dossier, pour lire son statut des deux côtés.
      const lead = await prisma.lead.create({ data: { prenom: "Espace", nom: "Publiee", telephone: `+336${++numeroTelephone}`, ville: "Lattes", codePostal: "34970", source: "SITE_FORMULAIRE", statut: "DEVIS_DEMANDE" } });
      await prisma.dossier.update({ where: { id: dossierId }, data: { leadId: lead.id } });
      const actionAvant = (await prisma.dossier.findUniqueOrThrow({ where: { id: dossierId } })).prochaineAction;
      scoresControle = [8];
      const { preparationId } = await service.creerSimulationClient(espace, { piece: "SDB", photoId, zones: [{ zone: "meuble-vasque", ref: "D1" }] });
      const { simulationId } = await preparation.executerGenerationApi(preparationId);
      const simulation = await prisma.simulationEspace.findUniqueOrThrow({ where: { id: simulationId! } });
      assert.deepEqual([simulation.source, simulation.statut, simulation.scoreControle, simulation.tentatives, Boolean(simulation.publieeLe)], ["CLIENT", "PUBLIEE", 8, 1, true]);
      assert.equal(await prisma.dossierEvenement.count({ where: { dossierId, type: "ESPACE_SIMULATION_CLIENT" } }), 1);
      // Mission 18 (B9) : sa propre simulation, visible, fait passer le dossier en Simulation d'un bloc (main au client).
      const dossier = await prisma.dossier.findUniqueOrThrow({ where: { id: dossierId } });
      assert.deepEqual([dossier.etape, dossier.main, dossier.mainMotif], ["SIMULATION", "CLIENT", "Il a créé une simulation : à lui d'en valider une"]);
      assert.equal((await prisma.dossierEvenement.findFirstOrThrow({ where: { dossierId, type: "CHANGEMENT_ETAPE" }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] })).contenu, "Qualification → Simulation : simulation créée par le client dans son espace");
      // Relecture (mission 18, écart 9, voie ESPACE) : l'état des deux côtés, comme la voie du site (publier-espace.test).
      const { etatDesDeuxCotes } = await import("@/test/etat-dossier");
      const deuxCotes = await etatDesDeuxCotes(dossierId);
      assert.deepEqual(
        [deuxCotes.etape, deuxCotes.main, deuxCotes.mainCalculee, deuxCotes.prochaineAction, deuxCotes.statutLead, deuxCotes.etapeEspace],
        ["SIMULATION", "CLIENT", "CLIENT", actionAvant, "CONTACTE", "PROJET"],
        "étape, main écrite = calculée, prochaine action inchangée (comme avant), lead « Contacté » dans la transaction ; l'espace reste à « Projet » (pas encore précisé : sa propre simulation ne le saute pas, etapes.ts)"
      );
      assert.deepEqual([deuxCotes.relances.proposables, deuxCotes.relances.devis, deuxCotes.devisASigner], [[], [], []]);
      assert.deepEqual(deuxCotes.taches.filter((t) => t.type === "COHERENCE"), [], "aucune incohérence laissée");
      const etat = await service.etatEspace(espace);
      assert.deepEqual([(await service.suivreCreation(espace, preparationId)).statut, etat.creation.enRelecture], ["PRETE", []]);
      assert.equal(etat.simulations[0].nouvelle, false, "faite par lui, vue à la création : jamais « Nouveau »");
    } finally {
      await retirerParametre("SIMULATEUR_MOTEUR");
    }
  });
});

describe("l'analyse d'une photo du dossier, par jeton", () => {
  test("POST 202 → tâche ANALYSE_PHOTO (comptée à l'espace, sur le dossier) → GET PRETE ; la photo d'attente est effacée ; redemandée : 200 sans tâche ; la génération réutilise l'analyse ; un autre espace lit 404", async () => {
    await poserParametre("SIMULATEUR_MOTEUR", "V2");
    try {
      // Une photo à elle (les autres essais partagent la même : son analyse serait déjà connue).
      const { espace, dossierId, photoId, jeton } = await espaceAvecPhoto("Espace Analyse", await image(1200, 900, { r: 60, g: 90, b: 120 }));
      const tachesAvant = await prisma.tache.count({ where: { type: "ANALYSE_PHOTO" } });
      const demande = await appeler<{ empreinte: string; statut: string; nouvelle: boolean }>(jeton, "/simulations/analyse", { photoId, piece: "SDB" });
      assert.deepEqual([demande.status, demande.corps.statut, demande.corps.nouvelle], [202, "EN_COURS", true]);
      assert.match(demande.corps.empreinte, /^[0-9a-f]{64}$/);
      assert.equal(await prisma.tache.count({ where: { type: "ANALYSE_PHOTO" } }), tachesAvant + 1);
      const ligne = await prisma.analysePhoto.findUniqueOrThrow({ where: { empreinte: demande.corps.empreinte } });
      assert.deepEqual([ligne.dossierId, ligne.piece, ligne.statut], [dossierId, "salle-de-bain", "EN_COURS"]);
      assert.ok(ligne.photoPath && existsSync(path.join(process.env.UPLOADS_DIR!, ligne.photoPath)), "la photo cadrée attend la tâche sous dossiers/<id>/analyses");
      // Pendant l'analyse : le suivi dit EN_COURS ; une seconde demande ne remet rien en file.
      const pendant = await appeler<{ statut: string }>(jeton, `/simulations/analyse/${demande.corps.empreinte}`);
      assert.deepEqual([pendant.status, pendant.corps.statut], [200, "EN_COURS"]);
      const redemande = await appeler<{ statut: string; nouvelle: boolean }>(jeton, "/simulations/analyse", { photoId, piece: "SDB" });
      assert.deepEqual([redemande.status, redemande.corps.nouvelle], [200, false]);
      assert.equal(await prisma.tache.count({ where: { type: "ANALYSE_PHOTO" } }), tachesAvant + 1);
      await executeur.executerTour();
      await executeur.attendreTachesLongues();
      const prete = await appeler<{ statut: string; analyse: { zones_visibles: Record<string, { visible: boolean }> } | null; raison: string | null }>(jeton, `/simulations/analyse/${demande.corps.empreinte}`);
      assert.deepEqual([prete.status, prete.corps.statut, prete.corps.raison], [200, "PRETE", null]);
      assert.deepEqual([prete.corps.analyse?.zones_visibles["meuble-vasque"].visible, prete.corps.analyse?.zones_visibles["tablier-baignoire"].visible], [true, false]);
      assert.deepEqual(appelsVision.map((a) => a.schema), ["analyse_photo"]);
      assert.equal((await prisma.analysePhoto.findUniqueOrThrow({ where: { empreinte: demande.corps.empreinte } })).photoPath, null, "photo d'attente effacée");
      assert.ok(!existsSync(path.join(process.env.UPLOADS_DIR!, ligne.photoPath!)));
      assert.deepEqual((await prisma.generationImage.findMany({ where: { phase: "analyse", dossierId }, select: { origine: true } })).map((g) => g.origine), ["ESPACE"], "comptée à l'espace, sur son dossier");
      // Déjà prête : 200 tout de suite, sans tâche.
      const connue = await appeler<{ statut: string; nouvelle: boolean }>(jeton, "/simulations/analyse", { photoId, piece: "SDB" });
      assert.deepEqual([connue.status, connue.corps.statut, connue.corps.nouvelle], [200, "PRETE", false]);
      // Une zone que l'analyse ne voit pas (le tablier) : refusée AVANT de dépenser, comme sur le site (409 zone-non-visible).
      const preparationsAvant = await prisma.preparationSimulation.count({ where: { dossierId } });
      await assert.rejects(service.creerSimulationClient(espace, { piece: "SDB", photoId, zones: [{ zone: "meuble-vasque", ref: "D1" }, { zone: "tablier-baignoire", ref: "AL23" }] }), (erreur: unknown) => {
        assert.ok(erreur instanceof ErreurMetier);
        assert.deepEqual([erreur.status, erreur.details], [409, { raison: "zone-non-visible", zones: ["tablier-baignoire"] }]);
        assert.match(erreur.message, /Cette zone n'est pas visible sur votre photo : Tablier de baignoire\. Retirez-la/);
        return true;
      });
      const refus = await appeler<{ error: string; raison: string; zones: string[] }>(jeton, "/simulations/creer", { piece: "SDB", photoId, zones: [{ zone: "tablier-baignoire", ref: "AL23" }] });
      assert.deepEqual([refus.status, refus.corps.raison, refus.corps.zones], [409, "zone-non-visible", ["tablier-baignoire"]]);
      assert.equal(await prisma.preparationSimulation.count({ where: { dossierId } }), preparationsAvant, "rien n'est lancé, rien n'est compté");
      // La génération qui suit retrouve l'analyse par l'empreinte de la photo cadrée : un contrôle, pas de seconde analyse.
      appelsVision = [];
      scoresControle = [9];
      const { preparationId } = await service.creerSimulationClient(espace, { piece: "SDB", photoId, zones: [{ zone: "meuble-vasque", ref: "D1" }] });
      await preparation.executerGenerationApi(preparationId);
      assert.deepEqual(appelsVision.map((a) => a.schema), ["controle_rendu"], "l'analyse faite à la demande sert la génération");
      assert.equal((await prisma.preparationSimulation.findUniqueOrThrow({ where: { id: preparationId } })).photoEmpreinte, demande.corps.empreinte);
      // Un autre client ne lit pas l'analyse de cette photo par son jeton.
      const autre = await espaceAvecPhoto("Espace Autre");
      assert.equal((await appeler(autre.jeton, `/simulations/analyse/${demande.corps.empreinte}`)).status, 404);
      // Une photo qui n'est pas dans l'espace : 404, rien de lancé.
      assert.equal((await appeler(jeton, "/simulations/analyse", { photoId: "inconnue", piece: "SDB" })).status, 404);
    } finally {
      await retirerParametre("SIMULATEUR_MOTEUR");
    }
  });

  test("un projet figé n'analyse plus (409 fige, aucune tâche) ; au-delà du quota du dossier : 429 « lancez sans », rien d'écrit", async () => {
    const { dossierId, photoId, jeton, espace } = await espaceAvecPhoto("Espace Fige", await image(1200, 900, { r: 120, g: 60, b: 90 }));
    const tachesAvant = await prisma.tache.count({ where: { type: "ANALYSE_PHOTO" } });
    await prisma.dossier.update({ where: { id: dossierId }, data: { etape: "ENCAISSE" } });
    // Un projet terminé se consulte encore (visé par son code) : mais il n'analyse plus.
    const fige = await appeler<{ raison: string }>(jeton, "/simulations/analyse", { photoId, piece: "SDB" }, espace.code);
    assert.deepEqual([fige.status, fige.corps.raison], [409, "fige"]);
    assert.equal(await prisma.tache.count({ where: { type: "ANALYSE_PHOTO" } }), tachesAvant);
    await prisma.dossier.update({ where: { id: dossierId }, data: { etape: "QUALIFICATION" } });
    // Le quota n'est demandé (et compté) que quand une analyse doit partir : refusé → aucune ligne, aucune photo, aucune tâche.
    const analysesAvant = await prisma.analysePhoto.count();
    await assert.rejects(simulateurEspace.demanderAnalyseEspace(espace, { photoId, piece: "SDB" }, { quota: () => ({ ok: false, raison: "ip" }) }), (erreur: unknown) => {
      assert.ok(erreur instanceof ErreurMetier);
      assert.deepEqual([erreur.status, erreur.details], [429, { raison: "ip-quota" }]);
      assert.match(erreur.message, /vous pouvez lancer la simulation sans/);
      return true;
    });
    assert.deepEqual([await prisma.analysePhoto.count(), await prisma.tache.count({ where: { type: "ANALYSE_PHOTO" } })], [analysesAvant, tachesAvant]);
    // Par la route : le compteur du dossier (LIMITE_ANALYSES.parEspace par jour) est celui du site, sous le même plafond global.
    const { analyseAutorisee, LIMITE_ANALYSES } = await import("@/lib/acces/limite-site");
    for (let i = 0; i < LIMITE_ANALYSES.parEspace; i++) assert.deepEqual(analyseAutorisee(`espace:${dossierId}`, Date.now(), LIMITE_ANALYSES.parEspace), { ok: true }, `analyse ${i + 1}`);
    const refus = await appeler<{ error: string; raison: string }>(jeton, "/simulations/analyse", { photoId, piece: "SDB" });
    assert.deepEqual([refus.status, refus.corps.raison], [429, "ip-quota"]);
    assert.match(refus.corps.error, /lancer la simulation sans/);
    assert.equal(await prisma.tache.count({ where: { type: "ANALYSE_PHOTO" } }), tachesAvant);
    // Le lancement, lui, n'est pas bloqué par l'analyse absente (jamais à l'aveugle).
    const { preparationId } = await service.creerSimulationClient(espace, { piece: "SDB", photoId, zones: [{ zone: "tablier-baignoire", ref: "AL23" }] });
    assert.equal((await preparation.lirePreparation(preparationId)).statut, "EN_COURS");
  });
});
