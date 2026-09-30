import assert from "node:assert/strict";
import { generateKeyPairSync, verify } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, beforeEach, describe, test } from "node:test";
import { preparerBaseEssai } from "@/test/base-essai";

preparerBaseEssai();
process.env.UPLOADS_DIR = mkdtempSync(path.join(tmpdir(), "coverswap-connecteurs-"));

/**
 * Mission 17 (partie B) — les connecteurs de l'Analytique, sans aucune requête réelle (`fetch` remplacé par un faux
 * serveur qui répond selon l'adresse) : dépense Meta (pagination, leads jamais doublés, upsert idempotent, sans
 * variables = NON_BRANCHEE sans appel, échec qui garde la dernière réussite) ; compte de service Google (JWT RS256
 * vérifié avec la clé publique, jeton gardé en mémoire) ; Search Console (upsert, position pondérée, doublon www,
 * 16 mois au premier passage) ; fiche Google (403 → en attente d'accès, métriques et avis) ; état des sources, file de
 * tâches et tâche système d'une synchronisation en panne. Identifiants fictifs.
 */

let prisma: typeof import("@/lib/prisma").default;
let depense: typeof import("@/lib/meta/depense");
let graph: typeof import("@/lib/meta/graph");
let compteService: typeof import("@/lib/google/compte-service");
let searchConsole: typeof import("@/lib/google/search-console");
let fiche: typeof import("@/lib/google/fiche");
let etat: typeof import("./etat");
let suivi: typeof import("./suivi");
let synchro: typeof import("./synchro");

type Reponse = { statut?: number; corps: unknown };
type Requete = { url: string; methode: string; corps: string | null; entetes: Headers };
let repondre: (r: Requete) => Reponse = () => ({ statut: 500, corps: { error: "aucune route" } });
const requetes: Requete[] = [];
const fetchOrigine = globalThis.fetch;

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const CLE_PEM = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const CLE_JSON = JSON.stringify({ type: "service_account", client_email: "crm-essai@projet-essai.iam.gserviceaccount.com", private_key: CLE_PEM, private_key_id: "cle-essai-1" });
/** Un environnement d'essai (les fonctions lisent `env`, jamais le vrai `.env`). */
const env = (variables: Record<string, string> = {}) => variables as unknown as NodeJS.ProcessEnv;
const ENV_META = env({ META_AD_ACCOUNT_ID: "act_1234567890", META_ADS_TOKEN: "jeton-ads-essai" });
const ENV_GOOGLE = env({ GOOGLE_SERVICE_ACCOUNT_JSON: CLE_JSON, GOOGLE_BUSINESS_LOCATION: "locations/111", GOOGLE_BUSINESS_ACCOUNT: "222" });

