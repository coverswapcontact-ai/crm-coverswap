// Mission 24 — étape 3 : les corrections de couleur par famille, calculées sur TOUS les rendus C1+C3 de la correction
// (hors p07, masque peu fiable), appliquées aux rendus de validation ; tableau comparatif exploration / correction /
// validation brute / validation corrigée. Gratuit.
import fs from "node:fs";
import path from "node:path";
import type { Reference } from "../../src/lib/simulateur/catalogue";
import { CADRE, RACINE } from "./commun";
import { appliquer, ecartRendu, moyenneFamille, type Correction } from "./correction";
import { lireMasques, masqueBinaire, masqueTroue } from "./masques";
import { lireJournal, type Entree } from "./rendre";
import { scorer } from "./score";
import { familleDe } from "./variantes";

/** Ce qui est appliqué par famille (décision de l'étape 2, laisser-un-de-côté) : complet, teinte seule, ou rien. */
export const MODE_CORRECTION: Record<string, "complet" | "teinte" | "aucune"> = { blancs: "complet", beiges: "complet", bois: "teinte", sombres: "aucune", complexes: "aucune" };

const moyenne = (v: number[]) => (v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10 : NaN);
const med = (v: number[]) => { const t = [...v].sort((a, b) => a - b); return t.length ? t[t.length >> 1] : NaN; };

async function main() {
  const cat = JSON.parse(fs.readFileSync(path.join(RACINE, "uploads/simulateur/catalogue.json"), "utf8")) as Reference[];
  const refDe = (id: string) => cat.find((r) => r.id === id)!;
  const masques = lireMasques();
  const j = lireJournal();
  const apprentissage = j.filter((e) => e.fichier && e.variante === "c1+c3" && e.phase === "correction" && e.photo !== "p07");
  const corrections: Record<string, Correction & { mode: string }> = {};
  for (const famille of Object.keys(MODE_CORRECTION)) {
    const liste = apprentissage.filter((e) => familleDe(e.ref) === famille);
    const ecarts = await Promise.all(liste.map((e) => ecartRendu(e, refDe(e.ref))));
    const c = moyenneFamille(ecarts);
    const mode = MODE_CORRECTION[famille];
    corrections[famille] = mode === "complet" ? { ...c, mode } : mode === "teinte" ? { ...c, kL: 1, mode } : { kL: 1, da: 0, db: 0, n: c.n, mode };
  }
  const lignes: Record<string, unknown>[] = [];
  for (const e of j.filter((x) => x.phase === "validation" && x.fichier)) {
    const famille = familleDe(e.ref)!;
    const c = corrections[famille];
    let apres = e.score!;
    let fichier: string | null = null;
    if (c.mode !== "aucune") {
      fichier = await appliquer(e, c, "corr");
      const { binaire, largeur, hauteur } = await masqueTroue(e.photo, masques[e.photo]);
      const zone = (await masqueBinaire(e.photo, masques[e.photo])).data;
      apres = await scorer(path.join(CADRE, `${e.photo}.png`), fichier, binaire, largeur, hauteur, refDe(e.ref), zone);
    }
    lignes.push({ n: e.n, photo: e.photo, ref: e.ref, famille, mode: c.mode, cout: e.cout, scoreBrut: e.score!.total, scoreCorrige: apres.total, deltaEBrut: e.score!.couleur.deltaE, deltaECorrige: apres.couleur.deltaE, chromBrut: e.score!.couleur.chromatique, chromCorrige: apres.couleur.chromatique, structure: e.score!.structure.perte, fichierCorrige: fichier ? path.basename(fichier) : null });
    console.log(`n°${e.n} ${e.photo} ${e.ref} (${famille}, ${c.mode}) : score ${e.score!.total} → ${apres.total} ; ΔE ${e.score!.couleur.deltaE} → ${apres.couleur.deltaE} ; chrom ${e.score!.couleur.chromatique} → ${apres.couleur.chromatique}`);
  }
  // Comparaison des groupes.
  const groupe = (f: (e: Entree) => boolean) => j.filter((e) => e.fichier && f(e) && e.photo !== "p07");
  const resume = (nom: string, l: { total: number; dE: number; chrom: number; perte: number }[]) => {
    const r = { groupe: nom, n: l.length, scoreMoyen: moyenne(l.map((x) => x.total)), deltaEMedian: med(l.map((x) => x.dE)), chromMedian: med(l.map((x) => x.chrom)), perteStructureMediane: med(l.map((x) => x.perte)) };
    console.log(JSON.stringify(r));
    return r;
  };
  const versLigne = (e: Entree) => ({ total: e.score!.total, dE: e.score!.couleur.deltaE, chrom: e.score!.couleur.chromatique, perte: e.score!.structure.perte });
  const comparaison = [
    resume("exploration (base)", groupe((e) => e.phase === "exploration").map(versLigne)),
    resume("correction, prompt retenu C1+C3", groupe((e) => e.phase === "correction" && e.variante === "c1+c3").map(versLigne)),
    resume("validation brute (C1+C3)", groupe((e) => e.phase === "validation").map(versLigne)),
    resume("validation corrigée (C1+C3 + couleur)", lignes.map((l) => ({ total: l.scoreCorrige as number, dE: l.deltaECorrige as number, chrom: l.chromCorrige as number, perte: l.structure as number }))),
  ];
  fs.writeFileSync(path.join(RACINE, "validation.json"), JSON.stringify({ corrections, lignes, comparaison }, null, 1));
}
void main();
