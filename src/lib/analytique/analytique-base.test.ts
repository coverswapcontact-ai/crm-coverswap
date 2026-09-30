import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { preparerBaseEssai } from "@/test/base-essai";

preparerBaseEssai();
process.env.TACHES_DESACTIVEES = "1";

/**
 * Mission 17 (partie B) — les définitions et les écrans de l'Analytique sur une base d'essai (jeu :
 * src/test/analytique-essai.ts) : chaque définition (lead, appelé, joint, devis, signé, encaissé, marge, panier, carnet,
 * dépense pub), bornes de Paris, filtre par source, prorata (estimation) puis dépense réelle synchronisée (coût par
 * lead propre à chaque publicité, verdicts), SEO (opportunités, doublon www), site, argent (12 mois, règle des 20 %),
 * source non branchée → null et son état, cache (mémoire, instantané, pré-calcul de 7 h), résumé du jour, alertes.
 * `fetch` est remplacé : une requête réseau fait échouer le test. Instants fixes, noms fictifs.
 */

let prisma: typeof import("@/lib/prisma").default;
let calculs: typeof import("./calculs");
let periodes: typeof import("./periode");
let ecrans: typeof import("./ecrans");
let cache: typeof import("./cache");
let memoire: typeof import("./memoire");
let essai: typeof import("@/test/analytique-essai");
let ids: import("@/test/analytique-essai").IdsEssai;

const reseau: string[] = [];
const fetchOrigine = globalThis.fetch;
let MERCREDI: Date;
const trente = () => periodes.resoudrePeriode({ p: "30j" }, MERCREDI);
const valeur = (e: { indicateurs: { cle: string; valeur: number | null }[] }, cle: string) => e.indicateurs.find((i) => i.cle === cle)?.valeur;

before(async () => {
  globalThis.fetch = (async (entree: string | URL | Request) => {
    reseau.push(String(entree instanceof Request ? entree.url : entree));
    throw new Error("Aucune requête réseau dans les essais");
  }) as typeof fetch;
  prisma = (await import("@/lib/prisma")).default;
  calculs = await import("./calculs");
  periodes = await import("./periode");
  ecrans = await import("./ecrans");
  cache = await import("./cache");
  memoire = await import("./memoire");
  essai = await import("@/test/analytique-essai");
  MERCREDI = essai.MERCREDI;
  ids = await essai.peuplerAnalytique(prisma);
});

after(async () => {
  essai.debrancherMeta();
  globalThis.fetch = fetchOrigine;
  await prisma.$disconnect();
});

