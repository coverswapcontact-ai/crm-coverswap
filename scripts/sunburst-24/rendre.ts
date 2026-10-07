// Mission 24 — UN rendu gpt-image-2.5-sunburst, qualité medium, AVEC masque, par le pipeline du simulateur (cadrage
// `cadrerPourGeneration`, références et couleur mesurée `referenceMoteur`, planche étiquetée `plancheDesZones`, prompt V2
// `construirePrompt`), une variante à la fois (`variantes.ts`). Lancé à la main, jamais par l'application ; n'écrit
// RIEN en base (aucune ligne GenerationImage : la mission 23 lit son plafond là) ; registre hors dépôt (`journal.json`).
//
//   node --import tsx scripts/sunburst-24/rendre.ts --photo p06 --ref RM30 --phase exploration [--variante base] [--estimer] [--cle-depuis ../coverswap/.env.local]
//
// Coût : jetons facturés relus dans la réponse (`usage`), prix de `prix.ts`. Avant chaque appel : cumul + estimation
// (le plus cher déjà payé, 0,08 $ au moins) ≤ enveloppe cumulée de la phase (exploration 25 %, correction 75 %,
// validation 95 % de 2,30 $ ; la réserve seulement avec --reserve) et ≤ 2,30 $, sinon rien n'est appelé. Clé
// OPENAI_API_KEY de l'environnement, jamais affichée.
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { definirCatalogueEssai, type Reference } from "../../src/lib/simulateur/catalogue";
import { construirePrompt, etiquettesPour, formatDepuisDimensions } from "../../src/lib/simulateur/moteur";
import type { ZoneMoteur } from "../../src/lib/simulateur/moteur/types";
import type { IdZone } from "../../src/lib/simulateur/zones";
import { coutEnDollars, type Usage } from "../../src/lib/simulations/prix";
import { plancheDesZones, referenceMoteur } from "../../src/lib/simulations/pipeline";
import { BUDGET, CADRE, ENVELOPPES, JOURNAL, MASQUES, MODELE, RACINE, RENDUS, type Phase } from "./commun";
import { lireMasques, masqueBinaire, masqueTroue } from "./masques";
import { scorer, type Score } from "./score";
import { variante as lireVariante } from "./variantes";

export type Entree = {
  n: number;
  le: string;
  phase: Phase;
  photo: string;
  ref: string;
  variante: string;
  fichier: string | null;
  usage: Usage | null;
  cout: number;
  cumul: number;
  dureeMs: number;
  erreur: string | null;
  score: Score | null;
  /** Le jugement à l'œil, ajouté après lecture de l'image. */
  regard?: string;
};

export const lireJournal = (): Entree[] => (fs.existsSync(JOURNAL) ? JSON.parse(fs.readFileSync(JOURNAL, "utf8")) : []);
const ecrireJournal = (j: Entree[]) => fs.writeFileSync(JOURNAL, JSON.stringify(j, null, 1));
const dollars = (x: number) => `${x.toFixed(4)} $`;

/** Plafond cumulé autorisé pour une phase (les enveloppes non dépensées des phases précédentes restent disponibles). */
export function plafondPhase(phase: Phase, reserve: boolean): number {
  const ordre: Phase[] = ["exploration", "correction", "validation"];
  const jusque = ordre.slice(0, ordre.indexOf(phase) + 1).reduce((s, p) => s + ENVELOPPES[p], 0);
  return Math.min(BUDGET, jusque + (reserve ? ENVELOPPES.reserve : 0));
}

function lireArgs(argv: string[]) {
  const o: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) throw new Error(`Argument inattendu : ${a}`);
    const v = argv[i + 1];
    if (v === undefined || v.startsWith("--")) o[a.slice(2)] = true;
    else {
      o[a.slice(2)] = v;
      i++;
    }
  }
  return o;
}

