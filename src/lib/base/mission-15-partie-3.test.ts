import assert from "node:assert/strict";
import { existsSync, mkdtempSync, promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, beforeEach, describe, test } from "node:test";
import { NextRequest } from "next/server";
import { preparerBaseEssai } from "@/test/base-essai";

preparerBaseEssai();
process.env.UPLOADS_DIR = mkdtempSync(path.join(tmpdir(), "coverswap-m15-3-"));

/**
 * Mission 15 (partie 3) — le banc de comparaison : coût estimé de la campagne avant tout lancement, une campagne
 * simulée → 18 rendus (6 cas × 3 variantes) avec scores et coûts enregistrés, un cas sans photo ignoré, aucun rendu
 * dans `SimulationEspace`, l'image servie, un rendu repris sans rappeler OpenAI. OpenAI est SIMULÉ (générateur et
 * vision injectés) : aucun appel réseau, aucune image générée. Noms fictifs ; les cas du test sont des dossiers
 * d'essai (les identifiants de prod de `cas.ts` ne servent qu'à l'affichage « photo introuvable »).
 */

let prisma: typeof import("@/lib/prisma").default;
let banc: typeof import("@/lib/simulateur/banc/banc");
let cas: typeof import("@/lib/simulateur/banc/cas");
let generation: typeof import("@/lib/simulations/generation");
let vision: typeof import("@/lib/simulateur/moteur/vision");
let executeur: typeof import("@/lib/taches/executeur");
let reglages: typeof import("@/lib/simulateur/reglages");
let routeBanc: typeof import("@/app/api/simulateur/banc/route");
let routeImage: typeof import("@/app/api/simulateur/banc/[id]/image/route");
let sharp: typeof import("sharp");

const REFERENCES_CATALOGUE = [
  { id: "AB02", nom: "Creamy", famille: "couleur", categorie: "Color", finition: "Soft", image: "https://ssi.s3.fr-par.scw.cloud/essai/ab02.jpg", tags: ["crème"], hex: "#EDE6D6" },
  { id: "D1", nom: "Classic Walnut", famille: "bois", categorie: "Dark", finition: "Soft", image: "https://ssi.s3.fr-par.scw.cloud/essai/d1.jpg", tags: ["noyer"] },
  { id: "MK15", nom: "Raw Travertine", famille: "pierre", categorie: "Stone", finition: "Soft", image: "https://ssi.s3.fr-par.scw.cloud/essai/mk15.jpg", tags: ["pierre"] },
  { id: "CT68", nom: "Brown Ebony", famille: "bois", categorie: "Dark", finition: "Soft", image: "https://ssi.s3.fr-par.scw.cloud/essai/ct68.jpg", tags: ["ébène"] },
  { id: "NE55", nom: "Caffe Latte", famille: "couleur", categorie: "Color", finition: "Soft", image: "https://ssi.s3.fr-par.scw.cloud/essai/ne55.jpg", tags: ["beige"] },
  { id: "NH73", nom: "Warm Walnut", famille: "bois", categorie: "Wood", finition: "Soft", image: "https://ssi.s3.fr-par.scw.cloud/essai/nh73.jpg", tags: ["noyer"] },
  { id: "AA12", nom: "Brown Line Oak", famille: "bois", categorie: "Wood", finition: "Soft", image: "https://ssi.s3.fr-par.scw.cloud/essai/aa12.jpg", tags: ["chêne"] },
  { id: "NF15", nom: "Cream White", famille: "couleur", categorie: "Color", finition: "Soft", image: "https://ssi.s3.fr-par.scw.cloud/essai/nf15.jpg", tags: ["blanc"] },
  { id: "AL23", nom: "Beige Cherry", famille: "bois", categorie: "Wood", finition: "Soft", image: "https://ssi.s3.fr-par.scw.cloud/essai/al23.jpg", tags: ["cerisier"] },
];

const ANALYSE_JSON = {
  description: "A lived-in room seen from the doorway, photographed with a phone in daylight.",
  zones_visibles: {},
  objets: ["a kettle", "a towel"],
  lumiere: { source: "daylight", direction: "from the window", temperature: "neutral", dominante: "none" },
  format: "paysage",
  qualite_photo: { verdict: "bonne", conseil: "" },
};

