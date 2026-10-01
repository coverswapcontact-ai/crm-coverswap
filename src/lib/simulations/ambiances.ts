import { existsSync, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import prisma from "@/lib/prisma";
import { contientEmoji } from "@/lib/simulateur/moteur";
import { definirVisionEssai, type FournisseurVision } from "@/lib/simulateur/moteur/vision";
import { reglagesSimulateur } from "@/lib/simulateur/reglages";
import { ZONES_MAX, ZONES_SIMULATEUR, estIdPiece, estIdZone, piece as lirePiece, type IdPiece, type IdZone } from "@/lib/simulateur/zones";
import { tailleSelonRatio } from "./cadrage";
import { QUALITES_AMBIANCE, definirGenerateurEssai, extensionDe, genererAmbiance, typeImage, type AppelAmbiance, type FormatAmbiance, type Generateur, type QualiteAmbiance } from "./generation";
import { genererAvecMoteur } from "./pipeline";
import { plancheContours, planche } from "./planches";
import { PRIX, coutEstime } from "./prix";

/**
 * Les images du site — la logique de `scripts/generer-ambiances.ts`, lancé à la main par l'orchestrateur (jamais par
 * l'application, jamais par un test sans `--essai` ou un appel simulé) :
 *  - mission 19 (liste `scripts/photos-site-v2.json`, le défaut) : `{ essais_par_image, images: [{ nom, mode, source?,
 *    format, fond?, etiquette, prompt }] }`. Chaque image produit `essais_par_image` essais `<nom>-1.png`, `-2`, `-3`
 *    (`--essais N` pour changer). `--phase 1` : les générations (texte → image, `gpt-image-2.5-flare`) ; `--phase 2` :
 *    les éditions (`/images/edits`, `gpt-image-2.5-sunburst`) à partir de l'essai CHOISI de leur source
 *    (`--choix source=n,…` ; sans choix, l'image n'est pas lancée), les « avant » d'abord, puis les éditions d'une
 *    édition. Modèles réglables par `OPENAI_IMAGE_MODEL_GENERATION` / `OPENAI_IMAGE_MODEL_EDITION` (ce script
 *    seulement : le simulateur garde `OPENAI_IMAGE_MODEL`). Qualité `high` par défaut (`--qualite`). Plafond de
 *    dépense du lancement (`--plafond`, 30 $) vérifié avant chaque appel. `--planches` : les planches de choix (et de
 *    contours des paires avant/après), sans aucun appel payant ;
 *  - mission 16 (ancienne liste `scripts/ambiances.json`, un tableau, lisible si on la passe par `--liste`) : un essai
 *    par image, nommé `<nom>.png` comme alors ; les réserves ne partent que nommées par `--seulement` ;
 *  - `--rendu <photo> --piece <pièce> --zones zone:REF,…` : UN rendu du moteur V2 (planche, qualité high, origine CRM,
 *    contrôle et seconde tentative sous le seuil comme partout) sur une photo « avant », écrit `<nom>-apres.<ext>` ;
 *  - `--essai` : aucune requête réseau vers OpenAI — une image unie à la place de chaque génération ou édition (les
 *    lignes `GenerationImage` sont écrites avec le modèle `essai`, à 0 $) ; en `--rendu`, le générateur et la vision
 *    simulés passent par `definirGenerateurEssai` / `definirVisionEssai` ;
 *  - `--estimer` : le plan et le coût estimé, rien d'autre (ni appel, ni fichier, ni ligne).
 * Sortie par défaut hors dépôt : `~/coverswap-photos/`. Une image déjà présente n'est jamais refaite. Coûts comptés dans
 * `GenerationImage` (origine CRM, sans dossier, phase `ambiance` en génération et `ambiance-edition` en édition).
 * La clé `OPENAI_API_KEY` n'est jamais affichée : seulement « présente » ou « absente ».
 * En fin de lancement, le coût RÉEL est relu dans `GenerationImage` (`releverCouts`) et affiché par phase : c'est ce
 * chiffre qui va au rapport. Les lignes sont dans la base de DATABASE_URL — lancé sur le poste, la base locale : le
 * compteur de crédit de la prod ne les voit pas (noter ensuite le solde relevé chez OpenAI dans Paramètres).
 */

/** Modèles de la mission 19 (présents dans /v1/models le 30/09/2026) ; ce script seulement. */
export const MODELE_GENERATION_DEFAUT = "gpt-image-2.5-flare";
export const MODELE_EDITION_DEFAUT = "gpt-image-2.5-sunburst";
export const modeleGeneration = () => process.env.OPENAI_IMAGE_MODEL_GENERATION || MODELE_GENERATION_DEFAUT;
export const modeleEdition = () => process.env.OPENAI_IMAGE_MODEL_EDITION || MODELE_EDITION_DEFAUT;
/** Plafond de dépense d'un lancement, en dollars (coût réel déjà dépensé + estimation de l'appel suivant). */
export const PLAFOND_DEFAUT = 30;
export const ESSAIS_MAX = 10;
export const FORMATS_AMBIANCE = ["1536x1024", "1024x1536", "1024x1024"] as const satisfies readonly FormatAmbiance[];
export const listeParDefaut = () => path.resolve(process.cwd(), "scripts", "photos-site-v2.json");
export const sortieParDefaut = () => path.join(os.homedir(), "coverswap-photos");

/*
 * Hypothèses de l'estimation (à recaler sur le coût réel relu dans GenerationImage après un premier lancement) :
 *  - jetons de SORTIE par image selon le format et la qualité — pour high : 1024x1024 ≈ 4 160, 1536x1024 et
 *    1024x1536 ≈ 6 240 : l'ordre de grandeur de gpt-image-1 (grille publique), faute de grille publiée pour 2.5 ;
 *    low et medium d'après la même grille ; xhigh (×1,5) et max (×2) : pures hypothèses ;
 *  - + le texte du prompt : ~500 jetons au prix du texte ;
 *  - + pour une édition, l'image d'entrée : ~1 500 jetons au prix de l'image (8 $ / M pour 2.5).
 */
export const JETONS_SORTIE: Record<QualiteAmbiance, Record<FormatAmbiance, number>> = {
  low: { "1024x1024": 272, "1536x1024": 408, "1024x1536": 408 },
  medium: { "1024x1024": 1056, "1536x1024": 1584, "1024x1536": 1584 },
  high: { "1024x1024": 4160, "1536x1024": 6240, "1024x1536": 6240 },
  xhigh: { "1024x1024": 6240, "1536x1024": 9360, "1024x1536": 9360 },
  max: { "1024x1024": 8320, "1536x1024": 12480, "1024x1536": 12480 },
};
export const JETONS_TEXTE_PROMPT = 500;
export const JETONS_IMAGE_EDITION = 1500;
/** Extensions reconnues d'une image déjà présente dans la sortie. */
const EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp"];

const schemaNom = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "nom : minuscules, chiffres et tirets");
const schemaPrompt = z.string().trim().min(80, "prompt trop court").max(4000);

