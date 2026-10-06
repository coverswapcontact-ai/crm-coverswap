import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, test } from "node:test";
import { reecrire } from "../../scripts/jetons-codemod.mjs";

/**
 * Mission 22 (lot A0a) — la passe de lisibilité, vérifiée sur les sources comme `theme.test.ts` du site :
 * les couleurs de l'interface viennent toutes du bloc `@theme` de globals.css (zéro valeur hexadécimale ailleurs,
 * hors exceptions nommées), chaque couple texte/fond déclaré tient 4,5:1, et quelques interdits par motif.
 * Les règles de taille et de capitales ne portent que sur la v2 (`src/components/v2/`) : la v1 n'est retouchée
 * qu'en couleur, à l'identique visuel, par `scripts/jetons-codemod.mjs`.
 */

const RACINE = process.cwd();
const SRC = join(RACINE, "src");
/** Fins de ligne ramenées à LF : sous Windows (`core.autocrlf`), git réécrit les fichiers en CRLF au checkout. */
const lire = (f: string) => readFileSync(f, "utf8").replace(/\r\n/g, "\n");
const CSS = lire(join(SRC, "app", "globals.css"));
const nom = (f: string) => relative(SRC, f).split(sep).join("/");

function fichiers(dossier: string, sortie: string[] = []): string[] {
  if (!existsSync(dossier)) return sortie;
  for (const entree of readdirSync(dossier)) {
    const chemin = join(dossier, entree);
    if (statSync(chemin).isDirectory()) fichiers(chemin, sortie);
    else if (/\.tsx?$/.test(entree) && !/\.test\.tsx?$/.test(entree)) sortie.push(chemin);
  }
  return sortie;
}

