import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";

/**
 * Mission 22 (A5) — les écrans de « Plus » (Boîte mail, Simulateur, Site, Bilan, Réglages, À valider, Nouvelle
 * dépense) restent les composants de la v1, servis dans la coque v2 sous un en-tête v2. Vérifié sur les sources
 * (comme `ecrans-a4.test.ts`) : chaque `page.tsx` monte `EnTeteEcran` sous condition v2 et rend l'écran v1 tel quel
 * dans les deux cas ; l'en-tête respecte les règles (20 px, jetons, pas de capitales espacées, pas de mouvement) ;
 * « À valider » dit en phrase ce qui attend dans « Plus » (aucun badge) ; les adresses v1 restent servies.
 */
const lire = (f: string) => readFileSync(join(process.cwd(), "src", f), "utf8").replace(/\r\n/g, "\n");
const enTete = lire("components/v2/EnTeteEcran.tsx");
const navigation = lire("components/v2/NavigationV2.tsx");
const compteurs = lire("app/api/pilotage/compteurs/route.ts");

/** Les sept écrans de « Plus » (et les deux sous-pages du simulateur) : page, titre v2, cadre, racine v1. */
const ECRANS: { page: string; titre: string; cadre: string; racine: string }[] = [
  { page: "app/(pilotage)/mail/page.tsx", titre: "Boîte mail", cadre: "colonne-4", racine: "<EcranMail " },
  { page: "app/(pilotage)/simulateur/page.tsx", titre: "Simulateur", cadre: "colonne-4", racine: "<EcranSimulateur " },
  { page: "app/(pilotage)/site/page.tsx", titre: "Le site", cadre: "large-5", racine: "<EcranSite " },
  { page: "app/(pilotage)/analytique/page.tsx", titre: "Bilan", cadre: "bilan", racine: "<EcranAnalytique " },
  { page: "app/(pilotage)/parametres/page.tsx", titre: "Réglages", cadre: "colonne-5", racine: "<OngletsParametres" },
  { page: "app/(pilotage)/validation/page.tsx", titre: "À valider", cadre: "colonne-5", racine: "<FileValidation " },
  { page: "app/(pilotage)/depenses/nouvelle/page.tsx", titre: "Nouvelle dépense", cadre: "etroit", racine: "<SaisieDepense " },
  { page: "app/(pilotage)/simulateur/banc/page.tsx", titre: "Banc du simulateur", cadre: "large-4", racine: "<EcranBanc " },
  { page: "app/(pilotage)/simulateur/prompts/page.tsx", titre: "Prompts du simulateur", cadre: "large-4", racine: "<EcranPrompts " },
];

