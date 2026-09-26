import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { preparerBaseEssai } from "@/test/base-essai";
import { pointsACompleter, type FaitsCompletude } from "./completude";
import { avertissementsTransition, messageAvertissement, transitionsPossibles, verifierTransition, type FaitsDossier } from "./regles";

preparerBaseEssai();
process.env.UPLOADS_DIR = mkdtempSync(path.join(tmpdir(), "coverswap-uploads-"));
process.env.META_PIXEL_ID = "";
process.env.META_ACCESS_TOKEN = "";

const FAITS: FaitsDossier = {
  etape: "QUALIFICATION",
  clientNom: "Claire Fontaine",
  clientAdresse: "",
  clientCp: "34970",
  clientVille: "Lattes",
  clientTelephone: "",
  objet: "Façades de cuisine",
  nbPhotos: 0,
  dateChantier: null,
  aDevisGenere: false,
  aFactureGeneree: false,
  acompteEnregistre: false,
  soldeEncaisse: false,
};

describe("règles d'étape : signaler, jamais bloquer", () => {
  test("toute étape vers toute autre ; le chemin habituel reste suggéré", () => {
    const depuisDevis = transitionsPossibles("DEVIS_ENVOYE", null);
    assert.equal(depuisDevis.length, 10, "les dix autres étapes");
    assert.deepEqual(
      depuisDevis.filter((transition) => transition.suggeree).map((transition) => transition.vers),
      ["RELANCE", "SIGNE", "PERDU", "EN_PAUSE"]
    );
    assert.equal(depuisDevis.find((transition) => transition.vers === "QUALIFICATION")?.nature, "RETOUR");
    assert.equal(depuisDevis.find((transition) => transition.vers === "FACTURE")?.nature, "SUIVANTE");
    const depuisEncaisse = transitionsPossibles("ENCAISSE", null);
    assert.ok(depuisEncaisse.some((transition) => transition.vers === "PERDU" && !transition.suggeree), "même un dossier encaissé peut sortir");
    const depuisPause = transitionsPossibles("EN_PAUSE", "SIGNE");
    assert.equal(depuisPause.find((transition) => transition.vers === "CHANTIER")?.nature, "REPRISE");
    assert.ok(depuisPause.find((transition) => transition.vers === "SIGNE")?.suggeree);
  });

  test("sauter des étapes rappelle ce que chacune suppose ; seul le passage à la même étape est refusé", () => {
    const verification = verifierTransition(FAITS, "PLANIFIE", {}, null);
    assert.equal(verification.ok, true);
    assert.deepEqual(
      verification.ok ? verification.avertissements.map((avertissement) => avertissement.message) : [],
      ["Aucun devis n'a été généré ni enregistré pour ce dossier.", "Le bon pour accord n'est pas confirmé.", "Aucun acompte enregistré.", "Pas de date de chantier."]
    );
    assert.equal(messageAvertissement("COORDONNEES_COMPLETES", FAITS), "Il manque l'adresse et le téléphone du client.");
    // Ce qui est apporté au passage lève l'avertissement correspondant.
    const apporte = avertissementsTransition(FAITS, "PLANIFIE", { dateChantier: "2026-07-10", sansAcompte: { motif: "PETIT_MONTANT" }, confirmations: { BON_POUR_ACCORD: true } });
    assert.ok(!apporte.some((avertissement) => ["DATE_CHANTIER", "ACOMPTE_ENCAISSE", "BON_POUR_ACCORD"].includes(avertissement.critere)));
    assert.deepEqual(avertissementsTransition({ ...FAITS, etape: "FACTURE" }, "CHANTIER"), [], "un retour ne rappelle rien");
    assert.deepEqual(avertissementsTransition(FAITS, "PERDU").map((avertissement) => avertissement.critere), ["MOTIF_PERTE"]);
    assert.deepEqual(
      avertissementsTransition({ ...FAITS, etape: "CHANTIER" }, "ENCAISSE").map((avertissement) => avertissement.critere),
      ["FACTURE_GENEREE"],
      "sans facture, le solde ne s'ajoute pas"
    );
    assert.deepEqual(avertissementsTransition({ ...FAITS, etape: "FACTURE" }, "ENCAISSE").map((avertissement) => avertissement.message), ["Aucune facture à régler dans ce dossier."]);
    assert.equal(verifierTransition(FAITS, "QUALIFICATION", {}, null).ok, false);
  });

  test("points à compléter selon l'étape ; un dossier perdu ne réclame que son motif", () => {
    const faits: FaitsCompletude = {
      etape: "FACTURE",
      etapeAvantSortie: null,
      clientId: "client",
      clientAdresse: "3 rue du Port",
      clientCp: "",
      clientVille: "Pérols",
      clientTelephone: "06 12 34 56 78",
      objet: "",
      source: "INCONNUE",
      nbPhotos: 0,
      dateChantier: null,
      nbDevis: 1,
      nbFactures: 0,
      nbPaiements: 0,
      sansAcompteMotive: false,
      resteDu: 0,
      motifPerte: null,
      nbDatesInconnues: 2,
    };
    assert.deepEqual(
      pointsACompleter(faits).map((point) => point.code),
      ["ADRESSE", "OBJET", "PHOTO", "SOURCE", "ACOMPTE", "DATE_CHANTIER", "FACTURE", "DATES_ETAPES"]
    );
    assert.equal(pointsACompleter(faits)[0].libelle, "Adresse du chantier (code postal)");
    assert.deepEqual(pointsACompleter({ ...faits, etape: "PERDU" }).map((point) => point.code), ["MOTIF_PERTE"]);
    assert.deepEqual(
      pointsACompleter({ ...faits, etape: "EN_PAUSE", etapeAvantSortie: "DEVIS_ENVOYE", nbDevis: 0 }).map((point) => point.code),
      ["ADRESSE", "OBJET", "PHOTO", "SOURCE", "DEVIS", "DATES_ETAPES"]
    );
    const encaisse = pointsACompleter({ ...faits, etape: "ENCAISSE", nbFactures: 1, nbPaiements: 1, resteDu: 120, dateChantier: "2026-07-01" });
    assert.equal(encaisse.find((point) => point.code === "SOLDE")?.libelle, "Encaissé, mais 120,00 € restent dus sur les factures");
  });
});

