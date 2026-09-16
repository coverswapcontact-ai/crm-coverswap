import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { preparerBaseEssai } from "@/test/base-essai";
import { calculerSeuils, calculerUrssaf, trancheRetard, type Lecteur } from "./calculs";
import { lignesDuLivre, livreEnCsv, type EncaissementLivre } from "./livre";
import { periodeDe, periodePrecedente } from "./periodes";

preparerBaseEssai();
process.env.META_PIXEL_ID = "";
process.env.META_ACCESS_TOKEN = "";

const midi = (jour: string) => new Date(`${jour}T12:00:00Z`);

/** Paramètres d'essai : [clé, valeur, valable du]. */
function lecteur(valeurs: [string, string | number, string][]): Lecteur {
  return (cle, date) => {
    const candidates = valeurs.filter(([nom, , du]) => nom === cle && midi(du) <= date).sort((a, b) => b[2].localeCompare(a[2]));
    return candidates[0]?.[1] ?? null;
  };
}

function encaissement(partiel: Partial<EncaissementLivre> & Pick<EncaissementLivre, "id" | "montant" | "recuLe">): EncaissementLivre {
  return {
    createdAt: partiel.recuLe,
    dossierId: "d1",
    objetDossier: "Recouvrement cuisine",
    payeur: "Alice Durand",
    moyen: "VIREMENT",
    reference: null,
    crediteLe: null,
    statut: "VALIDE",
    finLe: null,
    motifFin: null,
    pieces: [{ numero: "F2026-001", type: "FACTURE" }],
    ...partiel,
  };
}

describe("périodes de déclaration", () => {
  test("trimestre, mois, année bissextile, passage d'année", () => {
    assert.deepEqual(periodeDe("2026-09-16", "TRIMESTRIELLE"), {
      debut: "2026-07-01",
      fin: "2026-09-30",
      libelle: "3e trimestre 2026",
      echeanceDeclaration: "2026-10-31",
    });
    assert.equal(periodeDe("2028-02-10", "MENSUELLE").fin, "2028-02-29");
    assert.equal(periodeDe("2028-02-10", "MENSUELLE").echeanceDeclaration, "2028-03-31");
    assert.equal(periodeDe("2026-12-05", "MENSUELLE").echeanceDeclaration, "2027-01-31");
    const t1 = periodeDe("2026-02-01", "TRIMESTRIELLE");
    assert.deepEqual(periodePrecedente(t1, "TRIMESTRIELLE"), {
      debut: "2025-10-01",
      fin: "2025-12-31",
      libelle: "4e trimestre 2025",
      echeanceDeclaration: "2026-01-31",
    });
    assert.equal(periodePrecedente(periodeDe("2026-01-15", "MENSUELLE"), "MENSUELLE").libelle, "décembre 2025");
  });

  test("retard d'une facture", () => {
    assert.deepEqual(trancheRetard("2026-09-20", "2026-09-16"), { tranche: "NON_ECHUE", joursRetard: 0 });
    assert.deepEqual(trancheRetard("2026-09-01", "2026-09-16"), { tranche: "J30", joursRetard: 15 });
    assert.deepEqual(trancheRetard("2026-05-01", "2026-09-16"), { tranche: "PLUS_90", joursRetard: 138 });
    assert.deepEqual(trancheRetard(null, "2026-09-16"), { tranche: "INCONNUE", joursRetard: null });
  });
});

