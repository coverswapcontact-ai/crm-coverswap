import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { preparerBaseEssai } from "@/test/base-essai";

preparerBaseEssai();

/**
 * Mission 17 (partie B) — les calculs purs de l'Analytique : période (jours de Paris, précédente de même longueur),
 * comparaison et ton FAVORABLE (un coût qui baisse est vert), tunnel et l'étape qui perd le plus, verdicts du
 * protocole, règle des 20 %, prorata du budget (jour en cours au prorata des heures), lead appelé / joint, résumé du
 * jour (trois phrases, aucun chiffre inventé), alertes, cache mémoire. Instants fixes, aucune base, aucun réseau.
 */

/** Mercredi 30/09/2026, 10 h à Paris (heure d'été). */
const MERCREDI = new Date("2026-09-30T08:00:00.000Z");

describe("période : jours de Paris, précédente de même longueur", async () => {
  const { resoudrePeriode, bornes, joursDe, periodePrecedente } = await import("./periode");
  test("7j, 30j, 90j, mois en cours, 12m ; défaut 30 jours ; valeur inconnue → 30 jours", () => {
    assert.deepEqual(resoudrePeriode({ p: "7j" }, MERCREDI), { cle: "7j", du: "2026-09-24", au: "2026-09-30", jours: 7, libelle: "les 7 derniers jours", precedente: { du: "2026-09-17", au: "2026-09-23" } });
    const trente = resoudrePeriode({}, MERCREDI);
    assert.deepEqual([trente.cle, trente.du, trente.au, trente.jours, trente.precedente.du, trente.precedente.au], ["30j", "2026-09-01", "2026-09-30", 30, "2026-08-02", "2026-08-31"]);
    assert.equal(resoudrePeriode({ p: "n'importe" }, MERCREDI).cle, "30j");
    assert.deepEqual([resoudrePeriode({ p: "90j" }, MERCREDI).du, resoudrePeriode({ p: "90j" }, MERCREDI).jours], ["2026-07-03", 90]);
    const mois = resoudrePeriode({ p: "mois" }, MERCREDI);
    assert.deepEqual([mois.du, mois.au, mois.jours, mois.precedente.du, mois.precedente.au], ["2026-09-01", "2026-09-30", 30, "2026-08-02", "2026-08-31"]);
    const an = resoudrePeriode({ p: "12m" }, MERCREDI);
    assert.deepEqual([an.du, an.jours, an.precedente.au], ["2025-10-01", 365, "2025-09-30"]);
  });
  test("dates libres : remises dans l'ordre, ramenées à aujourd'hui, invalides → 30 jours", () => {
    const libre = resoudrePeriode({ du: "2026-09-15", au: "2026-09-01" }, MERCREDI);
    assert.deepEqual([libre.cle, libre.du, libre.au, libre.jours, libre.precedente.du, libre.precedente.au], ["libre", "2026-09-01", "2026-09-15", 15, "2026-08-17", "2026-08-31"]);
    assert.equal(resoudrePeriode({ du: "2026-09-20", au: "2026-12-31" }, MERCREDI).au, "2026-09-30");
    assert.equal(resoudrePeriode({ du: "2026-02-31", au: "2026-03-10" }, MERCREDI).cle, "30j");
  });
  test("bornes à minuit heure de Paris (été comme hiver) ; jours listés", () => {
    const b = bornes({ du: "2026-09-01", au: "2026-09-30" });
    assert.equal(b.debut.toISOString(), "2026-08-31T22:00:00.000Z");
    assert.equal(b.fin.toISOString(), "2026-09-30T22:00:00.000Z");
    const hiver = bornes({ du: "2026-12-01", au: "2026-12-01" });
    assert.deepEqual([hiver.debut.toISOString(), hiver.fin.toISOString()], ["2026-11-30T23:00:00.000Z", "2026-12-01T23:00:00.000Z"]);
    // Passage à l'heure d'hiver (25/10) : le jour dure 25 heures.
    const bascule = bornes({ du: "2026-10-25", au: "2026-10-25" });
    assert.equal(bascule.fin.getTime() - bascule.debut.getTime(), 25 * 3_600_000);
    assert.deepEqual(joursDe({ du: "2026-09-29", au: "2026-10-02" }), ["2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02"]);
    assert.deepEqual(periodePrecedente(resoudrePeriode({ p: "7j" }, MERCREDI)).au, "2026-09-23");
  });
});

