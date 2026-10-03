import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { preparerBaseEssai } from "@/test/base-essai";

preparerBaseEssai();
process.env.TACHES_DESACTIVEES = "1";

/**
 * Mission 17 (partie B) — la RELECTURE B des calculs et de la partie serveur de l'écran : chaque défaut confirmé a son
 * essai ici (règles pures d'abord, puis sur la base d'essai de src/test/analytique-essai.ts enrichie). Instants fixes
 * (MERCREDI 30/09/2026 10 h à Paris), aucun réseau, noms fictifs.
 */

let prisma: typeof import("@/lib/prisma").default;
let calculs: typeof import("./calculs");
let periodes: typeof import("./periode");
let ecrans: typeof import("./ecrans");
let memoire: typeof import("./memoire");
let essai: typeof import("@/test/analytique-essai");
let MERCREDI: Date;
const reseau: string[] = [];
const fetchOrigine = globalThis.fetch;
const trente = () => periodes.resoudrePeriode({ p: "30j" }, MERCREDI);
const valeur = (e: { indicateurs: { cle: string; valeur: number | null }[] }, cle: string) => e.indicateurs.find((i) => i.cle === cle)?.valeur;
const le = (iso: string) => new Date(iso);

before(async () => {
  globalThis.fetch = (async (entree: string | URL | Request) => {
    reseau.push(String(entree instanceof Request ? entree.url : entree));
    throw new Error("Aucune requête réseau dans les essais");
  }) as typeof fetch;
  prisma = (await import("@/lib/prisma")).default;
  calculs = await import("./calculs");
  periodes = await import("./periode");
  ecrans = await import("./ecrans");
  memoire = await import("./memoire");
  essai = await import("@/test/analytique-essai");
  MERCREDI = essai.MERCREDI;
  await essai.peuplerAnalytique(prisma);
});

after(async () => {
  essai.debrancherMeta();
  globalThis.fetch = fetchOrigine;
  await prisma.$disconnect();
});

/* ── Règles pures ─────────────────────────────────────────────────────── */

