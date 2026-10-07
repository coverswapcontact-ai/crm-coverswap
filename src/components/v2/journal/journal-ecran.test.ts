import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";

/**
 * Mission 22 (A1) — l'écran du journal, vérifié sur ses sources (comme `components/v2/coque.test.ts`) : un seul bouton
 * principal (« Tout vu », vert), cinq groupes puis « Voir les N autres », les trois filtres, chaque geste répond avec
 * « Annuler » pendant 5 s, les dates par la seule fonction `dateRelative`, les liens vers les écrans d'avant, les
 * zones de 44 px, l'échelle de texte de la v2, aucun mouvement hors `TRANS_V2`, et la page `/journal` v2 seulement.
 */
const lire = (f: string) => readFileSync(join(process.cwd(), "src", f), "utf8").replace(/\r\n/g, "\n");
const ecran = lire("components/v2/journal/Journal.tsx");
const groupe = lire("components/v2/journal/GroupeParPersonne.tsx");
const page = lire("app/(pilotage)/journal/page.tsx");
const logique = lire("lib/v2/journal.ts");

describe("Journal.tsx : une seule chose en haut, un seul bouton principal, deux niveaux", () => {
  test("« Tout vu » est l'unique bouton principal (bg-action) ; il appelle POST /api/journal/vu puis la liste se vide", () => {
    assert.equal((ecran.match(/bg-action /g) ?? []).length, 1, "une seule classe de bouton principal");
    assert.equal((ecran.match(/BOUTON_PRINCIPAL\}/g) ?? []).length, 1, "posée une seule fois");
    assert.match(ecran, /envoyerJson<\{ vuLe: string \}>\("\/api\/journal\/vu", "POST"\)/);
    assert.match(ecran, /setEntrees\(\[\]\)/);
    assert.match(ecran, /Rien de nouveau depuis/);
  });

  test("cinq groupes visibles puis « Voir les N autres » ; les trois filtres Clients · Argent · Système, un seul actif ou tous", () => {
    assert.match(logique, /export const GROUPES_VISIBLES = 5;/);
    assert.match(ecran, /groupes\.slice\(0, GROUPES_VISIBLES\)/);
    assert.match(ecran, /Voir \{caches === 1 \? "l'autre" : `les \$\{caches\} autres`\}/);
    assert.match(ecran, /FILTRES_JOURNAL\.map\(/);
    assert.match(ecran, /basculerFiltre\(actif, f\)/);
    assert.match(ecran, /aria-pressed=\{filtre === f\}/);
  });

  test("chaque geste répond : une ligne écrite (role=status) et « Annuler » pendant 5 s ; le POST ne part qu'après", () => {
    assert.match(ecran, /const DELAI_ANNULATION_MS = DUREE_ANNULATION_MS;/);
    assert.match(lire("components/v2/taches/toastAnnulable.ts"), /export const DUREE_ANNULATION_MS = 5_000;/);
    // Correctifs du 07/10 (É4) : « Tout vu » part aussi 5 s plus tard, avec « Annuler » ; « Tout est vu. » puis « Rien de nouveau depuis … ».
    assert.match(ecran, /minuterieToutVu\.current = window\.setTimeout\(async \(\) => \{[\s\S]*?await envoyerJson<\{ vuLe: string \}>\("\/api\/journal\/vu", "POST"\)/);
    assert.match(ecran, /setReponse\(\{ texte: "Tout est vu\.", annuler \}\)/);
    assert.match(ecran, /const visibles = toutVuEnAttente \? \[\] : filtrer\(entrees, filtre\);/);
    // Correctifs du 07/10 (É3) : la ligne de réponse est amenée en vue ; (É5) « Annuler » en 44 px (plus de h-9).
    assert.match(ecran, /ligneReponse\.current\?\.scrollIntoView\(\{ block: "nearest" \}\)/);
    assert.ok(!ecran.includes('"h-9"'), "Annuler fait 44 px");
    // (É13) cinq lignes par groupe ; (d3) plus de compteurs « clients 4, argent 0, système 3 » dans l'en-tête.
    assert.match(groupe, /groupe\.entrees\.slice\(0, LIGNES_GROUPE_VISIBLES\)/);
    assert.ok(!ecran.includes("initiale.compteurs."), "aucun nombre dans le titre du journal");
    assert.match(ecran, /window\.setTimeout\(async \(\) => \{[\s\S]*?await envoyerJson\(chemin, "POST"/);
    assert.match(ecran, /role="status" aria-live="polite"/);
    assert.match(ecran, />\s*Annuler\s*</);
    assert.match(ecran, /motif: MOTIF_IGNORER/);
    assert.match(ecran, /const MOTIF_IGNORER = "INUTILE";/);
  });

  test("dates relatives par la seule fonction dateRelative, date exacte au survol ; liens vers /dossiers, /leads, /clients, /mail", () => {
    assert.match(groupe, /dateRelative\(e\.le, maintenant\)/);
    assert.match(groupe, /title=\{dateExacte\(e\.le\)\}/);
    assert.ok(!/toLocale(Date|Time)?String/.test(ecran + groupe), "aucun format de date local hors lib/v2/dates");
    for (const chemin of ["/clients/", "/leads?lead=", "/dossiers?dossier="]) assert.ok(logique.includes(chemin), chemin);
    assert.match(groupe, /<Link href=\{e\.lien\}/);
  });

  test("lisible dehors : zones de 44 px (h-11 / min-h-11), échelle de texte de la v2, jetons seulement, aucun badge", () => {
    for (const source of [ecran, groupe]) {
      assert.ok(/h-11/.test(source), "zones de 44 px");
      assert.ok(!/text-\[\d+px\]/.test(source), "pas de taille en pixels");
      assert.ok(!/#[0-9a-fA-F]{6}/.test(source), "pas d'hexadécimal");
      assert.ok(!/tracking-wide|uppercase/.test(source), "pas de capitales espacées");
      assert.ok(!/animate-/.test(source), "rien ne bouge tout seul");
      assert.ok(!/rounded-full bg-action/.test(source), "aucun badge");
    }
    assert.match(groupe, /text-corps-tel[^"]*md:text-corps/);
    assert.match(groupe, /text-petit text-texte-3/);
    // Deux tailles par carte : corps (titre et lignes) et petit (dates) ; le titre de l'écran est à part.
    assert.equal(new Set(groupe.match(/text-(corps-tel|corps|petit|titre|grand)\b/g)).size, 3);
  });

  test("le seul mouvement : TRANS_V2 (coupé sous prefers-reduced-motion)", () => {
    for (const source of [ecran, groupe]) {
      assert.ok(source.includes("TRANS_V2"));
      assert.ok(!/transition-(all|transform|opacity)|duration-\d+/.test(source));
    }
  });
});

describe("la page /journal", () => {
  test("force-dynamic ; v2 seulement, la v1 renvoie vers /taches ; ?jours= lit une période fixe (30 au plus) sans « Tout vu »", () => {
    assert.match(page, /export const dynamic = "force-dynamic";/);
    assert.match(page, /if \(v !== "v2"\) redirect\("\/taches"\);/);
    assert.match(page, /const JOURS_MAX = 30;/);
    assert.match(page, /vuLe: jours > 0 \? null/);
    assert.match(page, /depuisDeLaVisite\(maintenant\)/);
  });

  test("le composant accepte `compact` (lot A2 : le bloc d'Aujourd'hui) avec le lien « Tout le journal »", () => {
    assert.match(ecran, /compact = false/);
    assert.match(ecran, /href="\/journal"[\s\S]*?Tout le journal/);
  });
});
