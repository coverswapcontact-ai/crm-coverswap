import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";

/**
 * Mission 22 (A2) — l'écran Aujourd'hui, vérifié sur ses sources (comme `coque.test.ts` et `journal-ecran.test.ts`) :
 * une seule chose en haut (Reprendre puis Maintenant), un seul bouton principal (le geste prêt de la carte, vert ; le
 * « Tout vu » du journal compact passe en contour), sept blocs au plus dans l'ordre, cinq lignes puis « Voir les N
 * autres », chaque geste répond par `toastAnnulable` (« Annuler » 5 s), le balayage et la position de retour conservés,
 * aucun badge, l'échelle de texte de la v2, aucun mouvement hors `TRANS_V2`, et la page qui choisit par
 * `interfaceCourante()` sans toucher la v1.
 */
const lire = (f: string) => readFileSync(join(process.cwd(), "src", f), "utf8").replace(/\r\n/g, "\n");
const ecran = lire("components/v2/taches/Aujourdhui.tsx");
const carte = lire("components/v2/taches/CarteTache.tsx");
const bouton = lire("components/v2/taches/BoutonGeste.tsx");
const ligne = lire("components/v2/taches/LigneV2.tsx");
const bandeau = lire("components/v2/taches/BandeauReprendre.tsx");
const gestes = lire("components/v2/taches/useGestesTaches.ts");
const listeHook = lire("components/v2/taches/useListeTaches.ts");
const panneaux = lire("components/v2/taches/PanneauxRaccourcis.tsx");
const toastSource = lire("components/v2/taches/toastAnnulable.ts");
const journal = lire("components/v2/journal/Journal.tsx");
const coque = lire("components/v2/CoqueV2.tsx");
const page = lire("app/(pilotage)/taches/page.tsx");
const v1 = lire("app/(pilotage)/taches/_components/EcranTaches.tsx");
const V2 = [ecran, carte, bouton, ligne, bandeau, panneaux];