describe("règles pures de la relecture", () => {
  test("point 1 : signé daté au premier passage vers une étape signée (Signé sauté), sinon devis accepté, sinon arrivée", () => {
    const creeLe = le("2026-09-01T08:00:00Z");
    assert.equal(calculs.instantDeSignature({ creeLe, accords: [], passages: [{ vers: "DEVIS_ENVOYE", le: le("2026-09-10T08:00:00Z") }, { vers: "PLANIFIE", le: le("2026-09-12T08:00:00Z") }], devisAcceptes: [] }).toISOString(), "2026-09-12T08:00:00.000Z");
    assert.equal(calculs.instantDeSignature({ creeLe, accords: [le("2026-09-14T08:00:00Z")], passages: [{ vers: "SIGNE", le: le("2026-09-13T08:00:00Z") }], devisAcceptes: [] }).toISOString(), "2026-09-13T08:00:00.000Z", "le plus ancien des deux");
    assert.equal(calculs.instantDeSignature({ creeLe, accords: [], passages: [], devisAcceptes: [le("2026-09-20T08:00:00Z")] }).toISOString(), "2026-09-20T08:00:00.000Z");
    assert.equal(calculs.instantDeSignature({ creeLe, accords: [], passages: [], devisAcceptes: [] }), creeLe, "jamais écarté");
  });

  test("point 2 : formulaire sans identifiant rattaché par son nom ; nom ambigu non résolu ; coût par lead seulement à dépense positive", async () => {
    const { resoudreParNom } = await import("./ecrans/publicite");
    const { meilleurCoutParLead, verdictDe } = await import("./verdicts");
    const { alertesCoutParLead } = await import("./alertes");
    const connues = [
      { publiciteId: "A1", publiciteNom: "Carrousel", ensembleId: "S1", ensembleNom: "Montpellier", campagneId: "C1", campagneNom: "Cuisine" },
      { publiciteId: "A2", publiciteNom: "Vidéo", ensembleId: "S1", ensembleNom: "Montpellier", campagneId: "C1", campagneNom: "Cuisine" },
      { publiciteId: "A3", publiciteNom: "Vidéo", ensembleId: "S2", ensembleNom: "Nîmes", campagneId: "C1", campagneNom: "Cuisine" },
    ];
    const f = (adNom: string) => ({ leadId: "l", soumisLe: MERCREDI, adId: null, adNom, adsetId: null, adsetNom: "Montpellier", campagneId: null, campagneNom: "Cuisine" });
    const [carrousel, video] = resoudreParNom([f("Carrousel"), f("Vidéo")], connues);
    assert.deepEqual([carrousel.adId, carrousel.adsetId, carrousel.campagneId], ["A1", "S1", "C1"]);
    assert.equal(video.adId, null, "« Vidéo » porte deux identifiants : pas de rattachement au hasard");
    assert.equal(meilleurCoutParLead([{ depense: 0, leads: 3 }, { depense: 60, leads: 6 }]), 10, "une ligne à 0 € n'est pas la meilleure");
    assert.equal(verdictDe({ id: "x", depense: 0, leads: 3, devis: 0, signes: 0 }, 10, 10).verdict, "SURVEILLER");
    const a = alertesCoutParLead([{ id: "z", nom: "Sans dépense", depense: 0, leads: 6 }, { id: "b", nom: "Bonne", depense: 60, leads: 6 }, { id: "c", nom: "Chère", depense: 150, leads: 5 }]);
    assert.deepEqual(a.map((x) => x.cle), ["PUBLICITE_CPL:c"]);
  });

  test("point 3 : dépense pub jour par jour — synchronisée où Meta couvre, prorata ailleurs, jamais additionnées ; inconnu → null", () => {
    const jours = ["2026-09-20", "2026-09-21", "2026-09-22", "2026-09-23", "2026-09-24"];
    const base = { jours, couverture: { du: "2026-09-23", au: "2026-09-24" }, synchro: { "2026-09-23": 10, "2026-09-24": 12.5 }, prorata: { "2026-09-22": 18, "2026-09-23": 18, "2026-09-24": 18 }, campagneConnue: true, saisies: { "2026-09-20": 80, "2026-09-23": 300 } };
    const d = calculs.combinerDepensePub(base);
    assert.deepEqual([d.total, d.origine, d.estimation, d.joursInconnus], [40.5, "MIXTE", true, 0]);
    assert.deepEqual(d.origineParJour, { "2026-09-20": "HORS_CAMPAGNE", "2026-09-21": "HORS_CAMPAGNE", "2026-09-22": "PRORATA", "2026-09-23": "SYNCHRO", "2026-09-24": "SYNCHRO" });
    // Ni campagne ni synchronisation : les saisies (0 les autres jours) ; rien du tout : inconnu.
    const saisies = calculs.combinerDepensePub({ ...base, couverture: null, campagneConnue: false, prorata: {} });
    assert.deepEqual([saisies.total, saisies.origine], [380, "SAISIE"]);
    const rien = calculs.combinerDepensePub({ ...base, couverture: null, campagneConnue: false, prorata: {}, saisies: {} });
    assert.deepEqual([rien.total, rien.origine, rien.joursInconnus], [null, "INCONNUE", 5]);
    // Synchronisation seule sur deux jours, rien ailleurs : partiel, dit tel quel.
    const partiel = calculs.combinerDepensePub({ ...base, campagneConnue: false, prorata: {}, saisies: {} });
    assert.deepEqual([partiel.total, partiel.joursInconnus, partiel.synchroniseJusquau], [22.5, 3, "2026-09-24"]);
    assert.equal(calculs.detailDepensePub(partiel, { etat: "EN_ECHEC", derniereReussite: "2026-09-24T05:00:00.000Z" }), "réel Meta, synchronisé le 24/09, 3 jours sans chiffre");
  });

  test("point 4 : SEO et fiche comparées jusqu'au dernier jour livré ; jour entamé exclu des comparaisons", async () => {
    const { periodesAlignees } = await import("./ecrans/seo");
    const { jourEntame } = await import("./ecrans/commun");
    const p = { du: "2026-09-01", au: "2026-09-30", precedente: { du: "2026-08-02", au: "2026-08-31" } };
    assert.deepEqual(periodesAlignees(p, "2026-09-27"), { actuel: { du: "2026-09-01", au: "2026-09-27" }, avant: { du: "2026-08-02", au: "2026-08-28" }, jusquau: "2026-09-27" }, "27 jours contre 27 jours");
    assert.deepEqual(periodesAlignees(p, "2026-09-30").jusquau, null);
    assert.deepEqual(jourEntame(p, "2026-09-30"), { actuel: { du: "2026-09-01", au: "2026-09-29" }, avant: { du: "2026-08-02", au: "2026-08-30" } });
    assert.equal(jourEntame(p, "2026-10-05"), null, "période passée : rien à retirer");
  });

  test("point 10 : leads archivés « Test » ou « essai » écartés (mot entier, sans accents), la corbeille ordinaire comptée", () => {
    const archive = (archiveMotif: string) => ({ archiveLe: MERCREDI, archiveMotif });
    assert.equal(calculs.estLeadEcarte(archive("Test")), true);
    assert.equal(calculs.estLeadEcarte(archive("Contact d'essai Zapier")), true);
    assert.equal(calculs.estLeadEcarte(archive("Essais de l'intégration Meta")), true);
    assert.equal(calculs.estLeadEcarte(archive("Doublon de Essai : fusionné")), true);
    assert.equal(calculs.estLeadEcarte(archive("Corbeille — pas intéressé")), false);
    assert.equal(calculs.estLeadEcarte(archive("Attestation manquante")), false, "« test » dans un mot ne compte pas");
    assert.equal(calculs.estLeadEcarte({ archiveLe: null, archiveMotif: "Test" }), false, "un lead vivant n'est pas écarté sur son motif");
  });

  test("point 14 : une période libre ne dépasse pas trois ans", () => {
    const p = periodes.resoudrePeriode({ du: "2010-01-01", au: "2026-09-30" }, MERCREDI);
    assert.equal(p.jours, periodes.JOURS_LIBRES_MAX);
    assert.equal(p.au, "2026-09-30");
  });

  test("écran, point 5 : le coût par lead Meta en cumul, jour après jour (sparkline)", async () => {
    const { serieCoutParLead } = await import("./ecrans/ensemble");
    const depense = calculs.combinerDepensePub({ jours: ["a", "b", "c"], couverture: { du: "a", au: "c" }, synchro: { a: 10, b: 10, c: 10 }, prorata: {}, campagneConnue: false, saisies: {} });
    assert.deepEqual(serieCoutParLead(["a", "b", "c"], depense, [{ jour: "b" }, { jour: "c" }]), [20, 20, 15], "avant le premier lead : la première valeur connue");
  });
});

