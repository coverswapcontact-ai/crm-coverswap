// Calibrage Sunburst, phase S0 (gratuite, aucun appel) — sur les 45 rendus Sunburst de la mission 24 :
//  1. le décalage de Sunburst par teinte et par famille (dL, da, db, dC*, dh, avec leur signe), mesuré deux fois :
//     par le score de la mission 24 (`score.ts` : masque dessiné troué, balance des blancs hors zone) et par la mesure de
//     la mission 23 (`mesure-rendu.ts` : masque par différence avant / rendu) ;
//  2. la correction L3 (`correction-teintes.ts`, recalage par image vers le hex du catalogue) appliquée à chaque rendu,
//     ΔE avant / après relu par le score de la mission 24, comparée à la correction par famille de la mission 24
//     (`correction.ts › appliquer`, en laisser-un-de-côté pour les rendus qui l'ont apprise).
// Sorties hors dépôt : `~/coverswap-photos/sunburst-23/s0/` (decalages.json, rendus corrigés par L3) ; les rendus corrigés
// par famille vont à côté de ceux de la mission 24 (`sunburst-24/corriges/*-s0-famille.jpg`).
//   node --import tsx scripts/sunburst-23/decalages.ts
import fs from "node:fs";
import path from "node:path";
import { appliquer, ecartRendu, moyenneFamille, type Correction } from "../sunburst-24/correction";
import { lireMasques, masqueBinaire, masqueTroue } from "../sunburst-24/masques";
import { lireJournal, type Entree } from "../sunburst-24/rendre";
import { scorer, type Score } from "../sunburst-24/score";
import { familleDe } from "../sunburst-24/variantes";
import type { Reference } from "../../src/lib/simulateur/catalogue";
import { classeTexture, mesurerRendu } from "../../src/lib/simulations/mesure-rendu";
import { corrigerTeintes } from "../../src/lib/simulations/correction-teintes";
import { hexVersRgb, rgbVersLab, type Lab } from "../../src/lib/simulations/teintes";
import { decalageDe, familleCalibrage, resumerDecalages, type LigneDecalage } from "../../src/lib/simulations/calibrage-sunburst/precompensation";
import { CADRE_24, CATALOGUE, PHOTOS_HORS_MESURE, RENDUS_24, S0 } from "./commun";

/** Ce que la mission 24 applique par famille (`valider.ts › MODE_CORRECTION`, recopié : ce script-là s'exécute à l'import). */
const MODE_CORRECTION: Record<string, "complet" | "teinte" | "aucune"> = { blancs: "complet", beiges: "complet", bois: "teinte", sombres: "aucune", complexes: "aucune" };

const labDeHex = (hex: string): Lab => rgbVersLab(hexVersRgb(hex));

