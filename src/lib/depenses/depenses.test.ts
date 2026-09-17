import assert from "node:assert/strict";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { preparerBaseEssai } from "@/test/base-essai";

preparerBaseEssai();
process.env.UPLOADS_DIR = mkdtempSync(path.join(tmpdir(), "coverswap-uploads-"));

let prisma: typeof import("@/lib/prisma").default;
let service: typeof import("./service");
let constantes: typeof import("./constantes");
let aujourdhui: string;

const ticket = (contenu: string, nom = "ticket.jpg") => new File([Buffer.from(contenu)], nom, { type: "image/jpeg" });

async function dossier(etape: string, clientNom: string) {
  return prisma.dossier.create({
    data: { clientNom, clientAdresse: "1 rue", clientCp: "34000", clientVille: "Montpellier", clientTelephone: "0600000009", objet: "Cuisine", source: "ENTRANT", etape },
  });
}

before(async () => {
  prisma = (await import("@/lib/prisma")).default;
  service = await import("./service");
  constantes = await import("./constantes");
  aujourdhui = (await import("@/lib/dossiers/dates")).jourParis(new Date());
  await (await import("@/lib/base/preparation")).preparerBase();
});

after(async () => {
  await prisma.$disconnect();
});

describe("dépenses", () => {
  test("une saisie envoyée deux fois (coupure réseau) n'est enregistrée qu'une fois", async () => {
    const chantier = await dossier("CHANTIER", "Alice Durand");
    const entree = {
      identifiantHorsLigne: "saisie-telephone-0001",
      payeeLe: aujourdhui,
      montant: 54.2,
      fournisseur: "Leroy Merlin",
      categorie: "MATIERE" as const,
      dossierId: chantier.id,
    };
    const premiere = await service.creerDepense(entree, ticket("ticket-a"));
    const seconde = await service.creerDepense(entree, ticket("ticket-a"));
    assert.equal(premiere.dejaRecue, false);
    assert.equal(seconde.dejaRecue, true);
    assert.equal(seconde.depense.id, premiere.depense.id);
    assert.equal(await prisma.depense.count(), 1);
    assert.equal(await prisma.fichier.count(), 1);

    const fichier = await prisma.fichier.findFirstOrThrow();
    assert.ok(existsSync(path.join(process.env.UPLOADS_DIR!, fichier.chemin)));
    assert.match(fichier.chemin, /^justificatifs\/\d{4}\/\d{2}\//);
    assert.equal(fichier.empreinte.length, 64);
  });

  test("un même ticket pour une autre dépense : doublon signalé, enregistrable en le forçant", async () => {
    const base = { payeeLe: aujourdhui, montant: 54.2, fournisseur: "Leroy Merlin", categorie: "MATIERE" as const, horsChantier: true };
    await assert.rejects(
      () => service.creerDepense(base, ticket("ticket-a")),
      (erreur: unknown) => erreur instanceof Error && /déjà attaché à la dépense/.test(erreur.message) && (erreur as { status?: number }).status === 409
    );
    const { depense } = await service.creerDepense({ ...base, forcer: true }, ticket("ticket-a"));
    assert.equal(depense.horsChantier, true);
  });

  test("chantier ou hors chantier, pas les deux", () => {
    const resultat = constantes.schemaCreationDepense.safeParse({
      payeeLe: aujourdhui,
      montant: 10,
      fournisseur: "Station",
      categorie: "DEPLACEMENT",
      dossierId: "abc",
      horsChantier: true,
    });
    assert.equal(resultat.success, false);
    assert.equal(constantes.schemaCreationDepense.safeParse({ payeeLe: "2999-01-01", montant: 10, fournisseur: "x", categorie: "AUTRE" }).success, false);
  });

  test("rattacher, retirer avec motif, remplacer le justificatif : rien ne disparaît", async () => {
    const { depense } = await service.creerDepense({ payeeLe: aujourdhui, montant: 12, fournisseur: "Total", categorie: "DEPLACEMENT" }, ticket("ticket-b"));
    let liste = await service.listerDepenses(Number(aujourdhui.slice(0, 4)));
    assert.equal(liste.aRattacher, 1);

    const chantier = await prisma.dossier.findFirstOrThrow({ where: { clientNom: "Alice Durand" } });
    await service.modifierDepense(depense.id, { dossierId: chantier.id });
    liste = await service.listerDepenses(Number(aujourdhui.slice(0, 4)));
    assert.equal(liste.aRattacher, 0);

    const ancien = await prisma.depense.findUniqueOrThrow({ where: { id: depense.id }, include: { justificatif: true } });
    await service.remplacerJustificatif(depense.id, ticket("ticket-b-net", "ticket-net.jpg"));
    const archive = await prisma.fichier.findUniqueOrThrow({ where: { id: ancien.justificatifId! } });
    assert.ok(archive.archiveLe);
    assert.equal(existsSync(path.join(process.env.UPLOADS_DIR!, archive.chemin)), false);

    await service.archiverDepense(depense.id, "Saisie en double");
    await assert.rejects(() => service.modifierDepense(depense.id, { montant: 13 }), /ne se modifie plus/);
    const duChantier = await service.depensesDuDossier(chantier.id);
    assert.ok(duChantier.depenses.some((ligne) => ligne.id === depense.id && ligne.archiveMotif === "Saisie en double"));
    assert.equal(duChantier.total, 54.2);
    await assert.rejects(() => prisma.depense.delete({ where: { id: depense.id } }), (erreur: unknown) => erreur instanceof Error && erreur.name === "SuppressionInterdite");
  });

  test("à la saisie, le chantier probable n'est pré-choisi que sans ambiguïté", async () => {
    const seul = await service.suggestionsSaisie();
    const alice = await prisma.dossier.findFirstOrThrow({ where: { clientNom: "Alice Durand" } });
    assert.equal(seul.propose, alice.id);
    // Fournisseurs des dépenses récentes (une dépense retirée n'en propose plus).
    assert.deepEqual(seul.fournisseurs, ["Leroy Merlin"]);

    await dossier("CHANTIER", "Bruno Marchal");
    const deux = await service.suggestionsSaisie();
    assert.equal(deux.propose, null);
    assert.equal(deux.chantiers.length, 2);
  });

  test("depuis un dossier, il est proposé et pré-choisi quelle que soit son étape ; les chantiers encaissés depuis peu restent proposés", async () => {
    const encaisse = await dossier("ENCAISSE", "Chantier Payé");
    const enQualification = await dossier("QUALIFICATION", "Visite Prévue");
    const sansDemande = await service.suggestionsSaisie();
    assert.ok(sansDemande.chantiers.some((chantier) => chantier.id === encaisse.id), "encaissé récemment : proposé");
    assert.ok(!sansDemande.chantiers.some((chantier) => chantier.id === enQualification.id), "pas encore signé : pas proposé d'office");

    const depuisLeDossier = await service.suggestionsSaisie(enQualification.id);
    assert.equal(depuisLeDossier.propose, enQualification.id);
    assert.equal(depuisLeDossier.chantiers[0].id, enQualification.id, "en premier");
  });
});
