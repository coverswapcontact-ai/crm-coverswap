import { createHash } from "node:crypto";
import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import type { MetaJeu } from "@/lib/simulateur/jeu-essai";
import { AMPLITUDE_L, corrigerTeintes, type FideliteSurface } from "./correction-teintes";
import { centile, classeTexture, familleTeinte, type ReferenceMesure } from "./mesure-rendu";
import { CATALOGUE_DEFAUT, lireCatalogue, type Revetement } from "./vignettes";

/**
 * Mission 23 (L3) — la correction des teintes sur un jeu d'essai dézippé (`scripts/corriger-jeu.ts`,
 * `npm run simulateur:corriger-jeu -- <jeu> [<jeu>…] [--planches]`), pour la régler et la valider :
 *  - chaque cas est rangé, de façon déterministe, en « reglage » (70 %) ou « validation » (30 %) par le hash de son id
 *    (`partDuCas`) : une image n'est jamais à la fois réglée et validée ; seuls les cas au masque fiable comptent dans
 *    les chiffres (un masque douteux est « à régénérer » par principe) ;
 *  - par partie : ΔE 2000 médian et 90e centile avant / après, ΔE à clarté égale, part des surfaces « à régénérer »,
 *    temps par image ;
 *  - avec `--planches` : `planches-correction/<id>.jpg` (avant, rendu, corrigé, en grand) pour les cas fiables, et
 *    `--difficiles id,id,…` : la planche commune de ces cas (`planche-difficiles.jpg`).
 * Sorties HORS DU DÉPÔT (refusé sinon), à côté du premier jeu : `corrections.json`, `planches-correction/`.
 * Options de réglage : `--amplitude-l` (défaut `AMPLITUDE_L`), `--partie reglage|validation|tout` (défaut tout),
 * `--cas id,id`.
 */

export type Partie = "reglage" | "validation";

/** 70 % réglage, 30 % validation, par le hash SHA-256 de l'id (stable d'un lancement à l'autre). */
export function partDuCas(id: string): Partie {
  return createHash("sha256").update(id).digest().readUInt32BE(0) % 100 < 70 ? "reglage" : "validation";
}

export type OptionsCorrectionJeu = { dossiers: string[]; sortie: string; planches: boolean; catalogue: string; amplitudeL: number; partie: Partie | "tout"; cas: string[] | null; difficiles: string[] };

export function lireArgumentsCorrectionJeu(argv: string[], depot = process.cwd()): OptionsCorrectionJeu {
  const dossiers: string[] = [];
  let sortie: string | null = null;
  const o = { planches: false, catalogue: CATALOGUE_DEFAUT(), amplitudeL: AMPLITUDE_L, partie: "tout" as Partie | "tout", cas: null as string[] | null, difficiles: [] as string[] };
  for (let i = 0; i < argv.length; i++) {
    const cle = argv[i];
    const valeur = () => {
      const v = argv[++i];
      if (v === undefined || v.startsWith("--")) throw new Error(`${cle} : valeur manquante.`);
      return v;
    };
    if (cle === "--sortie") sortie = path.resolve(valeur());
    else if (cle === "--planches") o.planches = true;
    else if (cle === "--catalogue") o.catalogue = path.resolve(valeur());
    else if (cle === "--amplitude-l") {
      o.amplitudeL = Number(valeur());
      if (!(o.amplitudeL >= 0 && o.amplitudeL <= 1)) throw new Error("--amplitude-l : entre 0 et 1.");
    } else if (cle === "--partie") {
      const p = valeur();
      if (p !== "reglage" && p !== "validation" && p !== "tout") throw new Error("--partie : reglage, validation ou tout.");
      o.partie = p;
    } else if (cle === "--cas") o.cas = valeur().split(",").map((x) => x.trim()).filter(Boolean);
    else if (cle === "--difficiles") o.difficiles = valeur().split(",").map((x) => x.trim()).filter(Boolean);
    else if (cle.startsWith("--")) throw new Error(`Option inconnue : ${cle}`);
    else dossiers.push(path.resolve(cle));
  }
  if (dossiers.length === 0) throw new Error("Usage : npm run simulateur:corriger-jeu -- <dossier-du-jeu-dezippe> [<autre jeu>…] [--planches] [--amplitude-l 0.5] [--partie reglage|validation|tout]");
  const fichier = sortie ?? path.join(path.dirname(dossiers[0]), "corrections.json");
  const racine = path.resolve(depot) + path.sep;
  for (const [nom, chemin] of [...dossiers.map((d) => ["Le jeu", d] as const), ["La sortie", fichier] as const])
    if ((chemin + path.sep).startsWith(racine)) throw new Error(`${nom} est dans le dépôt (${chemin}) : les photos de clients et leurs corrections restent hors du dépôt (~/coverswap-photos/calibrage/).`);
  return { dossiers, sortie: fichier, ...o };
}

