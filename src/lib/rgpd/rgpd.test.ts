import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { preparerBaseEssai } from "@/test/base-essai";

preparerBaseEssai();
const UPLOADS = mkdtempSync(path.join(tmpdir(), "coverswap-uploads-"));
process.env.UPLOADS_DIR = UPLOADS;
process.env.META_PIXEL_ID = "";
process.env.META_ACCESS_TOKEN = "";

let prisma: typeof import("@/lib/prisma").default;
let avecActeur: typeof import("@/lib/journal/contexte").avecActeur;
let carte: typeof import("./carte");
let anonymisation: typeof import("./anonymisation");
let conservation: typeof import("./conservation");
let effacement: typeof import("./effacement");
let validation: typeof import("@/lib/validation/service");
let parametres: typeof import("@/lib/parametres/service");
let dossiers: typeof import("@/lib/dossiers/dossiers");

const LUCAS = { acteur: "HUMAIN:lucas@coverswap.fr", origine: "POST /api/clients/[id]/anonymisation" };
const AGENT = { acteur: "AGENT:mail" };
const IDENTITE = ["Bérénice", "Lefèvre", "berenice.lefevre", "0611223344", "+33611223344", "06 11 22 33 44", "code portail 4821", "rue des Glycines"];

const photo = (contenu: string) => new File([Buffer.from(contenu)], "photo.jpg", { type: "image/jpeg" });
const ecrireFichier = (relatif: string, contenu = "octets") => {
  const complet = path.join(UPLOADS, relatif);
  mkdirSync(path.dirname(complet), { recursive: true });
  writeFileSync(complet, contenu);
};

/** Toute ligne de la base (journal compris) qui contient encore un fragment d'identité, hors pièces comptables. */
async function tracesIdentite(): Promise<string[]> {
  const tables = await prisma.$queryRawUnsafe<{ name: string }[]>(`SELECT "name" FROM "sqlite_master" WHERE "type" = 'table' AND "name" NOT LIKE 'sqlite_%' AND "name" NOT LIKE '_prisma%'`);
  const permis = new Set(["Document", "Encaissement", "NumeroDocument"]);
  const traces: string[] = [];
  for (const { name } of tables) {
    const lignes = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(`SELECT * FROM "${name}"`);
    for (const ligne of lignes) {
      const texte = JSON.stringify(ligne, (_cle, valeur) => (typeof valeur === "bigint" ? Number(valeur) : valeur));
      const trouve = IDENTITE.find((fragment) => texte.includes(fragment));
      if (!trouve) continue;
      const modele = name === "JournalModification" ? String(ligne.modele) : name;
      // Pièces comptables : l'identité y reste (facture, payeur) ; une note libre, non.
      if (permis.has(modele) && !texte.includes("Virement de Bérénice")) continue;
      traces.push(`${name}${name === "JournalModification" ? `(${modele})` : ""} : « ${trouve} »`);
    }
  }
  return traces;
}

before(async () => {
  prisma = (await import("@/lib/prisma")).default;
  avecActeur = (await import("@/lib/journal/contexte")).avecActeur;
  carte = await import("./carte");
  anonymisation = await import("./anonymisation");
  conservation = await import("./conservation");
  effacement = await import("./effacement");
  validation = await import("@/lib/validation/service");
  parametres = await import("@/lib/parametres/service");
  dossiers = await import("@/lib/dossiers/dossiers");
  await (await import("@/lib/base/preparation")).preparerBase();
});

after(async () => {
  await prisma.$disconnect();
});

