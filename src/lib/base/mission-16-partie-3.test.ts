import assert from "node:assert/strict";
import { existsSync, mkdtempSync, promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, beforeEach, describe, test } from "node:test";
import { NextRequest } from "next/server";
import { preparerBaseEssai } from "@/test/base-essai";

preparerBaseEssai();
process.env.UPLOADS_DIR = mkdtempSync(path.join(tmpdir(), "coverswap-m16-3-"));
// Vides, pas supprimées : Prisma reprendrait la valeur de .env (preparerBaseEssai vide déjà GOOGLE_PLACES_API_KEY).
process.env.GOOGLE_PLACES_API_KEY = "";
process.env.GOOGLE_PLACE_ID = "";

/**
 * Mission 16 (partie 3) — l'accueil du site : la route publique GET /api/site/avis-google (sans clé ni lieu :
 * `{ disponible: false }`, aucun appel ; avec : la Places API lue par un client SIMULÉ, note / nombre / avis
 * normalisés avec l'attribution exigée par Google, copie de 24 h écrite sur le volume et jamais servie au-delà,
 * une lecture à la fois, pause d'une heure après un échec), `routes-publiques` à jour, `sante_systeme` qui le dit,
 * l'événement `WHATSAPP_CLIQUE` accepté par la liste blanche, et les photos publiées en WebP réduit (`?l=`) pour le
 * `srcset` du site. `fetch` est remplacé pendant tout le fichier : une requête réseau fait échouer le test. Noms
 * fictifs.
 */

let prisma: typeof import("@/lib/prisma").default;
let avis: typeof import("@/lib/site/avis-google");
let route: typeof import("@/app/api/site/avis-google/route");
let routePhotos: typeof import("@/app/api/site/photos/[id]/[quelle]/route");
let publicationsSite: typeof import("@/lib/site/publications");
let routeEvenements: typeof import("@/app/api/site/evenements/route");
let evenements: typeof import("@/lib/site/evenements");
let routesPubliques: typeof import("@/lib/acces/routes-publiques");
let lecture: typeof import("@/lib/assistant/outils/lecture");
let execution: typeof import("@/lib/assistant/execution");

const fetchOrigine = globalThis.fetch;
let requetesReseau: string[] = [];
const HEURE = 3_600_000;
const ENV = { GOOGLE_PLACES_API_KEY: "cle-factice-des-essais", GOOGLE_PLACE_ID: "ChIJ-lieu-essai" };

/** La réponse de la Places API (New) telle qu'elle arrive, avec des cas à écarter. */
const REPONSE_PLACES = {
  rating: 4.86,
  userRatingCount: 23,
  reviews: [
    {
      rating: 5,
      publishTime: "2026-08-12T09:30:00Z",
      googleMapsUri: "https://www.google.com/maps/reviews/data=essai-1",
      authorAttribution: { displayName: "  Camille   Rousselet ", uri: "https://www.google.com/maps/contrib/essai-1/reviews", photoUri: "https://lh3.googleusercontent.com/a/essai-1=s128" },
      text: { text: "Texte traduit", languageCode: "fr" },
      originalText: { text: "  Cuisine   méconnaissable,\n équipe soigneuse.  ", languageCode: "fr" },
    },
    { rating: 4, publishTime: "pas une date", authorAttribution: { displayName: "Paul", uri: "javascript:alert(1)", photoUri: "http://lh3.googleusercontent.com/a/essai-2" }, googleMapsUri: "pas une adresse", text: { text: "B".repeat(20) + " " + "mot ".repeat(120) } },
    { rating: 5, authorAttribution: { displayName: "" }, text: { text: "Sans auteur : écarté" } },
    { rating: 5, authorAttribution: { displayName: "Inès Martin-Dubois" }, text: { text: "" } },
    { rating: 9, authorAttribution: { displayName: "élodie léger" }, text: { text: "Note hors bornes : gardé sans note." } },
  ],
};

