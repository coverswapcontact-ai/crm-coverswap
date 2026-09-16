import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { preparerBaseEssai } from "@/test/base-essai";
import { delaisCles, parcoursEtapes } from "./delais";

preparerBaseEssai();
process.env.UPLOADS_DIR = mkdtempSync(path.join(tmpdir(), "coverswap-uploads-"));
process.env.META_PIXEL_ID = "";
process.env.META_ACCESS_TOKEN = "";

const JOUR = 86_400_000;

describe("parcours à dates réelles", () => {
  test("les passages se lisent à leur date réelle, dans l'ordre des dates ; une date inconnue ne fait pas de délai", () => {
    const saisie = new Date("2026-09-16T08:00:00Z");
    const parcours = parcoursEtapes(
      [
        { createdAt: saisie, survenuLe: new Date("2026-06-02T12:00:00Z"), vers: "QUALIFICATION", ouverture: true, evenementId: "e1" },
        { createdAt: saisie, survenuLe: new Date("2026-07-10T12:00:00Z"), vers: "SIGNE", evenementId: "e2" },
        { createdAt: saisie, survenuLe: new Date("2026-07-10T12:00:00Z"), vers: "CHANTIER", evenementId: "e3", dateInconnue: true },
        { createdAt: saisie, vers: "FACTURE", evenementId: "e4" },
      ],
      new Date("2026-09-20T08:00:00Z")
    );
    assert.deepEqual(parcours.map((passage) => passage.etape), ["QUALIFICATION", "SIGNE", "CHANTIER", "FACTURE"]);
    assert.equal(parcours[0].ouverture, true);
    assert.equal(parcours[0].saisiLe, saisie.toISOString());
    assert.equal(parcours[3].saisiLe, undefined, "date réelle = date de saisie");
    assert.equal(Math.round(parcours[0].dureeMs / JOUR), 38);
    const delais = delaisCles(parcours);
    assert.equal(Math.round((delais.ouvertureASignature ?? 0) / JOUR), 38);
    assert.equal(delais.signatureAChantier, null, "la date du chantier est inconnue");
  });
});

let prisma: typeof import("@/lib/prisma").default;
let avecActeur: typeof import("@/lib/journal/contexte").avecActeur;
let dossiers: typeof import("./dossiers");
let transitions: typeof import("./transitions");
let documents: typeof import("./documents");
let service: typeof import("@/lib/encaissements/service");
let livre: typeof import("@/lib/finances/livre");
const LUCAS = { acteur: "HUMAIN:lucas@coverswap.fr" };
const refusBase = (motif: RegExp) => (erreur: unknown) => erreur instanceof Error && erreur.name === "EcritureRefusee" && motif.test(erreur.message);

before(async () => {
  prisma = (await import("@/lib/prisma")).default;
  avecActeur = (await import("@/lib/journal/contexte")).avecActeur;
  dossiers = await import("./dossiers");
  transitions = await import("./transitions");
  documents = await import("./documents");
  service = await import("@/lib/encaissements/service");
  livre = await import("@/lib/finances/livre");
  await (await import("@/lib/base/preparation")).preparerBase();
  await (await import("@/lib/parametres/service")).enregistrerParametre({ cle: "DATE_RECETTE_CHEQUE", valeur: "RECEPTION", valableDu: new Date("2026-01-01T00:00:00Z") });
});

after(async () => {
  await prisma.$disconnect();
});

