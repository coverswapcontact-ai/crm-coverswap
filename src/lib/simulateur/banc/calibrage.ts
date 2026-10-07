import { existsSync, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import prisma from "@/lib/prisma";
import { essaiLocal, leverGardePourCanaux, retablirGarde } from "@/lib/acces/essai-local";
import { empreintePhoto } from "@/lib/simulateur/analyses";
import { definirCatalogueEssai, reference as lireReference, type Reference } from "@/lib/simulateur/catalogue";
import { VARIANTES_MOTEUR, estVarianteMoteur, type VarianteMoteur } from "@/lib/simulateur/moteur/types";
import { REGLAGES_PAR_DEFAUT } from "@/lib/simulateur/reglages";
import { estIdPiece, estIdZone, type IdPiece, type IdZone } from "@/lib/simulateur/zones";
import { classeTexture, centile, type ReferenceMesure } from "@/lib/simulations/mesure-rendu";
import { genererRendu, extensionDe, type Generateur } from "@/lib/simulations/generation";
import { genererAvecMoteur } from "@/lib/simulations/pipeline";
import { COUT_ESTIME_VISION_DOLLARS, MODELE_VISION, type Qualite } from "@/lib/simulations/prix";
import { planchesAveugles } from "./aveugle";

/**
 * Mission 23 (L4a) — la campagne de calibrage des teintes du simulateur, rejouable (`npm run simulateur:calibrer --
 * --phase P1|P2|P3|P4 [--estimer]`, `scripts/calibrer.ts`). Le protocole est écrit AVANT le premier appel dans
 * `docs/REPRISE-MISSION.md` § Mission 23 ; la méthode et la façon de rejouer dans `docs/CALIBRAGE-SIMULATEUR.md`.
 *
 *  - Les cas sont figés HORS DU DÉPÔT : `~/coverswap-photos/calibrage/banc/cas.json` (id opaques des photos du jeu
 *    d'essai exporté, zones, références) ; les photos restent dans `~/coverswap-photos/calibrage/jeu/` ; les rendus, les
 *    notes (`resultats.json`) et les planches à l'aveugle sont écrits à côté, jamais dans le dépôt (refusé).
 *  - Le rendu passe par le moteur V2 du pipeline commun (analyse, planche, prompt, contrôle) avec le modèle passé
 *    EXPLICITEMENT à chaque appel (`gpt-image-2.5-sunburst` ; `gpt-image-1` refusé), une seule tentative par cas
 *    (seuil de contrôle 0 : la seconde tentative du pipeline doublerait le coût et mélangerait deux images).
 *  - Chaque appel (génération, analyse, contrôle) est noté dans `GenerationImage` en phase `calibrage-23`. Le plafond
 *    (4,50 $ par défaut, jamais plus) est relu dans `GenerationImage` avant CHAQUE appel, sur la somme de cette phase.
 *    Un rendu en échec est rejoué une fois au plus ; un appel qui coûte plus du double de son estimation arrête tout.
 *  - La note d'un rendu est gratuite et locale : `corrigerTeintes` (mesure de L2 + correction de L3) → ΔE médian des
 *    surfaces demandées, 90e centile, ΔE à clarté égale, texture, respect de la pièce, puis ΔE corrigé et « à régénérer ».
 *  - La base visée doit être locale (fichier SQLite du poste) ; la garde de l'essai local (`CRM_ESSAI_LOCAL`) reste
 *    posée pour tout le reste et n'est levée que pour OpenAI images et vision, dans ce processus, avec
 *    `CALIBRAGE_23_PAYANT=1` sur la ligne de commande.
 */

export const PHASE_CALIBRAGE = "calibrage-23";
export const PLAFOND_CALIBRAGE = 4.5;
export const MODELE_CALIBRAGE = "gpt-image-2.5-sunburst";
/** Coût prévu d'un rendu sunburst (1536 × 1024, photo + planche) : medium ≈ 0,05 $ (relevé en E5 : 0,0494 $). */
export const ESTIMATION_RENDU: Record<Qualite, number> = { low: 0.03, medium: 0.05, high: 0.09 };
export const ESTIMATION_VISION = COUT_ESTIME_VISION_DOLLARS;
export const PHASES_CALIBRAGE = ["P1", "P2", "P3", "P4"] as const;
export type PhaseCalibrage = (typeof PHASES_CALIBRAGE)[number];
/** P3 : les 8 pires cas de P1 ; P4 seulement si la meilleure variante gagne au moins 3 de ΔE médian après correction. */
export const NOMBRE_PIRES = 8;
export const GAIN_MIN_P4 = 3;
/** Le même cas rendu deux fois ne donne jamais la même image : moins de 2 de ΔE entre deux variantes n'est pas un résultat. */
export const ECART_SIGNIFICATIF = 2;
export const VARIABLE_PAYANT = "CALIBRAGE_23_PAYANT";

export const dossierCalibrageParDefaut = () => path.join(os.homedir(), "coverswap-photos", "calibrage");

/* ── Les cas (cas.json, hors du dépôt) ── */

const schemaZone = z.object({ zone: z.string().refine(estIdZone, "zone inconnue"), ref: z.string().min(1) });
export const schemaCasCalibrage = z
  .object({
    version: z.literal(1),
    /** Le jeu d'essai dézippé, relatif au dossier de calibrage (ou absolu). */
    jeu: z.string().min(1),
    photos: z.array(z.object({ id: z.string().regex(/^[0-9a-f]{12}$/, "id opaque du jeu attendu"), description: z.string(), piece: z.string().refine(estIdPiece, "pièce inconnue") })).min(1),
    teintes: z.array(z.object({ ref: z.string(), nom: z.string(), role: z.string(), hex: z.string().regex(/^#[0-9A-F]{6}$/i), lab: z.tuple([z.number(), z.number(), z.number()]) })).min(1),
    cas: z
      .array(
        z.object({
          id: z.string().regex(/^[a-z][0-9a-z-]{1,20}$/),
          photo: z.string(),
          /** La teinte du banc posée sur les façades de ce cas ; null pour un rendu « choix » (teinte du client hors banc). */
          teinte: z.string().nullable(),
          zones: z.array(schemaZone).min(1).max(4),
          /** La teinte que le client avait vraiment choisie pour cette photo (planche finale A / B / C). */
          client: z.boolean(),
          /** Rendu « choix » : la teinte du client n'est pas une des 5 du banc (écrit à l'avance dans le protocole). */
          choix: z.boolean(),
        })
      )
      .min(1),
  })
  .superRefine((v, ctx) => {
    const photos = new Set(v.photos.map((p) => p.id));
    const ids = new Set<string>();
    for (const c of v.cas) {
      if (!photos.has(c.photo)) ctx.addIssue({ code: "custom", message: `cas ${c.id} : photo inconnue ${c.photo}` });
      if (ids.has(c.id)) ctx.addIssue({ code: "custom", message: `cas en double : ${c.id}` });
      ids.add(c.id);
    }
  });
export type CasCalibrage = z.infer<typeof schemaCasCalibrage>;
export type UnCas = CasCalibrage["cas"][number];

export function lireCasCalibrage(texte: string): CasCalibrage {
  return schemaCasCalibrage.parse(JSON.parse(texte));
}

/* ── Options ── */

export type OptionsCalibrage = {
  phase: PhaseCalibrage | null;
  estimer: boolean;
  plafond: number;
  modele: string;
  /** P3 : les deux variantes à côté de `retouche` (sinon : la règle écrite, d'après P1). */
  variantes: VarianteMoteur[] | null;
  /** P4 : la meilleure variante de P3. */
  variante: VarianteMoteur | null;
  cas: string[] | null;
  dossier: string;
  uploads: string;
  /** Planches mélangées A, B, C… d'une phase (aucun appel). */
  aveugle: PhaseCalibrage | null;
  corrige: boolean;
  graine: number;
  /** Le bilan d'une phase, depuis les résultats écrits (aucun appel). */
  bilan: PhaseCalibrage | null;
};

const estPhase = (v: string): v is PhaseCalibrage => (PHASES_CALIBRAGE as readonly string[]).includes(v);

/** Le modèle d'une génération du calibrage : jamais `gpt-image-1` (trop cher, déjà jugé moins fidèle en E5). */
export function verifierModeleCalibrage(modele: string): string {
  if (/^gpt-image-1(\b|-|$)/.test(modele.trim())) throw new Error(`${modele} est exclu des générations de la mission 23 : passer --modele ${MODELE_CALIBRAGE} (défaut).`);
  if (!modele.trim()) throw new Error("--modele : nom vide.");
  return modele.trim();
}

export function lireOptionsCalibrage(argv: string[], depot = process.cwd()): OptionsCalibrage {
  const o: OptionsCalibrage = { phase: null, estimer: false, plafond: PLAFOND_CALIBRAGE, modele: MODELE_CALIBRAGE, variantes: null, variante: null, cas: null, dossier: dossierCalibrageParDefaut(), uploads: path.resolve(depot, ".uploads"), aveugle: null, corrige: false, graine: 23, bilan: null };
  for (let i = 0; i < argv.length; i++) {
    const cle = argv[i];
    const valeur = () => {
      const v = argv[++i];
      if (v === undefined || v.startsWith("--")) throw new Error(`${cle} : valeur manquante.`);
      return v;
    };
    const phase = (v: string) => {
      const p = v.toUpperCase();
      if (!estPhase(p)) throw new Error(`${cle} : P1, P2, P3 ou P4 (reçu ${v}).`);
      return p;
    };
    if (cle === "--phase") o.phase = phase(valeur());
    else if (cle === "--estimer") o.estimer = true;
    else if (cle === "--plafond") o.plafond = Number(valeur().replace(",", "."));
    else if (cle === "--modele") o.modele = verifierModeleCalibrage(valeur());
    else if (cle === "--variantes") o.variantes = valeur().split(",").map((v) => v.trim()).filter(Boolean) as VarianteMoteur[];
    else if (cle === "--variante") o.variante = valeur().trim() as VarianteMoteur;
    else if (cle === "--cas") o.cas = valeur().split(",").map((v) => v.trim()).filter(Boolean);
    else if (cle === "--dossier") o.dossier = path.resolve(valeur());
    else if (cle === "--uploads") o.uploads = path.resolve(valeur());
    else if (cle === "--aveugle") o.aveugle = phase(valeur());
    else if (cle === "--corrige") o.corrige = true;
    else if (cle === "--graine") o.graine = Number(valeur());
    else if (cle === "--bilan") o.bilan = phase(valeur());
    else throw new Error(`Option inconnue : ${cle}`);
  }
  if (!Number.isFinite(o.plafond) || o.plafond <= 0 || o.plafond > PLAFOND_CALIBRAGE) throw new Error(`--plafond : un montant entre 0 et ${PLAFOND_CALIBRAGE} $ (plafond dur de la mission, non dépassable).`);
  if (!o.phase && !o.aveugle && !o.bilan) throw new Error("Usage : npm run simulateur:calibrer -- --phase P1|P2|P3|P4 [--estimer] (ou --bilan P1, --aveugle P3).");
  for (const v of [...(o.variantes ?? []), ...(o.variante ? [o.variante] : [])]) if (!estVarianteMoteur(v)) throw new Error(`Variante inconnue : ${v} (${VARIANTES_MOTEUR.join(", ")}).`);
  if (o.variantes && (o.variantes.length !== 2 || o.variantes.includes("retouche") || o.variantes.includes("actuel"))) throw new Error("--variantes : exactement deux variantes à côté de retouche (planche-neutre, ordre, ordre-fin).");
  if (o.variante === "actuel") throw new Error("--variante : la variante de P4 n'est pas « actuel » (c'est P1).");
  if (!Number.isInteger(o.graine)) throw new Error("--graine : un entier.");
  const racine = path.resolve(depot) + path.sep;
  if ((o.dossier + path.sep).startsWith(racine)) throw new Error(`Le dossier de calibrage est dans le dépôt (${o.dossier}) : photos, rendus et notes restent hors du dépôt (~/coverswap-photos/calibrage/).`);
  return o;
}

/** La base visée doit être le fichier SQLite du poste : jamais Turso, jamais le volume de Railway. */
export function verifierBaseLocale(env: Record<string, string | undefined> = process.env): void {
  const url = env.DATABASE_URL ?? "";
  if (env.TURSO_DATABASE_URL) throw new Error("Base distante (TURSO_DATABASE_URL) : la campagne de calibrage ne tourne que sur la base locale du poste.");
  if (env.RAILWAY_ENVIRONMENT || env.RAILWAY_PROJECT_ID || env.RAILWAY_SERVICE_ID) throw new Error("Environnement Railway : la campagne de calibrage ne tourne que sur le poste.");
  if (!url.startsWith("file:")) throw new Error("DATABASE_URL n'est pas un fichier SQLite local : la campagne de calibrage refuse de tourner.");
  if (/^file:\/data(\/|$)/.test(url)) throw new Error("DATABASE_URL vise le volume de production (/data) : la campagne de calibrage refuse de tourner.");
}

/* ── Résultats (resultats.json, hors du dépôt) ── */

export type SurfaceNotee = { ref: string; deltaE: number | null; chromatique: number | null; derive: { L: number; a: number; b: number; C: number } | null; texturePerdue: boolean; etat: string; raison: string | null; deltaECorrige: number | null };
export type NoteRendu = {
  douteux: boolean;
  raisonsDouteux: string[];
  surfaces: SurfaceNotee[];
  deltaEMedian: number | null;
  chromatiqueMedian: number | null;
  texturesPerdues: number;
  contoursHorsMasque: number;
  partHorsDemande: number;
  deltaECorrigeMedian: number | null;
  aRegenerer: number;
  corrigee: boolean;
};
export type ResultatCas = {
  cle: string;
  phase: PhaseCalibrage;
  cas: string;
  variante: VarianteMoteur;
  qualite: Qualite;
  modele: string;
  ok: boolean;
  erreur: string | null;
  appels: number;
  coutDollars: number;
  dureeMs: number;
  scoreControle: number | null;
  fichier: string | null;
  corrige: string | null;
  avant: string | null;
  note: NoteRendu | null;
  le: string;
};
export type Resultats = { version: 1; rendus: Record<string, ResultatCas> };

/** La clé d'un rendu : cas, variante, qualité (et le modèle s'il n'est pas sunburst : le banc rejoué avec un nouveau modèle ne reprend pas les rendus de l'ancien). */
export const cleRendu = (cas: string, variante: VarianteMoteur, qualite: Qualite, modele = MODELE_CALIBRAGE) => (modele === MODELE_CALIBRAGE ? `${cas}|${variante}|${qualite}` : `${cas}|${variante}|${qualite}|${modele}`);

/* ── Plan d'une phase ── */

export type ElementPlan = { cas: UnCas | null; libelle: string; variante: VarianteMoteur; qualite: Qualite };
export type Plan = { elements: ElementPlan[]; notes: string[] };

const mediane = (v: number[]) => (v.length === 0 ? null : centile(v, 50));
const arrondi = (n: number) => Math.round(n * 100) / 100;

/** La note qui classe un cas : ΔE médian après correction (une surface « à régénérer » à son ΔE brut ; rien de mesurable : +∞). */
export function scoreApres(note: NoteRendu | null): number {
  if (!note) return Number.POSITIVE_INFINITY;
  const v = note.surfaces.map((s) => (s.etat === "a_regenerer" || s.deltaECorrige === null ? s.deltaE : s.deltaECorrige)).filter((x): x is number => typeof x === "number");
  return v.length ? centile(v, 50) : Number.POSITIVE_INFINITY;
}

/** P3 : les `n` pires cas du banc en P1 (V2 + actuel, medium), par ΔE médian après correction ; égalité : l'ordre du fichier. */
export function choisirPires(cas: UnCas[], resultats: Resultats, n = NOMBRE_PIRES, modele = MODELE_CALIBRAGE): UnCas[] {
  return cas
    .filter((c) => !c.choix)
    .map((c, rang) => ({ c, rang, score: scoreApres(resultats.rendus[cleRendu(c.id, "actuel", "medium", modele)]?.note ?? null) }))
    .sort((x, y) => y.score - x.score || x.rang - y.rang)
    .slice(0, n)
    .map((x) => x.c);
}

/**
 * La règle écrite AVANT P1 pour les deux variantes de P3 à côté de `retouche` : si P1 dérive surtout en clarté (|ΔL*|
 * médian ≥ ΔE médian à clarté égale), le modèle lit mal l'échantillon : `planche-neutre` + `ordre` ; sinon (dérive de
 * teinte et de saturation) : `ordre` + `ordre-fin` (la consigne de teinte mise en avant, puis répétée).
 */
export function variantesP3(cas: UnCas[], resultats: Resultats, modele = MODELE_CALIBRAGE): { variantes: [VarianteMoteur, VarianteMoteur]; clarte: number | null; chromatique: number | null } {
  const surfaces = cas.filter((c) => !c.choix).flatMap((c) => resultats.rendus[cleRendu(c.id, "actuel", "medium", modele)]?.note?.surfaces ?? []);
  const clarte = mediane(surfaces.map((s) => s.derive?.L).filter((v): v is number => typeof v === "number").map(Math.abs));
  const chromatique = mediane(surfaces.map((s) => s.chromatique).filter((v): v is number => typeof v === "number"));
  const variantes: [VarianteMoteur, VarianteMoteur] = clarte !== null && chromatique !== null && clarte >= chromatique ? ["planche-neutre", "ordre"] : ["ordre", "ordre-fin"];
  return { variantes, clarte, chromatique };
}

/** P3 → P4 : la meilleure variante sur les 8 cas (ΔE médian après correction, contre `actuel`), et si son gain atteint 3. */
export function meilleureVariante(pires: UnCas[], variantes: VarianteMoteur[], resultats: Resultats, modele = MODELE_CALIBRAGE): { variante: VarianteMoteur | null; gain: number | null; parVariante: { variante: VarianteMoteur; mediane: number | null; gain: number | null }[]; p4: boolean } {
  const med = (v: VarianteMoteur) => {
    const scores = pires.map((c) => scoreApres(resultats.rendus[cleRendu(c.id, v, "medium", modele)]?.note ?? null)).filter(Number.isFinite);
    return scores.length === pires.length ? centile(scores, 50) : null;
  };
  const base = med("actuel");
  const parVariante = variantes.map((variante) => {
    const m = med(variante);
    return { variante, mediane: m === null ? null : arrondi(m), gain: m === null || base === null ? null : arrondi(base - m) };
  });
  const meilleure = parVariante.filter((p) => p.gain !== null).sort((a, b) => b.gain! - a.gain!)[0];
  return { variante: meilleure?.variante ?? null, gain: meilleure?.gain ?? null, parVariante, p4: !!meilleure && meilleure.gain! >= GAIN_MIN_P4 };
}

export function planDePhase(phase: PhaseCalibrage, definition: CasCalibrage, resultats: Resultats, o: Pick<OptionsCalibrage, "variantes" | "variante" | "cas"> & { modele?: string }): Plan {
  const modele = o.modele ?? MODELE_CALIBRAGE;
  const tous = definition.cas.filter((c) => !o.cas || o.cas.includes(c.id));
  const notes: string[] = [];
  const el = (c: UnCas, variante: VarianteMoteur, qualite: Qualite): ElementPlan => ({ cas: c, libelle: c.id, variante, qualite });
  if (phase === "P1") return { elements: tous.map((c) => el(c, "actuel", "medium")), notes: [`P1 : V2 + ${MODELE_CALIBRAGE} + prompt actuel, medium, sur les ${tous.filter((c) => !c.choix).length} cas du banc et ${tous.filter((c) => c.choix).length} rendu(s) « choix ».`] };
  if (phase === "P2") {
    const clients = tous.filter((c) => c.client);
    return { elements: clients.map((c) => el(c, "actuel", "low")), notes: [`P2 : les ${clients.length} cas « teinte du client » (4 du banc + le rendu « choix »), en low.`] };
  }
  const p1Complet = definition.cas.filter((c) => !c.choix).every((c) => resultats.rendus[cleRendu(c.id, "actuel", "medium", modele)]?.ok);
  if (phase === "P3") {
    const regle = p1Complet ? variantesP3(definition.cas, resultats, modele) : null;
    const autres = o.variantes ?? regle?.variantes ?? (["planche-neutre", "ordre"] as VarianteMoteur[]);
    const variantes: VarianteMoteur[] = ["retouche", ...autres];
    if (regle) notes.push(`Règle écrite (P1) : |ΔL*| médian ${regle.clarte ?? "—"} contre ΔE à clarté égale ${regle.chromatique ?? "—"} → ${regle.variantes.join(" + ")}.`);
    if (!p1Complet) {
      notes.push(`P1 incomplète : les ${NOMBRE_PIRES} pires cas et les deux variantes à côté de retouche seront choisis d'après P1 (estimation sur ${NOMBRE_PIRES} cas × 3 variantes).`);
      return { elements: Array.from({ length: NOMBRE_PIRES }, (_, i) => variantes.map((v) => ({ cas: null, libelle: `pire-${i + 1}`, variante: v, qualite: "medium" as Qualite }))).flat(), notes };
    }
    const pires = choisirPires(definition.cas, resultats, NOMBRE_PIRES, modele).filter((c) => !o.cas || o.cas.includes(c.id));
    notes.push(`P3 : les ${pires.length} pires cas de P1 (ΔE médian après correction) : ${pires.map((c) => c.id).join(", ")} ; variantes ${variantes.join(", ")}.`);
    return { elements: pires.flatMap((c) => variantes.map((v) => el(c, v, "medium"))), notes };
  }
  // P4 : la meilleure variante sur tous les cas (banc + « choix ») ; les rendus déjà faits en P3 sont repris.
  const variante = o.variante ?? "retouche";
  if (!o.variante) notes.push("P4 : variante à donner (--variante, la meilleure de P3) ; estimation faite avec « retouche ».");
  notes.push(`P4 : ${variante} sur les ${tous.length} cas, seulement si P3 montre un gain ≥ ${GAIN_MIN_P4} de ΔE médian après correction ; les rendus déjà faits en P3 sont repris, pas refaits.`);
  return { elements: tous.map((c) => el(c, variante, "medium")), notes };
}

/* ── Coûts : estimation, dépense relue, plafond ── */

/** Ce qui est déjà noté en phase `calibrage-23` dans GenerationImage (le chiffre du plafond et du rapport). */
export async function depenseCalibrage(depuis?: Date, phase = PHASE_CALIBRAGE): Promise<{ total: number; lignes: number; parModele: Record<string, { n: number; dollars: number }> }> {
  const lignes = await prisma.generationImage.findMany({ where: { phase, ...(depuis ? { createdAt: { gte: depuis } } : {}) }, select: { modele: true, coutDollars: true } });
  const parModele: Record<string, { n: number; dollars: number }> = {};
  let total = 0;
  for (const l of lignes) {
    const c = l.coutDollars ?? 0;
    total += c;
    const m = (parModele[l.modele] ??= { n: 0, dollars: 0 });
    m.n++;
    m.dollars += c;
  }
  return { total: Math.round(total * 10_000) / 10_000, lignes: lignes.length, parModele };
}

/** L'estimation d'un rendu du plan : la génération, le contrôle, et l'analyse de la photo si elle n'est pas encore faite. */
export const estimationElement = (e: Pick<ElementPlan, "qualite">, analyse: boolean) => ESTIMATION_RENDU[e.qualite] + ESTIMATION_VISION + (analyse ? ESTIMATION_VISION : 0);

/** L'estimation d'UN appel, pour la garde « plus du double » : la génération à sa qualité, un appel vision. */
const estimationAppel = (modele: string, qualite: Qualite) => (modele === MODELE_VISION ? ESTIMATION_VISION : ESTIMATION_RENDU[qualite]);

/** Un montant en dollars : deux décimales, trois quand la troisième compte (un contrôle vision vaut 0,005 $). */
const dollars = (n: number) => {
  const t = n.toFixed(3);
  return `${(t.endsWith("0") ? n.toFixed(2) : t).replace(".", ",")} $`;
};
const arrondi3 = (n: number) => Math.round(n * 1000) / 1000;

/* ── La note d'un rendu (gratuite, locale) ── */

async function referencesMesure(zones: { ref: string }[]): Promise<ReferenceMesure[]> {
  const sortie: ReferenceMesure[] = [];
  for (const ref of [...new Set(zones.map((z) => z.ref))]) {
    const r = await lireReference(ref);
    if (r?.hex) sortie.push({ ref: r.id, nom: r.nom, hex: r.hex, classe: classeTexture(r) });
  }
  return sortie;
}

export async function noterRendu(avant: Buffer, rendu: Buffer, zones: { zone: string; ref: string }[]): Promise<{ note: NoteRendu; image: Buffer }> {
  const { corrigerTeintes } = await import("@/lib/simulations/correction-teintes");
  const references = await referencesMesure(zones);
  const r = await corrigerTeintes({ avant, apres: rendu, zones, references, appliquer: true });
  const surfaces: SurfaceNotee[] = r.mesure.surfaces.map((s) => {
    const f = r.fidelite.find((x) => x.ref === s.ref);
    return { ref: s.ref, deltaE: s.deltaE, chromatique: s.deltaEChromatique, derive: s.derive, texturePerdue: s.texture.perdue, etat: f?.etat ?? "a_regenerer", raison: f?.raison ?? null, deltaECorrige: f?.deltaEApres ?? null };
  });
  const de = surfaces.map((s) => s.deltaE).filter((v): v is number => typeof v === "number");
  const ch = surfaces.map((s) => s.chromatique).filter((v): v is number => typeof v === "number");
  const apres = surfaces.map((s) => (s.etat === "a_regenerer" || s.deltaECorrige === null ? s.deltaE : s.deltaECorrige)).filter((v): v is number => typeof v === "number");
  const note: NoteRendu = {
    douteux: r.mesure.masque.douteux,
    raisonsDouteux: r.mesure.masque.raisons,
    surfaces,
    deltaEMedian: de.length ? arrondi(centile(de, 50)) : null,
    chromatiqueMedian: ch.length ? arrondi(centile(ch, 50)) : null,
    texturesPerdues: surfaces.filter((s) => s.texturePerdue).length,
    contoursHorsMasque: r.mesure.respect.contoursHorsMasque,
    partHorsDemande: r.mesure.respect.partHorsDemande,
    deltaECorrigeMedian: apres.length ? arrondi(centile(apres, 50)) : null,
    aRegenerer: surfaces.filter((s) => s.etat === "a_regenerer").length,
    corrigee: r.corrigee,
  };
  return { note, image: r.image };
}

/* ── Le bilan d'une phase (tableau lisible, chiffres du rapport) ── */

export function bilanDePhase(phase: PhaseCalibrage, definition: CasCalibrage, resultats: Resultats, modele = MODELE_CALIBRAGE): string[] {
  // P4 : ses rendus, plus ceux de P3 de la même variante (repris, pas refaits).
  const duModele = Object.values(resultats.rendus).filter((r) => r.modele === modele);
  const varianteP4 = duModele.find((r) => r.phase === "P4")?.variante ?? null;
  const rendus = duModele.filter((r) => r.phase === phase || (phase === "P4" && r.variante === varianteP4 && r.qualite === "medium"));
  const lignes: string[] = [];
  const parVariante = new Map<string, ResultatCas[]>();
  for (const r of rendus) parVariante.set(`${r.variante} · ${r.qualite}`, [...(parVariante.get(`${r.variante} · ${r.qualite}`) ?? []), r]);
  lignes.push("| Variante | Rendus (ok / échecs) | ΔE médian | 90e c. | à clarté égale | textures perdues | contours hors masque (méd.) | hors demande (méd.) | ΔE corrigé médian | à régénérer | coût réel |");
  lignes.push("|---|---|---|---|---|---|---|---|---|---|---|");
  for (const [nom, liste] of parVariante) {
    const surfaces = liste.flatMap((r) => r.note?.surfaces ?? []);
    const v = (f: (s: SurfaceNotee) => number | null) => surfaces.map(f).filter((x): x is number => typeof x === "number");
    const de = v((s) => s.deltaE);
    const apres = v((s) => (s.etat === "a_regenerer" || s.deltaECorrige === null ? s.deltaE : s.deltaECorrige));
    const ok = liste.filter((r) => r.ok);
    const f = (n: number | null) => (n === null ? "—" : String(arrondi(n)).replace(".", ","));
    lignes.push(
      `| ${nom} | ${ok.length} / ${liste.length - ok.length} | ${f(mediane(de))} | ${f(de.length ? centile(de, 90) : null)} | ${f(mediane(v((s) => s.chromatique)))} | ${surfaces.filter((s) => s.texturePerdue).length} / ${surfaces.length} | ${f(mediane(ok.map((r) => r.note?.contoursHorsMasque ?? NaN).filter(Number.isFinite)))} | ${f(mediane(ok.map((r) => (r.note?.partHorsDemande ?? NaN) * 100).filter(Number.isFinite)))} % | ${f(mediane(apres))} | ${surfaces.filter((s) => s.etat === "a_regenerer").length} / ${surfaces.length} | ${dollars(liste.reduce((s, r) => s + r.coutDollars, 0))} |`
    );
  }
  if (phase === "P1" && definition.cas.filter((c) => !c.choix).every((c) => resultats.rendus[cleRendu(c.id, "actuel", "medium", modele)]?.ok)) {
    const regle = variantesP3(definition.cas, resultats, modele);
    lignes.push(`Pour P3 : pires cas ${choisirPires(definition.cas, resultats, NOMBRE_PIRES, modele).map((c) => c.id).join(", ")} ; |ΔL*| médian ${regle.clarte ?? "—"} contre ΔE à clarté égale ${regle.chromatique ?? "—"} → retouche + ${regle.variantes.join(" + ")}.`);
  }
  if (phase === "P3") {
    const pires = choisirPires(definition.cas, resultats, NOMBRE_PIRES, modele);
    const variantes = [...new Set(rendus.map((r) => r.variante))].filter((v) => v !== "actuel");
    const m = meilleureVariante(pires, variantes, resultats, modele);
    for (const p of m.parVariante) lignes.push(`- ${p.variante} : ΔE médian après correction ${p.mediane ?? "—"} (gain contre actuel ${p.gain ?? "—"})${p.gain !== null && Math.abs(p.gain) < ECART_SIGNIFICATIF ? " — moins de 2 : pas un résultat" : ""}.`);
    lignes.push(m.p4 ? `Meilleure : ${m.variante} (gain ${m.gain} ≥ ${GAIN_MIN_P4}) → P4 autorisée.` : `Aucune variante ne gagne ${GAIN_MIN_P4} de ΔE médian après correction → pas de P4 : on garde le prompt actuel et l'argent.`);
  }
  return lignes;
}

/* ── L'exécution ── */

export type DependancesCalibrage = {
  /** Essais : le générateur d'images (sinon `genererRendu`, le vrai). Il reçoit le modèle et la phase explicitement. */
  generateur?: Generateur;
  journal?: (ligne: string) => void;
  env?: Record<string, string | undefined>;
  /** Essais seulement : une phase à part par essai (les lignes de GenerationImage ne se modifient ni ne s'effacent). */
  phaseNotee?: string;
};

export type BilanCalibrage = { phase: PhaseCalibrage | null; estimeDollars: number; dejaDollars: number; lances: number; reussis: number; echecs: number; arret: string | null; depenseDollars: number; lignes: string[] };

async function lireResultats(fichier: string): Promise<Resultats> {
  return existsSync(fichier) ? (JSON.parse(await fs.readFile(fichier, "utf8")) as Resultats) : { version: 1, rendus: {} };
}

async function ecrireJson(fichier: string, valeur: unknown): Promise<void> {
  await fs.mkdir(path.dirname(fichier), { recursive: true });
  await fs.writeFile(fichier, JSON.stringify(valeur, null, 2) + "\n");
}

function cheminPhoto(dossierJeu: string, id: string): string {
  for (const nom of ["avant.jpg", "avant.jpeg", "avant.png", "avant.webp"]) {
    const f = path.join(dossierJeu, id, nom);
    if (existsSync(f)) return f;
  }
  throw new Error(`Photo du jeu introuvable : ${id}.`);
}

export async function executerCalibrage(argv: string[], dependances: DependancesCalibrage = {}): Promise<BilanCalibrage> {
  const journal = dependances.journal ?? ((l: string) => console.log(l));
  const phaseNotee = dependances.phaseNotee ?? PHASE_CALIBRAGE;
  const env = dependances.env ?? process.env;
  const o = lireOptionsCalibrage(argv);
  verifierBaseLocale(env);
  const banc = path.join(o.dossier, "banc");
  const definition = lireCasCalibrage(await fs.readFile(path.join(banc, "cas.json"), "utf8"));
  const dossierJeu = path.resolve(o.dossier, definition.jeu);
  const fichierResultats = path.join(banc, "resultats.json");
  const resultats = await lireResultats(fichierResultats);
  const bilan: BilanCalibrage = { phase: o.phase, estimeDollars: 0, dejaDollars: 0, lances: 0, reussis: 0, echecs: 0, arret: null, depenseDollars: 0, lignes: [] };

  if (o.bilan) {
    bilan.lignes = bilanDePhase(o.bilan, definition, resultats, o.modele);
    for (const l of bilan.lignes) journal(l);
    return bilan;
  }
  if (o.aveugle) {
    const planches = await planchesPourAveugle(o.aveugle, definition, resultats, banc, o);
    journal(`Planches à l'aveugle (${o.aveugle}${o.corrige ? ", rendus corrigés" : ", rendus bruts"}) : ${planches.planches} planche(s) dans ${planches.dossier} ; la clé est à part (${path.basename(planches.cle)}), à n'ouvrir qu'après avoir noté.`);
    return bilan;
  }

  const phase = o.phase!;
  const plan = planDePhase(phase, definition, resultats, o);
  for (const n of plan.notes) journal(n);
  const aFaire = plan.elements.filter((e) => !e.cas || !resultats.rendus[cleRendu(e.cas.id, e.variante, e.qualite, o.modele)]?.ok);
  // Analyses de photo à faire : les photos du plan sans analyse prête dans la base (une par photo, payée au premier rendu).
  const photosSansAnalyse = new Set<string>();
  for (const id of new Set(aFaire.map((e) => e.cas?.photo).filter((p): p is string => !!p))) {
    const octets = await fs.readFile(cheminPhoto(dossierJeu, id));
    const prete = await prisma.analysePhoto.findFirst({ where: { empreinte: empreintePhoto(octets), statut: "PRETE", archiveLe: null } });
    if (!prete) photosSansAnalyse.add(id);
  }
  const vues = new Set<string>();
  bilan.estimeDollars = arrondi3(
    aFaire.reduce((s, e) => {
      const analyse = !!e.cas && photosSansAnalyse.has(e.cas.photo) && !vues.has(e.cas.photo);
      if (e.cas) vues.add(e.cas.photo);
      return s + estimationElement(e, analyse);
    }, 0)
  );
  const deja = await depenseCalibrage(undefined, phaseNotee);
  bilan.dejaDollars = deja.total;
  journal(`Phase ${phase} : ${aFaire.length} rendu(s) à faire sur ${plan.elements.length} (${plan.elements.length - aFaire.length} déjà faits), modèle ${o.modele} passé explicitement, moteur V2, une tentative par cas, contrôle vision compris.`);
  journal(`Estimation : ${aFaire.length} × (rendu ${dollars(ESTIMATION_RENDU[aFaire[0]?.qualite ?? "medium"])} + contrôle ${dollars(ESTIMATION_VISION)}) + ${photosSansAnalyse.size} analyse(s) de photo × ${dollars(ESTIMATION_VISION)} = ${dollars(bilan.estimeDollars)} (au pire ${dollars(arrondi3(bilan.estimeDollars + aFaire.length * ESTIMATION_RENDU[aFaire[0]?.qualite ?? "medium"]))} si chaque rendu était rejoué une fois).`);
  journal(`Déjà noté en phase ${phaseNotee} : ${dollars(deja.total)} ; après cette phase : ≈ ${dollars(deja.total + bilan.estimeDollars)} ; plafond ${dollars(o.plafond)}.`);
  if (deja.total + bilan.estimeDollars > o.plafond) journal("L'estimation dépasse le plafond : la phase s'arrêtera avant le premier appel qui le franchirait.");
  if (o.estimer) return bilan;

  // ── Lancement payant ──
  if (plan.elements.some((e) => !e.cas)) throw new Error(`${phase} : P1 n'est pas complète, les cas de la phase ne sont pas encore connus.`);
  if (phase === "P4") {
    const m = meilleureVariante(choisirPires(definition.cas, resultats, NOMBRE_PIRES, o.modele), VARIANTES_MOTEUR.filter((v) => v !== "actuel"), resultats, o.modele);
    if (!m.p4) throw new Error(`P4 refusée : aucune variante de P3 ne gagne ${GAIN_MIN_P4} de ΔE médian après correction (meilleure : ${m.variante ?? "—"}, gain ${m.gain ?? "—"}).`);
    if (o.variante !== m.variante) throw new Error(`P4 : --variante ${m.variante} (la meilleure de P3), pas ${o.variante ?? "rien"}.`);
  }
  if (env[VARIABLE_PAYANT] !== "1") throw new Error(`Lancement payant refusé : passer ${VARIABLE_PAYANT}=1 sur la ligne de commande de cette commande (voir docs/CALIBRAGE-SIMULATEUR.md). Rien n'a été appelé.`);
  if (!dependances.generateur && !env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY absente de l'environnement de la commande : rien n'est lancé.");
  // La garde de l'essai local reste posée pour TOUT le reste (alertes, mails, SMS…), levée pour OpenAI seulement, ici.
  const gardeAvant = process.env.CRM_ESSAI_LOCAL;
  process.env.CRM_ESSAI_LOCAL = "1";
  leverGardePourCanaux(["openai-images", "openai-vision"]);
  journal(`Garde de l'essai local : posée pour tous les canaux (${essaiLocal() ? "active" : "inactive"}), levée pour OpenAI images et vision dans ce processus seulement.`);
  process.env.UPLOADS_DIR = o.uploads; // catalogue et échantillons en cache, lus sur place
  const catalogue = JSON.parse(await fs.readFile(path.join(o.uploads, "simulateur", "catalogue.json"), "utf8")) as Reference[] | { references: Reference[] };
  definirCatalogueEssai(Array.isArray(catalogue) ? catalogue : catalogue.references);
  const generer = dependances.generateur ?? genererRendu;
  const rendus = path.join(banc, "rendus");
  await fs.mkdir(rendus, { recursive: true });
  const sharp = (await import("sharp")).default;

  try {
    boucle: for (const e of aFaire) {
      const c = e.cas!;
      const photo = definition.photos.find((p) => p.id === c.photo)!;
      const octets = await fs.readFile(cheminPhoto(dossierJeu, c.photo));
      const cle = cleRendu(c.id, e.variante, e.qualite, o.modele);
      const debutCas = Date.now();
      let appels = 0;
      let resultat: Awaited<ReturnType<typeof genererAvecMoteur>> | null = null;
      for (let essai = 1; essai <= 2; essai++) {
        const actuel = await depenseCalibrage(undefined, phaseNotee);
        const analyse = photosSansAnalyse.has(c.photo);
        const prevu = estimationElement(e, analyse);
        if (actuel.total + prevu > o.plafond) {
          bilan.arret = `ARRÊT avant ${cle} : ${dollars(actuel.total)} déjà + ${dollars(prevu)} prévus > plafond ${dollars(o.plafond)}.`;
          journal(bilan.arret);
          break boucle;
        }
        const debut = new Date();
        journal(`→ ${cle} (${photo.description}) — essai ${essai}, ≈ ${dollars(prevu)}…`);
        appels++;
        bilan.lances++;
        resultat = await genererAvecMoteur({
          photo: octets,
          piece: photo.piece as IdPiece,
          zones: c.zones as { zone: IdZone; ref: string }[],
          origine: "CRM",
          reglages: { ...REGLAGES_PAR_DEFAUT, moteur: "V2", planche: true, seuilControle: 0, correctionTeintes: false },
          qualite: e.qualite,
          generateur: (entree) => generer({ ...entree, modele: o.modele, phase: phaseNotee }),
          phaseNotee,
          variante: e.variante,
        });
        photosSansAnalyse.delete(c.photo);
        // Chaque appel relu : plus du double de son estimation arrête tout (garde de la série 2).
        const lignes = await prisma.generationImage.findMany({ where: { phase: phaseNotee, createdAt: { gte: debut } }, select: { modele: true, coutDollars: true } });
        const anormal = lignes.find((l) => (l.coutDollars ?? 0) > 2 * estimationAppel(l.modele, e.qualite));
        if (anormal) {
          bilan.arret = `ARRÊT : un appel ${anormal.modele} a coûté ${dollars(anormal.coutDollars ?? 0)}, plus du double de son estimation (${dollars(estimationAppel(anormal.modele, e.qualite))}).`;
          journal(bilan.arret);
        }
        if (resultat.ok || bilan.arret) break;
        journal(`  échec (${resultat.raison}) : ${resultat.message}`);
        if (resultat.raison === "config" || resultat.raison === "service-indisponible") {
          bilan.arret = `ARRÊT : ${resultat.raison} (clé, crédit ou garde) — inutile de continuer.`;
          journal(bilan.arret);
          break;
        }
        if (essai === 2) journal("  rejoué une fois : abandonné pour ce cas.");
      }
      if (!resultat) break;
      const cout = (await prisma.generationImage.aggregate({ _sum: { coutDollars: true }, where: { phase: phaseNotee, createdAt: { gte: new Date(debutCas) } } }))._sum.coutDollars ?? 0;
      const entree: ResultatCas = { cle, phase, cas: c.id, variante: e.variante, qualite: e.qualite, modele: o.modele, ok: resultat.ok, erreur: resultat.ok ? null : `${resultat.raison} : ${resultat.message}`, appels, coutDollars: Math.round(cout * 10_000) / 10_000, dureeMs: Date.now() - debutCas, scoreControle: resultat.ok ? resultat.scoreControle : null, fichier: null, corrige: null, avant: null, note: null, le: new Date().toISOString() };
      if (resultat.ok) {
        bilan.reussis++;
        const base = `${c.id}-${e.variante}-${e.qualite}`;
        const avant = resultat.avant ?? octets;
        entree.avant = `${c.photo}-avant.jpg`;
        if (!existsSync(path.join(rendus, entree.avant))) await sharp(avant).jpeg({ quality: 92 }).toFile(path.join(rendus, entree.avant));
        entree.fichier = `${base}.${extensionDe(resultat.type)}`;
        await fs.writeFile(path.join(rendus, entree.fichier), resultat.image);
        try {
          const { note, image } = await noterRendu(avant, resultat.image, c.zones);
          entree.note = note;
          entree.corrige = `${base}-corrige.jpg`;
          await sharp(image).jpeg({ quality: 92 }).toFile(path.join(rendus, entree.corrige));
          journal(`  ${dollars(entree.coutDollars)} réels · ΔE médian ${note.deltaEMedian ?? "—"} → corrigé ${note.deltaECorrigeMedian ?? "—"}${note.douteux ? " · masque douteux" : ""}${note.aRegenerer ? ` · ${note.aRegenerer} à régénérer` : ""}`);
        } catch (erreur) {
          journal(`  note impossible (${erreur instanceof Error ? erreur.message : erreur}) : rendu gardé, à mesurer à la main.`);
        }
      } else bilan.echecs++;
      resultats.rendus[cle] = entree;
      await ecrireJson(fichierResultats, resultats);
      if (bilan.arret) break;
    }
  } finally {
    retablirGarde();
    if (gardeAvant === undefined) process.env.CRM_ESSAI_LOCAL = "";
    else process.env.CRM_ESSAI_LOCAL = gardeAvant;
    definirCatalogueEssai(null);
  }
  const fin = await depenseCalibrage(undefined, phaseNotee);
  bilan.depenseDollars = fin.total;
  bilan.lignes = bilanDePhase(phase, definition, resultats, o.modele);
  for (const l of bilan.lignes) journal(l);
  journal(`Coût réel relu dans GenerationImage (phase ${phaseNotee}, base de DATABASE_URL) : ${dollars(fin.total)} au total${Object.entries(fin.parModele).map(([m, v]) => ` ; ${m} ${dollars(v.dollars)} × ${v.n}`).join("")}.`);
  return bilan;
}

/* ── Planches à l'aveugle ── */

async function planchesPourAveugle(phase: PhaseCalibrage, definition: CasCalibrage, resultats: Resultats, banc: string, o: OptionsCalibrage) {
  const rendus = path.join(banc, "rendus");
  const choisir = (r: ResultatCas | undefined) => (r?.ok ? (o.corrige ? r.corrige : r.fichier) : null);
  const cas = (phase === "P3" ? choisirPires(definition.cas, resultats, NOMBRE_PIRES, o.modele) : phase === "P2" ? definition.cas.filter((c) => c.client) : definition.cas).filter((c) => !o.cas || o.cas.includes(c.id));
  const lignes = cas.flatMap((c) => {
    const candidats = Object.values(resultats.rendus).filter((r) => r.cas === c.id && r.ok && r.modele === o.modele && (phase === "P2" ? r.variante === "actuel" : r.qualite === "medium") && (phase !== "P1" || r.variante === "actuel"));
    const colonnes = candidats.map((r) => ({ cle: `${r.variante}|${r.qualite}`, fichier: choisir(r) })).filter((x): x is { cle: string; fichier: string } => !!x.fichier).map((x) => ({ ...x, fichier: path.join(rendus, x.fichier) }));
    const avant = candidats[0]?.avant;
    return colonnes.length >= 2 && avant ? [{ id: c.id, avant: path.join(rendus, avant), colonnes }] : [];
  });
  return planchesAveugles({ dossier: path.join(banc, "aveugle", `${phase}${o.corrige ? "-corrige" : ""}`), cas: lignes, graine: o.graine });
}