let RENDU_JPEG: Buffer;
let appelsVision: { schema: string; images: number }[] = [];
let scoresControle: number[] = [];
let appelsGenerateur: import("@/lib/simulations/generation").EntreeGeneration[] = [];
let generateurEnEchec = false;
/** Les six cas du test : les mêmes pièces, zones et teintes que `CAS_BANC`, sur des dossiers d'essai. */
const CAS_ESSAI: import("@/lib/simulateur/banc/cas").CasBanc[] = [];

let horlogeParametres = Date.now() - 3_600_000;
async function poserParametre(cle: string, valeur: string | number) {
  horlogeParametres += 1000;
  await prisma.parametre.create({ data: { cle, valeur: JSON.stringify(valeur), valableDu: new Date(horlogeParametres) } });
}
async function image(largeur: number, hauteur: number, couleur: { r: number; g: number; b: number }): Promise<Buffer> {
  return sharp({ create: { width: largeur, height: hauteur, channels: 3, background: couleur } }).jpeg({ quality: 80 }).toBuffer();
}
async function dossierAvecPhoto(nom: string, photo: Buffer): Promise<{ dossierId: string; photoId: string }> {
  const { ajouterPhoto } = await import("@/lib/dossiers/dossiers");
  const dossier = await prisma.dossier.create({ data: { clientNom: nom, clientAdresse: "", clientCp: "34970", clientVille: "Lattes", clientTelephone: "+33611223344", objet: "Recouvrement", source: "ENTRANT", etape: "QUALIFICATION" } });
  const ajoutee = await ajouterPhoto(dossier.id, new File([new Uint8Array(photo)], "piece.jpg", { type: "image/jpeg" }));
  return { dossierId: dossier.id, photoId: ajoutee.id };
}
/** Exécute les tâches du banc jusqu'à ce qu'il n'en reste plus (deux à la fois, comme l'exécuteur). */
async function executerLeBanc(maxTours = 40) {
  for (let tour = 0; tour < maxTours; tour++) {
    await executeur.executerTour();
    await executeur.attendreTachesLongues();
    if ((await prisma.tache.count({ where: { type: banc.TACHE_SIMULATION_BANC, statut: { in: ["EN_ATTENTE", "EN_COURS"] } } })) === 0) return;
  }
  throw new Error("Des tâches du banc restent en file.");
}
const requete = (corps: unknown) => new NextRequest("http://localhost/api/simulateur/banc", { method: "POST", body: JSON.stringify(corps), headers: { "content-type": "application/json" } });

