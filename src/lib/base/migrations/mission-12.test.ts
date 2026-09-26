import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { preparerBaseEssai } from "@/test/base-essai";

preparerBaseEssai();

/**
 * Mission 12 (26/09/2026), phase 1 : les trois migrations jouées au démarrage
 * sont idempotentes et font exactement ce que Lucas a demandé — numérotation
 * (registre + compteur à 2026-043), valeurs (réserve, capacité, campagne,
 * consignes), ménage (archives sans motif, tâches en échec abandonnées).
 */

let prisma: typeof import("@/lib/prisma").default;
let migrations: typeof import("./mission-12-26-09");
let numerotation: typeof import("@/lib/dossiers/numerotation");
let compteurs: typeof import("@/lib/dossiers/compteurs");
let registre: typeof import("@/lib/dossiers/registre");
let parametres: typeof import("@/lib/parametres/service");
let consignes: typeof import("@/lib/assistant/consignes");
let avecActeur: typeof import("@/lib/journal/contexte").avecActeur;
const LUCAS = { acteur: "HUMAIN:lucas@coverswap.fr" };
const JOUR_MS = 24 * 60 * 60_000;

before(async () => {
  prisma = (await import("@/lib/prisma")).default;
  migrations = await import("./mission-12-26-09");
  numerotation = await import("@/lib/dossiers/numerotation");
  compteurs = await import("@/lib/dossiers/compteurs");
  registre = await import("@/lib/dossiers/registre");
  parametres = await import("@/lib/parametres/service");
  consignes = await import("@/lib/assistant/consignes");
  avecActeur = (await import("@/lib/journal/contexte")).avecActeur;
  // preparerBase joue déjà les migrations sur la base vide ; chaque essai les rejoue sur des données posées après.
  await (await import("@/lib/base/preparation")).preparerBase();
});
after(async () => {
  await prisma.$disconnect();
});

