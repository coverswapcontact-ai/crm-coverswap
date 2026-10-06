import { promises as fs } from "fs";
import type { Prisma } from "@prisma/client";
import { OBJET_PAR_FAMILLE } from "./objet";
import path from "path";
import prisma from "@/lib/prisma";
import { ErreurMetier } from "@/lib/commun/erreurs";
import { avecActeur } from "@/lib/journal/contexte";
import { FILTRE_DEMANDE_DE_DEVIS, LIBELLES_TYPE_PROJET, STATUTS_LEAD_APRES_DEVIS, estDemandeDeDevis, libelleSourceLead } from "@/lib/prospects/constantes";
import { resolveUploadsDir } from "@/lib/uploads";
import { ajouterPhoto, creerDossier, ecrireNote, modifierDossier } from "./dossiers";
import { ACTIONS_OUVERTURE_AUTO, ETAPES_CLOSES, type EtapeDossier, type MotifOuvertureAuto } from "./constants";
import { jourParis } from "./dates";
import { demanderSynchronisation } from "@/lib/drive/synchronisation";
import { classerLeadSansBloquer } from "@/lib/prospects/qualification";
import { pluriel } from "@/lib/commun/format";
import { synchroniserRappel } from "@/lib/agenda/rappels";
import { alignerStatutLead } from "./statut-lead";

/**
 * Du contact entrant au dossier, sans ressaisie.
 *
 *  - Mission 18 (A2) : le dossier S'OUVRE TOUT SEUL dès que le contact envoie
 *    des photos, fait une simulation ou demande un devis sur le site
 *    (`ouvrirDossierAutomatique`, appelée par le webhook et par la fin d'une
 *    simulation du site), en Qualification, avec « Appeler : … » pour
 *    aujourd'hui. Dans l'espace client, tout se passe déjà dans un dossier (un
 *    projet créé par le client ouvre le sien, mission 5). Seuls les faits
 *    postérieurs à `DEBUT_OUVERTURE_AUTO` ouvrent : le stock reste dans Leads.
 *    Un contact hors zone (« À écarter ») reste un lead ; un lead Meta aussi,
 *    tant qu'il ne fait rien sur le site (une photo que Lucas lui dépose depuis
 *    le CRM n'ouvre rien). Un dossier archivé par Lucas ne se rouvre que sur un
 *    fait postérieur à son archivage. Une ouverture à la fois par contact.
 *  - « Ouvrir un dossier » depuis un lead : UN bouton, qui ne sert plus que pour
 *    un lead qualifié au téléphone. Coordonnées, projet, source, campagne,
 *    réponses au formulaire, message, montant simulé, rappel prévu, photos
 *    jointes et simulations : tout suit. Le lead sort alors de la liste Leads —
 *    il vit dans Dossiers, sans doublon (un lead du site jamais appelé reste dans
 *    « À appeler », `prospects/leads.ts`).
 *  - Si le contact a DÉJÀ un dossier vivant, sa nouvelle simulation ou ses
 *    photos y sont rangées (et apparaissent dans son espace) : un seul dossier
 *    par projet en cours.
 *
 * La photo avant et chaque rendu rejoignent les photos de chantier du dossier ;
 * le miroir Drive, qui recopie ces photos, n'a rien d'autre à savoir.
 *
 * Tout est rejouable : une simulation ou une photo déjà rangée porte le dossier
 * où elle l'a été (`dossierId`, `rangeeLe`) et n'est jamais recopiée.
 */

// Mission 13 : une seule table (dossiers/objet.ts), partagée avec la validation du projet dans l'espace.
const OBJET_PAR_TYPE_PROJET: Record<string, string> = OBJET_PAR_FAMILLE;

const ACTEUR_AUTOMATIQUE = { acteur: "SYSTEME:simulation-dossier", origine: "Simulation, photos ou demande de devis du site : dossier ouvert ou complété tout seul" };

/**
 * Mission 18 (A2) : à partir de cette date, une simulation, une photo ou une demande de devis venue du site ouvre le
 * dossier toute seule. Rien d'avant n'est ouvert après coup : le stock reste dans Leads, où « Ouvrir un dossier » le
 * reprend si Lucas le décide.
 */
