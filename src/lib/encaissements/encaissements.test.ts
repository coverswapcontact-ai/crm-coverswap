import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { preparerBaseEssai } from "@/test/base-essai";

preparerBaseEssai();
process.env.UPLOADS_DIR = mkdtempSync(path.join(tmpdir(), "coverswap-uploads-"));
process.env.META_PIXEL_ID = "";
process.env.META_ACCESS_TOKEN = "";

let prisma: typeof import("@/lib/prisma").default;
let documents: typeof import("@/lib/dossiers/documents");
let transitions: typeof import("@/lib/dossiers/transitions");
let service: typeof import("./service");
let soldes: typeof import("./soldes");
let reprise: typeof import("./reprise");
let aujourdhui: string;

const refus = (motif: RegExp) => (erreur: unknown) => erreur instanceof Error && motif.test(erreur.message);
const refusBase = (motif: RegExp) => (erreur: unknown) => erreur instanceof Error && erreur.name === "EcritureRefusee" && motif.test(erreur.message);

const LIGNES = [
  { type: "PRESTATION" as const, designation: "Revêtement adhésif — façades", sousDesignation: undefined, quantite: 4, unite: "ml" as const, prixUnitaire: 110 },
];
const generation = (type: "DEVIS" | "FACTURE") => ({ type, objet: "Recouvrement cuisine", lignes: LIGNES, noteMl: true, acomptePct: type === "DEVIS" ? 30 : null });
const paiement = (montant: number, moyen: "CHEQUE" | "VIREMENT" | "ESPECES", reference?: string) => ({ montant, moyen, recuLe: aujourdhui, reference: reference ?? null });

async function dossierEssai(etape = "QUALIFICATION") {
  const dossier = await prisma.dossier.create({
    data: {
      clientNom: "Bruno Marchal",
      clientAdresse: "3 rue des Essais",
      clientCp: "34000",
      clientVille: "Montpellier",
      clientTelephone: "06 00 00 00 02",
      objet: "Recouvrement cuisine",
      source: "ENTRANT",
      etape,
    },
  });
  return dossier.id;
}

const etape = async (id: string) => (await prisma.dossier.findUniqueOrThrow({ where: { id } })).etape;

before(async () => {
  prisma = (await import("@/lib/prisma")).default;
  documents = await import("@/lib/dossiers/documents");
  transitions = await import("@/lib/dossiers/transitions");
  service = await import("./service");
  soldes = await import("./soldes");
  reprise = await import("./reprise");
  aujourdhui = (await import("@/lib/dossiers/dates")).jourParis(new Date());
  await (await import("@/lib/base/preparation")).preparerBase();
});

after(async () => {
  await prisma.$disconnect();
});