/* ── Ancienne liste (mission 16) : un tableau ── */
const schemaAmbiance = z.object({ nom: schemaNom, prompt: schemaPrompt, format: z.enum(FORMATS_AMBIANCE), reserve: z.boolean().optional() }).strict();
export type Ambiance = z.infer<typeof schemaAmbiance>;

/** L'ancienne liste des ambiances (le texte de `ambiances.json`), validée : au moins une entrée, noms uniques, aucun emoji. */
export function lireListeAmbiances(texte: string): Ambiance[] {
  const liste = z.array(schemaAmbiance).min(1).parse(JSON.parse(texte));
  const noms = new Set<string>();
  for (const a of liste) {
    if (noms.has(a.nom)) throw new Error(`Ambiance en double : ${a.nom}.`);
    noms.add(a.nom);
    if (contientEmoji(a.prompt)) throw new Error(`Emoji dans le prompt de ${a.nom}.`);
  }
  return liste;
}

/* ── Liste de la mission 19 : { essais_par_image, images } ── */
const schemaImageSite = z
  .object({
    nom: schemaNom,
    mode: z.enum(["generation", "edition"]),
    source: schemaNom.optional(),
    format: z.enum(FORMATS_AMBIANCE),
    fond: z.literal("transparent").optional(),
    etiquette: z.string().trim().min(1).max(40),
    prompt: schemaPrompt,
  })
  .strict();
const schemaListeSite = z.object({ essais_par_image: z.number().int().min(1).max(ESSAIS_MAX), images: z.array(schemaImageSite).min(1) }).strict();

export type ImageSite = z.infer<typeof schemaImageSite> & { reserve?: boolean };
export type ListeImages = { essais: number; images: ImageSite[]; /** Ancienne liste (mission 16) : un essai nommé `<nom>.png`. */ ancienFormat: boolean };

/**
 * La liste des images, validée strictement avant tout appel : noms uniques, aucun emoji ; une édition a une source,
 * une génération n'en a pas ; la source existe, n'est pas l'image elle-même et est déclarée PLUS HAUT dans la liste
 * (l'ordre logique : on ne retouche qu'une image déjà produite, et aucune boucle n'est possible) ; format parmi les
 * trois ; `fond: "transparent"` accepté en génération comme en édition, la sortie étant toujours en PNG (le seul cas
 * refusé par le service serait un JPEG). L'ancienne liste (un tableau) est lue comme des générations à un essai.
 */
export function lireListeImages(texte: string): ListeImages {
  const brut: unknown = JSON.parse(texte);
  if (Array.isArray(brut)) {
    const images = lireListeAmbiances(texte).map((a): ImageSite => ({ nom: a.nom, mode: "generation", format: a.format, etiquette: "Ambiance", prompt: a.prompt, ...(a.reserve ? { reserve: true } : {}) }));
    return { essais: 1, images, ancienFormat: true };
  }
  const liste = schemaListeSite.parse(brut);
  const vus = new Map<string, ImageSite>();
  for (const image of liste.images) {
    if (vus.has(image.nom)) throw new Error(`Image en double : ${image.nom}.`);
    if (contientEmoji(image.prompt)) throw new Error(`Emoji dans le prompt de ${image.nom}.`);
    if (image.mode === "edition") {
      if (!image.source) throw new Error(`${image.nom} : une édition demande une source.`);
      if (image.source === image.nom) throw new Error(`${image.nom} : une image ne peut pas être sa propre source.`);
      if (!vus.has(image.source)) {
        const plusBas = liste.images.some((i) => i.nom === image.source);
        throw new Error(`${image.nom} : source ${image.source} ${plusBas ? "déclarée plus bas dans la liste (elle doit la précéder)" : "inconnue"}.`);
      }
    } else if (image.source) throw new Error(`${image.nom} : une génération n'a pas de source (mode edition ?).`);
    vus.set(image.nom, image);
  }
  return { essais: liste.essais_par_image, images: liste.images, ancienFormat: false };
}

export type ZoneRendu = { zone: IdZone; ref: string };
export type OptionsAmbiances = {
  liste: string;
  sortie: string;
  /** Limite d'appels du lancement (aucune par défaut). */
  max: number | null;
  seulement: string[] | null;
  sauf: string[];
  essai: boolean;
  estimer: boolean;
  rendu: { photo: string; piece: IdPiece; zones: ZoneRendu[] } | null;
  phase: 1 | 2 | null;
  /** Essai choisi par image source : `--choix nom=n,…`. */
  choix: Map<string, number>;
  essais: number | null;
  qualite: QualiteAmbiance;
  plafond: number;
  planches: boolean;
  fideliteHaute: boolean;
};

const liste = (v: string) => v.split(",").map((s) => s.trim()).filter(Boolean);