export const DEBUT_OUVERTURE_AUTO = new Date("2026-10-03T00:00:00+02:00");

/** Le filet ne rattrape que les deux derniers jours (une erreur au moment du webhook), jamais l'histoire. */
const FENETRE_DU_FILET_MS = 2 * 86_400_000;

/** Une simulation qui a une image : photo avant, rendu ou photo d'origine. */
const AVEC_IMAGE: Prisma.SimulationWhereInput[] = [{ imageBeforePath: { not: null } }, { imageAfterPath: { not: null } }, { imageOriginalPath: { not: null } }];

/**
 * Relecture de la partie A : une photo que Lucas dépose lui-même sur un lead (lien de dépôt, « ajouter_fichier » :
 * origine DEPOT_CRM) n'est pas un geste du contact. Elle se range dans son dossier vivant, mais n'en ouvre jamais un.
 */
const PHOTO_DU_CONTACT: Prisma.PhotoLeadWhereInput = { origine: { not: "DEPOT_CRM" } };

/** Une photo pas encore rangée ni déjà tentée en vain (fichier absent du volume : `rangeeLe` posé sans dossier). */
const PHOTO_A_RANGER: Prisma.PhotoLeadWhereInput = { archiveLe: null, dossierId: null, rangeeLe: null };

const LIBELLES_OCCUPATION: Record<string, string> = { PROPRIETAIRE: "propriétaire", LOCATAIRE: "locataire" };
const LIBELLES_ECHANGE: Record<string, string> = { APPEL: "Appel", SMS: "SMS", EMAIL: "E-mail", NOTE: "Note" };
const LIBELLES_TAILLE: Record<string, string> = { PETITE: "petite cuisine", MOYENNE: "cuisine moyenne", GRANDE: "grande cuisine" };

export type OuvertureDepuisLead = { dossierId: string; cree: boolean; photosRangees: number; simulationsRangees: number };

type Options = {
  /** Ce qui déclenche l'ouverture : change la prochaine action et la note d'ouverture. SIMULATION et DEMANDE : ouverture automatique. */
  motif?: "BOUTON" | MotifOuvertureAuto | "ESPACE";
  prochaineAction?: string | null;
  /** Geste de Lucas (fusion d'un doublon) : pas d'alerte « nouvelle simulation » sur son propre téléphone. */
  silencieux?: boolean;
};

function nomComplet(lead: { prenom: string; nom: string }): string {
  const prenom = lead.prenom.trim();
  const nom = lead.nom.trim();
  if (!prenom || prenom.toLowerCase() === nom.toLowerCase()) return nom || prenom || "Client";
  return nom && nom !== "Inconnu" ? `${prenom} ${nom}` : prenom;
}

function typeMime(chemin: string): string {
  const extension = path.extname(chemin).toLowerCase();
  return extension === ".png" ? "image/png" : extension === ".webp" ? "image/webp" : extension === ".heic" ? "image/heic" : "image/jpeg";
}

/** Recopie un fichier des téléversements (fiche du lead) dans les photos de chantier du dossier ; rend l'identifiant de la copie. */
async function recopierDansLeDossier(dossierId: string, cheminRelatif: string, nom: string): Promise<string | null> {
  const octets = await fs.readFile(path.join(resolveUploadsDir(), cheminRelatif)).catch(() => null);
  if (!octets || octets.length === 0) return null;
  const type = typeMime(cheminRelatif);
  return (await ajouterPhoto(dossierId, new File([new Uint8Array(octets)], nom, { type }))).id;
}

/** Le dossier vivant de ce contact, sinon celui de son client (un seul dossier par projet en cours). */
export async function dossierVivant(lead: { id: string; clientId: string | null }): Promise<string | null> {
  const duLead = await prisma.dossier.findFirst({ where: { leadId: lead.id, etape: { notIn: ETAPES_CLOSES } }, orderBy: { createdAt: "desc" }, select: { id: true } });
  if (duLead) return duLead.id;
  if (!lead.clientId) return null;
  const duClient = await prisma.dossier.findFirst({ where: { clientId: lead.clientId, etape: { notIn: ETAPES_CLOSES } }, orderBy: { createdAt: "desc" }, select: { id: true } });
  return duClient?.id ?? null;
}