type Appel = { url: string; headers: Record<string, string> };
function fauxGoogle(reponse: () => Response): { client: import("@/lib/site/avis-google").ClientPlaces; appels: Appel[] } {
  const appels: Appel[] = [];
  return {
    appels,
    client: async (url, init) => {
      appels.push({ url, headers: init.headers });
      return reponse();
    },
  };
}
const json = (corps: unknown, status = 200) => new Response(JSON.stringify(corps), { status, headers: { "Content-Type": "application/json" } });
const lireCopie = async () => JSON.parse(await fs.readFile(avis.fichierCacheAvis(), "utf8")) as { lieu: string; luLe: number; donnees: Record<string, unknown> };

before(async () => {
  process.env.NEXTAUTH_SECRET = "secret-de-session-pour-les-essais";
  process.env.TACHES_DESACTIVEES = "1";
  globalThis.fetch = (async (entree: string | URL | Request) => {
    requetesReseau.push(String(entree instanceof Request ? entree.url : entree));
    throw new Error("Aucune requête réseau dans les essais");
  }) as typeof fetch;
  prisma = (await import("@/lib/prisma")).default;
  avis = await import("@/lib/site/avis-google");
  route = await import("@/app/api/site/avis-google/route");
  routePhotos = await import("@/app/api/site/photos/[id]/[quelle]/route");
  publicationsSite = await import("@/lib/site/publications");
  routeEvenements = await import("@/app/api/site/evenements/route");
  evenements = await import("@/lib/site/evenements");
  routesPubliques = await import("@/lib/acces/routes-publiques");
  lecture = await import("@/lib/assistant/outils/lecture");
  execution = await import("@/lib/assistant/execution");
});

beforeEach(async () => {
  avis.oublierAvisGoogleEnMemoire();
  await fs.rm(avis.fichierCacheAvis(), { force: true });
  requetesReseau = [];
});

after(async () => {
  globalThis.fetch = fetchOrigine;
  await prisma.$disconnect();
});

const requeteAvis = (ip = "203.0.113.30") => new NextRequest("http://localhost/api/site/avis-google", { headers: { "x-forwarded-for": ip } });

describe("GET /api/site/avis-google", () => {
  test("sans GOOGLE_PLACES_API_KEY ni GOOGLE_PLACE_ID : { disponible: false } en 200, en cache une heure, aucun appel", async () => {
    const reponse = await route.GET(requeteAvis());
    assert.equal(reponse.status, 200);
    assert.deepEqual(await reponse.json(), { disponible: false });
    assert.equal(reponse.headers.get("Cache-Control"), "public, max-age=3600, s-maxage=3600");
    assert.equal(reponse.headers.get("Access-Control-Allow-Origin"), "*");
    assert.deepEqual(requetesReseau, []);
    assert.equal(existsSync(avis.fichierCacheAvis()), false, "rien d'écrit");
    // Une seule des deux variables ne suffit pas.
    assert.equal(avis.configurationAvisGoogle({ GOOGLE_PLACES_API_KEY: "cle" }), null);
    assert.equal(avis.configurationAvisGoogle({ GOOGLE_PLACE_ID: "lieu", GOOGLE_PLACES_API_KEY: "  " }), null);
  });

  test("avec la clé et le lieu : la route lit Google (fetch simulé), la clé part en en-tête, jamais dans l'adresse", async () => {
    process.env.GOOGLE_PLACES_API_KEY = ENV.GOOGLE_PLACES_API_KEY;
    process.env.GOOGLE_PLACE_ID = ENV.GOOGLE_PLACE_ID;
    const vus: { url: string; cle: string | null }[] = [];
    globalThis.fetch = (async (entree: string | URL | Request, init?: RequestInit) => {
      vus.push({ url: String(entree), cle: new Headers(init?.headers).get("X-Goog-Api-Key") });
      return json(REPONSE_PLACES);
    }) as typeof fetch;
    try {
      const donnees = await (await route.GET(requeteAvis("203.0.113.31"))).json();
      assert.equal(donnees.disponible, true);
      assert.deepEqual([donnees.note, donnees.nombre], [4.9, 23]);
      assert.deepEqual(vus, [{ url: "https://places.googleapis.com/v1/places/ChIJ-lieu-essai?fields=rating,userRatingCount,reviews&languageCode=fr", cle: "cle-factice-des-essais" }]);
      assert.ok(!vus[0].url.includes("cle-factice"), "la clé n'est jamais dans l'adresse");
      await route.GET(requeteAvis("203.0.113.31"));
      assert.equal(vus.length, 1, "seconde demande : la copie, pas Google");
    } finally {
      process.env.GOOGLE_PLACES_API_KEY = "";
      process.env.GOOGLE_PLACE_ID = "";
      globalThis.fetch = (async (entree: string | URL | Request) => {
        requetesReseau.push(String(entree));
        throw new Error("Aucune requête réseau dans les essais");
      }) as typeof fetch;
    }
  });

  test("limite par IP : au-delà de 120 demandes en 10 min, 429 et { disponible: false }", async () => {
    let derniere: Response | null = null;
    for (let i = 0; i < 121; i++) derniere = await route.GET(requeteAvis("203.0.113.99"));
    assert.equal(derniere?.status, 429);
    assert.deepEqual(await derniere?.json(), { disponible: false });
  });
});

