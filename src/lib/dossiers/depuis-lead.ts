import { promises as fs } from "fs";
import { OBJET_PAR_FAMILLE } from "./objet";
import path from "path";
import prisma from "@/lib/prisma";
import { ErreurMetier } from "@/lib/commun/erreurs";
import { avecActeur } from "@/lib/journal/contexte";
import { LIBELLES_TYPE_PROJET, libelleSourceLead } from "@/lib/prospects/constantes";
import { resolveUploadsDir } from "@/lib/uploads";
import { ajouterPhoto, creerDossier, ecrireNote, modifierDossier } from "./dossiers";
import type { EtapeDossier } from "./constants";
import { demanderSynchronisation } from "@/lib/drive/synchronisation";
import { classerLeadSansBloquer } from "@/lib/prospects/qualification";
import { pluriel } from "@/lib/commun/format";

/**
 * Du contact entrant au dossier, sans ressaisie.
 *
 *  - « Ouvrir un dossier » depuis un lead : UN bouton. Coordonnées, projet,
 *    source, campagne, réponses au formulaire, message, montant simulé, rappel
 *    prévu, photos jointes et simulations : tout suit. Le lead sort alors de la
 *    liste Leads — il vit dans Dossiers, sans doublon.
 *  - Une simulation faite sur le site N'OUVRE PLUS de dossier (règle du
 *    22/09/2026) : elle crée un lead, avec ses photos et ses simulations sur sa
 *    fiche. Le dossier s'ouvre quand Lucas le décide depuis Leads (bouton, ou
 *    envoi du lien de l'espace client) ; ce que le client fait ensuite dans son
 *    espace (projet validé, simulation validée) fait avancer ce dossier.
 *    Si le contact a DÉJÀ un dossier vivant, sa nouvelle simulation y est rangée
 *    (et apparaît dans son espace) : un seul dossier par projet en cours.
 *
 * La photo avant et chaque rendu rejoignent les photos de chantier du dossier ;
 * le miroir Drive, qui recopie ces photos, n'a rien d'autre à savoir.
 *
 * Tout est rejouable : une simulation ou une photo déjà rangée porte le dossier
 * où elle l'a été (`dossierId`, `rangeeLe`) et n'est jamais recopiée.
 */

// Mission 13 : une seule table (dossiers/objet.ts), partagée avec la validation du projet dans l'espace.
const OBJET_PAR_TYPE_PROJET: Record<string, string> = OBJET_PAR_FAMILLE;

/** Un dossier fini (encaissé) ou perdu ne reçoit pas un nouveau projet : on en ouvre un autre. */
const ETAPES_CLOSES = ["PERDU", "ENCAISSE"];

const ACTEUR_AUTOMATIQUE = { acteur: "SYSTEME:simulation-dossier", origine: "Simulation du site rangée dans son dossier" };

const LIBELLES_OCCUPATION: Record<string, string> = { PROPRIETAIRE: "propriétaire", LOCATAIRE: "locataire" };
const LIBELLES_ECHANGE: Record<string, string> = { APPEL: "Appel", SMS: "SMS", EMAIL: "E-mail", NOTE: "Note" };
const LIBELLES_TAILLE: Record<string, string> = { PETITE: "petite cuisine", MOYENNE: "cuisine moyenne", GRANDE: "grande cuisine" };

export type OuvertureDepuisLead = { dossierId: string; cree: boolean; photosRangees: number; simulationsRangees: number };