/** Ce que la personne a dit et d'où elle vient : la première note du dossier. */
function noteDeReprise(lead: {
  source: string; campagne: string | null; publicite: string | null; formulaire: string | null; typeProjet: string; occupation: string | null; delaiProjetTexte: string | null; delaiProjet: string | null;
  tailleCuisine: string | null; message: string | null; styleSouhaite: string | null; referenceChoisie: string | null; mlEstimes: number | null; prixDevis: number | null; notes: string | null;
  priorite: string | null; prioriteMotif: string | null; createdAt: Date;
}, echanges: { type: string; contenu: string; createdAt: Date }[] = []): string {
  const lignes = [
    `Contact reçu le ${lead.createdAt.toLocaleDateString("fr-FR", { timeZone: "Europe/Paris" })} — ${libelleSourceLead(lead.source)}${lead.campagne ? `, campagne « ${lead.campagne} »` : ""}${lead.publicite ? `, publicité « ${lead.publicite} »` : ""}${lead.formulaire ? `, formulaire « ${lead.formulaire} »` : ""}.`,
    `Projet : ${LIBELLES_TYPE_PROJET[lead.typeProjet] ?? lead.typeProjet}${lead.tailleCuisine ? ` (${LIBELLES_TAILLE[lead.tailleCuisine] ?? lead.tailleCuisine})` : ""}.`,
    lead.occupation ? `Occupation : ${LIBELLES_OCCUPATION[lead.occupation] ?? lead.occupation}.` : null,
    lead.delaiProjetTexte ? `Délai : ${lead.delaiProjetTexte}.` : null,
    lead.referenceChoisie ? `Finition retenue : ${lead.referenceChoisie}${lead.mlEstimes ? `, ${lead.mlEstimes} ml estimés` : ""}${lead.prixDevis ? `, ${Math.round(lead.prixDevis)} € simulés` : ""}.` : null,
    lead.styleSouhaite ? `Style souhaité : ${lead.styleSouhaite}.` : null,
    lead.message ? `Son message : ${lead.message}` : null,
    lead.notes ? `Notes : ${lead.notes}` : null,
    lead.prioriteMotif ? `Classement : ${lead.prioriteMotif}.` : null,
    // Ce qui s'est déjà dit avant le dossier (appels, SMS, notes) : l'histoire ne repart pas de zéro.
    echanges.length > 0 ? `Avant le dossier :\n${echanges.map((e) => `- ${e.createdAt.toLocaleString("fr-FR", { timeZone: "Europe/Paris", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })} · ${LIBELLES_ECHANGE[e.type] ?? e.type} : ${e.contenu.replace(/\s+/g, " ").slice(0, 200)}`).join("\n")}` : null,
  ];
  return lignes.filter(Boolean).join("\n").slice(0, 3900);
}

/**
 * Range dans le dossier les photos du lead et ses simulations pas encore rangées.
 * Une image absente du disque n'arrête rien : la suivante est tentée. Une photo
 * introuvable (fichier absent ou vide) est marquée tentée (`rangeeLe` sans
 * dossier) : le filet n'y revient plus, comme pour une simulation sans images.
 * Une erreur d'écriture (volume plein) la laisse « à ranger » pour le passage suivant.
 */