describe("les définitions uniques (calculs.ts)", () => {
  test("leads : créés dans la période en jours de Paris, archivés compris, doublons fusionnés exclus", async () => {
    const leads = await calculs.leadsDeLaPeriode(trente());
    assert.equal(leads.length, 6);
    assert.equal(leads.filter((l) => l.archive).length, 1);
    const mois = await calculs.leadsDeLaPeriode(periodes.resoudrePeriode({ p: "mois" }, MERCREDI));
    assert.equal(mois.length, 6, "le lead du 01/09 à 0 h 30 (Paris) est dans le mois, celui du 31/08 à 23 h 30 non");
    assert.equal((await calculs.leadsDeLaPeriode({ du: "2026-08-31", au: "2026-08-31" })).length, 1);
  });
  test("appelés, joints (appel abouti ou écrit reçu), devis, signés, encaissés de la cohorte", async () => {
    const leads = await calculs.leadsDeLaPeriode(trente());
    const c = calculs.comptesDesLeads(leads);
    assert.deepEqual({ ...c }, { leads: 6, appeles: 2, joints: 2, devis: 2, signes: 1, encaisses: 1, montantEncaisse: 600 });
    const parId = new Map(leads.map((l) => [l.id, l]));
    assert.deepEqual([parId.get(ids.lMeta2)?.appele, parId.get(ids.lMeta2)?.joint], [true, false], "« Appel — Pas de réponse » : appelé, pas joint");
    assert.deepEqual([parId.get(ids.lSite)?.appele, parId.get(ids.lSite)?.joint], [false, true], "un mail reçu après la demande : joint");
    assert.equal(parId.get(ids.lMeta1)?.montantSigne, 2000);
    assert.deepEqual(parId.get(ids.lMeta1)?.meta, { adId: "A1", adsetId: "S1", campagneId: "C1" });
    assert.deepEqual(parId.get(ids.lSite)?.famille, "seo");
  });
  test("devis : un par dossier (variantes non cumulées), numéroté et visible, émis dans la période", async () => {
    const devis = await calculs.devisDeLaPeriode(trente());
    assert.deepEqual(devis.map((d) => d.dossierId).sort(), [ids.dA, ids.dB, ids.dC].sort());
    assert.equal(devis.find((d) => d.dossierId === ids.dA)?.jour, "2026-09-25");
    assert.deepEqual((await calculs.devisDeLaPeriode(trente(), "meta")).map((d) => d.dossierId), [ids.dA]);
  });
  test("signés : accord non retiré ou passage à Signé ; montant, panier moyen", async () => {
    const signes = await calculs.signaturesDeLaPeriode(trente());
    assert.deepEqual(signes.map((s) => [s.dossierId, s.jour, s.montant]).sort(), [[ids.dA, "2026-09-27", 2000], [ids.dC, "2026-09-29", 1500]].sort());
    assert.equal(calculs.montantSigne(signes), 3500);
    assert.equal(calculs.panierMoyen(signes), 1750);
  });
  test("encaissé : VALIDE reçu dans la période (l'annulé ne compte plus) ; marge estimée", async () => {
    const lignes = await calculs.encaissementsDeLaPeriode(trente());
    assert.equal(calculs.totalEncaisse(lignes), 600);
    const depenses = await calculs.depensesDeLaPeriode(trente());
    assert.equal(calculs.depensesDeChantier(depenses), 100);
    assert.equal(calculs.margeEstimee(600, 100), 500);
  });
  test("carnet de commandes : devis envoyés visibles non signés, avec leurs relances", async () => {
    const carnet = await calculs.carnetDeCommandes();
    assert.deepEqual(carnet.map((c) => ({ dossierId: c.dossierId, numero: c.numero, montant: c.montant, envoyeLe: c.envoyeLe, relances: c.relances })), [{ dossierId: ids.dB, numero: "2026-903", montant: 900, envoyeLe: "2026-09-28", relances: 1 }]);
  });
  test("dépense pub sans synchronisation : prorata du budget marqué estimation ; la saisie ne s'y ajoute pas", async () => {
    const d = await calculs.depensePubDeLaPeriode(trente(), MERCREDI, false);
    assert.deepEqual([d.total, d.origine, d.estimation], [151.5, "PRORATA", true]);
    const avant = await calculs.depensePubDeLaPeriode({ du: "2026-08-01", au: "2026-08-31" }, MERCREDI, false);
    assert.deepEqual([avant.total, avant.origine], [0, "PRORATA"], "campagne connue mais hors période : zéro réel, pas inconnu");
  });
});