/** `meubles-hauts:K1,plan-de-travail:MK15` → zones du moteur, vérifiées contre la pièce (au plus quatre, sans conflit). */
export function lireZonesRendu(texte: string, pieceId: IdPiece): ZoneRendu[] {
  const zones = liste(texte).map((paire) => {
    const [zone, ref, ...reste] = paire.split(":").map((s) => s.trim());
    if (!zone || !ref || reste.length > 0) throw new Error(`Zone mal écrite : « ${paire} » (attendu zone:REF).`);
    if (!estIdZone(zone)) throw new Error(`Zone inconnue : ${zone}.`);
    if (!lirePiece(pieceId).zones.includes(zone)) throw new Error(`La zone ${zone} n'appartient pas à la pièce ${pieceId}.`);
    if (!/^[A-Za-z0-9_-]{1,16}$/.test(ref)) throw new Error(`Référence invalide : ${ref}.`);
    return { zone, ref };
  });
  if (zones.length === 0) throw new Error("--zones : au moins une zone (zone:REF).");
  if (zones.length > ZONES_MAX) throw new Error(`Au plus ${ZONES_MAX} zones par rendu.`);
  const ids = zones.map((z) => z.zone);
  if (new Set(ids).size !== ids.length) throw new Error("Une zone apparaît deux fois.");
  for (const z of zones) {
    const conflit = (ZONES_SIMULATEUR[z.zone].exclut ?? []).find((e) => ids.includes(e));
    if (conflit) throw new Error(`Les zones ${z.zone} et ${conflit} se recouvrent.`);
  }
  return zones;
}

/** `ouverture-cuisine-apres=2,etude-meubles-apres=1` → l'essai choisi par image source. */
export function lireChoix(texte: string): Map<string, number> {
  const choix = new Map<string, number>();
  for (const paire of liste(texte)) {
    const [nom, numero, ...reste] = paire.split("=").map((s) => s.trim());
    const n = Number(numero);
    if (!nom || !numero || reste.length > 0 || !Number.isInteger(n) || n < 1) throw new Error(`--choix mal écrit : « ${paire} » (attendu nom=numéro, numéro ≥ 1).`);
    if (choix.has(nom)) throw new Error(`--choix : ${nom} choisi deux fois.`);
    choix.set(nom, n);
  }
  return choix;
}