describe("carte des données personnelles", () => {
  test("tout modèle rattaché à une personne y figure (un modèle ajouté demain ne garde rien en silence)", async () => {
    const { Prisma } = await import("@prisma/client");
    const oublies = Prisma.dmmf.datamodel.models
      .filter((modele) => modele.fields.some((champ) => champ.kind === "scalar" && (carte.LIENS_PERSONNELS as readonly string[]).includes(champ.name)))
      .map((modele) => modele.name)
      .filter((nom) => !(nom in carte.CARTE_DONNEES_PERSONNELLES));
    assert.deepEqual(oublies, []);
    // Et chaque champ remplacé existe bien dans son modèle.
    for (const [nom, regle] of Object.entries(carte.CARTE_DONNEES_PERSONNELLES)) {
      if (!("remplacer" in regle)) continue;
      const modele = Prisma.dmmf.datamodel.models.find((candidat) => candidat.name === nom);
      assert.ok(modele, `modèle ${nom}`);
      const champs = Object.keys(regle.remplacer({ type: "NOTE_AJOUTEE", id: "x", emailType: "NOMINATIF", contenuValide: "{}" }, { pseudonyme: "ABCD", leadsAvecFactures: new Set() }));
      for (const champ of champs) assert.ok(modele.fields.some((candidat) => candidat.name === champ), `${nom}.${champ}`);
    }
  });
});

