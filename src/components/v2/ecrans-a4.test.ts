import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";

/**
 * Mission 22 (A4) — les écrans Dossiers, Personnes et Argent de la v2, vérifiés sur leurs sources (comme
 * `aujourdhui-ecran.test.ts` et `panneau-ecran.test.ts`) : l'ordre des blocs, un seul dessin de bouton principal par
 * écran, cinq lignes puis « Voir les N autres », le même format de situation que le panneau, les composants de la v1
 * réutilisés tels quels, les pages qui choisissent par `interfaceCourante()` sans toucher la v1, et la lisibilité
 * (jetons, 44 px, échelle de texte v2, aucune capitale espacée, aucun badge, aucun mouvement hors `TRANS_V2`).
 */
const lire = (f: string) => readFileSync(join(process.cwd(), "src", f), "utf8").replace(/\r\n/g, "\n");
const dossiers = lire("components/v2/dossiers/DossiersV2.tsx");
const ligneDossier = lire("components/v2/dossiers/LigneDossierV2.tsx");
const personnes = lire("components/v2/personnes/PersonnesV2.tsx");
const lignesPersonnes = lire("components/v2/personnes/LignesPersonnes.tsx");
const argent = lire("components/v2/argent/ArgentV2.tsx");
const segments = lire("components/v2/liste/Segments.tsx");
const troncature = lire("components/v2/liste/Troncature.tsx");
const panneau = lire("components/v2/dossier/PanneauDossierV2.tsx");
const recherche = lire("components/v2/RechercheGlobale.tsx");
const pageDossiers = lire("app/(pilotage)/dossiers/page.tsx");
const pageLeads = lire("app/(pilotage)/leads/page.tsx");
const pageClients = lire("app/(pilotage)/clients/page.tsx");
const pageFinances = lire("app/(pilotage)/finances/page.tsx");
const V2 = [dossiers, ligneDossier, personnes, lignesPersonnes, argent, segments, troncature];
const V1 = ["app/(pilotage)/dossiers/_components/DossiersPilotage.tsx", "app/(pilotage)/leads/_components/EcranLeads.tsx", "app/(pilotage)/clients/_components/ListeClients.tsx", "app/(pilotage)/finances/_components/TableauFinances.tsx"].map(lire);

const ordre = (source: string, reperes: string[]) => {
  const positions = reperes.map((r) => source.indexOf(r));
  assert.ok(positions.every((p) => p >= 0), `chaque bloc est repéré : ${reperes.filter((_, i) => positions[i] < 0).join(", ")}`);
  assert.deepEqual([...positions].sort((a, b) => a - b), positions, "dans l'ordre");
};