before(async () => {
  process.env.OPENAI_API_KEY = "cle-factice-jamais-appelee";
  process.env.OPENAI_BASE_URL = "http://127.0.0.1:9/jamais";
  process.env.SITE_URL = "http://127.0.0.1:9/jamais-appele";
  process.env.NEXTAUTH_SECRET = "secret-de-session-pour-les-essais";
  process.env.TACHES_DESACTIVEES = "1";
  for (const cle of ["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID", "NTFY_TOPIC", "RESEND_API_KEY", "EMAIL_FROM"]) process.env[cle] = ""; // vide, pas supprimée : Prisma reprendrait la valeur de .env
  prisma = (await import("@/lib/prisma")).default;
  sharp = (await import("sharp")).default;
  banc = await import("@/lib/simulateur/banc/banc");
  cas = await import("@/lib/simulateur/banc/cas");
  generation = await import("@/lib/simulations/generation");
  vision = await import("@/lib/simulateur/moteur/vision");
  executeur = await import("@/lib/taches/executeur");
  reglages = await import("@/lib/simulateur/reglages");
  routeBanc = await import("@/app/api/simulateur/banc/route");
  routeImage = await import("@/app/api/simulateur/banc/[id]/image/route");
  await (await import("@/lib/base/preparation")).preparerBase();
  (await import("@/lib/taches/traitements")).enregistrerTousLesTraitements();
  (await import("@/lib/simulateur/catalogue")).definirCatalogueEssai(REFERENCES_CATALOGUE);
  // Échantillons déjà en cache : aucun appel au stockage de Cover Styl'.
  const dossier = path.join(process.env.UPLOADS_DIR!, "simulateur", "echantillons");
  await fs.mkdir(dossier, { recursive: true });
  for (const [i, r] of REFERENCES_CATALOGUE.entries()) await fs.writeFile(path.join(dossier, `${r.id}.jpg`), await image(200, 200, { r: 120 + i * 10, g: 100 + i * 5, b: 80 }));
  RENDU_JPEG = await image(1536, 1024, { r: 90, g: 80, b: 70 });
  // Six dossiers d'essai, une photo différente chacun (l'analyse est mise en cache par empreinte).
  for (const [i, c] of cas.CAS_BANC.entries()) {
    const { dossierId, photoId } = await dossierAvecPhoto(`Essai banc ${i + 1}`, await image(1200, 900, { r: 100 + i * 20, g: 110, b: 100 }));
    CAS_ESSAI.push({ ...c, dossierId, photoId });
  }

  generation.definirGenerateurEssai(async (entree) => {
    appelsGenerateur.push(entree);
    if (generateurEnEchec) return { ok: false, dureeMs: 10, status: 503, raison: "service-indisponible", message: "Le service de simulation est indisponible." };
    const films = entree.planche ? 1 : (entree.swatches?.length ?? 0);
    return { ok: true, image: RENDU_JPEG, type: "image/jpeg", avant: null, taille: "1536x1024", dureeMs: 1500, usage: { texte: 100, image: 200, sortie: 300 }, coutDollars: entree.qualite === "high" ? 0.36 + 0.1 * films : 0.21 + 0.066 * (films - 1), generationId: null };
  });
  vision.definirVisionEssai(async (demande) => {
    appelsVision.push({ schema: demande.schema.nom, images: demande.images.length });
    if (demande.schema.nom === "analyse_photo") return { texte: JSON.stringify(ANALYSE_JSON), jetonsEntree: 1200, jetonsSortie: 300 };
    const score = scoresControle.shift() ?? 9;
    return { texte: JSON.stringify({ score, defauts: score < 7 ? [{ type: "objet-disparu", detail: "the kettle disappeared" }] : [] }), jetonsEntree: 1500, jetonsSortie: 80 };
  });
});
beforeEach(() => {
  appelsVision = [];
  appelsGenerateur = [];
  scoresControle = [];
  generateurEnEchec = false;
});
after(async () => {
  generation.definirGenerateurEssai(null);
  vision.definirVisionEssai(null);
  await prisma.$disconnect();
});

describe("le coût de la campagne, avant tout lancement", () => {
  test("six cas × trois variantes = 18 rendus ; V1 en medium, V2 à la qualité de l'espace ; analyses et contrôles comptés ; pire cas avec seconde tentative", () => {
    const r = reglages.REGLAGES_PAR_DEFAUT;
    const estimation = banc.estimerCampagne(cas.CAS_BANC, r);
    assert.deepEqual([estimation.cas, estimation.rendus, estimation.analyses, estimation.controles], [6, 18, 6, 12]);
    const { coutEstime } = generation;
    // Cuisine T. : trois films → 0,34 $ en medium (V1), 0,58 $ en high (V2).
    assert.deepEqual(estimation.parCas["t-cuisine"], { "v1-swatches": coutEstime(3, "medium"), "v2-planche": coutEstime(3, "high"), "v2-swatches": coutEstime(3, "high") });
    // Salle de bain B. : un film → 0,21 $ (V1) et 0,36 $ (V2) : le moins cher et le plus cher de la campagne.
    assert.deepEqual([estimation.renduMin, estimation.renduMax], [coutEstime(1, "medium"), coutEstime(3, "high")]);
    const generations = Object.values(estimation.parCas).flatMap((v) => Object.values(v)).reduce((s, c) => s + c, 0);
    assert.equal(estimation.totalMin, Math.round((generations + 18 * 0.005) * 100) / 100);
    const v2 = Object.values(estimation.parCas).flatMap((v) => [v["v2-planche"], v["v2-swatches"]]).reduce((s, c) => s + c, 0);
    assert.equal(estimation.totalMax, Math.round((generations + v2 + (6 + 24) * 0.005) * 100) / 100);
    assert.ok(estimation.totalMax > estimation.totalMin && estimation.totalMin > 5, `≈ ${estimation.totalMin} à ${estimation.totalMax} $`);
    // La qualité de l'espace en medium : les trois variantes au même prix.
    const enMedium = banc.estimerCampagne(cas.CAS_BANC, { ...r, qualiteEspace: "medium" });
    assert.deepEqual(Object.values(enMedium.parCas["t-cuisine"]), [coutEstime(3, "medium"), coutEstime(3, "medium"), coutEstime(3, "medium")]);
    // Un seul cas.
    assert.deepEqual([banc.estimerCampagne([cas.CAS_BANC[1]], r).rendus, banc.estimerCampagne([], r).totalMin], [3, 0]);
  });

  test("les cas de prod : aucune photo dans la base d'essai → « photo introuvable », rien de lançable, rien de lancé", async () => {
    const etat = await banc.etatBanc();
    assert.equal(etat.cas.length, 6);
    assert.ok(etat.cas.every((c) => c.photo === null));
    assert.deepEqual([etat.estimation.cas, etat.estimation.rendus, etat.estimation.totalMin], [0, 0, 0]);
    const lancement = await banc.lancerBanc();
    assert.deepEqual([lancement.lances.length, lancement.ignores.length], [0, 6]);
    assert.ok(lancement.ignores.every((i) => i.raison === banc.RAISON_PHOTO_INTROUVABLE));
    assert.equal(await prisma.renduBanc.count(), 0);
    assert.equal(await prisma.tache.count({ where: { type: banc.TACHE_SIMULATION_BANC } }), 0);
  });
});

