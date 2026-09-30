import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import prisma from "@/lib/prisma";
import { contientEmoji } from "@/lib/simulateur/moteur";
import { definirVisionEssai, type FournisseurVision } from "@/lib/simulateur/moteur/vision";
import { reglagesSimulateur } from "@/lib/simulateur/reglages";
import { ZONES_MAX, ZONES_SIMULATEUR, estIdPiece, estIdZone, piece as lirePiece, type IdPiece, type IdZone } from "@/lib/simulateur/zones";
import { tailleSelonRatio } from "./cadrage";
import { definirGenerateurEssai, extensionDe, genererAmbiance, typeImage, type AppelAmbiance, type FormatAmbiance, type Generateur } from "./generation";
import { genererAvecMoteur } from "./pipeline";
import { PRIX, coutEstime } from "./prix";

/**
 * Les images d'ambiance du site (mission 16, partie 2) — la logique de `scripts/generer-ambiances.ts`, lancé UNE fois
 * par l'orchestrateur (jamais par l'application, jamais par un test sans `--essai`) :
 *  - ambiances : pour chaque entrée de `scripts/ambiances.json` ({ nom, prompt, format, reserve? }), `gpt-image-1` en
 *    qualité high sur le prompt seul, PNG écrit dans `--sortie`, coût compté dans `GenerationImage` (origine CRM,
 *    phase `ambiance`, sans dossier), total affiché ; au plus `--max` appels (12 au plus) ; les réserves ne partent que
 *    nommées par `--seulement` ; une image déjà présente dans la sortie n'est pas refaite (rien n'est payé deux fois) ;
 *  - `--rendu <photo> --piece <pièce> --zones zone:REF,…` : UN rendu du moteur V2 (planche, qualité high, origine CRM,
 *    contrôle et seconde tentative sous le seuil comme partout) sur une photo d'ambiance « avant », écrit
 *    `<nom>-apres.<ext>` : l'image « après » de l'ouverture du site, étiquetée « Simulation » là-bas ;
 *  - `--essai` : aucune requête réseau vers OpenAI — une image unie à la place de chaque génération (les lignes
 *    `GenerationImage` sont écrites avec le modèle `essai`, à 0 $) ; en `--rendu`, le générateur et la vision
 *    simulés passent par `definirGenerateurEssai` / `definirVisionEssai` ;
 *  - `--estimer` : le plan et le coût estimé, rien d'autre (ni appel, ni fichier, ni ligne).
 * La clé `OPENAI_API_KEY` n'est jamais affichée : seulement « présente » ou « absente ».
 * En fin de lancement, le coût RÉEL est relu dans `GenerationImage` (`releverCouts`) et affiché par phase : c'est ce
 * chiffre qui va au rapport. Les lignes sont dans la base de DATABASE_URL — lancé sur le poste, la base locale : le
 * compteur de crédit de la prod ne les voit pas (noter ensuite le solde relevé chez OpenAI dans Paramètres).
 */

/** Le modèle des ambiances, quel que soit `OPENAI_IMAGE_MODEL` (celui des rendus). */
export const MODELE_AMBIANCE = "gpt-image-1";
/** Plafond de l'énoncé : douze images d'ambiance au plus. */
export const MAX_AMBIANCES = 12;
export const FORMATS_AMBIANCE = ["1536x1024", "1024x1536", "1024x1024"] as const satisfies readonly FormatAmbiance[];
/** Jetons de sortie d'une image `gpt-image-1` en qualité high (grille publique d'OpenAI) : l'essentiel du coût. */
export const JETONS_SORTIE_HIGH: Record<FormatAmbiance, number> = { "1024x1024": 4160, "1536x1024": 6240, "1024x1536": 6240 };
/** Extensions reconnues d'une image déjà présente dans la sortie. */
const EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp"];

const schemaAmbiance = z
  .object({
    nom: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "nom : minuscules, chiffres et tirets"),
    prompt: z.string().trim().min(80, "prompt trop court").max(4000),
    format: z.enum(FORMATS_AMBIANCE),
    reserve: z.boolean().optional(),
  })
  .strict();
export type Ambiance = z.infer<typeof schemaAmbiance>;

/** La liste des ambiances (le texte de `ambiances.json`), validée : 1 à 12 entrées, noms uniques, aucun emoji. */
export function lireListeAmbiances(texte: string): Ambiance[] {
  const liste = z.array(schemaAmbiance).min(1).max(MAX_AMBIANCES).parse(JSON.parse(texte));
  const noms = new Set<string>();
  for (const a of liste) {
    if (noms.has(a.nom)) throw new Error(`Ambiance en double : ${a.nom}.`);
    noms.add(a.nom);
    if (contientEmoji(a.prompt)) throw new Error(`Emoji dans le prompt de ${a.nom}.`);
  }
  return liste;
}

