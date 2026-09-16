import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { preparerBaseEssai } from "@/test/base-essai";

preparerBaseEssai();

type Modules = {
  prisma: typeof import("@/lib/prisma").default;
  avecActeur: typeof import("@/lib/journal/contexte").avecActeur;
  preparation: typeof import("@/lib/base/preparation");
  declencheurs: typeof import("@/lib/journal/declencheurs");
};
let m: Modules;

type LigneJournal = {
  modele: string;
  enregistrementId: string;
  operation: string;
  acteur: string;
  jeton: string | null;
  origine: string | null;
  requete: string | null;
  avant: string | null;
  apres: string;
};

async function journalDe(modele: string, id: string): Promise<LigneJournal[]> {
  return m.prisma.$queryRawUnsafe<LigneJournal[]>(
    `SELECT * FROM "JournalModification" WHERE "modele" = ? AND "enregistrementId" = ? ORDER BY "horodatage", rowid`,
    modele,
    id
  );
}

const HUMAIN = { acteur: "HUMAIN:essai@coverswap.fr", origine: "POST /api/essai", requete: "req-1" };

function lead(nom = "Durand") {
  return { nom, prenom: "Alice", telephone: "0600000000", ville: "Pérols" };
}

before(async () => {
  m = {
    prisma: (await import("@/lib/prisma")).default,
    avecActeur: (await import("@/lib/journal/contexte")).avecActeur,
    preparation: await import("@/lib/base/preparation"),
    declencheurs: await import("@/lib/journal/declencheurs"),
  };
});

after(async () => {
  await m.prisma.$disconnect();
});

