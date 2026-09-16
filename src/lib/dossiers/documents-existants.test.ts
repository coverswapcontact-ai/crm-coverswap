import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { preparerBaseEssai } from "@/test/base-essai";
import { numerosProposables } from "./numeros-libres";
import type { NumeroLibre } from "./registre";

preparerBaseEssai();
process.env.UPLOADS_DIR = mkdtempSync(path.join(tmpdir(), "coverswap-uploads-"));
process.env.META_PIXEL_ID = "";
process.env.META_ACCESS_TOKEN = "";

let prisma: typeof import("@/lib/prisma").default;
let avecActeur: typeof import("@/lib/journal/contexte").avecActeur;
let dossiers: typeof import("./dossiers");
let documents: typeof import("./documents");
let existants: typeof import("./documents-existants");
let numerotation: typeof import("./numerotation");
let service: typeof import("@/lib/encaissements/service");
let soldes: typeof import("@/lib/encaissements/soldes");
const LUCAS = { acteur: "HUMAIN:lucas@coverswap.fr" };
const refusBase = (motif: RegExp) => (erreur: unknown) => erreur instanceof Error && erreur.name === "EcritureRefusee" && motif.test(erreur.message);
const pdf = (texte = "Devis papier") => new File([Buffer.from(`%PDF-1.4\n% ${texte}\n%%EOF`)], "devis.pdf", { type: "application/pdf" });

before(async () => {
  prisma = (await import("@/lib/prisma")).default;
  avecActeur = (await import("@/lib/journal/contexte")).avecActeur;
  dossiers = await import("./dossiers");
  documents = await import("./documents");
  existants = await import("./documents-existants");
  numerotation = await import("./numerotation");
  service = await import("@/lib/encaissements/service");
  soldes = await import("@/lib/encaissements/soldes");
  await (await import("@/lib/base/preparation")).preparerBase();
});

after(async () => {
  await prisma.$disconnect();
});

describe("numéros proposés à un document repris", () => {
  test("le type connu du registre prime sur la série ; un type inconnu se lit à la série", () => {
    const libre = (numero: string, type: NumeroLibre["type"]): NumeroLibre => ({ id: numero, numero, type, emisLe: null, destinataire: null, montant: null });
    const registre = [
      libre("2026-034", "DEVIS"),
      libre("2026-032", "FACTURE"),
      libre("2026-029", "INCONNU"),
      libre("F2026-004", "INCONNU"),
      libre("F2026-003", "FACTURE"),
      libre("A2026-001", "AVOIR"),
    ];
    const numeros = (type: "DEVIS" | "FACTURE") => numerosProposables(registre, type).map((ligne) => ligne.numero);
    assert.deepEqual(numeros("DEVIS"), ["2026-034", "2026-029"]);
    assert.deepEqual(numeros("FACTURE"), ["2026-032", "2026-029", "F2026-004", "F2026-003"], "une facture d'avant le CRM, sans préfixe, est proposée");
  });
});

