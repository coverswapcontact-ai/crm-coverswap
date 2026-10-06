import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";

/**
 * Mission 22 (lot A0b) — la coque v2, vérifiée sur ses sources (comme `app/lisibilite.test.ts`) : cinq entrées et
 * rien d'autre, les adresses inchangées, un seul compteur (Aujourd'hui), aucun autre badge, le retour à la v1 dans
 * « Plus », les composants que les écrans attendent du gabarit, et le seul mouvement autorisé.
 */
const lire = (f: string) => readFileSync(join(process.cwd(), "src", f), "utf8").replace(/\r\n/g, "\n");
const navigation = lire("components/v2/NavigationV2.tsx");
const coque = lire("components/v2/CoqueV2.tsx");
const gabarit = lire("app/(pilotage)/layout.tsx");
const recherche = lire("components/v2/RechercheGlobale.tsx");
const transitions = lire("components/v2/transitions.ts");

describe("NavigationV2 : quatre entrées et Plus, aux adresses d'avant", () => {
  test("Aujourd'hui /taches, Dossiers /dossiers, Personnes /leads (+ /clients), Argent /finances (+ /depenses/nouvelle)", () => {
    const bloc = navigation.slice(navigation.indexOf("export const ENTREES"), navigation.indexOf("export const DANS_PLUS"));
    const entrees = [...bloc.matchAll(/href: "([^"]+)", libelle: "([^"]+)"/g)].map((m) => [m[1], m[2]]);
    assert.deepEqual(entrees, [
      ["/taches", "Aujourd'hui"],
      ["/dossiers", "Dossiers"],
      ["/leads", "Personnes"],
      ["/finances", "Argent"],
    ]);
    assert.match(bloc, /href: "\/leads", libelle: "Personnes", icone: \w+, aussi: \["\/clients"\]/);
    assert.match(bloc, /href: "\/finances", libelle: "Argent", icone: \w+, aussi: \["\/depenses\/nouvelle"\]/);
    // La barre du bas : cinq cases, les quatre entrées puis « Plus ».
    assert.match(navigation, /grid h-16 grid-cols-5/);
  });

  test("Plus : Boîte mail, Simulateur, Site, Bilan, Réglages, À valider, et le retour à l'ancienne interface", () => {
    const bloc = navigation.slice(navigation.indexOf("export const DANS_PLUS"), navigation.indexOf("const ENTREE_COMPTEE"));
    const entrees = [...bloc.matchAll(/href: "([^"]+)", libelle: "([^"]+)"/g)].map((m) => [m[1], m[2]]);
    assert.deepEqual(entrees, [
      ["/mail", "Boîte mail"],
      ["/simulateur", "Simulateur"],
      ["/site", "Site"],
      ["/analytique", "Bilan"],
      ["/parametres", "Réglages"],
      ["/validation", "À valider"],
    ]);
    assert.match(navigation, /\/api\/interface\?v=v1&retour=\$\{encodeURIComponent\(pathname\)\}/);
    assert.match(navigation, /Retour à l&apos;ancienne interface/);
  });

  test("un seul compteur, sur Aujourd'hui ; aucun badge ailleurs", () => {
    assert.match(navigation, /const ENTREE_COMPTEE = "\/taches"/);
    assert.equal((navigation.match(/<CompteurAujourdhui /g) ?? []).length, 2, "une fois par barre (haut, bas)");
    assert.equal((navigation.match(/entree\.href === ENTREE_COMPTEE/g) ?? []).length, 2);
    for (const cle of ["leadsEnRetard", "mailATraiter", "tachesEnEchec", "alerteMenu", "aTraiterMenu", "bg-retard"]) assert.ok(!navigation.includes(cle), cle);
    // Rafraîchi comme en v1 : 60 s, focus, visibilité, et après chaque écriture.
    for (const motif of ["/api/pilotage/compteurs", "60_000", '"focus"', "EVENEMENT_COMPTEURS", '"visibilitychange"']) assert.ok(navigation.includes(motif), motif);
  });

  test("rien ne bouge tout seul : la seule transition est la couleur, coupée sous prefers-reduced-motion", () => {
    assert.match(transitions, /export const TRANS_V2 = "transition-colors duration-150 ease-\[ease\] motion-reduce:transition-none"/);
    for (const source of [navigation, recherche, coque]) {
      assert.doesNotMatch(source, /animate-(?!spin)/);
      assert.doesNotMatch(source, /transition-(?!colors)|duration-(?!150)/);
    }
  });

  test("la recherche globale : loupe en haut, ⌘K / Ctrl K, champ dans Plus sur téléphone, Entrée ouvre le chemin", () => {
    assert.match(navigation, /<RechercheGlobale variante="loupe" \/>/);
    assert.match(navigation, /<RechercheGlobale variante="champ" \/>/);
    assert.match(recherche, /\(evenement\.metaKey \|\| evenement\.ctrlKey\) && evenement\.key\.toLowerCase\(\) === "k"/);
    assert.match(recherche, /\/api\/recherche\?q=\$\{encodeURIComponent\(q\)\}/);
    assert.match(recherche, /routeur\.push\(candidat\.chemin\)/);
    assert.match(recherche, /evenement\.key === "Enter"/);
    assert.match(recherche, /type="search"/);
  });
});

describe("CoqueV2 et le gabarit", () => {
  test("la coque garde ce que les écrans attendent : fond, RetourAppel, HoteEcranSms, bandeau d'essai, main avec les zones sûres", () => {
    for (const motif of ["<BandeauEssai />", "<NavigationV2 />", "<PriseInterface />", "<RetourAppel />", "<HoteEcranSms />", "bg-fond text-texte", 'pt-[env(safe-area-inset-top)] pb-[calc(4rem+env(safe-area-inset-bottom))] md:pb-0']) {
      assert.ok(coque.includes(motif), motif);
    }
    assert.doesNotMatch(coque, /"use client"/);
  });

  test("le gabarit choisit par interfaceCourante() : v2 → CoqueV2, sinon le gabarit v1 avec le bandeau et la prise", () => {
    assert.match(gabarit, /const v = await interfaceCourante\(\);\s*if \(v === "v2"\) return <CoqueV2>\{children\}<\/CoqueV2>;/);
    for (const motif of ["<BandeauEssai />", "<Navigation />", "<PriseInterface />", "<RetourAppel />", "<HoteEcranSms />"]) assert.ok(gabarit.includes(motif), motif);
  });

  test("le bandeau d'essai : 44 px, jeton attention, texte lisible, sans animation", () => {
    const bandeau = lire("components/v2/BandeauEssai.tsx");
    assert.match(bandeau, /if \(!essaiLocal\(\)\) return null;/);
    assert.match(bandeau, /min-h-\[44px\]/);
    assert.match(bandeau, /bg-attention/);
    assert.match(bandeau, /text-texte-inverse/);
    assert.doesNotMatch(bandeau, /animate-|transition/);
  });
});