describe("EnTeteEcran : le titre en phrase, une aide, un bouton principal au plus, l'écran v1 dessous", () => {
  test("composant serveur, 20 px (text-titre), jetons, pas de capitales espacées, aucun mouvement", () => {
    assert.doesNotMatch(enTete, /"use client"/);
    assert.match(enTete, /<h1 className="text-titre font-semibold text-texte">\{titre\}<\/h1>/);
    assert.match(enTete, /\{aide \? <p className="mt-1 text-corps-tel text-texte-3 md:text-corps">\{aide\}<\/p> : null\}/);
    assert.match(enTete, /\{action \? <div className="shrink-0">\{action\}<\/div> : null\}/);
    assert.equal((enTete.match(/\{action\}/g) ?? []).length, 1, "un seul emplacement pour le bouton principal");
    assert.doesNotMatch(enTete, /uppercase|tracking-wide|animate-|transition-|rounded-full/);
    assert.doesNotMatch(enTete, /#[0-9a-fA-F]{6}/);
  });

  test("le titre v1 (EnTetePage ou h1 propre) est masqué sous l'en-tête : une seule chose en haut ; le reste est rendu tel quel", () => {
    assert.match(enTete, /<div className="\[&_h1\]:hidden">\{children\}<\/div>/);
    // Chaque écran v1 coiffé n'a qu'un h1, en tête : EnTetePage (ui.tsx), le h1 de SaisieDepense, celui de Controles (Bilan).
    const ui = lire("components/pilotage/ui.tsx");
    assert.equal((ui.match(/<h1 /g) ?? []).length, 1);
    for (const f of ["app/(pilotage)/depenses/_components/SaisieDepense.tsx", "components/pilotage/analytique/Controles.tsx"]) assert.equal((lire(f).match(/<h1 /g) ?? []).length, 1, f);
    for (const f of ["app/(pilotage)/mail/_components/EcranMail.tsx", "app/(pilotage)/simulateur/_components/EcranSimulateur.tsx", "app/(pilotage)/site/_components/EcranSite.tsx", "app/(pilotage)/parametres/_components/OngletsParametres.tsx", "app/(pilotage)/validation/_components/FileValidation.tsx"]) {
      const source = lire(f);
      assert.match(source, /<EnTetePage/, f);
      assert.doesNotMatch(source, /<h1 /, f);
    }
  });

  test("les cadres reprennent la largeur et les marges exactes des écrans v1 coiffés", () => {
    const cadres: Record<string, string> = Object.fromEntries([...enTete.matchAll(/^  "?([a-z0-9-]+)"?: "([^"]+)",$/gm)].map((m) => [m[1], m[2]]));
    assert.deepEqual(cadres, {
      etroit: "max-w-lg px-5",
      "colonne-4": "max-w-3xl px-4 md:px-8",
      "colonne-5": "max-w-3xl px-5 md:px-8",
      "large-4": "max-w-5xl px-4 md:px-8",
      "large-5": "max-w-5xl px-5 md:px-8",
      bilan: "max-w-[1440px] px-4 md:px-10",
    });
    const largeurDe = (f: string) => lire(f).match(/className="mx-auto (?:flex )?w-full (max-w-\S+)[^"]*?(px-\d)[^"]*?(md:px-\d+)/);
    const attendus: [string, string][] = [
      ["app/(pilotage)/mail/_components/EcranMail.tsx", "colonne-4"],
      ["app/(pilotage)/simulateur/_components/EcranSimulateur.tsx", "colonne-4"],
      ["app/(pilotage)/site/_components/EcranSite.tsx", "large-5"],
      ["components/pilotage/analytique/EcranAnalytique.tsx", "bilan"],
      ["app/(pilotage)/parametres/_components/OngletsParametres.tsx", "colonne-5"],
      ["app/(pilotage)/validation/_components/FileValidation.tsx", "colonne-5"],
      ["app/(pilotage)/simulateur/banc/_components/EcranBanc.tsx", "large-4"],
      ["app/(pilotage)/simulateur/prompts/_components/EcranPrompts.tsx", "large-4"],
    ];
    for (const [f, cadre] of attendus) {
      const m = largeurDe(f);
      assert.ok(m, f);
      // (`deepEqual` a resserré le type de `cadres` sur ses clés littérales.)
      assert.equal(`${m[1]} ${m[2]} ${m[3]}`, cadres[cadre as keyof typeof cadres], f);
    }
    assert.match(lire("app/(pilotage)/depenses/_components/SaisieDepense.tsx"), /className="mx-auto w-full max-w-lg px-5 py-6 pb-28 md:pb-8"/);
  });
});

describe("les pages de « Plus » : l'en-tête v2 sous condition, l'écran v1 tel quel dans les deux cas", () => {
  for (const { page, titre, cadre, racine } of ECRANS) {
    test(`${page} : « ${titre} » en v2, rien en v1`, () => {
      const source = lire(page);
      assert.match(source, /import \{ EnTeteEcran \} from "@\/components\/v2\/EnTeteEcran";/);
      assert.match(source, /import \{ interfaceCourante \} from "@\/lib\/interface\/choix";/);
      // L'écran v1 est construit une fois, puis rendu seul (v1) ou sous l'en-tête (v2).
      assert.equal((source.match(new RegExp(racine.replace(/[<\s]/g, (c) => (c === "<" ? "<" : "\\s")), "g")) ?? []).length, 1, racine);
      assert.match(source, new RegExp(`const (ecran|vue) = (\\(\\s*)?${racine}`));
      assert.match(source, new RegExp(`if \\(v === "v2"\\) (return <EnTeteEcran titre="${titre}"|\\{\\s*return \\(\\s*<EnTeteEcran titre="${titre}")`));
      assert.match(source, new RegExp(`cadre="${cadre}"`));
      assert.match(source, /return (ecran|vue);\n\}\n$/);
      // Aucune autre lecture de l'interface, aucun écran v2 : la passe est minimale.
      assert.equal((source.match(/(?<!`)interfaceCourante\(\)/g) ?? []).length, 1, "une seule lecture (le commentaire la cite entre accents graves)");
      assert.doesNotMatch(source, /components\/v2\/(?!EnTeteEcran)/);
    });
  }

  test("les titres de « Plus » sont les sept de l'énoncé, en phrase (jamais en capitales)", () => {
    const titres = ECRANS.slice(0, 7).map((e) => e.titre);
    assert.deepEqual(titres, ["Boîte mail", "Simulateur", "Le site", "Bilan", "Réglages", "À valider", "Nouvelle dépense"]);
    for (const t of titres) assert.notEqual(t, t.toUpperCase());
  });
});

describe("« À valider » dans Plus : le nombre en phrase, jamais en badge", () => {
  test("la route des compteurs ajoute propositionsEnAttente (ajout seulement : les clés d'avant restent)", () => {
    assert.match(compteurs, /import \{ compterPropositionsEnAttente \} from "@\/lib\/validation\/service";/);
    assert.match(compteurs, /NextResponse\.json\(\{ tachesAujourdhui, leadsEnRetard, tachesEnEchec, rappelGoogle, mailATraiter, propositionsEnAttente(, messagesAEnvoyer)? \}\)/, "mission 25 : messagesAEnvoyer ajouté, rien de retiré");
  });

  test("la navigation compose « À valider — N en attente » par libelleDansPlus, sur cette entrée seulement ; un seul compteur reste", () => {
    assert.match(navigation, /const ENTREE_EN_ATTENTE = "\/validation";/);
    assert.match(navigation, /propositionsEnAttente\?: number/);
    assert.match(navigation, /setPropositionsEnAttente\(compteurs\.propositionsEnAttente \?\? 0\)/);
    assert.match(navigation, /\{entree\.href === ENTREE_EN_ATTENTE \? libelleDansPlus\(entree\.libelle, propositionsEnAttente\) : entree\.libelle\}/);
    assert.equal((navigation.match(/libelleDansPlus\(/g) ?? []).length, 1);
    assert.equal((navigation.match(/<CompteurAujourdhui /g) ?? []).length, 2, "le compteur d'Aujourd'hui, et rien d'autre");
    assert.equal((navigation.match(/rounded-full/g) ?? []).length, 1, "une seule pastille : le compteur d'Aujourd'hui");
  });
});

describe("À valider joignable, adresses v1 servies, /journal en v1", () => {
  test("le journal (A1) mène à /validation?proposition= pour une proposition en attente", () => {
    assert.match(lire("lib/chronologie/journal.ts"), /lien: enAttente \? `\/validation\?proposition=\$\{p\.id\}`/);
    assert.match(lire("components/v2/taches/useGestesTaches.ts"), /\/validation\?proposition=\$\{encodeURIComponent\(/);
  });

  test("next.config.ts : les anciennes adresses redirigent toujours ; aucune adresse v1 de Plus n'y figure comme source", () => {
    const config = readFileSync(join(process.cwd(), "next.config.ts"), "utf8").replace(/\r\n/g, "\n");
    const sources = [...config.matchAll(/\{ source: "([^"]+)", destination: "([^"]+)" \}/g)].map((m) => m[1]);
    for (const s of ["/leads/kanban", "/leads/nouveau", "/leads/:id", "/dashboard", "/analytics", "/synthese", "/publicite", "/assistant", "/devis/nouveau", "/devis/:chemin*", "/factures", "/chantiers/:chemin*", "/commandes", "/espaces", "/depenses", "/taches-de-fond"]) assert.ok(sources.includes(s), s);
    for (const servie of ["/mail", "/simulateur", "/site", "/analytique", "/parametres", "/validation", "/depenses/nouvelle", "/taches", "/leads", "/dossiers", "/clients", "/finances", "/journal"]) assert.ok(!sources.includes(servie), `${servie} reste un écran`);
  });

  test("/journal en v1 renvoie vers /taches (dans la page, selon l'interface : pas une redirection de next.config)", () => {
    assert.match(lire("app/(pilotage)/journal/page.tsx"), /if \(v !== "v2"\) redirect\("\/taches"\);/);
  });
});
