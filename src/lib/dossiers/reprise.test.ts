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
let avecActeur: typeof import("@/lib/journal/contexte").avecActeur;
let reprise: typeof import("./reprise");
let dossiers: typeof import("./dossiers");
let numerotation: typeof import("./numerotation");
let soldes: typeof import("@/lib/encaissements/soldes");
const LUCAS = { acteur: "HUMAIN:lucas@coverswap.fr" };

before(async () => {
  prisma = (await import("@/lib/prisma")).default;
  avecActeur = (await import("@/lib/journal/contexte")).avecActeur;
  reprise = await import("./reprise");
  dossiers = await import("./dossiers");
  numerotation = await import("./numerotation");
  soldes = await import("@/lib/encaissements/soldes");
  await (await import("@/lib/base/preparation")).preparerBase();
  await (await import("@/lib/parametres/service")).enregistrerParametre({ cle: "DATE_RECETTE_CHEQUE", valeur: "RECEPTION", valableDu: new Date("2026-01-01T00:00:00Z") });
});

after(async () => {
  await prisma.$disconnect();
});

describe("reprise d'un dossier en cours", () => {
  test("signé en juillet, facturé en août, avec son devis, sa facture et ses paiements : en une fois, à ses dates", async () => {
    const prochainDevis = await numerotation.prochainNumero("DEVIS");
    const resultat = await avecActeur(LUCAS, () =>
      reprise.reprendreDossier(
        reprise.schemaReprise.parse({
          dossier: { clientNom: "Villa des Pins", clientTelephone: "06 11 22 33 44", objet: "Cuisine et crédence", source: "RECOMMANDATION" },
          etape: "FACTURE",
          dates: { ouvertLe: "2026-06-02", jalons: { DEVIS_ENVOYE: "2026-06-10", SIGNE: "2026-07-01", CHANTIER: "2026-07-20" }, etapeDepuisLe: "2026-08-05", dateChantier: "2026-07-20" },
          documents: [
            { type: "DEVIS", numero: "2026-034", dateEmission: "2026-06-10", montant: 3000, statut: "ACCEPTE", acomptePct: 30 },
            { type: "FACTURE", numero: "2026-032", dateEmission: "2026-08-05", montant: 3000 },
          ],
          paiements: [
            { montant: 900, moyen: "CHEQUE", recuLe: "2026-07-01", reference: "1234567" },
            { montant: 1000, recuLe: "2026-08-20" },
          ],
        })
      )
    );
    assert.deepEqual(resultat.avertissements, []);
    assert.equal(resultat.documents.length, 2);
    assert.equal(await numerotation.prochainNumero("DEVIS"), prochainDevis, "rien n'est généré");

    const detail = await dossiers.chargerDetail(resultat.id);
    assert.equal(detail.etape, "FACTURE");
    assert.equal(detail.ouvertLe, "2026-06-02T12:00:00.000Z");
    assert.equal(detail.dateChantier, "2026-07-20T12:00:00.000Z");
    assert.deepEqual(
      detail.parcours.map((passage) => [passage.etape, passage.debut.slice(0, 10), Boolean(passage.dateInconnue)]),
      [
        ["QUALIFICATION", "2026-06-02", false],
        ["DEVIS_ENVOYE", "2026-06-10", false],
        ["SIGNE", "2026-07-01", false],
        ["CHANTIER", "2026-07-20", false],
        ["FACTURE", "2026-08-05", false],
      ]
    );
    assert.ok(detail.documents.every((document) => document.origine === "REPRISE"));
    assert.equal((await soldes.faitsPaiements(prisma, resultat.id)).resteCentimes, 110000, "les paiements s'imputent sur la facture reprise");
    assert.deepEqual(detail.completude.map((point) => point.code), ["ADRESSE", "PHOTO"]);
    const fiche = await prisma.client.findUniqueOrThrow({ where: { id: detail.client!.id } });
    assert.equal(fiche.premierContactLe.toISOString(), "2026-06-02T12:00:00.000Z", "le client est en contact depuis l'ouverture réelle");

    const signature = await prisma.dossierEvenement.findMany({ where: { dossierId: resultat.id, type: "CHANGEMENT_ETAPE" } });
    const signe = signature.map((evenement) => JSON.parse(evenement.metadata)).find((metadata) => metadata.vers === "SIGNE");
    assert.equal(signe.documentId, detail.documents.find((document) => document.type === "DEVIS")?.id, "la signature porte le devis accepté");

    const { calculerSynthese } = await import("@/lib/synthese/calcul");
    const juin = await calculerSynthese("2026-06-01", "2026-06-30");
    const juillet = await calculerSynthese("2026-07-01", "2026-07-31");
    assert.equal(juin.commercial.cohorte.ouverts, 1);
    assert.equal(juillet.commercial.activite.signatures, 1);
    assert.equal(juillet.commercial.activite.montantSigne, 3000);
  });

  test("sans date, l'arrivée à l'étape reste inconnue ; des dates dans le désordre sont signalées ; tout ou rien", async () => {
    const sansDate = await avecActeur(LUCAS, () => reprise.reprendreDossier(reprise.schemaReprise.parse({ dossier: { clientNom: "Bureau Sud" }, etape: "CHANTIER" })));
    assert.deepEqual(sansDate.avertissements, ["Date d'arrivée en « Chantier » inconnue : à compléter sur le dossier."]);
    const detail = await dossiers.chargerDetail(sansDate.id);
    assert.equal(detail.parcours.at(-1)?.dateInconnue, true);
    assert.ok(detail.completude.some((point) => point.code === "DATES_ETAPES"));

    const desordre = await avecActeur(LUCAS, () =>
      reprise.reprendreDossier(
        reprise.schemaReprise.parse({
          dossier: { clientNom: "Salon Rive Droite" },
          etape: "PLANIFIE",
          dates: { jalons: { DEVIS_ENVOYE: "2026-07-15", SIGNE: "2026-07-01" }, etapeDepuisLe: "2026-07-20" },
        })
      )
    );
    assert.deepEqual(desordre.avertissements, ["Les dates ne se suivent pas : « Signé » le 01/07/2026, avant « Devis envoyé » le 15/07/2026."]);

    const avant = await prisma.dossier.count();
    await assert.rejects(
      avecActeur(LUCAS, () =>
        reprise.reprendreDossier(
          reprise.schemaReprise.parse({
            dossier: { clientNom: "Doublon de numéro" },
            etape: "SIGNE",
            documents: [{ type: "DEVIS", numero: "2026-034", dateEmission: "2026-06-10", montant: 3000 }],
          })
        )
      ),
      /déjà rattaché/
    );
    assert.equal(await prisma.dossier.count(), avant, "rien n'est écrit quand un document est refusé");
    assert.throws(() => reprise.schemaReprise.parse({ dossier: { clientNom: "Futur" }, etape: "SIGNE", dates: { etapeDepuisLe: "2999-01-01" } }), /la date est à venir/);
  });
});