let prisma: typeof import("@/lib/prisma").default;
let avecActeur: typeof import("@/lib/journal/contexte").avecActeur;
let dossiers: typeof import("./dossiers");
let transitions: typeof import("./transitions");
let documents: typeof import("./documents");
const LUCAS = { acteur: "HUMAIN:lucas@coverswap.fr" };
const photo = () => new File([Buffer.from([0xff, 0xd8, 0xff, 0xd9])], "chantier.jpg", { type: "image/jpeg" });

before(async () => {
  prisma = (await import("@/lib/prisma")).default;
  avecActeur = (await import("@/lib/journal/contexte")).avecActeur;
  dossiers = await import("./dossiers");
  transitions = await import("./transitions");
  documents = await import("./documents");
  await (await import("@/lib/base/preparation")).preparerBase();
});

after(async () => {
  await prisma.$disconnect();
});

describe("dossiers souples", () => {
  let dossierId: string;

  test("ouvert avec le seul nom, directement en « Chantier » ; ce qui manque est signalé", async () => {
    const entree = dossiers.schemaCreation.parse({ clientNom: "Chantier Martin", etape: "CHANTIER" });
    dossierId = await avecActeur(LUCAS, () => dossiers.creerDossier(entree, []));

    const detail = await dossiers.chargerDetail(dossierId);
    assert.equal(detail.etape, "CHANTIER");
    assert.equal(detail.source, "INCONNUE");
    assert.equal(detail.clientTelephone, "");
    assert.ok(detail.client, "une fiche client est créée depuis le nom");
    const ouverture = await prisma.dossierEvenement.findFirstOrThrow({ where: { dossierId, type: "CHANGEMENT_ETAPE" } });
    assert.equal(ouverture.contenu, "Dossier ouvert : Chantier");
    assert.deepEqual(
      detail.completude.map((point) => point.code),
      ["TELEPHONE", "ADRESSE", "OBJET", "PHOTO", "SOURCE", "DEVIS", "ACOMPTE", "DATE_CHANTIER"]
    );
    const liste = await dossiers.listerDossiers();
    assert.equal(liste.find((dossier) => dossier.id === dossierId)?.aCompleter, 8);
  });

  test("ouvert depuis une fiche client, le contact entrant sans dossier en devient l'origine", async () => {
    const client = await avecActeur(LUCAS, () => prisma.client.create({ data: { nom: "Nina Origine", source: "META_ADS", premierContactLe: new Date() } }));
    const ancien = await avecActeur(LUCAS, () =>
      prisma.lead.create({ data: { nom: "Origine", prenom: "Nina", telephone: "0611111111", ville: "Sète", source: "META_ADS", clientId: client.id, createdAt: new Date("2026-05-01") } })
    );
    const recent = await avecActeur(LUCAS, () =>
      prisma.lead.create({ data: { nom: "Origine", prenom: "Nina", telephone: "0611111111", ville: "Sète", source: "SITE_DEVIS", clientId: client.id } })
    );
    const entree = dossiers.schemaCreation.parse({ clientNom: "Nina Origine", clientId: client.id });
    const id = await avecActeur(LUCAS, () => dossiers.creerDossier(entree, []));
    const cree = await prisma.dossier.findUniqueOrThrow({ where: { id } });
    assert.equal(cree.leadId, recent.id, "le contact le plus récent sans dossier");
    assert.equal((await prisma.lead.findUniqueOrThrow({ where: { id: recent.id } })).statut, "CONTACTE");

    const second = await avecActeur(LUCAS, () => dossiers.creerDossier(dossiers.schemaCreation.parse({ clientNom: "Nina Origine", clientId: client.id }), []));
    assert.equal((await prisma.dossier.findUniqueOrThrow({ where: { id: second } })).leadId, ancien.id, "puis le suivant sans dossier");
    const troisieme = await avecActeur(LUCAS, () => dossiers.creerDossier(dossiers.schemaCreation.parse({ clientNom: "Nina Origine", clientId: client.id }), []));
    assert.equal((await prisma.dossier.findUniqueOrThrow({ where: { id: troisieme } })).leadId, null, "plus de contact libre : rien d'inventé");
  });

  test("entreprise déclarée à l'ouverture : fiche pro avec raison sociale et SIRET ; même SIRET, même fiche", async () => {
    const ouvrir = (donnees: Record<string, unknown>) => avecActeur(LUCAS, () => dossiers.creerDossier(dossiers.schemaCreation.parse(donnees), []));
    const ficheDu = async (dossierId: string) => {
      const { clientId } = await prisma.dossier.findUniqueOrThrow({ where: { id: dossierId } });
      return prisma.client.findUniqueOrThrow({ where: { id: clientId! } });
    };

    const tilleuls = await ficheDu(await ouvrir({ clientNom: "SARL Les Tilleuls", clientCategorie: "PROFESSIONNEL", clientSiret: "732 829 320 00074", objet: "Comptoir" }));
    assert.deepEqual([tilleuls.categorie, tilleuls.nom, tilleuls.raisonSociale, tilleuls.siret], ["PROFESSIONNEL", "SARL Les Tilleuls", "SARL Les Tilleuls", "73282932000074"]);
    assert.equal((await ficheDu(await ouvrir({ clientNom: "Les Tilleuls, second site", clientCategorie: "PROFESSIONNEL", clientSiret: "73282932000074" }))).id, tilleuls.id, "même SIRET, même fiche");

    const donneur = await ficheDu(await ouvrir({ clientNom: "Cuisines Martin", clientCategorie: "DONNEUR_ORDRE" }));
    assert.deepEqual([donneur.categorie, donneur.raisonSociale, donneur.siret], ["DONNEUR_ORDRE", "Cuisines Martin", null]);

    const particulier = await ficheDu(await ouvrir({ clientNom: "Jeanne Dupuis", clientCategorie: "PARTICULIER", clientSiret: "73282932000074" }));
    assert.notEqual(particulier.id, tilleuls.id, "un particulier ne reprend pas le SIRET d'une entreprise");
    assert.deepEqual([particulier.categorie, particulier.raisonSociale, particulier.siret], ["PARTICULIER", null, null]);

    assert.equal((await ficheDu(await ouvrir({ clientNom: "Sans type déclaré", source: "SOUS_TRAITANCE" }))).categorie, "DONNEUR_ORDRE", "sans choix, la source décide comme avant");
    assert.throws(() => dossiers.schemaCreation.parse({ clientNom: "Faute", clientCategorie: "PROFESSIONNEL", clientSiret: "732 829" }), /14 chiffres/);
  });

  test("toute étape vers toute autre, dans les deux sens ; l'événement garde ce qui manquait", async () => {
    await avecActeur(LUCAS, () => transitions.changerEtape(dossierId, { vers: "QUALIFICATION" }));
    const vers = await avecActeur(LUCAS, () => transitions.changerEtape(dossierId, { vers: "FACTURE", dateChantier: "2026-07-20" }));
    assert.equal(vers.nature, "SUIVANTE");
    assert.deepEqual(vers.avertissements, [
      "Aucun devis n'a été généré ni enregistré pour ce dossier.",
      "Le bon pour accord n'est pas confirmé.",
      "Aucun acompte enregistré.",
      "Aucune facture n'a été générée ni enregistrée pour ce dossier.",
    ]);
    const passage = await prisma.dossierEvenement.findFirstOrThrow({ where: { dossierId, type: "CHANGEMENT_ETAPE" }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
    assert.match(passage.contenu, /^Qualification → Facturé\. Passé en connaissance de cause : aucun devis n'a été généré ni enregistré/);
    assert.equal(JSON.parse(passage.metadata).avertissements.length, 4);

    // Mission 12 : la perte exige un motif ; sans lui, rien ne bouge.
    await assert.rejects(avecActeur(LUCAS, () => transitions.changerEtape(dossierId, { vers: "PERDU" })), /Motif de perte obligatoire/);
    await avecActeur(LUCAS, () => transitions.changerEtape(dossierId, { vers: "PERDU", motifPerte: "SANS_REPONSE" }));
    const perdu = await prisma.dossier.findUniqueOrThrow({ where: { id: dossierId } });
    assert.equal(perdu.motifPerte, "SANS_REPONSE");
    assert.deepEqual((await dossiers.chargerDetail(dossierId)).completude.map((point) => point.code), []);

    const reprise = await avecActeur(LUCAS, () => transitions.changerEtape(dossierId, { vers: "ENCAISSE" }));
    assert.equal(reprise.nature, "REPRISE");
    await assert.rejects(avecActeur(LUCAS, () => transitions.changerEtape(dossierId, { vers: "ENCAISSE" })), /déjà à l'étape « Encaissé »/);
  });

  test("tout se modifie : date de chantier vidée, dernière photo retirée, fiche client changée avec ses pièces et paiements", async () => {
    const { ajouterPhoto, modifierDossier, supprimerPhoto } = dossiers;
    await avecActeur(LUCAS, () => modifierDossier(dossierId, dossiers.schemaModification.parse({ dateChantier: null, clientTelephone: "", source: null })));
    const modifie = await prisma.dossier.findUniqueOrThrow({ where: { id: dossierId } });
    assert.equal(modifie.dateChantier, null);
    assert.equal(modifie.source, "INCONNUE");

    const ajoutee = await avecActeur(LUCAS, () => ajouterPhoto(dossierId, photo()));
    await avecActeur(LUCAS, () => supprimerPhoto(dossierId, ajoutee.id));
    assert.equal((await dossiers.chargerDetail(dossierId)).photos.length, 0);

    const { document: devis } = await avecActeur(LUCAS, () =>
      documents.genererDocument(dossierId, {
        type: "DEVIS",
        objet: "Façades",
        lignes: [{ type: "PRESTATION", designation: "Revêtement adhésif", sousDesignation: undefined, quantite: 2, unite: "ml", prixUnitaire: 110 }],
        noteMl: true,
        acomptePct: 30,
        remplaceDocumentId: null,
      })
    );
    assert.ok(devis.numero, "un devis se génère sur un dossier encaissé");
    const { enregistrerEncaissement } = await import("@/lib/encaissements/service");
    await avecActeur(LUCAS, () => enregistrerEncaissement({ dossierId, paiement: { montant: 66, moyen: null, recuLe: "2026-06-02", reference: null } }));

    const autreFiche = await prisma.client.create({ data: { nom: "SCI Les Pins", categorie: "PROFESSIONNEL", raisonSociale: "SCI Les Pins", source: "INCONNUE", premierContactLe: new Date() } });
    await avecActeur(LUCAS, () => modifierDossier(dossierId, { clientId: autreFiche.id }));
    const detail = await dossiers.chargerDetail(dossierId);
    assert.deepEqual(detail.client, { id: autreFiche.id, nom: "SCI Les Pins" });
    assert.equal((await prisma.document.findUniqueOrThrow({ where: { id: devis.id } })).clientId, autreFiche.id);
    assert.equal(await prisma.encaissement.count({ where: { dossierId, clientId: autreFiche.id } }), 1);
    assert.ok(detail.evenements.some((evenement) => /rattaché à la fiche client « SCI Les Pins »/.test(evenement.contenu)));
  });
});