describe("comparaison à la période précédente : le ton suit le sens FAVORABLE", async () => {
  const { evolutionDe, indicateur } = await import("./ecrans/commun");
  test("un coût qui baisse est favorable (vert), des leads qui baissent défavorables (ambre)", () => {
    assert.deepEqual(evolutionDe(40, 50, "baisse"), { precedente: 50, variation: -0.2, sens: "baisse", ton: "favorable" });
    assert.deepEqual(evolutionDe(60, 50, "baisse"), { precedente: 50, variation: 0.2, sens: "hausse", ton: "defavorable" });
    assert.deepEqual(evolutionDe(8, 10, "hausse"), { precedente: 10, variation: -0.2, sens: "baisse", ton: "defavorable" });
    assert.deepEqual(evolutionDe(12, 10, "hausse"), { precedente: 10, variation: 0.2, sens: "hausse", ton: "favorable" });
  });
  test("stable sous 5 %, « nouveau » sans base, neutre sans valeur", () => {
    assert.equal(evolutionDe(102, 100, "hausse").sens, "stable");
    assert.equal(evolutionDe(102, 100, "hausse").ton, "neutre");
    assert.deepEqual(evolutionDe(5, 0, "hausse"), { precedente: 0, variation: null, sens: "nouveau", ton: "favorable" });
    assert.deepEqual(evolutionDe(null, 10, "hausse"), { precedente: 10, variation: null, sens: null, ton: "neutre" });
  });
  test("une source non branchée : valeur null, pas de série (jamais un zéro trompeur)", () => {
    const i = indicateur({ cle: "clics", libelle: "Clics", valeur: null, precedente: null, format: "nombre", favorable: "hausse", serie: [0, 0, 0], source: "SEARCH_CONSOLE" });
    assert.deepEqual([i.valeur, i.serie, i.evolution.ton], [null, [], "neutre"]);
  });
});

describe("tunnel : taux de passage et l'étape qui perd le plus", async () => {
  const { tunnelDe } = await import("./ecrans/tunnel");
  test("le plus faible taux parmi lead → appel, appel → joint, joint → devis (la signature exclue)", () => {
    const t = tunnelDe(
      [
        { cle: "visites", libelle: "Visites", valeur: null, source: "SITE" },
        { cle: "simulations", libelle: "Simulations", valeur: 30, source: "SITE" },
        { cle: "leads", libelle: "Leads", valeur: 45, source: "CRM" },
        { cle: "appeles", libelle: "Appelés", valeur: 27, source: "CRM" },
        { cle: "joints", libelle: "Joints", valeur: 17, source: "CRM" },
        { cle: "devis", libelle: "Devis", valeur: 4, source: "CRM" },
        { cle: "signes", libelle: "Signés", valeur: 0, source: "CRM" },
      ],
      ["appeles", "joints", "devis"],
    );
    assert.deepEqual(t.etapes.map((e) => e.tauxPassage), [null, null, null, 0.6, 0.63, 0.235, 0]);
    assert.deepEqual(t.perteMax, { de: "joints", vers: "devis", libelle: "joint → devis", perdus: 13 });
  });
});