/** Les couleurs du bloc `@theme {` (pas `@theme inline`), sans le préfixe `--color-` : `{ fond: "#16181D", … }`. */
function lireJetons(css: string): Record<string, string> {
  const bloc = css.match(/@theme\s*\{([\s\S]*?)\n\}/)?.[1];
  if (!bloc) throw new Error("globals.css : bloc @theme introuvable");
  const jetons: Record<string, string> = {};
  for (const [, cle, valeur] of bloc.matchAll(/--color-([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) jetons[cle] = valeur.toUpperCase();
  return jetons;
}

/** Luminance relative (WCAG 2.x). */
function luminance(hex: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) throw new Error(`couleur illisible : ${hex}`);
  const n = parseInt(m[1], 16);
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
}

/** Le rapport de contraste WCAG entre deux couleurs, arrondi au centième (4,5 pour du texte courant). */
function contraste(a: string, b: string): number {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return Math.round(((l1 + 0.05) / (l2 + 0.05)) * 100) / 100;
}

const JETONS = lireJetons(CSS);
const PERIMETRE = [...fichiers(join(SRC, "app")), ...fichiers(join(SRC, "components"))];
const V2 = fichiers(join(SRC, "components", "v2"));

/** Hors charte de l'interface : rendus PDF, mail HTML, consignes des prompts (chacun a sa propre charte imprimée ou mail). */
const HORS_CHARTE = new Set(["app/api/pdf/devis/[id]/route.tsx", "app/api/pdf/facture/[id]/route.ts", "app/api/webhook/route.ts", "app/api/simulateur/prompts/[type]/route.ts"]);
/** Les seules valeurs hexadécimales tolérées, fichier par fichier, avec leur raison. */
const EXCEPTIONS: Record<string, string[]> = {
  // L'aperçu de la marque dans Paramètres : la charte du site (fond papier, losange rouge), pas celle du CRM.
  "app/(pilotage)/parametres/_components/MarqueEspace.tsx": ["#F5F4F1", "#CC0000"],
  // Le fond de la planche de teintes : la couleur de l'image, pas de l'interface.
  "app/(pilotage)/simulateur/_components/ResultatPreparation.tsx": ["#E6E6E3"],
  // La toile de recompression des photos : fond blanc sous une image, hors interface.
  "app/depot/[jeton]/formulaire.tsx": ["#FFFFFF"],
  // DEGRADE_TUNNEL : un dégradé de graphique en six pas (le premier est le jeton action-clair).
  "components/pilotage/analytique/base.tsx": ["#4DB892", "#3FA480", "#2F8F6D", "#26805F", "#1F7254", "#19644A"],
};

describe("globals.css : les jetons de la charte sombre", () => {
  test("les 19 jetons de couleur et les 9 d'étape, en hexadécimal majuscule, dans un bloc @theme (pas inline)", () => {
    const attendus = ["fond", "surface", "surface-2", "trait", "trait-2", "texte", "texte-2", "texte-3", "texte-inverse", "action", "action-texte", "action-clair", "action-fond", "retard", "retard-texte", "attention", "attention-texte", "info", "info-texte"];
    for (const j of attendus) assert.match(JETONS[j] ?? "", /^#[0-9A-F]{6}$/, j);
    for (let n = 1; n <= 9; n++) assert.match(JETONS[`etape-${n}`] ?? "", /^#[0-9A-F]{6}$/, `etape-${n}`);
    // Facturé en ambre, encaissé dans le vert de l'action : plus d'orange.
    assert.equal(JETONS["etape-8"], JETONS["attention-texte"]);
    assert.equal(JETONS["etape-9"], JETONS["action-clair"]);
    // Le gris d'aide d'avant (3,67:1) n'existe plus : remonté dans texte-3.
    assert.equal(JETONS["texte-3"], "#9CA3AF");
    assert.ok(!Object.values(JETONS).includes("#6B7280"));
  });

  test("l'échelle de texte de la v2 et les jetons shadcn repointés sur la charte", () => {
    for (const [cle, valeur] of [["corps", "1rem"], ["corps-tel", "1.0625rem"], ["petit", "0.875rem"], ["titre", "1.25rem"], ["grand", "1.5rem"]]) {
      assert.match(CSS, new RegExp(`--text-${cle}:\\s*${valeur.replace(".", "\\.")};`), cle);
    }
    for (const [shadcn, jeton] of [["background", "fond"], ["foreground", "texte"], ["card", "surface"], ["popover", "surface"], ["primary", "action"], ["primary-foreground", "action-texte"], ["muted-foreground", "texte-3"], ["border", "trait"], ["ring", "action"]]) {
      assert.match(CSS, new RegExp(`:root \\{[^}]*--${shadcn}:\\s*var\\(--color-${jeton}\\);`), shadcn);
    }
    assert.ok(CSS.split("\n").length <= 220, "globals.css reste court");
  });

  test("contrastes mesurés (WCAG, texte courant 4,5:1) sur chaque couple déclaré", () => {
    const couples: [string, string][] = [];
    for (const texte of ["texte", "texte-2", "texte-3", "action-clair", "retard-texte", "attention-texte", "info-texte"]) for (const fond of ["fond", "surface", "surface-2"]) couples.push([texte, fond]);
    couples.push(["action-texte", "action"], ["action-texte", "action-clair"], ["texte-inverse", "texte"]);
    const faibles = couples.map(([t, f]) => [t, f, contraste(JETONS[t], JETONS[f])] as const).filter(([, , c]) => c < 4.5);
    assert.deepEqual(faibles, []);
    // Quelques valeurs figées, pour que la table de docs/CRM-V2.md reste vraie.
    assert.equal(contraste(JETONS["texte-3"], JETONS.fond), 6.99);
    assert.equal(contraste(JETONS["action-texte"], JETONS.action), 5.56);
    assert.equal(contraste(JETONS.texte, JETONS.fond), 15.99);
    // Et les deux couples interdits par motif plus bas, parce qu'ils ne tiennent pas.
    assert.ok(contraste(JETONS.texte, JETONS.action) < 4.5);
    assert.ok(contraste(JETONS.texte, JETONS.retard) < 4.5);
    assert.equal(contraste("#FFFFFF", "#000000"), 21);
  });

  test("la couleur de la barre du navigateur (themeColor) : une seule constante, égale au jeton fond", () => {
    const charte = lire(join(SRC, "lib", "application", "charte.ts"));
    assert.equal(charte.match(/export const FOND_HEX = "(#[0-9A-F]{6})";/)?.[1], JETONS.fond);
    for (const f of ["lib/application/installation.ts", "app/depot/[jeton]/page.tsx"]) {
      const source = lire(join(SRC, f));
      assert.match(source, /import \{ FOND_HEX \} from "(\.\/charte|@\/lib\/application\/charte)";/, f);
      assert.match(source, /themeColor: FOND_HEX/, f);
    }
    const autres = PERIMETRE.filter((f) => /themeColor:\s*"#/.test(lire(f))).map(nom);
    assert.deepEqual(autres, []);
  });
});

describe(`src/app et src/components (${PERIMETRE.length} sources) : zéro valeur hexadécimale hors exceptions`, () => {
  test("aucune classe -[#…] ni chaîne #XXXXXX ; les exceptions sont exactes (ni plus, ni moins)", () => {
    assert.ok(PERIMETRE.length > 200, `${PERIMETRE.length} sources`);
    const constats: string[] = [];
    for (const f of PERIMETRE) {
      const n = nom(f);
      if (HORS_CHARTE.has(n)) continue;
      const trouves = (lire(f).match(/#[0-9a-fA-F]{6}\b/g) ?? []).map((h) => h.toUpperCase()).sort();
      const attendus = [...(EXCEPTIONS[n] ?? [])].sort();
      if (trouves.join(" ") !== attendus.join(" ")) constats.push(`${n} : ${trouves.join(" ") || "(rien)"} ≠ ${attendus.join(" ") || "(rien)"}`);
    }
    assert.deepEqual(constats, []);
    for (const n of Object.keys(EXCEPTIONS)) assert.ok(existsSync(join(SRC, n)), `exception orpheline : ${n}`);
  });

  test("le codemod n'a plus rien à remplacer, et il remplace bien ce qu'il doit", () => {
    for (const f of PERIMETRE) {
      if (HORS_CHARTE.has(nom(f))) continue;
      assert.equal(reecrire(lire(f)).remplacements, 0, nom(f));
    }
    const { texte, remplacements, horsTable } = reecrire('className="text-[#9CA3AF] hover:bg-[#22262D]/60 border-t-[#2A2D34] text-[#16181D] bg-[#16181D] bg-[#ABCDEF]"');
    assert.equal(texte, 'className="text-texte-3 hover:bg-surface-2/60 border-t-trait text-texte-inverse bg-fond bg-[#ABCDEF]"');
    assert.equal(remplacements, 5);
    assert.deepEqual([...horsTable], [["ABCDEF", 1]]);
    // Les styles en ligne et les SVG ne sont pas touchés par le codemod : ils passent par JETONS / var(--color-…).
    assert.equal(reecrire('style={{ color: "#9CA3AF" }} stroke="#2A2D34"').remplacements, 0);
  });

  test("le gris d'aide d'avant (#6B7280, 3,67:1 sur le fond) n'existe plus nulle part, PDF et mails compris", () => {
    assert.deepEqual(PERIMETRE.filter((f) => /6B7280/i.test(lire(f))).map(nom), []);
  });

  test("jamais texte sur action ni texte sur retard (3,05 et 3,39) : action-texte sur le vert, texte-inverse sur le rouge", () => {
    // Par chaîne de classes (entre guillemets), pas par ligne : une ligne porte souvent deux branches d'un ternaire.
    const TEXTE = /(?<![\w-])text-texte(?![\w-])/;
    const FOND = /(?<![\w-])bg-(action|retard)(?![\w/-])/;
    const constats: string[] = [];
    for (const f of PERIMETRE) {
      lire(f).split("\n").forEach((ligne, i) => {
        for (const segment of ligne.split(/["'`]/)) if (TEXTE.test(segment) && FOND.test(segment)) constats.push(`${nom(f)}:${i + 1}`);
      });
    }
    assert.deepEqual(constats, []);
  });

  test("les constantes de couleur des composants sont des jetons : étapes, hors parcours, tons, gris absent", () => {
    const ui = lire(join(SRC, "components", "pilotage", "ui.tsx"));
    assert.match(ui, /export const JETONS = \{/);
    assert.match(ui, /export function teinte\(couleur: string, pourcent: number\): string/);
    for (let n = 1; n <= 9; n++) assert.ok(ui.includes(`"var(--color-etape-${n})"`), `etape-${n}`);
    assert.match(ui, /PERDU: JETONS\["retard-texte"\]/);
    assert.match(ui, /EN_PAUSE: GRIS_HORS_PARCOURS/);
    assert.match(ui, /export const GRIS_HORS_PARCOURS = JETONS\["texte-3"\]/);
    assert.doesNotMatch(ui, /\$\{couleur\}[0-9A-F]{2}/, "plus de suffixe d'opacité hexadécimal");
    const format = lire(join(SRC, "components", "pilotage", "analytique", "format.ts"));
    assert.match(format, /COULEURS_TON = \{ favorable: "var\(--color-action-clair\)", defavorable: "var\(--color-attention-texte\)", neutre: "var\(--color-texte-3\)" \}/);
    assert.match(format, /GRIS_ABSENT = "var\(--color-texte-3\)"/);
  });

  test("arbitrages : erreurs de formulaire et bouton danger en ambre ; le rouge reste à l'argent en retard et au perdu", () => {
    const ui = lire(join(SRC, "components", "pilotage", "ui.tsx"));
    assert.match(ui, /danger: "border-\[0\.5px\] border-attention\/30 bg-attention\/10 text-attention-texte hover:bg-attention\/20"/);
    assert.match(ui, /aria-invalid:border-attention\/60/);
    const aide = ui.slice(ui.indexOf("function Aide("), ui.indexOf("type ProprietesChamp"));
    assert.match(aide, /text-attention-texte">\{erreur\}/);
    assert.doesNotMatch(aide, /retard/);
    const puces = ui.slice(ui.indexOf("export function Puces<"), ui.indexOf("export function EnTetePage"));
    assert.doesNotMatch(puces, /retard/);
  });
});

describe(`src/components/v2 (${V2.length} sources) : tailles et capitales de la v2`, () => {
  const INTERDITS: [string, RegExp][] = [
    ["capitales espacées (tracking-wide uppercase) : des phrases, pas des surtitres", /tracking-wide uppercase|uppercase tracking-wide/],
    ["taille sous 14 px", /text-\[(?:1[0-3](?:\.\d+)?|[0-9](?:\.\d+)?)px\]/],
  ];
  test("aucune capitale espacée, aucune taille de texte sous 14 px", () => {
    const constats: string[] = [];
    for (const f of V2) {
      lire(f).split("\n").forEach((ligne, i) => {
        for (const [libelle, motif] of INTERDITS) if (motif.test(ligne)) constats.push(`${nom(f)}:${i + 1} ${libelle}`);
      });
    }
    assert.deepEqual(constats, []);
    // Les motifs attrapent bien les formes de la v1.
    assert.match('className="text-[12px] tracking-wide uppercase"', INTERDITS[0][1]);
    assert.match("text-[12.5px]", INTERDITS[1][1]);
    assert.doesNotMatch("text-[14px] text-[16px]", INTERDITS[1][1]);
  });
});