before(async () => {
  globalThis.fetch = (async (entree: string | URL | Request, init?: RequestInit) => {
    const url = String(entree instanceof Request ? entree.url : entree);
    const r: Requete = { url, methode: init?.method ?? "GET", corps: typeof init?.body === "string" ? init.body : null, entetes: new Headers(init?.headers) };
    requetes.push(r);
    const { statut = 200, corps } = repondre(r);
    return new Response(JSON.stringify(corps), { status: statut, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  prisma = (await import("@/lib/prisma")).default;
  depense = await import("@/lib/meta/depense");
  graph = await import("@/lib/meta/graph");
  compteService = await import("@/lib/google/compte-service");
  searchConsole = await import("@/lib/google/search-console");
  fiche = await import("@/lib/google/fiche");
  etat = await import("./etat");
  suivi = await import("./suivi");
  synchro = await import("./synchro");
  await (await import("@/lib/base/preparation")).preparerBase();
});

beforeEach(() => {
  requetes.length = 0;
  compteService.oublierJetonsCompteService();
});

after(async () => {
  globalThis.fetch = fetchOrigine;
  await prisma.$disconnect();
});

/* ── Meta ──────────────────────────────────────────────────────────────── */

const ligneInsights = (jour: string, ad: string, spend: string, actions: { action_type: string; value: string }[] = []) => ({
  date_start: jour,
  date_stop: jour,
  account_currency: "EUR",
  campaign_id: "c1",
  campaign_name: "Cuisine septembre",
  adset_id: "s1",
  adset_name: "Montpellier 30 km",
  ad_id: ad,
  ad_name: `Publicité ${ad}`,
  spend,
  impressions: "1000",
  clicks: "25",
  inline_link_clicks: "18",
  actions,
});

function serveurMeta(pages: unknown[][]) {
  return (r: Requete): Reponse => {
    if (!r.url.includes("/act_1234567890/insights")) return { statut: 404, corps: { error: { message: "inconnu", code: 803 } } };
    const n = Number(new URL(r.url).searchParams.get("after") ?? "0");
    const suivante = n + 1 < pages.length ? `https://graph.facebook.com/v26.0/act_1234567890/insights?access_token=jeton-ads-essai&after=${n + 1}` : undefined;
    return { corps: { data: pages[n], paging: suivante ? { cursors: { after: String(n + 1) }, next: suivante } : { cursors: {} } } };
  };
}

describe("Meta : la vraie dépense (insights)", () => {
  test("sans variables : NON_BRANCHEE, aucun appel, rien d'écrit", async () => {
    const bilan = await depense.synchroniserDepenseMeta({ depuis: "2026-09-22", jusqua: "2026-09-30" }, { env: env() });
    assert.equal(bilan.etat, "NON_BRANCHEE");
    assert.equal(bilan.appels, 0);
    assert.match(bilan.message ?? "", /META_AD_ACCOUNT_ID, META_ADS_TOKEN/);
    assert.equal(requetes.length, 0);
    assert.equal(await prisma.depensePubJour.count(), 0);
    assert.equal(await prisma.sourceAnalytique.count(), 0);
  });

  test("les leads de Meta : lead_grouped sinon lead, jamais les deux", () => {
    assert.equal(depense.leadsDesActions([{ action_type: "lead", value: "3" }, { action_type: "onsite_conversion.lead_grouped", value: "3" }, { action_type: "link_click", value: "40" }]), 3);
    assert.equal(depense.leadsDesActions([{ action_type: "lead", value: "2" }]), 2);
    assert.equal(depense.leadsDesActions([{ action_type: "link_click", value: "9" }]), 0);
    assert.equal(depense.leadsDesActions(undefined), 0);
  });

  test("pagination suivie jusqu'au bout, upsert idempotent, suivi META à jour", async () => {
    const pages = [
      [ligneInsights("2026-09-28", "a1", "12.34", [{ action_type: "onsite_conversion.lead_grouped", value: "3" }, { action_type: "lead", value: "3" }]), ligneInsights("2026-09-28", "a2", "5.10")],
      [ligneInsights("2026-09-29", "a1", "11.00", [{ action_type: "lead", value: "2" }])],
    ];
    repondre = serveurMeta(pages);
    const bilan = await depense.synchroniserDepenseMeta({ depuis: "2026-09-28", jusqua: "2026-09-29" }, { env: ENV_META });
    assert.deepEqual([bilan.etat, bilan.lignes, bilan.du, bilan.au], ["A_JOUR", 3, "2026-09-28", "2026-09-29"]);
    assert.equal(requetes.length, 2, "deux pages");
    const premiere = new URL(requetes[0].url);
    assert.equal(premiere.pathname, "/v26.0/act_1234567890/insights");
    assert.deepEqual([premiere.searchParams.get("level"), premiere.searchParams.get("time_increment"), premiere.searchParams.get("access_token")], ["ad", "1", "jeton-ads-essai"]);
    assert.deepEqual(JSON.parse(premiere.searchParams.get("time_range") ?? "{}"), { since: "2026-09-28", until: "2026-09-29" });
    assert.match(premiere.searchParams.get("fields") ?? "", /spend.*impressions.*clicks.*inline_link_clicks.*actions/);

    const lignes = await prisma.depensePubJour.findMany({ orderBy: [{ jour: "asc" }, { publiciteId: "asc" }] });
    assert.deepEqual(
      lignes.map((l) => [l.plateforme, l.jour, l.publiciteId, l.depense, l.impressions, l.clics, l.clicsLien, l.leadsPlateforme, l.campagneNom, l.ensembleId, l.compteId]),
      [
        ["META", "2026-09-28", "a1", 12.34, 1000, 25, 18, 3, "Cuisine septembre", "s1", "1234567890"],
        ["META", "2026-09-28", "a2", 5.1, 1000, 25, 18, 0, "Cuisine septembre", "s1", "1234567890"],
        ["META", "2026-09-29", "a1", 11, 1000, 25, 18, 2, "Cuisine septembre", "s1", "1234567890"],
      ]
    );
    // Meta révise un chiffre : la même période relue réécrit les mêmes lignes.
    pages[0][0] = ligneInsights("2026-09-28", "a1", "13.00", [{ action_type: "onsite_conversion.lead_grouped", value: "4" }]);
    await depense.synchroniserDepenseMeta({ depuis: "2026-09-28", jusqua: "2026-09-29" }, { env: ENV_META });
    assert.equal(await prisma.depensePubJour.count(), 3, "aucune ligne doublée");
    const revue = await prisma.depensePubJour.findUniqueOrThrow({ where: { plateforme_jour_publiciteId: { plateforme: "META", jour: "2026-09-28", publiciteId: "a1" } } });
    assert.deepEqual([revue.depense, revue.leadsPlateforme], [13, 4]);

    const s = await suivi.lireSuivi("META");
    assert.equal(s?.detail.etat, "A_JOUR");
    assert.ok(s?.derniereReussiteLe);
    const meta = (await etat.etatDesSources(new Date(), ENV_META)).find((e) => e.source === "META");
    assert.deepEqual([meta?.etat, meta?.branchee, meta?.aFaire, meta?.estimation], ["A_JOUR", true, null, undefined]);
  });

  test("limites de l'API Marketing (80000-80014) passagères ; un échec garde la dernière réussite ; jeton refusé = définitif", async () => {
    assert.equal(graph.estCodePassager(80004), true);
    assert.equal(graph.estCodePassager(80014), true);
    assert.equal(graph.estCodePassager(80015), false);
    assert.equal(graph.estCodePassager(17), true);
    assert.equal(graph.estCodePassager(190), false);
    const reussite = (await suivi.lireSuivi("META"))?.derniereReussiteLe;

    repondre = () => ({ statut: 400, corps: { error: { message: "User request limit reached", code: 80004, error_subcode: 2446079 } } });
    await assert.rejects(() => depense.synchroniserDepenseMeta({ depuis: "2026-09-28", jusqua: "2026-09-29" }, { env: ENV_META }), (e: unknown) => e instanceof graph.ErreurGraph && e.passagere);
    const apres = await suivi.lireSuivi("META");
    assert.deepEqual([apres?.detail.etat, apres?.echecsConsecutifs, apres?.derniereReussiteLe?.getTime()], ["EN_ECHEC", 1, reussite?.getTime()]);
    const meta = (await etat.etatDesSources(new Date(), ENV_META)).find((e) => e.source === "META");
    assert.equal(meta?.etat, "EN_ECHEC");
    assert.equal(meta?.derniereReussite, reussite?.toISOString(), "la dernière réussite reste affichée");
    assert.match(meta?.erreur ?? "", /limit/);

    repondre = () => ({ statut: 400, corps: { error: { message: "Invalid OAuth access token", code: 190 } } });
    await assert.rejects(() => depense.synchroniserDepenseMeta({ depuis: "2026-09-28", jusqua: "2026-09-29" }, { env: ENV_META }), (e: unknown) => e instanceof Error && e.name === "ErreurDefinitive" && /ads_read/.test(e.message));
    assert.equal((await suivi.lireSuivi("META"))?.echecsConsecutifs, 2);
  });
});

/* ── Google : compte de service ────────────────────────────────────────── */

function serveurJeton(r: Requete): Reponse | null {
  if (r.url !== "https://oauth2.googleapis.com/token") return null;
  return { corps: { access_token: `jeton-google-${requetes.filter((x) => x.url === r.url).length}`, expires_in: 3599, token_type: "Bearer" } };
}

describe("compte de service Google : JWT RS256", () => {
  test("la signature se vérifie avec la clé publique ; en-tête et revendications attendues", () => {
    const { compte } = compteService.configurationCompteService(ENV_GOOGLE);
    assert.ok(compte);
    const maintenant = Date.parse("2026-09-30T08:00:00Z");
    const jwt = compteService.assertionJwt(compte, [compteService.PORTEES_ANALYTIQUE.SEARCH_CONSOLE, compteService.PORTEES_ANALYTIQUE.FICHE], maintenant);
    const [entete, corps, signature] = jwt.split(".");
    assert.ok(verify("sha256", Buffer.from(`${entete}.${corps}`), publicKey, Buffer.from(signature, "base64url")), "signature RS256 valide");
    assert.ok(!verify("sha256", Buffer.from(`${entete}.${corps}x`), publicKey, Buffer.from(signature, "base64url")), "un corps modifié ne se vérifie plus");
    assert.deepEqual(JSON.parse(Buffer.from(entete, "base64url").toString()), { alg: "RS256", typ: "JWT", kid: "cle-essai-1" });
    const revendications = JSON.parse(Buffer.from(corps, "base64url").toString());
    assert.equal(revendications.iss, "crm-essai@projet-essai.iam.gserviceaccount.com");
    assert.equal(revendications.aud, "https://oauth2.googleapis.com/token");
    assert.equal(revendications.scope, "https://www.googleapis.com/auth/webmasters.readonly https://www.googleapis.com/auth/business.manage");
    assert.equal(revendications.exp - revendications.iat, 3600);
    assert.equal(revendications.iat, maintenant / 1000 - 30);
  });

  test("la clé collée avec des « \\n » littéraux, ou encodée en base64, se lit ; absente ou illisible se dit", () => {
    const litterale = JSON.stringify({ client_email: "a@b.iam.gserviceaccount.com", private_key: CLE_PEM.replace(/\n/g, "\\n") }).replace(/\\\\n/g, "\\\\n");
    assert.equal(compteService.configurationCompteService(env({ GOOGLE_SERVICE_ACCOUNT_JSON: litterale })).compte?.clePrivee.includes("\n"), true);
    assert.equal(compteService.configurationCompteService(env({ GOOGLE_SERVICE_ACCOUNT_JSON: Buffer.from(CLE_JSON).toString("base64") })).compte?.idCle, "cle-essai-1");
    assert.deepEqual(compteService.configurationCompteService(env()), { compte: null, erreur: null });
    assert.match(compteService.configurationCompteService(env({ GOOGLE_SERVICE_ACCOUNT_JSON: "{pas du json" })).erreur ?? "", /illisible/);
  });

  test("le jeton : échangé contre le JWT signé, gardé en mémoire jusqu'à expiration", async () => {
    repondre = (r) => serveurJeton(r) ?? { statut: 404, corps: {} };
    const t1 = await compteService.jetonCompteService([compteService.PORTEES_ANALYTIQUE.SEARCH_CONSOLE], { env: ENV_GOOGLE });
    const t2 = await compteService.jetonCompteService([compteService.PORTEES_ANALYTIQUE.SEARCH_CONSOLE], { env: ENV_GOOGLE });
    assert.equal(t1, t2);
    assert.equal(requetes.length, 1, "un seul échange");
    const envoi = new URLSearchParams(requetes[0].corps ?? "");
    assert.equal(envoi.get("grant_type"), "urn:ietf:params:oauth:grant-type:jwt-bearer");
    const [e, c, s] = (envoi.get("assertion") ?? "").split(".");
    assert.ok(verify("sha256", Buffer.from(`${e}.${c}`), publicKey, Buffer.from(s, "base64url")));
  });
});

/* ── Search Console ────────────────────────────────────────────────────── */

function serveurSearchConsole(lignes: Record<string, { keys: string[]; clicks: number; impressions: number; ctr: number; position: number }[]>) {
  return (r: Requete): Reponse => {
    const jeton = serveurJeton(r);
    if (jeton) return jeton;
    if (!r.url.startsWith("https://searchconsole.googleapis.com/webmasters/v3/sites/sc-domain%3Acoverswap.fr/searchAnalytics/query")) return { statut: 404, corps: {} };
    assert.match(r.entetes.get("authorization") ?? "", /^Bearer jeton-google-/);
    const corps = JSON.parse(r.corps ?? "{}") as { dimensions: string[]; rowLimit: number; startRow: number };
    assert.equal(corps.rowLimit, 25_000);
    const rows = lignes[corps.dimensions.join(",")] ?? [];
    return { corps: rows.length ? { rows, responseAggregationType: "auto" } : { responseAggregationType: "auto" } };
  };
}

describe("Search Console", () => {
  test("premier passage : 16 mois ; ensuite : les 5 derniers jours ; sans compte de service : NON_BRANCHEE sans appel", async () => {
    const sans = await searchConsole.synchroniserSearchConsole({}, { env: env() });
    assert.deepEqual([sans.etat, sans.appels, requetes.length], ["NON_BRANCHEE", 0, 0]);
    repondre = serveurSearchConsole({});
    const maintenant = new Date("2026-09-30T08:00:00Z");
    const premier = await searchConsole.synchroniserSearchConsole({}, { env: ENV_GOOGLE, maintenant });
    assert.deepEqual([premier.etat, premier.du, premier.au], ["A_JOUR", "2025-05-30", "2026-09-30"]);
    assert.equal(requetes.filter((r) => r.url.includes("searchAnalytics")).length, 17 * 3, "une tranche par mois, trois dimensions");
  });

  test("upsert (TOTAL, REQUETE, PAGE), position pondérée par les impressions, doublon www", async () => {
    const ligne = (keys: string[], clicks: number, impressions: number, position: number) => ({ keys, clicks, impressions, ctr: impressions ? clicks / impressions : 0, position });
    repondre = serveurSearchConsole({
      date: [ligne(["2026-09-20"], 5, 200, 9.5), ligne(["2026-09-21"], 3, 150, 11.2)],
      "date,query": [ligne(["2026-09-20", "covering cuisine montpellier"], 2, 40, 6.4), ligne(["2026-09-21", "renovation cuisine sans travaux"], 0, 60, 14)],
      "date,page": [
        ligne(["2026-09-20", "https://coverswap.fr/prestations/cuisine#avis"], 1, 30, 4),
        ligne(["2026-09-20", "https://coverswap.fr/prestations/cuisine"], 2, 10, 8),
        ligne(["2026-09-21", "https://www.coverswap.fr/"], 0, 25, 12),
      ],
    });
    const bilan = await searchConsole.synchroniserSearchConsole({ depuis: "2026-09-20", jusqua: "2026-09-21" }, { env: ENV_GOOGLE });
    assert.deepEqual([bilan.etat, bilan.lignes], ["A_JOUR", 6]);
    await searchConsole.synchroniserSearchConsole({ depuis: "2026-09-20", jusqua: "2026-09-21" }, { env: ENV_GOOGLE });
    assert.equal(await prisma.seoJour.count(), 6, "rejouée : aucune ligne doublée");
    const total = await prisma.seoJour.findUniqueOrThrow({ where: { jour_dimension_cle: { jour: "2026-09-20", dimension: "TOTAL", cle: "" } } });
    assert.deepEqual([total.clics, total.impressions, total.position], [5, 200, 9.5]);
    const page = await prisma.seoJour.findUniqueOrThrow({ where: { jour_dimension_cle: { jour: "2026-09-20", dimension: "PAGE", cle: "https://coverswap.fr/prestations/cuisine" } } });
    assert.deepEqual([page.clics, page.impressions, page.position], [3, 40, 5], "(4 × 30 + 8 × 10) / 40 = 5");
    assert.equal(searchConsole.positionPonderee([{ impressions: 30, position: 4 }, { impressions: 10, position: 8 }, { impressions: 0, position: 50 }]), 5);

    const doublon = await searchConsole.doublonWww("2026-09-20", "2026-09-21");
    assert.equal(doublon.detecte, true);
    assert.deepEqual(doublon.exemples.sort(), ["https://coverswap.fr/prestations/cuisine", "https://www.coverswap.fr/"]);
    assert.deepEqual(doublon.hotes.map((h) => [h.hote, h.impressions]), [["coverswap.fr", 40], ["www.coverswap.fr", 25]]);
    assert.equal((await searchConsole.doublonWww("2026-09-20", "2026-09-20")).detecte, false, "le 20, seul l'hôte sans www");
    assert.equal(searchConsole.doublonWwwDesPages([{ page: "https://coverswap.fr/a" }, { page: "https://coverswap.fr/b" }]).detecte, false);
  });

  test("compte de service pas ajouté dans Search Console (403) : en attente d'accès, sans lever", async () => {
    repondre = (r) => serveurJeton(r) ?? { statut: 403, corps: { error: { code: 403, message: "User does not have sufficient permission for site 'sc-domain:coverswap.fr'.", status: "PERMISSION_DENIED" } } };
    const bilan = await searchConsole.synchroniserSearchConsole({ depuis: "2026-09-25", jusqua: "2026-09-26" }, { env: ENV_GOOGLE });
    assert.equal(bilan.etat, "EN_ATTENTE_ACCES");
    const sc = (await etat.etatDesSources(new Date(), ENV_GOOGLE)).find((e) => e.source === "SEARCH_CONSOLE");
    assert.deepEqual([sc?.etat, sc?.erreur], ["EN_ATTENTE_ACCES", null]);
    assert.match(sc?.aFaire ?? "", /crm-essai@projet-essai\.iam\.gserviceaccount\.com comme utilisateur de la propriété sc-domain:coverswap\.fr/);
  });
});

/* ── Fiche Google ──────────────────────────────────────────────────────── */

describe("Fiche Google", () => {
  test("403 (accès Business Profile non accordé) ou quota 0 : EN_ATTENTE_ACCES, jamais une erreur", async () => {
    repondre = (r) => serveurJeton(r) ?? { statut: 403, corps: { error: { code: 403, message: "The caller does not have permission", status: "PERMISSION_DENIED" } } };
    const bilan = await fiche.synchroniserFicheGoogle({ depuis: "2026-09-01", jusqua: "2026-09-10" }, { env: ENV_GOOGLE });
    assert.equal(bilan.etat, "EN_ATTENTE_ACCES");
    const s = await suivi.lireSuivi("FICHE_GOOGLE");
    assert.deepEqual([s?.detail.etat, s?.echecsConsecutifs], ["EN_ATTENTE_ACCES", 0]);
    const f = (await etat.etatDesSources(new Date(), ENV_GOOGLE)).find((e) => e.source === "FICHE_GOOGLE");
    assert.deepEqual([f?.etat, f?.erreur, f?.aFaire], ["EN_ATTENTE_ACCES", null, "Accès à l'API Business Profile demandé à Google : en attente"]);

    repondre = (r) => serveurJeton(r) ?? { statut: 429, corps: { error: { code: 429, message: "Quota exceeded for quota metric 'Requests' and limit 'Requests per minute' of service 'businessprofileperformance.googleapis.com'", status: "RESOURCE_EXHAUSTED", details: [{ reason: "RATE_LIMIT_EXCEEDED", metadata: { quota_limit_value: "0" } }] } } };
    assert.equal((await fiche.synchroniserFicheGoogle({ depuis: "2026-09-01", jusqua: "2026-09-10" }, { env: ENV_GOOGLE })).etat, "EN_ATTENTE_ACCES");
  });

  test("accès accordé : métriques du jour (valeur absente = 0) et avis", async () => {
    repondre = (r) => {
      const jeton = serveurJeton(r);
      if (jeton) return jeton;
      if (r.url.startsWith("https://businessprofileperformance.googleapis.com/v1/locations/111:fetchMultiDailyMetricsTimeSeries?")) {
        const p = new URL(r.url).searchParams;
        assert.equal(p.getAll("dailyMetrics").length, 8);
        assert.deepEqual([p.get("dailyRange.startDate.year"), p.get("dailyRange.startDate.month"), p.get("dailyRange.startDate.day"), p.get("dailyRange.endDate.day")], ["2026", "9", "1", "2"]);
        const serie = (dailyMetric: string, valeurs: (string | undefined)[]) => ({ dailyMetric, timeSeries: { datedValues: valeurs.map((value, i) => ({ date: { year: 2026, month: 9, day: i + 1 }, ...(value === undefined ? {} : { value }) })) } });
        return { corps: { multiDailyMetricTimeSeries: [{ dailyMetricTimeSeries: [serie("BUSINESS_IMPRESSIONS_MOBILE_SEARCH", ["12", undefined]), serie("CALL_CLICKS", [undefined, "1"])] }] } };
      }
      if (r.url === "https://mybusiness.googleapis.com/v4/accounts/222/locations/111/reviews?pageSize=1") return { corps: { reviews: [], averageRating: 5, totalReviewCount: 2 } };
      return { statut: 404, corps: {} };
    };
    const maintenant = new Date("2026-09-30T08:00:00Z");
    const bilan = await fiche.synchroniserFicheGoogle({ depuis: "2026-09-01", jusqua: "2026-09-02" }, { env: ENV_GOOGLE, maintenant });
    assert.deepEqual([bilan.etat, bilan.lignes], ["A_JOUR", 6]);
    const lignes = await prisma.ficheGoogleJour.findMany({ orderBy: [{ jour: "asc" }, { metrique: "asc" }] });
    assert.deepEqual(
      lignes.map((l) => [l.jour, l.metrique, l.valeur]),
      [
        ["2026-09-01", "BUSINESS_IMPRESSIONS_MOBILE_SEARCH", 12],
        ["2026-09-01", "CALL_CLICKS", 0],
        ["2026-09-02", "BUSINESS_IMPRESSIONS_MOBILE_SEARCH", 0],
        ["2026-09-02", "CALL_CLICKS", 1],
        ["2026-09-30", "AVIS_NOMBRE", 2],
        ["2026-09-30", "AVIS_NOTE", 5],
      ]
    );
    assert.equal((await etat.etatDesSources(new Date(), ENV_GOOGLE)).find((e) => e.source === "FICHE_GOOGLE")?.etat, "A_JOUR");
  });
});

/* ── État, file de tâches, tâche système ───────────────────────────────── */

describe("état des sources, file de tâches, pannes", () => {
  test("sans aucune variable : ce qu'il faut faire, en une phrase par source ; jamais un zéro trompeur", async () => {
    const etats = await etat.etatDesSources(new Date(), env());
    assert.deepEqual(etats.map((e) => [e.source, e.etat]), [["CRM", "A_JOUR"], ["SITE", "A_JOUR"], ["META", "NON_BRANCHEE"], ["GOOGLE_ADS", "NON_BRANCHEE"], ["SEARCH_CONSOLE", "NON_BRANCHEE"], ["FICHE_GOOGLE", "EN_ATTENTE_ACCES"]]);
    const par = Object.fromEntries(etats.map((e) => [e.source, e]));
    assert.equal(par.META.aFaire, "Poser META_AD_ACCOUNT_ID et META_ADS_TOKEN sur Railway (jeton utilisateur système avec le droit ads_read)");
    assert.equal(par.META.estimation, true);
    assert.equal(par.SEARCH_CONSOLE.aFaire, "Poser GOOGLE_SERVICE_ACCOUNT_JSON et ajouter le compte de service comme utilisateur de la propriété Search Console");
    assert.match(par.FICHE_GOOGLE.aFaire ?? "", /^Accès à l'API Business Profile demandé à Google : en attente/);
    assert.ok(par.GOOGLE_ADS.aFaire);
  });

  test("ANALYTIQUE_SYNCHRO : charge vérifiée, relance à la main, Google Ads sans connecteur, passe de la nuit à partir de 4 h", async () => {
    assert.deepEqual(synchro.lireCharge({ source: "META", depuis: "2026-09-01" }), { source: "META", depuis: "2026-09-01", jusqua: undefined });
    assert.throws(() => synchro.lireCharge({ source: "TIKTOK" }), /Source inconnue/);
    assert.throws(() => synchro.lireCharge({ source: "META", depuis: "hier" }), /invalide/);
    const id = await synchro.relancerSynchro("SEARCH_CONSOLE");
    const tache = await prisma.tache.findUniqueOrThrow({ where: { id } });
    assert.deepEqual([tache.type, JSON.parse(tache.charge)], ["ANALYTIQUE_SYNCHRO", { source: "SEARCH_CONSOLE" }]);
    assert.equal((await synchro.synchroniser({ source: "GOOGLE_ADS" })).etat, "NON_BRANCHEE");
    assert.deepEqual(await synchro.planifierNuit(new Date("2026-09-30T01:30:00Z")), [], "3 h 30 à Paris : trop tôt");
    const avant = { ...process.env };
    Object.assign(process.env, ENV_META, { GOOGLE_SERVICE_ACCOUNT_JSON: "" });
    try {
      assert.deepEqual(await synchro.planifierNuit(new Date("2026-09-30T02:30:00Z")), ["analytique:META:nuit:2026-09-30"]);
      const nuit = await prisma.tache.findUniqueOrThrow({ where: { cle: "analytique:META:nuit:2026-09-30" } });
      assert.deepEqual(JSON.parse(nuit.charge), { source: "META", depuis: "2026-07-02", jusqua: "2026-09-30" }, "90 jours sans campagne renseignée");
    } finally {
      for (const cle of Object.keys(ENV_META)) process.env[cle] = avant[cle] ?? "";
    }
  });

  test("une synchronisation en échec depuis plus de 24 h : tâche système SYSTEME:synchro-meta, niveau 4, dans sante_systeme", async () => {
    const il_y_a_30h = new Date(Date.now() - 30 * 3_600_000);
    await prisma.sourceAnalytique.update({ where: { source: "META" }, data: { detail: JSON.stringify({ etat: "EN_ECHEC", echecDepuis: il_y_a_30h.toISOString() }), derniereErreur: "Meta injoignable" } });
    const avant = { ...process.env };
    Object.assign(process.env, ENV_META);
    try {
      const pannes = await etat.pannesDeSynchro(new Date());
      assert.deepEqual(pannes.map((p) => [p.source, p.heures >= 29]), [["META", true]]);
      const { detecteurSysteme } = await import("@/lib/a-faire/detecteurs/systeme");
      const detections = await detecteurSysteme.detecter({ maintenant: new Date(), vigueur: new Map() });
      const tache = detections.find((d) => d.cle === "SYSTEME:synchro-meta");
      assert.ok(tache, detections.map((d) => d.cle).join(", "));
      assert.equal(tache.niveau, 4);
      assert.match(tache.titre, /Publicité Meta/);
      assert.match(tache.raccourci.marche ?? "", /META_ADS_TOKEN/);
      const { santeSysteme } = await import("@/lib/assistant/outils/lecture");
      const sante = await santeSysteme(new Date());
      assert.equal(sante.analytique?.sources.find((s) => s.source === "META")?.etat, "EN_ECHEC");
    } finally {
      for (const cle of Object.keys(ENV_META)) process.env[cle] = avant[cle] ?? "";
    }
  });
});