const entierBorne = (cle: string, texte: string, min: number, max: number) => {
  const n = Number(texte);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${cle} : un entier de ${min} à ${max}.`);
  return n;
};

/** Les options de la ligne de commande ; une option inconnue ou mal formée lève (rien n'est lancé). */
export function lireArguments(argv: string[]): OptionsAmbiances {
  const options: OptionsAmbiances = {
    liste: listeParDefaut(),
    sortie: sortieParDefaut(),
    max: null,
    seulement: null,
    sauf: [],
    essai: false,
    estimer: false,
    rendu: null,
    phase: null,
    choix: new Map(),
    essais: null,
    qualite: "high",
    plafond: PLAFOND_DEFAUT,
    planches: false,
    fideliteHaute: false,
  };
  const valeurs = new Map<string, string>();
  const AVEC_VALEUR = new Set(["--liste", "--sortie", "--max", "--seulement", "--sauf", "--rendu", "--piece", "--zones", "--phase", "--choix", "--essais", "--qualite", "--plafond"]);
  for (let i = 0; i < argv.length; i++) {
    const [cle, egal] = argv[i].includes("=") ? [argv[i].slice(0, argv[i].indexOf("=")), argv[i].slice(argv[i].indexOf("=") + 1)] : [argv[i], undefined];
    if (cle === "--essai") options.essai = true;
    else if (cle === "--estimer") options.estimer = true;
    else if (cle === "--planches") options.planches = true;
    else if (cle === "--fidelite-haute") options.fideliteHaute = true;
    else if (AVEC_VALEUR.has(cle)) {
      const valeur = egal ?? argv[++i];
      if (valeur === undefined || valeur.startsWith("--")) throw new Error(`${cle} attend une valeur.`);
      valeurs.set(cle, valeur);
    } else throw new Error(`Option inconnue : ${argv[i]}.`);
  }
  if (valeurs.has("--liste")) options.liste = path.resolve(valeurs.get("--liste")!);
  if (valeurs.has("--sortie")) options.sortie = path.resolve(valeurs.get("--sortie")!);
  if (valeurs.has("--max")) options.max = entierBorne("--max", valeurs.get("--max")!, 1, 10_000);
  if (valeurs.has("--seulement")) options.seulement = liste(valeurs.get("--seulement")!);
  if (valeurs.has("--sauf")) options.sauf = liste(valeurs.get("--sauf")!);
  if (valeurs.has("--phase")) options.phase = entierBorne("--phase", valeurs.get("--phase")!, 1, 2) as 1 | 2;
  if (valeurs.has("--choix")) options.choix = lireChoix(valeurs.get("--choix")!);
  if (valeurs.has("--essais")) options.essais = entierBorne("--essais", valeurs.get("--essais")!, 1, ESSAIS_MAX);
  if (valeurs.has("--qualite")) {
    const qualite = valeurs.get("--qualite")!;
    if (!(QUALITES_AMBIANCE as readonly string[]).includes(qualite)) throw new Error(`--qualite : ${QUALITES_AMBIANCE.join(", ")} (reçu « ${qualite} »).`);
    options.qualite = qualite as QualiteAmbiance;
  }
  if (valeurs.has("--plafond")) {
    const plafond = Number(valeurs.get("--plafond")!.replace(",", "."));
    if (!Number.isFinite(plafond) || plafond <= 0) throw new Error("--plafond : un montant en dollars, positif.");
    options.plafond = plafond;
  }
  if (valeurs.has("--rendu")) {
    const piece = valeurs.get("--piece") ?? "";
    if (!estIdPiece(piece)) throw new Error(`--piece : une pièce du simulateur (cuisine, salle-de-bain, meubles, mur-plafond, professionnel), reçu « ${piece} ».`);
    if (!valeurs.has("--zones")) throw new Error("--rendu demande --zones zone:REF,…");
    options.rendu = { photo: path.resolve(valeurs.get("--rendu")!), piece, zones: lireZonesRendu(valeurs.get("--zones")!, piece) };
  } else if (valeurs.has("--piece") || valeurs.has("--zones")) throw new Error("--piece et --zones ne servent qu'avec --rendu.");
  return options;
}

/** Les ambiances demandées, dans l'ordre de la liste : `--seulement` (réserves comprises) sinon toutes hors réserve, moins `--sauf`. */
export function choisirAmbiances<T extends { nom: string; reserve?: boolean }>(ambiances: T[], options: Pick<OptionsAmbiances, "seulement" | "sauf">): T[] {
  const connus = new Set(ambiances.map((a) => a.nom));
  const inconnus = [...(options.seulement ?? []), ...options.sauf].filter((n) => !connus.has(n));
  if (inconnus.length > 0) throw new Error(`Ambiance(s) inconnue(s) : ${inconnus.join(", ")}.`);
  const sauf = new Set(options.sauf);
  const seulement = options.seulement ? new Set(options.seulement) : null;
  return ambiances.filter((a) => (seulement ? seulement.has(a.nom) : !a.reserve) && !sauf.has(a.nom));
}

/** Profondeur d'édition : 0 pour une génération, 1 pour l'édition d'une génération, 2 pour l'édition d'une édition… */
function profondeur(image: ImageSite, parNom: Map<string, ImageSite>): number {
  let n = 0;
  for (let i: ImageSite | undefined = image; i?.mode === "edition"; i = i.source ? parNom.get(i.source) : undefined) n++;
  return n;
}

/**
 * Les images d'une phase, dans l'ordre de lancement. Phase 1 : les générations sans source ; phase 2 : les éditions,
 * les « avant » (source générée) d'abord, puis celles dont la source est elle-même une édition (ordre de la liste à
 * profondeur égale). Sans phase (ancienne liste seulement) : tout. Puis `--seulement` / `--sauf` (et les réserves de
 * l'ancienne liste).
 */
export function imagesDeLaPhase(liste: ListeImages, options: Pick<OptionsAmbiances, "phase" | "seulement" | "sauf">): { images: ImageSite[]; horsPhase: string[] } {
  const parNom = new Map(liste.images.map((i) => [i.nom, i]));
  const dansLaPhase = (i: ImageSite) => options.phase === null || (options.phase === 1 ? i.mode === "generation" && !i.source : i.mode === "edition");
  const choisies = choisirAmbiances(liste.images, options);
  const images = choisies
    .filter(dansLaPhase)
    .map((image, rang) => ({ image, rang, profondeur: profondeur(image, parNom) }))
    .sort((a, b) => a.profondeur - b.profondeur || a.rang - b.rang)
    .map((e) => e.image);
  const horsPhase = (options.seulement ?? []).filter((n) => !images.some((i) => i.nom === n) && !options.sauf.includes(n));
  return { images, horsPhase };
}

/** Le modèle d'un appel selon son mode (réglable par variable d'environnement, ce script seulement). */
export const modeleDe = (image: Pick<ImageSite, "mode">) => (image.mode === "edition" ? modeleEdition() : modeleGeneration());

/** Coût estimé d'UN appel, en dollars non arrondis (hypothèses en tête de fichier). */
export function estimerAppel(image: Pick<ImageSite, "mode" | "format">, qualite: QualiteAmbiance = "high", modele = modeleDe(image)): number {
  const prix = PRIX[modele] ?? PRIX["gpt-image-1"];
  const jetons = JETONS_SORTIE[qualite][image.format] * prix.sortie + JETONS_TEXTE_PROMPT * prix.texte + (image.mode === "edition" ? JETONS_IMAGE_EDITION * prix.image : 0);
  return jetons / 1_000_000;
}

/** Coût estimé en dollars (arrondi au centime) d'une série d'appels (générations par défaut). */
export function estimerCoutAmbiances(images: (Pick<ImageSite, "format"> & { mode?: ImageSite["mode"] })[], qualite: QualiteAmbiance = "high"): number {
  const total = images.reduce((s, i) => s + estimerAppel({ mode: i.mode ?? "generation", format: i.format }, qualite), 0);
  return Math.round(total * 100) / 100;
}

/** Le texte des hypothèses d'estimation (affiché par `--estimer`). */
export function hypothesesEstimation(qualite: QualiteAmbiance): string {
  const j = JETONS_SORTIE[qualite];
  const f = (n: number) => n.toLocaleString("fr-FR").replace(/\s/g, " ");
  return (
    `Hypothèses de l'estimation : jetons de sortie par image en qualité ${qualite} — 1024x1024 ≈ ${f(j["1024x1024"])}, 1536x1024 et 1024x1536 ≈ ${f(j["1536x1024"])} ` +
    `(ordre de grandeur de gpt-image-1, à recaler sur le coût réel) au prix de sortie du modèle (30 $/M pour gpt-image-2.5) ; + ~${f(JETONS_TEXTE_PROMPT)} jetons de texte par prompt (5 $/M) ; ` +
    `+ pour une édition ~${f(JETONS_IMAGE_EDITION)} jetons d'image d'entrée (8 $/M). Cache d'entrée non compté.`
  );
}

/** Le nom du rendu « après » : `ouverture-cuisine-avant.png` → `ouverture-cuisine-apres`. */
export function nomApres(photo: string): string {
  const base = path.basename(photo, path.extname(photo));
  return base.endsWith("-avant") ? `${base.slice(0, -"-avant".length)}-apres` : `${base}-apres`;
}

/** Le nom (sans extension) de l'essai n d'une image : `<nom>-n` ; `<nom>` pour l'ancienne liste à un seul essai. */
export const nomEssai = (nom: string, n: number, sansSuffixe = false) => (sansSuffixe ? nom : `${nom}-${n}`);