export async function rangerImagesDuLead(leadId: string, dossierId: string, options: { silencieux?: boolean } = {}): Promise<{ photos: number; simulations: number }> {
  const [photos, simulations] = await Promise.all([
    prisma.photoLead.findMany({ where: { leadId, ...PHOTO_A_RANGER }, orderBy: { createdAt: "asc" } }),
    prisma.simulation.findMany({ where: { leadId, dossierId: null, OR: AVEC_IMAGE }, orderBy: { createdAt: "asc" } }),
  ]);
  let photosRangees = 0;
  let simulationsRangees = 0;
  // La même photo avant sert souvent à plusieurs rendus : elle n'entre qu'une fois dans le dossier,
  // y compris quand le second rendu arrive une heure plus tard (la taille du fichier est gardée sur l'événement).
  const avantDejaRangees = new Set<number>();
  if (simulations.length > 0) {
    const precedents = await prisma.dossierEvenement.findMany({ where: { dossierId, type: "SIMULATION_SITE" }, select: { metadata: true } });
    for (const precedent of precedents) {
      const taille = Number((JSON.parse(precedent.metadata || "{}") as { avantOctets?: number }).avantOctets);
      if (taille > 0) avantDejaRangees.add(taille);
    }
  }

  for (const photo of photos) {
    try {
      if (await recopierDansLeDossier(dossierId, photo.chemin, `photo-${photo.id}${path.extname(photo.chemin) || ".jpg"}`)) {
        await prisma.photoLead.update({ where: { id: photo.id }, data: { dossierId, rangeeLe: new Date() } });
        photosRangees++;
      } else {
        // Rien sur le disque : tentée une fois, on n'y revient pas (la ligne reste sur le lead, sans dossier).
        await prisma.photoLead.update({ where: { id: photo.id }, data: { rangeeLe: new Date() } });
        console.warn(`[dossiers] photo ${photo.id} du contact ${leadId} introuvable sur le serveur : non rangée, plus retentée`);
      }
    } catch (erreur) {
      console.error(`[dossiers] photo ${photo.id} du contact ${leadId} non rangée :`, erreur);
    }
  }

  for (const simulation of simulations) {
    try {
      // Site 3.0 : une simulation faite sur une pièce d'exemple du site n'a pas de photo du client — son avant n'entre
      // jamais dans les photos du dossier (il ne servirait pas de photo « avant » d'un chantier ni d'une simulation).
      const avant = simulation.exemple ? null : (simulation.imageOriginalPath ?? simulation.imageBeforePath);
      let rangees = 0;
      let avantOctets = 0;
      // Identifiants des copies : le rendu n'est pas une photo du client (il ne sert jamais de photo « avant »).
      const copies: { avant: string | null; rendu: string | null } = { avant: null, rendu: null };
      if (avant) {
        const taille = (await fs.stat(path.join(resolveUploadsDir(), avant)).catch(() => null))?.size ?? 0;
        avantOctets = taille;
        if (taille > 0 && !avantDejaRangees.has(taille)) {
          copies.avant = await recopierDansLeDossier(dossierId, avant, `avant-${simulation.id}${path.extname(avant) || ".jpg"}`);
          if (copies.avant) rangees++;
          avantDejaRangees.add(taille);
        }
      }
      if (simulation.imageAfterPath) {
        copies.rendu = await recopierDansLeDossier(dossierId, simulation.imageAfterPath, `rendu-${simulation.id}${path.extname(simulation.imageAfterPath) || ".png"}`);
        if (copies.rendu) rangees++;
      }
      // Rien sur le disque (volume restauré sans les images, purge) : on le dit une fois sur le dossier, et on n'y revient pas.
      const contenu = [
        simulation.exemple
          ? `Simulation faite sur le site sur une pièce d'exemple (${simulation.exemple}), pas sur une photo du client : ${rangees > 0 ? "rendu rangé dans les photos du dossier" : "rendu introuvable sur le serveur"}`
          : rangees > 0
            ? "Simulation faite sur le site : photo avant et rendu rangés dans les photos du dossier"
            : "Simulation faite sur le site (images introuvables sur le serveur)",
        simulation.referenceChoisie ? `finition ${simulation.referenceChoisie}` : null,
        simulation.notes,
        simulation.prixDevis ? `${Math.round(simulation.prixDevis)} € simulés` : null,
      ].filter(Boolean).join(" — ");
      await prisma.$transaction([
        prisma.simulation.update({ where: { id: simulation.id }, data: { dossierId, rangeeLe: new Date(), photosDossier: JSON.stringify(copies) } }),
        prisma.dossierEvenement.create({ data: { dossierId, type: "SIMULATION_SITE", direction: "ENTRANT", contenu: contenu.slice(0, 1000), survenuLe: simulation.createdAt, metadata: JSON.stringify({ simulationId: simulation.id, images: rangees, avantOctets }) } }),
      ]);
      if (rangees > 0 || avantOctets > 0) simulationsRangees++;
    } catch (erreur) {
      console.error(`[dossiers] simulation ${simulation.id} du contact ${leadId} non rangée :`, erreur);
    }
  }
  if (photosRangees + simulationsRangees > 0) await demanderSynchronisation().catch(() => undefined);
  // Le client a déjà son espace : ses nouvelles simulations du site y apparaissent tout de suite (et Lucas est prévenu).
  // Import à la demande : simulations/dossier dépend de l'espace, qui dépend de ce fichier.
  if (simulationsRangees > 0) {
    const { rangerSimulationsSiteDansLEspace } = await import("@/lib/simulations/dossier");
    await rangerSimulationsSiteDansLEspace(dossierId, { alerter: !options.silencieux }).catch((erreur) => console.error(`[dossiers] simulations du site non rangées dans l'espace du dossier ${dossierId} :`, erreur));
  }
  return { photos: photosRangees, simulations: simulationsRangees };
}

