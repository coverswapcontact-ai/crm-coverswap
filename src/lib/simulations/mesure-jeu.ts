import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import type { ManifesteJeu, MetaJeu } from "@/lib/simulateur/jeu-essai";
import {
  analyserParFamille,
  classeTexture,
  familleTeinte,
  mesurerRendu,
  COTE_TRAVAIL,
  MIN_COMPOSANTE,
  SEUIL_CONTOURS_GLOBAL,
  SEUIL_CONTOURS_HORS_MASQUE,
  SEUIL_DIFFERENCE,
  SEUIL_HORS_DEMANDE,
  SEUIL_TEXTURE,
  type CasAnalyse,
  type LigneAnalyse,
  type MesureRendu,
  type ReferenceMesure,
} from "./mesure-rendu";
import { CATALOGUE_DEFAUT, lireCatalogue, type Revetement } from "./vignettes";

/**
 * Mission 23 (L2a) — la mesure d'un jeu d'essai dézippé (`scripts/mesurer-jeu.ts`, `npm run simulateur:mesurer-jeu`) :
 * le format du zip de L1 (`manifest.json`, puis `<id>/avant.*`, `<id>/rendu.*`, `<id>/meta.json`). Chaque simulation
 * est mesurée par `mesurerRendu` contre les références de ses zones (hex, nom et famille lus dans le catalogue du site,
 * `../coverswap/src/data/revetements.json` par défaut). Sorties HORS DU DÉPÔT (refusé sinon), à côté du jeu :
 * `mesures.json` (par cas, puis l'analyse par famille de teinte) et, avec `--planches`, `planches/<id>.jpg`.
 *
 * L'analyse ne compte que les surfaces trouvées des masques non douteux (un masque douteux mesure n'importe quoi) ;
 * la pièce d'exemple du site est gardée (c'est un vrai rendu du modèle) et marquée dans le cas.
 */

export type OptionsMesureJeu = { dossier: string; sortie: string; planches: boolean; catalogue: string; seuil: number | null };

export function lireArgumentsMesureJeu(argv: string[], depot = process.cwd()): OptionsMesureJeu {
  let dossier: string | null = null;
  const o: Omit<OptionsMesureJeu, "dossier" | "sortie"> & { sortie: string | null } = { sortie: null, planches: false, catalogue: CATALOGUE_DEFAUT(), seuil: null };
  for (let i = 0; i < argv.length; i++) {
    const cle = argv[i];
    const valeur = () => {
      const v = argv[++i];
      if (v === undefined || v.startsWith("--")) throw new Error(`${cle} : valeur manquante.`);
      return v;
    };
    if (cle === "--sortie") o.sortie = path.resolve(valeur());
    else if (cle === "--planches") o.planches = true;
    else if (cle === "--catalogue") o.catalogue = path.resolve(valeur());
    else if (cle === "--seuil") {
      o.seuil = Number(valeur());
      if (!(o.seuil > 0)) throw new Error("--seuil : un ΔE76 positif.");
    } else if (cle.startsWith("--")) throw new Error(`Option inconnue : ${cle}`);
    else if (dossier) throw new Error(`Un seul dossier de jeu (reçu aussi ${cle}).`);
    else dossier = path.resolve(cle);
  }
  if (!dossier) throw new Error("Usage : npm run simulateur:mesurer-jeu -- <dossier-du-jeu-dezippe> [--sortie mesures.json] [--planches]");
  const sortie = o.sortie ?? path.join(path.dirname(dossier), "mesures.json");
  // Les photos de clients et leurs mesures ne vont jamais dans le dépôt.
  const racine = path.resolve(depot) + path.sep;
  for (const [nom, chemin] of [["Le jeu", dossier], ["La sortie", sortie]] as const)
    if ((chemin + path.sep).startsWith(racine)) throw new Error(`${nom} est dans le dépôt (${chemin}) : les photos de clients et leurs mesures restent hors du dépôt (~/coverswap-photos/calibrage/).`);
  return { dossier, ...o, sortie };
}

export type CasMesure = {
  id: string;
  origine: string;
  moteur: string | null;
  modele: string | null;
  scoreControle: number | null;
  exemple: boolean;
  zones: { zone: string; ref: string }[];
  refsInconnues: string[];
  familles: Record<string, string>;
  mesure: Omit<MesureRendu, "detail"> | null;
  erreur: string | null;
  planche: string | null;
};

export type BilanMesureJeu = { sortie: string; cas: CasMesure[]; analyse: LigneAnalyse[]; douteux: number; erreurs: number; planches: number };