const dollars = (n: number) => `${n.toFixed(2).replace(".", ",")} $`;
const dejaLa = (sortie: string, nom: string) => EXTENSIONS.map((e) => path.join(sortie, `${nom}${e}`)).find((f) => existsSync(f)) ?? null;
/** Un nom encore libre dans la sortie (`x.jpg`, sinon `x-2.jpg`, `x-3.jpg`…) : un rendu déjà payé n'est jamais écrasé. */
function fichierLibre(sortie: string, base: string, extension: string): string {
  for (let n = 1; ; n++) {
    const nom = n === 1 ? base : `${base}-${n}`;
    if (!dejaLa(sortie, nom)) return path.join(sortie, `${nom}.${extension}`);
  }
}

async function imageUnie(largeur: number, hauteur: number, graine: string, format: "png" | "jpeg"): Promise<Buffer> {
  const sharp = (await import("sharp")).default;
  let h = 0;
  for (const c of graine) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const image = sharp({ create: { width: largeur, height: hauteur, channels: 3, background: { r: 90 + (h % 120), g: 90 + ((h >> 8) % 120), b: 90 + ((h >> 16) % 120) } } });
  return format === "png" ? image.png().toBuffer() : image.jpeg({ quality: 80 }).toBuffer();
}

/** Mode essai des ambiances : une image unie au format demandé, aucun jeton, aucune requête. */
const appelEssai: AppelAmbiance = async (demande) => {
  const [l, h] = demande.size.split("x").map(Number);
  return { ok: true, b64: (await imageUnie(l, h, demande.prompt, "png")).toString("base64"), usage: { texte: 0, image: 0, sortie: 0 } };
};

/** Mode essai du rendu : une image unie aux dimensions de la photo, sans réseau. */
const generateurEssai: Generateur = async (entree) => {
  const sharp = (await import("sharp")).default;
  const meta = await sharp(entree.photo).metadata();
  const [l, h] = [meta.width ?? 1024, meta.height ?? 1024];
  return { ok: true, image: await imageUnie(l, h, entree.prompt.slice(0, 64), "jpeg"), type: "image/jpeg", avant: null, taille: tailleSelonRatio(l, h), dureeMs: 0, usage: { texte: 0, image: 0, sortie: 0 }, coutDollars: 0, generationId: null };
};

/** Mode essai du rendu : une analyse neutre et un contrôle parfait (aucune seconde tentative), sans réseau. */
const visionEssai: FournisseurVision = async (demande) => ({
  texte: JSON.stringify(
    demande.schema.nom === "analyse_photo"
      ? { description: "Test mode: no real analysis of the photograph.", zones_visibles: {}, objets: [], lumiere: { source: "daylight", direction: "from the left", temperature: "neutral", dominante: "none" }, format: "paysage", qualite_photo: { verdict: "bonne", conseil: "" } }
      : { score: 10, defauts: [] }
  ),
  jetonsEntree: 0,
  jetonsSortie: 0,
});

export type ReleveCouts = {
  lignes: number;
  totalDollars: number;
  parPhase: { phase: string; statut: string; lignes: number; dollars: number }[];
};

/**
 * Le coût réel d'un lancement, relu dans `GenerationImage` (base de DATABASE_URL) : les lignes origine CRM sans dossier
 * écrites depuis `depuis`, par phase (`ambiance`, `ambiance-edition` ; `rendu`, `analyse`, `controle` pour --rendu) et
 * statut. L'outil MCP `depenses` ne sert pas ici : il lit les dépenses de chantier (`Depense`), pas ces lignes. Une
 * autre génération du CRM sans dossier lancée au même moment sur la même base serait comptée aussi.
 */
export async function releverCouts(depuis: Date): Promise<ReleveCouts> {
  const lignes = await prisma.generationImage.findMany({ where: { origine: "CRM", dossierId: null, createdAt: { gte: depuis } }, select: { phase: true, statut: true, coutDollars: true } });
  const groupes = new Map<string, ReleveCouts["parPhase"][number]>();
  for (const l of lignes) {
    const cle = `${l.phase}|${l.statut}`;
    const g = groupes.get(cle) ?? { phase: l.phase, statut: l.statut, lignes: 0, dollars: 0 };
    g.lignes += 1;
    g.dollars = Math.round((g.dollars + (l.coutDollars ?? 0)) * 10_000) / 10_000;
    groupes.set(cle, g);
  }
  const ordre = ["ambiance", "ambiance-edition", "rendu", "analyse", "controle"];
  const parPhase = [...groupes.values()].sort((a, b) => (ordre.indexOf(a.phase) + 1 || 99) - (ordre.indexOf(b.phase) + 1 || 99) || a.statut.localeCompare(b.statut));
  return { lignes: lignes.length, totalDollars: Math.round(parPhase.reduce((s, g) => s + g.dollars, 0) * 10_000) / 10_000, parPhase };
}

export type BilanAmbiances = {
  essai: boolean;
  estimeDollars: number;
  totalDollars: number;
  /** Nombre d'appels lancés (hors reprise sans `input_fidelity`). */
  appels: number;
  ecrites: { nom: string; essai: number; fichier: string; coutDollars: number }[];
  sautees: { nom: string; essai?: number; raison: string }[];
  /** Éditions non lancées : source non choisie (`--choix`) ou essai choisi absent de la sortie. */
  bloquees: { nom: string; raison: string }[];
  echecs: { nom: string; essai?: number; raison: string }[];
  /** Le lancement s'est arrêté net au plafond de dépense. */
  plafondAtteint: boolean;
  planches: { nom: string; fichier: string; largeur: number; hauteur: number; scores?: { essai: number; ecart: number }[] }[];
  rendu: { fichier: string; moteur: string; tentatives: number; score: number | null; coutDollars: number } | null;
  /** Le coût réel relu dans `GenerationImage` en fin de lancement (null : rien de lancé, `--estimer` ou `--planches`). */
  releve: ReleveCouts | null;
};

