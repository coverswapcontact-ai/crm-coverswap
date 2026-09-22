import prisma, { type Transaction } from "@/lib/prisma";
import { ErreurMetier } from "@/lib/commun/erreurs";
import { formaterTelephone, normaliserTelephone } from "@/lib/clients/normalisation";
import { lirePhotos } from "@/lib/dossiers/stockage";
import { ARCHIVE_A_NEUTRALISER, A_NEUTRALISER } from "@/lib/drive/synchronisation";
import { AVEC_ARCHIVES } from "@/lib/journal/extension";
import { pseudonyme } from "@/lib/synthese/references";
import { mettreEnFile } from "@/lib/taches/file";
import { CARTE_DONNEES_PERSONNELLES, type ContexteAnonymisation, EFFACE } from "./carte";

/**
 * Anonymisation d'un client (RGPD) : toutes les données qui l'identifient
 * sont remplacées, dans les lignes et dans leurs copies du journal
 * (caviardage) ; les photos et pièces jointes sont effacées (tâche de fond) ;
 * ce que la loi impose de garder reste : factures et avoirs émis (identité
 * telle qu'imprimée, PDF), paiements (payeur, montant, référence), registre
 * des numéros.
 *
 * C'est la seule exception délibérée à « rien ne se supprime » : décidée par
 * une personne (proposition sensible, jamais exécutée seule), une fois, avec
 * sa trace (la proposition validée, son motif et son bilan).
 */

export const TYPE_TACHE_EFFACEMENT = "EFFACEMENT_RGPD";
const ETAPES_CLOSES = ["ENCAISSE", "PERDU"];

type Perimetre = {
  clientIds: string[];
  lignes: Record<string, Record<string, unknown>[]>;
  dossierIds: string[];
  leadsAvecFactures: Set<string>;
  chemins: string[];
  adresses: string[];
  telephones: string[];
};