export type ZoneRendu = { zone: IdZone; ref: string };
export type OptionsAmbiances = {
  liste: string;
  sortie: string | null;
  max: number;
  seulement: string[] | null;
  sauf: string[];
  essai: boolean;
  estimer: boolean;
  rendu: { photo: string; piece: IdPiece; zones: ZoneRendu[] } | null;
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

/** Les options de la ligne de commande ; une option inconnue ou mal formée lève (rien n'est lancé). */
export function lireArguments(argv: string[]): OptionsAmbiances {
  const options: OptionsAmbiances = { liste: path.resolve(process.cwd(), "scripts", "ambiances.json"), sortie: null, max: MAX_AMBIANCES, seulement: null, sauf: [], essai: false, estimer: false, rendu: null };
  const valeurs = new Map<string, string>();
  const AVEC_VALEUR = new Set(["--liste", "--sortie", "--max", "--seulement", "--sauf", "--rendu", "--piece", "--zones"]);
  for (let i = 0; i < argv.length; i++) {
    const [cle, egal] = argv[i].includes("=") ? [argv[i].slice(0, argv[i].indexOf("=")), argv[i].slice(argv[i].indexOf("=") + 1)] : [argv[i], undefined];
    if (cle === "--essai") options.essai = true;
    else if (cle === "--estimer") options.estimer = true;
    else if (AVEC_VALEUR.has(cle)) {
      const valeur = egal ?? argv[++i];
      if (valeur === undefined || valeur.startsWith("--")) throw new Error(`${cle} attend une valeur.`);
      valeurs.set(cle, valeur);
    } else throw new Error(`Option inconnue : ${argv[i]}.`);
  }
  if (valeurs.has("--liste")) options.liste = path.resolve(valeurs.get("--liste")!);
  if (valeurs.has("--sortie")) options.sortie = path.resolve(valeurs.get("--sortie")!);
  if (valeurs.has("--max")) {
    const max = Number(valeurs.get("--max"));
    if (!Number.isInteger(max) || max < 1 || max > MAX_AMBIANCES) throw new Error(`--max : un entier de 1 à ${MAX_AMBIANCES}.`);
    options.max = max;
  }
  if (valeurs.has("--seulement")) options.seulement = liste(valeurs.get("--seulement")!);
  if (valeurs.has("--sauf")) options.sauf = liste(valeurs.get("--sauf")!);
  if (valeurs.has("--rendu")) {
    const piece = valeurs.get("--piece") ?? "";
    if (!estIdPiece(piece)) throw new Error(`--piece : une pièce du simulateur (cuisine, salle-de-bain, meubles, mur-plafond, professionnel), reçu « ${piece} ».`);
    if (!valeurs.has("--zones")) throw new Error("--rendu demande --zones zone:REF,…");
    options.rendu = { photo: path.resolve(valeurs.get("--rendu")!), piece, zones: lireZonesRendu(valeurs.get("--zones")!, piece) };
  } else if (valeurs.has("--piece") || valeurs.has("--zones")) throw new Error("--piece et --zones ne servent qu'avec --rendu.");
  return options;
}

/** Les ambiances demandées, dans l'ordre de la liste : `--seulement` (réserves comprises) sinon toutes hors réserve, moins `--sauf`. */
export function choisirAmbiances(ambiances: Ambiance[], options: Pick<OptionsAmbiances, "seulement" | "sauf">): Ambiance[] {
  const connus = new Set(ambiances.map((a) => a.nom));
  const inconnus = [...(options.seulement ?? []), ...options.sauf].filter((n) => !connus.has(n));
  if (inconnus.length > 0) throw new Error(`Ambiance(s) inconnue(s) : ${inconnus.join(", ")}.`);
  const sauf = new Set(options.sauf);
  const seulement = options.seulement ? new Set(options.seulement) : null;
  return ambiances.filter((a) => (seulement ? seulement.has(a.nom) : !a.reserve) && !sauf.has(a.nom));
}

/** Coût estimé en dollars (grille publique, qualité high) : jetons de sortie du format + prompt (≈ 4 caractères par jeton). */
export function estimerCoutAmbiances(ambiances: Pick<Ambiance, "format" | "prompt">[]): number {
  const prix = PRIX[MODELE_AMBIANCE];
  const total = ambiances.reduce((s, a) => s + (JETONS_SORTIE_HIGH[a.format] * prix.sortie + Math.ceil(a.prompt.length / 4) * prix.texte) / 1_000_000, 0);
  return Math.round(total * 100) / 100;
}

/** Le nom du rendu « après » : `ouverture-cuisine-avant.png` → `ouverture-cuisine-apres`. */
export function nomApres(photo: string): string {
  const base = path.basename(photo, path.extname(photo));
  return base.endsWith("-avant") ? `${base.slice(0, -"-avant".length)}-apres` : `${base}-apres`;
}

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
 * écrites depuis `depuis`, par phase (`ambiance` ; `rendu`, `analyse`, `controle` pour --rendu) et statut. L'outil MCP
 * `depenses` ne sert pas ici : il lit les dépenses de chantier (`Depense`), pas ces lignes. Une autre génération du CRM
 * sans dossier lancée au même moment sur la même base serait comptée aussi.
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
  const ordre = ["ambiance", "rendu", "analyse", "controle"];
  const parPhase = [...groupes.values()].sort((a, b) => (ordre.indexOf(a.phase) + 1 || 99) - (ordre.indexOf(b.phase) + 1 || 99) || a.statut.localeCompare(b.statut));
  return { lignes: lignes.length, totalDollars: Math.round(parPhase.reduce((s, g) => s + g.dollars, 0) * 10_000) / 10_000, parPhase };
}