export type CasCorrige = {
  id: string;
  jeu: string;
  partie: Partie;
  origine: string;
  moteur: string | null;
  modele: string | null;
  douteux: boolean;
  balance: string;
  familles: Record<string, string>;
  fidelite: FideliteSurface[];
  dureeMs: number;
  erreur: string | null;
  planche: string | null;
};

export type ChiffresPartie = {
  partie: Partie;
  cas: number;
  surfaces: number;
  avant: { median: number; p90: number; teinteMedian: number; teinteP90: number };
  apres: { median: number; p90: number; teinteMedian: number; teinteP90: number };
  corrigees: number;
  fideles: number;
  aRegenerer: number;
  partARegenerer: number;
  tempsMedianMs: number;
  tempsMaxMs: number;
};

const arrondi = (n: number, d = 1) => Math.round(n * 10 ** d) / 10 ** d;
const virgule = (n: number | null | undefined) => (n === null || n === undefined ? "—" : String(n).replace(".", ","));

/** Les chiffres d'une partie : surfaces mesurées des cas au masque fiable (une par référence, pas par zone). */
export function chiffresPartie(partie: Partie, cas: CasCorrige[]): ChiffresPartie {
  const siens = cas.filter((c) => c.partie === partie && !c.douteux && !c.erreur);
  const surfaces = siens.flatMap((c) => c.fidelite.filter((s, i) => c.fidelite.findIndex((x) => x.ref === s.ref) === i));
  const mesurees = surfaces.filter((s) => s.deltaEAvant !== null && s.deltaEApres !== null);
  const v = (f: (s: FideliteSurface) => number | null) => mesurees.map(f).filter((x): x is number => x !== null);
  const bloc = (de: (s: FideliteSurface) => number | null, te: (s: FideliteSurface) => number | null) => ({ median: arrondi(centile(v(de), 50)), p90: arrondi(centile(v(de), 90)), teinteMedian: arrondi(centile(v(te), 50)), teinteP90: arrondi(centile(v(te), 90)) });
  const temps = siens.map((c) => c.dureeMs);
  const aRegenerer = surfaces.filter((s) => s.etat === "a_regenerer").length;
  return {
    partie,
    cas: siens.length,
    surfaces: surfaces.length,
    avant: bloc((s) => s.deltaEAvant, (s) => s.deltaETeinteAvant),
    apres: bloc((s) => s.deltaEApres, (s) => s.deltaETeinteApres),
    corrigees: surfaces.filter((s) => s.etat === "corrigee").length,
    fideles: surfaces.filter((s) => s.etat === "fidele").length,
    aRegenerer,
    partARegenerer: surfaces.length ? arrondi(aRegenerer / surfaces.length, 2) : 0,
    tempsMedianMs: Math.round(centile(temps, 50)),
    tempsMaxMs: Math.max(0, ...temps),
  };
}

export type BilanCorrectionJeu = { sortie: string; cas: CasCorrige[]; chiffres: ChiffresPartie[]; erreurs: number };