describe("anonymisation d'un client", () => {
  let clientId: string;
  let dossierId: string;
  let autreClientId: string;
  let facturePdf: string;
  let pieceChemin: string;
  let simulationChemin: string;
  let photoArchivee: string;

  test("préparation : un client complet (lead, dossier, photos, mail, encaissement, facture émise)", async () => {
    await avecActeur(LUCAS, async () => {
      const client = await prisma.client.create({
        data: { nom: "Bérénice Lefèvre", prenom: "Bérénice", nomFamille: "Lefèvre", adresse: "12 rue des Glycines", codePostal: "34970", ville: "Lattes", source: "SITE_DEVIS", notes: "Chien, code portail 4821", premierContactLe: new Date() },
      });
      clientId = client.id;
      await prisma.clientEmail.create({ data: { clientId, adresse: "berenice.lefevre@exemple.test", principale: true } });
      await prisma.clientTelephone.create({ data: { clientId, numero: "+33611223344", saisi: "06 11 22 33 44", principal: true } });
      const lead = await prisma.lead.create({ data: { nom: "Lefèvre", prenom: "Bérénice", email: "berenice.lefevre@exemple.test", telephone: "06 11 22 33 44", ville: "Lattes", clientId, notes: "Rappeler après 18 h, code portail 4821" } });
      await prisma.interaction.create({ data: { leadId: lead.id, type: "NOTE", contenu: "Appel de Bérénice Lefèvre" } });
      const simulation = await prisma.simulation.create({ data: { leadId: lead.id, notes: "Bérénice aime le chêne" } });
      simulationChemin = `${lead.id}/${simulation.id}/before.jpg`;
      ecrireFichier(simulationChemin);
      await prisma.simulation.update({ where: { id: simulation.id }, data: { imageBeforePath: simulationChemin } });

      dossierId = await dossiers.creerDossier(
        { clientNom: "Bérénice Lefèvre", clientAdresse: "12 rue des Glycines", clientCp: "34970", clientVille: "Lattes", clientTelephone: "06 11 22 33 44", clientEmail: "berenice.lefevre@exemple.test", objet: "Cuisine", source: "ENTRANT", montantEstime: 3000, prochaineAction: "Rappeler Bérénice", prochaineActionDate: null, leadId: null, prospectId: null, clientId },
        [photo("cuisine-1"), photo("cuisine-2")]
      );
      await prisma.$transaction((tx) => dossiers.ecrireNote(tx, dossierId, { etape: "QUALIFICATION", contenu: "Bérénice préfère le matin" }));
      // Une photo retirée plus tôt : aux archives du volume, à effacer aussi.
      const { archiverFichier, lirePhotos } = await import("@/lib/dossiers/stockage");
      const [premiere, ...autres] = lirePhotos((await prisma.dossier.findUniqueOrThrow({ where: { id: dossierId } })).photos);
      await archiverFichier(premiere, "photo-retiree");
      photoArchivee = premiere;
      await prisma.dossier.update({ where: { id: dossierId }, data: { photos: JSON.stringify(autres), etape: "ENCAISSE" } });
      await prisma.dossierEvenement.create({ data: { dossierId, type: "CHANGEMENT_ETAPE", direction: "INTERNE", contenu: "Dossier encaissé", metadata: JSON.stringify({ de: "FACTURE", vers: "ENCAISSE", raison: "Bérénice a tout réglé" }) } });

      facturePdf = `dossiers/${dossierId}/documents/FACTURE-F-2026-0001.pdf`;
      ecrireFichier(facturePdf, "%PDF facture Bérénice Lefèvre");
      await prisma.document.create({
        data: { dossierId, clientId, type: "FACTURE", numero: "F-2026-0001", dateEmission: new Date(), objet: "Cuisine", lignes: "[]", totalHt: 3000, statut: "GENERE", pdfPath: facturePdf, destinataire: JSON.stringify({ nom: "Bérénice Lefèvre", adresse: "12 rue des Glycines" }) },
      });
      await prisma.encaissement.create({ data: { clientId, dossierId, payeur: "Bérénice Lefèvre", montant: 3000, moyen: "VIREMENT", recuLe: new Date(), note: "Virement de Bérénice" } });

      const message = await prisma.message.create({
        data: { canal: "EMAIL", compte: "boite@coverswap.test", identifiantCanal: "gmail-berenice-1", sens: "ENTRANT", de: "berenice.lefevre@exemple.test", deNom: "Bérénice Lefèvre", objet: "Photos de ma cuisine", extrait: "Bonjour, Bérénice…", recuLe: new Date(), statut: "RATTACHE", clientId, dossierId },
      });
      await prisma.contenuMessage.create({ data: { messageId: message.id, texte: "Bonjour, c'est Bérénice Lefèvre, code portail 4821.", entetes: JSON.stringify({ "message-id": "<b1@exemple.test>" }) } });
      const { enregistrerFichier } = await import("@/lib/fichiers/stockage");
      const fichier = await enregistrerFichier("messages", new File([Buffer.from("photo jointe")], "maison-berenice.jpg", { type: "image/jpeg" }));
      pieceChemin = fichier.chemin;
      await prisma.pieceMessage.create({ data: { messageId: message.id, rang: 1, nom: "maison-berenice.jpg", typeMime: "image/jpeg", taille: 12, partie: "1", statut: "CONSERVEE", fichierId: fichier.id } });
      await prisma.analyseMessage.create({ data: { messageId: message.id, methode: "MODELE", raisonnement: "Bérénice Lefèvre envoie des photos", resultat: JSON.stringify({ contact: { prenom: "Bérénice" } }) } });
      await prisma.miroirDrive.create({ data: { cle: `photo:${dossierId}:abc`, nom: "Photo 01.jpg", driveId: "drive-1", etat: "A_JOUR" } });
    });
    await avecActeur(AGENT, () =>
      validation.proposer({ type: "NOTE_DOSSIER", titre: "Noter ce que dit Bérénice Lefèvre", contenu: { dossierId, texte: "Bérénice veut du chêne" }, dossierId, clientId })
    );
    autreClientId = (await prisma.client.create({ data: { nom: "Zoé Tartempion", source: "AUTRE", premierContactLe: new Date() } })).id;
  });

  test("aperçu : ce qui part, ce qui reste, ce qui est à faire à la main ; un dossier en cours bloque", async () => {
    // Le balayage voit bien l'identité avant l'anonymisation (sinon le test final ne prouverait rien).
    const avant = await tracesIdentite();
    for (const attendu of ["Client", "JournalModification(Client)", "Lead", "Dossier", "ContenuMessage", "AnalyseMessage", "Proposition", "JournalModification(Encaissement)"]) {
      assert.ok(avant.some((trace) => trace.startsWith(`${attendu} :`)), `trace attendue dans ${attendu}`);
    }
    const apercu = await anonymisation.apercuAnonymisation(clientId);
    assert.deepEqual(apercu.bloquants, []);
    assert.deepEqual(apercu.adresses, ["berenice.lefevre@exemple.test"]);
    assert.equal(apercu.garde.documentsEmis, 1);
    assert.equal(apercu.garde.encaissements, 1);
    assert.equal(apercu.efface.mails, 1);

    await prisma.dossier.update({ where: { id: dossierId }, data: { etape: "CHANTIER" } });
    const bloque = await anonymisation.apercuAnonymisation(clientId);
    assert.match(bloque.bloquants[0], /Dossier en cours : « Cuisine »/);
    await assert.rejects(() => avecActeur(LUCAS, () => conservation.anonymiserClient(clientId, { motif: "DEMANDE_PERSONNE", commentaire: null, confirmation: true })), /Anonymisation impossible/);
    await prisma.dossier.update({ where: { id: dossierId }, data: { etape: "ENCAISSE" } });
  });

  test("un agent ne peut pas anonymiser : seule une personne décide", async () => {
    await assert.rejects(() => avecActeur(AGENT, () => conservation.anonymiserClient(clientId, { motif: "DEMANDE_PERSONNE", commentaire: null, confirmation: true })), /Seule une personne/);
    assert.equal((await prisma.client.findUniqueOrThrow({ where: { id: clientId } })).anonymiseLe, null);
  });

  test("anonymisée : plus aucune trace d'identité nulle part, journal compris, hors pièces comptables", async () => {
    const vue = await avecActeur(LUCAS, () => conservation.anonymiserClient(clientId, { motif: "DEMANDE_PERSONNE", commentaire: "Mail du 16/09", confirmation: true }));
    assert.equal(vue.statut, "EXECUTEE");

    const client = await prisma.client.findUniqueOrThrow({ where: { id: clientId } });
    assert.match(client.nom, /^Client anonymisé · [0-9A-Z]{4}$/);
    assert.ok(client.anonymiseLe && client.archiveLe);

    // Balayage de toute la base : le nom, l'adresse, le téléphone ne restent que dans les pièces comptables.
    assert.deepEqual(await tracesIdentite(), []);

    // Pièces comptables intactes : facture (identité imprimée), paiement (payeur), PDF.
    const facture = await prisma.document.findFirstOrThrow({ where: { numero: "F-2026-0001" } });
    assert.match(facture.destinataire ?? "", /Bérénice Lefèvre/);
    const encaissement = await prisma.encaissement.findFirstOrThrow({ where: { dossierId } });
    assert.deepEqual([encaissement.payeur, encaissement.note], ["Bérénice Lefèvre", null]);
    assert.ok(existsSync(path.join(UPLOADS, facturePdf)));

    // Proposition de l'agent devenue sans objet, anonymisée ; client sans lien avec l'affaire intact.
    const note = await prisma.proposition.findFirstOrThrow({ where: { type: "NOTE_DOSSIER", dossierId } });
    assert.deepEqual([note.statut, note.titre], ["ANNULEE", "Proposition anonymisée (RGPD)"]);
    assert.equal(validation.vueProposition(note).liens.length, 0);
    assert.equal((await prisma.client.findUniqueOrThrow({ where: { id: autreClientId } })).nom, "Zoé Tartempion");

    // Structure gardée : étapes et motifs du parcours, sans texte libre.
    const changement = await prisma.dossierEvenement.findFirstOrThrow({ where: { dossierId, type: "CHANGEMENT_ETAPE", contenu: "Dossier encaissé" } });
    assert.deepEqual(JSON.parse(changement.metadata), { de: "FACTURE", vers: "ENCAISSE" });
    // Drive : les copies des photos seront neutralisées par le miroir, jamais supprimées.
    assert.equal((await prisma.miroirDrive.findFirstOrThrow({ where: { cle: `photo:${dossierId}:abc` } })).etat, "A_NEUTRALISER");
    // Une fiche anonymisée ne se modifie plus.
    const { modifierClient } = await import("@/lib/clients/fiches");
    await assert.rejects(() => avecActeur(LUCAS, () => modifierClient(clientId, { notes: "retour" })), /anonymisée/);
    await assert.rejects(() => avecActeur(LUCAS, () => conservation.anonymiserClient(clientId, { motif: "AUTRE", commentaire: "encore", confirmation: true })), /sans objet|déjà anonymisée/);
  });

  test("fichiers : photos (archives comprises), pièces jointes et images effacées ; le PDF de la facture reste", async () => {
    const tache = await prisma.tache.findUniqueOrThrow({ where: { cle: `rgpd-effacement:${clientId}` } });
    const charge = JSON.parse(tache.charge) as import("./effacement").ChargeEffacement;
    assert.ok(charge.chemins.length >= 3);
    const archives = path.join(UPLOADS, "archives");
    assert.ok(existsSync(archives));
    const bilan = await effacement.effacerFichiersAnonymises(charge);
    assert.ok(bilan.effaces >= 4, `effacés : ${bilan.effaces}`);
    assert.equal(existsSync(path.join(UPLOADS, pieceChemin)), false);
    assert.equal(existsSync(path.join(UPLOADS, simulationChemin)), false);
    assert.equal(existsSync(path.join(UPLOADS, photoArchivee)), false);
    const { readdirSync } = await import("node:fs");
    const restes = readdirSync(archives, { recursive: true }).map(String).filter((chemin) => chemin.includes(dossierId) && /\.(jpg|jpeg|png)$/.test(chemin));
    assert.deepEqual(restes, []);
    assert.ok(existsSync(path.join(UPLOADS, facturePdf)));
    // Rejouable.
    assert.deepEqual(await effacement.effacerFichiersAnonymises(charge), { effaces: 0 });
  });
});