/**
 * Relecture de la partie A : l'ouverture d'un dossier se fait une à la fois par contact. Le webhook, la fin d'une
 * simulation, le filet et le bouton peuvent arriver ensemble ; sans cela, deux appels liraient « pas de dossier
 * vivant » avant que l'un ne le crée, et ouvriraient deux dossiers. Le serveur est un seul processus : une file de
 * promesses par contact suffit.
 */
const ouverturesEnCours = new Map<string, Promise<unknown>>();

async function unParContact<T>(leadId: string, travail: () => Promise<T>): Promise<T> {
  const precedente = ouverturesEnCours.get(leadId) ?? Promise.resolve();
  const suite = precedente.catch(() => undefined).then(travail);
  const fin = suite.catch(() => undefined);
  ouverturesEnCours.set(leadId, fin);
  void fin.then(() => {
    if (ouverturesEnCours.get(leadId) === fin) ouverturesEnCours.delete(leadId);
  });
  return suite;
}

/** Ouvre le dossier d'un contact (ou retrouve le sien), reprend tout ce qu'on sait, range ses images. */
export async function ouvrirDossierDuLead(leadId: string, options: Options = {}): Promise<OuvertureDepuisLead> {
  return unParContact(leadId, () => ouvrirSansFile(leadId, options));
}