describe("écrans sans synchronisation : estimation, sources non branchées → null et leur état", () => {
  test("Vue d'ensemble : six tuiles, tunnel et perte max, qualité par source, argent et règle des 20 %", async () => {
    memoire.viderCacheAnalytique();
    const e = await ecrans.ecranEnsemble(trente(), {}, MERCREDI);
    assert.equal(e.onglet, "ensemble");
    assert.deepEqual(e.indicateurs.map((i) => i.cle), ["visites", "simulations", "leads", "devis", "signes", "coutParSigne"]);
    assert.deepEqual(e.indicateurs.map((i) => i.valeur), [3, 1, 6, 3, 2, 151.5]);
    const leads = e.indicateurs[2];
    assert.deepEqual([leads.evolution.precedente, leads.evolution.sens, leads.evolution.ton], [1, "hausse", "favorable"]);
    assert.equal(leads.serie.length, 30);
    assert.equal(leads.serie.reduce((t, v) => t + v, 0), 6);
    assert.match(e.indicateurs[1].detail ?? "", /100 % laissent leurs coordonnées/);
    assert.equal(e.indicateurs[4].detail, "900 € en attente (1 devis)");
    assert.match(e.indicateurs[5].detail ?? "", /^Coût par lead Meta : 50,5 € \(estimation\)$/);
    assert.deepEqual(e.tunnel.etapes.map((x) => [x.cle, x.valeur, x.tauxPassage]), [["visites", 3, null], ["simulations", 2, 0.667], ["leads", 6, null], ["appeles", 2, 0.333], ["joints", 2, 1], ["devis", 2, 1], ["signes", 1, 0.5], ["encaisses", 1, 1]]);
    assert.deepEqual(e.tunnel.perteMax, { de: "leads", vers: "appeles", libelle: "lead → appel", perdus: 4 });
    assert.deepEqual(e.qualite.map((q) => [q.famille, q.leads, q.joints, q.devis, q.tauxDevis]), [["meta", 3, 1, 1, 0.333], ["autre", 2, 0, 0, 0], ["seo", 1, 1, 1, 1]]);
    assert.deepEqual(e.argent, { encaisse: 600, devisEnAttente: 900, depensePub: 151.5, ratioPub: 0.051, plafond: 0.2 });
    assert.equal(e.publicite?.jourCampagne, 9);
    assert.deepEqual([e.publicite?.depense, e.publicite?.budget, e.publicite?.leads, e.publicite?.coutParLead, e.publicite?.estimation], [151.5, 378, 3, 50.5, true]);
    assert.deepEqual(e.publicite?.publicites.map((p) => [p.nom, p.detail, p.verdict]), [["Carrousel", "1 joint sur 2 appelés · dépense par publicité inconnue", "ATTENDRE"], ["Vidéo", "0 joint sur 0 appelé · dépense par publicité inconnue", "ATTENDRE"]]);
    // Sources non branchées : pas de chiffre, leur état et ce qu'il faut faire.
    assert.deepEqual([e.seo?.clics, e.seo?.impressions, e.fiche?.vues], [null, null, null]);
    const sc = e.sources.find((s) => s.source === "SEARCH_CONSOLE");
    assert.equal(sc?.etat, "NON_BRANCHEE");
    assert.ok(sc?.aFaire);
    assert.equal(e.sources.find((s) => s.source === "META")?.estimation, true);
    assert.equal(e.resume?.phrases.length, 3);
    assert.deepEqual(reseau, []);
  });
  test("filtre par source : seulement la famille demandée", async () => {
    const e = await ecrans.ecranEnsemble(trente(), { source: "meta" }, MERCREDI);
    assert.equal(e.filtreSource, "meta");
    assert.deepEqual(e.indicateurs.slice(0, 5).map((i) => i.valeur), [1, 0, 3, 1, 1]);
    assert.deepEqual(e.qualite.map((q) => q.famille), ["meta"]);
  });
  test("Publicité : prorata au niveau de la campagne seulement, aucun coût par publicité inventé", async () => {
    const e = await ecrans.ecranPublicite(trente(), {}, MERCREDI);
    assert.equal(e.estimation, true);
    assert.deepEqual(e.campagne, { debut: "2026-09-22", jour: 9, duree: 21, budget: 378, regleDuJour: "on coupe une publicité seulement si son coût par lead dépasse le double de la meilleure sur au moins 5 leads." });
    assert.deepEqual(e.lignes.map((l) => [l.niveau, l.id, l.leadsCrm, l.coutParLead]), [["CAMPAGNE", "C1", 3, null], ["ENSEMBLE", "S1", 3, null], ["PUBLICITE", "A1", 2, null], ["PUBLICITE", "A2", 1, null]]);
    assert.deepEqual([valeur(e, "depense"), valeur(e, "impressions"), valeur(e, "leadsMeta"), valeur(e, "coutParLead")], [151.5, null, null, 50.5]);
    assert.match(e.indicateurs[0].detail ?? "", /estimation/);
    assert.equal(e.lignes.find((l) => l.id === "A1")?.verdict, null);
    assert.match(e.lignes.find((l) => l.id === "A1")?.raisonVerdict ?? "", /Dépense par publicité inconnue/);
  });
  test("SEO et fiche Google non branchés : valeurs null, listes vides", async () => {
    const e = await ecrans.ecranSeo(trente(), {}, MERCREDI);
    assert.ok(e.indicateurs.every((i) => i.valeur === null && i.serie.length === 0));
    assert.deepEqual([e.requetes, e.doublonWww, e.fiche?.avis], [[], null, { nombre: null, note: null }]);
    assert.ok(e.fiche?.indicateurs.every((i) => i.valeur === null));
  });
  test("Site : visites (mesure maison), simulations lancées → terminées → lead", async () => {
    const e = await ecrans.ecranSite(trente(), {}, MERCREDI);
    assert.deepEqual(e.indicateurs.map((i) => [i.cle, i.valeur]), [["visites", 3], ["pagesVues", 3], ["tauxSimulation", 0.667], ["tauxLead", 1]]);
    assert.deepEqual(e.entonnoir.etapes.map((x) => x.valeur), [3, 2, 1, 1]);
    assert.ok(e.courbe.series.some((s) => s.cle === "meta") && e.courbe.series.some((s) => s.cle === "seo"));
    assert.deepEqual(e.appareils, [{ appareil: "Téléphone", visites: 3 }]);
    assert.ok(e.pagesEntree.some((p) => p.page === "/" && p.visites === 1));
  });
  test("Argent : indicateurs, 12 mois, règle des 20 % mois par mois, carnet ; fiscal sans paramètres → null", async () => {
    const e = await ecrans.ecranArgent(trente(), {}, MERCREDI);
    assert.deepEqual(e.indicateurs.map((i) => [i.cle, i.valeur]), [["encaisse", 600], ["signe", 3500], ["marge", 500], ["panier", 1750], ["depensePub", 151.5], ["carnet", 900]]);
    const encaisse = e.indicateurs[0];
    assert.deepEqual([encaisse.evolution.precedente, encaisse.evolution.ton], [3000, "defavorable"]);
    assert.equal(e.indicateurs[4].evolution.ton, "defavorable", "une dépense qui monte n'est pas « favorable »");
    assert.equal(e.mois.length, 12);
    assert.deepEqual(e.mois.at(-1), { mois: "2026-09", encaisse: 600, signe: 3500, depensesPub: 151.5, depensesChantier: 100 });
    assert.deepEqual(e.mois.at(-2)?.encaisse, 3000);
    assert.deepEqual(e.regle20.at(-1), { mois: "2026-09", encaissePrecedent: 3000, depensePub: 151.5, ratio: 0.051, plafond: 0.2, depasse: false });
    assert.equal(e.regle20.length, 12);
    assert.deepEqual(e.carnet.map((c) => [c.numero, c.montant, c.relances]), [["2026-903", 900, 1]]);
    assert.deepEqual(e.fiscal, { franchiseTva: null, urssaf: null });
  });
});

