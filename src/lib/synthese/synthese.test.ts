import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { preparerBaseEssai } from "@/test/base-essai";

preparerBaseEssai();
process.env.META_PIXEL_ID = "";
process.env.META_ACCESS_TOKEN = "";

let prisma: typeof import("@/lib/prisma").default;
let calcul: typeof import("./calcul");
let redaction: typeof import("./redaction");
let references: typeof import("./references");
let instantanes: typeof import("./instantanes");
let alertes: typeof import("./alertes");

const le = (jour: string, heure = "10:00") => new Date(`${jour}T${heure}:00Z`);
const MARS = { du: "2026-03-01", au: "2026-03-31" };
const ids: Record<string, string> = {};

function changement(dossierId: string, jour: string, de: string | null, vers: string, extra: Record<string, unknown> = {}) {
  return prisma.dossierEvenement.create({
    data: {
      dossierId,
      type: "CHANGEMENT_ETAPE",
      direction: "INTERNE",
      contenu: `${de ?? "Ouverture"} → ${vers}`,
      metadata: JSON.stringify({ de, vers, nature: de ? "SUIVANTE" : "OUVERTURE", ...extra }),
      createdAt: le(jour),
    },
  });
}

async function dossier(nom: string, clientId: string, source: string, ouvert: string, etape: string) {
  const cree = await prisma.dossier.create({
    data: { clientNom: nom, clientAdresse: "1 rue", clientCp: "34000", clientVille: "Montpellier", clientTelephone: "0600000011", objet: "Cuisine", source, etape, clientId, createdAt: le(ouvert) },
  });
  return cree.id;
}

function document(dossierId: string, numero: string, type: string, statut: string, totalHt: number, jour: string) {
  return prisma.document.create({
    data: { dossierId, type, numero, statut, totalHt, dateEmission: le(jour), objet: "Cuisine", lignes: "[]", createdAt: le(jour) },
  });
}