export async function executerCorrectionJeu(argv: string[], journal: (ligne: string) => void = console.log): Promise<BilanCorrectionJeu> {
  const o = lireArgumentsCorrectionJeu(argv);
  const catalogue = lireCatalogue(await fs.readFile(o.catalogue, "utf8"));
  const parId = new Map(catalogue.map((r) => [r.id, r as Revetement & { categorie?: string }]));
  const dossierPlanches = path.join(path.dirname(o.sortie), "planches-correction");
  const cas: CasCorrige[] = [];
  const images = new Map<string, { avant: string; rendu: string; corrige: Buffer; titre: string }>();

  for (const dossier of o.dossiers) {
    if (!existsSync(path.join(dossier, "manifest.json"))) throw new Error(`${dossier} : manifest.json absent (est-ce bien un jeu d'essai dézippé ?)`);
    const ids = (await fs.readdir(dossier, { withFileTypes: true })).filter((e) => e.isDirectory() && existsSync(path.join(dossier, e.name, "meta.json"))).map((e) => e.name).sort();
    journal(`Jeu ${path.basename(dossier)} : ${ids.length} cas.`);
    for (const id of ids) {
      if (o.cas && !o.cas.includes(id)) continue;
      const partie = partDuCas(id);
      if (o.partie !== "tout" && partie !== o.partie && !o.difficiles.includes(id)) continue;
      const meta = JSON.parse(await fs.readFile(path.join(dossier, id, "meta.json"), "utf8")) as MetaJeu;
      const zones = (meta.zones ?? []).map((z) => ({ zone: z.zone, ref: z.ref }));
      const refs: ReferenceMesure[] = [];
      const familles: Record<string, string> = {};
      for (const ref of [...new Set(zones.map((z) => z.ref))]) {
        const r = parId.get(ref);
        if (!r) continue;
        const classe = classeTexture(r);
        refs.push({ ref: r.id, nom: r.nom, hex: r.hex, classe });
        familles[r.id] = familleTeinte(r.hex, classe);
      }
      const c: CasCorrige = { id, jeu: path.basename(dossier), partie, origine: meta.origine, moteur: meta.moteur ?? null, modele: meta.modele ?? null, douteux: false, balance: "", familles, fidelite: [], dureeMs: 0, erreur: null, planche: null };
      cas.push(c);
      const avant = path.join(dossier, id, meta.fichiers?.avant ?? "avant.jpg");
      const rendu = path.join(dossier, id, meta.fichiers?.rendu ?? "rendu.jpg");
      try {
        const r = await corrigerTeintes({ avant, apres: rendu, zones, references: refs, amplitudeL: o.amplitudeL });
        c.douteux = r.mesure.masque.douteux;
        c.balance = r.mesure.balance.mode;
        c.fidelite = r.fidelite;
        c.dureeMs = r.dureeMs;
        if (!c.douteux) images.set(id, { avant, rendu, corrige: r.image, titre: `${id} · ${partie} · ${meta.origine} · moteur ${meta.moteur ?? "?"} · ${meta.modele ?? "modèle inconnu"} · blanc ${c.balance}` });
        const resume = r.fidelite.map((s) => `${s.zone}/${s.ref} ${s.etat}${s.deltaEAvant !== null ? ` ΔE ${virgule(s.deltaEAvant)} → ${virgule(s.deltaEApres)} (teinte ${virgule(s.deltaETeinteAvant)} → ${virgule(s.deltaETeinteApres)})` : ""}${s.raison && !c.douteux ? ` [${s.raison}]` : ""}`).join(" ; ");
        journal(`  ${id} [${partie}] ${c.douteux ? "MASQUE DOUTEUX" : resume} (${r.dureeMs} ms)`);
      } catch (e) {
        c.erreur = e instanceof Error ? e.message : String(e);
        journal(`  ${id} : ERREUR ${c.erreur}`);
      }
      if (o.planches && images.has(id)) {
        const x = images.get(id)!;
        c.planche = path.join(dossierPlanches, `${id}.jpg`);
        await plancheCorrection([{ ...x, fidelite: c.fidelite }], c.planche);
      }
      // On ne garde en mémoire que les cas de la planche commune.
      if (!o.difficiles.includes(id)) images.delete(id);
    }
  }

  const chiffres = (["reglage", "validation"] as Partie[]).filter((p) => o.partie === "tout" || o.partie === p).map((p) => chiffresPartie(p, cas));
  const erreurs = cas.filter((c) => c.erreur).length;
  if (o.planches && o.difficiles.length > 0) {
    const liste = o.difficiles.map((id) => ({ id, x: images.get(id), c: cas.find((k) => k.id === id) })).filter((y) => y.x && y.c);
    if (liste.length > 0) await plancheCorrection(liste.map((y) => ({ ...y.x!, fidelite: y.c!.fidelite })), path.join(path.dirname(o.sortie), "planche-difficiles.jpg"));
  }
  await fs.mkdir(path.dirname(o.sortie), { recursive: true });
  await fs.writeFile(o.sortie, JSON.stringify({ genereLe: new Date().toISOString(), amplitudeL: o.amplitudeL, partie: o.partie, chiffres, cas }, null, 2));
  for (const ch of chiffres)
    journal(
      `${ch.partie} : ${ch.cas} cas fiables, ${ch.surfaces} surfaces · ΔE médian ${virgule(ch.avant.median)} → ${virgule(ch.apres.median)}, p90 ${virgule(ch.avant.p90)} → ${virgule(ch.apres.p90)} · à clarté égale ${virgule(ch.avant.teinteMedian)} → ${virgule(ch.apres.teinteMedian)} (p90 ${virgule(ch.avant.teinteP90)} → ${virgule(ch.apres.teinteP90)}) · corrigées ${ch.corrigees}, fidèles ${ch.fideles}, à régénérer ${ch.aRegenerer} (${Math.round(ch.partARegenerer * 100)} %) · temps médian ${ch.tempsMedianMs} ms, max ${ch.tempsMaxMs} ms`,
    );
  journal(`Corrections : ${o.sortie}${o.planches ? ` ; planches : ${dossierPlanches}` : ""}.`);
  return { sortie: o.sortie, cas, chiffres, erreurs };
}

