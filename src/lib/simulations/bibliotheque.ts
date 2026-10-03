import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { ESSAIS_MAX, lireListeImages, type ImageSite } from "./ambiances";
import { ecartContours } from "./planches";
import { deltaE, hexVersRgb, mesurerImage, plusProche, rgbVersHex, type Zone } from "./teintes";
import { lireCatalogue, type Revetement } from "./vignettes";

/**
 * La bibliothèque de la série 2 (01/10/2026) — `scripts/bibliotheque-serie-2.ts`, sans aucun appel payant, à partir des
 * essais écrits par `scripts/generer-ambiances.ts` dans `~/coverswap-photos/serie-2/<sous-série>/` :
 *  - pour chaque pièce du quotidien : l'avant retenu (choisi à l'œil, `choix`), puis chaque après, ses essais
 *    contrôlés au CALAGE (contours superposés à l'avant, `ecartContours` ; un essai où autre chose que les surfaces
 *    citées a bougé est rejeté : seuil, et rejets vus à l'œil) et aux TEINTES (même mesure qu'en mission 19 : couleur
 *    médiane de zones bien éclairées après balance des blancs sur un blanc de la scène, ΔE 2000 contre le hex du
 *    catalogue, seuil 12, sans recalage) ; au-dessus du seuil, la surface est RÉÉTIQUETÉE vers la référence la plus
 *    proche de la même famille, et si elle dépasse aussi le seuil, « teinte non garantie » ; l'essai retenu est celui
 *    qui garde le calage, puis le moins de surfaces non garanties, puis le moins de réétiquetages, puis le plus petit
 *    pire ΔE ;
 *  - les ambiances passent la même mesure de teintes ; les photos utiles et les pictos : l'essai choisi à l'œil ;
 *  - sorties : `bibliotheque.json` (une ligne par image) et les planches (`planches/`).
 * Les zones de mesure (en % de l'image, posées sur l'avant : les après sont calés dessus) et les choix sont dans
 * `scripts/zones-serie-2.json`.
 */

const zone = z.tuple([z.number().min(0).max(100), z.number().min(0).max(100), z.number().gt(0).max(100), z.number().gt(0).max(100)]);
const blanc = z.object({ objet: z.string().min(1), zone, exposition: z.boolean().optional() }).strict();
const schemaZones = z
  .object({
    seuil_delta_e: z.number().positive(),
    seuil_calage: z.number().positive(),
    blanc_cible: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
    /** L'essai retenu de chaque image choisie à l'œil (avants, photos utiles, ambiances, pictos) : `nom` → n. */
    choix: z.record(z.string(), z.number().int().min(1)),
    /** Essais rejetés à l'œil (calage, défaut visible) : `<nom>-<n>` → la raison. */
    rejets: z.record(z.string(), z.string()).default({}),
    /** Essais au-dessus du seuil de calage, superposés à l'œil (fondu à 50 %) et sans rien de déplacé : `<nom>-<n>` → ce qui a été vu. */
    calages_vus: z.record(z.string(), z.string()).default({}),
    /** Par pièce (nom de l'avant) ou par ambiance (son nom) : le blanc de la scène et les zones de chaque surface. */
    mesures: z.record(z.string(), z.object({ blanc, surfaces: z.record(z.string(), z.array(zone).min(1)) }).strict()),
  })
  .strict();
export type ZonesSerie = z.infer<typeof schemaZones>;
export const lireZones = (texte: string): ZonesSerie => schemaZones.parse(JSON.parse(texte));

export type SurfaceBibliotheque = {
  /** La référence demandée au modèle. */
  prevue: string;
  /** La référence affichée : la prévue, ou la plus proche de la même famille si la prévue dépasse le seuil. */
  ref: string;
  nom: string;
  deltaE: number;
  /** ΔE de la référence affichée (= deltaE si elle n'a pas changé). */
  deltaEAffichee: number;
  mesure: string;
  statut: "fidele" | "reetiquetee" | "teinte non garantie";
};