/** Relit le coût réel du lancement et l'affiche : la ligne à reprendre au rapport. */
async function avecReleve(bilan: BilanAmbiances, depuis: Date, journal: (ligne: string) => void): Promise<BilanAmbiances> {
  bilan.releve = await releverCouts(depuis);
  const detail = bilan.releve.parPhase.map((g) => `${g.phase}${g.statut === "REUSSI" ? "" : ` (${g.statut.toLowerCase()})`} ${dollars(g.dollars)} × ${g.lignes}`).join(" · ");
  journal(`Coût réel relu dans GenerationImage (base de DATABASE_URL, origine CRM, sans dossier, depuis le début du lancement) : ${detail || "aucune ligne"} — total ${dollars(bilan.releve.totalDollars)}.`);
  return bilan;
}

async function executerRendu(options: OptionsAmbiances & { rendu: NonNullable<OptionsAmbiances["rendu"]> }, bilan: BilanAmbiances, journal: (ligne: string) => void): Promise<BilanAmbiances> {
  const { photo, piece, zones } = options.rendu;
  if (!existsSync(photo)) throw new Error(`Photo « avant » introuvable : ${photo}.`);
  const films = new Set(zones.map((z) => z.ref)).size;
  // Planche : une seule image jointe, quel que soit le nombre de films ; au pire deux tentatives (contrôle sous le seuil).
  bilan.estimeDollars = coutEstime(1, "high");
  journal(`Rendu du moteur V2 (planche, high, origine CRM) sur ${path.basename(photo)} : ${piece}, ${zones.map((z) => `${z.zone} → ${z.ref}`).join(", ")} (${films} film(s)).`);
  journal(`Coût estimé : ≈ ${dollars(bilan.estimeDollars)} par tentative, ${dollars(bilan.estimeDollars * 2)} au pire (seconde tentative sous le seuil), plus l'analyse et le contrôle (≈ 0,01 $).`);
  if (options.estimer) return bilan;
  await fs.mkdir(options.sortie, { recursive: true });
  if (options.essai) {
    definirGenerateurEssai(generateurEssai);
    definirVisionEssai(visionEssai);
  }
  try {
    const reglages = { ...(await reglagesSimulateur()), moteur: "V2" as const, planche: true };
    const brute = await fs.readFile(photo);
    // En essai, la photo est réencodée (même image, autres octets) : l'analyse simulée est mise en cache sous une autre
    // empreinte que la vraie photo, et le vrai rendu lancé ensuite ne la réutilisera jamais.
    const octets = options.essai ? await (await import("sharp")).default(brute).withExif({ IFD0: { ImageDescription: "CoverSwap essai" } }).jpeg({ quality: 92 }).toBuffer() : brute;
    const resultat = await genererAvecMoteur({ photo: octets, piece, zones, origine: "CRM", reglages, qualite: "high" });
    if (!resultat.ok) {
      bilan.echecs.push({ nom: nomApres(photo), raison: `${resultat.raison} : ${resultat.message}` });
      journal(`ÉCHEC du rendu (${resultat.raison}) : ${resultat.message}`);
      return bilan;
    }
    const fichier = fichierLibre(options.sortie, nomApres(photo), extensionDe(resultat.type));
    await fs.writeFile(fichier, resultat.image);
    if (resultat.avant) {
      // La photo a été recadrée au format du modèle : c'est cette version qu'il faut montrer en « avant » (superposable).
      const avant = path.join(options.sortie, `${path.basename(photo, path.extname(photo))}-cadree.jpg`);
      await fs.writeFile(avant, resultat.avant);
      journal(`Photo recadrée au format du modèle : l'« avant » superposable est ${avant}.`);
    }
    bilan.totalDollars = resultat.coutTotalDollars;
    bilan.rendu = { fichier, moteur: resultat.moteur, tentatives: resultat.tentatives, score: resultat.scoreControle, coutDollars: resultat.coutTotalDollars };
    journal(`Rendu écrit : ${fichier} — contrôle ${resultat.scoreControle ?? "sans note"}/10, ${resultat.tentatives} tentative(s), ${dollars(resultat.coutTotalDollars)} (rendu et contrôle ; l'analyse est comptée à part dans GenerationImage).`);
    return bilan;
  } finally {
    if (options.essai) {
      definirGenerateurEssai(null);
      definirVisionEssai(null);
    }
  }
}

/**
 * Les `--choix` contrôlés contre la liste : image connue, numéro d'un essai possible (au plus le nombre d'essais de la
 * liste, ou de `--essais` s'il est plus grand : la source a pu être produite par un autre lancement).
 */
function verifierChoix(liste: ListeImages, choix: Map<string, number>, essais: number): void {
  for (const [nom, n] of choix) {
    if (!liste.images.some((i) => i.nom === nom)) throw new Error(`--choix : image inconnue « ${nom} ».`);
    if (n > essais) throw new Error(`--choix ${nom}=${n} : il n'y a que ${essais} essai(s) par image.`);
  }
}

type Appel = { image: ImageSite; essai: number; /** L'essai choisi de la source (édition) : son nom de fichier sans extension. */ source: string | null };