describe("du devis signé au dossier encaissé", () => {
  let dossierId: string;
  let chequeAcompteId: string;
  let premiereFactureId: string;

  test("signer exige l'acompte reçu ou le motif de son absence ; l'acompte s'impute sur le devis", async () => {
    dossierId = await dossierEssai();
    const { document: devis } = await documents.genererDocument(dossierId, generation("DEVIS"));

    await assert.rejects(
      () => service.changerEtapeAvecPaiement(dossierId, { vers: "SIGNE", confirmations: { BON_POUR_ACCORD: true } }),
      refus(/il manque : acompte enregistré/)
    );
    await service.changerEtapeAvecPaiement(dossierId, {
      vers: "SIGNE",
      confirmations: { BON_POUR_ACCORD: true },
      acompte: paiement(132, "CHEQUE", "1234567"),
    });

    assert.equal(await etape(dossierId), "SIGNE");
    const [acompte] = await prisma.encaissement.findMany({ where: { dossierId }, include: { affectations: { include: { numeroDocument: true } } } });
    chequeAcompteId = acompte.id;
    assert.equal(acompte.montant, 132);
    assert.equal(acompte.payeur, "Bruno Marchal");
    assert.equal(acompte.affectations.length, 1);
    assert.equal(acompte.affectations[0].numeroDocument.documentId, devis.id);
    assert.equal((await prisma.document.findUniqueOrThrow({ where: { id: devis.id } })).statut, "ACCEPTE");
    const evenement = await prisma.dossierEvenement.findFirstOrThrow({ where: { dossierId, type: "ENCAISSEMENT_ENREGISTRE" } });
    assert.match(evenement.contenu, /132,00 € par chèque n° 1234567.*acompte sur le devis/);
  });

  test("la facture reprend l'acompte : imputé, imprimé, reste à payer", async () => {
    await transitions.changerEtape(dossierId, { vers: "PLANIFIE", dateChantier: aujourdhui });
    await transitions.changerEtape(dossierId, { vers: "CHANTIER" });
    const { document: facture } = await documents.genererDocument(dossierId, generation("FACTURE"));
    premiereFactureId = facture.id;

    const mentions = documents.lireMentions(facture.mentions) ?? [];
    assert.equal(mentions[0], "Paiement à réception de facture");
    assert.match(mentions[1], /^Acompte reçu le \d{2}\/\d{2}\/\d{4} \(chèque\) : 132,00 €$/);
    assert.equal(mentions[2], "Reste à payer : 308,00 €");

    const affectations = await prisma.affectationEncaissement.findMany({ where: { encaissementId: chequeAcompteId }, orderBy: { createdAt: "asc" } });
    assert.deepEqual(affectations.map((affectation) => affectation.statut), ["TRANSFEREE", "ACTIVE"]);
    const { resteCentimes, soldeEncaisse } = await soldes.faitsPaiements(prisma, dossierId);
    assert.equal(resteCentimes, 30800);
    assert.equal(soldeEncaisse, false);
    assert.equal(await etape(dossierId), "FACTURE");
  });

  test("un paiement ne dépasse pas ce qui reste ; le solde reçu fait passer à « Encaissé »", async () => {
    const facture = await prisma.numeroDocument.findUniqueOrThrow({ where: { documentId: premiereFactureId } });
    await assert.rejects(
      () => service.enregistrerEncaissement({ dossierId, numeroDocumentId: facture.id, paiement: paiement(400, "VIREMENT") }),
      refus(/dépasse ce qui reste/)
    );
    await service.enregistrerEncaissement({ dossierId, paiement: paiement(308, "VIREMENT") });
    assert.equal(await etape(dossierId), "ENCAISSE");
    const passage = await prisma.dossierEvenement.findFirstOrThrow({ where: { dossierId, type: "CHANGEMENT_ETAPE" }, orderBy: { createdAt: "desc" } });
    assert.match(passage.contenu, /Facturé → Encaissé : factures réglées/);
  });

  test("chèque rejeté : il ne compte plus, le dossier revient à « Facturé »", async () => {
    await assert.rejects(() => service.rejeterEncaissement(chequeAcompteId, { le: "2020-01-01", motif: "SANS_PROVISION" }), refus(/précède la réception/));
    await service.rejeterEncaissement(chequeAcompteId, { le: aujourdhui, motif: "SANS_PROVISION" });

    const cheque = await prisma.encaissement.findUniqueOrThrow({ where: { id: chequeAcompteId }, include: { affectations: true } });
    assert.equal(cheque.statut, "REJETE");
    assert.equal(cheque.motifFin, "Sans provision");
    assert.ok(cheque.affectations.every((affectation) => affectation.statut !== "ACTIVE"));
    assert.equal(await etape(dossierId), "FACTURE");
    assert.equal((await soldes.faitsPaiements(prisma, dossierId)).resteCentimes, 13200);
    await assert.rejects(() => service.rejeterEncaissement(chequeAcompteId, { le: aujourdhui, motif: "AUTRE", precision: "x" }), refus(/déjà rejeté/));
  });

  test("la base refuse de rouvrir, de modifier ou de supprimer un encaissement", async () => {
    // En SQL brut, le message du déclencheur qui refuse est transmis tel quel.
    const sql = (requete: string, ...valeurs: unknown[]) => () => prisma.$executeRawUnsafe(requete, ...valeurs);
    await assert.rejects(sql(`UPDATE "Encaissement" SET "statut" = 'VALIDE' WHERE "id" = ?`, chequeAcompteId), refusBase(/^Un encaissement annulé ou rejeté le reste/));
    await assert.rejects(sql(`UPDATE "Encaissement" SET "montant" = 1 WHERE "id" = ?`, chequeAcompteId), refusBase(/^Un encaissement ne se modifie pas/));
    const [affectation] = await prisma.affectationEncaissement.findMany({ where: { encaissementId: chequeAcompteId, statut: "LIBEREE" } });
    await assert.rejects(sql(`UPDATE "AffectationEncaissement" SET "statut" = 'ACTIVE' WHERE "id" = ?`, affectation.id), refusBase(/^Une affectation qui a cessé de compter ne revient pas/));
    const valide = await prisma.encaissement.findFirstOrThrow({ where: { dossierId, statut: "VALIDE" } });
    await assert.rejects(sql(`UPDATE "Encaissement" SET "statut" = 'ANNULE' WHERE "id" = ?`, valide.id), refusBase(/^Un rejet ou une annulation d'encaissement se date et se motive/));
    // Par la couche Prisma : refusé aussi, avec les règles du modèle.
    await assert.rejects(() => prisma.encaissement.update({ where: { id: chequeAcompteId }, data: { montant: 1 } }), refusBase(/ne se modifie pas/));
    await assert.rejects(() => prisma.encaissement.delete({ where: { id: chequeAcompteId } }), (erreur: unknown) => erreur instanceof Error && erreur.name === "SuppressionInterdite");
  });

  test("erreur de saisie : annulée avec son motif, sans effet sur ce qui reste dû", async () => {
    const { encaissement } = await service.enregistrerEncaissement({ dossierId, paiement: paiement(50, "ESPECES") });
    assert.equal((await soldes.faitsPaiements(prisma, dossierId)).resteCentimes, 8200);
    await service.annulerEncaissement(encaissement.id, { motif: "ERREUR_MONTANT" });
    const annule = await prisma.encaissement.findUniqueOrThrow({ where: { id: encaissement.id } });
    assert.equal(annule.statut, "ANNULE");
    assert.equal(annule.motifFin, "Montant erroné");
    assert.equal((await soldes.faitsPaiements(prisma, dossierId)).resteCentimes, 13200);
    await assert.rejects(() => service.rejeterEncaissement(encaissement.id, { le: aujourdhui, motif: "OPPOSITION" }), refus(/déjà annulé/));
  });

  test("avoir : ce qui réglait la facture passe sur la facture corrigée", async () => {
    await documents.genererAvoir(dossierId, premiereFactureId, { motif: "ERREUR_MONTANT" });
    assert.equal(await etape(dossierId), "CHANTIER");
    const liberee = await prisma.affectationEncaissement.findFirstOrThrow({ where: { statut: "LIBEREE", motifFin: { startsWith: "Facture annulée par l'avoir" } } });
    assert.equal(liberee.montant, 308);

    const { document: corrigee } = await documents.genererDocument(dossierId, generation("FACTURE"));
    const mentions = documents.lireMentions(corrigee.mentions) ?? [];
    assert.match(mentions[1], /^Règlement reçu le .* \(virement\) : 308,00 €$/);
    assert.equal(mentions[2], "Reste à payer : 132,00 €");
    assert.equal(await etape(dossierId), "FACTURE");
  });

  test("« Encaissé » avec le paiement du solde : tout ou rien", async () => {
    const avant = await prisma.encaissement.count({ where: { dossierId } });
    await assert.rejects(
      () => service.changerEtapeAvecPaiement(dossierId, { vers: "ENCAISSE", solde: paiement(100, "VIREMENT") }),
      refus(/ne solde pas les factures : il reste 32,00 €/)
    );
    assert.equal(await prisma.encaissement.count({ where: { dossierId } }), avant);
    assert.equal(await etape(dossierId), "FACTURE");

    await service.changerEtapeAvecPaiement(dossierId, { vers: "ENCAISSE", solde: paiement(132, "CHEQUE", "7654321") });
    assert.equal(await etape(dossierId), "ENCAISSE");
    const cheque = await prisma.encaissement.findFirstOrThrow({ where: { dossierId, reference: "7654321" } });
    await assert.rejects(() => service.crediterCheque(cheque.id, { crediteLe: "2020-01-01" }), refus(/précède la réception/));
    await service.crediterCheque(cheque.id, { crediteLe: aujourdhui });
    await assert.rejects(() => service.crediterCheque(cheque.id, { crediteLe: aujourdhui }), refus(/déjà crédité/));
  });

  test("signature sans acompte : le motif est tracé", async () => {
    const id = await dossierEssai();
    await documents.genererDocument(id, generation("DEVIS"));
    await service.changerEtapeAvecPaiement(id, {
      vers: "SIGNE",
      confirmations: { BON_POUR_ACCORD: true },
      sansAcompte: { motif: "SOUS_TRAITANCE" },
    });
    const passage = await prisma.dossierEvenement.findFirstOrThrow({ where: { dossierId: id, type: "CHANGEMENT_ETAPE" }, orderBy: { createdAt: "desc" } });
    assert.match(passage.contenu, /Signé \(sans acompte : sous-traitance\)/);
    assert.equal(JSON.parse(passage.metadata).sansAcompte, "Sous-traitance");
  });
});

describe("reprise de l'ancien écran", () => {
  test("les paiements datés deviennent des encaissements, une seule fois ; sans date, rien n'est inventé", async () => {
    const lead = await prisma.lead.create({ data: { prenom: "Chantal", nom: "Vidal", telephone: "0600000003", ville: "Sète" } });
    const devis = await prisma.devis.create({
      data: {
        numero: "2026-0101",
        expiresAt: new Date("2026-12-31"),
        reference: "K1",
        mlTotal: 5,
        prixMatiere: 100,
        prixVente: 1000,
        margeNette: 500,
        acompte30: 300,
        solde70: 700,
        leadId: lead.id,
      },
    });
    await prisma.facture.create({
      data: { numero: "FACT-2026-0101", montantTotal: 1000, acompteRecu: true, acompteDate: new Date("2026-06-02T09:00:00Z"), soldeRecu: true, soldeDate: null, devisId: devis.id },
    });

    assert.deepEqual(await reprise.reprendrePaiementsAncienEcran(), { crees: 1, dejaRepris: 0, sansDate: 1, illisibles: 0 });
    assert.deepEqual(await reprise.reprendrePaiementsAncienEcran(), { crees: 0, dejaRepris: 1, sansDate: 1, illisibles: 0 });

    const repris = await prisma.encaissement.findFirstOrThrow({ where: { origine: "REPRISE_ANCIEN_ECRAN" } });
    assert.equal(repris.montant, 300);
    assert.equal(repris.moyen, null);
    assert.equal(repris.payeur, "Chantal Vidal");
    const affectations = await prisma.affectationEncaissement.findMany({ where: { encaissementId: repris.id }, include: { numeroDocument: true } });
    assert.equal(affectations[0].numeroDocument.numero, "FACT-2026-0101");
    assert.equal(affectations[0].numeroDocument.origine, "ANCIEN_CRM");
    // Le moyen, inconnu à la reprise, se complète une fois.
    await prisma.encaissement.update({ where: { id: repris.id }, data: { moyen: "VIREMENT" } });
    await assert.rejects(() => prisma.encaissement.update({ where: { id: repris.id }, data: { moyen: "CHEQUE" } }), refusBase(/ne se modifie pas/));
  });
});
