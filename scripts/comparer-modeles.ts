// Mission 21, E5 — comparatif des modèles d'édition du simulateur : la MÊME simulation (même consigne, mêmes zones, mêmes
// matières, choisies une fois pour toutes ci-dessous) rendue sur quelques photos de cuisine avec gpt-image-1 (le modèle
// actuel) puis gpt-image-2.5-sunburst, le modèle passé explicitement à chaque appel (jamais OPENAI_IMAGE_MODEL). Lancé à
// la main, jamais par l'application ; ne change aucun réglage.
//
//   node --import tsx scripts/comparer-modeles.ts --estimer        (rien n'est appelé : le plan et le coût annoncé)
//   node --import tsx scripts/comparer-modeles.ts                  (les rendus, la mesure et la planche)
//   node --import tsx scripts/comparer-modeles.ts --planche        (mesure et planche seulement, depuis les rendus écrits)
//
// Options : --plafond D (2 $ par défaut : dépense déjà notée en phase « essai-modele » + estimation de l'appel suivant,
// sinon arrêt avant l'appel) ; --seulement a,b ; --uploads <dossier> (défaut .uploads du CRM, d'où les photos sont LUES
// sur place) ; --sortie <dossier> (défaut ~/coverswap-photos/essai-modeles, hors dépôt, jamais publié).
// Chaque appel est noté dans GenerationImage (phase « essai-modele ») de la base de DATABASE_URL ; un appel dont la ligne
// n'a pas pu être écrite arrête tout (le plafond ne se lirait plus). Clé OPENAI_API_KEY de l'environnement, jamais affichée.
//
// LIMITE : la base locale ne contient que des images d'essai (photos d'illustration et de banque d'images, rendus
// générés), aucune vraie photo de client prise au téléphone. Les quatre retenues sont les plus proches d'une vraie pièce.
import { existsSync, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import prisma from "../src/lib/prisma";
import { definirCatalogueEssai, type Reference } from "../src/lib/simulateur/catalogue";
import { REGLAGES_PAR_DEFAUT } from "../src/lib/simulateur/reglages";
import type { IdZone } from "../src/lib/simulateur/zones";
import { genererRendu, extensionDe } from "../src/lib/simulations/generation";
import { genererAvecMoteur } from "../src/lib/simulations/pipeline";
import { ecartContours } from "../src/lib/simulations/planches";
import { deltaE, hexVersRgb, mesurerImage, type Rgb, type Zone } from "../src/lib/simulations/teintes";

const PHASE = "essai-modele";
const MODELES = ["gpt-image-1", "gpt-image-2.5-sunburst"] as const;
type Modele = (typeof MODELES)[number];
/** Coût prévu d'un rendu (medium, 1536 × 1024, photo + 2 échantillons), volontairement haut ; remplacé par le plus cher déjà payé pour ce modèle. */
const ESTIMATION: Record<Modele, number> = { "gpt-image-1": 0.3, "gpt-image-2.5-sunburst": 0.12 };
const BLANC_CIBLE: Rgb = hexVersRgb("#F2F2F2");

/** La simulation, la même partout : façades Sage Green (RM20), plan de travail Original Oak (AA14), qualité du site (medium), moteur V1 (réglage de production). */
const SIMULATION = { piece: "cuisine" as const, zones: [{ zone: "facades-cuisine" as IdZone, ref: "RM20" }, { zone: "plan-de-travail" as IdZone, ref: "AA14" }], qualite: "medium" as const };

type Surface = { surface: string; ref: string; zones: Zone[] };
type Photo = { nom: string; chemin: string; description: string; blanc: { objet: string; zone: Zone }; surfaces: Surface[] };

/** Les quatre photos (chemins relatifs au dossier d'upload) et, pour la mesure, des zones bien éclairées en % de l'image. */
const PHOTOS: Photo[] = [
  {
    nom: "noire-ilot",
    chemin: "dossiers/cmuo6wgqa0013btt4ppviepzu/photos/muo6wgve-b2432f12.jpg",
    description: "cuisine noire mate en L, îlot bois, suspensions",
    blanc: { objet: "mur blanc à droite", zone: [79, 28, 10, 8] },
    surfaces: [
      { surface: "colonnes", ref: "RM20", zones: [[38, 36, 6, 18]] },
      { surface: "îlot (façade)", ref: "RM20", zones: [[56, 74, 14, 10]] },
      { surface: "plan de l'îlot", ref: "AA14", zones: [[56, 65.5, 14, 2]] },
    ],
  },
  {
    nom: "grise-fours",
    chemin: "dossiers/cmubrsvps001xhcdjqfmhhu8o/photos/mubrvvxu-822f0b29.jpg",
    description: "cuisine grise brillante, colonnes fours, îlot marbre",
    blanc: { objet: "mur blanc à droite", zone: [86, 22, 8, 14] },
    surfaces: [
      { surface: "colonnes hautes", ref: "RM20", zones: [[41, 21, 8, 12], [58, 21, 8, 12]] },
      { surface: "tiroirs bas", ref: "RM20", zones: [[29, 76, 9, 8]] },
      { surface: "plan à gauche", ref: "AA14", zones: [[22, 61.5, 12, 2]] },
    ],
  },
  {
    nom: "ilot-noyer",
    chemin: "dossiers/cmub2ei8f0004glj0aistgdfn/photos/mub2j7un-89e1d886.jpg",
    description: "colonnes gris ardoise, îlot noyer, plan quartz blanc",
    blanc: { objet: "hotte blanche", zone: [44, 17, 14, 9] },
    surfaces: [
      { surface: "colonnes", ref: "RM20", zones: [[80, 32, 14, 14], [16, 18, 9, 8]] },
      { surface: "îlot (façade)", ref: "RM20", zones: [[62, 82, 14, 10]] },
      { surface: "plan de l'îlot", ref: "AA14", zones: [[62, 69, 14, 3]] },
    ],
  },
  {
    nom: "chene-rustique",
    chemin: "site/a9a630b2-cc56-4c8d-b1df-2e9a7d461631/cmuo6zohv0025btt4mtld0u15/avant.jpg",
    description: "cuisine en U chêne rustique, crédence carrelée (« avant » d'ambiance du site)",
    blanc: { objet: "carrelage blanc de la crédence", zone: [52, 41, 10, 9] },
    surfaces: [
      { surface: "meubles hauts", ref: "RM20", zones: [[26, 16, 9, 16], [63, 16, 8, 16]] },
      { surface: "meubles bas", ref: "RM20", zones: [[37, 70, 8, 15], [64, 70, 7, 15]] },
      { surface: "plan de travail", ref: "AA14", zones: [[36, 57.5, 10, 2], [74, 57, 8, 2]] },
    ],
  },
];

type Rendu = { modele: Modele; ok: boolean; fichier: string | null; coutDollars: number | null; dureeMs: number | null; generationId: string | null; parametresRetires: string[]; erreur: string | null };
type Resultats = Record<string, { avant: string; rendus: Partial<Record<Modele, Rendu>> }>;
type Options = { estimer: boolean; plancheSeule: boolean; plafond: number; seulement: string[] | null; uploads: string; sortie: string };

function lireOptions(argv: string[]): Options {
  const o: Options = { estimer: false, plancheSeule: false, plafond: 2, seulement: null, uploads: path.resolve(process.cwd(), ".uploads"), sortie: path.join(os.homedir(), "coverswap-photos", "essai-modeles") };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const valeur = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${a} attend une valeur.`);
      return v;
    };
    if (a === "--estimer") o.estimer = true;
    else if (a === "--planche") o.plancheSeule = true;
    else if (a === "--plafond") o.plafond = Number(valeur());
    else if (a === "--seulement") o.seulement = valeur().split(",").map((s) => s.trim()).filter(Boolean);
    else if (a === "--uploads") o.uploads = path.resolve(valeur());
    else if (a === "--sortie") o.sortie = path.resolve(valeur());
    else throw new Error(`Option inconnue : ${a}`);
  }
  if (!Number.isFinite(o.plafond) || o.plafond <= 0 || o.plafond > 2) throw new Error("--plafond : un montant entre 0 et 2 $ (accord de la mission).");
  const inconnues = (o.seulement ?? []).filter((n) => !PHOTOS.some((p) => p.nom === n));
  if (inconnues.length) throw new Error(`--seulement : photo inconnue (${inconnues.join(", ")}).`);
  return o;
}

const dollars = (n: number) => `${n.toFixed(2).replace(".", ",")} $`;

/** Ce qui est déjà dépensé en phase « essai-modele », relu dans GenerationImage (le chiffre du plafond et du rapport). */
async function depense(): Promise<{ total: number; parModele: Map<string, { n: number; total: number; max: number }> }> {
  const lignes = await prisma.generationImage.findMany({ where: { phase: PHASE }, select: { modele: true, coutDollars: true } });
  const parModele = new Map<string, { n: number; total: number; max: number }>();
  let total = 0;
  for (const l of lignes) {
    const c = l.coutDollars ?? 0;
    total += c;
    const m = parModele.get(l.modele) ?? { n: 0, total: 0, max: 0 };
    m.n++;
    m.total += c;
    m.max = Math.max(m.max, c);
    parModele.set(l.modele, m);
  }
  return { total, parModele };
}

const estimationDe = (modele: Modele, deja: Awaited<ReturnType<typeof depense>>) => Math.max(ESTIMATION[modele], deja.parModele.get(modele)?.max ?? 0);

async function lireResultats(fichier: string): Promise<Resultats> {
  return existsSync(fichier) ? (JSON.parse(await fs.readFile(fichier, "utf8")) as Resultats) : {};
}

async function main(): Promise<void> {
  const o = lireOptions(process.argv.slice(2));
  process.env.UPLOADS_DIR = o.uploads; // le catalogue et les échantillons en cache sont lus là
  const photos = PHOTOS.filter((p) => !o.seulement || o.seulement.includes(p.nom));
  for (const p of photos) if (!existsSync(path.join(o.uploads, p.chemin))) throw new Error(`Photo introuvable : ${p.nom}`);
  await fs.mkdir(o.sortie, { recursive: true });
  const fichierResultats = path.join(o.sortie, "resultats.json");
  const resultats = await lireResultats(fichierResultats);

  const deja = await depense();
  const aFaire = photos.flatMap((p) => MODELES.filter((m) => !resultats[p.nom]?.rendus[m]?.ok).map((m) => ({ photo: p, modele: m })));
  const estime = aFaire.reduce((s, a) => s + estimationDe(a.modele, deja), 0);
  console.log(`Comparatif des modèles : ${photos.length} photo(s) × ${MODELES.length} modèles, ${aFaire.length} rendu(s) à faire.`);
  console.log(`Simulation : ${SIMULATION.piece}, ${SIMULATION.zones.map((z) => `${z.zone} = ${z.ref}`).join(", ")}, qualité ${SIMULATION.qualite}, moteur V1.`);
  console.log(`Déjà noté en phase ${PHASE} : ${dollars(deja.total)} ; estimé pour ce lancement : ${dollars(estime)} ; plafond ${dollars(o.plafond)}.`);
  if (o.estimer) {
    if (deja.total + estime > o.plafond) console.log("L'estimation dépasse le plafond : réduire avec --seulement.");
    return;
  }

  if (!o.plancheSeule) {
    if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY absente : rien n'est lancé.");
    const catalogue = JSON.parse(await fs.readFile(path.join(o.uploads, "simulateur", "catalogue.json"), "utf8")) as Reference[];
    definirCatalogueEssai(catalogue);
    for (const { photo: p, modele } of aFaire) {
      const actuel = await depense();
      const prevu = estimationDe(modele, actuel);
      if (actuel.total + prevu > o.plafond) {
        console.log(`ARRÊT avant ${p.nom} / ${modele} : ${dollars(actuel.total)} déjà + ${dollars(prevu)} prévus > plafond ${dollars(o.plafond)}.`);
        break;
      }
      const octets = await fs.readFile(path.join(o.uploads, p.chemin));
      console.log(`→ ${p.nom} / ${modele} (≈ ${dollars(prevu)})…`);
      const r = await genererAvecMoteur({
        photo: octets,
        piece: SIMULATION.piece,
        zones: SIMULATION.zones,
        origine: "CRM",
        reglages: { ...REGLAGES_PAR_DEFAUT, moteur: "V1" },
        qualite: SIMULATION.qualite,
        generateur: (e) => genererRendu({ ...e, modele, phase: PHASE }),
      });
      const entree = (resultats[p.nom] ??= { avant: `${p.nom}-avant.jpg`, rendus: {} });
      if (!r.ok) {
        console.log(`  échec : ${r.raison} — ${r.message}`);
        entree.rendus[modele] = { modele, ok: false, fichier: null, coutDollars: null, dureeMs: r.dureeMs, generationId: null, parametresRetires: [], erreur: `${r.status} ${r.raison}` };
      } else {
        const fichier = `${p.nom}-${modele}.${extensionDe(r.type)}`;
        await fs.writeFile(path.join(o.sortie, fichier), r.image);
        const ligne = r.generationId ? await prisma.generationImage.findUnique({ where: { id: r.generationId } }) : null;
        entree.rendus[modele] = { modele, ok: true, fichier, coutDollars: ligne?.coutDollars ?? null, dureeMs: r.dureeMs, generationId: r.generationId, parametresRetires: r.parametresRetires ?? [], erreur: null };
        console.log(`  ${dollars(ligne?.coutDollars ?? NaN)} réels, ${(r.dureeMs / 1000).toFixed(0)} s${r.parametresRetires?.length ? `, sans ${r.parametresRetires.join(", ")}` : ""}`);
      }
      await fs.writeFile(fichierResultats, JSON.stringify(resultats, null, 2));
      if (r.ok && !r.generationId) throw new Error("Coût non noté dans GenerationImage : arrêt (le plafond ne se lirait plus).");
    }
  }

  // Mesure et planche (gratuites).
  const sharp = (await import("sharp")).default;
  const lignesTableau: string[] = [];
  const rangees: Buffer[] = [];
  const L = 640;
  const H = 427;
  const BANDE = 150;
  for (const p of photos) {
    const entree = resultats[p.nom];
    if (!entree) continue;
    const avant = path.join(o.sortie, entree.avant);
    const premier = Object.values(entree.rendus).find((x) => x?.ok && x.fichier);
    const dims = premier ? await sharp(path.join(o.sortie, premier.fichier!)).metadata() : { width: 1536, height: 1024 };
    // L'« avant » au cadre du rendu : la photo lue sur place, réduite aux dimensions du rendu (même rapport), hors dépôt.
    await sharp(path.join(o.uploads, p.chemin)).rotate().resize(dims.width, dims.height, { fit: "cover" }).jpeg({ quality: 90 }).toFile(avant);
    const image = { blanc: p.blanc, surfaces: p.surfaces.map((s) => ({ surface: s.surface, en: s.surface, ref: s.ref, zones: s.zones })) };
    const cibles = p.surfaces.map((s) => hexVersRgb(refHex(s.ref)));
    const mesurer = async (fichier: string) => (await mesurerImage(fichier, image, BLANC_CIBLE)).surfaces.map((m, i) => deltaE(m.corrigee, cibles[i]));
    const deAvant = await mesurer(avant);
    const tuiles: { fichier: string; texte: string[] }[] = [{ fichier: avant, texte: [`AVANT — ${p.nom}`, p.description, ...p.surfaces.map((s, i) => `${s.surface} → ${s.ref} : ΔE avant ${deAvant[i].toFixed(1)}`)] }];
    for (const m of MODELES) {
      const r = entree.rendus[m];
      if (!r) continue;
      if (!r.ok || !r.fichier) {
        tuiles.push({ fichier: "", texte: [m, `échec : ${r.erreur}`] });
        lignesTableau.push(`| ${p.nom} | ${m} | échec (${r.erreur}) | ${r.dureeMs ? (r.dureeMs / 1000).toFixed(0) + " s" : "—"} | — | — |`);
        continue;
      }
      const fichier = path.join(o.sortie, r.fichier);
      const de = await mesurer(fichier);
      const contours = await ecartContours(avant, fichier);
      tuiles.push({ fichier, texte: [`${m}`, `${dollars(r.coutDollars ?? NaN)} réels · ${((r.dureeMs ?? 0) / 1000).toFixed(0)} s · contours ${contours.toFixed(1)}${r.parametresRetires.length ? ` · sans ${r.parametresRetires.join(", ")}` : ""}`, ...p.surfaces.map((s, i) => `${s.surface} (${s.ref}) : ΔE ${de[i].toFixed(1)}`)] });
      lignesTableau.push(`| ${p.nom} | ${m} | ${dollars(r.coutDollars ?? NaN)} | ${((r.dureeMs ?? 0) / 1000).toFixed(0)} s | ${p.surfaces.map((s, i) => `${s.surface} ${de[i].toFixed(1)}`).join(" ; ")} | ${contours.toFixed(1)} |`);
      Object.assign(r, { deltaE: Object.fromEntries(p.surfaces.map((s, i) => [s.surface, Math.round(de[i] * 10) / 10])), ecartContours: Math.round(contours * 10) / 10 });
    }
    Object.assign(entree, { deltaEAvant: Object.fromEntries(p.surfaces.map((s, i) => [s.surface, Math.round(deAvant[i] * 10) / 10])) });
    const composees = await Promise.all(
      tuiles.map(async (t) => {
        const fond = t.fichier ? await sharp(t.fichier).resize(L, H, { fit: "contain", background: "#222" }).toBuffer() : await sharp({ create: { width: L, height: H, channels: 3, background: "#400" } }).png().toBuffer();
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${L}" height="${BANDE}"><rect width="100%" height="100%" fill="#111"/>${t.texte.map((l, i) => `<text x="10" y="${22 + i * 21}" font-family="Arial" font-size="${i === 0 ? 17 : 15}" font-weight="${i === 0 ? "bold" : "normal"}" fill="${i === 0 ? "#ffd75e" : "#eeeeee"}">${echapper(l)}</text>`).join("")}</svg>`;
        return sharp({ create: { width: L, height: H + BANDE, channels: 3, background: "#111" } }).composite([{ input: fond, top: 0, left: 0 }, { input: Buffer.from(svg), top: H, left: 0 }]).png().toBuffer();
      })
    );
    rangees.push(await sharp({ create: { width: L * 3 + 16, height: H + BANDE, channels: 3, background: "#222" } }).composite(composees.map((c, i) => ({ input: c, top: 0, left: i * (L + 8) }))).png().toBuffer());
  }
  await fs.writeFile(fichierResultats, JSON.stringify(resultats, null, 2));
  if (rangees.length) {
    const hauteur = rangees.length * (H + BANDE + 8);
    await sharp({ create: { width: L * 3 + 16, height: hauteur, channels: 3, background: "#222" } }).composite(rangees.map((r, i) => ({ input: r, top: i * (H + BANDE + 8), left: 0 }))).jpeg({ quality: 86 }).toFile(path.join(o.sortie, "planche.jpg"));
  }
  const fin = await depense();
  console.log("\n| Photo | Modèle | Coût réel | Durée | ΔE (zone : valeur) | Contours |\n|---|---|---|---|---|---|");
  for (const l of lignesTableau) console.log(l);
  console.log(`\nCoût réel relu dans GenerationImage (phase ${PHASE}) : ${dollars(fin.total)}${[...fin.parModele].map(([m, v]) => ` ; ${m} ${dollars(v.total)} × ${v.n}`).join("")}.`);
}

let HEX = new Map<string, string>();
const refHex = (ref: string) => {
  const h = HEX.get(ref);
  if (!h) throw new Error(`Référence sans teinte au catalogue : ${ref}`);
  return h;
};
const echapper = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

async function chargerTeintes(): Promise<void> {
  const uploads = process.argv.includes("--uploads") ? path.resolve(process.argv[process.argv.indexOf("--uploads") + 1]) : path.resolve(process.cwd(), ".uploads");
  const catalogue = JSON.parse(await fs.readFile(path.join(uploads, "simulateur", "catalogue.json"), "utf8")) as Reference[];
  HEX = new Map(catalogue.filter((r) => r.hex).map((r) => [r.id, r.hex!]));
}

chargerTeintes()
  .then(main)
  .catch((erreur) => {
    console.error("[comparer-modeles]", erreur instanceof Error ? erreur.message : erreur);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