describe("verdicts du protocole de campagne", async () => {
  const { verdictDe, verdictsDesPublicites, tranchesDuProtocole, meilleurCoutParLead, TRANCHES_DEFAUT } = await import("./verdicts");
  const { CONSIGNES_DEFAUT, sectionProtocole } = await import("@/lib/assistant/consignes");
  const pubs = [
    { id: "a", depense: 60, leads: 6, devis: 1, signes: 0 }, // 10 € le lead : la meilleure
    { id: "b", depense: 150, leads: 6, devis: 0, signes: 0 }, // 25 € : > 2 × sur 6 leads → couper
    { id: "c", depense: 75, leads: 3, devis: 0, signes: 0 }, // 25 € : > 2 × sur 3 leads → surveiller
    { id: "d", depense: 90, leads: 5, devis: 1, signes: 0 }, // 18 € : dans les 2 × → garder
  ];
  test("les tranches lues dans le protocole des consignes par défaut", () => {
    assert.deepEqual(tranchesDuProtocole(sectionProtocole(CONSIGNES_DEFAUT)), TRANCHES_DEFAUT);
    assert.deepEqual(tranchesDuProtocole("## Protocole\n- Jours 1 à 2 : apprentissage, on ne touche à rien.\n- Jours 3 à 9 : on coupe une publicité si son coût par lead dépasse le double de la meilleure.").coupe, [3, 9]);
  });
  test("jours 1 à 7 : trop tôt, puis garder", () => {
    assert.equal(verdictDe(pubs[1], 2, 10).verdict, "ATTENDRE");
    assert.equal(verdictDe(pubs[1], 6, 10).verdict, "GARDER");
    assert.equal(verdictDe(pubs[1], null, 10).verdict, null);
  });
  test("jours 8 à 14 : couper au-delà de 2 × la meilleure sur 5 leads, surveiller en dessous de 5 leads", () => {
    assert.equal(meilleurCoutParLead(pubs), 10);
    const v = verdictsDesPublicites(pubs, 9);
    assert.deepEqual(["a", "b", "c", "d"].map((id) => v.get(id)?.verdict), ["GARDER", "COUPER", "SURVEILLER", "GARDER"]);
    assert.match(v.get("b")!.raison, /25 €, plus de 2 × la meilleure \(10 €\), sur 6 leads/);
    assert.equal(verdictDe({ id: "e", depense: 30, leads: 0, devis: 0, signes: 0 }, 9, 10).verdict, "SURVEILLER");
  });
  test("jours 15 et suivants : au coût par chantier signé (300 €), sinon par devis", () => {
    assert.equal(verdictDe({ id: "x", depense: 500, leads: 20, devis: 3, signes: 2 }, 16, 10).verdict, "GARDER");
    assert.equal(verdictDe({ id: "x", depense: 700, leads: 20, devis: 3, signes: 2 }, 16, 10).verdict, "COUPER");
    assert.equal(verdictDe({ id: "x", depense: 250, leads: 20, devis: 1, signes: 0 }, 18, 10).verdict, "SURVEILLER");
    assert.equal(verdictDe({ id: "x", depense: 400, leads: 20, devis: 0, signes: 0 }, 20, 10).verdict, "COUPER");
  });
  test("sans dépense propre à la publicité (pas de synchronisation) : pas de verdict chiffré", () => {
    const v = verdictDe({ id: "x", depense: null, leads: 8, devis: 0, signes: 0 }, 9, null);
    assert.equal(v.verdict, null);
    assert.match(v.raison, /synchronisation Meta non branchée/);
  });
});