describe("installation", () => {
  test("une ligne existante avant le journal reçoit son état initial, une seule fois", async () => {
    // Ligne écrite sans déclencheurs, comme les données d'avant le journal.
    await m.prisma.$executeRawUnsafe(
      `INSERT INTO "Lead" ("id", "createdAt", "updatedAt", "nom", "prenom", "telephone", "ville") VALUES ('ancien', 0, 0, 'Martin', 'Paul', '0611111111', 'Lattes')`
    );
    await m.preparation.preparerBase();
    await m.preparation.preparerBase(); // rejouable

    const lignes = (await journalDe("Lead", "ancien")).filter((ligne) => ligne.operation === "ETAT_INITIAL");
    assert.equal(lignes.length, 1);
    assert.equal(lignes[0].acteur, "MIGRATION:2026-09-16-journal-etat-initial");
    assert.equal(JSON.parse(lignes[0].apres).nom, "Martin");

    const migrations = await m.prisma.migrationDonnees.findMany();
    assert.ok(migrations.some((migration) => migration.nom === "2026-09-16-journal-etat-initial"));
    assert.equal(new Set(migrations.map((migration) => migration.nom)).size, migrations.length, "chaque migration une seule fois");
  });

  test("les déclencheurs sont réinstallables sans doublon", async () => {
    const nombre = await m.preparation.installerDeclencheurs();
    const presents = await m.prisma.$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT count(*) AS n FROM sqlite_master WHERE type = 'trigger'`
    );
    assert.equal(Number(presents[0].n), nombre);
  });
});

describe("attribution des écritures", () => {
  test("création : auteur, origine, requête et enregistrement complet", async () => {
    const cree = await m.avecActeur(HUMAIN, () => m.prisma.lead.create({ data: lead() }));
    const [ligne, ...reste] = await journalDe("Lead", cree.id);
    assert.equal(reste.length, 0);
    assert.equal(ligne.operation, "CREATION");
    assert.equal(ligne.acteur, HUMAIN.acteur);
    assert.equal(ligne.origine, HUMAIN.origine);
    assert.equal(ligne.requete, HUMAIN.requete);
    assert.ok(ligne.jeton);
    assert.equal(ligne.avant, null);
    const apres = JSON.parse(ligne.apres);
    assert.equal(apres.nom, "Durand");
    assert.equal(apres.id, cree.id);
  });

  test("modification : avant et après ; une écriture sans changement ne laisse pas de ligne", async () => {
    const cree = await m.avecActeur(HUMAIN, () => m.prisma.lead.create({ data: lead() }));
    await m.avecActeur({ acteur: "AGENT:mail" }, () =>
      m.prisma.lead.update({ where: { id: cree.id }, data: { statut: "CONTACTE" } })
    );
    await m.avecActeur(HUMAIN, () => m.prisma.lead.update({ where: { id: cree.id }, data: { statut: "CONTACTE" } }));

    const lignes = await journalDe("Lead", cree.id);
    assert.equal(lignes.length, 2);
    assert.equal(lignes[1].operation, "MODIFICATION");
    assert.equal(lignes[1].acteur, "AGENT:mail");
    assert.equal(JSON.parse(lignes[1].avant!).statut, "NOUVEAU");
    assert.equal(JSON.parse(lignes[1].apres).statut, "CONTACTE");
  });

  test("archivage et restauration sont nommés comme tels", async () => {
    const cree = await m.avecActeur(HUMAIN, () => m.prisma.lead.create({ data: lead() }));
    await m.avecActeur(HUMAIN, () =>
      m.prisma.lead.update({ where: { id: cree.id }, data: { archiveLe: new Date(), archiveMotif: "Doublon" } })
    );
    await m.avecActeur(HUMAIN, () =>
      m.prisma.lead.update({ where: { id: cree.id }, data: { archiveLe: null, archiveMotif: null } })
    );
    const operations = (await journalDe("Lead", cree.id)).map((ligne) => ligne.operation);
    assert.deepEqual(operations, ["CREATION", "ARCHIVAGE", "RESTAURATION"]);
  });

  test("écritures imbriquées : chaque enregistrement est attribué, avec le même jeton", async () => {
    const dossier = await m.avecActeur(HUMAIN, () =>
      m.prisma.dossier.create({
        data: {
          clientNom: "Durand",
          clientAdresse: "1 rue des Essais",
          clientCp: "34470",
          clientVille: "Pérols",
          clientTelephone: "0600000000",
          objet: "Recouvrement cuisine",
          source: "ENTRANT",
          notes: { create: [{ etape: "QUALIFICATION", contenu: "Premier appel" }] },
          evenements: { create: { type: "NOTE_AJOUTEE", direction: "INTERNE", contenu: "Ouverture" } },
        },
        include: { notes: true, evenements: true },
      })
    );
    const [ligneDossier] = await journalDe("Dossier", dossier.id);
    const [ligneNote] = await journalDe("DossierNote", dossier.notes[0].id);
    const [ligneEvenement] = await journalDe("DossierEvenement", dossier.evenements[0].id);
    for (const ligne of [ligneDossier, ligneNote, ligneEvenement]) assert.equal(ligne.acteur, HUMAIN.acteur);
    assert.equal(ligneNote.jeton, ligneDossier.jeton);
    assert.equal(ligneEvenement.jeton, ligneDossier.jeton);

    await m.avecActeur({ acteur: "HUMAIN:autre@coverswap.fr" }, () =>
      m.prisma.dossier.update({
        where: { id: dossier.id },
        data: { notes: { update: { where: { id: dossier.notes[0].id }, data: { contenu: "Rappel" } } } },
      })
    );
    const lignesNote = await journalDe("DossierNote", dossier.notes[0].id);
    assert.equal(lignesNote.at(-1)?.acteur, "HUMAIN:autre@coverswap.fr");
  });

  test("createMany et upsert sont attribués", async () => {
    await m.avecActeur({ acteur: "SCRIPT:import" }, () =>
      m.prisma.lead.createMany({ data: [lead("Un"), lead("Deux")] })
    );
    const leads = await m.prisma.lead.findMany({ where: { nom: { in: ["Un", "Deux"] } } });
    for (const cree of leads) assert.equal((await journalDe("Lead", cree.id))[0].acteur, "SCRIPT:import");

    const preset = await m.avecActeur({ acteur: "SYSTEME:essai" }, () =>
      m.prisma.presetTarif.upsert({
        where: { id: "preset-essai" },
        create: { id: "preset-essai", designation: "Pose", unite: "ml", prixUnitaire: 40 },
        update: { prixUnitaire: 45 },
      })
    );
    await m.avecActeur(HUMAIN, () =>
      m.prisma.presetTarif.upsert({
        where: { id: preset.id },
        create: { id: preset.id, designation: "Pose", unite: "ml", prixUnitaire: 40 },
        update: { prixUnitaire: 45 },
      })
    );
    const lignes = await journalDe("PresetTarif", preset.id);
    assert.deepEqual(
      lignes.map((ligne) => [ligne.operation, ligne.acteur]),
      [
        ["CREATION", "SYSTEME:essai"],
        ["MODIFICATION", HUMAIN.acteur],
      ]
    );
  });

  test("hors de Next et sans contexte : le script est nommé", async () => {
    const cree = await m.prisma.lead.create({ data: lead("Script") });
    const [ligne] = await journalDe("Lead", cree.id);
    assert.match(ligne.acteur, /^SCRIPT:/);
  });

  test("SQL brut hors couche : journalisé quand même, avec un acteur inconnu", async () => {
    const cree = await m.avecActeur(HUMAIN, () => m.prisma.lead.create({ data: lead() }));
    await m.prisma.$executeRawUnsafe(`UPDATE "Lead" SET "ville" = 'Mauguio' WHERE "id" = ?`, cree.id);
    const derniere = (await journalDe("Lead", cree.id)).at(-1)!;
    assert.equal(derniere.acteur, "INCONNU:hors-couche");
    assert.equal(JSON.parse(derniere.apres).ville, "Mauguio");
  });

  test("clé primaire composée : identifiant lisible", async () => {
    const { attribuerNumero } = await import("@/lib/dossiers/numerotation");
    await m.avecActeur(HUMAIN, () =>
      m.prisma.$transaction((tx) => attribuerNumero(tx, "FACTURE", new Date("2031-03-01T10:00:00Z")))
    );
    const [ligne] = await journalDe("CompteurNumerotation", "FACTURE:2031");
    assert.equal(ligne.operation, "CREATION");
    assert.equal(ligne.acteur, HUMAIN.acteur);
  });

  test("transaction annulée : aucune ligne de journal ne subsiste", async () => {
    await assert.rejects(
      m.avecActeur(HUMAIN, () =>
        m.prisma.$transaction(async (tx) => {
          await tx.lead.create({ data: lead("Annule") });
          throw new Error("échec volontaire");
        })
      )
    );
    const lignes = await m.prisma.$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT count(*) AS n FROM "JournalModification" WHERE "apres" LIKE '%"Annule"%'`
    );
    assert.equal(Number(lignes[0].n), 0);
  });
});

