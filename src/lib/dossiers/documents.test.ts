import assert from "node:assert/strict";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { preparerBaseEssai } from "@/test/base-essai";

preparerBaseEssai();
process.env.UPLOADS_DIR = mkdtempSync(path.join(tmpdir(), "coverswap-uploads-"));
// Rien ne part chez Meta pendant les essais (le client Prisma charge .env sans écraser).
process.env.META_PIXEL_ID = "";
process.env.META_ACCESS_TOKEN = "";

let prisma: typeof import("@/lib/prisma").default;
let numerotation: typeof import("./numerotation");
let registre: typeof import("./registre");
let documents: typeof import("./documents");
let parametres: typeof import("@/lib/parametres/service");
let migrationRegistre: typeof import("@/lib/base/migrations/registre-numeros").migrationRegistreNumeros;

const jour = (iso: string) => new Date(`${iso}T10:00:00Z`);
/** Refus opposé par la base, avec son message (et non un motif lu dans l'extrait de code d'une erreur Prisma). */
const refus = (motif: RegExp) => (erreur: unknown) =>
  erreur instanceof Error && ["EcritureRefusee", "SuppressionInterdite"].includes(erreur.name) && motif.test(erreur.message);
const LIGNES = [
  { type: "PRESTATION" as const, designation: "Revêtement adhésif — façades", sousDesignation: undefined, quantite: 4, unite: "ml" as const, prixUnitaire: 110 },
];

async function dossierEssai(etape: string, clientId: string | null = null) {
  const dossier = await prisma.dossier.create({
    data: {
      clientNom: "Alice Durand",
      clientAdresse: "12 rue des Essais",
      clientCp: "34000",
      clientVille: "Montpellier",
      clientTelephone: "06 00 00 00 01",
      objet: "Recouvrement cuisine",
      source: "ENTRANT",
      etape,
      clientId,
    },
  });
  return dossier.id;
}

const generation = (type: "DEVIS" | "FACTURE", remplaceDocumentId?: string) => ({
  type,
  objet: "Recouvrement cuisine",
  lignes: LIGNES,
  noteMl: true,
  acomptePct: type === "DEVIS" ? 30 : null,
  remplaceDocumentId: remplaceDocumentId ?? null,
});

before(async () => {
  prisma = (await import("@/lib/prisma")).default;
  numerotation = await import("./numerotation");
  registre = await import("./registre");
  documents = await import("./documents");
  parametres = await import("@/lib/parametres/service");
  migrationRegistre = (await import("@/lib/base/migrations/registre-numeros")).migrationRegistreNumeros;
  await (await import("@/lib/base/preparation")).preparerBase();
});

after(async () => {
  await prisma.$disconnect();
});