async function perimetre(client: Transaction | typeof prisma, clientId: string, propositionEnCours?: string): Promise<Perimetre> {
  // La fiche et celles qui y ont été fusionnées (leurs lignes y ont été rattachées, pas leur identité).
  const clientIds = [clientId];
  for (let index = 0; index < clientIds.length && index < 50; index++) {
    const absorbees = await client.client.findMany({ where: { ...AVEC_ARCHIVES, fusionneDansId: clientIds[index] }, select: { id: true } });
    clientIds.push(...absorbees.map((ligne) => ligne.id).filter((id) => !clientIds.includes(id)));
  }
  const clients = await client.client.findMany({ where: { ...AVEC_ARCHIVES, id: { in: clientIds } } });
  const emails = await client.clientEmail.findMany({ where: { ...AVEC_ARCHIVES, clientId: { in: clientIds } } });
  const telephones = await client.clientTelephone.findMany({ where: { ...AVEC_ARCHIVES, clientId: { in: clientIds } } });

  const leads = await client.lead.findMany({ where: { ...AVEC_ARCHIVES, clientId: { in: clientIds } } });
  const leadIds = leads.map((lead) => lead.id);
  const photosLead = await client.photoLead.findMany({ where: { ...AVEC_ARCHIVES, leadId: { in: leadIds } } });
  const simulationsSite = await client.simulationSite.findMany({ where: { ...AVEC_ARCHIVES, leadId: { in: leadIds } } });
  const [interactions, notesAppel, simulations, devis, chantiers] = await Promise.all([
    client.interaction.findMany({ where: { ...AVEC_ARCHIVES, leadId: { in: leadIds } } }),
    client.noteAppel.findMany({ where: { ...AVEC_ARCHIVES, leadId: { in: leadIds } } }),
    client.simulation.findMany({ where: { ...AVEC_ARCHIVES, leadId: { in: leadIds } } }),
    client.devis.findMany({ where: { leadId: { in: leadIds } }, include: { facture: { select: { id: true } } } }),
    client.chantier.findMany({ where: { ...AVEC_ARCHIVES, leadId: { in: leadIds } } }),
  ]);
  const leadsAvecFactures = new Set(devis.filter((ligne) => ligne.facture).map((ligne) => ligne.leadId));

  const prospects = await client.prospect.findMany({ where: { ...AVEC_ARCHIVES, clientId: { in: clientIds } } });
  const prospectIds = prospects.map((prospect) => prospect.id);
  const [brouillons, activites] = await Promise.all([
    client.emailDraft.findMany({ where: { ...AVEC_ARCHIVES, prospectId: { in: prospectIds } } }),
    client.prospectActivity.findMany({ where: { prospectId: { in: prospectIds } } }),
  ]);

  const dossiers = await client.dossier.findMany({ where: { ...AVEC_ARCHIVES, clientId: { in: clientIds } } });
  const dossierIds = dossiers.map((dossier) => dossier.id);
  const publicationsSite = await client.publicationSite.findMany({ where: { ...AVEC_ARCHIVES, OR: [{ clientId: { in: clientIds } }, { dossierId: { in: dossierIds } }] } });
  const [notes, evenements, encaissements] = await Promise.all([
    client.dossierNote.findMany({ where: { ...AVEC_ARCHIVES, dossierId: { in: dossierIds } } }),
    client.dossierEvenement.findMany({ where: { ...AVEC_ARCHIVES, dossierId: { in: dossierIds } } }),
    client.encaissement.findMany({ where: { OR: [{ clientId: { in: clientIds } }, { dossierId: { in: dossierIds } }] } }),
  ]);

  const messages = await client.message.findMany({ where: { ...AVEC_ARCHIVES, OR: [{ clientId: { in: clientIds } }, { dossierId: { in: dossierIds } }] } });
  const messageIds = messages.map((message) => message.id);
  const [contenus, pieces, analyses] = await Promise.all([
    client.contenuMessage.findMany({ where: { messageId: { in: messageIds } } }),
    client.pieceMessage.findMany({ where: { messageId: { in: messageIds } } }),
    client.analyseMessage.findMany({ where: { messageId: { in: messageIds } } }),
  ]);
  const fichiers = await client.fichier.findMany({ where: { ...AVEC_ARCHIVES, id: { in: pieces.map((piece) => piece.fichierId).filter((id): id is string => Boolean(id)) } } });

  // Messagerie SMS et espace client (mission du 20/09/2026).
  const conversationsSms = await client.conversationSms.findMany({ where: { ...AVEC_ARCHIVES, OR: [{ clientId: { in: clientIds } }, { leadId: { in: leadIds } }] } });
  const sms = await client.sms.findMany({ where: { ...AVEC_ARCHIVES, conversationId: { in: conversationsSms.map((conversation) => conversation.id) } } });
  const espaces = await client.espaceClient.findMany({ where: { ...AVEC_ARCHIVES, dossierId: { in: dossierIds } } });
  // Mission 5 : l'espace permanent du client (ses favoris ; le lien reste, il ne mène plus qu'à des projets anonymisés).
  const espacesPermanents = await client.espacePermanent.findMany({ where: { ...AVEC_ARCHIVES, clientId: { in: clientIds } } });
  const simulationsEspace = await client.simulationEspace.findMany({ where: { ...AVEC_ARCHIVES, dossierId: { in: dossierIds } } });
  const preparations = await client.preparationSimulation.findMany({ where: { ...AVEC_ARCHIVES, dossierId: { in: dossierIds } } });

  const propositions = await client.proposition.findMany({
    where: {
      ...AVEC_ARCHIVES,
      OR: [{ clientId: { in: clientIds } }, { dossierId: { in: dossierIds } }, { messageId: { in: messageIds } }],
      ...(propositionEnCours ? { id: { not: propositionEnCours } } : {}),
    },
  });

  const cheminsLocaux = (valeur: unknown) => lirePhotos(typeof valeur === "string" ? valeur : "[]").filter((chemin) => !/^[a-z]+:\/\//i.test(chemin));
  const chemins = [
    ...dossiers.flatMap((dossier) => lirePhotos(dossier.photos)),
    ...chantiers.flatMap((chantier) => [...cheminsLocaux(chantier.photosAvant), ...cheminsLocaux(chantier.photosApres)]),
    ...photosLead.map((photo) => photo.chemin).filter((chemin) => chemin !== EFFACE),
    ...simulationsSite.flatMap((s) => [s.imageBeforePath, s.imageAfterPath]).filter((chemin): chemin is string => Boolean(chemin)),
    ...simulations.flatMap((simulation) => [simulation.imageBeforePath, simulation.imageAfterPath, simulation.imageOriginalPath]).filter((chemin): chemin is string => Boolean(chemin) && !/^[a-z]+:\/\//i.test(chemin!)),
    ...fichiers.map((fichier) => fichier.chemin),
    ...simulationsEspace.flatMap((simulation) => [simulation.chemin, simulation.photoAvant]).filter((chemin): chemin is string => Boolean(chemin) && chemin !== EFFACE),
    ...preparations.flatMap((p) => [p.photoAvant]).filter((chemin): chemin is string => Boolean(chemin) && chemin !== EFFACE),
  ];

  return {
    clientIds,
    dossierIds,
    leadsAvecFactures,
    chemins: [...new Set(chemins)],
    adresses: [...new Set([...emails.map((ligne) => ligne.adresse), ...leads.map((lead) => lead.email).filter((email): email is string => Boolean(email)), ...messages.filter((m) => m.sens === "ENTRANT").map((m) => m.de)])].filter((adresse) => adresse.includes("@")),
    telephones: [
      ...new Set(
        [...telephones.map((ligne) => ligne.numero), ...leads.map((lead) => lead.telephone)]
          .map((numero) => normaliserTelephone(numero))
          .filter((numero): numero is string => numero !== null)
          .map(formaterTelephone)
      ),
    ],
    lignes: {
      Client: clients,
      ClientEmail: emails,
      ClientTelephone: telephones,
      Lead: leads,
      Interaction: interactions,
      NoteAppel: notesAppel,
      Simulation: simulations,
      PhotoLead: photosLead,
      SimulationSite: simulationsSite,
      PublicationSite: publicationsSite,
      Devis: devis.map((ligne) => Object.fromEntries(Object.entries(ligne).filter(([cle]) => cle !== "facture"))),
      Chantier: chantiers,
      Prospect: prospects,
      EmailDraft: brouillons,
      ProspectActivity: activites,
      Dossier: dossiers,
      DossierNote: notes,
      DossierEvenement: evenements,
      Encaissement: encaissements,
      Message: messages,
      ContenuMessage: contenus,
      PieceMessage: pieces,
      AnalyseMessage: analyses,
      Fichier: fichiers,
      ConversationSms: conversationsSms,
      Sms: sms,
      EspaceClient: espaces,
      EspacePermanent: espacesPermanents,
      SimulationEspace: simulationsEspace,
      PreparationSimulation: preparations,
      Proposition: propositions,
    } as Record<string, Record<string, unknown>[]>,
  };
}

/* ── Aperçu : ce qui part, ce qui reste, ce qui empêche ─────────────── */

export type ApercuAnonymisation = {
  clientId: string;
  reference: string;
  dejaAnonymise: boolean;
  bloquants: string[];
  /** Adresses et numéros à traiter à la main hors du CRM (boîte mail, téléphone) : le CRM ne supprime jamais rien dans Gmail. */
  adresses: string[];
  telephones: string[];
  efface: { dossiers: number; photos: number; mails: number; notes: number; leads: number; propositions: number };
  garde: { documentsEmis: number; encaissements: number };
};

async function bloquantsDe(client: Transaction | typeof prisma, clientId: string, dossierIds: string[]): Promise<string[]> {
  const fiche = await client.client.findUnique({ where: { id: clientId }, select: { anonymiseLe: true, fusionneDansId: true } });
  if (!fiche) throw new ErreurMetier("Client introuvable.", 404);
  const bloquants: string[] = [];
  if (fiche.anonymiseLe) bloquants.push("Fiche déjà anonymisée.");
  if (fiche.fusionneDansId) bloquants.push("Fiche fusionnée dans une autre : anonymiser la fiche conservée.");
  const enCours = await client.dossier.findMany({ where: { id: { in: dossierIds }, archiveLe: null, etape: { notIn: ETAPES_CLOSES } }, select: { objet: true } });
  if (enCours.length > 0) bloquants.push(`Dossier${enCours.length > 1 ? "s" : ""} en cours : ${enCours.map((dossier) => `« ${dossier.objet} »`).join(", ")}. Le clore (encaissé ou perdu) ou l'archiver d'abord.`);
  return bloquants;
}

export async function apercuAnonymisation(clientId: string): Promise<ApercuAnonymisation> {
  const champ = await perimetre(prisma, clientId);
  const bloquants = await bloquantsDe(prisma, clientId, champ.dossierIds);
  const documentsEmis = await prisma.document.count({ where: { dossierId: { in: champ.dossierIds }, numero: { not: null } } });
  return {
    clientId,
    reference: pseudonyme(clientId),
    dejaAnonymise: bloquants.includes("Fiche déjà anonymisée."),
    bloquants,
    adresses: champ.adresses,
    telephones: champ.telephones,
    efface: {
      dossiers: champ.dossierIds.length,
      photos: champ.chemins.length,
      mails: champ.lignes.Message.length,
      notes: champ.lignes.DossierNote.length,
      leads: champ.lignes.Lead.length,
      propositions: champ.lignes.Proposition.length,
    },
    garde: { documentsEmis, encaissements: champ.lignes.Encaissement.length },
  };
}

/* ── Anonymiser ────────────────────────────────────────────────────── */

type Delegue = { update: (args: { where: { id?: string; messageId?: string }; data: Record<string, unknown> }) => Promise<unknown> };

function delegue(tx: Transaction, modele: string): Delegue {
  return (tx as unknown as Record<string, Delegue>)[modele.charAt(0).toLowerCase() + modele.slice(1)];
}

const PAR_PAQUET = 300;

/** Réécrit les copies du journal avec les mêmes remplacements (une seule fois par ligne : la base le garantit). */
async function caviarderJournal(tx: Transaction, modele: string, ids: string[], contexte: ContexteAnonymisation, maintenant: Date): Promise<number> {
  const regle = CARTE_DONNEES_PERSONNELLES[modele];
  if (!regle || !("remplacer" in regle) || ids.length === 0) return 0;
  let caviardees = 0;
  for (let debut = 0; debut < ids.length; debut += PAR_PAQUET) {
    const paquet = ids.slice(debut, debut + PAR_PAQUET);
    const lignes = await tx.$queryRawUnsafe<{ id: string; avant: string | null; apres: string }[]>(
      `SELECT "id", "avant", "apres" FROM "JournalModification" WHERE "modele" = ? AND "caviardeLe" IS NULL AND "enregistrementId" IN (${paquet.map(() => "?").join(", ")})`,
      modele,
      ...paquet
    );
    for (const ligne of lignes) {
      const neutraliser = (json: string | null) => {
        if (json === null) return null;
        try {
          const valeur = JSON.parse(json) as Record<string, unknown>;
          const remplacements = regle.remplacer(valeur, contexte);
          for (const [cle, nouvelle] of Object.entries(remplacements)) if (cle in valeur) valeur[cle] = nouvelle;
          return JSON.stringify({ ...valeur, _caviarde: true });
        } catch {
          return JSON.stringify({ _caviarde: true });
        }
      };
      await tx.$executeRawUnsafe(`UPDATE "JournalModification" SET "avant" = ?, "apres" = ?, "caviardeLe" = ? WHERE "id" = ?`, neutraliser(ligne.avant), neutraliser(ligne.apres), maintenant.getTime(), ligne.id);
      caviardees++;
    }
  }
  return caviardees;
}

export type BilanAnonymisation = {
  reference: string;
  lignes: Record<string, number>;
  journalCaviarde: number;
  fichiersAEffacer: number;
};

export async function anonymiserDansTransaction(
  tx: Transaction,
  clientId: string,
  options: { decidePar: string; propositionId?: string; maintenant?: Date }
): Promise<BilanAnonymisation> {
  const maintenant = options.maintenant ?? new Date();
  const champ = await perimetre(tx, clientId, options.propositionId);
  const bloquants = await bloquantsDe(tx, clientId, champ.dossierIds);
  if (bloquants.length > 0) throw new ErreurMetier(`Anonymisation impossible : ${bloquants.join(" ")}`, 409);

  const contexte: ContexteAnonymisation = { pseudonyme: pseudonyme(clientId), leadsAvecFactures: champ.leadsAvecFactures };
  const bilan: BilanAnonymisation = { reference: contexte.pseudonyme, lignes: {}, journalCaviarde: 0, fichiersAEffacer: champ.chemins.length };

  for (const [modele, lignes] of Object.entries(champ.lignes)) {
    const regle = CARTE_DONNEES_PERSONNELLES[modele];
    if (!regle || !("remplacer" in regle)) continue;
    for (const ligne of lignes) {
      const data: Record<string, unknown> = { ...regle.remplacer(ligne, contexte) };
      // Ce que la carte ne peut pas dire en texte : dates d'effacement, archivage, statuts.
      if (modele === "Client") Object.assign(data, { anonymiseLe: maintenant, archiveLe: ligne.archiveLe ?? maintenant, archiveMotif: ligne.archiveMotif ?? "Anonymisation RGPD" });
      if (modele === "ClientEmail") Object.assign(data, { archiveLe: ligne.archiveLe ?? maintenant, archiveMotif: "Anonymisation RGPD", principale: false });
      if (modele === "ClientTelephone") Object.assign(data, { archiveLe: ligne.archiveLe ?? maintenant, archiveMotif: "Anonymisation RGPD", principal: false });
      if (modele === "ContenuMessage" || modele === "AnalyseMessage") {
        if (ligne.anonymiseLe) continue;
        data.anonymiseLe = maintenant;
      }
      if (modele === "PieceMessage") data.statut = "NON_CONSERVEE";
      if (modele === "Fichier") Object.assign(data, { archiveLe: ligne.archiveLe ?? maintenant, archiveMotif: "Effacé (RGPD)" });
      if (modele === "Proposition" && ligne.statut === "EN_ATTENTE") {
        Object.assign(data, { statut: "ANNULEE", decideLe: maintenant, decidePar: options.decidePar, commentaireRejet: "Client anonymisé (RGPD)" });
      }
      if (Object.keys(data).length === 0) continue;
      const cle = modele === "ContenuMessage" ? { messageId: String(ligne.messageId) } : { id: String(ligne.id) };
      await delegue(tx, modele).update({ where: cle, data });
      bilan.lignes[modele] = (bilan.lignes[modele] ?? 0) + 1;
    }
    const ids = lignes.map((ligne) => String(modele === "ContenuMessage" ? ligne.messageId : ligne.id));
    bilan.journalCaviarde += await caviarderJournal(tx, modele, ids, contexte, maintenant);
  }

  // Copies Drive des photos : contenu remplacé avant l'archivage (le miroir le fait ; rien n'est supprimé dans Drive).
  if (champ.dossierIds.length > 0) {
    const photos = champ.dossierIds.map((dossierId) => ({ cle: { startsWith: `photo:${dossierId}:` } }));
    await tx.miroirDrive.updateMany({ where: { OR: photos, etat: "ARCHIVE" }, data: { etat: ARCHIVE_A_NEUTRALISER } });
    await tx.miroirDrive.updateMany({ where: { OR: photos, etat: { notIn: ["ARCHIVE", ARCHIVE_A_NEUTRALISER] } }, data: { etat: A_NEUTRALISER } });
  }
  // Fichiers (photos, pièces jointes, images de simulation) : effacés par une tâche rejouable, après la validation.
  await mettreEnFile(
    { type: TYPE_TACHE_EFFACEMENT, cle: `rgpd-effacement:${clientId}`, mode: "RECONCILIATION", charge: { chemins: champ.chemins, dossierIds: champ.dossierIds } },
    tx
  );
  return bilan;
}