before(async () => {
  prisma = (await import("@/lib/prisma")).default;
  calcul = await import("./calcul");
  redaction = await import("./redaction");
  references = await import("./references");
  instantanes = await import("./instantanes");
  alertes = await import("./alertes");
  await (await import("@/lib/base/preparation")).preparerBase();
  await (await import("@/lib/parametres/service")).enregistrerParametre({ cle: "DATE_RECETTE_CHEQUE", valeur: "RECEPTION", valableDu: le("2026-01-01") });

  const alice = await prisma.client.create({ data: { nom: "Alice Durand", source: "META_ADS", campagne: "Cuisine mars", premierContactLe: le("2026-03-05") } });
  const bruno = await prisma.client.create({ data: { nom: "Bruno Marchal", source: "RECOMMANDATION", recommandeParId: alice.id, premierContactLe: le("2026-03-10") } });
  const chantal = await prisma.client.create({ data: { nom: "Chantal Vidal", source: "SALON", premierContactLe: le("2025-01-05") } });
  ids.alice = alice.id;
  ids.chantal = chantal.id;

  // D1 : signé en mars, après un devis refait à la baisse.
  const d1 = await dossier("Alice Durand", alice.id, "ENTRANT", "2026-03-06", "SIGNE");
  ids.d1 = d1;
  await changement(d1, "2026-03-06", null, "QUALIFICATION");
  await changement(d1, "2026-03-08", "QUALIFICATION", "DEVIS_ENVOYE");
  await document(d1, "2026-101", "DEVIS", "REMPLACE", 1000, "2026-03-08");
  const signe = await document(d1, "2026-102", "DEVIS", "ACCEPTE", 900, "2026-03-12");
  await changement(d1, "2026-03-15", "DEVIS_ENVOYE", "SIGNE", { documentId: signe.id });

  // D2 : perdu au prix contre un concurrent.
  const d2 = await dossier("Bruno Marchal", bruno.id, "RECOMMANDATION", "2026-03-11", "PERDU");
  await changement(d2, "2026-03-11", null, "QUALIFICATION");
  await changement(d2, "2026-03-12", "QUALIFICATION", "DEVIS_ENVOYE");
  await document(d2, "2026-103", "DEVIS", "GENERE", 1000, "2026-03-12");
  await changement(d2, "2026-03-20", "DEVIS_ENVOYE", "PERDU", {
    motifPerte: "PRIX",
    perteEtape: "DEVIS_ENVOYE",
    perteConcurrent: "Cuisines Martin",
    perteMontantConcurrent: 800,
    perteMontantPropose: 1000,
  });

  // Contacts entrants de mars : Meta passé en dossier (D1, signé) ; simulateur jamais rappelé ; demande de
  // devis sans suite ; Meta signé dans l'ancien CRM. Hors période : février, et un doublon archivé.
  const lead = (source: string, statut: string, jour: string, extra: Record<string, unknown> = {}) =>
    prisma.lead.create({ data: { nom: "Contact", prenom: source, telephone: "0600000000", ville: "Sète", source, statut, createdAt: le(jour), ...extra } });
  const leadD1 = await lead("META_ADS", "CONTACTE", "2026-03-05");
  await prisma.dossier.update({ where: { id: d1 }, data: { leadId: leadD1.id } });
  await lead("SITE_SIMULATEUR", "NOUVEAU", "2026-03-07");
  await lead("SITE_DEVIS", "PERDU", "2026-03-09");
  await lead("META_ADS", "TERMINE", "2026-03-20");
  await lead("META_ADS", "NOUVEAU", "2026-02-20");
  await lead("SITE_DEVIS", "NOUVEAU", "2026-03-21", { archiveLe: le("2026-03-22"), archiveMotif: "Doublon" });

  // Ancienne cliente, encaissée il y a longtemps, qui repaie en mars.
  const d3 = await dossier("Chantal Vidal", chantal.id, "AUTRE", "2025-01-10", "ENCAISSE");
  await prisma.dossier.update({ where: { id: d3 }, data: { updatedAt: le("2025-02-01") } });

  await prisma.encaissement.create({ data: { dossierId: d1, clientId: alice.id, payeur: "Alice Durand", montant: 270, moyen: "VIREMENT", recuLe: le("2026-03-16") } });
  await prisma.encaissement.create({ data: { clientId: chantal.id, payeur: "Chantal Vidal", montant: 500, moyen: "VIREMENT", recuLe: le("2026-03-20") } });
  await prisma.depense.create({ data: { payeeLe: le("2026-03-18", "12:00"), montant: 50, fournisseur: "Leroy Merlin", categorie: "MATIERE", dossierId: d1 } });
  await prisma.depense.create({ data: { payeeLe: le("2026-03-02", "12:00"), montant: 20, fournisseur: "Meta", categorie: "PUBLICITE", horsChantier: true } });

  const proposition = (auteur: string, statut: string, cree: string, decide: string | null, extra: Record<string, unknown> = {}) =>
    prisma.proposition.create({
      data: { type: "NOTE_DOSSIER", auteur, titre: "Essai", contenu: "{}", statut, createdAt: le(cree), decideLe: decide ? le(decide) : null, ...extra },
    });
  await proposition("AGENT:mail", "REJETEE", "2026-03-10", "2026-03-10", { motifRejet: "INUTILE" });
  await proposition("AGENT:mail", "EXECUTEE", "2026-03-12", "2026-03-13", { modifiee: true });
  await proposition("SYSTEME:relances", "EN_ATTENTE", "2026-03-28", null);
});

after(async () => {
  await prisma.$disconnect();
});