describe("règle des 20 %, prorata du budget, appelé / joint", async () => {
  const calculs = await import("./calculs");
  test("dépense pub du mois ≤ 20 % de l'encaissé du mois précédent", () => {
    const r = calculs.regle20([
      { mois: "2026-07", encaisse: 5000, depensePub: 0 },
      { mois: "2026-08", encaisse: 2000, depensePub: 800 },
      { mois: "2026-09", encaisse: 0, depensePub: 300 },
      { mois: "2026-10", encaisse: 0, depensePub: 50 },
    ]);
    assert.deepEqual(r, [
      { mois: "2026-08", encaissePrecedent: 5000, depensePub: 800, ratio: 0.16, plafond: 0.2, depasse: false },
      { mois: "2026-09", encaissePrecedent: 2000, depensePub: 300, ratio: 0.15, plafond: 0.2, depasse: false },
      { mois: "2026-10", encaissePrecedent: 0, depensePub: 50, ratio: null, plafond: 0.2, depasse: true },
    ]);
    assert.equal(calculs.regle20([{ mois: "2026-08", encaisse: 1000, depensePub: 0 }, { mois: "2026-09", encaisse: 0, depensePub: 250 }])[0].depasse, true);
  });
  test("prorata : budget / durée par jour de campagne, le jour en cours au prorata des heures (plus « entièrement dépensé »)", () => {
    const campagne = { debut: "2026-09-22", budget: 378, duree: 21 };
    const p = calculs.prorataDuBudget(campagne, { du: "2026-09-01", au: "2026-09-30" }, MERCREDI);
    assert.equal(Object.keys(p).length, 9);
    assert.equal(p["2026-09-22"], 18);
    assert.equal(p["2026-09-30"], 7.5); // 10 h à Paris : 10/24 de 18 €
    assert.equal(Object.values(p).reduce((t, v) => t + v, 0), 151.5);
    assert.deepEqual(calculs.prorataDuBudget(campagne, { du: "2026-08-01", au: "2026-08-31" }, MERCREDI), {});
    assert.equal(calculs.jourDeCampagne(campagne, MERCREDI), 9);
    // Heure d'hiver : plus de décalage +02:00 figé, le 26/10 à 0 h 30 est bien le jour 35.
    assert.equal(calculs.jourDeCampagne(campagne, new Date("2026-10-25T23:30:00Z")), 35);
  });
  test("lead joint : un appel ABOUTI ou un écrit reçu après sa création ; « pas de réponse » n'est pas joint", () => {
    const creeLe = new Date("2026-09-25T08:00:00Z");
    const appel = (issue: string | null, texte = "") => ({ issue, etiquettes: [], texte, le: new Date("2026-09-25T09:00:00Z") });
    assert.equal(calculs.estJoint({ creeLe, appels: [appel("PAS_DE_REPONSE")], ecritsRecus: [] }), false);
    assert.equal(calculs.estAppele({ creeLe, appels: [appel("PAS_DE_REPONSE")], ecritsRecus: [] }), true);
    assert.equal(calculs.estJoint({ creeLe, appels: [appel(null, "Appel — Pas de réponse")], ecritsRecus: [] }), false);
    assert.equal(calculs.estJoint({ creeLe, appels: [appel(null, "Tombé sur la messagerie")], ecritsRecus: [] }), false);
    assert.equal(calculs.estJoint({ creeLe, appels: [appel("INTERESSE")], ecritsRecus: [] }), true);
    assert.equal(calculs.estJoint({ creeLe, appels: [], ecritsRecus: [new Date("2026-09-26T08:00:00Z")] }), true);
    // Le mail qui a créé le lead (reçu avant) ne le rend pas joint.
    assert.equal(calculs.estJoint({ creeLe, appels: [], ecritsRecus: [new Date("2026-09-25T07:59:00Z")] }), false);
  });
  test("marge estimée, panier moyen, doublon fusionné", () => {
    assert.equal(calculs.margeEstimee(2000, 350.5), 1649.5);
    assert.equal(calculs.panierMoyen([{ montant: 1000 }, { montant: 2000 }, { montant: null }]), 1500);
    assert.equal(calculs.panierMoyen([{ montant: null }]), null);
    assert.equal(calculs.depensesDeChantier([{ jour: "2026-09-01", montant: 100, categorie: "MATIERE", dossierId: "d", fournisseur: "x" }, { jour: "2026-09-01", montant: 50, categorie: "MATIERE", dossierId: null, fournisseur: "x" }, { jour: "2026-09-01", montant: 70, categorie: "OUTILLAGE", dossierId: "d", fournisseur: "x" }]), 100);
    assert.equal(calculs.estDoublonFusionne({ archiveLe: MERCREDI, archiveMotif: "Doublon de Dupont : fusionné le 29/09/2026" }), true);
    assert.equal(calculs.estDoublonFusionne({ archiveLe: MERCREDI, archiveMotif: "Corbeille" }), false);
  });
});