export type EssaiMesure = { essai: number; fichier: string; ecartContours: number | null; rejet: string | null; surfaces: Record<string, SurfaceBibliotheque> };

export type LigneBibliotheque = {
  nom: string;
  serie: string;
  piece: string | null;
  fichier: string | null;
  format: string;
  essai: number | null;
  avant: string | null;
  composition: Record<string, SurfaceBibliotheque> | null;
  usages: string[];
  etiquette: string;
  statut: "retenue" | "rejetée" | "teinte non garantie";
  /** Les essais mesurés (après, ambiances) : pourquoi celui-ci. */
  essais?: { essai: number; ecartContours: number | null; rejet: string | null; pireDeltaE: number | null; nonGaranties: number; reetiquetees: number }[];
  note?: string;
};

const arrondi = (n: number) => Math.round(n * 10) / 10;

/** Mesure les surfaces d'une image (composition surface → référence) et décide de l'étiquette de chacune. */
export async function mesurerComposition(fichier: string, composition: Record<string, string>, mesure: ZonesSerie["mesures"][string], catalogue: Map<string, Revetement>, seuil: number, blancCible: string): Promise<Record<string, SurfaceBibliotheque>> {
  const cles = Object.keys(composition);
  for (const c of cles) if (!mesure.surfaces[c]) throw new Error(`${path.basename(fichier)} : pas de zone pour la surface « ${c} ».`);
  const m = await mesurerImage(fichier, { blanc: mesure.blanc, surfaces: cles.map((c) => ({ surface: c, en: c, ref: composition[c], zones: mesure.surfaces[c] as Zone[] })) }, hexVersRgb(blancCible));
  const resultat: Record<string, SurfaceBibliotheque> = {};
  const tout = [...catalogue.values()];
  cles.forEach((c, i) => {
    const prevue = catalogue.get(composition[c]);
    if (!prevue) throw new Error(`Référence ${composition[c]} absente du catalogue.`);
    const couleur = m.surfaces[i].corrigee;
    const d = arrondi(deltaE(couleur, hexVersRgb(prevue.hex)));
    if (d <= seuil) {
      resultat[c] = { prevue: prevue.id, ref: prevue.id, nom: prevue.nom, deltaE: d, deltaEAffichee: d, mesure: rgbVersHex(couleur), statut: "fidele" };
      return;
    }
    const proche = plusProche(couleur, tout, (r) => r.famille === prevue.famille);
    if (proche && proche.deltaE <= seuil) resultat[c] = { prevue: prevue.id, ref: proche.ref.id, nom: proche.ref.nom, deltaE: d, deltaEAffichee: arrondi(proche.deltaE), mesure: rgbVersHex(couleur), statut: "reetiquetee" };
    else resultat[c] = { prevue: prevue.id, ref: prevue.id, nom: prevue.nom, deltaE: d, deltaEAffichee: d, mesure: rgbVersHex(couleur), statut: "teinte non garantie" };
  });
  return resultat;
}

const resumer = (e: EssaiMesure) => {
  const s = Object.values(e.surfaces);
  return { essai: e.essai, ecartContours: e.ecartContours, rejet: e.rejet, pireDeltaE: s.length ? Math.max(...s.map((x) => x.deltaEAffichee)) : null, nonGaranties: s.filter((x) => x.statut === "teinte non garantie").length, reetiquetees: s.filter((x) => x.statut === "reetiquetee").length };
};

/** L'essai retenu : sans rejet, puis le moins de surfaces non garanties, de réétiquetages, puis le plus petit pire ΔE. */
export function meilleurEssai(essais: EssaiMesure[]): EssaiMesure | null {
  const valides = essais.filter((e) => !e.rejet);
  const cle = (e: EssaiMesure) => resumer(e);
  return valides.sort((a, b) => cle(a).nonGaranties - cle(b).nonGaranties || cle(a).reetiquetees - cle(b).reetiquetees || (cle(a).pireDeltaE ?? 0) - (cle(b).pireDeltaE ?? 0) || (a.ecartContours ?? 0) - (b.ecartContours ?? 0))[0] ?? null;
}