async function main() {
  const a = lireArgs(process.argv.slice(2));
  const photo = String(a.photo ?? "");
  const refId = String(a.ref ?? "");
  const phase = String(a.phase ?? "") as Phase;
  const nomVariante = String(a.variante ?? "base");
  if (!["exploration", "correction", "validation"].includes(phase)) throw new Error("--phase exploration | correction | validation");
  const variante = lireVariante(nomVariante);
  const masques = lireMasques();
  const defMasque = masques[photo];
  if (!defMasque) throw new Error(`Pas de masque pour ${photo}.`);
  const catalogue = JSON.parse(fs.readFileSync(path.join(RACINE, "uploads/simulateur/catalogue.json"), "utf8")) as Reference[];
  definirCatalogueEssai(catalogue);
  const ref = catalogue.find((r) => r.id === refId);
  if (!ref) throw new Error(`Référence inconnue : ${refId}`);

  // 1) Le pipeline : photo cadrée, référence décrite, planche, prompt V2 (sans analyse vision), puis la variante.
  const cadre = fs.readFileSync(path.join(CADRE, `${photo}.png`));
  const meta = await sharp(cadre).metadata();
  const taille = `${meta.width}x${meta.height}`;
  const reference = await referenceMoteur(refId);
  const zones: ZoneMoteur[] = etiquettesPour([{ zone: defMasque.zone as IdZone, reference }]);
  const planche = await plancheDesZones(zones, "CoverSwap · Cuisine");
  const base = construirePrompt({ piece: "cuisine", zones, analyse: null, format: formatDepuisDimensions(meta.width!, meta.height!), mode: "api-planche", defautsPrecedents: [] });
  const appliquee = await variante.appliquer({ prompt: base.texte, blocs: base.blocs, reference, ref, zone: defMasque.zone as IdZone, photo, masque: defMasque, planche });
  const masquePng = appliquee.masque ?? fs.readFileSync(path.join(MASQUES, `${photo}.png`));

  // 2) Le budget, relu avant l'appel.
  const journal = lireJournal();
  const cumul = journal.reduce((s, e) => s + e.cout, 0);
  const plusCher = Math.max(0, ...journal.map((e) => e.cout));
  const estime = Math.max(0.08, plusCher);
  const plafond = plafondPhase(phase, a.reserve === true);
  console.log(`${photo} × ${refId} (${ref.nom}) — variante « ${nomVariante} » — ${phase}. Cumul ${dollars(cumul)} ; estimé ${dollars(estime)} ; plafond de la phase ${dollars(plafond)}.`);
  if (a.estimer) {
    fs.writeFileSync(path.join(RACINE, "dernier-prompt.txt"), appliquee.prompt);
    console.log(`(estimation seule : prompt écrit dans dernier-prompt.txt, ${appliquee.prompt.length} caractères)`);
    return;
  }
  if (cumul + estime > plafond || cumul + estime > BUDGET) {
    console.log(`ARRÊT : ${dollars(cumul)} + ${dollars(estime)} dépasserait ${dollars(Math.min(plafond, BUDGET))}. Rien n'est appelé.`);
    process.exitCode = 2;
    return;
  }
  // La clé : celle de l'environnement, sinon la seule ligne OPENAI_API_KEY du fichier donné par --cle-depuis (l'env local
  // du site, mission 16) ; jamais affichée.
  let cle = process.env.OPENAI_API_KEY;
  if (!cle && typeof a["cle-depuis"] === "string") cle = /^OPENAI_API_KEY=["']?([^"'\s]+)/m.exec(fs.readFileSync(a["cle-depuis"], "utf8"))?.[1];
  if (!cle) throw new Error("OPENAI_API_KEY absente : rien n'est lancé.");

  // 3) L'appel /images/edits : photo, planche, masque (appliqué à la première image).
  const formulaire = new FormData();
  formulaire.append("model", MODELE);
  formulaire.append("prompt", appliquee.prompt);
  formulaire.append("size", taille);
  formulaire.append("quality", "medium");
  formulaire.append("output_format", "jpeg");
  formulaire.append("output_compression", "90");
  formulaire.append("image[]", new Blob([new Uint8Array(cadre)], { type: "image/png" }), "room.png");
  formulaire.append("image[]", new Blob([new Uint8Array(appliquee.planche)], { type: "image/png" }), "board.png");
  formulaire.append("mask", new Blob([new Uint8Array(masquePng)], { type: "image/png" }), "mask.png");
  const debut = Date.now();
  const n = (journal.at(-1)?.n ?? 0) + 1;
  const entree: Entree = { n, le: new Date().toISOString(), phase, photo, ref: refId, variante: nomVariante, fichier: null, usage: null, cout: 0, cumul, dureeMs: 0, erreur: null, score: null };
  let reponse: Response;
  try {
    reponse = await fetch("https://api.openai.com/v1/images/edits", { method: "POST", headers: { Authorization: `Bearer ${cle}` }, body: formulaire, signal: AbortSignal.timeout(240_000) });
  } catch (e) {
    entree.erreur = `réseau : ${e instanceof Error ? e.message : e}`;
    entree.dureeMs = Date.now() - debut;
    ecrireJournal([...journal, entree]);
    console.log(`ÉCHEC ${entree.erreur} — coût inconnu (pas de réponse) ; cumul ${dollars(cumul)}.`);
    return;
  }
  entree.dureeMs = Date.now() - debut;
  const texte = await reponse.text();
  if (!reponse.ok) {
    entree.erreur = `HTTP ${reponse.status} ${texte.slice(0, 300)}`;
    ecrireJournal([...journal, entree]);
    console.log(`ÉCHEC ${entree.erreur} ; cumul ${dollars(cumul)}.`);
    return;
  }
  const donnees = JSON.parse(texte) as { data?: { b64_json?: string }[]; usage?: { input_tokens_details?: { text_tokens?: number; image_tokens?: number }; input_tokens?: number; output_tokens?: number } };
  const d = donnees.usage?.input_tokens_details;
  const usage: Usage = { texte: d?.text_tokens ?? (d ? 0 : (donnees.usage?.input_tokens ?? 0)), image: d?.image_tokens ?? 0, sortie: donnees.usage?.output_tokens ?? 0 };
  entree.usage = usage;
  entree.cout = coutEnDollars(usage, MODELE);
  entree.cumul = Math.round((cumul + entree.cout) * 10_000) / 10_000;
  const b64 = donnees.data?.[0]?.b64_json;
  if (b64) {
    entree.fichier = `${String(n).padStart(3, "0")}-${photo}-${refId}-${nomVariante}.jpg`;
    await sharp(Buffer.from(b64, "base64")).jpeg({ quality: 92 }).toFile(path.join(RENDUS, entree.fichier));
    // Mesure sur le masque troué : poignées, joints et rainures ne sont pas du film.
    const { binaire: data, largeur, hauteur } = await masqueTroue(photo, defMasque);
    const zone = (await masqueBinaire(photo, defMasque)).data;
    const avant = path.join(CADRE, `${photo}.png`);
    entree.score = await scorer(avant, path.join(RENDUS, entree.fichier), data, largeur, hauteur, ref, zone);
  } else entree.erreur = "réponse sans image";
  ecrireJournal([...journal, entree]);
  console.log(`n°${n} : ${dollars(entree.cout)} réels (jetons texte ${usage.texte}, image ${usage.image}, sortie ${usage.sortie}), ${(entree.dureeMs / 1000).toFixed(0)} s. CUMUL ${dollars(entree.cumul)} / ${BUDGET} $.`);
  const sc = entree.score;
  if (sc) console.log(`   score ${sc.total} | ΔE ${sc.couleur.deltaE} (chrom ${sc.couleur.chromatique}) ${sc.couleur.mesure} L${sc.couleur.derive.L} a${sc.couleur.derive.a} b${sc.couleur.derive.b} C${sc.couleur.derive.C} | contours ${sc.fidelite.contoursHors} dérive ${sc.fidelite.deriveHors} | structure −${sc.structure.perte}% | texture ${sc.finition.texture} reflets ${sc.finition.reflets}%`);
  if (entree.fichier) console.log(`fichier : ${path.join(RENDUS, entree.fichier)}`);
}

if (process.argv[1]?.endsWith("rendre.ts")) void main().catch((e) => {
  console.error("[sunburst-24]", e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