type Options = {
  /** Ce qui déclenche l'ouverture : change la prochaine action et la note d'ouverture. */
  motif?: "BOUTON" | "SIMULATION" | "ESPACE";
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
async function dossierVivant(lead: { id: string; clientId: string | null }): Promise<string | null> {
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
 * Une image absente du disque n'arrête rien : la suivante est tentée, et la
 * ligne reste « à ranger » pour le passage suivant.
 */
export async function rangerImagesDuLead(leadId: string, dossierId: string, options: { silencieux?: boolean } = {}): Promise<{ photos: number; simulations: number }> {
  const [photos, simulations] = await Promise.all([
    prisma.photoLead.findMany({ where: { leadId, dossierId: null }, orderBy: { createdAt: "asc" } }),
    prisma.simulation.findMany({ where: { leadId, dossierId: null, OR: [{ imageBeforePath: { not: null } }, { imageAfterPath: { not: null } }, { imageOriginalPath: { not: null } }] }, orderBy: { createdAt: "asc" } }),
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
      }
    } catch (erreur) {
      console.error(`[dossiers] photo ${photo.id} du contact ${leadId} non rangée :`, erreur);
    }
  }

  for (const simulation of simulations) {
    try {
      const avant = simulation.imageOriginalPath ?? simulation.imageBeforePath;
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
        rangees > 0 ? "Simulation faite sur le site : photo avant et rendu rangés dans les photos du dossier" : "Simulation faite sur le site (images introuvables sur le serveur)",
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

/** Ouvre le dossier d'un contact (ou retrouve le sien), reprend tout ce qu'on sait, range ses images. */
export async function ouvrirDossierDuLead(leadId: string, options: Options = {}): Promise<OuvertureDepuisLead> {
  const lead = await prisma.lead.findUnique({ where: { id: leadId }, include: { simulations: { where: { archiveLe: null }, orderBy: { createdAt: "desc" }, take: 1, select: { prixDevis: true } } } });
  if (!lead) throw new ErreurMetier("Contact introuvable.", 404);

  let dossierId = await dossierVivant(lead);
  let cree = false;
  if (!dossierId) {
    if (lead.archiveLe) throw new ErreurMetier("Ce contact est archivé : le restaurer avant de lui ouvrir un dossier.", 409);
    const montant = lead.simulations[0]?.prixDevis ?? lead.prixDevis ?? null;
    const client = lead.clientId ? await prisma.client.findUnique({ where: { id: lead.clientId }, select: { archiveLe: true } }) : null;
    const rappel = lead.rappelLe && lead.rappelLe.getTime() > Date.now() ? lead.rappelLe : null;
    const prochaineAction =
      options.prochaineAction !== undefined
        ? options.prochaineAction
        : options.motif === "SIMULATION"
          ? "Appeler : simulation faite sur le site"
          : rappel
            ? "Rappeler"
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
        prochaineActionDate: rappel ? new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(rappel) : null,
      },
      []
    );
    cree = true;
    const etape: EtapeDossier = "QUALIFICATION";
    const idDossier = dossierId;
    const echanges = await prisma.interaction.findMany({ where: { leadId: lead.id }, orderBy: { createdAt: "desc" }, take: 8, select: { type: true, contenu: true, createdAt: true } });
    await prisma.$transaction((tx) => ecrireNote(tx, idDossier, { etape, contenu: noteDeReprise(lead, echanges.reverse()) }));
    // Simulation d'avant cette règle (rattrapage) : le dossier porte la date réelle de la simulation, pas celle du rattrapage —
    // les délais et la synthèse du mois restent vrais.
    if (options.motif === "SIMULATION") {
      const premiere = await prisma.simulation.findFirst({ where: { leadId: lead.id }, orderBy: { createdAt: "asc" }, select: { createdAt: true } });
      const reelle = premiere?.createdAt ?? lead.createdAt;
      if (Date.now() - reelle.getTime() > 2 * 86_400_000) {
        await modifierDossier(idDossier, { ouvertLe: new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(reelle) }).catch((erreur: unknown) => console.error(`[dossiers] date réelle du dossier ${idDossier} non posée :`, erreur));
      }
    }
    // Le rappel vit désormais sur le dossier.
    if (lead.rappelLe) await prisma.lead.update({ where: { id: lead.id }, data: { rappelLe: null } });
  }

  const { photos, simulations } = await rangerImagesDuLead(lead.id, dossierId, { silencieux: options.silencieux });
  // Les notes prises pendant les appels rejoignent l'historique du dossier, à leur date : rien à recopier.
  const { reprendreNotesDansDossier } = await import("@/lib/commercial/notes-appel");
  await reprendreNotesDansDossier(lead.id, dossierId).catch((erreur: unknown) => console.error(`[dossiers] notes d'appel non reprises dans ${dossierId} :`, erreur));
  return { dossierId, cree, photosRangees: photos, simulationsRangees: simulations };
}

/** Ce contact a des images à ranger : une simulation avec image, ou la photo d'une simulation échouée. */
async function relevDeLaRegle(leadId: string): Promise<boolean> {
  const [simulations, photosSimulateur] = await Promise.all([
    prisma.simulation.count({ where: { leadId, OR: [{ imageBeforePath: { not: null } }, { imageAfterPath: { not: null } }, { imageOriginalPath: { not: null } }] } }),
    prisma.photoLead.count({ where: { leadId, lead: { source: "SITE_SIMULATEUR" } } }),
  ]);
  return simulations + photosSimulateur > 0;
}

/**
 * Après une simulation du site : si le contact a déjà un dossier vivant, ses
 * images y sont rangées (et rejoignent son espace). Sinon RIEN ne s'ouvre : le
 * contact reste un lead, ses simulations sur sa fiche (null). Jamais bloquant
 * pour le webhook — une erreur se journalise, et le filet périodique repasse.
 */
export async function assurerDossierDeSimulation(leadId: string): Promise<OuvertureDepuisLead | null> {
  try {
    if (!(await relevDeLaRegle(leadId))) return null;
    const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { id: true, clientId: true } });
    // Il a vu sa pièce rénovée : sa classe est relue (Prioritaire d'office, sauf hors zone), dossier ou pas.
    if (!lead || !(await dossierVivant(lead))) {
      await classerLeadSansBloquer(leadId);
      return null;
    }
    const resultat = await avecActeur(ACTEUR_AUTOMATIQUE, () => ouvrirDossierDuLead(leadId, { motif: "SIMULATION" }));
    await classerLeadSansBloquer(leadId);
    if (resultat.cree || resultat.simulationsRangees > 0) console.log(`[dossiers] simulation → dossier ${resultat.dossierId} (${resultat.cree ? "ouvert" : "existant"}) : ${pluriel(resultat.simulationsRangees, "simulation")}, ${pluriel(resultat.photosRangees, "photo")}`);
    return resultat;
  } catch (erreur) {
    console.error(`[dossiers] simulation du contact ${leadId} non rangée (sera reprise) :`, erreur);
    return null;
  }
}