async function ouvrirSansFile(leadId: string, options: Options): Promise<OuvertureDepuisLead> {
  const lead = await prisma.lead.findUnique({ where: { id: leadId }, include: { simulations: { where: { archiveLe: null }, orderBy: { createdAt: "desc" }, take: 1, select: { prixDevis: true } } } });
  if (!lead) throw new ErreurMetier("Contact introuvable.", 404);

  let dossierId = await dossierVivant(lead);
  let cree = false;
  if (!dossierId) {
    if (lead.archiveLe) throw new ErreurMetier("Ce contact est archivé : le restaurer avant de lui ouvrir un dossier.", 409);
    const montant = lead.simulations[0]?.prixDevis ?? lead.prixDevis ?? null;
    const client = lead.clientId ? await prisma.client.findUnique({ where: { id: lead.clientId }, select: { archiveLe: true } }) : null;
    const rappel = lead.rappelLe && lead.rappelLe.getTime() > Date.now() ? lead.rappelLe : null;
    // Ouverture automatique : « Appeler : … » pour aujourd'hui (une tâche le porte) ; un rappel demandé passe avant, à
    // son heure (« Rappeler » : `rappelALOuverture` l'y pose, un autre texte le perdrait).
    const automatique = options.motif === "SIMULATION" || options.motif === "DEMANDE" ? options.motif : null;
    const prochaineAction =
      options.prochaineAction !== undefined
        ? options.prochaineAction
        : rappel
          ? "Rappeler"
          : automatique
            ? ACTIONS_OUVERTURE_AUTO[automatique]
            : null;
    dossierId = await creerDossier(
      {
        leadId: lead.id,
        clientId: client && !client.archiveLe ? lead.clientId : null,
        clientNom: nomComplet(lead),
        clientAdresse: "",
        clientCp: lead.codePostal ?? "",
        clientVille: /^(non renseign|inconnue?$)/i.test(lead.ville.trim()) ? "" : lead.ville.trim(),
        clientTelephone: lead.telephone,
        clientEmail: lead.email,
        objet: OBJET_PAR_TYPE_PROJET[lead.typeProjet] ?? "",
        source: "ENTRANT",
        montantEstime: montant && montant > 0 ? Math.round(montant) : null,
        prochaineAction,
        prochaineActionDate: rappel ? jourParis(rappel) : automatique && prochaineAction ? jourParis(new Date()) : null,
      },
      []
    );
    cree = true;
    const etape: EtapeDossier = "QUALIFICATION";
    const idDossier = dossierId;
    const echanges = await prisma.interaction.findMany({ where: { leadId: lead.id }, orderBy: { createdAt: "desc" }, take: 8, select: { type: true, contenu: true, createdAt: true } });
    await prisma.$transaction((tx) => ecrireNote(tx, idDossier, { etape, contenu: noteDeReprise(lead, echanges.reverse()) }));
    // Simulation rangée après coup (rattrapage, fusion d'un doublon) : le dossier porte la date réelle de la simulation qui
    // l'ouvre (la plus récente), pas celle du rattrapage — les délais et la synthèse du mois restent vrais. Mission 18 (A2) :
    // la plus récente, et non plus la première (ni l'arrivée du lead, sans simulation) — un contact revenu simuler aujourd'hui
    // n'ouvre pas un dossier daté de sa première visite.
    if (options.motif === "SIMULATION") {
      const derniere = await prisma.simulation.findFirst({ where: { leadId: lead.id }, orderBy: { createdAt: "desc" }, select: { createdAt: true } });
      const reelle = derniere?.createdAt ?? null;
      if (reelle && Date.now() - reelle.getTime() > 2 * 86_400_000) {
        await modifierDossier(idDossier, { ouvertLe: new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(reelle) }).catch((erreur: unknown) => console.error(`[dossiers] date réelle du dossier ${idDossier} non posée :`, erreur));
      }
    }
    // Le rappel vit désormais sur le dossier, à son heure exacte : `creerDossier` l'y a repris (mission 14, partie 7 :
    // `rappelALOuverture`, qui a aussi supprimé l'événement du lead et posé celui du dossier). Un rappel passé, ou écarté
    // par une autre prochaine action, ne reste pas sur le lead.
    if (lead.rappelLe) await prisma.lead.update({ where: { id: lead.id }, data: { rappelLe: null } });
  } else {
    // Mission 18 (B12) : un contact qui revient (demande, simulation) sur son dossier vivant retrouve le statut que ses
    // dossiers lui donnent — un « Devis demandé » ou un « Sans suite » posé entre-temps ne reste pas (statut-lead.ts).
    await alignerStatutLead(prisma, lead.id);
    // Un lead repris par son dossier vivant n'a plus de rappel à lui : son événement quitte l'agenda.
    if (lead.agendaEvenementId) await synchroniserRappel({ type: "LEAD", id: lead.id });
  }

  const { photos, simulations } = await rangerImagesDuLead(lead.id, dossierId, { silencieux: options.silencieux });
  // Les notes prises pendant les appels rejoignent l'historique du dossier, à leur date : rien à recopier.
  const { reprendreNotesDansDossier } = await import("@/lib/commercial/notes-appel");
  await reprendreNotesDansDossier(lead.id, dossierId).catch((erreur: unknown) => console.error(`[dossiers] notes d'appel non reprises dans ${dossierId} :`, erreur));
  return { dossierId, cree, photosRangees: photos, simulationsRangees: simulations };
}

type LeadLu = { id: string; clientId: string | null; source: string; typeProjet: string; createdAt: Date; archiveLe: Date | null };

/**
 * Ce que le contact a fait sur le site, depuis une date (ou depuis toujours) : une simulation avec image, une photo, une
 * demande de devis. `seulementDuContact` : les photos déposées par Lucas (DEPOT_CRM) ne comptent pas (elles n'ouvrent
 * jamais un dossier, mais se rangent dans le dossier vivant).
 */
async function faitsDuSite(lead: LeadLu, depuis: Date | null, seulementDuContact = false): Promise<{ simulation: boolean; photos: boolean; demande: boolean }> {
  const quand = depuis ? { createdAt: { gte: depuis } } : {};
  const [simulations, photos] = await Promise.all([
    prisma.simulation.count({ where: { leadId: lead.id, ...quand, OR: AVEC_IMAGE } }),
    prisma.photoLead.count({ where: { leadId: lead.id, ...quand, ...(seulementDuContact ? PHOTO_DU_CONTACT : {}) } }),
  ]);
  return { simulation: simulations > 0, photos: photos > 0, demande: estDemandeDeDevis(lead) && (!depuis || lead.createdAt.getTime() >= depuis.getTime()) };
}