describe("Aujourdhui.tsx : l'ordre des blocs, un seul bouton principal, deux niveaux", () => {
  test("sept blocs, dans l'ordre : Reprendre, Maintenant, Ensuite, En lot, Plus tard, Fait aujourd'hui, Depuis ta dernière visite", () => {
    const reperes = ["{/* 1. Reprendre */}", "{/* 2. Maintenant */}", "{/* 3. Ensuite */}", "{/* 4. En lot */}", "{/* 5. Plus tard */}", "{/* 6. Fait aujourd'hui */}", "{/* 7. Depuis ta dernière visite */}"];
    const positions = reperes.map((r) => ecran.indexOf(r));
    assert.ok(positions.every((p) => p >= 0), "chaque bloc est repéré");
    assert.deepEqual([...positions].sort((a, b) => a - b), positions, "dans l'ordre");
    assert.equal((ecran.match(/\{\/\* \d\. /g) ?? []).length, 7, "pas de huitième bloc");
    // Rien d'autre au-dessus : le premier bloc rendu après le bandeau hors ligne est Reprendre, puis la carte.
    assert.ok(ecran.indexOf("<BandeauReprendre") < ecran.indexOf("<CarteTache"));
    assert.ok(ecran.indexOf("<CarteTache") < ecran.indexOf('id="ensuite-titre"'));
    assert.match(ecran, /<Journal initiale=\{journal\} compact \/>/);
  });

  test("le seul bouton principal (bg-action) est le geste prêt de la carte ; « Tout vu » passe en contour en compact", () => {
    const verts = V2.map((s) => (s.match(/(?<![\w-])bg-action(?![\w/-])/g) ?? []).length);
    assert.deepEqual(verts, [0, 0, 1, 0, 0, 0], "une seule classe bg-action, dans BoutonGeste");
    assert.match(bouton, /forme === "principale" \? BOUTON_PRINCIPAL_GRAND : BOUTON_LIGNE/);
    assert.match(carte, /<BoutonGeste tache=\{tache\} actions=\{actions\} forme="principale"/);
    assert.match(ligne, /<BoutonGeste tache=\{tache\} actions=\{actions\} forme="ligne"/);
    assert.match(journal, /className=\{compact \? BOUTON_SECONDAIRE : BOUTON_PRINCIPAL\}/);
    assert.match(bouton, /import \{ gestePret \} from "@\/lib\/v2\/geste-pret"/);
  });

  test("Ensuite : cinq lignes puis « Voir les N autres » ; Plus tard : trois ; J'ai 5 / 15 / 30 min remplace la liste", () => {
    const logique = lire("lib/v2/aujourdhui.ts");
    assert.match(logique, /export const ENSUITE_VISIBLES = 5;/);
    assert.match(logique, /export const PLUS_TARD_VISIBLES = 3;/);
    assert.match(logique, /export const MINUTES_V2 = \[5, 15, 30\] as const;/);
    assert.match(ecran, /decouper\(vue\)/);
    assert.match(ecran, /libelleVoirAutres\(blocs\.autres\.length\)/);
    assert.match(ecran, /plusTard\.slice\(0, PLUS_TARD_VISIBLES\)/);
    assert.match(ecran, /\/api\/a-faire\/minutes\?m=\$\{minutes\}/);
    assert.match(ecran, /planActif \? planActif\.taches\.filter/);
    assert.match(ecran, /<ModeTaches/);
    assert.match(ecran, /<AjoutTache/);
  });

  test("Maintenant : titre 24 px (text-grand), une phrase, marche à suivre, Fait / Plus tard / Pas à faire en contour, balayage", () => {
    assert.match(carte, /text-grand leading-tight font-semibold/);
    assert.match(carte, /ligneGrise\(tache, new Date\(maintenant\)\)/);
    assert.match(carte, /marcheASuivre\(tache\)/);
    assert.match(carte, /useBalayage\(\{ onDroite: \(\) => actions\.onFait\(tache\), onGauche: \(\) => actions\.onPlusTard\(tache\)/);
    for (const libelle of ["Fait", "Plus tard", "Pas à faire", "Ignorer"]) assert.match(carte, new RegExp(`className=\\{secondaire\\}>\\s*${libelle}\\s*</button>`), libelle);
    // Deux tailles de texte par carte : grand (le titre) et corps.
    assert.deepEqual([...new Set(carte.match(/text-(corps-tel|corps|petit|titre|grand)\b/g))].sort(), ["text-corps", "text-corps-tel", "text-grand"]);
    assert.deepEqual([...new Set(ligne.match(/text-(corps-tel|corps|petit|titre|grand)\b/g))].sort(), ["text-corps", "text-corps-tel", "text-petit"]);
  });
});

describe("chaque geste répond, la position revient, Reprendre", () => {
  test("toastAnnulable : la ligne écrite et « Annuler » pendant 5 s, utilisée par les réponses et les lots", () => {
    assert.match(toastSource, /export const DUREE_ANNULATION_MS = 5_000;/);
    assert.match(toastSource, /action: \{ label: "Annuler", onClick: \(\) => annuler\(\) \}/);
    assert.match(gestes, /toastAnnulable\(messageReponse\(tache, entree, resultat\.tache, Date\.now\(\)\), \(\) => void annuler\(tache\), tache\.titre\)/);
    assert.match(ecran, /toastAnnulable\(pluriel\(resultat\.classees, "tâche classée", "tâches classées"\), \(\) => void annulerLot\(lot, resultat\.le\)/);
    assert.match(gestes, /`\/api\/a-faire\/\$\{tache\.id\}\/annuler`/);
    assert.match(gestes, /`\/api\/a-faire\/\$\{tache\.id\}\/reponse`/);
  });

  test("les gestes de la v1, tous repris : lancer par genre, appeler, ouvrir la fiche, corriger, commencer, noter le retour", () => {
    for (const genre of ["APPEL", "SMS", "MAIL", "ESPACE", "DOSSIER", "DEVIS", "ENCAISSER", "SIMULATEUR", "RELANCE_MAIL", "PLANIFIER", "VALIDER", "LEAD", "COHERENCE", "PAGE"]) assert.ok(gestes.includes(`case "${genre}":`), genre);
    assert.match(gestes, /export const CLE_POSITION = "taches:position";/);
    assert.match(gestes, /sessionStorage\.setItem\(CLE_POSITION/);
    assert.match(gestes, /noterDebutAppel\(leadId \?\? `dossier:\$\{dossierId\}`, \{ nom: nomDuTitre\(tache\.titre\), dossierId, depuisFile: true \}\)/);
    assert.match(gestes, /ouvrirEcranSms\(\{ demande: r\.sms as DemandeEcranSms/);
    assert.match(gestes, /\/api\/a-faire\/\$\{id\}\/commencer/);
    assert.match(gestes, /\/api\/coherence\/corriger/);
    // Les panneaux de la v1, montés une fois.
    for (const composant of ["<PanneauDossier", "<PanneauMail", "<PanneauEntrant", "<RelectureMail", "<FeuilleDateChantier", "<FeuilleReponse"]) assert.ok(panneaux.includes(composant), composant);
    // La relecture : 4,5 s après un geste, 20 s, écoutes, hors ligne.
    assert.match(listeHook, /export const RELEVE_MS = 20_000;/);
    assert.match(listeHook, /export const RELECTURE_APRES_MS = 4_500;/);
    for (const motif of ["EVENEMENT_COMPTEURS", "EVENEMENT_LEADS_MODIFIES", "EVENEMENT_APPEL_TERMINE", '"online"', '"visibilitychange"', "ecouterLeCache", "vientDuCache"]) assert.ok(listeHook.includes(motif), motif);
    assert.match(ecran, /scrollIntoView\(\{ block: "nearest" \}\)/);
  });

  test("Reprendre : mémoire de l'appareil (localStorage) écrite par la coque, mémoire serveur par POST /api/reprendre, 48 h, fermable", () => {
    const memoire = lire("components/v2/MemoireReprendre.tsx");
    const client = lire("components/v2/reprendre-client.ts");
    assert.match(coque, /<Suspense fallback=\{null\}>\s*<MemoireReprendre \/>\s*<\/Suspense>/);
    assert.match(memoire, /contexteDepuisAdresse\(pathname, chaine\)/);
    assert.match(client, /window\.localStorage\.setItem\(CLE_REPRENDRE, JSON\.stringify\(memo\)\)/);
    assert.match(client, /fetch\("\/api\/reprendre", \{ method: "POST"/);
    assert.match(gestes, /memoriserReprendre\(\{ chemin: `\/dossiers\?dossier=\$\{encodeURIComponent\(dossierId\)\}`/);
    assert.match(bandeau, /choisirReprendre\(lireMemoireReprendre\(\), serveur, instant, ferme\)/);
    assert.match(bandeau, /Reprendre : \{contexte\.titre\}/);
    assert.match(bandeau, /dateRelative\(contexte\.le, maintenant\)/);
    assert.match(bandeau, /title=\{dateExacte\(contexte\.le\)\}/);
    assert.match(bandeau, /aria-label="Fermer « Reprendre »"/);
    assert.match(page, /lireReprendre\(maintenant\)/);
    assert.match(lire("lib/parametres/definitions.ts"), /DERNIER_DOSSIER_OUVERT: \{/);
  });
});

describe("lisible dehors, rien ne bouge tout seul, la page et la v1", () => {
  test("zones de 44 px, échelle de texte de la v2, jetons seulement, aucun badge, aucune capitale espacée", () => {
    for (const source of V2) {
      // 44 px : en classe, ou par les constantes partagées (BOUTON_SECONDAIRE h-11, BOUTON_PRINCIPAL_GRAND h-14).
      if (source !== panneaux) assert.ok(/h-11|min-h-11|h-14|BOUTON_SECONDAIRE/.test(source), "zones de 44 px");
      assert.ok(!/text-\[\d+(\.\d+)?px\]/.test(source), "pas de taille en pixels");
      assert.ok(!/#[0-9a-fA-F]{6}/.test(source), "pas d'hexadécimal");
      assert.ok(!/tracking-wide|uppercase/.test(source), "pas de capitales espacées");
      assert.ok(!/rounded-full bg-action/.test(source), "aucun badge");
      assert.ok(!/transition-(all|transform|opacity)|duration-(?!150)\d+/.test(source), "aucun mouvement hors TRANS_V2");
      assert.ok(!/animate-(?!spin|none)/.test(source), "aucune animation décorative (l'attente reste, coupée sous prefers-reduced-motion)");
    }
    assert.match(ecran, /animate-spin motion-reduce:animate-none/);
    assert.ok(!/toLocale(Date|Time)?String/.test(bandeau + ecran + carte + ligne), "dates par lib/v2/dates et affichage.ts seulement");
  });

  test("la page choisit par interfaceCourante() : v2 → Aujourdhui (liste, journal compact à 20 lignes, Reprendre) ; sinon EcranTaches, inchangé", () => {
    assert.match(page, /const v = await interfaceCourante\(\);\s*if \(v !== "v2"\) \{\s*const initiale = await listeTaches\(new Date\(\)\);\s*return <EcranTaches initiale=\{initiale\} \/>;\s*\}/);
    assert.match(page, /Promise\.all\(\[listeTaches\(maintenant\), depuisDeLaVisite\(maintenant\), lireReprendre\(maintenant\)\]\)/);
    assert.match(page, /journal\(\{ depuis: visite\.depuis, jusqua: maintenant, parPage: JOURNAL_PAR_PAGE \}\)/);
    assert.match(lire("lib/v2/aujourdhui.ts"), /export const JOURNAL_PAR_PAGE = 20;/);
    assert.match(page, /export const dynamic = "force-dynamic";/);
    // La v1 n'importe rien de la v2.
    assert.ok(!v1.includes("components/v2"));
    assert.ok(!v1.includes("lib/v2"));
  });
});