export type BilanAmbiances = {
  essai: boolean;
  estimeDollars: number;
  totalDollars: number;
  ecrites: { nom: string; fichier: string; coutDollars: number }[];
  sautees: { nom: string; raison: string }[];
  echecs: { nom: string; raison: string }[];
  rendu: { fichier: string; moteur: string; tentatives: number; score: number | null; coutDollars: number } | null;
  /** Le coût réel relu dans `GenerationImage` en fin de lancement (null : rien de lancé, ou `--estimer`). */
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
  if (!options.sortie) throw new Error("--sortie <dossier> est obligatoire.");
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

/** Le script : lit les options, annonce le plan et le coût, puis génère (sauf `--estimer`). */
export async function executerAmbiances(argv: string[], journal: (ligne: string) => void = console.log): Promise<BilanAmbiances> {
  const options = lireArguments(argv);
  const debut = new Date();
  const bilan: BilanAmbiances = { essai: options.essai, estimeDollars: 0, totalDollars: 0, ecrites: [], sautees: [], echecs: [], rendu: null, releve: null };
  if (options.essai) journal("Mode essai : aucune requête vers OpenAI, des images unies à la place.");
  else if (!options.estimer) {
    journal(`OPENAI_API_KEY : ${process.env.OPENAI_API_KEY ? "présente" : "absente"}.`);
    if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY absente de l'environnement : rien n'est lancé.");
  }
  if (options.rendu) {
    await executerRendu({ ...options, rendu: options.rendu }, bilan, journal);
    return options.estimer ? bilan : avecReleve(bilan, debut, journal);
  }

  const toutes = lireListeAmbiances(await fs.readFile(options.liste, "utf8"));
  const demandees = choisirAmbiances(toutes, options);
  const reserves = toutes.filter((a) => a.reserve && !demandees.includes(a)).map((a) => a.nom);
  const aFaire: Ambiance[] = [];
  for (const a of demandees) {
    const present = options.sortie ? dejaLa(options.sortie, a.nom) : null;
    if (present) bilan.sautees.push({ nom: a.nom, raison: `déjà là (${path.basename(present)})` });
    else if (aFaire.length >= options.max) bilan.sautees.push({ nom: a.nom, raison: `--max ${options.max} atteint` });
    else aFaire.push(a);
  }
  bilan.estimeDollars = estimerCoutAmbiances(aFaire);
  journal(`Ambiances : ${aFaire.length} à générer (${MODELE_AMBIANCE}, high)${reserves.length ? `, en réserve : ${reserves.join(", ")}` : ""}${bilan.sautees.length ? `, sautées : ${bilan.sautees.map((s) => `${s.nom} (${s.raison})`).join(", ")}` : ""}.`);
  journal(`Coût estimé : ≈ ${dollars(bilan.estimeDollars)} (${aFaire.map((a) => a.format).join(", ") || "rien"}).`);
  if (options.estimer || aFaire.length === 0) return bilan;
  if (!options.sortie) throw new Error("--sortie <dossier> est obligatoire.");
  await fs.mkdir(options.sortie, { recursive: true });

  for (const [i, a] of aFaire.entries()) {
    const resultat = await genererAmbiance({ prompt: a.prompt, format: a.format, qualite: "high" }, options.essai ? { appel: appelEssai, modele: "essai" } : { modele: MODELE_AMBIANCE });
    if (!resultat.ok) {
      bilan.echecs.push({ nom: a.nom, raison: `${resultat.raison} : ${resultat.message}` });
      journal(`[${i + 1}/${aFaire.length}] ${a.nom} : ÉCHEC (${resultat.raison}).`);
      // Crédit épuisé ou clé refusée : les suivantes échoueraient pareil.
      if (resultat.raison === "service-indisponible" || resultat.raison === "config") break;
      continue;
    }
    const fichier = path.join(options.sortie, `${a.nom}.${extensionDe(typeImage(resultat.image))}`);
    await fs.writeFile(fichier, resultat.image);
    bilan.ecrites.push({ nom: a.nom, fichier, coutDollars: resultat.coutDollars });
    bilan.totalDollars = Math.round((bilan.totalDollars + resultat.coutDollars) * 10_000) / 10_000;
    journal(`[${i + 1}/${aFaire.length}] ${a.nom} (${a.format}) : ${fichier} — ${dollars(resultat.coutDollars)} en ${Math.round(resultat.dureeMs / 1000)} s.`);
  }
  journal(`Total : ${dollars(bilan.totalDollars)} pour ${bilan.ecrites.length} image(s)${bilan.echecs.length ? `, ${bilan.echecs.length} échec(s)` : ""} — lignes GenerationImage (origine CRM, phase ambiance).`);
  return avecReleve(bilan, debut, journal);
}