describe("Dossiers v2 : la liste « ce qui m'attend », les segments, une ligne = la situation + le geste", () => {
  test("trois blocs dans l'ordre (les segments seuls en haut, la liste, puis chercher / filtrer / ouvrir) ; le panneau, les archives et la création de la v1 derrière", () => {
    // Correctifs du 07/10 (É7) : une seule chose en haut = la rangée de segments ; recherche, filtres, vue et création sous les cinq premières lignes.
    ordre(dossiers, ["{/* 1. Quels dossiers : la rangée de segments, rien d'autre en haut (correctifs du 07/10, É7) */}", "{/* 2. La liste (ou les colonnes) */}", "<BoutonVoirAutres reste={decoupe.reste}", "{/* 3. Chercher, filtrer, ouvrir : sous les cinq premières lignes, jamais en tête */}", "<ChampRecherche", "aria-expanded={plusDeFiltres}", "{vue === \"liste\" ? \"Vue en colonnes\" : \"Vue en liste\"}", "onClick={ouvrirCreation} className={BOUTON_SECONDAIRE}", "<PanneauDossierV2", "<DossiersArchives", "<CreationDossier"]);
    assert.equal((dossiers.match(/\{\/\* \d\. /g) ?? []).length, 3);
    assert.match(dossiers, /<section aria-label="Quels dossiers">\s*<Segments/);
    assert.match(dossiers, /options=\{SEGMENTS_DOSSIERS\}/);
    assert.match(dossiers, /vue: vueDuSegment\(f\.segment\)/);
    assert.match(dossiers, /trierCeQuiMattend\(retenus, maintenant\)/);
    assert.match(dossiers, /dansLeSegment\(d, segment, maintenant\)/);
    assert.match(dossiers, /decouperLignes\(visibles, tout\)/);
    assert.match(dossiers, /<BoutonVoirAutres reste=\{decoupe\.reste\}/);
    assert.match(dossiers, /<PagesV2 total=\{total\} page=\{page\} parPage=\{initial\.parPage\}/);
    // La seconde vue : le kanban de la v1 tel quel, même préférence.
    assert.match(dossiers, /<VueKanban dossiers=\{visibles\}/);
    assert.match(lire("lib/v2/dossiers.ts"), /export const CLE_VUE_DOSSIERS = "dossiers:vue";/);
    assert.match(dossiers, /Vue en colonnes/);
    // Les adresses : ?dossier=, ?q=, ?espace=, ?archives=1 ; la création préremplie consommée.
    for (const p of ['"dossier"', '"q"', '"espace"', '"etapeEspace"', '"archives"', '"lead"', '"prospect"', '"client"']) assert.ok(dossiers.includes(`url.searchParams.${dossiers.includes(`url.searchParams.set(${p}`) ? "set" : "delete"}(${p}`), p);
  });

  test("une ligne : la barre de couleur, les trois lignes de situation (lib/v2/situation.ts, le format du panneau), le geste principal en contour", () => {
    assert.match(ligneDossier, /situationDe\(dossier, dossier\.espace, maintenant\)/);
    assert.match(ligneDossier, /couleurBarre\(dossier, maintenant\)/);
    assert.match(ligneDossier, /MOI: "bg-action-clair", CLIENT: "bg-texte-3", ROUGE: "bg-retard"/);
    assert.match(ligneDossier, /gesteDeLaLigne\(dossier, maintenant\)/);
    // (un `[^>]*` ne traverse pas une flèche `=>` : deux assertions.)
    assert.match(ligneDossier, /<BoutonGesteDossier geste=\{geste\} actions=\{SANS_TACHE\} onGeste=\{executer\}/);
    assert.match(ligneDossier, /onAppel=\{\(\) => noterDebutAppel\([^)]*\)\} forme="ligne" \/>/);
    assert.match(ligneDossier, /demandePourGeste\(g\)/);
    assert.match(ligneDossier, /noterDebutAppel\(`dossier:\$\{dossier\.id\}`/);
    for (const ligne of ["lignes.quiQuoi", "lignes.etape", "lignes.situation", "lignes.prochaineAction"]) assert.ok(ligneDossier.includes(`{${ligne}}`), ligne);
    // Le même composant de situation que l'en-tête du panneau.
    assert.match(lire("components/v2/dossier/EnTeteSituation.tsx"), /situationDe\(detail, espace, maintenant\)/);
    // Aucun bouton vert dans la liste : le vert reste au panneau (BoutonGesteDossier en forme « ligne »).
    assert.equal((dossiers + ligneDossier).match(/(?<![\w-])bg-action(?![\w/-])/g), null);
  });

  test("le panneau exécute le geste demandé par la ligne (facture, encaissement, date, relance, avis), une fois les relances lues", () => {
    assert.match(panneau, /demande\?: DemandeOuverture \| DemandeOuvertureV2 \| null/);
    assert.match(panneau, /gesteDemande === "FACTURE" \? \{ type: "FACTURE", cle: 1 \}/);
    assert.match(panneau, /demande\?\.rubrique === "encaisser" \|\| gesteDemande === "ENCAISSER"/);
    assert.match(panneau, /useState\(\(\) => gesteDemande === "DATE_CHANTIER"\)/);
    assert.match(panneau, /lancerRelance\(gesteDemande\)/);
    assert.match(panneau, /case "RELANCER":\s*case "AVIS":\s*return lancerRelance\(geste\.genre\);/);
    // La v1 (PanneauxRaccourcis d'Aujourd'hui, DossiersPilotage) passe toujours une DemandeOuverture : rien ne change pour elle.
    assert.match(lire("lib/v2/dossiers.ts"), /export type DemandeOuvertureV2 = \{ rubrique: RubriqueDossier; etape\?: EtapeDossier \| null; devis\?: "nouveau" \| "pdf" \| "gmail" \| null; piece\?: string \| null; cle: number; geste\?: GesteDemande \| null \};/);
  });
});

describe("Personnes v2 : la recherche d'abord, puis les segments, puis la liste", () => {
  test("trois blocs dans l'ordre ; les résultats de GET /api/recherche remplacent la liste ; replaceState sur le segment", () => {
    ordre(personnes, ["{/* 1. La recherche */}", "{/* 2. Les segments, et les deux gestes secondaires */}", "{/* 3. La liste du segment */}", "<PanneauEntrant", "<ModeAppels"]);
    assert.equal((personnes.match(/\{\/\* \d\. /g) ?? []).length, 3);
    assert.match(personnes, /\/api\/recherche\?q=\$\{encodeURIComponent\(texte\)\}/);
    assert.match(personnes, /options=\{SEGMENTS_PERSONNES\}/);
    assert.match(personnes, /adresseDuSegment\(segment, q\)/);
    assert.match(personnes, /window\.history\.replaceState\(/);
    assert.match(personnes, /\/api\/leads\?\$\{new URLSearchParams\(\{ vue, page: String\(p\) \}\)\}/);
    assert.match(personnes, /\/api\/clients\?\$\{new URLSearchParams\(\{ page: String\(p\) \}\)\}/);
    assert.match(personnes, /decouperLignes\(lignes, tout, LIGNES_VISIBLES\)/);
    assert.match(personnes, /decouperLignes\(clientsPage\?\.clients \?\? \[\], tout, LIGNES_VISIBLES\)/);
    assert.match(lire("lib/v2/personnes.ts"), /export const LIGNES_VISIBLES = 5;/);
  });

  test("les lignes : lead = nom · ville · état en phrase · Appeler ; client = nom · ville · dossiers → /clients/<id> ; la v1 réutilisée", () => {
    assert.match(lignesPersonnes, /etatLead\(lead, maintenant\)/);
    assert.match(lignesPersonnes, /phraseDossiersClient\(client\.nbDossiers, client\.nbDossiersEnCours\)/);
    assert.match(lignesPersonnes, /href=\{`\/clients\/\$\{client\.id\}`\}/);
    assert.match(lignesPersonnes, /noterDebutAppel\(lead\.id, \{ nom: lead\.nom, dossierId: lead\.dossierId \}\)/);
    assert.match(lignesPersonnes, /phraseResultat\(candidat\)/);
    // Correctifs du 07/10 (É8, É10) : « Appeler » vert sur la première ligne seulement ; un dossier trouvé se lit au format de situation.
    assert.match(lignesPersonnes, /className=\{principal \? APPELER : APPELER_CONTOUR\}/);
    assert.match(personnes, /principal=\{index === 0\}/);
    assert.match(lignesPersonnes, /situationDeCandidat\(candidat, maintenant\)/);
    assert.match(lire("lib/assistant/recherche.ts"), /prochaineActionDate\?: string \| null;/);
    assert.match(personnes, /decouperLignes\(resultats \?\? \[\], toutResultats, LIGNES_VISIBLES\)/);
    for (const composant of ["<ModeAppels", "<PanneauEntrant", "<NouveauContact", "<CreationClient", "<NotificationsAppareil"]) assert.ok(personnes.includes(composant), composant);
    assert.match(personnes, /fileDAppels\(segment, lignes\)/);
    assert.match(personnes, /Enchaîner les appels/);
    for (const motif of ["EVENEMENT_LEADS_MODIFIES", "EVENEMENT_APPEL_TERMINE", "rafraichirCompteurs", "vientDuCache", "ecouterLeCache"]) assert.ok(personnes.includes(motif), motif);
    // Le bouton « Appeler » de chaque ligne est le seul vert ; « Enchaîner » et « Ajouter » sont en contour.
    assert.equal((personnes.match(/(?<![\w-])bg-action(?![\w/-])/g) ?? []).length, 0);
    assert.equal((lignesPersonnes.match(/(?<![\w-])bg-action(?![\w/-])/g) ?? []).length, 1);
  });

  test("la loupe de la coque mène à Personnes (/leads?q=)", () => {
    assert.match(recherche, /routeur\.push\(`\/leads\?q=\$\{encodeURIComponent\(texte\)\}`\)/);
    assert.match(recherche, /Tout chercher dans Personnes/);
  });
});

describe("Argent v2 : trois nombres en haut, puis six blocs au plus", () => {
  test("les blocs dans l'ordre : trois nombres, encours, chèques, dépenses, livre, à corriger ; les modales de la v1", () => {
    ordre(argent, ["{/* 1. Les trois nombres */}", "{/* 2. L'encours : une facture par ligne, Encaisser en principal, Relancer en contour */}", "{/* 3. Les chèques à créditer */}", "{/* 4. Les dépenses (l'écran de la v1, replié) */}", "{/* 5. Le livre des recettes */}", "{/* 6. À corriger, replié */}", "<ModalePaiementFacture", "<ModaleActionEncaissement"]);
    assert.equal((argent.match(/\{\/\* \d\. /g) ?? []).length, 6);
    assert.match(argent, /troisNombres\(\{ encours, encaisseMois: mois\.encaisse, depenseMois: mois\.depense \}\)/);
    // Une seule taille grande (24 px), le rouge seulement sur le reste à encaisser en retard.
    assert.equal((argent.match(/text-grand/g) ?? []).length, 1);
    assert.match(argent, /nombre\.retard \? "text-retard-texte" : "text-texte"/);
    assert.match(argent, /decouperLignes\(encours\.lignes, toutEncours, ENCOURS_VISIBLES\)/);
    assert.match(argent, /decouperLignes\(cheques, toutCheques, ENCOURS_VISIBLES\)/);
    assert.match(argent, /decouperLignes\(livre, toutLivre, ENCOURS_VISIBLES\)/);
    assert.match(lire("lib/v2/argent.ts"), /export const ENCOURS_VISIBLES = 5;/);
    assert.match(argent, /<ListeDepenses initiale=\{depenses\.liste\} chantiers=\{depenses\.chantiers\} \/>/);
    assert.match(argent, /href="\/depenses\/nouvelle"/);
    assert.match(argent, /href=\{`\/api\/finances\/livre\?annee=\$\{annee\}`\}/);
    assert.match(argent, /useState\(section === SECTION_DEPENSES\)/);
    assert.match(argent, /const \[qualiteOuverte, setQualiteOuverte\] = useState\(false\);/);
  });

  test("Encaisser = le bouton principal de chaque facture (ModalePaiementFacture) ; Relancer = SMS prêt à copier, sinon le mail du dossier ; une ligne après le geste", () => {
    assert.equal((argent.match(/(?<![\w-])bg-action(?![\w/-])/g) ?? []).length, 1, "un seul dessin de bouton vert : Encaisser");
    // Correctifs du 07/10 (É8) : le vert à la première ligne seulement (la facture la plus en retard), contour ensuite.
    assert.match(argent, /className=\{index === 0 \? BOUTON_ENCAISSER : BOUTON_ENCAISSER_LIGNE\}>\s*<Euro size=\{18\} aria-hidden \/> Encaisser/);
    assert.match(argent, /const BOUTON_ENCAISSER_LIGNE = cn\(BOUTON_SECONDAIRE, "gap-2"\);/);
    assert.match(argent, /className=\{cn\(BOUTON_SECONDAIRE, "text-texte-3"\)\}>\s*Rejeté/);
    assert.match(argent, /onClick=\{\(\) => relancer\(ligne\)\} className=\{BOUTON_SECONDAIRE\}>\s*Relancer/);
    assert.match(argent, /proposition: propositionRelanceFacture\(ligne\)/);
    assert.match(argent, /toast\.success\(`Facture \$\{ligne\.numero\} relancée par SMS`/);
    assert.match(argent, /routeur\.push\(`\/mail\?dossier=\$\{encodeURIComponent\(ligne\.dossierId \?\? ""\)\}`\)/);
    // Copier vaut relance : l'écran SMS trace par POST /api/sms/copie, qui accepte le code LIBRE.
    assert.match(lire("components/pilotage/sms/EcranSms.tsx"), /envoyerJson\("\/api\/sms\/copie", "POST"/);
    assert.match(lire("lib/sms/copie.ts"), /export const CODE_LIBRE = "LIBRE";/);
    assert.match(lire("lib/v2/argent.ts"), /export const CODE_SMS_LIBRE = "LIBRE";/);
    // Le numéro arrive avec la ligne (ajout au serveur, la v1 ne le lit pas).
    assert.match(lire("lib/finances/tableau.ts"), /telephone: document\?\.dossier\?\.clientTelephone\?\.trim\(\) \|\| null/);
  });
});

describe("lisible dehors, rien ne bouge tout seul, les pages et la v1", () => {
  test("zones de 44 px, échelle de texte de la v2, jetons seulement, aucun badge, aucune capitale espacée, aucun mouvement hors TRANS_V2", () => {
    for (const source of V2) {
      assert.ok(/h-11|min-h-11|BOUTON_SECONDAIRE|SEGMENT\(/.test(source), "zones de 44 px");
      assert.ok(!/text-\[\d+(\.\d+)?px\]/.test(source), "pas de taille en pixels");
      assert.ok(!/#[0-9a-fA-F]{6}/.test(source), "pas d'hexadécimal");
      assert.ok(!/tracking-wide|uppercase/.test(source), "pas de capitales espacées");
      assert.ok(!/rounded-full bg-action px/.test(source), "aucun badge");
      assert.ok(!/transition-(all|transform|opacity)|duration-(?!150)\d+/.test(source), "aucun mouvement hors TRANS_V2");
      assert.ok(!/animate-(?!spin|none)/.test(source), "aucune animation décorative");
      assert.ok(!/toLocale(Date|Time)?String/.test(source), "dates par lib/v2/dates seulement");
      // Deux tailles de texte par ligne ou carte : corps (16 / 17) et petit (14), le grand réservé aux trois nombres.
      const tailles = [...new Set(source.match(/text-(corps-tel|corps|petit|titre|grand)\b/g))].sort();
      assert.ok(tailles.every((t) => ["text-corps", "text-corps-tel", "text-petit", "text-titre", "text-grand"].includes(t)), tailles.join(" "));
    }
    assert.deepEqual([...new Set(ligneDossier.match(/text-(corps-tel|corps|petit|titre|grand)\b/g))].sort(), ["text-corps", "text-corps-tel", "text-petit"]);
    assert.deepEqual([...new Set(lignesPersonnes.match(/text-(corps-tel|corps|petit|titre|grand)\b/g))].sort(), ["text-corps", "text-corps-tel", "text-petit"]);
    // Aucun compteur dans les segments.
    assert.ok(!/compteurs\./.test(segments) && !/tabular-nums/.test(segments));
  });

  test("les pages choisissent par interfaceCourante() ; la v1 est servie telle quelle et n'importe rien de la v2", () => {
    assert.match(pageDossiers, /const version = await interfaceCourante\(\);/);
    assert.match(pageDossiers, /version === "v2" && !espace \? \{ vue: "A_FAIRE", recherche: q \|\| undefined \} : \{\}/);
    assert.match(pageDossiers, /if \(version === "v2"\) \{\s*return \(\s*<DossiersV2/);
    assert.match(pageDossiers, /<DossiersPilotage\s+initial=\{dossiers\}/);
    assert.match(pageLeads, /if \(v === "v2"\) \{[\s\S]*segmentDeLaListe\(parametres\.liste, "A_APPELER"\)[\s\S]*<PersonnesV2 segmentInitial=\{segment\}/);
    assert.match(pageLeads, /return <EcranLeads initial=\{initial\} vueInitiale=\{vue\}/);
    assert.match(pageClients, /<PersonnesV2 segmentInitial="CLIENTS" leads=\{null\} clients=\{await pageClients\(\{ page: 1 \}\)\}/);
    assert.match(pageClients, /return <ListeClients initial=\{await pageClients\(\{ page: 1 \}\)\} \/>;/);
    assert.match(pageFinances, /Promise\.all\(\[encaissementsDeLaPeriode\(plage\), depensesDeLaPeriode\(plage\)\]\)/);
    assert.match(pageFinances, /<ArgentV2 key=\{annee\} initial=\{tableau\}/);
    assert.match(pageFinances, /<TableauFinances\s+key=\{annee\}/);
    for (const page of [pageDossiers, pageLeads, pageClients, pageFinances]) assert.match(page, /export const dynamic = "force-dynamic";/);
    for (const source of V1) {
      assert.ok(!source.includes("components/v2/dossiers") && !source.includes("components/v2/personnes") && !source.includes("components/v2/argent") && !source.includes("lib/v2"), "la v1 n'importe rien des écrans v2");
    }
  });
});