/** Les planches de choix de la phase (et les contours des paires avant/après), sans aucun appel payant. */
async function executerPlanches(images: ImageSite[], liste: ListeImages, essais: number, options: OptionsAmbiances, bilan: BilanAmbiances, journal: (ligne: string) => void): Promise<BilanAmbiances> {
  const parNom = new Map(liste.images.map((i) => [i.nom, i]));
  const sansSuffixe = liste.ancienFormat && essais === 1;
  const dossier = path.join(options.sortie, "planches");
  journal(`Planches de choix (aucun appel payant) : ${images.length} image(s), essais lus dans ${options.sortie}, planches écrites dans ${dossier}.`);
  for (const image of images) {
    const presents = Array.from({ length: essais }, (_, i) => ({ numero: i + 1, fichier: dejaLa(options.sortie, nomEssai(image.nom, i + 1, sansSuffixe)) })).filter((e): e is { numero: number; fichier: string } => e.fichier !== null);
    if (presents.length === 0) {
      journal(`${image.nom} : aucun essai dans la sortie, pas de planche.`);
      continue;
    }
    const numeroSource = image.source ? options.choix.get(image.source) : undefined;
    const source = image.source && numeroSource ? dejaLa(options.sortie, nomEssai(image.source, numeroSource)) : null;
    if (image.mode === "edition" && !source) journal(`${image.nom} : source ${image.source} ${numeroSource ? `choisie (${numeroSource}) mais absente de la sortie` : "non choisie (--choix)"} — planche sans la source.`);
    const tuiles = [...(source ? [{ fichier: source, etiquette: "source" }] : []), ...presents.map((e) => ({ fichier: e.fichier, etiquette: String(e.numero) }))];
    const fichier = path.join(dossier, `${image.nom}.jpg`);
    const dims = await planche(tuiles, fichier, { damier: image.fond === "transparent" });
    const ligne: BilanAmbiances["planches"][number] = { nom: image.nom, fichier, ...dims };
    bilan.planches.push(ligne);
    journal(`${image.nom} : ${fichier} (${presents.length} essai(s)${source ? " + source" : ""}, ${dims.largeur}×${dims.hauteur}).`);
    // Paire avant/après : l'édition d'une image générée (pas l'édition d'une édition, comme etape-photo, qui recadre).
    const sourceImage = image.source ? parNom.get(image.source) : undefined;
    if (source && sourceImage?.mode === "generation") {
      const contours = path.join(dossier, `${image.nom}-contours.jpg`);
      const resultat = await plancheContours(source, presents, contours);
      bilan.planches.push({ nom: `${image.nom}-contours`, fichier: contours, largeur: resultat.largeur, hauteur: resultat.hauteur, scores: resultat.scores });
      journal(`${image.nom} : contours contre ${path.basename(source)} → ${resultat.scores.map((s) => `essai ${s.essai} écart ${s.ecart.toFixed(1).replace(".", ",")}`).join(" · ")} (plus petit = mieux) ; ${contours}.`);
    }
  }
  if (bilan.planches.length === 0) journal("Aucune planche : aucun essai trouvé dans la sortie pour cette phase.");
  return bilan;
}