describe("une campagne simulée", () => {
  test("18 rendus : tâches de fond, images sous banc/<cas>/<variante>-<n>.jpg, scores et coûts enregistrés, aucun SimulationEspace, comptés au CRM", async () => {
    const etatAvant = await banc.etatBanc({ cas: CAS_ESSAI });
    assert.ok(etatAvant.cas.every((c) => c.photo && c.photo.url.startsWith(`/api/dossiers/${c.dossierId}/photos/`)));
    assert.deepEqual([etatAvant.estimation.rendus, etatAvant.rendus.length, etatAvant.total.coutDollars], [18, 0, 0]);

    const lancement = await banc.lancerBanc({}, { cas: CAS_ESSAI });
    assert.deepEqual([lancement.lances.length, lancement.ignores.length], [18, 0]);
    assert.ok(lancement.lances.every((r) => r.statut === "EN_ATTENTE" && r.coutEstime! > 0 && r.image === null));
    assert.equal(await prisma.tache.count({ where: { type: banc.TACHE_SIMULATION_BANC, statut: "EN_ATTENTE" } }), 18);
    // Un second clic pendant l'attente ne double rien.
    const doublon = await banc.lancerBanc({}, { cas: CAS_ESSAI });
    assert.deepEqual([doublon.lances.length, doublon.ignores.length, doublon.ignores[0].raison], [0, 18, banc.RAISON_DEJA_EN_COURS]);

    await executerLeBanc();
    const rendus = await prisma.renduBanc.findMany({ where: { campagneId: lancement.campagneId }, orderBy: { createdAt: "asc" } });
    assert.equal(rendus.length, 18);
    assert.ok(rendus.every((r) => r.statut === "PRET" && r.chemin && r.coutDollars! > 0 && r.dureeMs! >= 0 && r.promptTexte && r.termineLe && r.etape === "rendu"), JSON.stringify(rendus.filter((r) => r.statut !== "PRET").map((r) => [r.cas, r.variante, r.erreur])));
    for (const r of rendus) {
      assert.match(r.chemin!, new RegExp(`^banc/${r.cas}/${r.variante}-1\\.jpg$`));
      assert.ok(existsSync(path.join(process.env.UPLOADS_DIR!, r.chemin!)), r.chemin!);
    }
    const v1 = rendus.filter((r) => r.variante === "v1-swatches");
    const v2 = rendus.filter((r) => r.variante !== "v1-swatches");
    assert.deepEqual([v1.length, v2.length], [6, 12]);
    assert.ok(v1.every((r) => r.moteur === "V1" && r.qualite === "medium" && r.score === null && r.tentatives === 1 && !r.promptTexte!.startsWith("ROLE\n")), "V1 : l'ancien prompt, sans contrôle");
    assert.ok(v2.every((r) => r.moteur === "V2" && r.qualite === "high" && r.score === 9 && r.tentatives === 1 && r.promptTexte!.startsWith("ROLE\n") && r.directionArtistique), "V2 : moteur studio, contrôle 9/10");
    // Le générateur : 18 appels ; la planche pour v2-planche, les échantillons bruts sinon (un par film).
    assert.equal(appelsGenerateur.length, 18);
    assert.equal(appelsGenerateur.filter((a) => a.planche).length, 6, "six rendus avec la planche");
    assert.equal(appelsGenerateur.filter((a) => a.swatches && !a.planche).length, 12, "douze rendus avec les échantillons bruts");
    assert.deepEqual([appelsGenerateur.filter((a) => a.qualite === "medium").length, appelsGenerateur.filter((a) => a.qualite === "high").length], [6, 12]);
    assert.ok(appelsGenerateur.every((a) => a.origine === "CRM"));
    // Vision : une analyse par photo (réutilisée entre les deux variantes V2), un contrôle par rendu V2 ; comptés au CRM.
    assert.deepEqual([appelsVision.filter((a) => a.schema === "analyse_photo").length, appelsVision.filter((a) => a.schema === "controle_rendu").length], [6, 12]);
    const lignes = await prisma.generationImage.findMany({ where: { dossierId: { in: CAS_ESSAI.map((c) => c.dossierId) } }, select: { origine: true, phase: true } });
    assert.deepEqual([lignes.filter((l) => l.phase === "analyse").length, lignes.filter((l) => l.phase === "controle").length], [6, 12]);
    assert.ok(lignes.every((l) => l.origine === "CRM"));
    // Le coût réel comprend le contrôle en V2.
    const t = rendus.find((r) => r.cas === "t-cuisine" && r.variante === "v2-swatches")!;
    assert.ok(t.coutDollars! > 0.36 + 0.3, `rendu + contrôle : ${t.coutDollars}`);
    // Jamais publié dans un espace client ; aucun espace ouvert par le banc.
    assert.equal(await prisma.simulationEspace.count(), 0);
    assert.equal(await prisma.espaceClient.count(), 0);
    assert.equal(await prisma.preparationSimulation.count(), 0);

    // L'état de la page : 18 rendus prêts, total de la campagne = rendus + contrôles + les six analyses de photo.
    const etat = await banc.etatBanc({ cas: CAS_ESSAI });
    assert.deepEqual([etat.total.rendus, etat.total.prets, etat.total.enCours, etat.total.echecs], [18, 18, 0, 0]);
    const analyses = await prisma.generationImage.aggregate({ _sum: { coutDollars: true }, where: { phase: "analyse", dossierId: { in: CAS_ESSAI.map((c) => c.dossierId) } } });
    assert.ok(analyses._sum.coutDollars! > 0 && etat.total.analysesDollars === Math.round(analyses._sum.coutDollars! * 100) / 100, `analyses : ${etat.total.analysesDollars}`);
    assert.equal(etat.total.coutDollars, Math.round((rendus.reduce((s, r) => s + r.coutDollars!, 0) + analyses._sum.coutDollars!) * 100) / 100);
    const vue = etat.rendus.find((r) => r.id === t.id)!;
    assert.deepEqual([vue.image, vue.score, vue.defauts, vue.moteur], [`/api/simulateur/banc/${t.id}/image`, 9, [], "V2"]);
    // Les dimensions (place réservée en plein écran) : le rendu et la photo du cas.
    assert.deepEqual([vue.largeur, vue.hauteur], [1536, 1024]);
    assert.deepEqual([etat.cas[0].photo?.largeur, etat.cas[0].photo?.hauteur], [1200, 900]);
    // L'image est servie par la route (derrière la session).
    const reponse = await routeImage.GET(new NextRequest(`http://localhost${vue.image}`), { params: Promise.resolve({ id: t.id }) });
    assert.equal(reponse.status, 200);
    assert.equal(reponse.headers.get("content-type"), "image/jpeg");
    assert.equal(Buffer.from(await reponse.arrayBuffer()).length, RENDU_JPEG.length);
    assert.equal((await routeImage.GET(new NextRequest("http://localhost/x"), { params: Promise.resolve({ id: "inconnu" }) })).status, 404);
  });

  test("un cas sans photo est ignoré : 15 rendus sur 18, le cas affiché « photo introuvable »", async () => {
    const casEssai = CAS_ESSAI.map((c, i) => (i === 2 ? { ...c, photoId: "photo-inconnue" } : c));
    const etat = await banc.etatBanc({ cas: casEssai });
    assert.equal(etat.cas[2].photo, null);
    assert.deepEqual([etat.estimation.cas, etat.estimation.rendus], [5, 15]);
    const lancement = await banc.lancerBanc({}, { cas: casEssai });
    assert.deepEqual([lancement.lances.length, lancement.ignores], [15, [{ cas: casEssai[2].id, variante: null, raison: banc.RAISON_PHOTO_INTROUVABLE }]]);
    await executerLeBanc();
    const rendus = await prisma.renduBanc.findMany({ where: { campagneId: lancement.campagneId } });
    assert.equal(rendus.filter((r) => r.statut === "PRET").length, 15);
    assert.equal(rendus.filter((r) => r.cas === casEssai[2].id).length, 0);
    // Seconds rendus du même cas : n = 2 dans le nom du fichier.
    assert.ok(rendus.every((r) => /-2\.jpg$/.test(r.chemin!)), rendus[0].chemin!);
    assert.equal(await prisma.simulationEspace.count(), 0);
  });

  test("un seul cas, une seule variante, ou les deux ; contrôle sous le seuil → seconde tentative, la meilleure gardée, coût des deux", async () => {
    const unCas = await banc.lancerBanc({ cas: "b-sdb" }, { cas: CAS_ESSAI });
    assert.deepEqual(unCas.lances.map((r) => `${r.cas}:${r.variante}`), ["b-sdb:v1-swatches", "b-sdb:v2-planche", "b-sdb:v2-swatches"]);
    await executerLeBanc();
    const uneVariante = await banc.lancerBanc({ variante: "v2-planche" }, { cas: CAS_ESSAI });
    assert.deepEqual([uneVariante.lances.length, new Set(uneVariante.lances.map((r) => r.variante)).size], [6, 1]);
    await executerLeBanc();
    appelsGenerateur = [];
    appelsVision = [];
    scoresControle = [5, 9];
    const unSeul = await banc.lancerBanc({ cas: "t-cuisine", variante: "v2-swatches" }, { cas: CAS_ESSAI });
    assert.equal(unSeul.lances.length, 1);
    await executerLeBanc();
    const r = await prisma.renduBanc.findUniqueOrThrow({ where: { id: unSeul.lances[0].id } });
    assert.deepEqual([r.statut, r.score, r.tentatives], ["PRET", 9, 2]);
    assert.equal(appelsGenerateur.length, 2, "deux rendus : la seconde tentative rappelle le défaut");
    assert.match(appelsGenerateur[1].prompt, /the kettle disappeared/);
    assert.deepEqual(appelsVision.map((a) => a.schema), ["controle_rendu", "controle_rendu"], "l'analyse de cette photo est déjà connue : deux contrôles seulement");
    assert.ok(r.coutDollars! > 2 * 0.66, `deux rendus high (trois films) + deux contrôles : ${r.coutDollars}`);
    await assert.rejects(banc.lancerBanc({ cas: "inconnu" }, { cas: CAS_ESSAI }), /Cas inconnu/);
    await assert.rejects(banc.lancerBanc({ variante: "v3" }, { cas: CAS_ESSAI }), /Variante inconnue/);
  });

  test("échec du générateur → ECHEC avec le message, pas de fichier ; rendu repris après un redéploiement → ECHEC « interrompu » sans rappeler OpenAI", async () => {
    generateurEnEchec = true;
    const echec = await banc.lancerBanc({ cas: "d-sdb", variante: "v1-swatches" }, { cas: CAS_ESSAI });
    await executerLeBanc();
    const r = await prisma.renduBanc.findUniqueOrThrow({ where: { id: echec.lances[0].id } });
    assert.deepEqual([r.statut, r.chemin], ["ECHEC", null]);
    assert.match(r.erreur ?? "", /indisponible\. \(service-indisponible\)/);
    assert.equal((await banc.etatBanc({ cas: CAS_ESSAI })).total.echecs, 1);
    generateurEnEchec = false;
    appelsGenerateur = [];
    // La tâche a posé son départ, puis le processus a été coupé : elle est réclamée à nouveau.
    const repris = await banc.lancerBanc({ cas: "d-sdb", variante: "v1-swatches" }, { cas: CAS_ESSAI });
    await prisma.renduBanc.update({ where: { id: repris.lances[0].id }, data: { statut: "EN_COURS", demarreLe: new Date(), etape: "rendu" } });
    assert.deepEqual(await banc.executerRenduBanc(repris.lances[0].id), { statut: "ECHEC" });
    const r2 = await prisma.renduBanc.findUniqueOrThrow({ where: { id: repris.lances[0].id } });
    assert.match(r2.erreur ?? "", /interrompu par une mise à jour/);
    assert.equal(appelsGenerateur.length, 0, "rien n'est repayé");
    // Un rendu déjà fini n'est pas rejoué.
    assert.deepEqual(await banc.executerRenduBanc(r.id), { statut: "ECHEC" });
    assert.equal(appelsGenerateur.length, 0);
  });

  test("la route : POST lance (202) avec le corps validé, GET rend l'état ; les rendus V1 en medium même si l'espace est en low", async () => {
    await poserParametre("SIMULATEUR_QUALITE_ESPACE", "low");
    try {
      const etat = (await (await routeBanc.GET()).json()) as import("@/lib/simulateur/banc/banc").EtatBanc;
      assert.equal(etat.reglages.qualiteEspace, "low");
      assert.equal(etat.cas.length, 6);
      assert.ok(etat.total.rendus >= 18);
      assert.equal((await routeBanc.POST(requete({ variante: 12 }))).status, 400);
      // Les cas de prod n'ont pas de photo ici : 202 sans rien lancer.
      const reponse = await routeBanc.POST(requete({ cas: null, variante: "v1-swatches" }));
      assert.equal(reponse.status, 202);
      const corps = (await reponse.json()) as import("@/lib/simulateur/banc/banc").LancementBanc;
      assert.deepEqual([corps.lances.length, corps.ignores.length], [0, 6]);
      assert.deepEqual([banc.qualiteDeVariante("v1-swatches", { ...reglages.REGLAGES_PAR_DEFAUT, qualiteEspace: "low" }), banc.qualiteDeVariante("v2-planche", { ...reglages.REGLAGES_PAR_DEFAUT, qualiteEspace: "low" })], ["medium", "low"]);
    } finally {
      await poserParametre("SIMULATEUR_QUALITE_ESPACE", "high");
    }
  });
});

