import prisma from "@/lib/prisma";
import { momentDuRappel } from "@/lib/commercial/quand";
import { dossierVivant } from "@/lib/dossiers/depuis-lead";
import { avecActeur } from "@/lib/journal/contexte";
import { AVEC_ARCHIVES } from "@/lib/journal/extension";

/**
 * Mission 16 (partie 4) — le tunnel du site, côté CRM : ce que le webhook fait de plus quand le visiteur laisse ses
 * coordonnées après un rendu. L'espace client s'ouvre (le site AFFICHE le lien, rien n'est envoyé), le rappel demandé
 * est daté, et la note du lead dit ce qu'il a vu (estimation, format, rappel). Aucun mail, aucun SMS de plus.
 */

const ACTEUR_TUNNEL = { acteur: "SYSTEME:site-tunnel", origine: "Coordonnées laissées après un rendu du simulateur du site" };

export const ACTION_SANS_RAPPEL = "Appeler : simulation faite sur le site";
export const ACTION_AVEC_RAPPEL = "Rappeler";

/** L'événement du dossier qui dit la demande du site (main à Lucas) et, en metadata, à quel parcours le lien a été affiché. */
export const EVENEMENT_DEMANDE_SITE = "ESPACE_DEMANDE_SITE";

/**
 * Le lien affiché sur le site est celui de l'espace PERMANENT du client, rattaché par un téléphone que personne n'a
 * vérifié : si quelqu'un a tapé le numéro d'un autre, tout ce qui rejoindra ce client (projets, devis, adresse) lui
 * serait visible. Le dossier le dit à Lucas, qui vérifie à l'appel et régénère le lien au moindre doute.
 */
export const AVERTISSEMENT_TELEPHONE_NON_VERIFIE =
  "Téléphone non vérifié : si la personne jointe n'a pas fait cette simulation, régénère le lien de son espace (« Nouveau lien ») avant tout devis.";

export type EspaceALEnvoi =
  | { lien: string; dossierId: string }
  /** `contact-connu` : l'espace est ouvert, mais le lien n'est pas affiché (Lucas l'envoie après avoir vérifié qui demande). */
  | { lien: null; dossierId: string | null; raison: "sans-simulation" | "limite" | "desactive" | "contact-connu" | "erreur" };

/** Ce contact a quelque chose à montrer dans son espace : une simulation avec image (rendu du site) ou une photo. */
async function aDeQuoiRemplirLEspace(leadId: string): Promise<boolean> {
  const [simulations, photos] = await Promise.all([
    prisma.simulation.count({ where: { leadId, OR: [{ imageBeforePath: { not: null } }, { imageAfterPath: { not: null } }, { imageOriginalPath: { not: null } }] } }),
    prisma.photoLead.count({ where: { leadId } }),
  ]);
  return simulations + photos > 0;
}

/**
 * Au-delà de deux projets en cours, c'est Lucas qui ouvre (règle de la mission 5) : le site n'ouvre pas un projet de
 * plus. Rien ne s'ouvre non plus quand le lien du client est désactivé. Un dossier vivant qui a déjà son projet dans
 * l'espace ne compte pas : il est simplement rouvert (même lien).
 */
async function refusDOuverture(leadId: string): Promise<"limite" | "desactive" | null> {
  const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { id: true, clientId: true } });
  if (!lead) return null;
  const vivant = await dossierVivant(lead);
  if (vivant && (await prisma.espaceClient.count({ where: { dossierId: vivant, archiveLe: null, revoqueLe: null } })) > 0) return null;
  const clientId = (vivant ? (await prisma.dossier.findUnique({ where: { id: vivant }, select: { clientId: true } }))?.clientId : null) ?? lead.clientId;
  const permanent = clientId ? await prisma.espacePermanent.findUnique({ where: { clientId }, select: { id: true, projetsAccordes: true, revoqueLe: true } }) : null;
  if (!permanent) return null;
  if (permanent.revoqueLe) return "desactive";
  const { peutOuvrirUnProjet } = await import("@/lib/espace/projets");
  return (await peutOuvrirUnProjet(permanent)).possible ? null : "limite";
}

