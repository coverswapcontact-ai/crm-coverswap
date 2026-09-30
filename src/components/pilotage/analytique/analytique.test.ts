import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { preparerBaseEssai } from "@/test/base-essai";

preparerBaseEssai();

/**
 * Mission 17 (partie B) — l'écran Analytique, sans navigateur : formats français (Intl fr-FR, insécables), comparaison à
 * la période précédente (flèche du sens, couleur du sens FAVORABLE, jamais de rouge), adresse de l'écran (onglet,
 * période, dates libres, filtre), redirections des anciennes adresses, rendu serveur des cinq onglets sur le jeu
 * d'essai (maquette du 30/09), routes GET /api/analytique et POST /api/analytique/synchro sur une base d'essai.
 * Aucune requête réseau.
 */

import * as format from "./format";
import * as requete from "./requete";
import { ARGENT_ESSAI, ENSEMBLE_ESSAI, PUBLICITE_ESSAI, SEO_ESSAI, SITE_ESSAI } from "./donnees-essai";

const NBSP = " ";
const FINE = " ";
const fetchOriginal = globalThis.fetch;
const appelsReseau: string[] = [];

describe("formats français", () => {
  test("euros, pourcentages, positions, nombres ; « — » sans valeur", () => {
    assert.equal(format.formaterValeur(3.91, "euros"), `3,91${NBSP}€`);
    assert.equal(format.formaterValeur(201, "euros"), `201${NBSP}€`);
    assert.equal(format.formaterValeur(9060, "euros"), `9${FINE}060${NBSP}€`, "milliers : espace fine insécable (Intl fr-FR)");
    assert.equal(format.formaterValeur(1234.5, "euros", { decimales: 2 }), `1${FINE}234,5${NBSP}€`);
    assert.equal(format.formaterValeur(74.6, "euros", { decimales: 0, approximatif: true }), `≈${NBSP}75${NBSP}€`);
    assert.equal(format.formaterValeur(0.0889, "pourcent"), `8,9${NBSP}%`, "sous 10 % : une décimale");
    assert.equal(format.formaterValeur(17 / 30, "pourcent"), `57${NBSP}%`);
    assert.equal(format.formaterValeur(2 / 38, "pourcent", { decimales: 0 }), `5${NBSP}%`);
    assert.equal(format.formaterValeur(10.5, "position"), "10,5");
    assert.equal(format.formaterValeur(1770, "nombre"), `1${FINE}770`);
    assert.equal(format.formaterValeur(null, "euros"), "—");
    assert.equal(format.formaterValeur(Number.NaN, "nombre"), "—");
  });

  test("dates : jour de la semaine calculé (le 25/09/2026 est un vendredi), axes JJ/MM, mois", () => {
    assert.equal(format.jourLongSemaine("2026-09-25"), "Vendredi 25 septembre");
    assert.equal(format.jourAxe("2026-09-25"), "25/09");
    assert.equal(format.jourAxe("2026-09"), "sept. 26");
    assert.equal(format.moisLong("2026-08"), "Août 2026");
    assert.equal(format.dateHeureLongue("2026-09-30T05:05:00.000Z"), "Mercredi 30 septembre, 07:05");
    assert.equal(format.momentSynchro("2026-09-30T05:02:00.000Z", new Date("2026-09-30T19:00:00Z")), "à 07:02");
    assert.equal(format.momentSynchro("2026-09-29T05:02:00.000Z", new Date("2026-09-30T19:00:00Z")), "le 29/09 à 07:02");
  });

  test("sparkline : points dans la boîte 160 × 28, valeur haute en haut", () => {
    assert.equal(format.pointsSparkline([0, 10]), "0,26 160,2");
    assert.equal(format.pointsSparkline([4, 4, 4]), "0,14 80,14 160,14");
    assert.ok(format.serieVide([0, 0]));
    assert.ok(!format.serieVide([0, 1]));
  });
});

