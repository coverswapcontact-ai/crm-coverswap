import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { preparerBaseEssai } from "@/test/base-essai";

preparerBaseEssai();
process.env.UPLOADS_DIR = mkdtempSync(path.join(tmpdir(), "coverswap-mcp-analytique-"));
process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3001";
process.env.TACHES_DESACTIVEES = "1";

/**
 * Mission 17 (partie B) — l'outil MCP `analytique` (lecture) : chaque onglet en JSON exact (le même que l'écran) et en
 * texte lisible (résumé du jour à reformuler, indicateurs avec évolution, état des sources, alertes) ; période et
 * filtre par source ; exposé par un vrai client MCP. `campagne`, `voir_publicite` et `manager_marketing` s'appuient
 * sur les mêmes calculs : sans synchronisation, aucun coût par publicité inventé ; avec la dépense réelle, un coût
 * par lead propre à chaque publicité et le verdict du protocole. Les liens pointent vers /analytique.
 * Jeu d'essai : src/test/analytique-essai.ts. Instant fixe, aucun réseau.
 */

type ResultatOutil = import("@/lib/assistant/definition").ResultatOutil;
let prisma: typeof import("@/lib/prisma").default;
let execution: typeof import("@/lib/assistant/execution");
let catalogue: typeof import("@/lib/assistant/catalogue");
let memoire: typeof import("@/lib/analytique/memoire");
let essai: typeof import("@/test/analytique-essai");
let session: import("@/lib/assistant/execution").Session;
const reseau: string[] = [];
const fetchOrigine = globalThis.fetch;

async function appeler(nom: string, entree: Record<string, unknown> = {}): Promise<ResultatOutil> {
  const outil = catalogue.outilParNom(nom);
  assert.ok(outil, `outil inconnu : ${nom}`);
  return execution.executerOutil(outil, entree, session, essai.MERCREDI);
}

before(async () => {
  globalThis.fetch = (async (entree: string | URL | Request) => {
    reseau.push(String(entree instanceof Request ? entree.url : entree));
    throw new Error("Aucune requête réseau dans les essais");
  }) as typeof fetch;
  prisma = (await import("@/lib/prisma")).default;
  execution = await import("@/lib/assistant/execution");
  catalogue = await import("@/lib/assistant/catalogue");
  memoire = await import("@/lib/analytique/memoire");
  essai = await import("@/test/analytique-essai");
  await essai.peuplerAnalytique(prisma);
  session = await execution.ouvrirSession({ jetonId: "essai-analytique", clientNom: "Essai", utilisateur: "essai@local" });
});

after(async () => {
  essai.debrancherMeta();
  globalThis.fetch = fetchOrigine;
  await prisma.$disconnect();
});