describe("lecture chez Google (client simulé)", () => {
  test("note arrondie, nombre exact, avis normalisés (attribution de Google, texte ≤ 300, date), écartés sans auteur ou sans texte", async () => {
    const google = fauxGoogle(() => json(REPONSE_PLACES));
    const maintenant = Date.parse("2026-09-30T10:00:00Z");
    const donnees = await avis.avisGoogle({ client: google.client, env: ENV, maintenant });
    assert.ok(donnees.disponible);
    assert.deepEqual([donnees.note, donnees.nombre], [4.9, 23]);
    // Règles de la Places API : l'auteur crédité tel que Google le nomme (pas abrégé), son profil, son avatar, l'avis sur Google Maps.
    assert.deepEqual(donnees.avis.map((a) => a.auteur), ["Camille Rousselet", "Paul", "élodie léger"]);
    assert.deepEqual(
      [donnees.avis[0].lienAuteur, donnees.avis[0].photoAuteur, donnees.avis[0].lienAvis],
      ["https://www.google.com/maps/contrib/essai-1/reviews", "https://lh3.googleusercontent.com/a/essai-1=s128", "https://www.google.com/maps/reviews/data=essai-1"]
    );
    assert.deepEqual([donnees.avis[1].lienAuteur, donnees.avis[1].photoAuteur, donnees.avis[1].lienAvis], [null, null, null], "https: seulement (ni javascript:, ni http:, ni texte)");
    assert.deepEqual([donnees.avis[2].lienAuteur, donnees.avis[2].photoAuteur, donnees.avis[2].lienAvis], [null, null, null], "absents chez Google : rien");
    assert.equal(donnees.avis[0].texte, "Cuisine méconnaissable, équipe soigneuse.", "le texte d'origine, espaces resserrés");
    assert.equal(donnees.avis[0].date, "2026-08-12T09:30:00.000Z");
    assert.deepEqual([donnees.avis[1].date, donnees.avis[1].note], [null, 4]);
    assert.ok(donnees.avis[1].texte.length <= avis.TEXTE_AVIS_MAX && donnees.avis[1].texte.endsWith("…"), donnees.avis[1].texte);
    assert.equal(donnees.avis[2].note, null, "note hors bornes : pas de note");
    assert.deepEqual(google.appels.map((a) => [a.url, a.headers["X-Goog-Api-Key"]]), [[avis.urlPlaces("ChIJ-lieu-essai"), "cle-factice-des-essais"]]);

    // Copie écrite sur le volume (24 h), relue sans appeler Google, même après un redémarrage (mémoire oubliée).
    const copie = await lireCopie();
    assert.deepEqual([copie.lieu, copie.luLe, copie.donnees.note], ["ChIJ-lieu-essai", maintenant, 4.9]);
    assert.ok(avis.fichierCacheAvis().startsWith(process.env.UPLOADS_DIR!), "sur le volume des téléversements");
    avis.oublierAvisGoogleEnMemoire();
    assert.deepEqual(await avis.avisGoogle({ client: google.client, env: ENV, maintenant: maintenant + 23 * HEURE }), donnees);
    assert.equal(google.appels.length, 1);
    // Au-delà de 24 h : Google est relu.
    await avis.avisGoogle({ client: google.client, env: ENV, maintenant: maintenant + 25 * HEURE });
    assert.equal(google.appels.length, 2);
    assert.equal((await lireCopie()).luLe, maintenant + 25 * HEURE);
    assert.deepEqual(requetesReseau, []);
  });

  test("sans note ou sans nombre chez Google : indisponible (le site n'invente rien)", () => {
    assert.deepEqual(avis.normaliserPlaces({ userRatingCount: 3 }), { disponible: false });
    assert.deepEqual(avis.normaliserPlaces({ rating: 4.5 }), { disponible: false });
    assert.deepEqual(avis.normaliserPlaces({ rating: 4.5, userRatingCount: 0 }), { disponible: false });
    assert.deepEqual(avis.normaliserPlaces({ rating: 0, userRatingCount: 4 }), { disponible: false });
    assert.deepEqual(avis.normaliserPlaces(null), { disponible: false });
    assert.deepEqual(avis.normaliserPlaces({ rating: 5, userRatingCount: 1 }), { disponible: true, note: 5, nombre: 1, avis: [] });
    assert.equal(avis.nomAuteur("  Jean  "), "Jean");
    assert.equal(avis.nomAuteur("Jean   de La Fontaine"), "Jean de La Fontaine");
    assert.equal(avis.nomAuteur(42), null);
    assert.equal(avis.nomAuteur("   "), null);
    assert.equal(avis.lienHttps("https://www.google.com/maps/contrib/1"), "https://www.google.com/maps/contrib/1");
    for (const refuse of ["javascript:alert(1)", "http://www.google.com/maps", "data:text/html,x", "//www.google.com", "", 42, null]) assert.equal(avis.lienHttps(refuse), null, String(refuse));
    assert.equal(avis.texteCourt("court"), "court");
  });

  test("un échec ne sert jamais une copie de plus de 24 h et ne réessaie pas avant une heure ; un autre lieu ne reprend pas la copie", async () => {
    let enPanne = false;
    const google = fauxGoogle(() => (enPanne ? json({ error: { code: 403, message: "API key not valid. Please pass a valid API key." } }, 403) : json(REPONSE_PLACES)));
    const t0 = Date.parse("2026-09-30T10:00:00Z");
    const premiere = await avis.avisGoogle({ client: google.client, env: ENV, maintenant: t0 });
    assert.ok(premiere.disponible);
    enPanne = true;
    assert.deepEqual(await avis.avisGoogle({ client: google.client, env: ENV, maintenant: t0 + 23 * HEURE }), premiere, "copie de moins de 24 h : servie, Google n'est pas relu");
    assert.equal(google.appels.length, 1);
    assert.deepEqual(await avis.avisGoogle({ client: google.client, env: ENV, maintenant: t0 + 25 * HEURE }), { disponible: false }, "copie de 25 h et Google en échec : rien (pas une note périmée)");
    assert.equal(google.appels.length, 2);
    assert.deepEqual(await avis.avisGoogle({ client: google.client, env: ENV, maintenant: t0 + 25.5 * HEURE }), { disponible: false });
    assert.equal(google.appels.length, 2, "pause d'une heure après l'échec");
    const etat = await avis.etatAvisGoogle(ENV);
    assert.deepEqual([etat.connectes, etat.note, etat.nombre], [true, 4.9, 23]);
    assert.match(etat.erreur ?? "", /^HTTP 403 : API key not valid/);
    assert.ok(!(etat.erreur ?? "").includes("cle-factice"));
    enPanne = false;
    assert.equal((await avis.avisGoogle({ client: google.client, env: ENV, maintenant: t0 + 26.5 * HEURE })).disponible, true, "Google revenu : la note revient");
    assert.equal(google.appels.length, 3, "après une heure, Google est relu");
    assert.equal((await avis.etatAvisGoogle(ENV)).erreur, null);

    // Un autre lieu : la copie n'est pas la sienne.
    avis.oublierAvisGoogleEnMemoire();
    enPanne = true;
    const autre = { ...ENV, GOOGLE_PLACE_ID: "ChIJ-autre-lieu" };
    assert.deepEqual(await avis.avisGoogle({ client: google.client, env: autre, maintenant: t0 + 27 * HEURE }), { disponible: false });
    assert.equal(google.appels.at(-1)?.url, avis.urlPlaces("ChIJ-autre-lieu"));
  });

  test("une lecture à la fois : deux demandes simultanées, un seul appel", async () => {
    let liberer: () => void = () => undefined;
    const attente = new Promise<void>((r) => (liberer = r));
    let appels = 0;
    const client: import("@/lib/site/avis-google").ClientPlaces = async () => {
      appels++;
      await attente;
      return json(REPONSE_PLACES);
    };
    const a = avis.avisGoogle({ client, env: ENV });
    const b = avis.avisGoogle({ client, env: ENV });
    liberer();
    const [ra, rb] = await Promise.all([a, b]);
    assert.equal(appels, 1);
    assert.deepEqual(ra, rb);
  });
});

