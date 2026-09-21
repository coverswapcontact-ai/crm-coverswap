import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtempSync, promises as fs } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { preparerBaseEssai } from "@/test/base-essai";

preparerBaseEssai();
process.env.UPLOADS_DIR = mkdtempSync(path.join(tmpdir(), "coverswap-simulateur-"));

let prisma: typeof import("@/lib/prisma").default;
let rendu: typeof import("./rendu");
let types: typeof import("./types-surface");
let bibliotheque: typeof import("./bibliotheque");
let preparation: typeof import("./preparation");
let catalogue: typeof import("./catalogue");
let dossierSims: typeof import("@/lib/simulations/dossier");
let consommation: typeof import("./consommation");
let defauts: typeof import("./prompts-defaut");
let sharp: typeof import("sharp");

const SECRET = "secret-partage-pour-les-essais";
let serveurSite: Server;
let serveurOpenAI: Server;
let reponseOpenAI: { status: number; corps: unknown } = { status: 200, corps: {} };
const consignesRecues: { signatureValide: boolean; corps: { project_type: string; selections: { surface: string; ref: string }[] } }[] = [];

async function ecouter(serveur: Server): Promise<string> {
  await new Promise<void>((ok) => serveur.listen(0, "127.0.0.1", ok));
  return `http://127.0.0.1:${(serveur.address() as AddressInfo).port}`;
}

async function image(largeur: number, hauteur: number, couleur: { r: number; g: number; b: number }, format: "jpeg" | "png" = "jpeg"): Promise<Buffer> {
  const base = sharp({ create: { width: largeur, height: hauteur, channels: 3, background: couleur } });
  return format === "png" ? base.png().toBuffer() : base.jpeg().toBuffer();
}

const REFERENCES = [
  { id: "AA01", nom: "Beige Oak", famille: "bois", categorie: "Medium", finition: "Structured", image: "https://ssi.s3.fr-par.scw.cloud/cover-styl/web/aa01.jpg", tags: ["chêne", "beige"] },
  { id: "J3", nom: "Ultra White", famille: "couleur", categorie: "Color", finition: "Soft", image: "https://ssi.s3.fr-par.scw.cloud/cover-styl/web/j3.jpg", tags: ["couleur"] },
  { id: "NE31", nom: "Statuary White", famille: "pierre", categorie: "Stone", finition: "Soft", image: "https://ssi.s3.fr-par.scw.cloud/cover-styl/web/ne31.jpg", tags: ["pierre"] },
];

before(async () => {
  prisma = (await import("@/lib/prisma")).default;
  sharp = (await import("sharp")).default;
  for (const cle of ["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID", "NTFY_TOPIC", "RESEND_API_KEY", "OPENAI_ADMIN_KEY"]) delete process.env[cle];
  process.env.NEXTAUTH_SECRET = "secret-de-session-pour-les-essais";
  process.env.SIMULATE_TOKEN_SECRET = SECRET;
  process.env.OPENAI_API_KEY = "cle-factice";

  // Le « site » : la consigne signée, construite par son moteur (ici : un texte témoin).
  serveurSite = createServer((requete, reponse) => {
    let corps = "";
    requete.on("data", (m) => (corps += m));
    requete.on("end", () => {
      const attendue = createHmac("sha256", SECRET).update(`${requete.headers["x-coverswap-horodatage"]}\n${corps}`).digest("hex");
      consignesRecues.push({ signatureValide: attendue === requete.headers["x-coverswap-signature"], corps: JSON.parse(corps) });
      reponse.writeHead(200, { "Content-Type": "application/json" });
      reponse.end(JSON.stringify({ prompt: "CONSIGNE DU SITE (moteur unique)", swatchUrls: [] }));
    });
  });
  process.env.SITE_URL = await ecouter(serveurSite);
  // « OpenAI » : une image et sa consommation, ou une erreur.
  serveurOpenAI = createServer((requete, reponse) => {
    requete.resume();
    requete.on("end", () => {
      reponse.writeHead(reponseOpenAI.status, { "Content-Type": "application/json" });
      reponse.end(JSON.stringify(reponseOpenAI.corps));
    });
  });
  process.env.OPENAI_BASE_URL = `${await ecouter(serveurOpenAI)}/v1`;

  rendu = await import("./rendu");
  types = await import("./types-surface");
  bibliotheque = await import("./bibliotheque");
  preparation = await import("./preparation");
  catalogue = await import("./catalogue");
  dossierSims = await import("@/lib/simulations/dossier");
  consommation = await import("./consommation");
  defauts = await import("./prompts-defaut");
  catalogue.definirCatalogueEssai(REFERENCES);
  // Échantillons déjà en cache : aucun appel au stockage de Cover Styl'.
  const dossier = path.join(process.env.UPLOADS_DIR!, "simulateur", "echantillons");
  await fs.mkdir(dossier, { recursive: true });
  await fs.writeFile(path.join(dossier, "AA01.jpg"), await image(200, 200, { r: 201, g: 178, b: 143 }));
  await fs.writeFile(path.join(dossier, "J3.jpg"), await image(200, 200, { r: 250, g: 250, b: 248 }));
  await fs.writeFile(path.join(dossier, "NE31.jpg"), await image(200, 200, { r: 232, g: 230, b: 226 }));
});

