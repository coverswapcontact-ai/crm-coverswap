import assert from "node:assert/strict";
import { mkdtempSync, promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { NextRequest } from "next/server";
import { preparerBaseEssai } from "@/test/base-essai";

preparerBaseEssai();
process.env.UPLOADS_DIR = mkdtempSync(path.join(tmpdir(), "coverswap-m21-exemple-"));

/**
 * Site 3.0 (mission 21, relecture des phases D, E, F) — une simulation faite sur une PIÈCE D'EXEMPLE du site le dit de
 * bout en bout : `exemple` (facultatif) part avec POST /api/simulate, reste sur le travail puis sur la simulation du
 * parcours, puis sur la simulation du contact (webhook) ; l'avant d'exemple n'entre jamais dans les photos du dossier ;
 * l'espace le porte (`exemple`, titre « Ambiance · avant / après… ») pour que le site ne l'appelle pas « Simulation » ;
 * une demande après échec sur un exemple ne range aucune photo comme celle du visiteur. Sans `exemple` (ancien site),
 * rien ne change. OpenAI est SIMULÉ, `fetch` remplacé : aucun appel réseau, aucune image générée. Noms fictifs.
 */

let prisma: typeof import("@/lib/prisma").default;
let route: typeof import("@/app/api/simulate/route");
let webhook: typeof import("@/app/api/webhook/route");
let contrat: typeof import("@/lib/site/contrat-simulate");
let generation: typeof import("@/lib/simulations/generation");
let executeur: typeof import("@/lib/taches/executeur");
let simulationsSite: typeof import("@/lib/site/simulations");
let service: typeof import("@/lib/espace/service");
let stockage: typeof import("@/lib/dossiers/stockage");
let cors: typeof import("@/lib/site/cors-simulate");
let sharp: typeof import("sharp");

const SECRET_SIMULATEUR = "secret-partage-des-essais-21";
const SECRET_WEBHOOK = "secret-webhook-des-essais-21";
const EXEMPLE = "cuisine-bordeaux-brillante";
const CATALOGUE = [{ id: "NE31", nom: "Chêne clair", famille: "bois", categorie: "Wood", finition: "Soft", image: "https://ssi.s3.fr-par.scw.cloud/essai/ne31.jpg", tags: ["chêne"] }];
const fetchOrigine = globalThis.fetch;
const requetesReseau: string[] = [];
let ipSuivante = 10;
let numeroParcours = 0;
const parcours = () => `dddddddd-2121-4000-8000-${String(++numeroParcours).padStart(12, "0")}`;

async function jpeg(largeur: number, hauteur: number, couleur: { r: number; g: number; b: number }): Promise<Buffer> {
  return sharp({ create: { width: largeur, height: hauteur, channels: 3, background: couleur } }).jpeg({ quality: 80 }).toBuffer();
}
const dataUrl = (octets: Buffer) => `data:image/jpeg;base64,${octets.toString("base64")}`;

/** POST /api/simulate comme le navigateur l'envoie, sélections signées comme par `prepare` du site. */
async function lancer(parcoursId: string, extra: Record<string, unknown>) {
  const selections = [{ surface: "credence", ref: "NE31" }];
  const exp = Date.now() + 60_000;
  const sig = contrat.signatureSelections(SECRET_SIMULATEUR, { parcoursId, projet: "cuisine", selections, exp });
  const corps = { asynchrone: true, projet: "cuisine", selections, sig, exp, parcoursId, photo_base64: dataUrl(await jpeg(1200, 900, { r: 120, g: 110, b: 100 })), page: "/simulateur", source: null, campagne: null, ...extra };
  const reponse = await route.POST(new NextRequest("http://localhost/api/simulate", { method: "POST", body: JSON.stringify(corps), headers: { "content-type": "application/json", "x-forwarded-for": `203.0.113.${ipSuivante++}` } }));
  if (reponse.status !== 202) assert.fail(`HTTP ${reponse.status} : ${await reponse.text()}`);
  return ((await reponse.json()) as { travailId: string }).travailId;
}

/** POST /api/webhook comme la route `/api/simulation/contact` du site l'envoie. */
async function envoyer(corps: Record<string, unknown>): Promise<{ status: number; json: Record<string, unknown> }> {
  const reponse = await webhook.POST(
    new NextRequest("http://localhost/api/webhook", { method: "POST", body: JSON.stringify(corps), headers: { "content-type": "application/json", "x-webhook-secret": SECRET_WEBHOOK, "x-visiteur-ip": `198.51.100.${ipSuivante++}` } })
  );
  return { status: reponse.status, json: (await reponse.json()) as Record<string, unknown> };
}

/** Une simulation du parcours déjà terminée (avant et rendu de couleurs distinctes), comme la tâche la garde. */
async function simulationDuParcours(parcoursId: string, exemple: string | null) {
  return simulationsSite.enregistrerSimulationSite({
    parcoursId,
    projet: "cuisine",
    references: [{ zone: "credence", libelle: "Crédence", ref: "NE31", nom: "Chêne clair" }],
    imageAvantBase64: dataUrl(await jpeg(64, 48, { r: 200, g: 190, b: 180 })),
    imageApresBase64: dataUrl(await jpeg(64, 48, { r: 20, g: 20, b: 20 })),
    exemple,
  });
}

before(async () => {
  process.env.SIMULATE_TOKEN_SECRET = SECRET_SIMULATEUR;
  process.env.OPENAI_API_KEY = "cle-factice-jamais-appelee";
  process.env.OPENAI_BASE_URL = "http://127.0.0.1:9/jamais";
  process.env.NEXTAUTH_SECRET = "secret-de-session-pour-les-essais";
  process.env.ESPACE_CLIENT_SECRET = "secret-espace-des-essais";
  process.env.SITE_URL = "https://coverswap.fr";
  process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3001";
  process.env.WEBHOOK_SECRET = SECRET_WEBHOOK;
  process.env.WEBHOOK_SECRET_PRECEDENT = "";
  process.env.TACHES_DESACTIVEES = "1";
  for (const cle of ["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID", "NTFY_TOPIC", "RESEND_API_KEY", "EMAIL_FROM"]) process.env[cle] = ""; // vide, pas supprimée : Prisma reprendrait la valeur de .env
  globalThis.fetch = (async (entree: string | URL | Request) => {
    requetesReseau.push(String(entree instanceof Request ? entree.url : entree));
    throw new Error("Aucune requête réseau dans les essais");
  }) as typeof fetch;
  prisma = (await import("@/lib/prisma")).default;
  sharp = (await import("sharp")).default;
  route = await import("@/app/api/simulate/route");
  webhook = await import("@/app/api/webhook/route");
  contrat = await import("@/lib/site/contrat-simulate");
  generation = await import("@/lib/simulations/generation");
  executeur = await import("@/lib/taches/executeur");
  simulationsSite = await import("@/lib/site/simulations");
  service = await import("@/lib/espace/service");
  stockage = await import("@/lib/dossiers/stockage");
  cors = await import("@/lib/site/cors-simulate");
  await (await import("@/lib/base/preparation")).preparerBase();
  (await import("@/lib/taches/traitements")).enregistrerTousLesTraitements();
  (await import("@/lib/simulateur/catalogue")).definirCatalogueEssai(CATALOGUE);
  const dossier = path.join(process.env.UPLOADS_DIR!, "simulateur", "echantillons");
  await fs.mkdir(dossier, { recursive: true });
  await fs.writeFile(path.join(dossier, "NE31.jpg"), await jpeg(640, 640, { r: 201, g: 178, b: 143 }));
  const rendu = await jpeg(1536, 1024, { r: 90, g: 80, b: 70 });
  generation.definirGenerateurEssai(async () => ({ ok: true, image: rendu, type: "image/jpeg", avant: null, taille: "1536x1024", dureeMs: 1500, usage: { texte: 100, image: 200, sortie: 300 }, coutDollars: 0.21, generationId: null }));
});

after(async () => {
  generation.definirGenerateurEssai(null);
  globalThis.fetch = fetchOrigine;
  await prisma.$disconnect();
});

describe("site 3.0 : une simulation sur une pièce d'exemple le dit jusqu'à l'espace", () => {
  test("le nom d'un exemple : minuscules, chiffres et tirets, 80 signes au plus ; rien d'autre", () => {
    assert.equal(cors.exempleValide(EXEMPLE), EXEMPLE);
    for (const refuse of ["", "../photos", "Cuisine", "a b", "-debut", "x".repeat(81), 12, null, undefined]) assert.equal(cors.exempleValide(refuse), undefined, String(refuse));
  });

  test("POST /api/simulate : `exemple` gardé sur le travail puis sur la simulation du parcours ; absent ou mal formé → rien", async () => {
    const p = parcours();
    const avecExemple = await lancer(p, { exemple: EXEMPLE });
    const sansExemple = await lancer(parcours(), {});
    const malForme = await lancer(parcours(), { exemple: "../../etc" });
    const lire = (id: string) => prisma.travailSimulation.findUniqueOrThrow({ where: { id } });
    assert.deepEqual([(await lire(avecExemple)).exemple, (await lire(sansExemple)).exemple, (await lire(malForme)).exemple], [EXEMPLE, null, null]);
    await executeur.executerTour();
    await executeur.attendreTachesLongues();
    const fini = await lire(avecExemple);
    assert.equal(fini.statut, "PRETE");
    const site = await prisma.simulationSite.findUniqueOrThrow({ where: { id: fini.simulationSiteId! } });
    assert.equal(site.exemple, EXEMPLE, "la simulation du parcours sait qu'elle est faite sur un exemple");
    const autre = await lire(sansExemple);
    if (autre.simulationSiteId) assert.equal((await prisma.simulationSite.findUniqueOrThrow({ where: { id: autre.simulationSiteId } })).exemple, null);
  });

  test("webhook après un rendu sur un exemple : simulation du contact marquée, avant jamais rangé comme photo du client, espace « Ambiance · avant / après »", async () => {
    const p = parcours();
    const simulation = await simulationDuParcours(p, EXEMPLE);
    const { status, json } = await envoyer({ prenom: "Odile", nom: "Essai", telephone: "0611210001", ville: "Lattes", codePostal: "34970", source: "SITE_SIMULATEUR", typeProjet: "CUISINE", parcoursId: p, simulationIds: [simulation.id], afficherLienEspace: true, exemple: EXEMPLE, message: `Simulation sur une pièce d'exemple : ${EXEMPLE}` });
    assert.equal(status, 200);
    const leadId = String(json.leadId);
    const dossierId = String(json.dossierId);
    const rattachee = await prisma.simulation.findFirstOrThrow({ where: { leadId } });
    assert.equal(rattachee.exemple, EXEMPLE);
    // Dans les photos du dossier : le rendu seul (copies.avant vide), jamais l'avant de l'exemple.
    const copies = JSON.parse(rattachee.photosDossier ?? "{}") as { avant: string | null; rendu: string | null };
    assert.equal(copies.avant, null, "l'avant d'exemple n'est pas copié");
    assert.ok(copies.rendu, "le rendu, lui, est rangé (jamais pris pour une photo du client)");
    assert.equal(stockage.lirePhotos((await prisma.dossier.findUniqueOrThrow({ where: { id: dossierId } })).photos).length, 1);
    assert.equal(await prisma.photoLead.count({ where: { leadId } }), 0, "aucune photo du contact");
    const evenement = await prisma.dossierEvenement.findFirstOrThrow({ where: { dossierId, type: "SIMULATION_SITE" } });
    assert.match(evenement.contenu, /pièce d'exemple \(cuisine-bordeaux-brillante\), pas sur une photo du client/);
    // L'espace : la simulation porte l'exemple et un titre honnête ; l'état lu par le site aussi.
    const espace = await prisma.espaceClient.findFirstOrThrow({ where: { dossierId } });
    const dansLEspace = await prisma.simulationEspace.findFirstOrThrow({ where: { espaceId: espace.id } });
    assert.deepEqual([dansLEspace.exemple, dansLEspace.titre, dansLEspace.source], [EXEMPLE, "Ambiance · avant / après sur une pièce d'exemple", "SITE"]);
    assert.ok(dansLEspace.photoAvant, "le curseur avant / après garde la pièce d'exemple");
    const etat = await service.etatEspace(espace);
    assert.deepEqual(etat.simulations.map((s) => [s.exemple, s.titre]), [[EXEMPLE, "Ambiance · avant / après sur une pièce d'exemple"]]);
    assert.equal(etat.photos.length, 0, "aucune « photo avant » du client dans l'espace");
    assert.deepEqual(requetesReseau, [], "aucune requête réseau");
  });

  test("contrôle : le même parcours sur la photo du visiteur (ancien site, sans `exemple`) range avant et rendu, titre inchangé", async () => {
    const p = parcours();
    const simulation = await simulationDuParcours(p, null);
    const { json } = await envoyer({ prenom: "Paul", nom: "Essai", telephone: "0611210002", ville: "Pérols", source: "SITE_SIMULATEUR", typeProjet: "CUISINE", parcoursId: p, simulationIds: [simulation.id], afficherLienEspace: true });
    const dossierId = String(json.dossierId);
    const rattachee = await prisma.simulation.findFirstOrThrow({ where: { leadId: String(json.leadId) } });
    assert.equal(rattachee.exemple, null);
    assert.equal(stockage.lirePhotos((await prisma.dossier.findUniqueOrThrow({ where: { id: dossierId } })).photos).length, 2, "photo avant et rendu");
    const espace = await prisma.espaceClient.findFirstOrThrow({ where: { dossierId } });
    const etat = await service.etatEspace(espace);
    assert.deepEqual(etat.simulations.map((s) => [s.exemple, s.titre]), [[null, "Votre simulation sur coverswap.fr"]]);
  });

  test("demande après un échec sur un exemple : aucune photo rangée comme celle du visiteur, la simulation à faire à la main le sait ; sans exemple, la photo est gardée", async () => {
    const photo = dataUrl(await jpeg(64, 48, { r: 150, g: 140, b: 130 }));
    const commun = { nom: "Essai", ville: "Mauguio", source: "SITE_SIMULATEUR", typeProjet: "CUISINE", photos: [photo], notes: "SIMULATION À RÉALISER À LA MAIN" };
    const surExemple = await envoyer({ ...commun, prenom: "Rose", telephone: "0611210003", parcoursId: parcours(), exemple: EXEMPLE });
    assert.equal(surExemple.status, 200);
    assert.equal(await prisma.photoLead.count({ where: { leadId: String(surExemple.json.leadId) } }), 0, "l'avant d'exemple n'est pas une photo du visiteur");
    assert.equal((await prisma.simulation.findFirstOrThrow({ where: { leadId: String(surExemple.json.leadId) } })).exemple, EXEMPLE);
    const surSaPhoto = await envoyer({ ...commun, prenom: "Yves", telephone: "0611210004", parcoursId: parcours() });
    assert.equal(await prisma.photoLead.count({ where: { leadId: String(surSaPhoto.json.leadId) } }), 1, "sa photo, elle, est gardée");
    // Un `exemple` mal formé est ignoré (comme absent) : la demande passe.
    const malForme = await envoyer({ ...commun, prenom: "Zoé", telephone: "0611210005", parcoursId: parcours(), exemple: "Pas Un Nom" });
    assert.equal(malForme.status, 200);
  });
});