/**
 * Un contact NEUF : rien de lui n'existait avant cette demande — pas d'autre fiche (archivées comprises), pas de dossier,
 * pas d'espace. Seul un contact neuf voit le lien de son espace s'afficher : sinon, quiconque connaît le téléphone ou
 * l'e-mail d'un client ouvrirait son espace (projets, devis, adresse) depuis le site.
 */
async function contactNeuf(leadId: string): Promise<boolean> {
  const lead = await prisma.lead.findFirst({ where: { ...AVEC_ARCHIVES, id: leadId }, select: { clientId: true } });
  if (!lead) return false;
  const [autresLeads, dossiers, espace] = await Promise.all([
    lead.clientId ? prisma.lead.count({ where: { ...AVEC_ARCHIVES, clientId: lead.clientId, id: { not: leadId } } }) : 0,
    prisma.dossier.count({ where: { ...AVEC_ARCHIVES, OR: [{ leadId }, ...(lead.clientId ? [{ clientId: lead.clientId }] : [])] } }),
    lead.clientId ? prisma.espacePermanent.count({ where: { clientId: lead.clientId } }) : 0,
  ]);
  return autresLeads + dossiers + espace === 0;
}

/** Le lien a déjà été affiché à ce parcours (même navigateur) pour ce dossier : un second envoi le rend à nouveau. */
async function dejaAfficheA(dossierId: string, parcoursId: string | undefined): Promise<boolean> {
  if (!parcoursId) return false;
  const evenements = await prisma.dossierEvenement.findMany({ where: { dossierId, type: EVENEMENT_DEMANDE_SITE, metadata: { contains: parcoursId } }, select: { metadata: true } });
  return evenements.some((e) => {
    try {
      const meta = JSON.parse(e.metadata) as { parcoursId?: unknown; lienAffiche?: unknown };
      return meta.parcoursId === parcoursId && meta.lienAffiche === true;
    } catch {
      return false;
    }
  });
}

/**
 * L'espace du contact, ouvert à l'envoi de ses coordonnées (simulateur du site) : le dossier s'ouvre s'il n'en a pas
 * (prochaine action « Rappeler » s'il a demandé un rappel, sinon « Appeler : simulation faite sur le site »), ses
 * simulations y sont rangées. Le lien n'est rendu (pour être AFFICHÉ par le site) qu'à un contact neuf, ou au même
 * parcours qui l'a déjà reçu (idempotent : un second envoi rend le même lien) ; à un contact déjà connu, jamais.
 * Un événement `ESPACE_DEMANDE_SITE` (entrant) le dit au dossier et rend la main à Lucas (il rappelle) ; quand le lien
 * est affiché, il rappelle aussi que le téléphone n'est pas vérifié (`AVERTISSEMENT_TELEPHONE_NON_VERIFIE`).
 * Appelé par le webhook seulement quand le site va AFFICHER le lien (`afficherLienEspace`, formulaire après un rendu).
 * Ne lève jamais : sans espace, le lead reste créé (lien null, raison au journal).
 */