after(async () => {
  serveurSite.close();
  serveurOpenAI.close();
  await prisma.$disconnect();
});

async function dossierAvecPhoto(nom: string) {
  const { ajouterPhoto } = await import("@/lib/dossiers/dossiers");
  const dossier = await prisma.dossier.create({ data: { clientNom: nom, clientAdresse: "", clientCp: "34970", clientVille: "Lattes", clientTelephone: "+33611223344", objet: "Recouvrement de cuisine", source: "ENTRANT", etape: "QUALIFICATION" } });
  const photo = await ajouterPhoto(dossier.id, new File([new Uint8Array(await image(1200, 900, { r: 120, g: 110, b: 100 }))], "cuisine.jpg", { type: "image/jpeg" }));
  return { dossierId: dossier.id, photoId: photo.id };
}

describe("bibliothèque de prompts", () => {
  test("chaque prompt d'origine passe le contrôle et se rend sans balise ni variable restante", () => {
    for (const type of types.TYPES_SURFACE) {
      const modele = defauts.PROMPTS_PAR_DEFAUT[type.id].texte;
      const controle = rendu.verifierModele(modele, type);
      assert.deepEqual(controle.erreurs, [], type.id);
      const lettres = rendu.etiquettes(type, type.zones);
      const texte = rendu.rendrePrompt(modele, { type, zones: type.zones.map((zone) => ({ zone, etiquette: lettres.get(zone)!, teinte: `TEINTE-${zone}` })), format: "landscape 3:2" });
      assert.doesNotMatch(texte, /\{\{|\[zone:|\[\/zone\]/, type.id);
      for (const zone of type.zones) assert.match(texte, new RegExp(`TEINTE-${zone}`), `${type.id} / ${zone}`);
      assert.match(texte, /Image 1/);
      assert.match(texte, /without asking me any question/);
    }
  });

  test("cuisine, trois zones sur quatre : lettres dans l'ordre, la zone oubliée est verrouillée", () => {
    const type = types.typeSurface("cuisine")!;
    const zones = ["plan-de-travail", "meubles-hauts", "meubles-bas"] as const;
    const lettres = rendu.etiquettes(type, [...zones]);
    assert.deepEqual([...lettres.values()], ["A · Meubles hauts", "B · Meubles bas", "C · Plan de travail"]);
    const texte = rendu.rendrePrompt(defauts.PROMPTS_PAR_DEFAUT.cuisine.texte, { type, zones: zones.map((zone) => ({ zone, etiquette: lettres.get(zone)!, teinte: `T-${zone}` })), format: "portrait 2:3" });
    assert.match(texte, /sample "A · Meubles hauts" on Image 2/);
    assert.doesNotMatch(texte, /BACKSPLASH — sample/);
    assert.match(texte, /NOT COVERED: the backsplash\. It keeps its original material/);
    assert.match(texte, /3 in all, one per zone/);
    assert.match(texte, /portrait 2:3/);
  });

  test("un modèle mal formé est refusé avec une phrase claire", () => {
    const type = types.typeSurface("bar")!;
    const sansSection = rendu.verifierModele(`Image 1 et Image 2. ${"x".repeat(300)} [zone:comptoir-habillage] {{teinte}} {{etiquette}} [/zone]`, type);
    assert.match(sansSection.erreurs.join(" "), /Il manque la section \[zone:comptoir-plateau\]/);
    const sansTeinte = rendu.verifierModele(`Image 1 Image 2 ${"x".repeat(300)} [zone:comptoir-habillage] {{etiquette}} [/zone] [zone:comptoir-plateau] {{teinte}} [/zone]`, type);
    assert.match(sansTeinte.erreurs.join(" "), /doit contenir \{\{teinte\}\}/);
    const desequilibre = rendu.verifierModele(`Image 1 Image 2 ${"x".repeat(300)} [zone:comptoir-habillage] {{teinte}} [zone:comptoir-plateau] {{teinte}} [/zone]`, type);
    assert.match(desequilibre.erreurs.join(" "), /déséquilibrées/);
  });

  test("versions : enregistrer, revenir en arrière (une version de plus), jamais réécrire", async () => {
    await bibliotheque.poserPromptsParDefaut();
    const v1 = await bibliotheque.lirePrompt("credence");
    const modifie = v1.texte.replace("TASK: edit Image 1", "TASK: carefully edit Image 1");
    const v2 = await bibliotheque.enregistrerVersion("credence", { texte: modifie, note: "Plus prudent" });
    assert.deepEqual([v2.versionCourante, v2.versions.length], [2, 2]);
    await assert.rejects(bibliotheque.enregistrerVersion("credence", { texte: modifie }), /Aucune modification/);
    const v3 = await bibliotheque.restaurerVersion("credence", 1);
    assert.equal(v3.versionCourante, 3);
    assert.equal(v3.texte, v1.texte);
    assert.equal(v3.versions[0].note, "Retour à la version 1");
    // La base refuse de réécrire une version (déclencheurs posés comme au démarrage).
    await (await import("@/lib/base/preparation")).installerDeclencheurs();
    const version = await prisma.promptSimulationVersion.findFirstOrThrow({ where: { numero: 1, prompt: { typeSurface: "credence" } } });
    await assert.rejects(prisma.promptSimulationVersion.update({ where: { id: version.id }, data: { texte: "réécrit" } }), /ne se modifie pas/);
  });
});

describe("préparer pour ChatGPT", () => {
  test("prompt rempli (teintes en toutes lettres), photo cadrée au format du modèle, dépôt qui reprend tout", async () => {
    const { dossierId, photoId } = await dossierAvecPhoto("Cuisine Essai");
    const prep = await preparation.preparerSimulation({ dossierId, photoId, typeSurface: "cuisine", mode: "CHATGPT", zones: [{ zone: "plan-de-travail", ref: "NE31" }, { zone: "meubles-hauts", ref: "AA01" }, { zone: "meubles-bas", ref: "J3" }] });
    assert.equal(prep.statut, "PREPAREE");
    assert.deepEqual(prep.zones.map((z) => [z.etiquette, z.ref]), [["A · Meubles hauts", "AA01"], ["B · Meubles bas", "J3"], ["C · Plan de travail", "NE31"]]);
    assert.match(prep.prompt!, /Cover Styl' AA01 "Beige Oak" — wood-grain decor/);
    assert.match(prep.prompt!, /running vertically/);
    assert.match(prep.prompt!, /Cover Styl' NE31 "Statuary White" — marble decor/);
    assert.match(prep.prompt!, /NE31 "Statuary White" — marble decor[^.]*along the length of this surface/, "le veinage suit la zone : dans la longueur sur un plan de travail");
    assert.match(prep.prompt!, /about #[0-9A-F]{6}/, "la couleur mesurée est écrite");
    assert.match(prep.prompt!, /NOT COVERED: the backsplash/);
    assert.equal(prep.format, "landscape 3:2");
    assert.equal(prep.promptVersion, (await bibliotheque.promptCourant("cuisine")).version);
    const cadree = await sharp((await preparation.photoDePreparation(prep.id)).contenu).metadata();
    assert.deepEqual([cadree.width, cadree.height], [1200, 800], "4:3 rogné en 3:2, à pleine résolution");

    // L'image rendue par ChatGPT, déposée sans rien préciser : elle reprend la préparation.
    const rendue = new File([new Uint8Array(await image(1536, 1024, { r: 200, g: 180, b: 150 }, "png"))], "chatgpt.png", { type: "image/png" });
    const simulation = await dossierSims.deposerSimulationDossier(dossierId, rendue, {});
    assert.deepEqual([simulation.source, simulation.statut, simulation.typeSurface, simulation.promptVersion], ["CHATGPT", "BROUILLON", "cuisine", prep.promptVersion]);
    assert.deepEqual(simulation.zones.map((z) => z.ref), ["AA01", "J3", "NE31"]);
    assert.ok(simulation.avant, "la photo avant cadrée sert au curseur avant / après");
    const relue = await preparation.lirePreparation(prep.id);
    assert.deepEqual([relue.statut, relue.resultatId], ["TERMINEE", simulation.id]);
  });

  test("une zone hors du type, ou une photo d'un autre dossier, est refusée", async () => {
    const a = await dossierAvecPhoto("A");
    const b = await dossierAvecPhoto("B");
    await assert.rejects(preparation.preparerSimulation({ dossierId: a.dossierId, photoId: a.photoId, typeSurface: "meubles-hauts", mode: "CHATGPT", zones: [{ zone: "credence", ref: "J3" }] }), /n'est pas une zone/);
    await assert.rejects(preparation.preparerSimulation({ dossierId: a.dossierId, photoId: b.photoId, typeSurface: "cuisine", mode: "CHATGPT", zones: [{ zone: "credence", ref: "J3" }] }), /Photo introuvable/);
  });
});

describe("générer par l'API", () => {
  test("la consigne vient du site (requête signée), l'image arrive en brouillon avec son coût ; la consommation est comptée", async () => {
    const { dossierId, photoId } = await dossierAvecPhoto("Api Essai");
    reponseOpenAI = { status: 200, corps: { data: [{ b64_json: (await image(1536, 1024, { r: 90, g: 80, b: 70 }, "png")).toString("base64") }], usage: { input_tokens: 5000, input_tokens_details: { text_tokens: 2000, image_tokens: 3000 }, output_tokens: 4000 } } };
    const prep = await preparation.preparerSimulation({ dossierId, photoId, typeSurface: "cuisine", mode: "API", zones: [{ zone: "meubles-hauts", ref: "AA01" }, { zone: "meubles-bas", ref: "AA01" }] });
    assert.deepEqual([prep.statut, prep.coutEstime], ["EN_COURS", 0.21], "une seule teinte : un seul échantillon, le coût annoncé le dit");
    assert.equal(await prisma.tache.count({ where: { type: preparation.TACHE_SIMULATION_API, cle: `simulation-api:${prep.id}` } }), 1);

    const { simulationId } = await preparation.executerGenerationApi(prep.id);
    const consigne = consignesRecues.at(-1)!;
    assert.equal(consigne.signatureValide, true);
    assert.deepEqual(consigne.corps, { project_type: "cuisine", selections: [{ surface: "meubles-hauts", ref: "AA01" }, { surface: "meubles-bas", ref: "AA01" }] });
    const simulation = await prisma.simulationEspace.findUniqueOrThrow({ where: { id: simulationId! } });
    assert.deepEqual([simulation.source, simulation.statut, simulation.promptTexte], ["API", "BROUILLON", "CONSIGNE DU SITE (moteur unique)"]);
    // 2 000 × 5 $ + 3 000 × 10 $ + 4 000 × 40 $ par million de jetons = 0,20 $
    assert.equal(simulation.coutDollars, 0.2);
    const generation = await prisma.generationImage.findFirstOrThrow({ where: { preparationId: prep.id } });
    assert.deepEqual([generation.origine, generation.statut, generation.jetonsSortie], ["CRM", "REUSSI", 4000]);
    assert.equal((await preparation.lirePreparation(prep.id)).statut, "TERMINEE");
    // Rejouer la tâche ne génère pas une seconde image.
    assert.deepEqual(await preparation.executerGenerationApi(prep.id), { simulationId });
  });

  test("crédit épuisé : la préparation échoue avec une phrase claire, le compteur le signale", async () => {
    const { dossierId, photoId } = await dossierAvecPhoto("Credit Essai");
    reponseOpenAI = { status: 429, corps: { error: { code: "insufficient_quota", message: "You exceeded your current quota" } } };
    const prep = await preparation.preparerSimulation({ dossierId, photoId, typeSurface: "credence", mode: "API", zones: [{ zone: "credence", ref: "J3" }] });
    assert.deepEqual(await preparation.executerGenerationApi(prep.id), { simulationId: null });
    const relue = await preparation.lirePreparation(prep.id);
    assert.equal(relue.statut, "ECHEC");
    assert.match(relue.erreur ?? "", /Crédit OpenAI épuisé/);
    const etat = await consommation.consommation();
    assert.ok(etat.creditEpuise, "le compteur dit que le crédit est épuisé");
    assert.equal(etat.mois.generations, 1);
    assert.equal(etat.mois.crm, 0.2);
  });

  test("solde estimé : le dernier solde relevé, moins ce qui a été consommé depuis", async () => {
    await prisma.parametre.create({ data: { cle: "SIMULATEUR_CREDIT_OPENAI", valeur: JSON.stringify(10), valableDu: new Date(Date.now() - 86_400_000) } });
    const etat = await consommation.consommation();
    assert.deepEqual([etat.solde?.releve, etat.solde?.consommeDepuis, etat.solde?.estime], [10, 0.2, 9.8]);
    assert.ok((etat.solde?.simulationsRestantes ?? 0) > 30);
  });
});

describe("recherche de teintes en français", () => {
  test("noyer, chêne, béton gris, début de mot, référence", async () => {
    const { correspondRecherche } = await import("./recherche-teintes");
    const noyer = { ref: "AZ07", nom: "Walnut Ash", resume: "bois · brun moyen · mat", famille: "bois" };
    const beton = { ref: "NE24", nom: "Raw Grey", resume: "béton · gris moyen · mat", famille: "beton" };
    assert.equal(correspondRecherche(noyer, "noyer"), true);
    assert.equal(correspondRecherche(noyer, "noy"), true);
    assert.equal(correspondRecherche(noyer, "Chêne"), false);
    assert.equal(correspondRecherche(beton, "béton gris"), true);
    assert.equal(correspondRecherche(beton, "beton noir"), false);
    assert.equal(correspondRecherche(beton, "ne24"), true);
    assert.equal(correspondRecherche({ ref: "AA01", nom: "Beige Oak", resume: "bois · beige · mat" }, "chene clair"), false);
    assert.equal(correspondRecherche({ ref: "AA01", nom: "Beige Oak", resume: "bois · beige · mat" }, "chene beige"), true);
  });
});

describe("la couleur mesurée, en mots justes", () => {
  test("les bois restent des bois : beige, miel, caramel, brun — jamais « jaune »", async () => {
    const { couleurEnMots, rgbVersLab } = await import("./couleur");
    const mesure = (hex: string) => {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
      const lab = rgbVersLab(r, g, b);
      return { hex, clarte: lab.L, chroma: Math.hypot(lab.a, lab.b), teinte: ((Math.atan2(lab.b, lab.a) * 180) / Math.PI + 360) % 360, contraste: 6 };
    };
    assert.match(couleurEnMots(mesure("#E1D4BB")).en, /beige/, "Pale Oak");
    assert.match(couleurEnMots(mesure("#B49063")).en, /honey|tan/, "Beige Oak");
    assert.match(couleurEnMots(mesure("#7A5634")).en, /brown|caramel/, "noyer moyen");
    assert.match(couleurEnMots(mesure("#3E2A1E")).en, /dark brown/, "noyer foncé");
    for (const hex of ["#E1D4BB", "#B49063", "#7A5634", "#3E2A1E"]) assert.doesNotMatch(couleurEnMots(mesure(hex)).en, /yellow/, hex);
    assert.match(couleurEnMots(mesure("#D9A300")).en, /yellow|mustard/, "un vrai jaune reste jaune");
    assert.match(couleurEnMots(mesure("#8C8C8A")).en, /grey/);
    assert.match(couleurEnMots(mesure("#FFFFFF")).en, /^white/);
  });
});

describe("zones venues du simulateur du site", () => {
  test("« Façades (toutes) » habille les meubles hauts et les meubles bas ; une zone nommée l'emporte", () => {
    const facades = JSON.stringify([{ zone: "facades-cuisine", libelle: "Façades (toutes)", ref: "K1", nom: "Black Mat" }, { zone: "plan-de-travail", libelle: "Plan de travail", ref: "NE24", nom: "Raw Grey" }]);
    assert.deepEqual(types.lireZones(facades).map((z) => `${z.zone}:${z.ref}:${z.libelle}`), ["meubles-hauts:K1:Meubles hauts", "meubles-bas:K1:Meubles bas", "plan-de-travail:NE24:Plan de travail"]);
    const avecHauts = JSON.stringify([{ zone: "facades-cuisine", libelle: "Façades (toutes)", ref: "K1", nom: "Black Mat" }, { zone: "meubles-hauts", libelle: "Meubles hauts", ref: "J3", nom: "Ultra White" }]);
    assert.deepEqual(types.lireZones(avecHauts).map((z) => `${z.zone}:${z.ref}`), ["meubles-bas:K1", "meubles-hauts:J3"]);
  });

  test("une simulation du site rangée sans identifiant retrouve sa zone par son libellé", () => {
    // Ancien parcours ou génération de secours du site : seules les notes « Façades : K1 (Black mat) » restent.
    const sansId = JSON.stringify([{ zone: "", libelle: "Façades", ref: "K1", nom: "Black mat" }, { zone: "", libelle: "Plan de travail", ref: "NE24", nom: "Raw Grey" }, { zone: "", libelle: "Bar / comptoir — plateau", ref: "AA01", nom: "Beige Oak" }]);
    assert.deepEqual(types.lireZones(sansId).map((z) => `${z.zone}:${z.ref}`), ["meubles-hauts:K1", "meubles-bas:K1", "plan-de-travail:NE24", "comptoir-plateau:AA01"]);
    assert.equal(types.surfaceDepuisLibelle("Meubles bas, colonnes et îlot"), "meubles-bas");
    assert.equal(types.surfaceDepuisLibelle("Une zone inconnue"), "");
  });
});
