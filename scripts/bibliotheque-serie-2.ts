// Photos, série 2 — la bibliothèque, sans aucun appel payant : calage des après sur l'avant retenu, teintes mesurées
// (ΔE 2000, balance des blancs, seuil 12, réétiquetage vers la plus proche de la même famille), bibliotheque.json et
// planches. Zones de mesure et choix à l'œil : scripts/zones-serie-2.json. Logique : src/lib/simulations/bibliotheque.ts.
//
//   node --import tsx scripts/bibliotheque-serie-2.ts            (défaut : ~/coverswap-photos/serie-2)
//
// Sorties : <racine>/bibliotheque.json, <racine>/planches/<pièce>.jpg, <racine>/planches/serie-<sous-série>.jpg.
import { existsSync, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { lireListeImages } from "../src/lib/simulations/ambiances";
import { construireBibliotheque, lireZones, plancheSerie, planchesPieces } from "../src/lib/simulations/bibliotheque";
import { CATALOGUE_DEFAUT } from "../src/lib/simulations/vignettes";

const PICTOS_SERIE_1: Record<string, number> = { "picto-cuisine": 2, "picto-salle-de-bain": 2, "picto-mobilier": 1, "picto-murs": 1, "picto-pro": 2, "plan-une-rangee": 2, "plan-en-l": 1, "plan-en-u": 3, "plan-ilot": 2 };

async function principal() {
  const racine = process.argv[2] ? path.resolve(process.argv[2]) : path.join(os.homedir(), "coverswap-photos", "serie-2");
  const liste = path.resolve("scripts", "photos-serie-2.json");
  const fichierZones = path.resolve("scripts", "zones-serie-2.json");
  const lignes = await construireBibliotheque({ liste, zones: fichierZones, catalogue: CATALOGUE_DEFAUT(), racine, journal: console.log });
  await fs.writeFile(path.join(racine, "bibliotheque.json"), JSON.stringify(lignes, null, 2));
  const images = lireListeImages(await fs.readFile(liste, "utf8")).images;
  const zones = lireZones(await fs.readFile(fichierZones, "utf8"));
  const dossier = path.join(racine, "planches");
  const pieces = await planchesPieces(lignes, images, racine, dossier, zones.choix);
  const series = [...new Set(images.filter((i) => i.serie !== "quotidien").map((i) => i.serie ?? ""))];
  const reference = Object.entries(PICTOS_SERIE_1)
    .map(([nom, n]) => ({ titre: `série 1 : ${nom}`, fichier: path.join(os.homedir(), "coverswap-photos", `${nom}-${n}.png`) }))
    .filter((r) => existsSync(r.fichier));
  for (const serie of series) {
    const pictos = serie === "pictos";
    await plancheSerie(serie, lignes, path.join(dossier, `serie-${serie}.jpg`), pictos ? { damier: true, reference, colonnes: 6 } : {});
  }
  const compte = (statut: string) => lignes.filter((l) => l.statut === statut).length;
  console.log(`bibliotheque.json : ${lignes.length} ligne(s) — retenues ${compte("retenue")}, teinte non garantie ${compte("teinte non garantie")}, rejetées ${compte("rejetée")} ; ${pieces.length} planche(s) de pièces, ${series.length} de séries, dans ${dossier}.`);
}

principal().catch((erreur) => {
  console.error("[bibliotheque]", erreur instanceof Error ? erreur.message : erreur);
  process.exitCode = 1;
});