describe("durées de conservation", () => {
  test("sans durée réglée, rien n'est proposé ; ensuite, l'anonymisation d'un contact ancien est proposée, jamais faite", async () => {
    const maintenant = new Date();
    assert.deepEqual(await conservation.proposerAnonymisations(maintenant), { proposees: 0, dejaProposees: 0, parametresManquants: true });

    const ancien = await prisma.client.create({ data: { nom: "Contact Ancien", source: "AUTRE", premierContactLe: new Date(maintenant.getTime() - 4 * 365 * 24 * 3600_000) } });
    const vieux = maintenant.getTime() - 4 * 365 * 24 * 3600_000;
    await prisma.$executeRawUnsafe(`UPDATE "Client" SET "updatedAt" = ? WHERE "id" = ?`, vieux, ancien.id);
    const recent = await prisma.client.create({ data: { nom: "Contact Récent", source: "AUTRE", premierContactLe: new Date() } });
    const enCours = await prisma.client.create({ data: { nom: "Client En Cours", source: "AUTRE", premierContactLe: new Date(vieux) } });
    await prisma.$executeRawUnsafe(`UPDATE "Client" SET "updatedAt" = ? WHERE "id" = ?`, vieux, enCours.id);
    const dossier = await prisma.dossier.create({ data: { clientId: enCours.id, clientNom: "Client En Cours", clientAdresse: "1 rue", clientCp: "34000", clientVille: "Montpellier", clientTelephone: "0600000000", objet: "Salle de bain", source: "ENTRANT", etape: "DEVIS_ENVOYE" } });
    await prisma.$executeRawUnsafe(`UPDATE "Dossier" SET "updatedAt" = ? WHERE "id" = ?`, vieux, dossier.id);

    for (const [cle, valeur] of [["RGPD_CONSERVATION_PROSPECTS", 36], ["RGPD_CONSERVATION_CLIENTS", 60]] as const) {
      await avecActeur(LUCAS, () => parametres.enregistrerParametre({ cle, valeur, valableDu: new Date(maintenant.getTime() - 1000), source: "essai" }));
    }
    const bilan = await conservation.proposerAnonymisations(maintenant);
    assert.equal(bilan.proposees, 1);
    const proposition = await prisma.proposition.findFirstOrThrow({ where: { type: "ANONYMISATION_CLIENT", clientId: ancien.id } });
    assert.equal(proposition.statut, "EN_ATTENTE");
    assert.equal(proposition.titre.includes("Contact Ancien"), false, "aucun nom dans le titre");
    assert.equal(validation.vueProposition(proposition).sensible, true);
    assert.equal(await prisma.proposition.count({ where: { type: "ANONYMISATION_CLIENT", clientId: { in: [recent.id, enCours.id] } } }), 0);
    assert.equal((await conservation.proposerAnonymisations(maintenant)).dejaProposees, 1);
    const lot = await avecActeur(LUCAS, () => validation.validerEnLot([proposition.id]));
    assert.deepEqual(lot.validees, []);
  });
});