/**
 * Filet : les simulations d'un contact qui A un dossier vivant et qu'une erreur
 * aurait laissées hors de ce dossier. Depuis le 22/09/2026, un contact sans
 * dossier n'en reçoit plus : ses simulations restent sur sa fiche de lead.
 */
export async function rattraperSimulationsSansDossier(limite = 200): Promise<{ contacts: number; dossiersOuverts: number; simulationsRangees: number; photosRangees: number; echecs: number }> {
  const leads = await prisma.lead.findMany({
    where: {
      dossiers: { some: { archiveLe: null, etape: { notIn: ETAPES_CLOSES } } },
      OR: [
        { simulations: { some: { dossierId: null, OR: [{ imageBeforePath: { not: null } }, { imageAfterPath: { not: null } }, { imageOriginalPath: { not: null } }] } } },
        { source: "SITE_SIMULATEUR", photos: { some: { dossierId: null } } },
      ],
    },
    orderBy: { createdAt: "asc" },
    take: limite,
    select: { id: true },
  });
  const bilan = { contacts: leads.length, dossiersOuverts: 0, simulationsRangees: 0, photosRangees: 0, echecs: 0 };
  for (const lead of leads) {
    const resultat = await assurerDossierDeSimulation(lead.id);
    if (!resultat) bilan.echecs++;
    else {
      if (resultat.cree) bilan.dossiersOuverts++;
      bilan.simulationsRangees += resultat.simulationsRangees;
      bilan.photosRangees += resultat.photosRangees;
    }
  }
  return bilan;
}