/**
 * Ce qui ouvre le dossier tout seul, d'après les seuls faits postérieurs à `depuis` (`DEBUT_OUVERTURE_AUTO`, ou
 * l'archivage de son dernier dossier) : la demande de devis qui arrive (ou le formulaire qui a créé le lead), sinon une
 * simulation (ou la photo d'une simulation échouée), sinon des photos jointes à une demande — envoyées par le contact,
 * jamais déposées par Lucas. null : rien de nouveau, le contact reste un lead.
 */
async function motifDOuverture(lead: LeadLu, demande: boolean, depuis: Date): Promise<MotifOuvertureAuto | null> {
  if (demande) return "DEMANDE";
  const recents = await faitsDuSite(lead, depuis, true);
  if (recents.simulation || (recents.photos && lead.source === "SITE_SIMULATEUR")) return "SIMULATION";
  if (recents.photos || recents.demande) return "DEMANDE";
  return null;
}

/**
 * Mission 18 (A2) — le contact vient d'envoyer des photos, de faire une simulation ou de demander un devis sur le site
 * (`demande` : la demande qui arrive). S'il a un dossier vivant, photo avant, rendus et photos y sont rangés (et
 * rejoignent son espace). Sinon son dossier S'OUVRE, en Qualification, « Appeler : … » pour aujourd'hui (ou
 * « Rappeler » à l'heure qu'il a demandée) — sauf contact archivé, hors zone, ou sans fait postérieur à
 * `DEBUT_OUVERTURE_AUTO` (null : il reste un lead). Aucun mail ni SMS de plus. Jamais bloquant pour le webhook : une
 * erreur se journalise, et le filet périodique repasse.
 */
export async function ouvrirDossierAutomatique(leadId: string, options: { demande?: boolean } = {}): Promise<OuvertureDepuisLead | null> {
  try {
    const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { id: true, clientId: true, source: true, typeProjet: true, createdAt: true, archiveLe: true } });
    if (!lead) return null;
    // Il a vu sa pièce rénovée, ou il demande un devis : sa classe est relue (Prioritaire d'office, sauf hors zone), dossier ou pas.
    await classerLeadSansBloquer(leadId);
    // Relecture de la partie A : la décision (dossier vivant ou non) et l'ouverture se font d'un bloc, un appel à la fois
    // par contact (`unParContact`) — jamais deux dossiers ouverts ensemble par le webhook, la simulation et le filet.
    const ouvert = await unParContact(leadId, async (): Promise<{ motif: MotifOuvertureAuto; resultat: OuvertureDepuisLead } | null> => {
      let motif: MotifOuvertureAuto;
      if (await dossierVivant(lead)) {
        // Un dossier vivant : ce qui n'y est pas encore rangé y entre ; jamais de second dossier.
        const faits = await faitsDuSite(lead, null);
        if (!faits.simulation && !faits.photos && !options.demande) return null;
        motif = options.demande ? "DEMANDE" : "SIMULATION";
      } else {
        if (lead.archiveLe) return null;
        // Hors zone : il reste dans Leads (« Classer · … (hors zone) ») ; « Ouvrir un dossier » le reprend si Lucas le traite quand même.
        if ((await prisma.lead.findUnique({ where: { id: leadId }, select: { priorite: true } }))?.priorite === "A_ECARTER") return null;
        // Un dossier archivé par Lucas ne se rouvre pas sur un fait qu'il connaissait déjà : seuls comptent les faits
        // postérieurs à son archivage (une nouvelle simulation, une nouvelle demande l'ouvrent, comme pour un nouveau contact).
        const archive = await prisma.dossier.findFirst({ where: { leadId, archiveLe: { not: null } }, orderBy: { archiveLe: "desc" }, select: { archiveLe: true } });
        const depuis = new Date(Math.max(DEBUT_OUVERTURE_AUTO.getTime(), archive?.archiveLe?.getTime() ?? 0));
        const trouve = await motifDOuverture(lead, options.demande === true, depuis);
        if (!trouve) return null;
        motif = trouve;
      }
      return { motif, resultat: await avecActeur(ACTEUR_AUTOMATIQUE, () => ouvrirSansFile(leadId, { motif })) };
    });
    if (!ouvert) return null;
    const { motif, resultat } = ouvert;
    if (resultat.cree || resultat.simulationsRangees + resultat.photosRangees > 0) {
      console.log(`[dossiers] ${motif === "DEMANDE" ? "demande de devis" : "simulation"} du site → dossier ${resultat.dossierId} (${resultat.cree ? "ouvert" : "existant"}) : ${pluriel(resultat.simulationsRangees, "simulation")}, ${pluriel(resultat.photosRangees, "photo")}`);
    }
    return resultat;
  } catch (erreur) {
    console.error(`[dossiers] dossier du contact ${leadId} non ouvert ou non complété (sera repris) :`, erreur);
    return null;
  }
}