describe("documents émis avant le CRM", () => {
  let dossierId: string;
  let devisId: string;
  let factureId: string;

  test("un devis fait à la main se rattache avec son numéro du registre ; rien n'est généré, le compteur ne bouge pas", async () => {
    dossierId = await avecActeur(LUCAS, () => dossiers.creerDossier(dossiers.schemaCreation.parse({ clientNom: "Résidence Les Oliviers", etape: "SIGNE" }), []));
    const prochainAvant = await numerotation.prochainNumero("DEVIS");

    const resultat = await avecActeur(LUCAS, () =>
      existants.enregistrerDocumentExistant(dossierId, existants.schemaDocumentExistant.parse({ type: "DEVIS", numero: "2026-033", dateEmission: "2026-05-10", montant: 2400, statut: "ACCEPTE", acomptePct: 30 }))
    );
    devisId = resultat.documentId;
    assert.deepEqual(resultat.avertissements, []);
    assert.equal(await numerotation.prochainNumero("DEVIS"), prochainAvant, "le compteur ne bouge pas");

    const devis = await prisma.document.findUniqueOrThrow({ where: { id: devisId } });
    assert.equal(devis.origine, "REPRISE");
    assert.equal(devis.numero, "2026-033");
    assert.equal(devis.statut, "ACCEPTE");
    assert.equal(devis.lignes, "[]");
    assert.equal(devis.dateEmission?.toISOString(), "2026-05-10T12:00:00.000Z");
    const ligne = await prisma.numeroDocument.findUniqueOrThrow({ where: { cle: ":2026:33" } });
    assert.equal(ligne.documentId, devisId);
    assert.equal(ligne.montant, 2400);
    const evenement = await prisma.dossierEvenement.findFirstOrThrow({ where: { dossierId, type: "DOCUMENT_REPRIS" } });
    assert.equal(evenement.survenuLe?.toISOString(), "2026-05-10T12:00:00.000Z");
    assert.match(evenement.contenu, /^Devis 2026-033 du 10\/05\/2026 rattaché \(émis avant le CRM\) : 2 400,00 €$/);
    assert.ok(!(await dossiers.chargerDetail(dossierId)).completude.some((point) => point.code === "DEVIS"));

    // Un numéro ne sert qu'une fois ; un numéro absent du registre ne s'y inscrit que sur demande.
    const autre = await avecActeur(LUCAS, () => dossiers.creerDossier(dossiers.schemaCreation.parse({ clientNom: "Autre client" }), []));
    await assert.rejects(
      avecActeur(LUCAS, () => existants.enregistrerDocumentExistant(autre, existants.schemaDocumentExistant.parse({ type: "DEVIS", numero: "2026-033", dateEmission: "2026-05-10", montant: 100 }))),
      /déjà rattaché \(devis du dossier « Résidence Les Oliviers »\)/
    );
    await assert.rejects(
      avecActeur(LUCAS, () => existants.enregistrerDocumentExistant(autre, existants.schemaDocumentExistant.parse({ type: "DEVIS", numero: "2026-099", dateEmission: "2026-05-11", montant: 100 }))),
      (erreur: unknown) => erreur instanceof Error && /n'est pas au registre/.test(erreur.message) && (erreur as { details?: { absentDuRegistre?: boolean } }).details?.absentDuRegistre === true
    );
    assert.equal(await prisma.numeroDocument.count({ where: { cle: ":2026:99" } }), 0, "rien n'est inscrit sans demande");
    const inscrit = await avecActeur(LUCAS, () =>
      existants.enregistrerDocumentExistant(autre, existants.schemaDocumentExistant.parse({ type: "DEVIS", numero: "2026-099", dateEmission: "2026-05-11", montant: 100, inscrireAuRegistre: true }))
    );
    assert.match(inscrit.avertissements[0], /inscrit au registre/);
    assert.equal((await prisma.numeroDocument.findUniqueOrThrow({ where: { cle: ":2026:99" } })).origine, "MANUEL");
  });

  test("une facture reprise reçoit les paiements du dossier ; elle se corrige, pas son numéro ; un document du CRM reste figé", async () => {
    await avecActeur(LUCAS, () => service.enregistrerEncaissement({ dossierId, paiement: { montant: 720, moyen: "VIREMENT", recuLe: "2026-05-12", reference: null } }));
    const resultat = await avecActeur(LUCAS, () =>
      existants.enregistrerDocumentExistant(dossierId, existants.schemaDocumentExistant.parse({ type: "FACTURE", numero: "2026-030", dateEmission: "2026-06-20", montant: 2400 }))
    );
    factureId = resultat.documentId;
    const { resteCentimes } = await soldes.faitsPaiements(prisma, dossierId);
    assert.equal(resteCentimes, 168000, "l'acompte du devis repris règle la facture reprise");

    const avertissements = await avecActeur(LUCAS, () => existants.modifierDocumentExistant(dossierId, factureId, { montant: 2600, objet: "Façades et plan de travail" }));
    assert.deepEqual(avertissements, []);
    const corrigee = await prisma.document.findUniqueOrThrow({ where: { id: factureId } });
    assert.equal(corrigee.totalHt, 2600);
    assert.equal((await prisma.numeroDocument.findUniqueOrThrow({ where: { documentId: factureId } })).montant, 2600);
    assert.equal((await soldes.faitsPaiements(prisma, dossierId)).resteCentimes, 188000);

    await assert.rejects(() => prisma.document.update({ where: { id: factureId }, data: { numero: "2026-031" } }), refusBase(/ne change jamais/));
    await assert.rejects(() => prisma.document.update({ where: { id: factureId }, data: { origine: "CRM" } }), refusBase(/origine d'un document/));

    const { document: genere } = await avecActeur(LUCAS, () =>
      documents.genererDocument(dossierId, {
        type: "DEVIS",
        objet: "Complément",
        lignes: [{ type: "PRESTATION", designation: "Revêtement adhésif", sousDesignation: undefined, quantite: 1, unite: "ml", prixUnitaire: 110 }],
        noteMl: true,
        acomptePct: 30,
        remplaceDocumentId: null,
      })
    );
    await assert.rejects(avecActeur(LUCAS, () => existants.modifierDocumentExistant(dossierId, genere.id, { montant: 1 })), /figé à l'émission/);
    await assert.rejects(() => prisma.document.update({ where: { id: genere.id }, data: { origine: "REPRISE" } }), refusBase(/origine d'un document|Document émis/));
  });

  test("PDF importé, lu tel quel ; sans PDF rien ne se reconstitue ; l'avoir d'une facture reprise porte son montant", async () => {
    await assert.rejects(documents.lirePdfDocument(dossierId, devisId), /PDF non importé/);
    await assert.rejects(
      avecActeur(LUCAS, () => existants.importerPdfDocument(dossierId, devisId, new File([Buffer.from("pas un pdf")], "x.pdf", { type: "application/pdf" }))),
      /n'est pas un PDF/
    );
    await avecActeur(LUCAS, () => existants.importerPdfDocument(dossierId, devisId, pdf()));
    const lu = await documents.lirePdfDocument(dossierId, devisId);
    assert.match(lu.contenu.toString("latin1"), /Devis papier/);
    await avecActeur(LUCAS, () => existants.importerPdfDocument(dossierId, devisId, pdf("Devis signe")));
    assert.match((await documents.lirePdfDocument(dossierId, devisId)).contenu.toString("latin1"), /Devis signe/);
    const vue = (await dossiers.chargerDetail(dossierId)).documents.find((document) => document.id === devisId);
    assert.equal(vue?.origine, "REPRISE");
    assert.ok(vue?.pdfUrl);

    const { document: avoir } = await avecActeur(LUCAS, () => documents.genererAvoir(dossierId, factureId, { motif: "ERREUR_MONTANT" }));
    assert.equal(avoir.totalHt, 2600);
    assert.match(avoir.lignes, /Annulation de la facture 2026-030/);
    assert.equal((await prisma.document.findUniqueOrThrow({ where: { id: factureId } })).statut, "ANNULEE");
  });
});