export async function ouvrirEspaceALEnvoi(leadId: string, options: { rappel: boolean; nouveau: boolean; parcoursId?: string }): Promise<EspaceALEnvoi> {
  try {
    if (!(await aDeQuoiRemplirLEspace(leadId))) return { lien: null, dossierId: null, raison: "sans-simulation" };
    const refus = await refusDOuverture(leadId);
    if (refus) {
      console.warn(`[webhook] espace du lead ${leadId} non ouvert par le site : ${refus === "limite" ? "au-delà de deux projets en cours, c'est Lucas qui ouvre" : "lien du client désactivé"}`);
      return { lien: null, dossierId: null, raison: refus };
    }
    // Lu AVANT l'ouverture (qui crée dossier et espace).
    const neuf = options.nouveau && (await contactNeuf(leadId));
    const { ouvrirEspaceDuContact } = await import("@/lib/espace/liens");
    return await avecActeur(ACTEUR_TUNNEL, async () => {
      const ouvert = await ouvrirEspaceDuContact(leadId, { prochaineAction: options.rappel ? ACTION_AVEC_RAPPEL : ACTION_SANS_RAPPEL });
      const affiche = neuf || (await dejaAfficheA(ouvert.dossierId, options.parcoursId));
      await prisma.dossierEvenement.create({
        data: {
          dossierId: ouvert.dossierId,
          type: EVENEMENT_DEMANDE_SITE,
          direction: "ENTRANT",
          contenu: affiche
            ? `Demande laissée sur le site après une simulation : le lien de l'espace lui a été affiché (rien n'a été envoyé). À rappeler. ${AVERTISSEMENT_TELEPHONE_NON_VERIFIE}`
            : "Demande laissée sur le site après une simulation, par un contact déjà connu : le lien de l'espace ne lui a PAS été affiché. L'appeler, puis lui envoyer le lien.",
          metadata: JSON.stringify({ parcoursId: options.parcoursId ?? null, lienAffiche: affiche }),
        },
      });
      const { recalculerMain } = await import("@/lib/dossiers/main");
      await recalculerMain(ouvert.dossierId);
      if (!affiche) {
        console.warn(`[webhook] espace du lead ${leadId} ouvert, lien non affiché : contact déjà connu (dossier ${ouvert.dossierId})`);
        return { lien: null, dossierId: ouvert.dossierId, raison: "contact-connu" as const };
      }
      return { lien: ouvert.lien, dossierId: ouvert.dossierId };
    });
  } catch (erreur) {
    console.error(`[webhook] espace du lead ${leadId} non ouvert (le lead est bien créé) :`, erreur);
    return { lien: null, dossierId: null, raison: "erreur" };
  }
}

/**
 * Le rappel demandé suit le contact : sur son dossier quand il en a un (la règle de la mission 14, `rappelALOuverture` :
 * il y passe si le dossier n'a pas d'autre prochaine action ou un « Rappeler » du même jour), sinon sur le lead
 * (« À rappeler »). Puis l'agenda et la notification 10 minutes avant. Après l'écriture, jamais dans une transaction.
 */
export async function suivreLeRappel(leadId: string): Promise<void> {
  try {
    const { rappelALOuverture, synchroniserRappel } = await import("@/lib/agenda/rappels");
    const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { id: true, clientId: true } });
    const dossierId = lead ? await dossierVivant(lead) : null;
    if (dossierId) await rappelALOuverture(dossierId, leadId);
    else await synchroniserRappel({ type: "LEAD", id: leadId });
  } catch (erreur) {
    console.error(`[webhook] rappel du lead ${leadId} non suivi (il reste sur la fiche) :`, erreur);
  }
}

/** « 1 500 à 1 900 € » ; null sans fourchette lisible. */
export function texteEstimation(min: number | null | undefined, max: number | null | undefined): string | null {
  if (typeof min !== "number" || typeof max !== "number" || min <= 0 || max < min) return null;
  const milliers = (n: number) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return min === max ? `${milliers(min)} €` : `${milliers(min)} à ${milliers(max)} €`;
}

/**
 * Ce que la note du lead ajoute à la demande (une phrase par fait, dans l'ordre) : l'estimation vue et son format, la
 * surface donnée par un pro, le rappel demandé, l'origine de la visite. Rien quand rien n'est connu.
 */
export function complementsDeLaDemande(donnees: { estimationMin?: number | null; estimationMax?: number | null; formatPiece?: string | null; rappelLe?: Date | null; canal?: string | null; pageEntree?: string | null }, maintenant: Date = new Date()): string[] {
  const estimation = texteEstimation(donnees.estimationMin, donnees.estimationMax);
  return [
    estimation ? `Estimation vue sur le site : ${estimation}${donnees.formatPiece ? ` (taille : ${donnees.formatPiece})` : ""}` : null,
    donnees.rappelLe ? `Rappel demandé : ${momentDuRappel(donnees.rappelLe, maintenant, "à")}` : null,
    donnees.canal || donnees.pageEntree ? `Arrivé ${donnees.canal ? `par ${donnees.canal}` : "en direct"}${donnees.pageEntree ? `, sur ${donnees.pageEntree}` : ""}` : null,
  ].filter((ligne): ligne is string => ligne !== null);
}