/**
 * Filet, toutes les 15 minutes : ce qu'une erreur au moment du webhook aurait laissé de côté.
 *  - Un contact qui A un dossier vivant : ses simulations et ses photos pas encore rangées y entrent.
 *  - Mission 18 (A2) : un contact qui n'a JAMAIS eu de dossier (archivés compris : un dossier archivé par Lucas ne se
 *    rouvre pas tout seul), dont le client n'en a pas de vivant, et qui a fait quelque chose sur le site ces deux
 *    derniers jours, après `DEBUT_OUVERTURE_AUTO` : son dossier s'ouvre. Ni perdu, ni après devis, ni hors zone ; le
 *    stock n'est jamais ouvert.
 */
export async function rattraperSimulationsSansDossier(limite = 200, maintenant: Date = new Date()): Promise<{ contacts: number; dossiersOuverts: number; simulationsRangees: number; photosRangees: number; echecs: number }> {
  const depuis = new Date(Math.max(DEBUT_OUVERTURE_AUTO.getTime(), maintenant.getTime() - FENETRE_DU_FILET_MS));
  const leads = await prisma.lead.findMany({
    where: {
      OR: [
        {
          dossiers: { some: { archiveLe: null, etape: { notIn: ETAPES_CLOSES } } },
          OR: [
            { simulations: { some: { archiveLe: null, dossierId: null, OR: AVEC_IMAGE } } },
            { source: "SITE_SIMULATEUR", photos: { some: PHOTO_A_RANGER } },
            { photos: { some: { ...PHOTO_A_RANGER, createdAt: { gte: DEBUT_OUVERTURE_AUTO } } } },
          ],
        },
        {
          dossiers: { none: {} },
          statut: { notIn: [...STATUTS_LEAD_APRES_DEVIS, "PERDU"] },
          AND: [
            { OR: [{ priorite: null }, { priorite: { not: "A_ECARTER" } }] },
            // Son client n'a pas déjà un dossier vivant (sinon c'est celui-là qui reçoit, au webhook : rien à rattraper ici).
            { OR: [{ clientId: null }, { client: { dossiers: { none: { archiveLe: null, etape: { notIn: ETAPES_CLOSES } } } } }] },
            {
              OR: [
                { simulations: { some: { archiveLe: null, dossierId: null, createdAt: { gte: depuis }, OR: AVEC_IMAGE } } },
                // Une photo envoyée par le contact : celle que Lucas dépose (DEPOT_CRM) n'ouvre rien.
                { photos: { some: { ...PHOTO_A_RANGER, ...PHOTO_DU_CONTACT, createdAt: { gte: depuis } } } },
                { createdAt: { gte: depuis }, ...FILTRE_DEMANDE_DE_DEVIS },
              ],
            },
          ],
        },
      ],
    },
    orderBy: { createdAt: "asc" },
    take: limite,
    select: { id: true },
  });
  const bilan = { contacts: leads.length, dossiersOuverts: 0, simulationsRangees: 0, photosRangees: 0, echecs: 0 };
  for (const lead of leads) {
    const resultat = await ouvrirDossierAutomatique(lead.id);
    if (!resultat) bilan.echecs++;
    else {
      if (resultat.cree) bilan.dossiersOuverts++;
      bilan.simulationsRangees += resultat.simulationsRangees;
      bilan.photosRangees += resultat.photosRangees;
    }
  }
  return bilan;
}