describe("registre des numéros", () => {
  test("la numérotation manuelle 2026 est inscrite : 030 et 032 factures, 031 et 033 à 037 devis", async () => {
    const manuels = await prisma.numeroDocument.findMany({ where: { famille: "", annee: 2026 }, orderBy: { rang: "asc" } });
    assert.equal(manuels.length, 37);
    assert.ok(manuels.every((ligne) => ligne.origine === "MANUEL"));
    const nature = (rang: number) => manuels.find((ligne) => ligne.rang === rang)?.type;
    assert.equal(nature(30), "FACTURE");
    assert.equal(nature(32), "FACTURE");
    for (const rang of [31, 33, 34, 35, 36, 37]) assert.equal(nature(rang), "DEVIS");
    assert.equal(nature(1), "INCONNU");
  });

  test("un numéro inscrit n'est jamais réattribué ; une transaction annulée ne consomme rien", async () => {
    const attribuer = (type: "DEVIS" | "FACTURE" | "AVOIR", date: string) =>
      prisma.$transaction((tx) => numerotation.attribuerNumero(tx, type, jour(date)));

    assert.equal((await attribuer("DEVIS", "2026-01-15")).numero, "2026-038");
    await registre.declarerNumero({ numero: "2026-039", type: "DEVIS", emisLe: "2026-01-16", destinataire: "Devis papier" });
    assert.equal(await numerotation.prochainNumero("DEVIS", jour("2026-01-17")), "2026-040");
    assert.equal((await attribuer("DEVIS", "2026-01-17")).numero, "2026-040");

    await assert.rejects(
      prisma.$transaction(async (tx) => {
        await numerotation.attribuerNumero(tx, "DEVIS", jour("2026-01-18"));
        throw new Error("génération interrompue");
      }),
      /génération interrompue/
    );
    assert.equal(await prisma.numeroDocument.count({ where: { cle: ":2026:41" } }), 0);
    assert.equal((await attribuer("DEVIS", "2026-01-18")).numero, "2026-041");

    await assert.rejects(() => registre.declarerNumero({ numero: "2026-040", type: "DEVIS" }), /déjà inscrit/);
  });

  test("les factures continuent après l'ancien écran, en série F chronologique", async () => {
    await registre.declarerNumero({ numero: "FACT-2026-0005", type: "FACTURE", emisLe: "2026-01-10" });
    const attribuer = (type: "FACTURE" | "AVOIR", date: string) =>
      prisma.$transaction((tx) => numerotation.attribuerNumero(tx, type, jour(date)));

    assert.equal((await attribuer("FACTURE", "2026-02-01")).numero, "F2026-006");
    // Un avoir prend sa place dans la même série.
    assert.equal((await attribuer("AVOIR", "2026-02-02")).numero, "F2026-007");

    await assert.rejects(() => attribuer("FACTURE", "2026-01-20"), /chronologique/);
    await assert.rejects(() => registre.declarerNumero({ numero: "F2026-004", type: "FACTURE" }), /tenue par le CRM/);
    await assert.rejects(() => registre.declarerNumero({ numero: "FACT-2026-0009", type: "FACTURE" }), /close/);
    await registre.declarerNumero({ numero: "F2026-008", type: "FACTURE", note: "Facture faite à la main" });
    assert.equal((await attribuer("FACTURE", "2026-02-03")).numero, "F2026-009");

    const series = await registre.lireRegistre();
    const f = series.find((serie) => serie.famille === "F" && serie.annee === 2026);
    assert.deepEqual(f?.trous, [1, 2, 3, 4, 5]);
  });

  test("le registre ne se réécrit pas", async () => {
    const ligne = await prisma.numeroDocument.findFirstOrThrow({ where: { cle: "F:2026:6" } });
    await assert.rejects(() => prisma.numeroDocument.update({ where: { id: ligne.id }, data: { numero: "F2026-099" } }), refus(/ne change pas/));
    await assert.rejects(() => prisma.numeroDocument.update({ where: { id: ligne.id }, data: { rang: 99 } }), refus(/ne change pas/));
    await assert.rejects(() => prisma.numeroDocument.delete({ where: { id: ligne.id } }), refus(/Suppression interdite/));
    await assert.rejects(() => registre.completerNumero(ligne.id, { montant: 12 }), /émis par le CRM/);
    await registre.completerNumero(ligne.id, { note: "Essai de note" });
    const manuel = await prisma.numeroDocument.findFirstOrThrow({ where: { cle: ":2026:30" } });
    await registre.completerNumero(manuel.id, { destinataire: "Client de 2026", montant: 1850 });
    assert.equal((await prisma.numeroDocument.findUniqueOrThrow({ where: { id: manuel.id } })).montant, 1850);
  });
});