describe("résumé du jour : trois phrases par règles, aucun chiffre inventé", async () => {
  const { composerResume, NBSP } = await import("./resume");
  const { indicateur } = await import("./ecrans/commun");
  const { tunnelDe } = await import("./ecrans/tunnel");
  const periode = { cle: "30j" as const, du: "2026-09-01", au: "2026-09-30", jours: 30, libelle: "les 30 derniers jours", precedente: { du: "2026-08-02", au: "2026-08-31" } };
  const ecran = {
    periode,
    indicateurs: [
      indicateur({ cle: "leads", libelle: "Leads", valeur: 45, precedente: 30, format: "nombre", favorable: "hausse", source: "CRM" }),
      indicateur({ cle: "devis", libelle: "Devis envoyés", valeur: 4, precedente: 8, format: "nombre", favorable: "hausse", source: "CRM" }),
      indicateur({ cle: "signes", libelle: "Chantiers signés", valeur: 0, precedente: 0, format: "nombre", favorable: "hausse", source: "CRM", detail: "9 060 € en attente (6 devis)" }),
      indicateur({ cle: "coutParSigne", libelle: "Coût par chantier signé", valeur: 1250, precedente: 2500, format: "euros", favorable: "baisse", source: "META" }),
    ],
    tunnel: tunnelDe([{ cle: "leads", libelle: "Leads", valeur: 45, source: "CRM" }, { cle: "appeles", libelle: "Appelés", valeur: 27, source: "CRM" }, { cle: "joints", libelle: "Joints", valeur: 17, source: "CRM" }, { cle: "devis", libelle: "Devis", valeur: 4, source: "CRM" }], ["appeles", "joints", "devis"]),
    publicite: { jourCampagne: 9, dureeCampagne: 21, depense: 151.5, budget: 378, leads: 38, coutParLead: 3.99, coutParDevis: 75.75, publicites: [], estimation: true },
    argent: { encaisse: 3000, devisEnAttente: 9060, depensePub: 151.5, ratioPub: 0.05, plafond: 0.2 },
  };
  const resume = composerResume(ecran, MERCREDI);
  test("ça monte, ça coince, à faire ; tutoiement ; espaces insécables", () => {
    assert.equal(resume.redaction, "REGLES");
    assert.deepEqual(resume.phrases.map((p) => [p.genre, p.amorce]), [["MONTE", "Ça monte."], ["BAISSE", "Ça coince."], ["A_FAIRE", "À faire."]]);
    // Le plus fort mouvement favorable : les leads (+50 %), à égalité avec le coût (−50 %) : le premier des deux.
    assert.match(resume.phrases[0].texte, /^Sur les 30 derniers jours, (les leads montent|le coût par chantier signé baisse)/, "chaque phrase nomme sa période (relecture B, point 6)");
    assert.match(resume.phrases[0].texte, / Jour 9 sur 21 de la campagne\.$/);
    assert.match(resume.phrases[1].texte, /^Sur les 30 derniers jours, les devis envoyés baissent : 4 contre 8 sur la période d'avant, −50 % \(CRM\)\. L'étape qui perd le plus : joint → devis, 13 personnes perdues \(CRM\)\.$/);
    assert.equal(resume.phrases[2].texte, `Relance les 6 devis en attente${NBSP}: 9${NBSP}060${NBSP}€ en jeu (CRM).`);
    for (const p of resume.phrases) {
      assert.ok(p.sources.length > 0);
      assert.doesNotMatch(p.texte, / [€%:]/, `espace simple avant €, % ou : dans « ${p.texte} »`);
    }
  });
  test("chaque chiffre du texte existe dans l'écran (valeurs, précédentes, variations, tunnel, argent, campagne)", () => {
    const connus = new Set<number>();
    for (const i of ecran.indicateurs) {
      for (const v of [i.valeur, i.evolution.precedente]) if (v !== null) connus.add(v);
      if (i.evolution.variation !== null) connus.add(Math.round(Math.abs(i.evolution.variation) * 1000) / 10);
      for (const m of (i.detail ?? "").matchAll(/\d[\d\s  ]*(?:,\d+)?/g)) connus.add(Number(m[0].replace(/[\s  ]/g, "").replace(",", ".")));
    }
    for (const e of ecran.tunnel.etapes) if (e.valeur !== null) connus.add(e.valeur);
    if (ecran.tunnel.perteMax) connus.add(ecran.tunnel.perteMax.perdus);
    for (const v of [ecran.publicite.jourCampagne, ecran.publicite.dureeCampagne, ecran.argent.devisEnAttente, ecran.argent.encaisse, ecran.periode.jours]) connus.add(v);
    const texte = resume.phrases.map((p) => p.texte).join(" ");
    for (const m of texte.matchAll(/\d[\d ]*(?:,\d+)?/g)) {
      const n = Number(m[0].replace(/ /g, "").replace(",", "."));
      assert.ok(connus.has(n), `chiffre inventé : ${m[0]} dans « ${texte} »`);
    }
  });
  test("à faire : couper une publicité passe avant tout ; puis la règle des 20 % ; rien d'urgent sinon", () => {
    const couper = composerResume({ ...ecran, publicite: { ...ecran.publicite, publicites: [{ nom: "Vidéo cuisine", detail: "", verdict: "COUPER" as const }] } }, MERCREDI);
    assert.equal(couper.phrases[2].texte, `Coupe la publicité «${NBSP}Vidéo cuisine${NBSP}»${NBSP}: le protocole de campagne le demande (Meta).`);
    const trop = composerResume({ ...ecran, argent: { ...ecran.argent, ratioPub: 0.3 } }, MERCREDI);
    assert.match(trop.phrases[2].texte, /^Baisse la pub : elle représente 30 % de l'encaissé du mois dernier, pour un plafond de 20 % \(CRM\)\.$/);
    const calme = composerResume({ ...ecran, indicateurs: [], tunnel: { etapes: [], perteMax: null }, publicite: null, argent: { ...ecran.argent, devisEnAttente: 0 } }, MERCREDI);
    assert.deepEqual(calme.phrases.map((p) => p.texte), ["Sur les 30 derniers jours, rien ne monte nettement.", "Sur les 30 derniers jours, rien ne baisse nettement.", `Rien d'urgent dans les chiffres${NBSP}: garde le rythme.`]);
  });
});

describe("alertes (règles pures)", async () => {
  const { alertesCoutParLead, alerteTrafic, alertesDesSources } = await import("./alertes");
  test("coût par lead > 2 × la meilleure sur au moins 5 leads", () => {
    const a = alertesCoutParLead([{ id: "a", nom: "Carrousel", depense: 50, leads: 5 }, { id: "b", nom: "Vidéo", depense: 150, leads: 6 }, { id: "c", nom: "Photo", depense: 120, leads: 4 }]);
    assert.deepEqual(a.map((x) => x.cle), ["PUBLICITE_CPL:b"]);
    assert.match(a[0].texte, /« Vidéo » : 25 € par lead, plus de 2 × la meilleure \(10 €\), sur 6 leads/);
    assert.deepEqual(alertesCoutParLead([{ id: "a", nom: "x", depense: null, leads: 9 }]), []);
  });
  test("chute de trafic > 40 % (au moins 20 visites avant)", () => {
    assert.equal(alerteTrafic(50, 100)?.cle, "TRAFIC_CHUTE");
    assert.equal(alerteTrafic(70, 100), null);
    assert.equal(alerteTrafic(2, 10), null);
    assert.equal(alerteTrafic(null, 100), null);
  });
  test("jeton expiré ou synchronisation en échec, avec la date de la dernière réussite", () => {
    const a = alertesDesSources([
      { source: "META", branchee: true, etat: "EN_ECHEC", derniereReussite: "2026-09-28T05:00:00.000Z", erreur: "Error validating access token: Session has expired (190)", aFaire: null },
      { source: "SEARCH_CONSOLE", branchee: true, etat: "EN_ECHEC", derniereReussite: null, erreur: "HTTP 500", aFaire: null },
      { source: "FICHE_GOOGLE", branchee: false, etat: "EN_ATTENTE_ACCES", derniereReussite: null, erreur: null, aFaire: "…" },
    ]);
    assert.deepEqual(a.map((x) => x.cle), ["SYNCHRO_META", "SYNCHRO_SEARCH_CONSOLE"]);
    assert.equal(a[0].texte, "Jeton Meta expiré ou refusé : à renouveler ; dernière synchronisation réussie le 28/09/2026");
    assert.equal(a[1].texte, "Synchronisation Search Console en échec (HTTP 500)");
  });
});

describe("cache mémoire", async () => {
  const { memoiser, viderCacheAnalytique, DUREE_CACHE_MS } = await import("./memoire");
  test("5 minutes, promesse partagée, échec non gardé, vidage par préfixe", async () => {
    viderCacheAnalytique();
    let appels = 0;
    const calcul = async () => ++appels;
    const t0 = 1_000_000;
    assert.equal(await memoiser("essai:a", calcul, DUREE_CACHE_MS, t0), 1);
    assert.equal(await memoiser("essai:a", calcul, DUREE_CACHE_MS, t0 + DUREE_CACHE_MS - 1), 1);
    assert.equal(await memoiser("essai:a", calcul, DUREE_CACHE_MS, t0 + DUREE_CACHE_MS), 2);
    const [x, y] = await Promise.all([memoiser("essai:b", calcul, DUREE_CACHE_MS, t0), memoiser("essai:b", calcul, DUREE_CACHE_MS, t0)]);
    assert.equal(x, y);
    await assert.rejects(memoiser("essai:c", async () => { throw new Error("panne"); }, DUREE_CACHE_MS, t0));
    assert.equal(await memoiser("essai:c", async () => 7, DUREE_CACHE_MS, t0), 7);
    viderCacheAnalytique("essai:a");
    assert.equal(await memoiser("essai:a", calcul, DUREE_CACHE_MS, t0), appels);
  });
});