const fichierEssai = (racine: string, image: ImageSite, n: number) => {
  const f = path.join(racine, image.serie ?? "", `${image.nom}-${n}.png`);
  return existsSync(f) ? f : null;
};

/** Construit la bibliothèque (sans appel payant). */
export async function construireBibliotheque(options: { liste: string; zones: string; catalogue: string; racine: string; journal?: (l: string) => void }): Promise<LigneBibliotheque[]> {
  const journal = options.journal ?? (() => undefined);
  const liste = lireListeImages(await fs.readFile(options.liste, "utf8"));
  const zones = lireZones(await fs.readFile(options.zones, "utf8"));
  const catalogue = new Map(lireCatalogue(await fs.readFile(options.catalogue, "utf8")).map((r) => [r.id, r]));
  const parNom = new Map(liste.images.map((i) => [i.nom, i]));
  const lignes: LigneBibliotheque[] = [];
  const base = (i: ImageSite) => ({ nom: i.nom, serie: i.serie ?? "", piece: i.piece ?? null, format: i.format, usages: i.usages ?? [], etiquette: i.etiquette });

  for (const image of liste.images) {
    if (image.mode === "edition") {
      // Un après : ses essais au calage et aux teintes, contre l'avant retenu.
      const source = image.source ? parNom.get(image.source) : undefined;
      const n = image.source ? zones.choix[image.source] : undefined;
      const avant = source && n ? fichierEssai(options.racine, source, n) : null;
      const mesure = image.source ? zones.mesures[image.source] : undefined;
      if (!avant || !mesure) {
        lignes.push({ ...base(image), fichier: null, essai: null, avant: avant ? path.basename(avant) : null, composition: null, statut: "rejetée", note: !avant ? "avant non retenu ou absent" : "zones de mesure absentes" });
        continue;
      }
      const essais: EssaiMesure[] = [];
      // Les essais de la liste, plus ceux ajoutés ensuite (retouches : essais 3, 4…).
      for (let k = 1; k <= Math.max(image.essais ?? liste.essais, ESSAIS_MAX); k++) {
        const fichier = fichierEssai(options.racine, image, k);
        if (!fichier) continue;
        const ecart = arrondi(await ecartContours(avant, fichier));
        const rejetOeil = zones.rejets[`${image.nom}-${k}`] ?? null;
        const vu = zones.calages_vus[`${image.nom}-${k}`];
        const rejet = rejetOeil ?? (ecart > zones.seuil_calage && !vu ? `calage : écart des contours ${ecart} > ${zones.seuil_calage}` : null);
        const surfaces = await mesurerComposition(fichier, image.composition ?? {}, mesure, catalogue, zones.seuil_delta_e, zones.blanc_cible);
        essais.push({ essai: k, fichier, ecartContours: ecart, rejet, surfaces });
      }
      const retenu = meilleurEssai(essais);
      const statut = !retenu ? "rejetée" : Object.values(retenu.surfaces).some((s) => s.statut === "teinte non garantie") ? "teinte non garantie" : "retenue";
      lignes.push({ ...base(image), fichier: retenu?.fichier ?? null, essai: retenu?.essai ?? null, avant: path.basename(avant), composition: retenu?.surfaces ?? null, statut, essais: essais.map(resumer) });
      journal(`${image.nom} : ${retenu ? `essai ${retenu.essai}, ${statut}` : "rejetée (aucun essai calé)"} — ${essais.map((e) => `${e.essai} : contours ${e.ecartContours}${e.rejet ? " REJET" : ""}, ${Object.entries(e.surfaces).map(([c, s]) => `${c} ${s.prevue}${s.ref !== s.prevue ? "→" + s.ref : ""} ΔE ${s.deltaE}`).join(", ")}`).join(" | ")}`);
      continue;
    }
    // Une génération : l'essai choisi à l'œil ; une ambiance passe aussi la mesure des teintes.
    const n = zones.choix[image.nom];
    const fichier = n ? fichierEssai(options.racine, image, n) : null;
    if (!fichier) {
      lignes.push({ ...base(image), fichier: null, essai: null, avant: null, composition: null, statut: "rejetée", note: n ? `essai ${n} absent` : "aucun essai retenu" });
      continue;
    }
    const mesure = zones.mesures[image.nom];
    let composition: Record<string, SurfaceBibliotheque> | null = null;
    if (image.composition && mesure) composition = await mesurerComposition(fichier, image.composition, mesure, catalogue, zones.seuil_delta_e, zones.blanc_cible);
    const statut = composition && Object.values(composition).some((s) => s.statut === "teinte non garantie") ? "teinte non garantie" : "retenue";
    lignes.push({ ...base(image), fichier, essai: n, avant: null, composition, statut });
    if (composition) journal(`${image.nom} : essai ${n}, ${statut} — ${Object.entries(composition).map(([c, s]) => `${c} ${s.prevue}${s.ref !== s.prevue ? "→" + s.ref : ""} ΔE ${s.deltaE}`).join(", ")}`);
  }
  return lignes;
}