describe("rien ne se supprime", () => {
  test("delete et deleteMany sont refusés par la couche", async () => {
    const cree = await m.avecActeur(HUMAIN, () => m.prisma.lead.create({ data: lead() }));
    await assert.rejects(() => m.prisma.lead.delete({ where: { id: cree.id } }), /Suppression interdite/);
    await assert.rejects(() => m.prisma.lead.deleteMany({}), /Suppression interdite/);
    assert.ok(await m.prisma.lead.findUnique({ where: { id: cree.id } }));
  });

  test("une suppression imbriquée est refusée", async () => {
    const dossier = await m.avecActeur(HUMAIN, () =>
      m.prisma.dossier.create({
        data: {
          clientNom: "Imbrique",
          clientAdresse: "1 rue",
          clientCp: "34000",
          clientVille: "Montpellier",
          clientTelephone: "0600000000",
          objet: "Essai",
          source: "AUTRE",
          notes: { create: { etape: "QUALIFICATION", contenu: "À garder" } },
        },
        include: { notes: true },
      })
    );
    await assert.rejects(
      () =>
        m.prisma.dossier.update({
          where: { id: dossier.id },
          data: { notes: { delete: { id: dossier.notes[0].id } } },
        }),
      /Suppression interdite/
    );
  });

  test("la base refuse aussi un DELETE en SQL brut", async () => {
    const cree = await m.avecActeur(HUMAIN, () => m.prisma.lead.create({ data: lead() }));
    await assert.rejects(
      () => m.prisma.$executeRawUnsafe(`DELETE FROM "Lead" WHERE "id" = ?`, cree.id),
      (erreur: unknown) => erreur instanceof Error && erreur.name === "EcritureRefusee" && /Suppression interdite/.test(erreur.message)
    );
    assert.ok(await m.prisma.lead.findUnique({ where: { id: cree.id } }));
  });
});

describe("archives masquées en lecture", () => {
  test("listes et comptes ignorent l'archivé ; findUnique et AVEC_ARCHIVES le voient", async () => {
    const { AVEC_ARCHIVES } = await import("@/lib/journal/extension");
    const ville = "Archiville";
    const [visible, archive] = await m.avecActeur(HUMAIN, () =>
      Promise.all([
        m.prisma.lead.create({ data: { ...lead("Visible"), ville } }),
        m.prisma.lead.create({ data: { ...lead("Archive"), ville, archiveLe: new Date(), archiveMotif: "Spam" } }),
      ])
    );
    assert.deepEqual(
      (await m.prisma.lead.findMany({ where: { ville } })).map((ligne) => ligne.id),
      [visible.id]
    );
    assert.equal(await m.prisma.lead.count({ where: { ville } }), 1);
    assert.equal((await m.prisma.lead.findFirst({ where: { ville, nom: "Archive" } })), null);
    const groupes = await m.prisma.lead.groupBy({ by: ["ville"], where: { ville }, _count: { id: true } });
    assert.equal(groupes[0]._count.id, 1);

    assert.ok(await m.prisma.lead.findUnique({ where: { id: archive.id } }));
    assert.equal(await m.prisma.lead.count({ where: { ...AVEC_ARCHIVES, ville } }), 2);
    assert.equal(await m.prisma.lead.count({ where: { ville, archiveLe: { not: null } } }), 1);
    assert.equal(await m.prisma.lead.count({ where: { OR: [{ ville }], AND: [{ archiveLe: { not: null } }] } }), 1);
  });
});