describe("SEO branché (état fourni) : opportunités et doublon www", () => {
  test("clics, affichages, position pondérée ; vu jamais cliqué, proches de la première page, en hausse ; www et sans www", async () => {
    const ligne = (jour: string, dimension: string, cle: string, clics: number, impressions: number, position: number) => prisma.seoJour.create({ data: { jour, dimension, cle, clics, impressions, position, synchroniseLe: MERCREDI } });
    await ligne("2026-09-10", "TOTAL", "", 5, 200, 12);
    await ligne("2026-09-20", "TOTAL", "", 7, 300, 9);
    await ligne("2026-09-10", "REQUETE", "covering meuble montpellier", 0, 160, 11);
    await ligne("2026-09-20", "REQUETE", "covering cuisine", 7, 100, 4);
    await ligne("2026-09-20", "REQUETE", "renovation cuisine adhesif", 1, 150, 15);
    await ligne("2026-08-20", "REQUETE", "renovation cuisine adhesif", 0, 20, 30);
    await ligne("2026-09-20", "PAGE", "https://coverswap.fr/", 6, 250, 8);
    await ligne("2026-09-20", "PAGE", "https://www.coverswap.fr/", 1, 50, 14);
    const { construireEcranSeo } = await import("./ecrans/seo");
    const etats = [{ source: "SEARCH_CONSOLE" as const, branchee: true, etat: "A_JOUR" as const, derniereReussite: MERCREDI.toISOString(), erreur: null, aFaire: null }];
    const e = await construireEcranSeo(trente(), { etats });
    assert.deepEqual(e.indicateurs.map((i) => i.valeur), [12, 500, 0.024, 10.2]);
    assert.equal(e.indicateurs[3].evolution.ton, "neutre", "pas de période précédente : pas de ton");
    assert.deepEqual(e.opportunites.sansClic.map((r) => r.cle), ["covering meuble montpellier", "renovation cuisine adhesif"]);
    assert.deepEqual(e.opportunites.presquePremierePage.map((r) => [r.cle, r.position]), [["covering meuble montpellier", 11], ["renovation cuisine adhesif", 15]]);
    assert.deepEqual(e.opportunites.enHausse.map((r) => r.cle), ["covering meuble montpellier", "renovation cuisine adhesif", "covering cuisine"], "par gain d'affichages : +160, +130, +100 (nouvelle)");
    assert.equal(e.requetes[0].cle, "covering cuisine");
    assert.equal(e.doublonWww?.detecte, true);
    assert.equal(e.courbe.points.length, 30);
  });
});