describe("numérotation : devis externes au registre, compteur à 2026-043, compteur lisible et modifiable", () => {
  test("la migration inscrit 040, 041, 042 une seule fois et le prochain devis est 2026-043 ; rejouée, rien ne bouge", async () => {
    const premiere = await avecActeur(LUCAS, () => migrations.migrationNumerotation2609.executer(prisma));
    // Sur la base d'essai (vide au départ), la première passe au démarrage a déjà inscrit les trois numéros.
    assert.equal(premiere.inscrits + premiere.dejaInscrits, 3);
    assert.equal(premiere.prochainRang, 43);
    for (const numero of ["2026-040", "2026-041", "2026-042"]) {
      const ligne = await prisma.numeroDocument.findFirst({ where: { numero } });
      assert.ok(ligne, `${numero} au registre`);
      assert.deepEqual([ligne.type, ligne.origine], ["DEVIS", "MANUEL"]);
    }
    assert.equal(await numerotation.prochainNumero("DEVIS", new Date("2026-09-26T12:00:00.000Z")), "2026-043");
    const seconde = await avecActeur(LUCAS, () => migrations.migrationNumerotation2609.executer(prisma));
    assert.deepEqual([seconde.inscrits, seconde.dejaInscrits, seconde.prochainRang], [0, 3, 43]);
    assert.equal(await prisma.numeroDocument.count({ where: { numero: "2026-041" } }), 1);
  });

  test("lireCompteurs / poserCompteur : lisible, modifiable, jamais derrière un numéro inscrit ; un devis externe plus grand fait avancer le compteur", async () => {
    const date = new Date("2026-09-26T12:00:00.000Z");
    const avant = (await compteurs.lireCompteurs(date)).find((c) => c.serie === "DEVIS")!;
    assert.deepEqual([avant.prochain, avant.plusHautRegistre >= 42], ["2026-043", true]);
    await assert.rejects(compteurs.poserCompteur({ serie: "DEVIS", prochain: "2026-040" }), /doit dépasser le dernier inscrit/);
    await assert.rejects(compteurs.poserCompteur({ serie: "DEVIS", prochain: "F2026-050" }), /n'est pas un numéro de la série/);
    const pose = await avecActeur(LUCAS, () => compteurs.poserCompteur({ serie: "DEVIS", prochain: "2026-050" }));
    assert.equal(pose.prochain, "2026-050");
    assert.equal(await numerotation.prochainNumero("DEVIS", date), "2026-050");

    // Un devis fait ailleurs, déclaré avec 2026-060 : le compteur suit ; 2026-055 (plus petit) ne le fait pas reculer.
    await avecActeur(LUCAS, () => registre.declarerNumero(registre.schemaDeclaration.parse({ type: "DEVIS", numero: "2026-060", emisLe: "2026-09-26", montant: 100 })));
    assert.equal(await numerotation.prochainNumero("DEVIS", date), "2026-061");
    await avecActeur(LUCAS, () => registre.declarerNumero(registre.schemaDeclaration.parse({ type: "DEVIS", numero: "2026-055", emisLe: "2026-09-26", montant: 100 })));
    assert.equal(await numerotation.prochainNumero("DEVIS", date), "2026-061");
    // La série des factures n'a pas bougé.
    const factures = (await compteurs.lireCompteurs(date)).find((c) => c.serie === "FACTURE")!;
    assert.equal(factures.valeur, null);
  });
});

describe("valeurs données par Lucas", () => {
  test("réserve 3 000 €, 15 chantiers par mois, campagne du 22/09 (378 € sur 21 jours) ; consignes alignées ; rejouée, rien ne double", async () => {
    const reference = new Date("2026-09-26T12:00:00.000Z");
    assert.deepEqual(
      [await parametres.lireParametre("TRESORERIE_RESERVE", reference), await parametres.lireParametre("CAPACITE_CHANTIERS_MOIS", reference), await parametres.lireParametre("CAMPAGNE_DEBUT", reference), await parametres.lireParametre("CAMPAGNE_BUDGET", reference), await parametres.lireParametre("CAMPAGNE_DUREE_JOURS", reference)],
      [3000, "15", "2026-09-22", 378, 21]
    );
    const texte = (await consignes.lireConsignes()).texte;
    assert.match(texte, /Capacité : 15 chantiers par mois/);
    assert.match(texte, /garder 3 000 € de trésorerie/);
    assert.doesNotMatch(texte, /environ 8 chantiers|garder 2 000 €/);
    const lignes = await prisma.parametre.count({ where: { cle: "TRESORERIE_RESERVE" } });
    const bis = await avecActeur(LUCAS, () => migrations.migrationValeursLucas2609.executer(prisma));
    assert.deepEqual([bis.poses, bis.dejaPoses, bis.consignesModifiees], [0, 5, 0]);
    assert.equal(await prisma.parametre.count({ where: { cle: "TRESORERIE_RESERVE" } }), lignes);
  });

  test("une valeur posée après par Lucas n'est pas écrasée par une reprise de la migration", async () => {
    await avecActeur(LUCAS, () => parametres.enregistrerParametre({ cle: "TRESORERIE_RESERVE", valeur: 3500, valableDu: new Date("2026-09-25T00:00:00.000Z"), source: "Lucas, plus tard" }));
    const bis = await avecActeur(LUCAS, () => migrations.migrationValeursLucas2609.executer(prisma));
    assert.equal(bis.poses, 1, "la valeur diffère : une ligne datée du 01/09 est ajoutée, qui ne masque pas celle du 25/09");
    assert.equal(await parametres.lireParametre("TRESORERIE_RESERVE", new Date("2026-09-26T12:00:00.000Z")), 3500);
  });
});

describe("ménage : archives sans motif, tâches abandonnées", () => {
  test("« motif à renseigner » sur les archives muettes ; une tâche en échec depuis 10 jours est abandonnée avec la raison, une de 2 jours reste", async () => {
    const dossier = await prisma.dossier.create({ data: { clientNom: "Archive Muette", clientAdresse: "1 rue", clientCp: "34000", clientVille: "Montpellier", clientTelephone: "0600000001", objet: "Essai", source: "ENTRANT", etape: "QUALIFICATION", archiveLe: new Date(), archiveMotif: null } });
    const dossierMotive = await prisma.dossier.create({ data: { clientNom: "Archive Motivée", clientAdresse: "1 rue", clientCp: "34000", clientVille: "Montpellier", clientTelephone: "0600000002", objet: "Essai", source: "ENTRANT", etape: "QUALIFICATION", archiveLe: new Date(), archiveMotif: "Doublon" } });
    const lead = await prisma.lead.create({ data: { prenom: "Lead", nom: "Muet", telephone: "0600000003", ville: "Lattes", source: "AUTRE", archiveLe: new Date(), archiveMotif: "" } });
    const vieille = await prisma.tache.create({ data: { type: "META_CONVERSION", cle: "essai-vieille", statut: "ECHEC_DEFINITIF", tentatives: 8, tentativesMax: 8, derniereErreur: "Conversion refusée (HTTP 400) : jeton invalide", demandeePar: "SYSTEME:essai", updatedAt: new Date(Date.now() - 10 * JOUR_MS) } });
    const recente = await prisma.tache.create({ data: { type: "META_CONVERSION", cle: "essai-recente", statut: "ECHEC_DEFINITIF", tentatives: 8, tentativesMax: 8, derniereErreur: "Conversion refusée", demandeePar: "SYSTEME:essai", updatedAt: new Date(Date.now() - 2 * JOUR_MS) } });

    const bilan = await avecActeur(LUCAS, () => migrations.migrationMenage2609.executer(prisma));
    assert.ok(bilan.dossiersSansMotif >= 1 && bilan.leadsSansMotif >= 1 && bilan.tachesAbandonnees >= 1, JSON.stringify(bilan));
    assert.equal((await prisma.dossier.findUnique({ where: { id: dossier.id } }))?.archiveMotif, migrations.MOTIF_A_RENSEIGNER);
    assert.equal((await prisma.dossier.findUnique({ where: { id: dossierMotive.id } }))?.archiveMotif, "Doublon");
    assert.equal((await prisma.lead.findUnique({ where: { id: lead.id } }))?.archiveMotif, migrations.MOTIF_A_RENSEIGNER);
    const abandonnee = await prisma.tache.findUniqueOrThrow({ where: { id: vieille.id } });
    assert.equal(abandonnee.statut, "ANNULEE");
    assert.match(abandonnee.derniereErreur ?? "", /^Abandonnée le .*8 tentative\(s\) sur 8.*Dernière erreur : Conversion refusée \(HTTP 400\) : jeton invalide/);
    assert.equal((await prisma.tache.findUniqueOrThrow({ where: { id: recente.id } })).statut, "ECHEC_DEFINITIF", "trop récente : elle reste visible en échec");
    const bis = await avecActeur(LUCAS, () => migrations.migrationMenage2609.executer(prisma));
    assert.deepEqual([bis.dossiersSansMotif, bis.leadsSansMotif, bis.tachesAbandonnees], [0, 0, 0]);
  });
});