async function main() {
  const cat = JSON.parse(fs.readFileSync(CATALOGUE, "utf8")) as Reference[];
  const refDe = (id: string) => cat.find((r) => r.id === id)!;
  const masques = lireMasques();
  const journal = lireJournal().filter((e) => e.fichier);
  const dirL3 = path.join(S0, "l3");
  fs.mkdirSync(dirL3, { recursive: true });

  // La correction par famille de la mission 24 : apprise sur les rendus C1+C3 de la correction (hors p07) ; un rendu de
  // cet apprentissage est corrigé SANS lui (laisser-un-de-côté), les autres avec la correction complète.
  const apprentissage = journal.filter((e) => e.variante === "c1+c3" && e.phase === "correction" && e.photo !== "p07");
  const ecarts = new Map<number, Correction>();
  for (const e of apprentissage) ecarts.set(e.n, await ecartRendu(e, refDe(e.ref)));
  const correctionPour = (e: Entree): Correction & { mode: string } => {
    const famille = familleDe(e.ref)!;
    const mode = MODE_CORRECTION[famille];
    const liste = apprentissage.filter((x) => familleDe(x.ref) === famille && x.n !== e.n).map((x) => ecarts.get(x.n)!);
    const c = moyenneFamille(liste);
    return mode === "complet" ? { ...c, mode } : mode === "teinte" ? { ...c, kL: 1, mode } : { kL: 1, da: 0, db: 0, n: c.n, mode };
  };

  const lignes: LigneDecalage[] = [];
  for (const e of journal) {
    const ref = refDe(e.ref);
    const cadre = path.join(CADRE_24, `${e.photo}.png`);
    const rendu = path.join(RENDUS_24, e.fichier!);
    const { binaire, largeur, hauteur } = await masqueTroue(e.photo, masques[e.photo]);
    const zone = (await masqueBinaire(e.photo, masques[e.photo])).data;
    const noter = (fichier: string): Promise<Score> => scorer(cadre, fichier, binaire, largeur, hauteur, ref, zone);
    const cible = labDeHex(ref.hex!);

    // 1. Mesure de la mission 24 (score), puis de la mission 23 (masque par différence).
    const s = await noter(rendu);
    const references = [{ ref: ref.id, nom: ref.nom, hex: ref.hex!, classe: classeTexture(ref) }];
    const m23 = await mesurerRendu(cadre, rendu, references);
    const surf = m23.surfaces[0];

    // 2. Correction L3 sur le rendu, relue par le score de la mission 24.
    const l3 = await corrigerTeintes({ avant: cadre, apres: rendu, zones: [{ zone: masques[e.photo].zone, ref: ref.id }], references });
    const fichierL3 = path.join(dirL3, e.fichier!);
    fs.writeFileSync(fichierL3, l3.image);
    const sL3 = await noter(fichierL3);
    const f = l3.fidelite[0];

    // 3. Correction par famille de la mission 24.
    const c = correctionPour(e);
    const sF = c.mode === "aucune" ? s : await noter(await appliquer(e, c, "s0-famille"));

    const ligne: LigneDecalage = {
      n: e.n,
      photo: e.photo,
      ref: ref.id,
      variante: e.variante,
      famille: familleCalibrage(ref.hex!, classeTexture(ref)),
      retenu: !PHOTOS_HORS_MESURE.includes(e.photo) && !e.variante.includes("t1"),
      m24: { deltaE: s.couleur.deltaE, chromatique: s.couleur.chromatique, decalage: decalageDe(labDeHex(s.couleur.mesure), cible) },
      m23: { deltaE: surf?.deltaE ?? null, chromatique: surf?.deltaEChromatique ?? null, decalage: surf?.mesure ? decalageDe(labDeHex(surf.mesure), cible) : null, douteux: m23.masque.douteux },
      l3: { etat: f?.etat ?? "—", ...(f?.raison ? { raison: f.raison } : {}), deltaEApres: sL3.couleur.deltaE, chromApres: sL3.couleur.chromatique, scoreApres: sL3.total },
      famille24: { mode: c.mode, deltaEApres: sF.couleur.deltaE, chromApres: sF.couleur.chromatique },
      scoreAvant: s.total,
    };
    lignes.push(ligne);
    const d = ligne.m24.decalage;
    console.log(
      `n°${e.n} ${e.photo} ${e.ref} ${e.variante}${ligne.retenu ? "" : " (hors moyenne)"} | M24 ΔE ${ligne.m24.deltaE} dL ${d.dL} da ${d.da} db ${d.db} dC ${d.dC} dh ${d.dh ?? "—"}` +
        ` | M23 ΔE ${ligne.m23.deltaE ?? "—"}${ligne.m23.douteux ? " (douteux)" : ""} | L3 ${ligne.l3.etat} → ΔE ${ligne.l3.deltaEApres} | famille (${c.mode}) → ΔE ${ligne.famille24.deltaEApres}`
    );
  }

  const resume = resumerDecalages(lignes);
  fs.writeFileSync(path.join(S0, "decalages.json"), JSON.stringify({ lignes, resume }, null, 1));
  const v = (x: number | null | undefined) => (x === null || x === undefined ? "—" : String(x));
  console.log("\nDécalage médian par teinte (score M24 ; rendus retenus : hors p07, v01 et T1) :");
  for (const t of resume.parTeinte) console.log(`  ${t.cle.padEnd(5)} n ${t.n} | dL ${t.m24.dL} da ${t.m24.da} db ${t.m24.db} dC ${t.m24.dC} dh ${v(t.m24.dh)} | M23 n ${t.nM23} dL ${v(t.m23?.dL)} da ${v(t.m23?.da)} db ${v(t.m23?.db)} dC ${v(t.m23?.dC)} | ${t.sens}`);
  console.log("Par famille :");
  for (const t of resume.parFamille) console.log(`  ${t.cle.padEnd(14)} n ${t.n} | dL ${t.m24.dL} da ${t.m24.da} db ${t.m24.db} dC ${t.m24.dC} dh ${v(t.m24.dh)} | M23 n ${t.nM23} dL ${v(t.m23?.dL)} da ${v(t.m23?.da)} db ${v(t.m23?.db)} dC ${v(t.m23?.dC)} | ${t.sens}`);
  console.log("Corrections (ΔE 2000 du score M24, médianes ; entre parenthèses, à clarté égale) :");
  for (const g of resume.corrections) console.log(`  ${g.groupe.padEnd(14)} n ${g.n} | brut ${g.brut} (${g.brutChrom}) | L3 ${g.l3} (${g.l3Chrom}) | famille M24 ${g.famille} (${g.familleChrom}) | L3 gagne ≥ 1 : ${g.l3Gagne}/${g.n}, dégrade ≥ 1 : ${g.l3Degrade}/${g.n} ; famille gagne ${g.familleGagne}/${g.n}, dégrade ${g.familleDegrade}/${g.n} ; L3 meilleure que famille ${g.l3BatFamille}/${g.n}`);
  console.log(`États L3 : ${JSON.stringify(resume.etatsL3)}`);
}
void main();