describe("dépense réelle Meta synchronisée", () => {
  before(async () => {
    await essai.brancherMeta(prisma);
    memoire.viderCacheAnalytique();
  });
  test("la dépense synchronisée remplace le prorata ; la dépense saisie ne s'y ajoute pas", async () => {
    const d = await calculs.depensePubDeLaPeriode(trente(), MERCREDI, true);
    assert.deepEqual([d.total, d.origine, d.estimation], [130, "SYNCHRO", false]);
  });
  test("chaque publicité a son propre coût par lead (plus de prorata identique) et son verdict (jour 9)", async () => {
    const e = await ecrans.ecranPublicite(trente(), {}, MERCREDI);
    assert.equal(e.estimation, false);
    const a1 = e.lignes.find((l) => l.niveau === "PUBLICITE" && l.id === "A1")!;
    const a2 = e.lignes.find((l) => l.niveau === "PUBLICITE" && l.id === "A2")!;
    assert.deepEqual([a1.depense, a1.leadsPlateforme, a1.leadsCrm, a1.coutParLead, a1.ctr, a1.cpm, a1.verdict], [40, 3, 2, 20, 0.0175, 20, "GARDER"]);
    assert.deepEqual([a2.depense, a2.leadsCrm, a2.coutParLead, a2.verdict], [90, 1, 90, "SURVEILLER"]);
    assert.match(a2.raisonVerdict ?? "", /plus de 2 × la meilleure \(20 €\), mais seulement 1 lead/);
    assert.deepEqual([valeur(e, "depense"), valeur(e, "impressions"), valeur(e, "clics"), valeur(e, "leadsMeta"), valeur(e, "coutParLead"), valeur(e, "cpm")], [130, 5000, 65, 4, 43.33, 26]);
    assert.equal(e.indicateurs[0].source, "META");
    assert.equal(e.lignes.find((l) => l.niveau === "CAMPAGNE")?.depense, 130);
    assert.equal(e.lignes.filter((l) => l.plateforme === "GOOGLE_ADS").length, 0, "Google Ads : lignes vides tant que non branché");
    assert.equal(e.sources.find((s) => s.source === "GOOGLE_ADS")?.etat, "NON_BRANCHEE");
  });
  test("synchronisation en échec : les derniers chiffres restent, avec la date de dernière réussite, et une alerte", async () => {
    await prisma.sourceAnalytique.update({ where: { source: "META" }, data: { dernierEssaiLe: new Date("2026-09-30T07:00:00Z"), derniereErreur: "Error validating access token: Session has expired (190)", detail: JSON.stringify({ etat: "EN_ECHEC" }) } });
    memoire.viderCacheAnalytique();
    const e = await ecrans.ecranPublicite(trente(), {}, MERCREDI);
    const meta = e.sources.find((s) => s.source === "META")!;
    assert.deepEqual([meta.etat, meta.derniereReussite], ["EN_ECHEC", "2026-09-30T05:00:00.000Z"]);
    assert.equal(valeur(e, "depense"), 130);
    assert.ok(e.alertes.some((a) => a.cle === "SYNCHRO_META" && /Jeton Meta expiré/.test(a.texte)));
    const pourSante = await cache.alertesPourSante(MERCREDI);
    assert.ok(pourSante.some((a) => a.cle === "SYNCHRO_META"));
    await prisma.sourceAnalytique.update({ where: { source: "META" }, data: { derniereErreur: null, detail: JSON.stringify({ etat: "A_JOUR" }) } });
    memoire.viderCacheAnalytique();
  });
});

