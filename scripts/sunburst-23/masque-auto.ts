// Calibrage Sunburst — le masque automatique des façades (phase S1, enveloppe E1) et son harnais contre les 16 masques
// dessinés à la main de la mission 24. Trois usages :
//   node --import tsx scripts/sunburst-23/masque-auto.ts [--modele gpt-4.1-mini|gpt-4.1] [--photos p01,p02]
//       ESTIMATION SEULE (défaut, aucun appel) : coût de chaque appel vision d'après la taille de l'image envoyée et le
//       prompt, total, plafond de E1 ; écrit les images à grille et le texte de la demande dans masques-auto/ (local).
//   node --import tsx scripts/sunburst-23/masque-auto.ts --essai-dessin
//       CONTRÔLE GRATUIT DU HARNAIS : les polygones dessinés passent par le même chemin que la réponse du modèle (lecture,
//       arrondi, rasterisation, trous) ; puis décalés d'une case de grille (5 %) pour savoir ce que coûte une case d'erreur ;
//       et le masque troué de la bibliothèque comparé à celui de la mission 24 (`masques.ts › masqueTroue`).
//   node --import tsx scripts/sunburst-23/masque-auto.ts --payer --cle-depuis ../coverswap/.env.local [--iteration 2]
//       S1 (PAYANT, seulement sur instruction) : un appel vision par photo, plafond de E1 et de 2,30 $ relus avant chaque
//       appel dans le journal de la campagne, cumul affiché après chaque appel, total à la fin, puis la barre de S1.
// La clé n'est jamais affichée ni copiée : lue au moment de l'appel dans le fichier donné, seule la ligne OPENAI_API_KEY.
import fs from "node:fs";
import path from "node:path";
import { lireMasques, masqueTroue } from "../sunburst-24/masques";
import { autoriserAppel, inscrireAppel, journalVide, ligneCumul, totalPhase, type Journal } from "../../src/lib/simulations/calibrage-sunburst/budget";
import {
  SYSTEME_MASQUE,
  comparerMasques,
  coutVision,
  critereS1,
  estimerCoutVision,
  imageAvecGrille,
  lireReponseMasque,
  masqueTroueDepuisPolygones,
  rasteriser,
  schemaMasque,
  texteMasque,
  type Comparaison,
  type Polygone,
} from "../../src/lib/simulations/calibrage-sunburst/masque-auto";
import type { IdZone } from "../../src/lib/simulateur/zones";
import { JOURNAL, MASQUES_AUTO, cheminCadre } from "./commun";

const args = process.argv.slice(2);
const valeur = (nom: string) => (args.includes(nom) ? args[args.indexOf(nom) + 1] : undefined);
const MODELE = valeur("--modele") ?? "gpt-4.1-mini";
const ITERATION = Number(valeur("--iteration") ?? 1);

export const lireJournalCampagne = (): Journal => (fs.existsSync(JOURNAL) ? (JSON.parse(fs.readFileSync(JOURNAL, "utf8")) as Journal) : journalVide());
export const ecrireJournalCampagne = (j: Journal) => fs.writeFileSync(JOURNAL, JSON.stringify(j, null, 1));

/** Les polygones du masque automatique d'une photo (écrits par S1), ou null. */
export function lireMasqueAuto(photo: string): { zone: IdZone; polygones: Polygone[] } | null {
  const f = path.join(MASQUES_AUTO, `${photo}.json`);
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : null;
}