/** Le script : lit les options, annonce le plan et le coût, puis génère (sauf `--estimer` et `--planches`). */
export async function executerAmbiances(argv: string[], journal: (ligne: string) => void = console.log): Promise<BilanAmbiances> {
  const options = lireArguments(argv);
  const debut = new Date();
  const bilan: BilanAmbiances = { essai: options.essai, estimeDollars: 0, totalDollars: 0, appels: 0, ecrites: [], sautees: [], bloquees: [], echecs: [], plafondAtteint: false, planches: [], rendu: null, releve: null };
  if (options.essai) journal("Mode essai : aucune requête vers OpenAI, des images unies à la place.");
  else if (!options.estimer && !options.planches) {
    journal(`OPENAI_API_KEY : ${process.env.OPENAI_API_KEY ? "présente" : "absente"}.`);
    if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY absente de l'environnement : rien n'est lancé.");
  }
  if (options.rendu) {
    await executerRendu({ ...options, rendu: options.rendu }, bilan, journal);
    return options.estimer ? bilan : avecReleve(bilan, debut, journal);
  }

  const lue = lireListeImages(await fs.readFile(options.liste, "utf8"));
  if (!lue.ancienFormat && options.phase === null) throw new Error("--phase 1 (générations) ou --phase 2 (éditions) : obligatoire avec cette liste.");
  const essais = options.essais ?? lue.essais;
  const sansSuffixe = lue.ancienFormat && essais === 1;
  const essaisSource = Math.max(lue.essais, essais);
  verifierChoix(lue, options.choix, essaisSource);
  const { images, horsPhase } = imagesDeLaPhase(lue, options);
  if (horsPhase.length > 0) journal(`Hors de la phase ${options.phase} (ignorées) : ${horsPhase.join(", ")}.`);
  if (options.planches) return executerPlanches(images, lue, essais, options, bilan, journal);

  // Le plan : chaque essai de chaque image, sauf ceux déjà là ; une édition sans source choisie n'est pas lancée.
  const aFaire: Appel[] = [];
  for (const image of images) {
    let source: string | null = null;
    if (image.mode === "edition") {
      const n = image.source ? options.choix.get(image.source) : undefined;
      if (!image.source || !n) {
        bilan.bloquees.push({ nom: image.nom, raison: `source ${image.source} non choisie : ajouter --choix ${image.source}=<1 à ${essaisSource}> (après avoir regardé sa planche)` });
        continue;
      }
      source = nomEssai(image.source, n);
    }
    for (let k = 1; k <= essais; k++) {
      const present = dejaLa(options.sortie, nomEssai(image.nom, k, sansSuffixe));
      if (present) bilan.sautees.push({ nom: image.nom, essai: k, raison: `déjà là (${path.basename(present)})` });
      else if (options.max !== null && aFaire.length >= options.max) bilan.sautees.push({ nom: image.nom, essai: k, raison: `--max ${options.max} atteint` });
      else aFaire.push({ image, essai: k, source });
    }
  }
  bilan.estimeDollars = Math.round(aFaire.reduce((s, a) => s + estimerAppel(a.image, options.qualite), 0) * 100) / 100;

  const modeles = [...new Set(aFaire.map((a) => modeleDe(a.image)))];
  const libellePhase = options.phase === null ? "Ancienne liste (mission 16)" : options.phase === 1 ? "Phase 1 (générations)" : "Phase 2 (éditions)";
  const nbImages = new Set(aFaire.map((a) => a.image.nom)).size;
  journal(`Liste : ${options.liste} — ${lue.images.length} image(s), ${essais} essai(s) par image${options.essais ? " (--essais)" : ""}.`);
  journal(`${libellePhase} : ${nbImages} image(s), ${aFaire.length} appel(s) (${options.essai ? "essai" : modeles.join(", ") || modeleDe({ mode: options.phase === 2 ? "edition" : "generation" })}, qualité ${options.qualite}) ; sortie : ${options.sortie}.`);
  for (const image of images) {
    const appels = aFaire.filter((a) => a.image === image);
    if (appels.length === 0) continue;
    const details = [image.format, image.fond === "transparent" ? "fond transparent" : null, image.etiquette, appels[0].source ? `source ${appels[0].source}` : null].filter(Boolean).join(", ");
    journal(`  - ${image.nom} (${details}) : essai(s) ${appels.map((a) => a.essai).join(", ")}`);
  }
  const parFormat = FORMATS_AMBIANCE.map((f) => [f, aFaire.filter((a) => a.image.format === f).length] as const).filter(([, n]) => n > 0);
  if (parFormat.length) journal(`Formats : ${parFormat.map(([f, n]) => `${f} × ${n}`).join(", ")}.`);
  const reserves = lue.images.filter((i) => i.reserve && !images.includes(i)).map((i) => i.nom);
  if (reserves.length) journal(`En réserve : ${reserves.join(", ")}.`);
  if (bilan.sautees.length) journal(`Sautées : ${bilan.sautees.map((s) => `${sansSuffixe ? s.nom : nomEssai(s.nom, s.essai ?? 1)} (${s.raison})`).join(", ")}.`);
  for (const b of bilan.bloquees) journal(`Non lancée : ${b.nom} — ${b.raison}.`);
  journal(`Coût estimé : ≈ ${dollars(bilan.estimeDollars)} (${aFaire.length} appel(s)) ; plafond du lancement ${dollars(options.plafond)}${bilan.estimeDollars > options.plafond ? " — le plan le DÉPASSE : arrêt net avant l'appel qui le franchirait" : ""}.`);
  journal(hypothesesEstimation(options.qualite));
  if (options.estimer || aFaire.length === 0) return bilan;
  await fs.mkdir(options.sortie, { recursive: true });

  let fideliteHaute = options.fideliteHaute;
  let depense = 0;
  for (const [i, a] of aFaire.entries()) {
    const etiquette = `[${i + 1}/${aFaire.length}] ${nomEssai(a.image.nom, a.essai, sansSuffixe)}`;
    const estime = estimerAppel(a.image, options.qualite);
    if (depense + estime > options.plafond) {
      bilan.plafondAtteint = true;
      journal(`PLAFOND : ${dollars(depense)} déjà dépensés + ≈ ${dollars(estime)} pour ${nomEssai(a.image.nom, a.essai, sansSuffixe)} dépasseraient ${dollars(options.plafond)} — arrêt net, ${aFaire.length - i} appel(s) non lancé(s) (--plafond pour le relever).`);
      break;
    }
    let source: { octets: Buffer; type: ReturnType<typeof typeImage>; nom: string } | null = null;
    if (a.source) {
      const fichierSource = dejaLa(options.sortie, a.source);
      if (!fichierSource) {
        bilan.bloquees.push({ nom: a.image.nom, raison: `essai choisi ${a.source} absent de ${options.sortie}` });
        journal(`${etiquette} : non lancée, l'essai choisi ${a.source} est absent de la sortie.`);
        continue;
      }
      const octets = await fs.readFile(fichierSource);
      source = { octets, type: typeImage(octets), nom: path.basename(fichierSource) };
    }
    const modele = options.essai ? "essai" : modeleDe(a.image);
    const resultat = await genererAmbiance(
      { prompt: a.image.prompt, format: a.image.format, qualite: options.qualite, source, fond: a.image.fond ?? null, fideliteHaute },
      options.essai ? { appel: appelEssai, modele, journal } : { modele, journal }
    );
    bilan.appels += 1;
    if (!resultat.ok) {
      bilan.echecs.push({ nom: a.image.nom, essai: a.essai, raison: `${resultat.raison} : ${resultat.message}` });
      journal(`${etiquette} : ÉCHEC (${resultat.raison}).`);
      // Crédit épuisé ou clé refusée : les suivantes échoueraient pareil.
      if (resultat.raison === "service-indisponible" || resultat.raison === "config") break;
      continue;
    }
    if (resultat.fideliteRetiree && fideliteHaute) {
      fideliteHaute = false;
      journal(`input_fidelity n'est plus envoyé pour la suite du lancement (refusé par ${modele}).`);
    }
    const fichier = path.join(options.sortie, `${nomEssai(a.image.nom, a.essai, sansSuffixe)}.${extensionDe(typeImage(resultat.image))}`);
    await fs.writeFile(fichier, resultat.image);
    bilan.ecrites.push({ nom: a.image.nom, essai: a.essai, fichier, coutDollars: resultat.coutDollars });
    depense = Math.round((depense + resultat.coutDollars) * 10_000) / 10_000;
    bilan.totalDollars = depense;
    journal(`${etiquette} (${a.image.format}${a.source ? `, depuis ${a.source}` : ""}) : ${fichier} — ${dollars(resultat.coutDollars)} en ${Math.round(resultat.dureeMs / 1000)} s (cumul ${dollars(depense)}).`);
  }
  journal(`Total : ${dollars(bilan.totalDollars)} pour ${bilan.ecrites.length} image(s)${bilan.echecs.length ? `, ${bilan.echecs.length} échec(s)` : ""}${bilan.plafondAtteint ? ", arrêté au plafond" : ""} — lignes GenerationImage (origine CRM, phases ambiance / ambiance-edition).`);
  return avecReleve(bilan, debut, journal);
}
