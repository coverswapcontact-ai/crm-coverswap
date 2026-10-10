import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { preparerBaseEssai } from "@/test/base-essai";

preparerBaseEssai();
process.env.UPLOADS_DIR = mkdtempSync(path.join(tmpdir(), "coverswap-m18-a6-"));
// Vides, pas supprimées : Prisma reprendrait la valeur de .env.
for (const cle of ["NTFY_TOPIC", "TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID", "RESEND_API_KEY", "VAPID_PRIVATE_KEY", "VAPID_PUBLIC_KEY", "META_ACCESS_TOKEN", "META_PIXEL_ID", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_TOKEN_KEY", "OPENAI_ADMIN_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY"]) process.env[cle] = "";
process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3001";
process.env.TACHES_DESACTIVEES = "1";

/**
 * Mission 18 (A6) — les tarifs des devis passent dans Paramètres, onglet « Tarifs » (`/parametres?section=tarifs`) :
 * `GestionTarifs` n'est plus un sous-mode du générateur de Dossiers, la page Paramètres lit les presets avec le reste,
 * le générateur garde la liste des tarifs et son lien « Gérer les tarifs » mène à l'onglet. Les gestes de l'onglet
 * passent par les mêmes routes et laissent la base dans le même état que les outils de l'assistant, dont les liens
 * mènent à l'onglet. Puis la navigation cible à 10 onglets (barre du bas, menu « Plus ») et les anciennes adresses.
 * Base d'essai, aucun réseau.
 */

const RACINE = path.resolve(__dirname, "..", "..", "..");
const lire = (relatif: string) => readFileSync(path.join(RACINE, relatif), "utf8");
const ONGLET = "/parametres?section=tarifs";
// Les liens des outils sont rendus en adresse complète (NEXT_PUBLIC_APP_URL).
const LIEN_ONGLET = `http://localhost:3001${ONGLET}`;

type ResultatOutil = import("@/lib/assistant/definition").ResultatOutil;
type DefinitionOutil = import("@/lib/assistant/definition").DefinitionOutil<Record<string, unknown>>;

let prisma: typeof import("@/lib/prisma").default;
let sections: typeof import("@/lib/parametres/sections");
let execution: typeof import("@/lib/assistant/execution");
let generiques: typeof import("@/lib/assistant/outils/generiques");
let session: import("@/lib/assistant/execution").Session;
let NextRequestClasse: typeof import("next/server").NextRequest;
const fetchOriginal = globalThis.fetch;
const appelsReseau: string[] = [];

const executer = (outil: unknown, entree: Record<string, unknown>): Promise<ResultatOutil> => execution.executerOutil(outil as DefinitionOutil, entree, session, new Date());
const generique = (nom: string) => {
  const outil = generiques.OUTILS_GENERIQUES.find((o) => o.nom === nom);
  assert.ok(outil, nom);
  return outil;
};
const jetonDe = (texte: string) => /confirmation = « ([A-Za-z0-9_-]+) »/.exec(texte)?.[1] ?? null;
/** Un geste sensible de l'assistant : l'aperçu ne fait rien et rend un jeton, le second appel agit. */
async function confirmer(nom: string, entree: Record<string, unknown>): Promise<ResultatOutil> {
  const apercu = await executer(generique(nom), { commande: "essai mission 18 A6", ...entree });
  const jeton = jetonDe(apercu.texte);
  assert.ok(jeton, `aperçu attendu pour ${nom} : ${apercu.texte}`);
  const resultat = await executer(generique(nom), { commande: "essai mission 18 A6", ...entree, confirmation: jeton });
  assert.doesNotMatch(resultat.texte, /^Refusé|a échoué/, resultat.texte);
  return resultat;
}
const requete = (chemin: string, methode: string, corps?: unknown) =>
  new NextRequestClasse(`http://localhost:3001${chemin}`, corps === undefined ? { method: methode } : { method: methode, body: JSON.stringify(corps), headers: { "Content-Type": "application/json" } });
const contexte = (presetId: string) => ({ params: Promise.resolve({ presetId }) });
const liensDe = (r: ResultatOutil) => (r.liens ?? []).map((l) => l.href);

before(async () => {
  globalThis.fetch = (async (entree: string | URL | Request) => {
    const url = typeof entree === "string" ? entree : entree instanceof URL ? entree.href : entree.url;
    appelsReseau.push(url);
    throw new Error(`réseau coupé pendant les essais : ${url}`);
  }) as typeof fetch;
  prisma = (await import("@/lib/prisma")).default;
  await (await import("@/lib/base/preparation")).preparerBase();
  sections = await import("@/lib/parametres/sections");
  execution = await import("@/lib/assistant/execution");
  generiques = await import("@/lib/assistant/outils/generiques");
  NextRequestClasse = (await import("next/server")).NextRequest;
  session = await execution.ouvrirSession({ jetonId: null, clientNom: "essai", utilisateur: "essai@local" });
});
after(async () => {
  globalThis.fetch = fetchOriginal;
  await prisma.$disconnect();
});

describe("l'onglet Tarifs de Paramètres", () => {
  test("adresse de l'onglet : /parametres?section=tarifs", () => {
    assert.equal(sections.SECTION_TARIFS, "tarifs");
    assert.equal(sections.ADRESSE_TARIFS, ONGLET);
  });

  test("la page lit les tarifs actifs avec le reste et passe ?section=tarifs à ses onglets", async () => {
    const { listerPresets } = await import("@/lib/dossiers/presets");
    const page = (await import("@/app/(pilotage)/parametres/page")).default;
    const props = ((await page({ searchParams: Promise.resolve({ section: "tarifs" }) })) as unknown as { props: { section: string | null; presets: { id: string }[] } }).props;
    assert.equal(props.section, "tarifs");
    assert.ok(props.presets.length > 0, "les tarifs de départ sont amorcés à la première lecture");
    assert.deepEqual(props.presets.map((p) => p.id), (await listerPresets()).map((p) => p.id));
  });

  test("septième onglet « Tarifs », après Facturation ; ?section=tarifs et #tarifs l'ouvrent ; les tarifs sont gardés par les onglets", () => {
    const onglets = lire("src/app/(pilotage)/parametres/_components/OngletsParametres.tsx");
    const libelles = [...onglets.matchAll(/\{ valeur: "(\w+)", libelle: "([^"]+)" \}/g)].map((m) => m[2]);
    assert.deepEqual(libelles, ["Activité", "Facturation", "Tarifs", "Mail", "SMS", "Assistant", "Système"]);
    assert.match(onglets, /tarifs: "tarifs"/, "l'ancre #tarifs");
    assert.match(onglets, /const \[presets, setPresets\] = useState\(presetsInitiaux\)/, "on revient sur l'onglet sans perdre ce qui vient d'être changé");
    assert.match(onglets, /onglet === "tarifs" \? <GestionTarifs presets=\{presets\} setPresets=\{setPresets\} \/> : null/);
  });

  test("GestionTarifs vit dans Paramètres, sans « Retour au document » ; le générateur propose les tarifs et mène à l'onglet", () => {
    assert.ok(!existsSync(path.join(RACINE, "src/app/(pilotage)/dossiers/_components/GestionTarifs.tsx")));
    const gestion = lire("src/app/(pilotage)/parametres/_components/GestionTarifs.tsx");
    assert.doesNotMatch(gestion, /onRetour|Retour au document/);
    assert.match(gestion, /<section id="tarifs"/);
    for (const route of ['"/api/dossiers/presets", "POST"', "`/api/dossiers/presets/${preset.id}`, \"PATCH\"", "`/api/dossiers/presets/${preset.id}`, \"DELETE\"", '"/api/prestations/tarifs", "POST"']) assert.ok(gestion.includes(route), route);

    const generateur = lire("src/app/(pilotage)/dossiers/_components/GenerateurDocument.tsx");
    assert.doesNotMatch(generateur, /GestionTarifs|gestionTarifs/, "plus de sous-mode");
    assert.match(generateur, /appelApi<\{ presets: PresetVue\[\] \}>\("\/api\/dossiers\/presets"\)/, "la liste « Ajouter depuis un tarif… » reste");
    assert.match(generateur, /href=\{ADRESSE_TARIFS\}\s+target="_blank"/, "« Gérer les tarifs » ouvre l'onglet sans perdre le document");
    assert.match(generateur, /Gérer les tarifs/);
  });

  test("les gestes de l'onglet (ajouter, modifier, retirer, attribuer) laissent la base comme les outils de l'assistant", async () => {
    const routePresets = await import("@/app/api/dossiers/presets/route");
    const routePreset = await import("@/app/api/dossiers/presets/[presetId]/route");
    const routeTarifs = await import("@/app/api/prestations/tarifs/route");

    // Ajouter : l'onglet (POST) et « creer » TARIF.
    const ecran = await (await routePresets.POST(requete("/api/dossiers/presets", "POST", { designation: "Essai A6 écran", unite: "ml", prixUnitaire: 40 }))).json();
    const cree = await confirmer("creer", { entite: "TARIF", champs: { designation: "Essai A6 outil", unite: "ml", prix_unitaire: 40 } });
    assert.ok(liensDe(cree).includes(LIEN_ONGLET), JSON.stringify(cree.liens));
    const outilId = /\[tarif:([^\]]+)\]/.exec(cree.texte)![1];
    const champs = { unite: true, prixUnitaire: true, actif: true, prestations: true } as const;
    const memeEtat = async () => assert.deepEqual(await prisma.presetTarif.findUniqueOrThrow({ where: { id: ecran.id }, select: champs }), await prisma.presetTarif.findUniqueOrThrow({ where: { id: outilId }, select: champs }));
    await memeEtat();

    // Modifier : PATCH et « modifier » TARIF.
    assert.equal((await routePreset.PATCH(requete(`/api/dossiers/presets/${ecran.id}`, "PATCH", { prixUnitaire: 55, unite: "forfait" }), contexte(ecran.id))).status, 200);
    const modifie = await confirmer("modifier", { entite: "TARIF", id: outilId, champs: { prix_unitaire: 55, unite: "forfait" } });
    assert.ok(liensDe(modifie).includes(LIEN_ONGLET), JSON.stringify(modifie.liens));
    await memeEtat();

    // Attribuer à une sous-partie : POST /api/prestations/tarifs et « modifier » SOUS_PARTIE (preset_id).
    const lignes = (await (await routeTarifs.POST(requete("/api/prestations/tarifs", "POST", { cle: "CUISINE.ilot", presetId: ecran.id }))).json()).lignes as { cle: string; presetId: string | null; explicite: boolean }[];
    assert.deepEqual(lignes.filter((l) => l.cle === "CUISINE.ilot").map((l) => [l.presetId, l.explicite]), [[ecran.id, true]]);
    const attribue = await confirmer("modifier", { entite: "SOUS_PARTIE", id: "CUISINE.ilot", champs: { preset_id: outilId } });
    assert.ok(liensDe(attribue).includes(LIEN_ONGLET), JSON.stringify(attribue.liens));
    const { tarifsDesPrestations } = await import("@/lib/prestations/tarifs");
    assert.equal((await tarifsDesPrestations()).find((l) => l.cle === "CUISINE.ilot")?.presetId, outilId);

    // Retirer : DELETE et « archiver » TARIF (archivé, jamais effacé).
    assert.equal((await routePreset.DELETE(requete(`/api/dossiers/presets/${ecran.id}`, "DELETE"), contexte(ecran.id))).status, 200);
    await confirmer("archiver", { elements: [{ entite: "TARIF", id: outilId }], motif: "essai A6" });
    for (const id of [ecran.id, outilId]) assert.equal((await prisma.presetTarif.findUniqueOrThrow({ where: { id } })).actif, false, "retiré, pas effacé");
    const restants = (await (await routePresets.GET()).json()).presets as { id: string }[];
    assert.ok(!restants.some((p) => p.id === ecran.id || p.id === outilId), "l'onglet et le générateur ne les proposent plus");
    assert.deepEqual(appelsReseau, []);
  });
});

describe("les outils de l'assistant mènent à l'onglet Tarifs", () => {
  test("lister TARIFS, l'outil des tarifs (une sous-partie ou toutes), et le chemin des entités TARIF et SOUS_PARTIE", async () => {
    const { outilLister } = await import("@/lib/assistant/outils/lister");
    const { outilTarifs } = await import("@/lib/assistant/outils/reglages");
    const { TARIF, SOUS_PARTIE } = await import("@/lib/assistant/entites/argent");
    const resultats: [string, ResultatOutil][] = [
      ["lister TARIFS", await executer(outilLister, { liste: "TARIFS" })],
      ["lister TARIFS (ilot)", await executer(outilLister, { liste: "TARIFS", filtres: { sous_partie: "ilot" } })],
      ["tarifs", await executer(outilTarifs, {})],
    ];
    for (const [nom, r] of resultats) {
      assert.ok(liensDe(r).includes(LIEN_ONGLET), `${nom} : ${JSON.stringify(r.liens)}`);
      assert.ok(!liensDe(r).some((href) => href.endsWith("/dossiers")), nom);
    }
    const vide = { id: "x", nom: "x", archive: false, contexte: {} };
    assert.equal(TARIF.chemin?.(vide), ONGLET);
    assert.equal(SOUS_PARTIE.chemin?.(vide), ONGLET);
  });
});

// Mission 25 (10/10/2026) : la Messagerie entre en deuxième (11 onglets), dans la barre du bas ; Analytique passe dans « Plus ».
describe("navigation à 11 onglets (mission 25 : la Messagerie)", () => {
  test("principaux Tâches, Messagerie, Leads, Dossiers, Mail, Clients, Analytique ; secondaires Simulateur, Site, Finances, Paramètres", async () => {
    const navigation = await import("@/components/pilotage/Navigation");
    const libelles = (entrees: { libelle: string }[]) => entrees.map((e) => e.libelle);
    assert.deepEqual(libelles(navigation.PRINCIPALES), ["Tâches", "Messagerie", "Leads", "Dossiers", "Mail", "Clients", "Analytique"]);
    assert.deepEqual(libelles(navigation.SECONDAIRES), ["Simulateur", "Site", "Finances", "Paramètres"]);
    assert.equal(navigation.PRINCIPALES.length + navigation.SECONDAIRES.length, 11);
    // Chaque onglet mène à un écran qui existe, et à aucun écran retiré.
    for (const entree of [...navigation.PRINCIPALES, ...navigation.SECONDAIRES]) {
      assert.ok(existsSync(path.join(RACINE, "src/app/(pilotage)", entree.href, "page.tsx")), entree.href);
      assert.ok(!["/espaces", "/depenses", "/taches-de-fond"].includes(entree.href), entree.href);
    }
    assert.deepEqual(navigation.SECONDAIRES.find((e) => e.href === "/finances")?.aussi, ["/depenses/nouvelle"], "la saisie d'une dépense allume Finances");
  });

  test("barre du bas : Tâches, Messagerie, Leads, Dossiers, Mail, puis « Plus » (Clients, Analytique, Simulateur, Site, Finances, Paramètres)", async () => {
    const navigation = await import("@/components/pilotage/Navigation");
    assert.deepEqual(navigation.PRINCIPALES.filter((e) => e.mobile).map((e) => e.libelle), ["Tâches", "Messagerie", "Leads", "Dossiers", "Mail"]);
    assert.ok(!navigation.SECONDAIRES.some((e) => e.mobile), "un écran secondaire n'est jamais dans la barre du bas");
    assert.deepEqual(navigation.DANS_LE_MENU.map((e) => e.libelle), ["Clients", "Analytique", "Simulateur", "Site", "Finances", "Paramètres"]);
    const source = lire("src/components/pilotage/Navigation.tsx");
    assert.match(source, /gridTemplateColumns: `repeat\(\$\{PRINCIPALES\.filter\(\(entree\) => entree\.mobile\)\.length \+ 1\}/, "la grille suit le nombre d'entrées (5 + Plus)");
    assert.doesNotMatch(source, /\b(Smartphone|Workflow|Receipt)\b/, "plus d'icône des onglets retirés");
  });
});

describe("anciennes adresses et application installée", () => {
  test("/espaces, /depenses, /taches-de-fond redirigent (307, sans chaîne) vers un écran qui existe ; leurs écrans sont retirés", async () => {
    const config = (await import("../../../next.config")).default;
    const regles = await config.redirects!();
    const attendues: Record<string, string> = { "/espaces": "/dossiers?espace=TOUS", "/depenses": "/finances?section=depenses", "/taches-de-fond": sections.ADRESSE_SYSTEME };
    for (const [source, destination] of Object.entries(attendues)) {
      const regle = regles.find((r) => r.source === source);
      assert.ok(regle, source);
      assert.equal(regle.destination, destination);
      assert.equal(regle.permanent, false);
      const cible = destination.split("?")[0];
      assert.ok(!regles.some((r) => r.source === cible), `${cible} ne redirige pas à son tour`);
      assert.ok(existsSync(path.join(RACINE, "src/app/(pilotage)", cible, "page.tsx")), cible);
      assert.ok(!existsSync(path.join(RACINE, "src/app/(pilotage)", source, "page.tsx")), `écran ${source} retiré`);
    }
    assert.ok(existsSync(path.join(RACINE, "src/app/(pilotage)/depenses/nouvelle/page.tsx")), "la saisie d'une dépense reste un écran");
  });

  test("les raccourcis de l'application installée mènent à des écrans ; le service worker change de version (écrans retirés hors du cache)", () => {
    const manifeste = JSON.parse(lire("public/manifest-crm.webmanifest")) as { start_url: string; shortcuts: { url: string }[] };
    for (const url of [manifeste.start_url, ...manifeste.shortcuts.map((r) => r.url)]) assert.ok(existsSync(path.join(RACINE, "src/app/(pilotage)", url, "page.tsx")), url);
    // v12 à la mission 18 ; chaque mission qui change les écrans servis hors ligne monte d'un cran (v13 : mission 22, la coque).
    assert.ok(Number(lire("public/sw.js").match(/const VERSION = "v(\d+)";/)?.[1]) >= 12);
  });
});
