import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { preparerBaseEssai } from "@/test/base-essai";
import { delaisCles, dureeParEtape, ecartsPrix, formatDuree, parcoursEtapes } from "./delais";

preparerBaseEssai();

const JOUR = 24 * 60 * 60_000;
const jour = (n: number) => new Date(Date.UTC(2026, 0, 1) + n * JOUR);

describe("délais", () => {
  const changements = [
    { createdAt: jour(10), vers: "DEVIS_ENVOYE" },
    { createdAt: jour(0), vers: "QUALIFICATION" },
    { createdAt: jour(3), vers: "SIMULATION" },
    { createdAt: jour(20), vers: "RELANCE" },
    { createdAt: jour(22), vers: "DEVIS_ENVOYE" },
    { createdAt: jour(30), vers: "SIGNE" },
  ];

  test("parcours dans l'ordre, étape en cours jusqu'à maintenant", () => {
    const parcours = parcoursEtapes(changements, jour(35));
    assert.deepEqual(
      parcours.map((passage) => [passage.etape, passage.dureeMs / JOUR]),
      [
        ["QUALIFICATION", 3],
        ["SIMULATION", 7],
        ["DEVIS_ENVOYE", 10],
        ["RELANCE", 2],
        ["DEVIS_ENVOYE", 8],
        ["SIGNE", 5],
      ]
    );
    assert.equal(parcours.at(-1)?.fin, null);
    assert.equal(dureeParEtape(parcours).DEVIS_ENVOYE, 18 * JOUR, "deux passages cumulés");
  });

  test("délais clés et durées lisibles", () => {
    const parcours = parcoursEtapes([...changements, { createdAt: jour(40), vers: "CHANTIER" }], jour(45));
    const delais = delaisCles(parcours);
    assert.equal(delais.ouvertureASignature, 30 * JOUR);
    assert.equal(delais.signatureAChantier, 10 * JOUR);
    assert.equal(delais.boutEnBout, null);
    assert.equal(formatDuree(3 * JOUR + 5 * 60 * 60_000), "3 j");
    assert.equal(formatDuree(5 * 60 * 60_000), "5 h");
  });

  test("écart entre premier devis et devis signé ; brouillons ignorés", () => {
    const ecarts = ecartsPrix(
      [
        { type: "DEVIS", statut: "BROUILLON", totalHt: 9999, dateEmission: null, createdAt: jour(1) },
        { type: "DEVIS", statut: "GENERE", totalHt: 3000, dateEmission: jour(2), createdAt: jour(2) },
        { type: "DEVIS", statut: "ACCEPTE", totalHt: 2700, dateEmission: jour(9), createdAt: jour(9) },
        { type: "FACTURE", statut: "GENERE", totalHt: 810, dateEmission: jour(12), createdAt: jour(12) },
        { type: "FACTURE", statut: "GENERE", totalHt: 1890, dateEmission: jour(40), createdAt: jour(40) },
      ],
      2500
    );
    assert.equal(ecarts.premierDevis, 3000);
    assert.equal(ecarts.devisSigne, 2700);
    assert.equal(ecarts.ecartSignature, -300);
    assert.equal(ecarts.ecartSignaturePct, -10);
    assert.equal(ecarts.facture, 2700);
    assert.equal(ecarts.estimation, 2500);
  });
});

let prisma: typeof import("@/lib/prisma").default;
let avecActeur: typeof import("@/lib/journal/contexte").avecActeur;
let transitions: typeof import("./transitions");
const LUCAS = { acteur: "HUMAIN:lucas@coverswap.fr" };

before(async () => {
  prisma = (await import("@/lib/prisma")).default;
  avecActeur = (await import("@/lib/journal/contexte")).avecActeur;
  transitions = await import("./transitions");
  await (await import("@/lib/base/preparation")).preparerBase();
});

after(async () => {
  await prisma.$disconnect();
});

async function dossierAvecDevis() {
  const dossier = await prisma.dossier.create({
    data: {
      clientNom: "Hôtel des Essais",
      clientAdresse: "1 quai",
      clientCp: "34250",
      clientVille: "Palavas",
      clientTelephone: "0467000000",
      objet: "Réception",
      source: "PROSPECTION",
      etape: "DEVIS_ENVOYE",
      montantEstime: 5000,
    },
  });
  await prisma.document.create({
    data: {
      dossierId: dossier.id,
      type: "DEVIS",
      numero: `2026-9${Math.floor(Math.random() * 1000)}`,
      dateEmission: new Date(),
      objet: "Réception",
      lignes: "[]",
      totalHt: 4200,
      statut: "GENERE",
    },
  });
  return dossier;
}

describe("perte figée", () => {
  test("concurrent, prix, notre prix et étape figés ; la reprise les retire, l'événement les garde", async () => {
    const dossier = await dossierAvecDevis();
    await avecActeur(LUCAS, () =>
      transitions.changerEtape(dossier.id, {
        vers: "PERDU",
        motifPerte: "CONCURRENT",
        perteConcurrent: "Cuisines du Sud",
        perteMontantConcurrent: 3500,
        perteCommentaire: "Moins cher et disponible plus tôt",
      })
    );
    const perdu = await prisma.dossier.findUniqueOrThrow({ where: { id: dossier.id } });
    assert.equal(perdu.perteEtape, "DEVIS_ENVOYE");
    assert.equal(perdu.perteConcurrent, "Cuisines du Sud");
    assert.equal(perdu.perteMontantConcurrent, 3500);
    assert.equal(perdu.perteMontantPropose, 4200);
    assert.ok(perdu.perteLe);

    await avecActeur(LUCAS, () => transitions.changerEtape(dossier.id, { vers: "DEVIS_ENVOYE" }));
    const repris = await prisma.dossier.findUniqueOrThrow({ where: { id: dossier.id } });
    assert.equal(repris.perteConcurrent, null);
    assert.equal(repris.perteMontantPropose, null);

    const evenement = await prisma.dossierEvenement.findFirstOrThrow({
      where: { dossierId: dossier.id, type: "CHANGEMENT_ETAPE", contenu: { contains: "Perdu" } },
    });
    const metadata = JSON.parse(evenement.metadata);
    assert.equal(metadata.perteConcurrent, "Cuisines du Sud");
    assert.equal(metadata.perteMontantPropose, 4200);
    assert.match(evenement.contenu, /remporté par Cuisines du Sud/);
  });

  test("perdu après une pause : l'étape retenue est celle d'avant la pause", async () => {
    const dossier = await dossierAvecDevis();
    await avecActeur(LUCAS, () => transitions.changerEtape(dossier.id, { vers: "EN_PAUSE" }));
    await avecActeur(LUCAS, () => transitions.changerEtape(dossier.id, { vers: "PERDU", motifPerte: "SANS_REPONSE" }));
    const perdu = await prisma.dossier.findUniqueOrThrow({ where: { id: dossier.id } });
    assert.equal(perdu.perteEtape, "DEVIS_ENVOYE");
    assert.equal(perdu.perteConcurrent, null);
  });
});