describe("livre des recettes", () => {
  test("un virement compte à sa réception", () => {
    const { lignes, manquants } = lignesDuLivre([encaissement({ id: "e1", montant: 390, recuLe: midi("2026-03-12") })], () => null);
    assert.deepEqual(manquants, []);
    assert.equal(lignes.length, 1);
    assert.equal(lignes[0].jour, "2026-03-12");
    assert.equal(lignes[0].nature, "Recouvrement cuisine");
    assert.equal(lignes[0].pieces, "facture F2026-001");
  });

  test("un chèque suit la règle en vigueur à sa réception ; sans règle, rien n'est supposé", () => {
    // Règle changée au 1er juillet : à la réception avant, au crédit après.
    const lire = (recuLe: Date) => (recuLe < midi("2026-07-01") ? "RECEPTION" : "CREDIT_BANCAIRE");
    const cheques = [
      encaissement({ id: "mai", moyen: "CHEQUE", montant: 100, recuLe: midi("2026-05-28"), crediteLe: midi("2026-06-03") }),
      encaissement({ id: "juillet-credite", moyen: "CHEQUE", montant: 200, recuLe: midi("2026-07-28"), crediteLe: midi("2026-08-04") }),
      encaissement({ id: "juillet-attente", moyen: "CHEQUE", montant: 300, recuLe: midi("2026-07-30") }),
    ];
    const { lignes } = lignesDuLivre(cheques, lire);
    assert.deepEqual(
      lignes.map((ligne) => [ligne.encaissementId, ligne.jour]),
      [
        ["mai", "2026-05-28"],
        ["juillet-credite", "2026-08-04"],
      ]
    );
    assert.deepEqual(lignesDuLivre(cheques, () => null).manquants, ["DATE_RECETTE_CHEQUE"]);
  });

  test("rien ne s'efface : rejet et annulation laissent la recette et ajoutent une contre-passation datée", () => {
    const { lignes } = lignesDuLivre(
      [
        encaissement({ id: "rejete", moyen: "CHEQUE", montant: 500, recuLe: midi("2026-03-30"), statut: "REJETE", finLe: midi("2026-04-08"), motifFin: "Sans provision" }),
        encaissement({ id: "coquille", montant: 3000, recuLe: midi("2026-04-02"), statut: "ANNULE", finLe: midi("2026-04-02"), motifFin: "Montant erroné" }),
        encaissement({ id: "correct", montant: 300, recuLe: midi("2026-04-02") }),
      ],
      () => "RECEPTION"
    );
    assert.deepEqual(
      lignes.map((ligne) => [ligne.encaissementId, ligne.jour, ligne.montant, ligne.mouvement]),
      [
        ["rejete", "2026-03-30", 500, "RECETTE"],
        ["coquille", "2026-04-02", 3000, "RECETTE"],
        ["correct", "2026-04-02", 300, "RECETTE"],
        ["coquille", "2026-04-02", -3000, "ANNULATION"],
        ["rejete", "2026-04-08", -500, "REJET"],
      ]
    );
    // Mars, peut-être déjà déclaré, n'est pas réécrit : la correction tombe en avril.
    const mars = lignes.filter((ligne) => ligne.jour.startsWith("2026-03")).reduce((somme, ligne) => somme + ligne.montant, 0);
    const avril = lignes.filter((ligne) => ligne.jour.startsWith("2026-04")).reduce((somme, ligne) => somme + ligne.montant, 0);
    assert.equal(mars, 500);
    assert.equal(avril, -200);
  });

  test("export CSV pour le comptable", () => {
    const { lignes } = lignesDuLivre(
      [encaissement({ id: "e1", montant: 1234.5, recuLe: midi("2026-03-12"), payeur: "Hôtel du Parc; SARL", reference: "Virement \"mars\"" })],
      () => null
    );
    const csv = livreEnCsv(lignes);
    assert.equal(csv.charCodeAt(0), 0xfeff);
    const [entete, ligne] = csv.slice(1).split("\r\n");
    assert.equal(entete.split(";")[0], "Date d'encaissement");
    assert.equal(ligne, '12/03/2026;"Hôtel du Parc; SARL";Recouvrement cuisine;facture F2026-001;Virement;"Virement ""mars""";1234,50;Recette;');
  });
});

