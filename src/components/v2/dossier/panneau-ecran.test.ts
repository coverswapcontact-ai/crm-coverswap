import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";

/**
 * Mission 22 (A3) — le panneau de dossier v2, vérifié sur ses sources (comme `aujourdhui-ecran.test.ts`) : l'en-tête
 * de situation en trois lignes et en premier, un seul bouton principal (le `bg-action` de `BoutonGeste`, rendu une
 * fois par `BoutonGesteDossier`), « Autres gestes » repliés, À faire ici (mêmes gestes qu'Aujourd'hui, `toastAnnulable`
 * par `useGestesTaches`), Ce qui s'est passé ici (cinq lignes puis « Voir les N autres »), les rubriques v1 réutilisées
 * et fermées sauf une, le même contrat que la v1 (Sheet, `?rubrique=`, `?devis=`, relecture 30 s), le point de choix
 * dans `dossiers/page.tsx` + `DossiersPilotage` (v1 par défaut), et la lisibilité (jetons, 44 px, échelle v2).
 */
const lire = (f: string) => readFileSync(join(process.cwd(), "src", f), "utf8").replace(/\r\n/g, "\n");
const panneau = lire("components/v2/dossier/PanneauDossierV2.tsx");
const entete = lire("components/v2/dossier/EnTeteSituation.tsx");
const aFaire = lire("components/v2/dossier/AFaireIci.tsx");
const passe = lire("components/v2/dossier/CeQuiSestPasseIci.tsx");
const rubriques = lire("components/v2/dossier/RubriquesDossier.tsx");
const bouton = lire("components/v2/taches/BoutonGeste.tsx");
const panneaux = lire("components/v2/taches/PanneauxRaccourcis.tsx");
const pilotage = lire("app/(pilotage)/dossiers/_components/DossiersPilotage.tsx");
const page = lire("app/(pilotage)/dossiers/page.tsx");
const v1 = lire("app/(pilotage)/dossiers/_components/PanneauDossier.tsx");
const V2 = [panneau, entete, aFaire, passe, rubriques];

