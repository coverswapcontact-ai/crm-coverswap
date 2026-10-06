#!/usr/bin/env node
/**
 * Mission 22 (lot A0a) — les couleurs en dur des classes Tailwind passent aux jetons de `@theme` (src/app/globals.css).
 *
 *   node scripts/jetons-codemod.mjs             réécrit les fichiers (fins de ligne conservées)
 *   node scripts/jetons-codemod.mjs --verifier  compte seulement, ne touche rien (code de sortie 1 s'il reste du travail)
 *
 * Seule la forme crochets est remplacée : `text-[#9CA3AF]` → `text-texte-3`, `hover:bg-[#22262D]/60` → `hover:bg-surface-2/60`.
 * Les variantes (`hover:`, `md:`, `placeholder:`…) précèdent le préfixe, elles restent ; le modificateur d'opacité suit, il
 * reste. Les styles en ligne, les SVG, les chaînes de données et les PDF ne sont pas touchés (pas de crochets) : les lignes
 * hors crochets se traitent à la main (constantes `JETONS` de components/pilotage/ui.tsx, `var(--color-…)`).
 * Toute valeur hors table est signalée sur stderr et laissée telle quelle.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const RACINE = join(fileURLToPath(import.meta.url), "..", "..");
const DOSSIERS = ["src/app", "src/components"];
/** Hors mandat : rendus PDF, mail HTML, consignes des prompts, document PDF (chartes propres à ces supports). */
const HORS_CHARTE = [
  "app/api/pdf/devis/[id]/route.tsx",
  "app/api/pdf/facture/[id]/route.ts",
  "app/api/webhook/route.ts",
  "app/api/simulateur/prompts/[type]/route.ts",
  "lib/pdf/DocumentPdf.tsx",
];

/** Hex (majuscules) → jeton ; une entrée « préfixe:HEX » prime pour un préfixe donné (le fond devient un texte inversé). */
export const TABLE = {
  "9CA3AF": "texte-3",
  "2A2D34": "trait",
  F2F3F5: "texte",
  "6B7280": "texte-3",
  "5DCAA5": "action-clair",
  D1D5DB: "texte-2",
  F5B454: "attention-texte",
  "1D9E75": "action",
  "1C1F25": "surface",
  "8B919C": "texte-3",
  "16181D": "fond",
  "text:16181D": "texte-inverse",
  "3A3E47": "trait-2",
  "22262D": "surface-2",
  F87171: "retard-texte",
  EF9F27: "attention",
  "112B22": "action-fond",
  EF4444: "retard",
  E5E7EB: "texte",
  "06140F": "action-texte",
  "60A5FA": "info",
  "0B1612": "action-texte",
  "93C5FD": "info-texte",
  "272B33": "surface-2",
  "2A2F37": "surface-2",
  "23272F": "surface-2",
  "20232A": "surface",
  "23262D": "surface",
  "191B20": "surface",
  "0F1115": "fond",
  "7AA7FF": "info-texte",
  B4BAC4: "texte-2",
  FCA5A5: "retard-texte",
  F472B6: "info",
  F9A8D4: "info-texte",
  A78BFA: "info",
  C4B5FD: "info-texte",
  BFDBFE: "info-texte",
  C4A5FF: "info-texte",
  "4B5563": "texte-3",
  "8FE0C3": "action-clair",
  D1FAE5: "action-clair",
  "9FD9C2": "action-clair",
  C9EFE1: "action-clair",
  "5E8F7B": "action-clair",
  "6FD6B3": "action-clair",
  "178A66": "action",
  "0F1A16": "action-texte",
  FCD9A0: "attention-texte",
  C9A46A: "attention-texte",
  "0B0D10": "texte-inverse",
  "1A1206": "texte-inverse",
  "2F3B36": "action/40",
  "24463A": "action/40",
  "5B3A1E": "attention/40",
  "3A2A10": "attention/15",
  "2B2414": "attention/10",
  "15201C": "action-fond",
  "143528": "action-fond",
  "1A2420": "action-fond",
  "15251F": "action-fond",
  "4B5160": "trait-2",
};

const PREFIXES = "text|bg|border(?:-[trblxy])?|ring|divide|accent|decoration|fill|stroke|outline|shadow|from|to|via";
const MOTIF = new RegExp(`(?<=(?:^|[^\\w-])(?:[\\w-]+:)*)(${PREFIXES})-\\[#([0-9A-Fa-f]{6})\\](/\\d+)?`, "g");

function fichiers(dossier, sortie = []) {
  for (const nom of readdirSync(dossier)) {
    const chemin = join(dossier, nom);
    if (statSync(chemin).isDirectory()) fichiers(chemin, sortie);
    else if (/\.tsx?$/.test(nom) && !/\.test\.tsx?$/.test(nom)) sortie.push(chemin);
  }
  return sortie;
}

const relatif = (f) => relative(join(RACINE, "src"), f).split(sep).join("/");

/** Réécrit un contenu ; renvoie le texte, le nombre de remplacements et les valeurs hors table rencontrées. */
export function reecrire(source) {
  let remplacements = 0;
  const horsTable = new Map();
  const texte = source.replace(MOTIF, (tout, prefixe, hex, opacite = "") => {
    const cle = hex.toUpperCase();
    const famille = prefixe.split("-")[0];
    const jeton = TABLE[`${famille}:${cle}`] ?? TABLE[cle];
    if (!jeton) {
      horsTable.set(cle, (horsTable.get(cle) ?? 0) + 1);
      return tout;
    }
    if (jeton.includes("/") && opacite) {
      horsTable.set(`${cle}${opacite}`, (horsTable.get(`${cle}${opacite}`) ?? 0) + 1);
      return tout;
    }
    remplacements += 1;
    return `${prefixe}-${jeton}${opacite}`;
  });
  return { texte, remplacements, horsTable };
}

function principal() {
  const verifier = process.argv.includes("--verifier");
  let total = 0;
  let touches = 0;
  const signalements = [];
  for (const dossier of DOSSIERS) {
    for (const f of fichiers(join(RACINE, dossier))) {
      const nom = relatif(f);
      if (HORS_CHARTE.includes(nom)) continue;
      const source = readFileSync(f, "utf8");
      const { texte, remplacements, horsTable } = reecrire(source);
      for (const [hex, n] of horsTable) signalements.push(`${nom} : #${hex} ×${n} (hors table, laissé)`);
      if (remplacements === 0) continue;
      total += remplacements;
      touches += 1;
      if (!verifier) writeFileSync(f, texte);
    }
  }
  for (const ligne of signalements) console.error(ligne);
  console.log(`${verifier ? "À remplacer" : "Remplacés"} : ${total} classe(s) dans ${touches} fichier(s) ; ${signalements.length} signalement(s).`);
  if (verifier && total > 0) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) principal();