describe("émission des documents", () => {
  let dossierId: string;
  let factureId: string;

  test("facture à un particulier : mention figée, numéro lié au registre, dossier « Facturé »", async () => {
    dossierId = await dossierEssai("CHANTIER");
    const { document } = await documents.genererDocument(dossierId, generation("FACTURE"));
    factureId = document.id;

    assert.match(document.numero ?? "", /^F\d{4}-\d{3}$/);
    assert.deepEqual(documents.lireMentions(document.mentions), ["Paiement à réception de facture"]);
    assert.equal(document.categorieClient, "PARTICULIER");
    assert.equal(document.echeanceLe, null);
    assert.equal(documents.lireDestinataire(document.destinataire)?.nom, "Alice Durand");
    assert.ok(existsSync(path.join(process.env.UPLOADS_DIR!, document.pdfPath!)));

    const inscrit = await prisma.numeroDocument.findUniqueOrThrow({ where: { documentId: document.id } });
    assert.equal(inscrit.numero, document.numero);
    assert.equal(inscrit.origine, "CRM");
    assert.equal(inscrit.montant, 440);
    assert.equal((await prisma.dossier.findUniqueOrThrow({ where: { id: dossierId } })).etape, "FACTURE");
  });

  test("un document émis ne se modifie plus, ne s'archive pas, ne se supprime pas", async () => {
    await assert.rejects(() => prisma.document.update({ where: { id: factureId }, data: { totalHt: 1 } }), refus(/Document émis/));
    await assert.rejects(() => prisma.document.update({ where: { id: factureId }, data: { destinataire: "{}" } }), refus(/Document émis/));
    await assert.rejects(
      () => prisma.document.update({ where: { id: factureId }, data: { archiveLe: new Date(), archiveMotif: "essai" } }),
      refus(/Document émis/)
    );
    await assert.rejects(() => prisma.document.delete({ where: { id: factureId } }), refus(/Suppression interdite/));
    await prisma.document.update({ where: { id: factureId }, data: { statut: "ENVOYE" } });
  });

  test("avoir : la facture est annulée, le dossier revient à « Chantier », une nouvelle facture suit", async () => {
    await assert.rejects(() => documents.genererAvoir(dossierId, factureId, { motif: "AUTRE" }), /Précise le motif/);
    const { document: avoir } = await documents.genererAvoir(dossierId, factureId, { motif: "ERREUR_MONTANT", precision: "4 ml au lieu de 3" });
    const facture = await prisma.document.findUniqueOrThrow({ where: { id: factureId } });

    assert.equal(avoir.type, "AVOIR");
    assert.equal(avoir.documentOrigineId, factureId);
    assert.equal(avoir.totalHt, facture.totalHt);
    assert.equal(numerotation.lireNumero(avoir.numero!)?.famille, "F");
    assert.ok(numerotation.lireNumero(avoir.numero!)!.rang > numerotation.lireNumero(facture.numero!)!.rang);
    const mentions = documents.lireMentions(avoir.mentions) ?? [];
    assert.match(mentions[0], new RegExp(`^Avoir sur la facture n° ${facture.numero} du `));
    assert.equal(mentions[1], "Motif : Erreur de montant ou de quantité (4 ml au lieu de 3)");
    assert.equal(facture.statut, "ANNULEE");
    assert.equal((await prisma.dossier.findUniqueOrThrow({ where: { id: dossierId } })).etape, "CHANTIER");

    await assert.rejects(() => documents.genererAvoir(dossierId, factureId, { motif: "ERREUR_MONTANT" }), /déjà annulée/);
    const { document: nouvelle } = await documents.genererDocument(dossierId, generation("FACTURE"));
    assert.ok(numerotation.lireNumero(nouvelle.numero!)!.rang > numerotation.lireNumero(avoir.numero!)!.rang);
    assert.equal((await prisma.dossier.findUniqueOrThrow({ where: { id: dossierId } })).etape, "FACTURE");
  });

  test("devis refait : l'ancien est « Remplacé », jamais réutilisé", async () => {
    const id = await dossierEssai("QUALIFICATION");
    const { document: premier } = await documents.genererDocument(id, generation("DEVIS"));
    assert.equal(numerotation.lireNumero(premier.numero!)?.famille, "");
    assert.equal((await prisma.dossier.findUniqueOrThrow({ where: { id } })).etape, "DEVIS_ENVOYE");

    const { document: second } = await documents.genererDocument(id, generation("DEVIS", premier.id));
    assert.equal(second.documentOrigineId, premier.id);
    assert.notEqual(second.numero, premier.numero);
    assert.equal((await prisma.document.findUniqueOrThrow({ where: { id: premier.id } })).statut, "REMPLACE");

    await assert.rejects(() => documents.genererDocument(id, generation("DEVIS", premier.id)), /déjà été remplacé/);
    await assert.rejects(() => documents.genererDocument(id, generation("FACTURE", second.id)), /avoir/);
  });

  test("facture à un professionnel : sans paramètres, aucune facture et aucun numéro consommé", async () => {
    const client = await prisma.client.create({
      data: { nom: "Hôtel des Essais", categorie: "PROFESSIONNEL", raisonSociale: "Hôtel des Essais", siret: "00000000000000", source: "PROSPECTION", premierContactLe: new Date() },
    });
    const id = await dossierEssai("CHANTIER", client.id);
    const avant = await numerotation.prochainNumero("FACTURE");
    const inscrits = await prisma.numeroDocument.count();

    await assert.rejects(
      () => documents.genererDocument(id, generation("FACTURE")),
      (erreur: unknown) => {
        assert.ok(erreur instanceof parametres.ParametresManquants);
        assert.equal(erreur.status, 428);
        assert.deepEqual(erreur.details?.parametresManquants, [
          "DELAI_PAIEMENT_PROFESSIONNELS",
          "TAUX_PENALITES_RETARD",
          "INDEMNITE_RECOUVREMENT",
          "ESCOMPTE_PAIEMENT_ANTICIPE",
        ]);
        return true;
      }
    );
    assert.equal(await numerotation.prochainNumero("FACTURE"), avant);
    assert.equal(await prisma.numeroDocument.count(), inscrits);

    const valableDu = new Date("2026-01-01T00:00:00Z");
    await parametres.enregistrerParametre({ cle: "DELAI_PAIEMENT_PROFESSIONNELS", valeur: 30, valableDu });
    await parametres.enregistrerParametre({ cle: "TAUX_PENALITES_RETARD", valeur: 12, valableDu });
    await parametres.enregistrerParametre({ cle: "INDEMNITE_RECOUVREMENT", valeur: 40, valableDu });
    await parametres.enregistrerParametre({ cle: "ESCOMPTE_PAIEMENT_ANTICIPE", valeur: "Néant", valableDu });

    const { document } = await documents.genererDocument(id, generation("FACTURE"));
    assert.equal(document.numero, avant);
    assert.equal(document.categorieClient, "PROFESSIONNEL");
    assert.equal(document.clientId, client.id);
    assert.equal(documents.lireDestinataire(document.destinataire)?.siret, "00000000000000");
    assert.equal(document.echeanceLe?.getTime(), document.dateEmission!.getTime() + 30 * 24 * 60 * 60_000);
    const mentions = documents.lireMentions(document.mentions) ?? [];
    assert.equal(mentions.length, 4);
    assert.match(mentions[0], /^Date d'échéance : /);
    assert.match(mentions[1], /pénalités au taux annuel de 12/);
    assert.match(mentions[2], /Indemnité forfaitaire pour frais de recouvrement en cas de retard de paiement : 40/);
    assert.equal(mentions[3], "Escompte pour paiement anticipé : Néant");
  });

  test("la migration du registre se rejoue sans rien dupliquer ni écraser", async () => {
    const avant = await prisma.numeroDocument.findMany({ orderBy: { cle: "asc" } });
    const resume = await migrationRegistre.executer(prisma);
    assert.ok(Object.keys(resume).every((cle) => cle.endsWith(":deja")), JSON.stringify(resume));
    const apres = await prisma.numeroDocument.findMany({ orderBy: { cle: "asc" } });
    assert.deepEqual(apres, avant);
  });
});