function lireCle(fichier: string | undefined): string {
  if (!fichier) throw new Error("--cle-depuis <fichier .env> obligatoire avec --payer.");
  const cle = /^OPENAI_API_KEY=["']?([^"'\s]+)/m.exec(fs.readFileSync(fichier, "utf8"))?.[1];
  if (!cle) throw new Error("OPENAI_API_KEY absente du fichier donné : rien n'est lancé.");
  return cle;
}

/** Comparaison d'un masque (polygones en %) au masque dessiné, à la taille de la photo cadrée : zones, puis masques troués. */
async function comparerAuDessin(photo: string, polygones: Polygone[], dessines: Polygone[]): Promise<{ zone: Comparaison; troue: Comparaison }> {
  const cadre = fs.readFileSync(cheminCadre(photo));
  const auto = await masqueTroueDepuisPolygones(cadre, polygones);
  const dessin = await masqueTroueDepuisPolygones(cadre, dessines);
  const facades = dessines.map((p) => rasteriser([p], auto.largeur, auto.hauteur));
  return { zone: comparerMasques(auto.zone, dessin.zone, facades), troue: comparerMasques(auto.peindre, dessin.peindre) };
}

const pc = (x: number) => `${Math.round(x * 100)} %`;

async function estimer(photos: [string, { zone: string }][]) {
  let total = 0;
  for (const [photo, d] of photos) {
    const { jpeg, largeur, hauteur } = await imageAvecGrille(fs.readFileSync(cheminCadre(photo)));
    fs.writeFileSync(path.join(MASQUES_AUTO, `${photo}-grille-vision.jpg`), jpeg);
    const e = estimerCoutVision(MODELE, largeur, hauteur, d.zone as IdZone);
    total += e.dollars;
    console.log(`${photo} (${d.zone}) : image ${largeur} × ${hauteur} → ${e.jetonsImage} jetons d'image + ${e.jetonsTexte} de texte, sortie ≈ ${e.jetonsSortie} → ${e.dollars.toFixed(4)} $`);
  }
  fs.writeFileSync(path.join(MASQUES_AUTO, "demande-exemple.txt"), `${SYSTEME_MASQUE}\n\n${texteMasque((photos[0]?.[1].zone ?? "meubles-bas") as IdZone)}`);
  const j = lireJournalCampagne();
  console.log(`\n${photos.length} appel(s) ${MODELE}, détail high : ≈ ${total.toFixed(4)} $ (au pire ×2 avec une itération du prompt : ${(2 * total).toFixed(4)} $). ${ligneCumul(j, "E1")}.`);
}

async function essaiDessin(photos: [string, { zone: string; polygones: Polygone[] }][]) {
  const exacts: Comparaison[] = [];
  const decales: Comparaison[] = [];
  for (const [photo, d] of photos) {
    // 1. Les polygones dessinés comme s'ils venaient du modèle (lecture et arrondi compris).
    const lu = lireReponseMasque({ facades: d.polygones.map((p, k) => ({ libelle: `façade ${k + 1}`, polygone: p })), absente: false })!;
    const exact = await comparerAuDessin(photo, lu.facades.map((f) => f.polygone), d.polygones);
    // 2. Une case de grille d'erreur : tout décalé de 5 % vers la droite.
    const decale = await comparerAuDessin(photo, d.polygones.map((p) => p.map(([x, y]) => [Math.min(100, x + 5), y] as [number, number])), d.polygones);
    // 3. Le masque troué de la bibliothèque contre celui de la mission 24 (même algorithme, rasterisation différente).
    const m24 = await masqueTroue(photo, d as Parameters<typeof masqueTroue>[1]);
    const lib = await masqueTroueDepuisPolygones(fs.readFileSync(cheminCadre(photo)), d.polygones);
    const accord = comparerMasques(lib.peindre, Uint8Array.from(m24.binaire, (v) => (v > 127 ? 1 : 0)));
    exacts.push(exact.zone);
    decales.push(decale.zone);
    console.log(`${photo} : dessin relu IoU ${exact.zone.iou} (troué ${exact.troue.iou}) | décalé de 5 % : IoU ${decale.zone.iou}, manquée ${pc(decale.zone.manquee)}, débordée ${pc(decale.zone.debordee)}, pire façade ${pc(decale.zone.pireFacade)} | troué bibliothèque / mission 24 : IoU ${accord.iou}`);
  }
  const a = critereS1(exacts);
  const b = critereS1(decales);
  console.log(`\nDessin relu : IoU médian ${a.iouMedian}, barre de S1 ${a.passe ? "passée" : `ratée (${a.raisons.join(" ; ")})`}.`);
  console.log(`Décalé d'une case : IoU médian ${b.iouMedian}, pire façade ${pc(b.pireFacade)}, barre ${b.passe ? "passée" : `ratée (${b.raisons.join(" ; ")})`}.`);
}

async function payer(photos: [string, { zone: string; polygones: Polygone[] }][]) {
  const cle = lireCle(valeur("--cle-depuis"));
  const comparaisons: Comparaison[] = [];
  for (const [photo, d] of photos) {
    const { jpeg, largeur, hauteur } = await imageAvecGrille(fs.readFileSync(cheminCadre(photo)));
    const estimation = estimerCoutVision(MODELE, largeur, hauteur, d.zone as IdZone).dollars;
    const cleAppel = `S1-${photo}-${MODELE}-v${ITERATION}`;
    let j = lireJournalCampagne();
    const ok = autoriserAppel(j, "E1", estimation, cleAppel);
    if (!ok.ok) {
      console.log(`ARRÊT avant ${photo} : ${ok.raison}. Rien n'est appelé.`);
      break;
    }
    const debut = Date.now();
    let erreur: string | null = null;
    let usage: { entree: number; sortie: number } | null = null;
    let polygones: Polygone[] = [];
    try {
      const reponse = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${cle}`, "Content-Type": "application/json" },
        signal: AbortSignal.timeout(90_000),
        body: JSON.stringify({
          model: MODELE,
          max_completion_tokens: 2000,
          messages: [
            { role: "system", content: SYSTEME_MASQUE },
            { role: "user", content: [{ type: "text", text: texteMasque(d.zone as IdZone) }, { type: "image_url", image_url: { url: `data:image/jpeg;base64,${jpeg.toString("base64")}`, detail: "high" } }] },
          ],
          response_format: { type: "json_schema", json_schema: { name: "masque_facades", strict: true, schema: schemaMasque() } },
        }),
      });
      const texte = await reponse.text();
      if (!reponse.ok) erreur = `HTTP ${reponse.status} ${texte.slice(0, 200)}`;
      else {
        const donnees = JSON.parse(texte) as { choices?: { message?: { content?: string } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } };
        usage = { entree: donnees.usage?.prompt_tokens ?? 0, sortie: donnees.usage?.completion_tokens ?? 0 };
        const lu = lireReponseMasque(JSON.parse(donnees.choices?.[0]?.message?.content ?? "null"));
        if (!lu) erreur = "réponse hors schéma";
        else polygones = lu.facades.map((f) => f.polygone);
      }
    } catch (e) {
      erreur = `réseau : ${e instanceof Error ? e.message : String(e)}`;
    }
    const cout = usage ? coutVision(MODELE, usage.entree, usage.sortie) : 0;
    let mesure: unknown = null;
    if (!erreur) {
      fs.writeFileSync(path.join(MASQUES_AUTO, `${photo}.json`), JSON.stringify({ zone: d.zone, modele: MODELE, iteration: ITERATION, polygones }, null, 1));
      const c = await comparerAuDessin(photo, polygones, d.polygones);
      comparaisons.push(c.zone);
      mesure = c;
    }
    j = lireJournalCampagne();
    const r = inscrireAppel(j, { le: new Date().toISOString(), phase: "S1", enveloppe: "E1", type: "vision", modele: MODELE, cle: cleAppel, estimation, cout, usage, erreur, fichier: erreur ? null : `${photo}.json`, mesure });
    ecrireJournalCampagne(r.journal);
    const c = mesure as { zone: Comparaison } | null;
    console.log(`n°${r.appel.n} ${photo} : ${erreur ?? `${polygones.length} polygone(s), IoU ${c?.zone.iou}, manquée ${pc(c?.zone.manquee ?? 0)}, débordée ${pc(c?.zone.debordee ?? 0)}, pire façade ${pc(c?.zone.pireFacade ?? 0)}`} — ${cout.toFixed(4)} $ (estimé ${estimation.toFixed(4)} $), ${((Date.now() - debut) / 1000).toFixed(0)} s. ${ligneCumul(r.journal, "E1")}`);
    if (r.arret) {
      console.log(`ARRÊT : ${r.journal.arret?.raison}.`);
      break;
    }
  }
  const t = totalPhase(lireJournalCampagne(), "S1");
  const barre = critereS1(comparaisons);
  console.log(`\nTOTAL S1 : ${t.appels} appel(s) (${t.echecs} raté(s)), ${t.cout.toFixed(4)} $ ; cumul de la campagne ${t.cumul.toFixed(4)} $.`);
  console.log(`Barre de S1 : IoU médian ${barre.iouMedian}, pire façade ${pc(barre.pireFacade)} → ${barre.passe ? "PASSÉE" : `RATÉE (${barre.raisons.join(" ; ")})`}.`);
}

async function main() {
  const masques = lireMasques();
  const filtre = valeur("--photos")?.split(",");
  const photos = Object.entries(masques).filter(([id]) => !filtre || filtre.includes(id)) as [string, { zone: string; polygones: Polygone[] }][];
  if (args.includes("--payer")) return payer(photos);
  if (args.includes("--essai-dessin")) return essaiDessin(photos);
  return estimer(photos);
}
if (process.argv[1]?.endsWith("masque-auto.ts")) void main().catch((e) => {
  console.error("[sunburst-23]", e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