describe("routes publiques", () => {
  test("/api/site/avis-google est publique, avec sa protection ; ce qui est dessous ne l'est pas", () => {
    assert.equal(routesPubliques.estRoutePublique("/api/site/avis-google"), true);
    assert.equal(routesPubliques.estRoutePublique("/api/site/avis-google/autre"), false);
    const entree = routesPubliques.ROUTES_PUBLIQUES.find((r) => r.chemin === "/api/site/avis-google");
    assert.ok(entree && !entree.prefixe && /clé reste sur le serveur/.test(entree.protection));
  });
});

describe("sante_systeme : les avis Google", () => {
  const outil = (definition: unknown) => definition as import("@/lib/assistant/definition").DefinitionOutil<Record<string, unknown>>;
  const texte = async () => (await execution.executerOutil(outil((await import("@/lib/assistant/outils/etat")).outilEtatCrm), { partie: "SANTE" }, await execution.ouvrirSession({ jetonId: null, clientNom: "essai", utilisateur: "essai" }))).texte;

  test("sans clé ni lieu : « non connectés », avec le nom des variables", async () => {
    assert.equal(lecture.texteAvisGoogle({ connectes: false, note: null, nombre: null, luLe: null, erreur: null }), "Avis Google : non connectés (GOOGLE_PLACES_API_KEY / GOOGLE_PLACE_ID).");
    assert.match(await texte(), /^Avis Google : non connectés \(GOOGLE_PLACES_API_KEY \/ GOOGLE_PLACE_ID\)\.$/m);
    assert.deepEqual((await lecture.santeSysteme()).avisGoogle, { connectes: false, note: null, nombre: null, luLe: null, erreur: null });
  });

  test("connectés : la dernière lecture (note, nombre, date), sans appeler Google", async () => {
    await avis.avisGoogle({ client: fauxGoogle(() => json(REPONSE_PLACES)).client, env: ENV, maintenant: Date.parse("2026-09-30T10:00:00Z") });
    process.env.GOOGLE_PLACES_API_KEY = ENV.GOOGLE_PLACES_API_KEY;
    process.env.GOOGLE_PLACE_ID = ENV.GOOGLE_PLACE_ID;
    try {
      assert.match(await texte(), /^Avis Google : connectés — 4,9 sur 5, 23 avis \(lus le .+\)\.$/m);
      assert.ok(!requetesReseau.some((u) => u.includes("places.googleapis.com")), "sante_systeme n'appelle jamais Google Places");
      avis.oublierAvisGoogleEnMemoire();
      await fs.rm(avis.fichierCacheAvis(), { force: true });
      assert.match(await texte(), /^Avis Google : connectés, pas encore lus/m);
    } finally {
      process.env.GOOGLE_PLACES_API_KEY = "";
      process.env.GOOGLE_PLACE_ID = "";
    }
  });
});