describe("URSSAF et seuils", () => {
  const lignes = lignesDuLivre(
    [
      encaissement({ id: "juin", montant: 1000, recuLe: midi("2026-06-20") }),
      encaissement({ id: "juillet", montant: 2000, recuLe: midi("2026-07-10") }),
    ],
    () => null
  ).lignes;

  test("chaque recette au taux de sa date ; un taux absent n'est pas supposé", () => {
    const taux = lecteur([
      ["TAUX_COTISATIONS_SOCIALES", 21.2, "2026-01-01"],
      ["TAUX_COTISATIONS_SOCIALES", 21.5, "2026-07-01"],
      ["TAUX_CFP", 0.3, "2026-01-01"],
      ["VERSEMENT_LIBERATOIRE", "NON", "2026-01-01"],
    ]);
    const semestre = { debut: "2026-06-01", fin: "2026-07-31", libelle: "essai", echeanceDeclaration: "2026-08-31" };
    const { urssaf, manquants } = calculerUrssaf(lignes, semestre, taux);
    assert.deepEqual(manquants, []);
    assert.equal(urssaf?.chiffreAffaires, 3000);
    assert.equal(urssaf?.cotisations, 212 + 430);
    assert.equal(urssaf?.cfp, 9);
    assert.equal(urssaf?.versementLiberatoire, null);
    assert.equal(urssaf?.total, 651);

    const avecOption = lecteur([
      ["TAUX_COTISATIONS_SOCIALES", 21.2, "2026-01-01"],
      ["TAUX_CFP", 0.3, "2026-01-01"],
      ["VERSEMENT_LIBERATOIRE", "OUI", "2026-01-01"],
    ]);
    assert.deepEqual(calculerUrssaf(lignes, semestre, avecOption).manquants, ["TAUX_VERSEMENT_LIBERATOIRE"]);
  });

  test("seuils : exigés, progression et projection de l'année en cours", () => {
    assert.deepEqual(calculerSeuils({ annee: 2026, aujourdhui: "2026-09-16", chiffreAffaires: 3000 }, lecteur([])).manquants, [
      "SEUIL_FRANCHISE_TVA",
      "SEUIL_FRANCHISE_TVA_MAJORE",
      "PLAFOND_MICRO_ENTREPRISE",
    ]);
    const seuils = lecteur([
      ["SEUIL_FRANCHISE_TVA", 10000, "2026-01-01"],
      ["SEUIL_FRANCHISE_TVA_MAJORE", 12000, "2026-01-01"],
      ["PLAFOND_MICRO_ENTREPRISE", 50000, "2026-01-01"],
    ]);
    const enCours = calculerSeuils({ annee: 2026, aujourdhui: "2026-09-16", chiffreAffaires: 3000 }, seuils);
    assert.equal(enCours.seuils[0].pourcentage, 30);
    assert.equal(enCours.seuils[0].projection, Math.round((3000 * 365 * 100) / 259) / 100);
    const passee = calculerSeuils({ annee: 2026, aujourdhui: "2027-02-01", chiffreAffaires: 3000 }, seuils);
    assert.equal(passee.seuils[0].projection, null);
  });
});

describe("tableau des finances (base d'essai)", () => {
  let prisma: typeof import("@/lib/prisma").default;
  let tableau: typeof import("./tableau");
  let service: typeof import("@/lib/encaissements/service");
  let parametres: typeof import("@/lib/parametres/service");

  before(async () => {
    prisma = (await import("@/lib/prisma")).default;
    tableau = await import("./tableau");
    service = await import("@/lib/encaissements/service");
    parametres = await import("@/lib/parametres/service");
    await (await import("@/lib/base/preparation")).preparerBase();
  });

  after(async () => {
    await prisma.$disconnect();
  });

  test("facture hors CRM : suivie dès que son montant est connu ; chèque sans règle : recettes à paramétrer", async () => {
    const maintenant = midi("2026-09-16");
    let resultat = await tableau.chargerTableauFinances(2026, maintenant);
    assert.ok(resultat.qualite.some((point) => point.code === "HORS_CRM_SANS_MONTANT" && point.detail.includes("2026-030")));

    const facture = await prisma.numeroDocument.findFirstOrThrow({ where: { cle: ":2026:30" } });
    const registre = await import("@/lib/dossiers/registre");
    await registre.completerNumero(facture.id, { montant: 1000, destinataire: "Client papier", emisLe: "2026-02-10" });
    await assert.rejects(() => registre.completerNumero(facture.id, { emisLe: "2026-02-11" }), /déjà renseignée/);
    await service.enregistrerEncaissement({
      numeroDocumentId: facture.id,
      paiement: { montant: 400, moyen: "CHEQUE", recuLe: "2026-02-20", reference: "123" },
    });

    resultat = await tableau.chargerTableauFinances(2026, maintenant);
    const ligne = resultat.encours.lignes.find((candidate) => candidate.numero === "2026-030");
    assert.equal(ligne?.reste, 600);
    assert.equal(ligne?.tranche, "PLUS_90");
    assert.equal(resultat.cheques.length, 1);
    assert.equal(resultat.recettes.etat, "PARAMETRES");
    assert.deepEqual(resultat.recettes.etat === "PARAMETRES" ? resultat.recettes.manquants : [], ["DATE_RECETTE_CHEQUE"]);

    await parametres.enregistrerParametre({ cle: "DATE_RECETTE_CHEQUE", valeur: "RECEPTION", valableDu: midi("2026-01-01") });
    resultat = await tableau.chargerTableauFinances(2026, maintenant);
    assert.equal(resultat.recettes.etat, "OK");
    if (resultat.recettes.etat === "OK") {
      assert.equal(resultat.recettes.donnees.total, 400);
      assert.equal(resultat.recettes.donnees.parMois[1], 400);
    }
    assert.equal(resultat.urssaf.etat, "PARAMETRES");
    assert.equal(resultat.seuils.etat, "PARAMETRES");
  });
});