const virgule = (n: number | null | undefined) => (n === null || n === undefined ? "—" : String(n).replace(".", ","));
const signe = (n: number) => `${n > 0 ? "+" : ""}${virgule(n)}`;

export async function executerMesureJeu(argv: string[], journal: (ligne: string) => void = console.log): Promise<BilanMesureJeu> {
  const o = lireArgumentsMesureJeu(argv);
  const fichierManifeste = path.join(o.dossier, "manifest.json");
  if (!existsSync(fichierManifeste)) throw new Error(`${fichierManifeste} absent : est-ce bien le zip du jeu d'essai, dézippé ?`);
  const manifeste = JSON.parse(await fs.readFile(fichierManifeste, "utf8")) as Partial<ManifesteJeu>;
  const catalogue = lireCatalogue(await fs.readFile(o.catalogue, "utf8"));
  const parId = new Map(catalogue.map((r) => [r.id, r as Revetement & { categorie?: string }]));
  const ids = (await fs.readdir(o.dossier, { withFileTypes: true })).filter((e) => e.isDirectory() && existsSync(path.join(o.dossier, e.name, "meta.json"))).map((e) => e.name).sort();
  journal(`Jeu ${path.basename(o.dossier)} (format ${manifeste.format ?? "?"}, ${manifeste.nExporte ?? "?"} exportées) : ${ids.length} simulation(s) à mesurer.`);
  const dossierPlanches = path.join(path.dirname(o.sortie), "planches");
  const cas: CasMesure[] = [];
  const pourAnalyse: CasAnalyse[] = [];

  for (const id of ids) {
    const meta = JSON.parse(await fs.readFile(path.join(o.dossier, id, "meta.json"), "utf8")) as MetaJeu;
    const zones = (meta.zones ?? []).map((z) => ({ zone: z.zone, ref: z.ref }));
    const refs: ReferenceMesure[] = [];
    const refsInconnues: string[] = [];
    const familles: Record<string, string> = {};
    for (const ref of [...new Set(zones.map((z) => z.ref))]) {
      const r = parId.get(ref);
      if (!r) {
        refsInconnues.push(ref);
        continue;
      }
      const classe = classeTexture(r);
      refs.push({ ref: r.id, nom: r.nom, hex: r.hex, classe });
      familles[r.id] = familleTeinte(r.hex, classe);
    }
    const c: CasMesure = { id, origine: meta.origine, moteur: meta.moteur ?? null, modele: meta.modele ?? null, scoreControle: meta.scoreControle ?? null, exemple: Boolean(meta.exemple), zones, refsInconnues, familles, mesure: null, erreur: null, planche: null };
    cas.push(c);
    const avant = path.join(o.dossier, id, meta.fichiers?.avant ?? "avant.jpg");
    const rendu = path.join(o.dossier, id, meta.fichiers?.rendu ?? "rendu.jpg");
    try {
      const m = await mesurerRendu(avant, rendu, refs, { seuil: o.seuil ?? undefined, garderMasque: o.planches });
      const { detail, ...sansDetail } = m;
      c.mesure = sansDetail;
      if (o.planches) {
        c.planche = path.join(dossierPlanches, `${id}.jpg`);
        await plancheMesure(avant, rendu, m, `${id} · ${meta.origine} · moteur ${meta.moteur ?? "?"} · ${meta.modele ?? "modèle inconnu"}${meta.exemple ? " · pièce d'exemple" : ""}`, c.planche, detail);
      }
      if (!m.masque.douteux)
        for (const s of m.surfaces) if (s.deltaE !== null && s.derive) pourAnalyse.push({ famille: familleTeinte(s.hex, s.texture.attendue), moteur: meta.moteur ?? "inconnu", modele: meta.modele ?? "inconnu", deltaE: s.deltaE, deltaEChromatique: s.deltaEChromatique ?? undefined, derive: s.derive });
      const resume = m.surfaces.map((s) => `${s.ref} ${s.trouvee ? `ΔE ${virgule(s.deltaE)} (L ${signe(s.derive!.L)}, C ${signe(s.derive!.C)})${s.texture.perdue ? " texture perdue" : ""}` : "non trouvée"}`).join(" ; ");
      journal(`  ${id} : ${resume || "aucune référence connue"}${m.masque.douteux ? ` — MASQUE DOUTEUX : ${m.masque.raisons.join(" ; ")}` : ""} (${m.dureeMs} ms)`);
    } catch (e) {
      c.erreur = e instanceof Error ? e.message : String(e);
      journal(`  ${id} : ERREUR ${c.erreur}`);
    }
  }

  const analyse = analyserParFamille(pourAnalyse);
  const douteux = cas.filter((c) => c.mesure?.masque.douteux).length;
  const erreurs = cas.filter((c) => c.erreur).length;
  await fs.mkdir(path.dirname(o.sortie), { recursive: true });
  await fs.writeFile(
    o.sortie,
    JSON.stringify(
      {
        genereLe: new Date().toISOString(),
        jeu: path.basename(o.dossier),
        seuils: { coteTravail: COTE_TRAVAIL, differenceDeltaE76: o.seuil ?? SEUIL_DIFFERENCE, minComposantePx: MIN_COMPOSANTE, texturePerdue: SEUIL_TEXTURE, horsDemandeDeltaE: SEUIL_HORS_DEMANDE, contoursHorsMasque: SEUIL_CONTOURS_HORS_MASQUE, contoursGlobal: SEUIL_CONTOURS_GLOBAL },
        bilan: { cas: cas.length, douteux, erreurs, surfacesAnalysees: pourAnalyse.length },
        analyse,
        cas,
      },
      null,
      2,
    ),
  );
  journal(`Analyse par famille (${pourAnalyse.length} surface(s), masques douteux exclus : ${douteux}, erreurs : ${erreurs}) :`);
  for (const l of analyse) journal(`  ${l.famille.padEnd(13)} ${l.groupe.padEnd(32)} n ${String(l.n).padStart(3)} · ΔE méd. ${virgule(l.deltaEMedian).padStart(5)} · p90 ${virgule(l.deltaE90).padStart(5)} · > 5 : ${String(Math.round(l.partAuDessusDe5 * 100)).padStart(3)} % · à clarté égale ${virgule(l.chromatiqueMedian).padStart(5)} · dérive L ${signe(l.derive.L)} a ${signe(l.derive.a)} b ${signe(l.derive.b)} C* ${signe(l.derive.C)}`);
  journal(`Mesures : ${o.sortie}${o.planches ? ` ; planches : ${dossierPlanches}` : ""}.`);
  return { sortie: o.sortie, cas, analyse, douteux, erreurs, planches: cas.filter((c) => c.planche).length };
}