describe("le journal est immuable", () => {
  test("ni modification ni suppression ; un caviardage, une seule fois", async () => {
    const cree = await m.avecActeur(HUMAIN, () => m.prisma.lead.create({ data: lead("Caviarde") }));
    const [{ id }] = await m.prisma.$queryRawUnsafe<{ id: string }[]>(
      `SELECT "id" FROM "JournalModification" WHERE "enregistrementId" = ?`,
      cree.id
    );
    await assert.rejects(
      () => m.prisma.$executeRawUnsafe(`UPDATE "JournalModification" SET "acteur" = 'HUMAIN:faussaire' WHERE "id" = ?`, id),
      (erreur: unknown) => erreur instanceof Error && erreur.name === "EcritureRefusee" && /immuable/.test(erreur.message)
    );
    await assert.rejects(
      () => m.prisma.$executeRawUnsafe(`DELETE FROM "JournalModification" WHERE "id" = ?`, id),
      /Suppression interdite/
    );
    await m.prisma.$executeRawUnsafe(
      `UPDATE "JournalModification" SET "apres" = '{"caviarde":true}', "caviardeLe" = 1 WHERE "id" = ?`,
      id
    );
    await assert.rejects(
      () => m.prisma.$executeRawUnsafe(`UPDATE "JournalModification" SET "apres" = '{}', "caviardeLe" = 2 WHERE "id" = ?`, id),
      (erreur: unknown) => erreur instanceof Error && erreur.name === "EcritureRefusee" && /immuable/.test(erreur.message)
    );
  });
});

describe("tables larges", () => {
  test("au-delà de 50 colonnes, l'enregistrement complet reste un JSON valide", async () => {
    const colonnes = Array.from({ length: 64 }, (_, index) => ({ name: `c${index}`, kind: "scalar" }));
    const modele = {
      name: "TableLarge",
      fields: [{ name: "id", kind: "scalar", isId: true }, ...colonnes, { name: "ecriture", kind: "scalar" }],
    };
    await m.prisma.$executeRawUnsafe(
      `CREATE TABLE "TableLarge" ("id" TEXT PRIMARY KEY, ${colonnes.map((colonne) => `"${colonne.name}" TEXT`).join(", ")}, "ecriture" TEXT)`
    );
    for (const declencheur of m.declencheurs.declencheursDuModele(modele)) {
      await m.prisma.$executeRawUnsafe(declencheur.sql);
    }
    await m.prisma.$executeRawUnsafe(
      `INSERT INTO "TableLarge" ("id", "c0", "c63", "ecriture") VALUES ('large', 'premier', 'dernier', '{"acteur":"SCRIPT:essai"}')`
    );
    const [ligne] = await journalDe("TableLarge", "large");
    const apres = JSON.parse(ligne.apres);
    assert.equal(Object.keys(apres).length, 66);
    assert.equal(apres.c0, "premier");
    assert.equal(apres.c63, "dernier");
    assert.equal(apres.c30, null);
    assert.equal(ligne.acteur, "SCRIPT:essai");
  });
});

describe("schéma", () => {
  test("une colonne manquante empêche le démarrage, avec un message clair", async () => {
    // SQLite refuse de retirer une colonne qu'un déclencheur désigne : on les retire d'abord.
    for (const declencheur of ["journal_PresetTarif_creation", "journal_PresetTarif_modification"]) {
      await m.prisma.$executeRawUnsafe(`DROP TRIGGER "${declencheur}"`);
    }
    await m.prisma.$executeRawUnsafe(`ALTER TABLE "PresetTarif" DROP COLUMN "archiveMotif"`);
    await assert.rejects(() => m.preparation.verifierSchema(), /colonne PresetTarif\.archiveMotif/);
  });
});