describe("synthèse d'une période", () => {
  test("commercial : cohorte, activité, délais, écart de prix, pertes", async () => {
    const { commercial } = await calcul.calculerSynthese(MARS.du, MARS.au, le("2026-04-02"));
    assert.deepEqual(
      { ...commercial.cohorte, parSource: undefined },
      { ouverts: 2, devisEnvoyes: 2, signes: 1, encaisses: 0, perdus: 1, enCours: 1, tauxSignatureDevis: 50, parSource: undefined }
    );
    assert.deepEqual(commercial.activite, { devisEmis: 3, montantDevis: 2900, signatures: 1, montantSigne: 900, facturesEmises: 0, montantFacture: 0, avoirs: 0, montantAvoirs: 0, pertes: 1 });
    assert.equal(commercial.delais.find((delai) => delai.cle === "DEVIS_SIGNATURE")?.medianeJours, 7);
    assert.equal(commercial.ecartPrixMoyenPct, -10);
    assert.deepEqual(commercial.pertes.parMotif, [{ cle: "PRIX", libelle: "Trop cher", valeur: 1 }]);
    assert.deepEqual(commercial.pertes.concurrents, [{ nom: "Cuisines Martin", nombre: 1, ecartMoyenPct: -20 }]);
  });

  test("contacts entrants : reçus dans la période, suivis jusqu'au dossier et à la signature, par source", async () => {
    const { entrants } = (await calcul.calculerSynthese(MARS.du, MARS.au)).commercial;
    assert.ok(entrants);
    assert.deepEqual(
      { recus: entrants.recus, contactes: entrants.contactes, avecDossier: entrants.avecDossier, signes: entrants.signes, sansSuite: entrants.sansSuite },
      { recus: 4, contactes: 3, avecDossier: 1, signes: 2, sansSuite: 1 },
      "février et le doublon archivé ne comptent pas"
    );
    assert.deepEqual(
      [...entrants.parSource].sort((a, b) => a.cle.localeCompare(b.cle)),
      [
        { cle: "META_ADS", libelle: "Publicité Meta", recus: 2, avecDossier: 1, signes: 2 },
        { cle: "SITE_DEVIS", libelle: "Site : demande de devis", recus: 1, avecDossier: 0, signes: 0 },
        { cle: "SITE_SIMULATEUR", libelle: "Site : simulateur", recus: 1, avecDossier: 0, signes: 0 },
      ]
    );
  });

  test("finances, clients, agent, qualité : sans aucun nom de personne", async () => {
    const synthese = await calcul.calculerSynthese(MARS.du, MARS.au, le("2026-04-02"));
    assert.equal(synthese.finances.encaisse, 770);
    assert.equal(synthese.finances.depenses, 70);
    assert.equal(synthese.finances.margeBrute, 700);
    assert.deepEqual(
      synthese.finances.parFamilleSource.map((ligne) => [ligne.cle, ligne.valeur]),
      [
        ["ORGANIQUE", 500],
        ["PAYANT", 270],
      ]
    );
    assert.equal(synthese.clients.nouveaux, 2);
    assert.equal(synthese.clients.recommandations, 1);
    assert.deepEqual(synthese.clients.recommandeurs, [{ clientId: ids.alice, nombre: 1 }]);
    assert.deepEqual(synthese.clients.relationnelContrePayant, { nouveauxRelationnel: 1, nouveauxPayant: 1, caRelationnel: 0, caPayant: 270 });
    assert.ok(synthese.clients.inactifs.clientIds.includes(ids.chantal));

    const agent = synthese.agent.parAuteur.find((ligne) => ligne.auteur === "AGENT:mail");
    assert.deepEqual(agent, { auteur: "AGENT:mail", proposees: 2, validees: 1, modifiees: 1, rejetees: 1, expirees: 0, enAttente: 0, tauxAcceptation: 50, delaiDecisionMedianHeures: 12 });
    assert.equal(synthese.agent.parAuteur.find((ligne) => ligne.auteur === "SYSTEME:relances")?.enAttente, 1);
    assert.ok(synthese.qualite.some((point) => point.cle === "DEPENSES_SANS_JUSTIFICATIF" && point.valeur === 2));

    const json = JSON.stringify(synthese);
    for (const nom of ["Alice", "Bruno", "Chantal", "Durand"]) assert.equal(json.includes(nom), false, nom);
  });

  test("version rédigée, nominative ou anonymisée", async () => {
    const synthese = await calcul.calculerSynthese(MARS.du, MARS.au, le("2026-04-02"));
    const texte = redaction.redigerSynthese(synthese, await references.referencesDe(synthese, false));
    assert.match(texte, /^Synthèse du 1er mars 2026 au 31 mars 2026/);
    assert.match(texte, /2 dossiers ouverts dans la période/);
    assert.match(texte, /Taux de signature des devis : 50 %/);
    assert.match(texte, /Encaissé : 770,00 €/);
    assert.match(texte, /Recommandé par : Alice Durand \(1\)/);

    const anonyme = redaction.redigerSynthese(synthese, await references.referencesDe(synthese, true));
    assert.equal(/Alice|Bruno|Chantal|Durand/.test(anonyme), false);
    assert.match(anonyme, new RegExp(`Recommandé par : Client ${references.pseudonyme(ids.alice)} \\(1\\)`));
    assert.match(anonyme, /Cuisines Martin/);
  });

  test("instantanés : figés une fois, jamais réécrits, écarts visibles ; un mois incalculable attend", async () => {
    // Un chèque de juin 2025, avant toute règle de date des chèques : ce mois-là ne peut pas être figé.
    await prisma.encaissement.create({ data: { clientId: ids.chantal, payeur: "Chantal Vidal", montant: 80, moyen: "CHEQUE", recuLe: le("2025-06-10") } });
    const { figes, reportes } = await instantanes.figerMoisEcoules(le("2026-04-02"));
    assert.ok(figes.includes("2026-03") && figes.includes("2025-01"));
    assert.deepEqual(reportes, ["2025-06"]);
    assert.deepEqual((await instantanes.figerMoisEcoules(le("2026-04-02"))).figes, []);

    const ligne = await prisma.instantaneMensuel.findUniqueOrThrow({ where: { mois: "2026-03" } });
    assert.equal(ligne.contenu.includes("Alice"), false);
    await assert.rejects(
      () => prisma.$executeRawUnsafe(`UPDATE "InstantaneMensuel" SET "contenu" = '{}' WHERE "id" = ?`, ligne.id),
      (erreur: unknown) => erreur instanceof Error && /Un instantané mensuel est figé/.test(erreur.message)
    );

    let lu = await instantanes.lireInstantane("2026-03", le("2026-04-02"));
    assert.equal(lu?.integre, true);
    assert.deepEqual(lu?.ecarts, []);
    // Un paiement de mars saisi en avril : l'instantané ne bouge pas, l'écart apparaît.
    await prisma.encaissement.create({ data: { clientId: ids.alice, payeur: "Alice Durand", montant: 100, moyen: "ESPECES", recuLe: le("2026-03-30") } });
    lu = await instantanes.lireInstantane("2026-03", le("2026-04-10"));
    assert.equal(lu?.synthese.finances.encaisse, 770);
    assert.deepEqual(lu?.ecarts, [{ indicateur: "Encaissé", fige: 770, recalcule: 870 }]);
  });

  test("alertes : ce qui manque est dit, les plus graves d'abord", async () => {
    const liste = await alertes.calculerAlertes(le("2026-04-02"));
    const codes = liste.map((alerte) => alerte.code);
    // Mission 13 (B16) : le délai de relance a une valeur par défaut, l'alerte « non renseigné » n'existe plus.
    assert.ok(!codes.includes("PARAMETRE_RELANCE"));
    assert.ok(codes.includes("PARAMETRES_SEUILS"));
    const rangs = liste.map((alerte) => ({ URGENT: 0, ATTENTION: 1, INFO: 2 })[alerte.gravite]);
    assert.deepEqual(rangs, [...rangs].sort((a, b) => a - b));
  });
});