/* ── La planche d'un cas ── */

const HAUTEUR = 420;
const MARGE = 16;
const L_COLONNE = 330;
const COULEURS: [number, number, number][] = [
  [0, 200, 255],
  [255, 200, 0],
  [80, 255, 120],
  [255, 120, 40],
];
const echapper = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * Avant, rendu, rendu avec le masque en surimpression (une couleur par surface, magenta pour un changement hors
 * demande, bord flouté), puis pour chaque surface la pastille mesurée à côté de celle du catalogue, son ΔE, sa dérive et
 * sa texture.
 */
export async function plancheMesure(avant: string, rendu: string, m: MesureRendu, titre: string, fichier: string, detail = m.detail): Promise<void> {
  const sharp = (await import("sharp")).default;
  const { largeur: W, hauteur: H } = m;
  const l = Math.round((HAUTEUR * W) / H);
  const tuile = (f: string) => sharp(f).flatten({ background: "#ffffff" }).resize(W, H, { fit: m.recadre && f === rendu ? "cover" : "fill" }).removeAlpha();
  const couches: { input: Buffer; left: number; top: number }[] = [];
  const haut = MARGE + 34;
  couches.push({ input: await tuile(avant).resize(l, HAUTEUR).png().toBuffer(), left: MARGE, top: haut });
  couches.push({ input: await tuile(rendu).resize(l, HAUTEUR).png().toBuffer(), left: 2 * MARGE + l, top: haut });
  if (detail) {
    const calque = Buffer.alloc(W * H * 4);
    for (let i = 0; i < W * H; i++) {
      const s = detail.surface[i];
      const alpha = detail.flou[i];
      if (alpha === 0) continue;
      const c: [number, number, number] = s === -2 ? [255, 0, 200] : s >= 0 ? COULEURS[s % COULEURS.length] : [255, 255, 255];
      calque[4 * i] = c[0];
      calque[4 * i + 1] = c[1];
      calque[4 * i + 2] = c[2];
      calque[4 * i + 3] = Math.round(alpha * 0.55);
    }
    const base = await tuile(rendu).png().toBuffer();
    // sharp redimensionne avant de composer : la surimpression d'abord, la réduction ensuite.
    const compose = await sharp(base).composite([{ input: calque, raw: { width: W, height: H, channels: 4 } }]).png().toBuffer();
    const superpose = await sharp(compose).resize(l, HAUTEUR).png().toBuffer();
    couches.push({ input: superpose, left: 3 * MARGE + 2 * l, top: haut });
  }
  let x = 4 * MARGE + 3 * l;
  for (const [k, s] of m.surfaces.entries()) {
    const c = COULEURS[k % COULEURS.length];
    const pastilles = `<svg xmlns="http://www.w3.org/2000/svg" width="${L_COLONNE}" height="150"><rect x="0" y="0" width="12" height="120" fill="rgb(${c.join(",")})"/><rect x="22" y="0" width="140" height="120" fill="${s.mesure ?? "#222222"}" stroke="#888"/><rect x="172" y="0" width="140" height="120" fill="${s.hex}" stroke="#888"/><text x="22" y="140" font-family="Arial" font-size="14" fill="#DDD">mesurée</text><text x="172" y="140" font-family="Arial" font-size="14" fill="#DDD">catalogue</text></svg>`;
    couches.push({ input: Buffer.from(pastilles), left: x, top: haut });
    const lignes = [
      `<tspan x="0" dy="0" font-weight="700">${echapper(`${s.ref}${s.nom ? ` ${s.nom}` : ""}`)}</tspan>`,
      `<tspan x="0" dy="20">${s.trouvee ? `${s.mesure} · catalogue ${s.hex}` : "surface non trouvée"}</tspan>`,
      s.trouvee ? `<tspan x="0" dy="22" font-weight="700" fill="${(s.deltaE ?? 0) > 5 ? "#FF6B6B" : "#7BE07B"}">ΔE 2000 : ${virgule(s.deltaE)} (clarté égale : ${virgule(s.deltaEChromatique)})</tspan>` : "",
      s.derive ? `<tspan x="0" dy="20">L ${signe(s.derive.L)} · a ${signe(s.derive.a)} · b ${signe(s.derive.b)} · C* ${signe(s.derive.C)}</tspan>` : "",
      `<tspan x="0" dy="20" fill="${s.texture.perdue ? "#FF6B6B" : "#DDDDDD"}">texture ${virgule(s.texture.mesuree)} (attendue : ${s.texture.attendue})${s.texture.perdue ? " PERDUE" : ""}</tspan>`,
      `<tspan x="0" dy="20" fill="#BBBBBB">${virgule(Math.round(s.part * 1000) / 10)} % de l'image</tspan>`,
    ].join("");
    couches.push({ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${L_COLONNE}" height="${HAUTEUR - 150}"><text x="0" y="16" font-family="Arial" font-size="15" fill="#FFFFFF">${lignes}</text></svg>`), left: x, top: haut + 160 });
    x += L_COLONNE + MARGE;
  }
  const largeur = Math.max(x, 1200);
  const pied = `masque ${virgule(Math.round(m.masque.part * 1000) / 10)} % · ${m.masque.composantes} composante(s) · blanc ${m.balance.blanc ?? "—"} (${m.balance.mode}) · contours hors masque ${virgule(m.respect.contoursHorsMasque)}, global ${virgule(m.respect.contoursGlobal)} · hors demande ${virgule(Math.round(m.respect.partHorsDemande * 1000) / 10)} %`;
  couches.push({ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${largeur}" height="30"><text x="0" y="22" font-family="Arial" font-weight="700" font-size="19" fill="#FFFFFF">${echapper(titre)}</text></svg>`), left: MARGE, top: MARGE });
  couches.push({ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${largeur}" height="26"><text x="0" y="18" font-family="Arial" font-size="15" fill="${m.masque.douteux ? "#FF6B6B" : "#CCCCCC"}">${echapper(pied)}</text></svg>`), left: MARGE, top: haut + HAUTEUR + 8 });
  if (m.masque.douteux) couches.push({ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${largeur}" height="26"><text x="0" y="18" font-family="Arial" font-weight="700" font-size="15" fill="#FF6B6B">${echapper(`MASQUE DOUTEUX : ${m.masque.raisons.join(" ; ")}`)}</text></svg>`), left: MARGE, top: haut + HAUTEUR + 34 });
  await fs.mkdir(path.dirname(fichier), { recursive: true });
  await sharp({ create: { width: largeur, height: haut + HAUTEUR + 70, channels: 3, background: { r: 34, g: 34, b: 34 } } })
    .composite(couches)
    .jpeg({ quality: 88 })
    .toFile(fichier);
}
