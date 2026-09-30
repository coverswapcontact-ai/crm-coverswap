import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { preparerBaseEssai } from "@/test/base-essai";

preparerBaseEssai();
process.env.UPLOADS_DIR = mkdtempSync(path.join(tmpdir(), "coverswap-m16-6-"));
for (const cle of ["META_PIXEL_ID", "META_ACCESS_TOKEN", "META_APP_SECRET", "META_VERIFY_TOKEN", "META_CONVERSIONS_TOKEN", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_TOKEN_KEY", "NTFY_TOPIC", "TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID", "VAPID_PRIVATE_KEY", "RESEND_API_KEY", "ANTHROPIC_API_KEY"]) process.env[cle] = "";

/**
 * Mission 16 (partie 6) — l'entonnoir du site par famille de source, côté CRM : `familleSource` (Meta, recherche,
 * direct, autre au nom gardé), la famille d'un parcours (sa première source non vide), l'entonnoir emboîté par famille
 * (sept étapes, la somme des familles = le global), la lecture en base (`entonnoirSite`, `syntheseSite`) sans rien
 * réécrire, l'écran Leads (sélecteur Toutes · Meta · Recherche · Direct) et les outils « synthese » / « voir_publicite ».
 * `fetch` est remplacé pendant tout le fichier : une requête réseau fait échouer le test. Aucun nom de client.
 */

let prisma: typeof import("@/lib/prisma").default;
let evenements: typeof import("@/lib/site/evenements");
let familles: typeof import("@/lib/site/familles-source");
let execution: typeof import("@/lib/assistant/execution");
let catalogue: typeof import("@/lib/assistant/catalogue");
let session: import("@/lib/assistant/execution").Session;

const fetchOrigine = globalThis.fetch;
const requetesReseau: string[] = [];
let rang = 0;
/** Un identifiant de parcours bien formé (le site envoie un UUID). */
const parcours = () => `cccccccc-1606-4000-8000-${String(++rang).padStart(12, "0")}`;

before(async () => {
  globalThis.fetch = (async (entree: string | URL | Request) => {
    requetesReseau.push(String(entree instanceof Request ? entree.url : entree));
    throw new Error("Aucune requête réseau dans les essais");
  }) as typeof fetch;
  prisma = (await import("@/lib/prisma")).default;
  evenements = await import("@/lib/site/evenements");
  familles = await import("@/lib/site/familles-source");
  execution = await import("@/lib/assistant/execution");
  catalogue = await import("@/lib/assistant/catalogue");
  session = await execution.ouvrirSession({ jetonId: "essai-m16-6", clientNom: "Essai", utilisateur: "essai@local" });
});

after(async () => {
  globalThis.fetch = fetchOrigine;
  await prisma.$disconnect();
});

const ETAPES = ["PAGE_VUE", "PIECE_CHOISIE", "PHOTO_CHARGEE", "GENERATION_LANCEE", "RESULTAT_VU", "ESTIMATION_VUE"] as const;

describe("familleSource : Meta, recherche, direct, autre (nom gardé)", () => {
  test("les sources telles que le site les envoie (utm_source[/medium] ou domaine référent)", () => {
    const cas: [string | null | undefined, string][] = [
      // Meta : Facebook, Instagram, Messenger, le raccourci des publicités.
      ["meta/paid", "meta"],
      ["fb", "meta"],
      ["facebook.com", "meta"],
      ["l.facebook.com", "meta"],
      ["m.facebook.com", "meta"],
      ["instagram.com", "meta"],
      ["l.instagram.com", "meta"],
      ["ig/story", "meta"],
      ["msg", "meta"],
      ["Meta/Paid", "meta"],
      ["facebook_ads/cpc", "meta"],
      // Recherche : les moteurs.
      ["google.com", "recherche"],
      ["google.fr", "recherche"],
      ["google/cpc", "recherche"],
      ["bing.com", "recherche"],
      ["duckduckgo.com", "recherche"],
      ["qwant.com", "recherche"],
      ["ecosia.org", "recherche"],
      ["fr.search.yahoo.com", "recherche"],
      ["com.google.android.googlequicksearchbox", "recherche"],
      // Direct : rien de connu.
      ["", "direct"],
      ["   ", "direct"],
      [null, "direct"],
      [undefined, "direct"],
      ["direct", "direct"],
      // Autre : le reste, un MOT doit correspondre (« metamorphose », « bingo », « googleads » ne sont pas des familles).
      ["chatgpt.com", "autre"],
      ["t.co", "autre"],
      ["metamorphose.fr", "autre"],
      ["bingo.fr", "autre"],
      ["googleads.g.doubleclick.net", "autre"],
      // Seul le premier segment compte : le medium ne classe pas.
      ["newsletter/facebook", "autre"],
    ];
    for (const [source, attendue] of cas) assert.equal(familles.familleSource(source).famille, attendue, String(source));
    assert.ok(cas.length >= 12);
  });

  test("le nom de la source est gardé (espaces autour retirés) ; vide pour le direct", () => {
    assert.deepEqual(familles.familleSource(" Chatgpt.com "), { famille: "autre", nom: "Chatgpt.com" });
    assert.deepEqual(familles.familleSource("l.facebook.com"), { famille: "meta", nom: "l.facebook.com" });
    assert.deepEqual(familles.familleSource(null), { famille: "direct", nom: "" });
    assert.deepEqual(familles.FAMILLES_SOURCE_SITE, ["meta", "recherche", "direct", "autre"]);
    assert.deepEqual(familles.CHOIX_ENTONNOIR.map((c) => c.libelle), ["Toutes", "Meta", "Recherche", "Direct"]);
    // `evenements.ts` réexporte la même fonction (conception : « familleSource dans site/evenements »).
    assert.equal(evenements.familleSource, familles.familleSource);
  });

  test("la famille d'un parcours : sa première source non vide, sinon direct", () => {
    const f = familles.familleDesParcours([
      { parcoursId: "a", source: null },
      { parcoursId: "a", source: "l.facebook.com" },
      { parcoursId: "a", source: "google.com" },
      { parcoursId: "b", source: "google.fr" },
      { parcoursId: "b", source: "fb" },
      { parcoursId: "c", source: "" },
      { parcoursId: "c", source: null },
      { parcoursId: "d", source: "t.co" },
    ]);
    assert.deepEqual(Object.fromEntries([...f.entries()].map(([p, s]) => [p, s.famille])), { a: "meta", b: "recherche", c: "direct", d: "autre" });
    assert.equal(f.get("d")?.nom, "t.co");
  });
});

describe("l'entonnoir par famille (pur)", () => {
  const e = (parcoursId: string, type: string, source: string | null = null) => ({ parcoursId, type, source });
  const jusqua = (parcoursId: string, n: number, source: string | null) => ETAPES.slice(0, n).map((type, i) => e(parcoursId, type, i === 0 ? source : null));
  const EVENEMENTS = [
    // Meta : un parcours complet (contact), un qui s'arrête à la visite, un venu direct puis revenu par une publicité.
    ...jusqua("m1", 6, "meta/paid"), e("m1", "RAPPEL_DEMANDE"),
    ...jusqua("m2", 1, "l.instagram.com"),
    e("m3", "PAGE_VUE", null), e("m3", "PIECE_CHOISIE", "fb"), e("m3", "PHOTO_CHARGEE"),
    // Recherche : jusqu'au rendu vu, puis contact sans estimation (facultative).
    ...jusqua("r1", 5, "google.com"), e("r1", "DEVIS_DEMANDE"),
    ...jusqua("r2", 3, "bing.com"),
    // Direct.
    ...jusqua("d1", 2, null),
    ...jusqua("d2", 1, ""),
    // Autres : noms gardés.
    ...jusqua("a1", 2, "chatgpt.com"),
    ...jusqua("a2", 1, "chatgpt.com"),
    ...jusqua("a3", 1, "t.co"),
  ];

  test("sept étapes par famille, emboîtées ; la somme des familles redonne le global, étape par étape", () => {
    const entonnoir = evenements.calculerEntonnoirParFamille(EVENEMENTS, 7);
    assert.deepEqual(entonnoir.etapes.map((x) => x.cle), ["visite", "piece", "photo", "generation", "resultat", "estimation", "contact"]);
    const lire = (etapes: { cle: string; parcours: number; abandons: number | null }[]) => etapes.map((x) => [x.cle, x.parcours, x.abandons]);
    assert.deepEqual(lire(entonnoir.parFamille.meta), [
      ["visite", 3, null],
      ["piece", 2, 1],
      ["photo", 2, 0],
      ["generation", 1, 1],
      ["resultat", 1, 0],
      ["estimation", 1, null],
      ["contact", 1, 0],
    ]);
    assert.deepEqual(lire(entonnoir.parFamille.recherche), [
      ["visite", 2, null],
      ["piece", 2, 0],
      ["photo", 2, 0],
      ["generation", 1, 1],
      ["resultat", 1, 0],
      ["estimation", 0, null],
      ["contact", 1, 0],
    ]);
    assert.deepEqual(lire(entonnoir.parFamille.direct), [
      ["visite", 2, null],
      ["piece", 1, 1],
      ["photo", 0, 1],
      ["generation", 0, 0],
      ["resultat", 0, 0],
      ["estimation", 0, null],
      ["contact", 0, 0],
    ]);
    assert.equal(entonnoir.parFamille.autre[0].parcours, 3);
    // Un parcours dans une seule famille : les familles s'additionnent en l'entonnoir global.
    entonnoir.etapes.forEach((etape, i) => {
      const somme = familles.FAMILLES_SOURCE_SITE.reduce((total, f) => total + entonnoir.parFamille[f][i].parcours, 0);
      assert.equal(somme, etape.parcours, etape.cle);
    });
    // Emboîtement : une étape obligatoire ne dépasse jamais la précédente, dans chaque famille.
    for (const f of familles.FAMILLES_SOURCE_SITE) {
      const obligatoires = entonnoir.parFamille[f].filter((x) => !x.facultative).map((x) => x.parcours);
      obligatoires.forEach((n, i) => assert.ok(i === 0 || n <= obligatoires[i - 1], `${f} : ${obligatoires.join(" → ")}`));
    }
    // Les autres sources, par nom, les plus fréquentes d'abord.
    assert.deepEqual(entonnoir.autresSources, [{ nom: "chatgpt.com", parcours: 2 }, { nom: "t.co", parcours: 1 }]);
    // Rien d'autre ne change pour l'entonnoir global (mêmes nombres que `calculerEntonnoir`).
    assert.deepEqual(entonnoir.etapes, evenements.calculerEntonnoir(EVENEMENTS, 7).etapes);
  });

  test("le choix du sélecteur et le texte des outils", () => {
    const entonnoir = evenements.calculerEntonnoirParFamille(EVENEMENTS, 7);
    assert.equal(familles.etapesDuChoix(entonnoir, "toutes"), entonnoir.etapes);
    assert.equal(familles.etapesDuChoix(entonnoir, "meta"), entonnoir.parFamille.meta);
    assert.equal(familles.etapesDuChoix({ jours: 7, etapes: entonnoir.etapes }, "meta"), entonnoir.etapes, "sans familles (ancien instantané) : le global");
    assert.equal(familles.texteEtapes(entonnoir.parFamille.meta), "Visite 3 → Pièce choisie 2 → Photo chargée 2 → Génération lancée 1 → Résultat vu 1 → (Estimation vue 1) → Contact ou rappel 1");
    const lignes = familles.texteEntonnoirParFamille(entonnoir);
    assert.equal(lignes.length, 4);
    assert.match(lignes[0], /^- Meta : Visite 3 → /);
    assert.match(lignes[3], /^- Autres \(chatgpt\.com 2, t\.co 1\) : Visite 3 → /);
    // Une famille sans visite n'a pas de ligne.
    const sansDirect = evenements.calculerEntonnoirParFamille(EVENEMENTS.filter((x) => !x.parcoursId.startsWith("d")), 7);
    assert.deepEqual(familles.texteEntonnoirParFamille(sansDirect).map((l) => l.split(" :")[0]), ["- Meta", "- Recherche", "- Autres (chatgpt.com 2, t.co 1)"]);
    assert.deepEqual(familles.texteEntonnoirParFamille(evenements.calculerEntonnoir([], 7)), [], "sans familles : rien");
  });

  test("l'écran Leads : sélecteur Toutes · Meta · Recherche · Direct, sept étapes avec les abandons, autres sources nommées", async () => {
    const { Entonnoir } = await import("@/app/(pilotage)/leads/_components/SurLeSite");
    const entonnoir = evenements.calculerEntonnoirParFamille(EVENEMENTS, 7);
    const html = renderToStaticMarkup(createElement(Entonnoir, { entonnoir }));
    assert.match(html, /role="group" aria-label="Source des visites"/);
    const boutons = [...html.matchAll(/<button type="button" aria-pressed="(true|false)"[^>]*>([^<]+)<span[^>]*>(\d+)<\/span><\/button>/g)].map((m) => [m[2].trim(), m[1], Number(m[3])]);
    assert.deepEqual(boutons, [["Toutes", "true", 10], ["Meta", "false", 3], ["Recherche", "false", 2], ["Direct", "false", 2]]);
    assert.equal((html.match(/<li class="flex items-center gap-1.5">/g) ?? []).length, 7, "sept étapes");
    assert.match(html, /aria-label="Entonnoir du simulateur"/);
    assert.match(html, /Autres sources : chatgpt\.com 2 · t\.co 1/);
    // Choix Meta : ses nombres, ses abandons, pas la ligne des autres sources.
    const meta = renderToStaticMarkup(createElement(Entonnoir, { entonnoir, choixInitial: "meta" }));
    assert.match(meta, /aria-pressed="true"[^>]*>Meta /);
    assert.match(meta, /aria-label="Entonnoir du simulateur, visites « Meta »"/);
    assert.match(meta, /Visite <span class="font-medium">3<\/span>/);
    assert.match(meta, /Pièce choisie <span class="font-medium">2<\/span><\/span><span class="text-\[#F87171\]"[^>]*>\(−1\)/);
    assert.doesNotMatch(meta, /Autres sources/);
    // Une famille sans visite le dit, sans entonnoir vide.
    const sansDirect = evenements.calculerEntonnoirParFamille(EVENEMENTS.filter((x) => !x.parcoursId.startsWith("d")), 7);
    const direct = renderToStaticMarkup(createElement(Entonnoir, { entonnoir: sansDirect, choixInitial: "direct" }));
    assert.match(direct, /Aucun parcours venu de « Direct » ces 7 derniers jours\./);
    assert.doesNotMatch(direct, /<ol/);
    // Un entonnoir sans familles (lecture d'avant) : pas de sélecteur.
    const ancien = renderToStaticMarkup(createElement(Entonnoir, { entonnoir: evenements.calculerEntonnoir(EVENEMENTS, 7) }));
    assert.doesNotMatch(ancien, /Source des visites/);
  });
});

describe("en base : entonnoirSite, syntheseSite, outils de l'assistant", () => {
  test("lecture par date, sept jours ; la famille se calcule à la lecture (rien n'est réécrit)", async () => {
    const maintenant = Date.now();
    const le = (minutes: number) => new Date(maintenant - minutes * 60_000);
    const ecrire = (parcoursId: string, type: string, source: string | null, minutes: number) => prisma.evenementSite.create({ data: { parcoursId, type, page: type === "PAGE_VUE" ? "/" : "/simulateur", source, createdAt: le(minutes) } });
    // Arrivé sans source, puis revenu par Google : recherche (première source non vide, lue par date).
    const revenu = parcours();
    await ecrire(revenu, "PAGE_VUE", null, 50);
    await ecrire(revenu, "PIECE_CHOISIE", "google.com", 40);
    // Arrivé par Facebook, puis Google : Meta (la première source connue décide), jusqu'au rendu vu puis rappel.
    const meta = parcours();
    await ecrire(meta, "PAGE_VUE", "l.facebook.com", 30);
    for (const [i, type] of ["PIECE_CHOISIE", "PHOTO_CHARGEE", "GENERATION_LANCEE", "RESULTAT_VU", "RAPPEL_DEMANDE"].entries()) await ecrire(meta, type, i === 2 ? "google.com" : "l.facebook.com", 29 - i);
    // Une autre source, nom gardé ; une visite d'il y a huit jours (hors fenêtre).
    await ecrire(parcours(), "PAGE_VUE", "chatgpt.com", 10);
    await ecrire(parcours(), "PAGE_VUE", "meta/paid", 8 * 24 * 60);

    const entonnoir = await evenements.entonnoirSite(7);
    assert.ok(entonnoir.parFamille && entonnoir.autresSources);
    assert.deepEqual(entonnoir.parFamille.meta.map((x) => x.parcours), [1, 1, 1, 1, 1, 0, 1]);
    assert.deepEqual(entonnoir.parFamille.recherche.map((x) => x.parcours), [1, 1, 0, 0, 0, 0, 0]);
    assert.equal(entonnoir.parFamille.direct[0].parcours, 0, "le parcours revenu par Google n'est plus « direct »");
    assert.deepEqual(entonnoir.autresSources, [{ nom: "chatgpt.com", parcours: 1 }]);
    assert.equal(entonnoir.etapes[0].parcours, 3, "la visite d'il y a huit jours est hors fenêtre");
    // Rien de rétroactif : les lignes gardent leur source brute.
    const brutes = await prisma.evenementSite.findMany({ where: { parcoursId: meta }, orderBy: { createdAt: "asc" }, select: { source: true } });
    assert.deepEqual(brutes.map((b) => b.source), ["l.facebook.com", "l.facebook.com", "l.facebook.com", "google.com", "l.facebook.com", "l.facebook.com"]);

    // La synthèse de la période porte le même entonnoir (instantané version 5).
    const jour = new Date().toISOString().slice(0, 10);
    const synthese = await evenements.syntheseSite(jour, jour);
    assert.ok(synthese.entonnoir?.parFamille);
    assert.equal(synthese.entonnoir.parFamille.meta[4].parcours, 1);
    assert.equal(synthese.entonnoir.jours, 1);
    const { VERSION_SYNTHESE } = await import("@/lib/synthese/types");
    assert.equal(VERSION_SYNTHESE, 5);
  });

  test("« synthese » : une ligne par famille ; « voir_publicite » : la ligne des visites venues de Meta", async () => {
    const appeler = (nom: string, entree: Record<string, unknown>) => execution.executerOutil(catalogue.outilParNom(nom)!, entree, session);
    const synthese = await appeler("synthese", {});
    // Trente jours : la visite Meta d'il y a huit jours compte ici (pas dans les sept jours de « voir_publicite »).
    assert.match(synthese.texte, /Entonnoir du site par source \(parcours ; entre parenthèses, l'étape facultative\) :\n- Meta : Visite 2 → Pièce choisie 1 → Photo chargée 1 → Génération lancée 1 → Résultat vu 1 → \(Estimation vue 0\) → Contact ou rappel 1\n- Recherche : Visite 1 → Pièce choisie 1 → Photo chargée 0/);
    assert.match(synthese.texte, /\n- Autres \(chatgpt\.com 1\) : Visite 1 → Pièce choisie 0/);
    assert.doesNotMatch(synthese.texte, /- Direct :/, "une famille sans visite n'a pas de ligne");
    const pub = await appeler("voir_publicite", {});
    assert.match(pub.texte, /Sur le site, visites venues de Meta \(7 jours\) : Visite 1 → Pièce choisie 1 → Photo chargée 1 → Génération lancée 1 → Résultat vu 1 → \(Estimation vue 0\) → Contact ou rappel 1\./);
    assert.equal(requetesReseau.length, 0, "aucune requête réseau");
  });
});