describe("dates réelles d'un dossier", () => {
  let dossierId: string;

  test("un passage daté dans le passé garde sa date réelle ; la saisie reste celle du jour", async () => {
    dossierId = await avecActeur(LUCAS, () => dossiers.creerDossier(dossiers.schemaCreation.parse({ clientNom: "Hôtel Juillet", clientTelephone: "04 67 00 00 07" }), []));
    await assert.rejects(async () => transitions.schemaChangementEtape.parse({ vers: "SIGNE", survenuLe: "2999-01-01" }), /La date du passage est à venir/);
    await avecActeur(LUCAS, () => transitions.changerEtape(dossierId, transitions.schemaChangementEtape.parse({ vers: "SIGNE", survenuLe: "2026-07-10", sansAcompte: { motif: "PAIEMENT_A_LA_FACTURE" } })));

    const signature = await prisma.dossierEvenement.findFirstOrThrow({ where: { dossierId, type: "CHANGEMENT_ETAPE" }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
    assert.equal(signature.survenuLe?.toISOString(), "2026-07-10T12:00:00.000Z");
    const detail = await dossiers.chargerDetail(dossierId);
    assert.equal(detail.parcours[0].etape, "SIGNE", "le passage de juillet précède l'ouverture saisie aujourd'hui");
    assert.ok(detail.evenements.some((evenement) => evenement.saisiLe && evenement.date.startsWith("2026-07-10")));
  });

  test("l'ouverture se corrige : le dossier suit ; le parcours se remet dans l'ordre", async () => {
    const detail = await dossiers.chargerDetail(dossierId);
    const ouverture = detail.parcours.find((passage) => passage.ouverture);
    assert.ok(ouverture?.evenementId);
    await avecActeur(LUCAS, () => dossiers.modifierDateEvenement(dossierId, ouverture.evenementId!, { survenuLe: "2026-06-02" }));

    const apres = await dossiers.chargerDetail(dossierId);
    assert.equal(apres.ouvertLe, "2026-06-02T12:00:00.000Z");
    assert.deepEqual(apres.parcours.map((passage) => passage.etape), ["QUALIFICATION", "SIGNE"]);
    assert.equal(Math.round((apres.delais.ouvertureASignature ?? 0) / JOUR), 38);
    const liste = await dossiers.listerDossiers();
    assert.equal(liste.find((dossier) => dossier.id === dossierId)?.ouvertLe, "2026-06-02T12:00:00.000Z");
    const fiche = await prisma.client.findUniqueOrThrow({ where: { id: apres.client!.id } });
    assert.equal(fiche.premierContactLe.toISOString(), "2026-06-02T12:00:00.000Z", "la fiche client recule avec l'ouverture réelle");
    await avecActeur(LUCAS, () => dossiers.modifierDateEvenement(dossierId, ouverture.evenementId!, { survenuLe: "2026-06-20" }));
    assert.equal((await prisma.client.findUniqueOrThrow({ where: { id: fiche.id } })).premierContactLe.toISOString(), "2026-06-02T12:00:00.000Z", "le premier contact n'avance jamais");
    await avecActeur(LUCAS, () => dossiers.modifierDateEvenement(dossierId, ouverture.evenementId!, { survenuLe: "2026-06-02" }));

    // Une date inconnue (reprise) devient connue ; seul un passage d'étape se redate ici.
    const signature = apres.parcours.find((passage) => passage.etape === "SIGNE")!;
    const evenement = await prisma.dossierEvenement.findUniqueOrThrow({ where: { id: signature.evenementId! } });
    await prisma.dossierEvenement.update({ where: { id: evenement.id }, data: { metadata: JSON.stringify({ ...JSON.parse(evenement.metadata), dateInconnue: true }) } });
    assert.ok((await dossiers.chargerDetail(dossierId)).completude.some((point) => point.code === "DATES_ETAPES"));
    await avecActeur(LUCAS, () => dossiers.modifierDateEvenement(dossierId, evenement.id, { survenuLe: "2026-07-11" }));
    assert.ok(!(await dossiers.chargerDetail(dossierId)).completude.some((point) => point.code === "DATES_ETAPES"));
    const note = await prisma.dossierEvenement.create({ data: { dossierId, type: "NOTE_AJOUTEE", direction: "INTERNE", contenu: "Note" } });
    await assert.rejects(avecActeur(LUCAS, () => dossiers.modifierDateEvenement(dossierId, note.id, { survenuLe: "2026-07-01" })), /Seule la date d'un passage d'étape/);
  });

  test("un paiement se corrige : date et montant, imputation refaite, livre des recettes à la nouvelle date", async () => {
    const { document: devis } = await avecActeur(LUCAS, () =>
      documents.genererDocument(dossierId, {
        type: "DEVIS",
        objet: "Salle de réception",
        lignes: [{ type: "PRESTATION", designation: "Revêtement adhésif", sousDesignation: undefined, quantite: 10, unite: "ml", prixUnitaire: 100 }],
        noteMl: true,
        acomptePct: 30,
        remplaceDocumentId: null,
      })
    );
    const ligneDevis = await prisma.numeroDocument.findUniqueOrThrow({ where: { documentId: devis.id } });
    const { encaissement } = await avecActeur(LUCAS, () =>
      service.enregistrerEncaissement({ dossierId, numeroDocumentId: ligneDevis.id, paiement: { montant: 300, moyen: "VIREMENT", recuLe: "2026-09-01", reference: null } })
    );

    await avecActeur(LUCAS, () => service.modifierEncaissement(encaissement.id, { recuLe: "2026-07-12", montant: 1200, moyen: "CHEQUE" }));
    const corrige = await prisma.encaissement.findUniqueOrThrow({ where: { id: encaissement.id }, include: { affectations: { orderBy: { createdAt: "asc" } } } });
    assert.equal(corrige.montant, 1200);
    assert.equal(corrige.moyen, "CHEQUE");
    assert.deepEqual(
      corrige.affectations.map((affectation) => [affectation.statut, affectation.montant]),
      [["LIBEREE", 300], ["ACTIVE", 1000]],
      "imputé jusqu'au total du devis, le surplus reste non imputé"
    );
    const evenement = await prisma.dossierEvenement.findFirstOrThrow({ where: { dossierId, type: "ENCAISSEMENT_CORRIGE" } });
    assert.match(evenement.contenu, /montant 1 200,00 € \(au lieu de 300,00 €\), reçu le 12\/07\/2026 \(au lieu du 01\/09\/2026\), par chèque \(au lieu de virement\)/);

    const juillet = await livre.chargerLivre("2026-07-01", "2026-07-31");
    const septembre = await livre.chargerLivre("2026-09-01", "2026-09-30");
    assert.ok(juillet.lignes.some((ligne) => ligne.encaissementId === encaissement.id && ligne.montant === 1200));
    assert.ok(!septembre.lignes.some((ligne) => ligne.encaissementId === encaissement.id));

    // Annulé, il ne se corrige plus ; l'origine d'un encaissement ne change jamais.
    await avecActeur(LUCAS, () => service.annulerEncaissement(encaissement.id, { motif: "DOUBLON" }));
    await assert.rejects(avecActeur(LUCAS, () => service.modifierEncaissement(encaissement.id, { montant: 10 })), /annulé ou rejeté : il ne se corrige plus/);
    await assert.rejects(() => prisma.encaissement.update({ where: { id: encaissement.id }, data: { origine: "REPRISE_ANCIEN_ECRAN" } }), refusBase(/garde son origine/));
    await assert.rejects(() => prisma.encaissement.update({ where: { id: encaissement.id }, data: { recuLe: new Date("2026-07-01T12:00:00Z") } }), refusBase(/annulé ou rejeté ne se corrige plus/));
  });

  test("synthèse : un dossier repris compte dans le mois de son ouverture réelle, sa signature dans celui de la signature", async () => {
    const { calculerSynthese } = await import("@/lib/synthese/calcul");
    const juin = await calculerSynthese("2026-06-01", "2026-06-30");
    const juillet = await calculerSynthese("2026-07-01", "2026-07-31");
    const septembre = await calculerSynthese("2026-09-01", "2026-09-30");
    assert.equal(juin.commercial.cohorte.ouverts, 1);
    assert.equal(juin.commercial.cohorte.signes, 1);
    assert.equal(septembre.commercial.cohorte.ouverts, 0, "saisi en septembre, ouvert en juin");
    assert.equal(juillet.commercial.activite.signatures, 1);
    assert.equal(septembre.commercial.activite.signatures, 0);
  });
});