describe("cache : mémoire 5 minutes, instantané du jour, pré-calcul de 7 h ; résumé du jour", () => {
  test("mémoire puis instantané (moins d'une heure), « recalculer » force le calcul", async () => {
    memoire.viderCacheAnalytique();
    const p = trente();
    const premier = await cache.ecranAnalytique("argent", p, {}, MERCREDI);
    const second = await cache.ecranAnalytique("argent", p, {}, MERCREDI);
    assert.equal(premier, second, "même objet : servi par le cache mémoire");
    const instantane = await prisma.instantaneAnalytique.findUnique({ where: { cle: "argent:30j:2026-09-30" } });
    assert.ok(instantane);
    await prisma.encaissement.create({ data: { payeur: "Essai cache", montant: 100, recuLe: new Date("2026-09-29T10:00:00Z"), statut: "VALIDE" } });
    memoire.viderCacheAnalytique();
    const depuisInstantane = await cache.ecranAnalytique("argent", p, {}, MERCREDI);
    assert.equal(valeur(depuisInstantane, "encaisse"), 600, "l'instantané de moins d'une heure sert");
    const recalcule = await cache.ecranAnalytique("argent", p, { recalculer: true }, MERCREDI);
    assert.equal(valeur(recalcule, "encaisse"), 700);
    // Un filtre par source ou des dates libres ne passent pas par l'instantané.
    const libre = await cache.ecranAnalytique("ensemble", periodes.resoudrePeriode({ du: "2026-09-20", au: "2026-09-30" }, MERCREDI), {}, MERCREDI);
    assert.equal(libre.periode.cle, "libre");
    assert.equal(await prisma.instantaneAnalytique.count({ where: { cle: { startsWith: "ensemble:libre" } } }), 0);
  });
  test("pré-calcul : pas avant 7 h ; à 10 h, cinq onglets × cinq périodes et le résumé du jour, une seule fois", async () => {
    const tot = new Date("2026-09-30T04:30:00Z"); // 6 h 30 à Paris
    assert.equal(await cache.precalculDu(tot), false);
    assert.equal(await cache.precalculDu(MERCREDI), true);
    await cache.executerPrecalcul(MERCREDI);
    assert.equal(await prisma.instantaneAnalytique.count({ where: { cle: { endsWith: ":2026-09-30" }, NOT: [{ cle: { startsWith: "resume:" } }, { cle: { startsWith: "precalcul:" } }] } }), 25);
    assert.ok(await prisma.instantaneAnalytique.findUnique({ where: { cle: "resume:2026-09-30" } }));
    assert.equal(await cache.precalculDu(MERCREDI), false);
    const { travauxPeriodiques } = await import("@/lib/taches/registre");
    cache.enregistrerTachesAnalytiqueCalculs();
    assert.ok(travauxPeriodiques().some((t) => t.nom === cache.TRAVAIL_PRECALCUL));
  });
  test("le résumé du jour : trois phrases par règles, enregistré, repris par la Vue d'ensemble", async () => {
    const { resumeEnregistre } = await import("./resume");
    const r = await resumeEnregistre(MERCREDI);
    assert.equal(r.redaction, "REGLES");
    assert.deepEqual(r.phrases.map((p) => p.genre), ["MONTE", "BAISSE", "A_FAIRE"]);
    assert.match(r.phrases[0].texte, /Jour 9 sur 21 de la campagne\./);
    assert.equal(r.phrases[2].texte, "Relance le devis en attente : 900 € en jeu (CRM).");
    memoire.viderCacheAnalytique();
    const e = await ecrans.ecranEnsemble(trente(), {}, MERCREDI);
    assert.deepEqual(e.resume, r);
    assert.deepEqual(reseau, []);
  });
});