/* ── Les planches ── */

const sharpModule = async () => (await import("sharp")).default;
const echapper = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const FOND = { r: 34, g: 34, b: 34 };
const H_IMAGE = 420;
const MARGE = 20;
const virgule = (n: number) => String(n).replace(".", ",");

/** Une tuile : l'image à hauteur fixe (sur damier si transparente), un titre au-dessus, des lignes de texte dessous. */
async function tuile(fichier: string, titre: string, lignes: string[], options: { damier?: boolean; hauteur?: number } = {}): Promise<{ octets: Buffer; largeur: number; hauteur: number }> {
  const sharp = await sharpModule();
  const h = options.hauteur ?? H_IMAGE;
  const meta = await sharp(fichier).metadata();
  const l = Math.round(((meta.width ?? 1) * h) / (meta.height ?? 1));
  const largeur = Math.max(l, 300);
  const hauteur = 34 + h + 12 + lignes.length * 20 + 8;
  const image = await sharp(fichier).resize(l, h).png().toBuffer();
  const couches: { input: Buffer; left: number; top: number }[] = [];
  if (options.damier) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${l}" height="${h}"><defs><pattern id="d" width="32" height="32" patternUnits="userSpaceOnUse"><rect width="32" height="32" fill="#fff"/><rect width="16" height="16" fill="#e4e4e4"/><rect x="16" y="16" width="16" height="16" fill="#e4e4e4"/></pattern></defs><rect width="100%" height="100%" fill="url(#d)"/></svg>`;
    couches.push({ input: Buffer.from(svg), left: 0, top: 34 });
  }
  couches.push({ input: image, left: 0, top: 34 });
  const texte = `<svg xmlns="http://www.w3.org/2000/svg" width="${largeur}" height="${hauteur}"><text x="0" y="22" font-family="Arial" font-weight="700" font-size="17" fill="#fff">${echapper(titre)}</text>${lignes.map((t, i) => `<text x="0" y="${34 + h + 26 + i * 20}" font-family="Arial" font-size="14" fill="${/non garantie|REJET|rejetée/.test(t) ? "#FF7B7B" : /→/.test(t) ? "#FFD27B" : "#DDDDDD"}">${echapper(t)}</text>`).join("")}</svg>`;
  couches.push({ input: Buffer.from(texte), left: 0, top: 0 });
  const octets = await sharp({ create: { width: largeur, height: hauteur, channels: 3, background: FOND } }).composite(couches).png().toBuffer();
  return { octets, largeur, hauteur };
}