describe("comparaison à la période précédente : la couleur suit le sens favorable", () => {
  const vert = format.COULEURS_TON.favorable;
  const ambre = format.COULEURS_TON.defavorable;
  const gris = format.COULEURS_TON.neutre;
  test("flèche du sens, pourcentage, couleur du ton", () => {
    assert.deepEqual(format.evolutionAffichee({ precedente: 40, variation: 0.125, sens: "hausse", ton: "favorable" }), { fleche: "▲", texte: `▲ 13${NBSP}%`, couleur: vert, ton: "favorable" });
    // Un coût par lead qui baisse : flèche vers le bas, en vert.
    assert.equal(format.evolutionAffichee({ precedente: 5, variation: -0.08, sens: "baisse", ton: "favorable" }).texte, `▼ 8${NBSP}%`);
    assert.equal(format.evolutionAffichee({ precedente: 5, variation: -0.08, sens: "baisse", ton: "favorable" }).couleur, vert);
    // Des leads qui baissent : ambre, jamais rouge.
    assert.equal(format.evolutionAffichee({ precedente: 10, variation: -0.5, sens: "baisse", ton: "defavorable" }).couleur, ambre);
    assert.equal(format.evolutionAffichee({ precedente: 10, variation: 0.01, sens: "stable", ton: "neutre" }).texte, "= stable");
    assert.equal(format.evolutionAffichee({ precedente: 10, variation: 0.01, sens: "stable", ton: "neutre" }).couleur, gris);
    assert.equal(format.evolutionAffichee({ precedente: 0, variation: null, sens: "nouveau", ton: "favorable" }).texte, "▲ nouveau");
    assert.equal(format.evolutionAffichee({ precedente: null, variation: null, sens: null, ton: "neutre" }).texte, "", "sans base : rien");
    assert.equal(format.evolutionAffichee(null).texte, "");
    for (const couleur of Object.values(format.COULEURS_TON)) assert.doesNotMatch(couleur, /#(EF4444|F87171|DC2626)/i);
  });
  test("aide au survol : la valeur de la période précédente", () => {
    assert.equal(format.titreEvolution({ precedente: 3150, variation: -0.36, sens: "baisse", ton: "defavorable" }, "euros"), `Période précédente : 3${FINE}150${NBSP}€`);
    assert.equal(format.titreEvolution({ precedente: 0, variation: null, sens: "nouveau", ton: "favorable" }, "nombre"), "Période précédente : 0");
  });
});

describe("adresse de l'écran", () => {
  test("défauts : Vue d'ensemble, 30 jours, toutes sources ; une valeur inconnue retombe sur le défaut", () => {
    assert.deepEqual(requete.lireRequete(new URLSearchParams()), { onglet: "ensemble", periode: "30j", du: null, au: null, source: null });
    assert.deepEqual(requete.lireRequete({ onglet: "nimporte", p: "3ans", source: "tiktok" }), { onglet: "ensemble", periode: "30j", du: null, au: null, source: null });
    assert.deepEqual(requete.lireRequete({ onglet: "publicite", p: "90j" }), { onglet: "publicite", periode: "90j", du: null, au: null, source: null });
  });
  test("dates libres (prioritaires, remises dans l'ordre), filtre par source réservé à la Vue d'ensemble", () => {
    assert.deepEqual(requete.lireRequete({ p: "7j", du: "2026-09-15", au: "2026-09-01" }), { onglet: "ensemble", periode: "libre", du: "2026-09-01", au: "2026-09-15", source: null });
    assert.equal(requete.lireRequete({ du: "2026-02-31", au: "2026-03-01" }).periode, "30j", "le 31 février n'existe pas");
    assert.equal(requete.lireRequete({ du: "2020-01-01", au: "2026-09-30" }).du, "2023-09-29", "trois ans au plus (3 × 366 jours)");
    assert.equal(requete.lireRequete({ source: "meta" }).source, "meta");
    assert.equal(requete.lireRequete({ onglet: "seo", source: "meta" }).source, null);
    assert.equal(requete.lireRequete({ onglet: ["argent", "seo"] }).onglet, "argent");
  });
  test("adresse sans les défauts ; changer d'onglet garde la période", () => {
    assert.equal(requete.adresseAnalytique({}), "/analytique");
    assert.equal(requete.adresseAnalytique({ onglet: "ensemble", periode: "30j" }), "/analytique");
    assert.equal(requete.adresseAnalytique({ onglet: "publicite", periode: "7j", source: "meta" }), "/analytique?onglet=publicite&p=7j");
    assert.equal(requete.adresseAnalytique({ onglet: "ensemble", periode: "libre", du: "2026-09-01", au: "2026-09-15", source: "seo" }), "/analytique?du=2026-09-01&au=2026-09-15&source=seo");
    const aller = requete.lireRequete(new URLSearchParams(requete.adresseAnalytique({ onglet: "argent", periode: "12m" }).split("?")[1]));
    assert.deepEqual(aller, { onglet: "argent", periode: "12m", du: null, au: null, source: null });
  });
});

describe("anciennes adresses", () => {
  test("/publicite, /synthese et /analytics mènent à l'Analytique, sans chaîne de redirections", async () => {
    const config = (await import("../../../../next.config")).default;
    const regles = await config.redirects!();
    const vers = (source: string) => regles.find((r) => r.source === source && !("has" in r && r.has))?.destination;
    assert.equal(vers("/publicite"), "/analytique?onglet=publicite");
    assert.equal(vers("/synthese"), "/analytique");
    assert.equal(vers("/analytics"), "/analytique");
    for (const regle of regles) assert.ok(!regles.some((autre) => autre.source === regle.destination.split("?")[0]), `${regle.source} → ${regle.destination} redirige encore`);
    for (const regle of regles) assert.equal(regle.permanent, false, "307 : rien de figé dans le navigateur");
  });
});

describe("rendu serveur des onglets (jeu d'essai de la maquette du 30/09)", () => {
  let rendre: (noeud: ReactNode) => string;
  before(async () => {
    const { AppRouterContext } = await import("next/dist/shared/lib/app-router-context.shared-runtime");
    const routeur = { push: () => undefined, replace: () => undefined, refresh: () => undefined, back: () => undefined, forward: () => undefined, prefetch: () => undefined };
    rendre = (noeud) => renderToStaticMarkup(createElement(AppRouterContext.Provider, { value: routeur as never }, noeud));
  });
  const sansRouge = (html: string) => assert.doesNotMatch(html, /#(EF4444|F87171|DC2626)/i, "jamais de rouge dans l'Analytique");

  test("Vue d'ensemble : résumé, alertes, six tuiles, tunnel des leads aux signés, cartes, qualité, jauge des 20 %", async () => {
    const { VueEnsemble } = await import("./VueEnsemble");
    const html = rendre(createElement(VueEnsemble, { ecran: ENSEMBLE_ESSAI }));
    assert.match(html, /Résumé du jour/);
    assert.match(html, /Mercredi 30 septembre, 07:05/);
    assert.match(html, /Ça monte\./);
    assert.match(html, /www et sans www indexés tous les deux/);
    assert.equal((html.match(/data-indicateur="/g) ?? []).length, 6);
    assert.match(html, new RegExp(`3,94${NBSP}€`));
    assert.match(html, /▲ nouveau/);
    assert.match(html, /L&#x27;étape qui perd le plus/);
    assert.match(html, /joint → devis/);
    assert.match(html, /13 personnes jointes n&#x27;ont pas reçu de devis\./);
    assert.doesNotMatch(html.slice(html.indexOf("Tunnel commercial"), html.indexOf("Publicité Meta")), /Encaissés/, "le tunnel s'arrête aux signés");
    assert.match(html, /Claquement de doigt/);
    assert.match(html, /Garder/);
    assert.match(html, /Google Ads&nbsp;: pas encore branché|Google Ads : pas encore branché/);
    // Fiche Google en attente d'accès : ce qu'il faut faire, jamais un zéro.
    assert.match(html, /data-etat-source="EN_ATTENTE_ACCES"/);
    assert.match(html, /Google doit ouvrir l&#x27;accès à l&#x27;API Business Profile/);
    assert.match(html, /Qualité par source/);
    assert.match(html, /ChatGPT/);
    assert.match(html, /plafond 20/);
    assert.match(html, /Encaissé sur 30 j/);
    sansRouge(html);
  });

  test("Vue d'ensemble : une source non branchée rend « — » et ce qu'il faut faire", async () => {
    const { VueEnsemble } = await import("./VueEnsemble");
    const ecran = {
      ...ENSEMBLE_ESSAI,
      sources: ENSEMBLE_ESSAI.sources.map((s) => (s.source === "SITE" ? { ...s, branchee: false, etat: "NON_BRANCHEE" as const, aFaire: "Poser la balise sur coverswap.fr" } : s)),
      indicateurs: ENSEMBLE_ESSAI.indicateurs.map((i) => (i.cle === "visites" ? { ...i, valeur: null, serie: [] } : i)),
      publicite: null,
    };
    const html = rendre(createElement(VueEnsemble, { ecran }));
    const tuile = html.slice(html.indexOf('data-indicateur="visites"'), html.indexOf('data-indicateur="simulations"'));
    assert.match(tuile, />—</);
    assert.match(tuile, /Poser la balise sur coverswap\.fr/);
    assert.doesNotMatch(tuile, /<svg/);
    assert.match(html, /Publicité Meta/);
  });

  test("Publicité, SEO, Site, Argent : tableaux, opportunités, provenances (IA à part), règle des 20 %, carnet", async () => {
    const [{ VuePublicite, ordonnerLignes }, { VueSeo }, { VueSite }, { VueArgent }] = await Promise.all([import("./VuePublicite"), import("./VueSeo"), import("./VueSite"), import("./VueArgent")]);
    const pub = rendre(createElement(VuePublicite, { ecran: PUBLICITE_ESSAI, chaineMeta: null }));
    assert.match(pub, /Règle du jour/);
    assert.match(pub, /Surveiller/);
    assert.match(pub, /Trop tôt/);
    assert.match(pub, /data-etat-source="NON_BRANCHEE"/, "Google Ads : place vide avec son état");
    assert.deepEqual(
      ordonnerLignes(PUBLICITE_ESSAI.lignes).map((l) => `${l.profondeur}:${l.nom}`),
      ["0:Covering mobilier — septembre", "1:Montpellier 25 km", "2:Claquement de doigt", "2:Carrousel réalisations", "1:Hérault, 35-65 ans", "2:Avant / après cuisine"]
    );
    sansRouge(pub);

    const seo = rendre(createElement(VueSeo, { ecran: SEO_ESSAI }));
    assert.match(seo, /www et sans www indexés tous les deux\./);
    assert.match(seo, /Vues, jamais cliquées/);
    assert.match(seo, /Presque en première page/);
    assert.match(seo, /covering meuble montpellier/);
    assert.match(seo, /data-etat-source="EN_ATTENTE_ACCES"/);
    sansRouge(seo);

    const site = rendre(createElement(VueSite, { ecran: SITE_ESSAI }));
    assert.match(site, /Pages d&#x27;entrée/);
    assert.match(site, /ChatGPT et IA/);
    const ia = site.slice(site.indexOf("ChatGPT et IA"), site.indexOf("Appareils"));
    assert.match(ia, /chatgpt\.com/);
    assert.doesNotMatch(site.slice(site.indexOf("D&#x27;où viennent les visites"), site.indexOf("ChatGPT et IA")), /chatgpt\.com/, "les assistants IA à part");
    assert.match(site, /Déduit du fuseau horaire/);
    assert.match(site, /De la visite au lead/);
    sansRouge(site);

    const argent = rendre(createElement(VueArgent, { ecran: ARGENT_ESSAI }));
    assert.match(argent, /Carnet de commandes/);
    assert.match(argent, new RegExp(`9${FINE}060${NBSP}€`));
    assert.match(argent, /Septembre 2026/);
    assert.match(argent, /Franchise en base de TVA/);
    assert.match(argent, /URSSAF estimée/);
    assert.match(argent, /href="\/finances"/);
    sansRouge(argent);
  });
});

describe("routes de l'écran (base d'essai)", () => {
  type Routes = { ecran: typeof import("@/app/api/analytique/route"); synchro: typeof import("@/app/api/analytique/synchro/route") };
  let routes: Routes;
  let prisma: typeof import("@/lib/prisma").default;
  let NextRequestClasse: typeof import("next/server").NextRequest;
  before(async () => {
    globalThis.fetch = (async (url: string | URL | Request) => {
      appelsReseau.push(String(url));
      throw new Error("réseau interdit dans les essais");
    }) as typeof fetch;
    prisma = (await import("@/lib/prisma")).default;
    NextRequestClasse = (await import("next/server")).NextRequest;
    routes = { ecran: await import("@/app/api/analytique/route"), synchro: await import("@/app/api/analytique/synchro/route") };
  });
  after(() => {
    globalThis.fetch = fetchOriginal;
  });
  const requeteHttp = (chemin: string, corps?: unknown) =>
    new NextRequestClasse(`http://localhost:3001${chemin}`, corps === undefined ? { method: "GET" } : { method: "POST", body: typeof corps === "string" ? corps : JSON.stringify(corps), headers: { "Content-Type": "application/json" } });

  test("GET /api/analytique : l'onglet et la période demandés, l'état des six sources ; une valeur inconnue retombe sur le défaut", async () => {
    const reponse = await routes.ecran.GET(requeteHttp("/api/analytique?onglet=argent&p=7j"));
    assert.equal(reponse.status, 200);
    const { ecran, etats } = (await reponse.json()) as { ecran: { onglet: string; periode: { cle: string; jours: number }; sources: unknown[]; indicateurs: unknown[] }; etats: { source: string }[] };
    assert.equal(ecran.onglet, "argent");
    assert.equal(ecran.periode.cle, "7j");
    assert.equal(ecran.periode.jours, 7);
    assert.deepEqual(etats.map((e) => e.source).sort(), ["CRM", "FICHE_GOOGLE", "GOOGLE_ADS", "META", "SEARCH_CONSOLE", "SITE"]);
    assert.deepEqual(ecran.sources, etats, "l'état des sources est relu à chaque ouverture");

    const defaut = (await (await routes.ecran.GET(requeteHttp("/api/analytique?onglet=inconnu&p=5ans"))).json()) as { ecran: { onglet: string; periode: { cle: string } } };
    assert.equal(defaut.ecran.onglet, "ensemble");
    assert.equal(defaut.ecran.periode.cle, "30j");

    const libre = (await (await routes.ecran.GET(requeteHttp("/api/analytique?onglet=site&du=2026-09-01&au=2026-09-10"))).json()) as { ecran: { onglet: string; periode: { cle: string; du: string } } };
    assert.equal(libre.ecran.onglet, "site");
    assert.equal(libre.ecran.periode.cle, "libre");
    assert.equal(libre.ecran.periode.du, "2026-09-01");
    assert.deepEqual(appelsReseau, [], "aucun appel réseau à l'ouverture");
  });

  test("POST /api/analytique/synchro : une tâche neuve dans la file ; source inconnue ou corps illisible refusés", async () => {
    const reponse = await routes.synchro.POST(requeteHttp("/api/analytique/synchro", { source: "SEARCH_CONSOLE" }));
    assert.equal(reponse.status, 202);
    const corps = (await reponse.json()) as { ok: boolean; message: string; tache: string };
    assert.equal(corps.ok, true);
    assert.match(corps.message, /Search Console/);
    const tache = await prisma.tache.findFirst({ where: { type: "ANALYTIQUE_SYNCHRO" }, orderBy: { createdAt: "desc" } });
    assert.ok(tache);
    assert.deepEqual(JSON.parse(tache.charge), { source: "SEARCH_CONSOLE" });

    const crm = await routes.synchro.POST(requeteHttp("/api/analytique/synchro", { source: "CRM" }));
    assert.equal(crm.status, 400);
    assert.match(((await crm.json()) as { error: string }).error, /Source inconnue/);
    assert.equal((await routes.synchro.POST(requeteHttp("/api/analytique/synchro", "{pas du json"))).status, 400);
    assert.deepEqual(appelsReseau, []);
  });
});