describe("tenue en ordre du banc", () => {
  test("une tâche annulée depuis l'écran des tâches ne bloque pas son cas × variante : la ligne passe en échec, le rendu se relance", async () => {
    const { annulerTache } = await import("@/lib/taches/file");
    const lancement = await banc.lancerBanc({ cas: "b-sdb", variante: "v1-swatches" }, { cas: CAS_ESSAI });
    assert.equal(lancement.lances.length, 1);
    const tache = await prisma.tache.findUniqueOrThrow({ where: { cle: `banc:${lancement.lances[0].id}` } });
    await annulerTache(tache.id);
    // Sans remise en ordre, ce cas × variante resterait « déjà en cours » pour toujours.
    const etat = await banc.etatBanc({ cas: CAS_ESSAI });
    const ligne = etat.rendus.find((r) => r.id === lancement.lances[0].id)!;
    assert.deepEqual([ligne.statut, ligne.erreur], ["ECHEC", banc.MESSAGE_TACHE_PERDUE_BANC]);
    assert.equal(etat.total.enCours, 0);
    const relance = await banc.lancerBanc({ cas: "b-sdb", variante: "v1-swatches" }, { cas: CAS_ESSAI });
    assert.deepEqual([relance.lances.length, relance.ignores.length], [1, 0]);
    await executerLeBanc();
    assert.equal((await prisma.renduBanc.findUniqueOrThrow({ where: { id: relance.lances[0].id } })).statut, "PRET");
    // La ligne et sa tâche naissent ensemble : jamais l'une sans l'autre.
    const lignes = await prisma.renduBanc.findMany({ select: { id: true } });
    assert.equal(await prisma.tache.count({ where: { cle: { in: lignes.map((l) => `banc:${l.id}`) } } }), lignes.length);
  });

  test("rendu payé mais image impossible à écrire → ECHEC avec le coût réel, jamais EN_COURS pour toujours", async () => {
    // Un fichier à la place du dossier banc/<cas> : mkdir échoue après la génération (payée).
    const casBloque = { ...CAS_ESSAI[1], id: "x-persistance" };
    await fs.writeFile(path.join(process.env.UPLOADS_DIR!, "banc", casBloque.id), "pas un dossier");
    const lancement = await banc.lancerBanc({ cas: casBloque.id, variante: "v1-swatches" }, { cas: [casBloque] });
    assert.equal(lancement.lances.length, 1);
    await executerLeBanc();
    const r = await prisma.renduBanc.findUniqueOrThrow({ where: { id: lancement.lances[0].id } });
    assert.deepEqual([r.statut, r.chemin, r.tentatives], ["ECHEC", null, 1]);
    assert.match(r.erreur ?? "", /payé mais non enregistré/);
    assert.ok(r.coutDollars! > 0, `coût réel gardé : ${r.coutDollars}`);
    assert.equal(appelsGenerateur.length, 1);
    // Le cas × variante n'est pas bloqué : un nouveau lancement est accepté.
    await fs.rm(path.join(process.env.UPLOADS_DIR!, "banc", casBloque.id));
    const relance = await banc.lancerBanc({ cas: casBloque.id, variante: "v1-swatches" }, { cas: [casBloque] });
    assert.deepEqual([relance.lances.length, relance.ignores.length], [1, 0]);
    await executerLeBanc();
    assert.equal((await prisma.renduBanc.findUniqueOrThrow({ where: { id: relance.lances[0].id } })).statut, "PRET");
  });

  test("purge à 30 jours : l'image est effacée, la ligne reste (score, coût, prompt) et le total ne bouge pas", async () => {
    const avant = await banc.etatBanc({ cas: CAS_ESSAI });
    const cible = await prisma.renduBanc.findFirstOrThrow({ where: { statut: "PRET", chemin: { not: null } }, orderBy: { createdAt: "asc" } });
    assert.ok(existsSync(path.join(process.env.UPLOADS_DIR!, cible.chemin!)));
    await prisma.renduBanc.update({ where: { id: cible.id }, data: { createdAt: new Date(Date.now() - banc.RETENTION_BANC_MS - 60_000) } });
    assert.equal(await banc.purgerRendusBanc(), 1);
    assert.equal(await banc.purgerRendusBanc(), 0, "déjà archivée");
    const apres = await prisma.renduBanc.findUniqueOrThrow({ where: { id: cible.id } });
    assert.deepEqual([apres.chemin, apres.statut, apres.score, apres.coutDollars, apres.promptTexte], [null, "PRET", cible.score, cible.coutDollars, cible.promptTexte]);
    assert.ok(apres.archiveLe && /30 jours/.test(apres.archiveMotif ?? ""));
    assert.ok(!existsSync(path.join(process.env.UPLOADS_DIR!, cible.chemin!)), "image effacée");
    assert.equal((await routeImage.GET(new NextRequest("http://localhost/x"), { params: Promise.resolve({ id: cible.id }) })).status, 404);
    const etat = await banc.etatBanc({ cas: CAS_ESSAI });
    assert.deepEqual([etat.total.rendus, etat.total.coutDollars], [avant.total.rendus, avant.total.coutDollars]);
    assert.equal(etat.rendus.find((r) => r.id === cible.id)?.image, null);
  });

  test("une pièce inconnue de la source unique → ECHEC sans appel", async () => {
    const r = await prisma.renduBanc.create({ data: { campagneId: "essai", cas: "x-piece", variante: "v1-swatches", dossierId: CAS_ESSAI[0].dossierId, photoId: CAS_ESSAI[0].photoId, piece: "grenier", zones: JSON.stringify(CAS_ESSAI[0].zones) } });
    assert.deepEqual(await banc.executerRenduBanc(r.id), { statut: "ECHEC" });
    assert.equal((await prisma.renduBanc.findUniqueOrThrow({ where: { id: r.id } })).erreur, "Pièce inconnue.");
    assert.equal(appelsGenerateur.length, 0);
  });
});

describe("RGPD", () => {
  test("le modèle RenduBanc est dans la carte des données personnelles : image et consigne effacées, score et coût gardés", async () => {
    const { CARTE_DONNEES_PERSONNELLES } = await import("@/lib/rgpd/carte");
    const regle = CARTE_DONNEES_PERSONNELLES.RenduBanc;
    assert.ok(regle && "remplacer" in regle);
    assert.deepEqual(regle.remplacer({}, { pseudonyme: "X", leadsAvecFactures: new Set() }), { chemin: null, promptTexte: null, directionArtistique: null, defauts: null, erreur: null });
  });
});