async function assembler(tuiles: { octets: Buffer; largeur: number; hauteur: number }[], fichier: string, colonnes = tuiles.length): Promise<void> {
  const sharp = await sharpModule();
  if (tuiles.length === 0) return;
  const rangs: (typeof tuiles)[] = [];
  for (let i = 0; i < tuiles.length; i += colonnes) rangs.push(tuiles.slice(i, i + colonnes));
  const largeur = Math.max(...rangs.map((r) => r.reduce((s, t) => s + t.largeur + MARGE, MARGE)));
  const hauteurs = rangs.map((r) => Math.max(...r.map((t) => t.hauteur)));
  const couches: { input: Buffer; left: number; top: number }[] = [];
  let y = MARGE;
  rangs.forEach((r, i) => {
    let x = MARGE;
    for (const t of r) {
      couches.push({ input: t.octets, left: x, top: y });
      x += t.largeur + MARGE;
    }
    y += hauteurs[i] + MARGE;
  });
  await fs.mkdir(path.dirname(fichier), { recursive: true });
  await sharp({ create: { width: largeur, height: y, channels: 3, background: FOND } }).composite(couches).jpeg({ quality: 84 }).toFile(fichier);
}

const lignesComposition = (composition: Record<string, SurfaceBibliotheque> | null) =>
  Object.entries(composition ?? {}).map(([c, s]) => (s.ref !== s.prevue ? `${c} : ${s.prevue} → ${s.ref} ${s.nom} (ΔE ${virgule(s.deltaE)} → ${virgule(s.deltaEAffichee)})` : `${c} : ${s.ref} ${s.nom}, ΔE ${virgule(s.deltaE)}${s.statut === "teinte non garantie" ? " — teinte non garantie" : ""}`));

/** Une planche par pièce du quotidien : l'avant retenu, puis chaque après (essai retenu), ses références et ses ΔE. */
export async function planchesPieces(lignes: LigneBibliotheque[], liste: ImageSite[], racine: string, dossier: string, choix: Record<string, number>): Promise<string[]> {
  const ecrites: string[] = [];
  for (const avant of liste.filter((i) => i.serie === "quotidien" && i.mode === "generation")) {
    const n = choix[avant.nom];
    const fichierAvant = n ? fichierEssai(racine, avant, n) : null;
    if (!fichierAvant) continue;
    const tuiles = [await tuile(fichierAvant, `${avant.nom.replace(/-avant$/, "")} — avant (essai ${n})`, ["avant retenu"])];
    for (const l of lignes.filter((x) => x.avant === path.basename(fichierAvant))) {
      if (!l.fichier) {
        tuiles.push(await tuile(fichierAvant, `${l.nom.replace(/^.*-apres-/, "après ")} — rejetée`, [l.note ?? "aucun essai calé"], { hauteur: 120 }));
        continue;
      }
      const essais = (l.essais ?? []).map((e) => `essai ${e.essai} : contours ${e.ecartContours === null ? "—" : virgule(e.ecartContours)}${e.rejet ? ` REJET (${e.rejet})` : ""}`);
      tuiles.push(await tuile(l.fichier, `${l.nom.replace(/^.*-apres-/, "après ")} — essai ${l.essai} (${l.statut})`, [...lignesComposition(l.composition), ...essais]));
    }
    const fichier = path.join(dossier, `${avant.nom.replace(/-avant$/, "")}.jpg`);
    await assembler(tuiles, fichier);
    ecrites.push(fichier);
  }
  return ecrites;
}

/** Une planche par sous-série (photos utiles, ambiances, pictos), numérotée ; les pictos à côté des 9 de la série 1. */
export async function plancheSerie(serie: string, lignes: LigneBibliotheque[], fichier: string, options: { damier?: boolean; reference?: { titre: string; fichier: string }[]; colonnes?: number } = {}): Promise<string> {
  const tuiles = [];
  let numero = 0;
  for (const l of lignes.filter((x) => x.serie === serie)) {
    numero += 1;
    if (!l.fichier) continue;
    tuiles.push(await tuile(l.fichier, `${numero}. ${l.nom} (essai ${l.essai})`, [...lignesComposition(l.composition), `${l.etiquette} · ${l.statut}`], { damier: options.damier, hauteur: options.damier ? 260 : 380 }));
  }
  for (const r of options.reference ?? []) tuiles.push(await tuile(r.fichier, r.titre, ["série 1 (référence de style)"], { damier: true, hauteur: 260 }));
  await assembler(tuiles, fichier, options.colonnes ?? 4);
  return fichier;
}