describe("WHATSAPP_CLIQUE", () => {
  test("accepté par la liste blanche, enregistré, compté sur sa propre ligne de la synthèse", async () => {
    assert.equal(evenements.estTypeEvenementSite("WHATSAPP_CLIQUE"), true);
    assert.equal(evenements.typeCanonique("WHATSAPP_CLIQUE"), "WHATSAPP_CLIQUE");
    assert.equal(evenements.LIBELLES_EVENEMENT_SITE.WHATSAPP_CLIQUE, "Clics WhatsApp");
    const parcoursId = "dddddddd-1603-4000-8000-000000000001";
    const reponse = await routeEvenements.POST(
      new NextRequest("http://localhost/api/site/evenements", {
        method: "POST",
        body: JSON.stringify({ parcoursId, type: "WHATSAPP_CLIQUE", page: "/", source: "instagram", meta: { depuis: "accueil-final" } }),
        // Mission 17 (partie B) : un navigateur (sans User-Agent, la mesure y voit un robot et n'enregistre rien).
        headers: { "content-type": "text/plain", origin: "https://coverswap.fr", "x-forwarded-for": "203.0.113.40", "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1" },
      })
    );
    assert.equal(reponse.status, 200);
    assert.deepEqual(await reponse.json(), { ok: true });
    const ligne = await prisma.evenementSite.findFirstOrThrow({ where: { parcoursId } });
    assert.deepEqual([ligne.type, ligne.page, JSON.parse(ligne.meta ?? "{}")], ["WHATSAPP_CLIQUE", "/", { depuis: "accueil-final" }]);
    // Le jour de Paris (relecture B, point 13 : la synthèse du site lit des jours de Paris ; après 22 h UTC, le jour UTC est la veille).
    const jour = (await import("@/lib/dossiers/dates")).jourParis(new Date());
    const synthese = await evenements.syntheseSite(jour, jour);
    assert.deepEqual(synthese.parType.find((t) => t.cle === "WHATSAPP_CLIQUE"), { cle: "WHATSAPP_CLIQUE", libelle: "Clics WhatsApp", valeur: 1, parcours: 1 });
    // Un type inconnu reste refusé.
    const refus = await routeEvenements.POST(new NextRequest("http://localhost/api/site/evenements", { method: "POST", body: JSON.stringify({ parcoursId, type: "WHATSAPP_OUVERT" }), headers: { "x-forwarded-for": "203.0.113.40" } }));
    assert.equal(refus.status, 400);
  });
});