describe("l'outil « analytique »", () => {
  test("vue d'ensemble par défaut : JSON exact de l'écran, résumé du jour, indicateurs avec évolution, sources", async () => {
    memoire.viderCacheAnalytique();
    const r = await appeler("analytique");
    const e = r.donnees as import("@/lib/analytique/types").EcranEnsemble;
    assert.equal(e.onglet, "ensemble");
    const { ecranAnalytique } = await import("@/lib/analytique/cache");
    const { resoudrePeriode } = await import("@/lib/analytique/periode");
    assert.deepEqual(e, await ecranAnalytique("ensemble", resoudrePeriode({ p: "30j" }, essai.MERCREDI), {}, essai.MERCREDI), "les données sont celles de l'écran");
    assert.match(r.texte, /^Analytique — Vue d'ensemble, les 30 derniers jours \(2026-09-01 → 2026-09-30, comparé à 2026-08-02 → 2026-08-31\)\./);
    assert.match(r.texte, /\nRésumé du jour \(rédigé par règles, à reformuler sans changer les chiffres\) :\n- Ça monte\. .*\n- Ça coince\. .*\n- À faire\. Relance le devis en attente/);
    // Relecture B (point 4) : la période finit aujourd'hui → comparée sur les jours complets (le lead du 31/08 à 23 h 30 ne compte pas contre un 30/09 à 10 h).
    assert.match(r.texte, /\n- Leads : 6 \(période d'avant, jours complets : 0, nouveau, favorable\) — dont 3 Meta \[CRM\]/);
    // Relecture B (écran, point 5) : 6e tuile « Coût par lead Meta », le coût par chantier signé en détail.
    assert.match(r.texte, /\n- Coût par lead Meta : 50,5 € — Coût par chantier signé : 151,5 € \(estimation : prorata du budget\) \[CRM\]/);
    assert.match(r.texte, /\nTunnel : Visites 3 → Simulations lancées 2 \(67 %\) → Leads 6 → Appelés 2 \(33 %\) → Joints 2 \(100 %\) → Devis 2 \(100 %\) → Signés 1 \(50 %\) → Encaissés 1 \(100 %\)\. L'étape qui perd le plus : lead → appel \(4 perdus\)\./);
    assert.match(r.texte, /Sources : CRM à jour · site à jour.* · Meta non branchée \(chiffres estimés\) — à faire : Poser META_AD_ACCOUNT_ID/);
    assert.match(r.texte, /Search Console non branchée — à faire : /);
    assert.deepEqual(r.liens, [{ libelle: "Analytique — Vue d'ensemble", href: "http://localhost:3001/analytique?onglet=ensemble&p=30j" }]);
  });

  test("chaque onglet, une période, des dates libres, un filtre par source", async () => {
    for (const [onglet, titre] of [["publicite", "Publicité"], ["seo", "SEO et Google"], ["site", "Site"], ["argent", "Argent"]] as const) {
      const r = await appeler("analytique", { onglet, p: "7j" });
      assert.equal((r.donnees as { onglet: string }).onglet, onglet);
      assert.match(r.texte, new RegExp(`^Analytique — ${titre}, les 7 derniers jours \\(2026-09-24 → 2026-09-30`));
      assert.match(r.texte, /Résumé du jour/);
      assert.equal(r.liens?.[0].href, `http://localhost:3001/analytique?onglet=${onglet}&p=7j`);
    }
    const pub = await appeler("analytique", { onglet: "publicite" });
    assert.match(pub.texte, /Campagne : jour 9 sur 21, budget 378 € ; règle du jour : on coupe une publicité/);
    assert.match(pub.texte, /  - Carrousel : dépense inconnue \(estimation globale seulement\), 2 leads CRM, 1 devis, 1 signé/);
    const seo = await appeler("analytique", { onglet: "seo" });
    assert.match(seo.texte, /- Clics : — \(source non branchée\) \[Search Console\]/);
    const site = await appeler("analytique", { onglet: "site" });
    assert.match(site.texte, /Entonnoir : Visites 3 → Simulations lancées 2 → Simulations terminées 1 → Leads 1\./);
    const argent = await appeler("analytique", { onglet: "argent" });
    assert.match(argent.texte, /Règle des 20 % \(2026-09\) : 151,5 € de pub pour 3\s000 € encaissés le mois d'avant, soit 5,1 %\./);
    assert.match(argent.texte, /Carnet de commandes : 1 devis en attente, 900 €/);
    const libre = await appeler("analytique", { du: "2026-09-20", au: "2026-09-30", source: "meta" });
    const e = libre.donnees as import("@/lib/analytique/types").EcranEnsemble;
    assert.deepEqual([e.periode.cle, e.periode.du, e.filtreSource, e.indicateurs.find((i) => i.cle === "leads")?.valeur], ["libre", "2026-09-20", "meta", 3]);
    assert.match(libre.texte, /, source Pub Meta\./);
    assert.equal(libre.liens?.[0].href, "http://localhost:3001/analytique?onglet=ensemble&du=2026-09-20&au=2026-09-30&source=meta");
  });

  test("exposé par un vrai client MCP, en lecture", async () => {
    const { construireServeur } = await import("@/lib/mcp/serveur");
    const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
    const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
    const [versClient, versServeur] = InMemoryTransport.createLinkedPair();
    const { mcp } = construireServeur(session);
    await mcp.connect(versServeur);
    const client = new Client({ name: "essai", version: "1.0" });
    await client.connect(versClient);
    const outils = await client.listTools();
    const outil = outils.tools.find((t) => t.name === "analytique");
    assert.match(outil?.description ?? "", /^\[Lecture\]/);
    assert.deepEqual(Object.keys((outil?.inputSchema as { properties: Record<string, unknown> }).properties).sort(), ["au", "du", "onglet", "p", "source", "synthese"]);
    const resultat = (await client.callTool({ name: "analytique", arguments: { onglet: "argent" } })) as { content: { type: string; text?: string }[] };
    const texte = resultat.content.map((c) => c.text ?? "").join("\n");
    assert.match(texte, /^Analytique — Argent/);
    assert.match(texte, /Données exactes \(JSON\) :\n\{"onglet":"argent"/);
    await client.close();
    await mcp.close();
  });
});

describe("analytique publicite (ex-« campagne »), etat_crm META (ex-« voir_publicite »), manager_marketing : les mêmes calculs", () => {
  test("sans synchronisation : dépense estimée, aucun coût par publicité (plus de coût identique pour toutes)", async () => {
    const m = (await appeler("manager_marketing")).donnees as Awaited<ReturnType<typeof import("@/lib/assistant/analyses/marketing").analyseMarketing>>;
    assert.deepEqual([m.depense.retenue, m.depense.origine, m.depense.estimation], [151.5, "PRORATA_CAMPAGNE", true]);
    assert.deepEqual(m.parPublicite.map((p) => [p.nom, p.leads, p.coutParLead]), [["Carrousel", 2, null], ["Vidéo", 1, null]]);
    assert.equal(m.global.meta.leads, 3);
    const campagne = await appeler("analytique", { onglet: "publicite" });
    assert.match(campagne.texte, /État de la campagne : Campagne commencée le .*jour 9 sur 21\. Budget 378 €, dépense 151,5 € \(estimation : prorata du budget/);
    assert.match(campagne.texte, /3 leads Meta sur 9 jours, soit ≈ 50,5 € par lead/);
    assert.ok(campagne.liens?.[0].href.startsWith("http://localhost:3001/analytique?onglet=publicite"), campagne.liens?.[0].href);
  });
  test("avec la dépense réelle : un coût par lead par publicité et le verdict du protocole", async () => {
    await essai.brancherMeta(prisma);
    memoire.viderCacheAnalytique();
    const m = (await appeler("manager_marketing")).donnees as Awaited<ReturnType<typeof import("@/lib/assistant/analyses/marketing").analyseMarketing>>;
    assert.deepEqual([m.depense.retenue, m.depense.origine], [130, "DEPENSE_META"]);
    assert.deepEqual(m.parPublicite.map((p) => [p.nom, p.depense, p.coutParLead, p.verdict]), [["Carrousel", 40, 20, "GARDER"], ["Vidéo", 90, 90, "SURVEILLER"]]);
    const campagne = await appeler("analytique", { onglet: "publicite" });
    assert.match(campagne.texte, /dépense 130 € \(réel Meta\)/);
    assert.match(campagne.texte, /Par publicité : Carrousel 2 leads, 1 devis, 1 signé, 20 € par lead — Garder \(.*\) · Vidéo 1 lead, 0 devis, 0 signé, 90 € par lead — Surveiller/);
    const pub = await appeler("etat_crm", { partie: "META" });
    assert.match(pub.texte, /Campagne : commencée le 22\/09\/2026, jour 9 sur 21, budget 378 €, dépense 130 € \(réel Meta\), 3 leads Meta, 43,33 € par lead\./);
    assert.match(pub.texte, /\nPar publicité \(9 jours\) : Carrousel 2 leads/);
    assert.equal(pub.liens?.[0].href, "http://localhost:3001/analytique?onglet=publicite");
    essai.debrancherMeta();
    memoire.viderCacheAnalytique();
  });
  test("les liens de l'assistant pointent vers /analytique (plus /synthese ni /publicite)", async () => {
    const synthese = await appeler("analytique", { synthese: {} });
    assert.match(synthese.liens?.[0].href ?? "", /\/analytique\?onglet=argent&du=2026-09-01&au=2026-09-30$/);
    const commercial = await appeler("manager_commercial");
    assert.ok(commercial.liens?.some((l) => /\/analytique\?du=/.test(l.href)));
    const site = await appeler("voir_fichiers", { genre: "site", jours: 30 });
    assert.equal(site.liens?.[0].href, "http://localhost:3001/analytique?onglet=site");
    assert.deepEqual(reseau, []);
  });
});