describe("PanneauDossierV2 : une seule chose en haut, un seul bouton principal, cinq blocs", () => {
  test("cinq blocs dans l'ordre : en-tête de situation, bouton principal + autres gestes, À faire ici, Ce qui s'est passé ici, rubriques", () => {
    const reperes = ["{/* 1. L'en-tête de situation */}", "{/* 2. Le bouton principal, et les autres gestes repliés */}", "{/* 3. À faire ici */}", "{/* 4. Ce qui s'est passé ici */}", "{/* 5. Les rubriques */}"];
    const positions = reperes.map((r) => panneau.indexOf(r));
    assert.ok(positions.every((p) => p >= 0), "chaque bloc est repéré");
    assert.deepEqual([...positions].sort((a, b) => a - b), positions, "dans l'ordre");
    assert.equal((panneau.match(/\{\/\* \d\. /g) ?? []).length, 5, "pas de sixième bloc");
    assert.ok(panneau.indexOf("<EnTeteSituation") < panneau.indexOf("<BoutonGesteDossier"));
    assert.ok(panneau.indexOf("<BoutonGesteDossier") < panneau.indexOf("<AFaireIci"));
    assert.ok(panneau.indexOf("<AFaireIci") < panneau.indexOf("<CeQuiSestPasseIci"));
    assert.ok(panneau.indexOf("<CeQuiSestPasseIci") < panneau.indexOf("<RubriquesDossier"));
  });

  test("l'en-tête : les trois lignes de lib/v2/situation.ts, l'étape en mots, la date exacte au survol, « Modifier »", () => {
    assert.match(entete, /situationDe\(detail, espace, maintenant\)/);
    for (const ligne of ["lignes.quiQuoi", "lignes.etape", "lignes.situation", "lignes.prochaineAction"]) assert.ok(entete.includes(`{${ligne}}`), ligne);
    assert.match(entete, /title=\{detail\.mainLe \? dateExacte\(detail\.mainLe\) : undefined\}/);
    assert.match(entete, /COULEURS_ETAPE\[detail\.etape\]/);
    assert.match(entete, /onClick=\{onModifierAction\}[^>]*>\s*Modifier\s*<\/button>/);
    assert.ok(!entete.includes("PastilleEtape") && !entete.includes("BadgeMain") && !entete.includes("BarreProgression"), "ni pastille, ni badge, ni barre : des phrases");
    assert.match(panneau, /<ProchaineActionEditeur/);
  });

  test("un seul bouton vert : le bg-action de BoutonGeste, rendu une fois par BoutonGesteDossier ; les autres gestes en liste repliée de 44 px", () => {
    const verts = [...V2, bouton].map((s) => (s.match(/(?<![\w-])bg-action(?![\w/-])/g) ?? []).length);
    assert.deepEqual(verts, [0, 0, 0, 0, 0, 1], "une seule classe bg-action, dans BoutonGeste");
    assert.equal((panneau.match(/<BoutonGesteDossier/g) ?? []).length, 1);
    assert.match(bouton, /export function BoutonGesteDossier/);
    assert.match(bouton, /if \(geste\.genre === "TACHE" && geste\.tache\) return <BoutonGeste tache=\{geste\.tache\} actions=\{actions\} forme=\{forme\}/);
    assert.match(panneau, /gestePrincipal\(\{ detail, espace, tache, maintenant \}\)/);
    assert.match(panneau, /autresGestes\(detail, principal\)/);
    assert.match(panneau, /aria-expanded=\{autresOuverts\}[\s\S]{0,200}?>\s*Autres gestes/);
    assert.match(panneau, /min-h-11 w-full items-center px-4 py-2 text-left text-corps-tel/);
    // Les gestes d'étape passent par les feuilles et modales de la v1.
    for (const composant of ["<ModalePaiement", "<GenerateurDocument", "<ModaleDocumentExistant", "<FeuilleDateChantier", "<RelectureMail", "ouvrirEcranSms(", "<ChangementEtape"]) assert.ok((panneau + rubriques).includes(composant), composant);
    assert.match(panneau, /routeur\.push\(`\/simulateur\?dossier=\$\{encodeURIComponent\(detail\.id\)\}`\)/);
    assert.match(panneau, /\/api\/relances\?dossierId=/);
  });

  test("À faire ici : les tâches du détail, LigneTacheV2, useGestesTaches (toastAnnulable), cinq lignes puis « Voir les N autres » ; jamais un second panneau de dossier", () => {
    assert.match(panneau, /useGestesTaches\(\{ ordre, relire: onRecharger, relireApres, masquer, demasquer \}\)/);
    assert.match(panneau, /tachePrete\(taches, maintenant\)/);
    assert.match(aFaire, /<LigneTacheV2 /);
    assert.match(aFaire, /taches\.slice\(0, ENSUITE_VISIBLES\)/);
    assert.match(aFaire, /libelleVoirAutres\(taches\.length - visibles\.length\)/);
    assert.match(panneau, /if \(!ouvert \|\| ouvert\.vue !== "DOSSIER"\) return;/);
    assert.match(panneau, /<FeuillesRaccourcis gestes=\{gestes\}/);
    assert.ok(!panneau.includes("<PanneauxRaccourcis") && !panneau.includes("<PanneauDossier "), "pas de panneau de dossier dans le panneau de dossier");
    assert.match(panneaux, /export function FeuillesRaccourcis/);
    assert.match(panneaux, /<PanneauDossierV2 dossierId=\{ouvert\?\.vue === "DOSSIER" \? ouvert\.dossierId : null\}/);
    assert.match(lire("components/v2/taches/useGestesTaches.ts"), /toastAnnulable\(/);
  });

  test("Ce qui s'est passé ici : cinq lignes de /api/chronologie, dates relatives, puis la Chronologie existante en compact", () => {
    assert.match(passe, /export const PASSE_VISIBLES = 5;/);
    assert.match(passe, /limite: String\(PASSE_VISIBLES\)/);
    assert.match(passe, /dateRelative\(e\.le, new Date\(maintenant\)\)/);
    assert.match(passe, /title=\{dateExacte\(e\.le\)\}/);
    assert.match(passe, /libelleVoirAutres\(lu\.total - PASSE_VISIBLES\)/);
    assert.match(passe, /<Chronologie cible=\{cible\} titre="Chronologie du client" compact \/>/);
  });

  test("les rubriques : les sections de la v1 telles quelles, une seule ouverte (celle de l'étape ou du raccourci), titres en phrases", () => {
    for (const section of ["<PhotosDossier", "<EspaceDossier", "<DocumentsDossier", "<PaiementsDossier", "<SimulationsDossier", "<FamillesDossier", "<DelaisEcarts", "<DepensesDossier", "<TimelineEtapes", "<CoordonneesClient", "<ArchivageDossier", "<HistoriqueEvenements", "<ACompleter", "<ChangementEtape"]) assert.ok(rubriques.includes(section), section);
    assert.match(rubriques, /RUBRIQUES_V2\.filter\(\(r\) => contenu\[r\] !== null\)\.map/);
    assert.match(rubriques, /id=\{`rubrique-\$\{r\}`\} titre=\{TITRES_RUBRIQUES\[r\]\}/);
    assert.match(panneau, /new Set\(\[demande \? rubriqueDemandee\(demande\.rubrique\) : rubriqueDeLEtape\(detail\.etape\)\]\)/);
    assert.ok(!rubriques.includes("uppercase"), "titres en phrases");
    assert.ok(!rubriques.includes("TitreSection"), "pas le surtitre en capitales de la v1");
  });
});

describe("même contrat que la v1, point de choix, lisibilité", () => {
  test("le Sheet, la fermeture, ?rubrique= (défilement, curseur dans le fil), ?devis= lu une fois, relecture 30 s et au retour sur l'onglet", () => {
    assert.match(panneau, /export function PanneauDossierV2\(\{ dossierId, maintenant, onFermer, onMisAJour, onArchive, demande = null \}/);
    assert.match(panneau, /data-\[side=right\]:w-full data-\[side=right\]:sm:max-w-\[620px\]/);
    assert.match(v1, /data-\[side=right\]:w-full data-\[side=right\]:sm:max-w-\[620px\]/);
    assert.match(panneau, /onOpenChange=\{\(ouvert\) => \(ouvert \? undefined : onFermer\(\)\)\}/);
    assert.match(panneau, /defilerVers\(cibleDuDefilement\(demande\.rubrique\)\)/);
    assert.match(panneau, /getElementById\("reponse-espace"\)\?\.focus/);
    assert.match(panneau, /url\.searchParams\.get\("devis"\)/);
    assert.match(panneau, /window\.setInterval\(relire, 30_000\)/);
    assert.match(panneau, /addEventListener\("visibilitychange", surVisibilite\)/);
    assert.match(panneau, /key=\{`\$\{affiche\.id\}:\$\{demande\?\.cle \?\? 0\}`\}/);
    // Une réponse d'écriture sans espace ni tâches : les précédents restent.
    assert.match(panneau, /espace: nouveau\.espace === undefined \? precedent\.espace : nouveau\.espace, taches: nouveau\.taches \?\? precedent\.taches/);
    // Le défilement respecte prefers-reduced-motion.
    assert.match(panneau, /prefers-reduced-motion: reduce/);
  });

  test("le point de choix : dossiers/page.tsx lit interfaceCourante() et choisit seul ; DossiersPilotage (v1) ne connaît pas la v2", () => {
    // Mission 22 (A4) : la page lit l'interface d'abord, pour demander au serveur la vue de la v2 (« Chez moi »).
    // Correctifs du 07/10 : la prop `interface` et la branche v2 de DossiersPilotage (code mort depuis A4) sont retirées.
    assert.match(page, /const version = await interfaceCourante\(\);/);
    assert.match(page, /if \(version === "v2"\) \{\s*return \(\s*<DossiersV2/);
    assert.match(page, /<DossiersPilotage\s+initial=\{dossiers\}/);
    assert.ok(!pilotage.includes("PanneauDossierV2") && !pilotage.includes("interface"), "DossiersPilotage ne monte que PanneauDossier");
    assert.match(pilotage, /<PanneauDossier\s+dossierId=\{dossierOuvertId\}/);
    assert.ok(!v1.includes("components/v2") && !v1.includes("lib/v2"), "la v1 n'importe rien de la v2");
    assert.ok(!pilotage.includes("components/v2") && !pilotage.includes("lib/v2"), "DossiersPilotage n'importe rien de la v2");
    // Le serveur : ajout de champs seulement.
    const route = lire("app/api/dossiers/[id]/route.ts");
    assert.match(route, /completerDetail\(await chargerDetail\(id\)\)/);
    assert.match(lire("lib/dossiers/situation.ts"), /espacesDesDossiers\(maintenant, \[dossierId\]\), tachesDuDossier\(dossierId, maintenant\)/);
    assert.match(lire("lib/a-faire/lecture.ts"), /export async function tachesDuDossier\(dossierId: string, maintenant: Date = new Date\(\)\): Promise<TacheVue\[\]>/);
    assert.match(lire("lib/dossiers/types.ts"), /taches\?: TacheVue\[\];/);
  });

  test("lisible dehors : jetons seulement, 44 px, échelle de texte v2, aucun badge, aucune capitale espacée, aucun mouvement hors TRANS_V2", () => {
    for (const source of V2) {
      assert.ok(/h-11|min-h-11|h-14|BOUTON_SECONDAIRE/.test(source), "zones de 44 px");
      assert.ok(!/text-\[\d+(\.\d+)?px\]/.test(source), "pas de taille en pixels");
      assert.ok(!/#[0-9a-fA-F]{6}/.test(source), "pas d'hexadécimal");
      assert.ok(!/tracking-wide|uppercase/.test(source), "pas de capitales espacées");
      assert.ok(!/rounded-full bg-action|rounded-full bg-retard/.test(source), "aucun badge");
      assert.ok(!/transition-(all|transform|opacity)|duration-(?!150)\d+/.test(source), "aucun mouvement hors TRANS_V2");
      assert.ok(!/animate-(?!spin|pulse|none)/.test(source), "aucune animation décorative");
      assert.ok(!/toLocale(Date|Time)?String/.test(source), "dates par lib/v2/dates seulement");
    }
    assert.match(panneau, /animate-pulse rounded bg-surface-2 motion-reduce:animate-none/);
    // Deux tailles de texte par carte : l'en-tête (titre + corps), la ligne de chronologie (corps + petit).
    assert.deepEqual([...new Set(entete.match(/text-(corps-tel|corps|petit|titre|grand)\b/g))].sort(), ["text-corps", "text-corps-tel", "text-titre"]);
    assert.deepEqual([...new Set(passe.match(/text-(corps-tel|corps|petit|titre|grand)\b/g))].sort(), ["text-corps", "text-corps-tel", "text-petit", "text-titre"]);
  });
});