describe("GET /api/site/photos/<id>/<quelle>?l= : la largeur utile pour le srcset du site", () => {
  test("largeur servie : WebP réduit, jamais agrandi, gardé en mémoire ; sans l ou l inconnue : la photo telle quelle ; retirée : 404", async () => {
    const { default: sharp } = await import("sharp");
    const chemin = "dossiers/m16-3/photos-apres/apres-essai.jpg";
    const absolu = path.join(process.env.UPLOADS_DIR!, chemin);
    await fs.mkdir(path.dirname(absolu), { recursive: true });
    const jpeg = await sharp({ create: { width: 1200, height: 800, channels: 3, background: { r: 180, g: 170, b: 160 } } }).jpeg().toBuffer();
    await fs.writeFile(absolu, jpeg);
    const p = await prisma.publicationSite.create({ data: { type: "REALISATION", titre: "Cuisine essai", typeProjet: "CUISINE", photoApres: chemin, accordClientLe: new Date(), publieLe: new Date() } });
    const demander = (l?: string) => routePhotos.GET(new NextRequest(`http://localhost/api/site/photos/${p.id}/apres${l === undefined ? "" : `?l=${l}`}`), { params: Promise.resolve({ id: p.id, quelle: "apres" }) });

    const reduite = await demander("480");
    assert.equal(reduite.status, 200);
    assert.equal(reduite.headers.get("Content-Type"), "image/webp");
    assert.equal(reduite.headers.get("Access-Control-Allow-Origin"), "*");
    const octets = Buffer.from(await reduite.arrayBuffer());
    const meta = await sharp(octets).metadata();
    assert.deepEqual([meta.format, meta.width, meta.height], ["webp", 480, 320]);
    assert.ok(octets.length < jpeg.length);
    assert.equal((await sharp(Buffer.from(await (await demander("1600")).arrayBuffer())).metadata()).width, 1200, "jamais agrandie");
    assert.deepEqual(Buffer.from(await (await demander("480")).arrayBuffer()), octets, "gardée en mémoire");
    for (const l of [undefined, "", "500", "abc", "-1"]) {
      const r = await demander(l);
      assert.equal(r.headers.get("Content-Type"), "image/jpeg", String(l));
      assert.deepEqual(Buffer.from(await r.arrayBuffer()), jpeg, String(l));
    }
    assert.deepEqual(publicationsSite.LARGEURS_PHOTO_SITE, [480, 960, 1600]);

    await prisma.publicationSite.update({ where: { id: p.id }, data: { retireLe: new Date() } });
    assert.equal((await demander("480")).status, 404, "retirée : plus servie, même réduite");
    assert.deepEqual(requetesReseau, []);
  });
});