/* ── Sur la base d'essai ──────────────────────────────────────────────── */

describe("définitions sur la base d'essai", () => {
  test("point 1 : un dossier qui saute Signé, un dossier à Chantier sans trace, un dossier à Encaissé sans rien : tous signés, datés", async () => {
    const dossier = (data: Record<string, unknown>) => prisma.dossier.create({ data: { clientNom: "Essai Relecture", clientAdresse: "1 rue", clientCp: "34000", clientVille: "Montpellier", clientTelephone: "0600000001", objet: "Cuisine", source: "ENTRANT", ...data } as never });
    const e = await dossier({ etape: "PLANIFIE" });
    await prisma.dossierEvenement.create({ data: { dossierId: e.id, type: "CHANGEMENT_ETAPE", direction: "INTERNE", contenu: "Planifié", metadata: JSON.stringify({ de: "DEVIS_ENVOYE", vers: "PLANIFIE", nature: "SAUT" }), survenuLe: le("2026-09-26T10:00:00Z") } });
    const f = await dossier({ etape: "CHANTIER" });
    await prisma.document.create({ data: { dossierId: f.id, type: "DEVIS", numero: "2026-951", dateEmission: le("2026-09-02T10:00:00Z"), objet: "Cuisine", lignes: "[]", totalHt: 1800, statut: "ACCEPTE", origine: "REPRISE" } });
    const g = await dossier({ etape: "ENCAISSE", createdAt: le("2026-09-15T10:00:00Z") });
    const toutes = await calculs.toutesLesSignatures();
    const de = (id: string) => toutes.find((s) => s.dossierId === id);
    assert.equal(de(e.id)?.jour, "2026-09-26", "Signé sauté : daté au passage à Planifié");
    assert.ok(de(f.id), "à Chantier sans passage : compté (devis accepté)");
    assert.equal(de(f.id)?.montant, 1800);
    assert.equal(de(g.id)?.jour, "2026-09-15", "à Encaissé sans rien : daté de son arrivée");
    await prisma.dossier.update({ where: { id: e.id }, data: { archiveLe: MERCREDI, archiveMotif: "essai terminé" } });
    await prisma.dossier.update({ where: { id: f.id }, data: { archiveLe: MERCREDI, archiveMotif: "essai terminé" } });
    await prisma.dossier.update({ where: { id: g.id }, data: { archiveLe: MERCREDI, archiveMotif: "essai terminé" } });
  });

  test("point 9 et 10 : famille du parcours = première famille non directe (comme l'entonnoir) ; leads de test écartés", async () => {
    const parcoursId = "cafe0000-0000-4000-8000-000000000009";
    await prisma.evenementSite.create({ data: { parcoursId, type: "PIECE_CHOISIE", page: "/simulateur", famille: "direct", createdAt: le("2026-09-26T08:00:00Z") } });
    await prisma.evenementSite.create({ data: { parcoursId, type: "PHOTO_CHARGEE", page: "/simulateur", source: "meta/paid", famille: "meta", createdAt: le("2026-09-26T08:05:00Z") } });
    const carte = await calculs.sourcesDesParcours([parcoursId]);
    assert.equal(carte.get(parcoursId)?.famille, "meta");
    const { familleDesParcours } = await import("@/lib/site/familles-source");
    const evenements = await prisma.evenementSite.findMany({ where: { parcoursId }, orderBy: { createdAt: "asc" } });
    assert.equal(familleDesParcours(evenements).get(parcoursId)?.famille, "meta", "même règle que l'entonnoir du site");
    const lead = await prisma.lead.create({ data: { nom: "Parcours", prenom: "Essai", telephone: "0611111111", ville: "Montpellier", source: "SITE_SIMULATEUR", parcoursId, createdAt: le("2026-09-26T09:00:00Z") } as never });
    const test = await prisma.lead.create({ data: { nom: "Zapier", prenom: "Test", telephone: "0622222222", ville: "Montpellier", source: "AUTRE", createdAt: le("2026-09-26T09:00:00Z"), archiveLe: le("2026-09-26T10:00:00Z"), archiveMotif: "Test" } as never });
    const leads = await calculs.leadsDeLaPeriode(trente());
    assert.equal(leads.find((l) => l.id === lead.id)?.famille, "meta");
    assert.equal(leads.some((l) => l.id === test.id), false, "archivé « Test » : pas un lead");
    await prisma.lead.update({ where: { id: lead.id }, data: { archiveLe: MERCREDI, archiveMotif: "Test (relecture)" } });
  });

  test("point 5 : une seule définition — le coût par lead Meta de la Vue d'ensemble, de l'onglet Publicité et de manager_marketing", async () => {
    memoire.viderCacheAnalytique();
    const ensemble = await ecrans.ecranEnsemble(trente(), {}, MERCREDI);
    const pub = await ecrans.ecranPublicite(trente(), {}, MERCREDI);
    assert.equal(valeur(ensemble, "coutParLeadMeta"), 50.5);
    assert.equal(valeur(pub, "coutParLead"), valeur(ensemble, "coutParLeadMeta"));
    assert.equal(valeur(pub, "coutParSigne"), 151.5);
    assert.match(ensemble.indicateurs.find((i) => i.cle === "coutParLeadMeta")?.detail ?? "", /^Coût par chantier signé : 151,5 €/);
    const { analyseMarketing } = await import("@/lib/assistant/analyses/marketing");
    const m = await analyseMarketing({ du: "2026-09-01", au: "2026-09-30" } as never, MERCREDI);
    assert.deepEqual([m.global.meta.leads, m.global.meta.coutParLead, m.global.meta.coutParChantier], [3, 50.5, 151.5]);
  });

  test("point 6 : le résumé nomme sa période ; recomposé pour une autre période que les 30 jours du matin", async () => {
    const sept = await ecrans.ecranEnsemble(periodes.resoudrePeriode({ p: "7j" }, MERCREDI), {}, MERCREDI);
    assert.equal(sept.resume?.periode, "les 7 derniers jours");
    assert.ok(sept.resume?.phrases.slice(0, 2).every((p) => /^(Sur les 7 derniers jours, |L'étape)/.test(p.texte)), JSON.stringify(sept.resume?.phrases));
    const trenteJours = await ecrans.ecranEnsemble(trente(), {}, MERCREDI);
    assert.equal(trenteJours.resume?.periode, "les 30 derniers jours");
  });

  test("point 13 : la synthèse du site lit des jours de Paris", async () => {
    const { syntheseSite } = await import("@/lib/site/evenements");
    const avant = (await syntheseSite("2026-09-01", "2026-09-30")).parType.find((t) => t.cle === "WHATSAPP_CLIQUE")?.valeur ?? 0;
    await prisma.evenementSite.create({ data: { parcoursId: "bord-1", type: "WHATSAPP_CLIQUE", createdAt: le("2026-08-31T21:30:00Z") } }); // 31/08 23 h 30 à Paris : dehors
    await prisma.evenementSite.create({ data: { parcoursId: "bord-2", type: "WHATSAPP_CLIQUE", createdAt: le("2026-08-31T22:30:00Z") } }); // 01/09 0 h 30 : dedans
    await prisma.evenementSite.create({ data: { parcoursId: "bord-3", type: "WHATSAPP_CLIQUE", createdAt: le("2026-09-30T22:30:00Z") } }); // 01/10 0 h 30 : dehors
    const apres = (await syntheseSite("2026-09-01", "2026-09-30")).parType.find((t) => t.cle === "WHATSAPP_CLIQUE")?.valeur ?? 0;
    assert.equal(apres - avant, 1);
  });

  test("point 14 : le nombre d'avis et la note, chacun à son dernier jour ; fiche comparée jusqu'au dernier jour livré", async () => {
    await prisma.ficheGoogleJour.create({ data: { jour: "2026-09-27", metrique: "BUSINESS_IMPRESSIONS_MOBILE_SEARCH", valeur: 40, synchroniseLe: MERCREDI } });
    await prisma.ficheGoogleJour.create({ data: { jour: "2026-08-10", metrique: "BUSINESS_IMPRESSIONS_MOBILE_SEARCH", valeur: 10, synchroniseLe: MERCREDI } });
    await prisma.ficheGoogleJour.create({ data: { jour: "2026-09-20", metrique: "AVIS_NOTE", valeur: 4.8, synchroniseLe: MERCREDI } });
    await prisma.ficheGoogleJour.create({ data: { jour: "2026-09-29", metrique: "AVIS_NOMBRE", valeur: 12, synchroniseLe: MERCREDI } });
    const { chiffresFiche } = await import("./ecrans/seo");
    const f = await chiffresFiche(trente());
    assert.deepEqual(f.actuel.avis, { nombre: 12, note: 4.8 });
    assert.equal(f.jusquau, "2026-09-27");
    assert.deepEqual([f.actuel.vues, f.avant.vues], [40, 10]);
    const { construireEcranSeo } = await import("./ecrans/seo");
    const etats = [{ source: "FICHE_GOOGLE" as const, branchee: true, etat: "A_JOUR" as const, derniereReussite: MERCREDI.toISOString(), erreur: null, aFaire: null }];
    const e = await construireEcranSeo(trente(), { etats });
    assert.equal(e.fiche?.indicateurs[0].valeur, 40);
    assert.match(e.fiche?.indicateurs[0].detail ?? "", /données jusqu'au 27\/09/);
    assert.equal(e.donneesJusquau?.fiche, "2026-09-27");
    const sansFiche = await construireEcranSeo(trente(), { etats: [] });
    assert.equal(sansFiche.fiche, null, "non branchée : null");
  });

  test("point 2 (base) : un formulaire Meta sans identifiant rejoint la ligne de sa publicité, à dépense réelle", async () => {
    await essai.brancherMeta(prisma);
    const lead = await prisma.lead.create({ data: { nom: "Nom", prenom: "Seul", telephone: "0633333333", ville: "Montpellier", source: "META_ADS", createdAt: le("2026-09-27T10:00:00Z") } as never });
    await prisma.metaLead.create({ data: { leadgenId: "9100", leadId: lead.id, adId: null, adNom: "Carrousel", adsetNom: "Montpellier 30 km", campagneNom: "Cuisine septembre", soumisLe: le("2026-09-27T10:00:00Z"), statut: "TRAITE" } });
    const e = await ecrans.ecranPublicite(trente(), {}, MERCREDI);
    const pubs = e.lignes.filter((l) => l.niveau === "PUBLICITE");
    assert.deepEqual(pubs.map((l) => l.id).sort(), ["A1", "A2"], "aucune ligne « Carrousel » par nom à côté de A1");
    assert.equal(pubs.find((l) => l.id === "A1")?.leadsCrm, 3);
    essai.debrancherMeta();
    await prisma.lead.update({ where: { id: lead.id }, data: { archiveLe: MERCREDI, archiveMotif: "Test (relecture)" } });
    await prisma.sourceAnalytique.update({ where: { source: "META" }, data: { derniereReussiteLe: null, detail: "{}" } });
    memoire.viderCacheAnalytique();
  });
});

describe("partie serveur de l'écran", () => {
  test("point 3 : toute écriture qui change les chiffres périme le cache (version en mémoire), sans rien vider à la main", async () => {
    const v = memoire.versionAnalytique();
    await prisma.depense.create({ data: { payeeLe: le("2026-09-29T10:00:00Z"), montant: 20, fournisseur: "Essai version", categorie: "FOURNITURES", horsChantier: true } });
    assert.ok(memoire.versionAnalytique() > v);
    const v2 = memoire.versionAnalytique();
    await prisma.evenementSite.create({ data: { parcoursId: "version", type: "PAGE_VUE" } });
    assert.equal(memoire.versionAnalytique(), v2, "une page vue ne périme rien (cache d'une minute)");
    assert.equal(memoire.DUREE_CACHE_MS, 60_000);
  });

  test("points 7 et 8 : Argent — seuils avec projection, URSSAF à déclarer avec échéance et détail, dépenses par catégorie, clients par source", async () => {
    const param = (cle: string, valeur: unknown) => prisma.parametre.create({ data: { cle, valeur: JSON.stringify(valeur), valableDu: le("2026-01-01T00:00:00Z"), source: "essai" } });
    const avant = await ecrans.ecranArgent(trente(), {}, MERCREDI);
    assert.ok(avant.fiscal?.parametresManquants.includes("PERIODICITE_DECLARATION"));
    for (const [cle, v] of [["PERIODICITE_DECLARATION", "MENSUELLE"], ["TAUX_COTISATIONS_SOCIALES", 21.2], ["TAUX_CFP", 0.3], ["VERSEMENT_LIBERATOIRE", "OUI"], ["TAUX_VERSEMENT_LIBERATOIRE", 1.7], ["SEUIL_FRANCHISE_TVA", 37500], ["SEUIL_FRANCHISE_TVA_MAJORE", 41250], ["PLAFOND_MICRO_ENTREPRISE", 83600]] as const) await param(cle, v);
    const e = await ecrans.ecranArgent(trente(), {}, MERCREDI);
    assert.deepEqual(e.fiscal?.parametresManquants, []);
    assert.deepEqual(e.fiscal?.seuils.map((s) => s.cle), ["SEUIL_FRANCHISE_TVA", "SEUIL_FRANCHISE_TVA_MAJORE", "PLAFOND_MICRO_ENTREPRISE"]);
    assert.ok(e.fiscal?.seuils.every((s) => s.projection !== null && s.atteint > 0), "projection au 31/12");
    const u = e.fiscal?.urssaf;
    assert.equal(u?.aDeclarer?.echeance, "2026-09-30", "août, à déclarer avant la fin de septembre");
    assert.deepEqual(u?.aDeclarer?.detail.map((d) => d.libelle), ["Cotisations sociales", "Formation professionnelle (CFP)", "Versement libératoire de l'impôt"]);
    assert.equal(u?.aDeclarer?.base, 3000);
    assert.ok(u?.enCours);
    assert.deepEqual(e.depensesParCategorie.slice(0, 2).map((d) => d.categorie), ["MATIERE", "PUBLICITE"]);
    assert.ok(e.clientsParSource.every((c) => typeof c.libelle === "string" && c.signes <= c.clients));
  });

  test("point 8 : l'onglet Site porte l'entonnoir du simulateur en sept étapes, toutes sources puis par famille", async () => {
    const e = await ecrans.ecranSite(trente(), {}, MERCREDI);
    assert.equal(e.simulateur[0].famille, "toutes");
    assert.deepEqual(e.simulateur[0].etapes.map((x) => x.cle), ["visite", "piece", "photo", "generation", "resultat", "estimation", "contact"]);
    assert.equal(e.simulateur[0].etapes.find((x) => x.cle === "estimation")?.facultative, true);
    assert.ok(e.simulateur.slice(1).every((f) => f.famille !== "toutes" && f.etapes.some((x) => x.parcours > 0)));
  });

  test("point 6 : AGENT_DEGRADE mène à /analytique#agent-qualite ; seuils → onglet Argent ; les routes /api/synthese marchent et restent protégées", async () => {
    const { calculerAlertes } = await import("@/lib/synthese/alertes");
    const proposition = (decideLe: Date, statut: string, n: number) => prisma.proposition.create({ data: { type: "RATTACHER_MAIL", statut, auteur: "AGENT:mail", titre: `Essai ${n}`, contenu: "{}", decideLe } });
    for (let n = 0; n < 6; n++) await proposition(new Date(MERCREDI.getTime() - (40 + n) * 86_400_000), "EXECUTEE", n);
    for (let n = 0; n < 6; n++) await proposition(new Date(MERCREDI.getTime() - (2 + n) * 86_400_000), "REJETEE", 10 + n);
    const alertes = await calculerAlertes(MERCREDI);
    assert.equal(alertes.find((a) => a.code === "AGENT_DEGRADE")?.lien, "/analytique#agent-qualite");
    for (const a of alertes.filter((x) => x.code.startsWith("SEUIL_") || x.code === "PARAMETRES_SEUILS")) assert.equal(a.lien, "/analytique?onglet=argent");

    const { estRoutePublique } = await import("@/lib/acces/routes-publiques");
    for (const chemin of ["/api/synthese", "/api/synthese/export", "/api/synthese/instantanes", "/api/synthese/instantanes/2026-08", "/api/analytique", "/api/analytique/synchro"]) assert.equal(estRoutePublique(chemin), false, `${chemin} exige une session`);
    const { NextRequest } = await import("next/server");
    const synthese = await (await import("@/app/api/synthese/route")).GET(new NextRequest("http://localhost/api/synthese?du=2026-09-01&au=2026-09-30"));
    assert.equal(synthese.status, 200);
    const lu = (await synthese.json()) as { synthese?: unknown; alertes?: unknown };
    assert.ok(lu.synthese && lu.alertes);
    const texte = await (await import("@/app/api/synthese/export/route")).GET(new NextRequest("http://localhost/api/synthese/export?du=2026-09-01&au=2026-09-30&format=texte&anonyme=1"));
    assert.equal(texte.status, 200);
    assert.match(texte.headers.get("content-disposition") ?? "", /synthese-2026-09-01-2026-09-30-anonyme\.txt/);
    const mois = await (await import("@/app/api/synthese/instantanes/route")).GET();
    assert.equal(mois.status, 200);
  });

  test("point 9 et liens restants : notification d'un lead Meta illisible, dépense rattachée", () => {
    const racine = path.resolve(__dirname, "..", "..", "..");
    const leads = readFileSync(path.join(racine, "src/lib/meta/leads.ts"), "utf8");
    assert.match(leads, /\/analytique\?onglet=publicite#chaine-meta`,\n\s+libelleLien: "Voir la chaîne des leads Meta"/);
    assert.doesNotMatch(leads, /\/publicite`/);
    // Mission 17 (partie C) : l'ex-« rattacher_depense » est « creer » DEPENSE (entites/argent.ts).
    // Mission 18 (A3) : la liste des dépenses est une section de Finances (ADRESSE_DEPENSES = /finances?section=depenses).
    const ecriture = readFileSync(path.join(racine, "src/lib/assistant/entites/argent.ts"), "utf8");
    assert.match(ecriture, /rattachée au chantier[\s\S]{0,500}lien\("Dépenses", ADRESSE_DEPENSES\)/);
    assert.deepEqual(reseau, []);
  });
});