/* ── La planche avant / rendu / corrigé ── */

const HAUTEUR = 560;
const MARGE = 14;
const echapper = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Une bande par cas : avant, rendu, corrigé (à la même hauteur), le titre et la fidélité par surface. */
export async function plancheCorrection(lignes: { avant: string; rendu: string; corrige: Buffer; titre: string; fidelite: FideliteSurface[] }[], fichier: string): Promise<void> {
  const sharp = (await import("sharp")).default;
  const couches: { input: Buffer; left: number; top: number }[] = [];
  let y = MARGE;
  let largeur = 1200;
  for (const l of lignes) {
    const meta = await sharp(l.rendu).metadata();
    const lt = Math.round((HAUTEUR * (meta.width ?? 1)) / (meta.height ?? 1));
    couches.push({ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${3 * lt + 2 * MARGE}" height="28"><text x="0" y="20" font-family="Arial" font-weight="700" font-size="18" fill="#FFFFFF">${echapper(l.titre)}</text></svg>`), left: MARGE, top: y });
    y += 32;
    const tuiles = [l.avant, l.rendu, l.corrige];
    for (const [k, t] of tuiles.entries()) couches.push({ input: await sharp(t).resize(lt, HAUTEUR, { fit: "fill" }).removeAlpha().jpeg({ quality: 92 }).toBuffer(), left: MARGE + k * (lt + MARGE), top: y });
    y += HAUTEUR + 6;
    const texte = l.fidelite.map((s) => `${s.zone} ${s.ref} : ${s.etat}${s.deltaEAvant !== null ? ` ΔE ${virgule(s.deltaEAvant)} → ${virgule(s.deltaEApres)} (teinte ${virgule(s.deltaETeinteAvant)} → ${virgule(s.deltaETeinteApres)})` : ""}${s.raison ? ` — ${s.raison}` : ""}`).join("   |   ");
    couches.push({ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${3 * lt + 2 * MARGE}" height="26"><text x="0" y="18" font-family="Arial" font-size="15" fill="#DDDDDD">${echapper(texte)}</text></svg>`), left: MARGE, top: y });
    y += 26 + MARGE;
    largeur = Math.max(largeur, 3 * lt + 4 * MARGE);
  }
  await fs.mkdir(path.dirname(fichier), { recursive: true });
  await sharp({ create: { width: largeur, height: y, channels: 3, background: { r: 34, g: 34, b: 34 } } }).composite(couches).jpeg({ quality: 90 }).toFile(fichier);
}
