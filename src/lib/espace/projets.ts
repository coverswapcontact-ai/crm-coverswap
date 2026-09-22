import type { EspaceClient, EspacePermanent } from "@prisma/client";
import { z } from "zod/v4";
import prisma, { type Transaction } from "@/lib/prisma";
import { ErreurMetier } from "@/lib/commun/erreurs";
import { avecActeur } from "@/lib/journal/contexte";
import { jourParis } from "@/lib/dossiers/dates";
import { ouvrirDossier } from "@/lib/dossiers/dossiers";
import { enregistrerPrestations } from "@/lib/prestations/dossier";
import { IDS_FAMILLE, libellesFamilles, type IdFamille } from "@/lib/prestations/prestations";
import { ACTEUR, prevenir } from "./alertes";
import { codeLibre, JAMAIS } from "./liens";
import type { EtapeEspace } from "./etapes";

/**
 * Les PROJETS d'un espace permanent (mission 5) : un projet = un dossier, vu
 * par le client. Ce module dit lesquels il voit, lesquels sont en cours, figés
 * (terminé, non réalisé), et ouvre ceux qu'il crée lui-même — un client qui
 * revient, pas un lead : le dossier s'ouvre sur SA fiche, avec ses coordonnées.
 */

/** Au-delà, le client demande à Lucas (anti-abus : chaque projet offre ses simulations). */
export const LIMITE_PROJETS_EN_COURS = 2;

/** Un projet se fige quand il est terminé et encaissé, ou abandonné. Figé : il se consulte, il ne se modifie plus. */
export type Fige = "TERMINE" | "NON_REALISE";
export function figeDuProjet(etapeDossier: string): Fige | null {
  if (etapeDossier === "ENCAISSE") return "TERMINE";
  if (etapeDossier === "PERDU") return "NON_REALISE";
  return null;
}

export const MESSAGE_FIGE: Record<Fige, string> = {
  TERMINE: "Ce projet est terminé : il se consulte, il ne se modifie plus. Pour autre chose, ouvrez un nouveau projet.",
  NON_REALISE: "Ce projet n'a pas été réalisé : il se consulte, il ne se modifie plus. Pour le relancer, appelez CoverSwap ou ouvrez un nouveau projet.",
};

/** Ce que le client voit d'un coup d'œil sur la carte d'un projet. */
export type PastilleProjet = "A_VOUS" | "COVERSWAP" | "EN_COURS" | "TERMINE" | "NON_REALISE";
export const LIBELLES_PASTILLE: Record<PastilleProjet, string> = {
  A_VOUS: "À votre tour",
  COVERSWAP: "Chez CoverSwap",
  EN_COURS: "En cours",
  TERMINE: "Terminé",
  NON_REALISE: "Non réalisé",
};

/** La pastille et la prochaine action d'un projet, dites au client (une phrase courte, jamais de jargon). */
export function pastilleDuProjet(entree: { etape: EtapeEspace; etapeDossier: string; dateChantier: Date | null; soldeDu: boolean; enCoursCreation: boolean }): { pastille: PastilleProjet; prochaine: string | null } {
  const fige = figeDuProjet(entree.etapeDossier);
  if (fige === "TERMINE") return { pastille: "TERMINE", prochaine: null };
  if (fige === "NON_REALISE") return { pastille: "NON_REALISE", prochaine: null };
  const date = entree.dateChantier ? entree.dateChantier.toLocaleDateString("fr-FR", { timeZone: "Europe/Paris", day: "numeric", month: "long" }) : null;
  switch (entree.etape) {
    case "PHOTOS":
      return { pastille: "A_VOUS", prochaine: "Envoyez vos photos" };
    case "PROJET":
      return { pastille: "A_VOUS", prochaine: "Précisez et validez votre projet" };
    case "SIMULATIONS":
      return entree.enCoursCreation ? { pastille: "COVERSWAP", prochaine: "Votre simulation arrive" } : { pastille: "A_VOUS", prochaine: "Créez ou validez une simulation" };
    case "ATTENTE_SIMULATION":
      return { pastille: "COVERSWAP", prochaine: "CoverSwap prépare votre simulation" };
    case "ATTENTE_DEVIS":
      return { pastille: "COVERSWAP", prochaine: "CoverSwap prépare votre devis" };
    case "DEVIS":
      return { pastille: "A_VOUS", prochaine: "Votre devis est prêt" };
    case "ACOMPTE":
      return { pastille: "A_VOUS", prochaine: "Acompte à régler" };
    case "CHANTIER":
      return date ? { pastille: "EN_COURS", prochaine: `Chantier le ${date}` } : { pastille: "COVERSWAP", prochaine: "CoverSwap vous appelle pour fixer la date" };
    case "TERMINE":
      return entree.soldeDu ? { pastille: "A_VOUS", prochaine: "Solde à régler" } : { pastille: "EN_COURS", prochaine: "Chantier terminé" };
  }
}

type Lecteur = Transaction | typeof prisma;

/** Les projets que le client voit : ceux de son espace, hors dossier archivé et projet désactivé. */
export async function projetsVisibles(client: Lecteur, permanentId: string): Promise<(EspaceClient & { dossier: { id: string; etape: string; objet: string; createdAt: Date; ouvertLe: Date | null; dateChantier: Date | null; prestations: string | null } })[]> {
  return client.espaceClient.findMany({
    where: { permanentId, archiveLe: null, revoqueLe: null, dossier: { archiveLe: null } },
    orderBy: { createdAt: "asc" },
    include: { dossier: { select: { id: true, etape: true, objet: true, createdAt: true, ouvertLe: true, dateChantier: true, prestations: true } } },
  });
}

/** Combien de projets du client sont en cours (ni terminés, ni abandonnés). */
export async function projetsEnCours(client: Lecteur, permanentId: string): Promise<number> {
  const projets = await projetsVisibles(client, permanentId);
  return projets.filter((p) => !figeDuProjet(p.dossier.etape)).length;
}

export async function peutOuvrirUnProjet(permanent: Pick<EspacePermanent, "id" | "projetsAccordes">): Promise<{ possible: boolean; enCours: number; limite: number }> {
  const enCours = await projetsEnCours(prisma, permanent.id);
  const limite = LIMITE_PROJETS_EN_COURS + (permanent.projetsAccordes ?? 0);
  return { possible: enCours < limite, enCours, limite };
}

export const schemaNouveauProjet = z.object({
  nom: z.string("Donnez un nom à votre projet.").trim().min(2, "Donnez un nom à votre projet, par exemple « La salle de bain ».").max(60, "Nom trop long : 60 caractères au plus."),
  familles: z.array(z.enum(IDS_FAMILLE, "Choisissez ce que vous voulez rénover.")).min(1, "Choisissez ce que vous voulez rénover.").max(4),
});

/**
 * Le client crée un projet depuis son espace. Un dossier s'ouvre sur SA fiche
 * (Qualification, source « espace client », sans lead : ce n'est pas un nouveau
 * contact), avec les coordonnées de son dernier dossier ; la famille cochée y est
 * écrite ; Lucas est prévenu — un client qui revient, c'est ce qu'il y a de plus
 * précieux. Au-delà de deux projets en cours, refusé : il le demande à Lucas.
 */
export async function creerProjetClient(permanent: EspacePermanent, entree: z.output<typeof schemaNouveauProjet>): Promise<{ projet: EspaceClient; dossierId: string }> {
  const place = await peutOuvrirUnProjet(permanent);
  if (!place.possible) {
    throw new ErreurMetier(`Vous avez déjà ${place.enCours} projets en cours. Pour en ouvrir un de plus, demandez-le à CoverSwap : un geste suffit.`, 409, { raison: "limite" });
  }
  const [client, dernier] = await Promise.all([
    prisma.client.findUnique({ where: { id: permanent.clientId }, include: { emails: { where: { archiveLe: null }, orderBy: [{ principale: "desc" }, { createdAt: "asc" }], take: 1 }, telephones: { where: { archiveLe: null }, orderBy: [{ principal: "desc" }, { createdAt: "asc" }], take: 1 } } }),
    prisma.dossier.findFirst({ where: { clientId: permanent.clientId }, orderBy: { createdAt: "desc" } }),
  ]);
  if (!client) throw new ErreurMetier("Votre espace n'est plus rattaché à une fiche : appelez CoverSwap.", 409);
  const familles = [...new Set(entree.familles)] as IdFamille[];
  const maintenant = new Date();
  const { projet, dossierId } = await avecActeur(ACTEUR, () =>
    prisma.$transaction(async (tx) => {
      const dossier = await ouvrirDossier(
        tx,
        {
          clientNom: dernier?.clientNom ?? client.nom,
          clientAdresse: dernier?.clientAdresse ?? client.adresse ?? "",
          clientCp: dernier?.clientCp ?? client.codePostal ?? "",
          clientVille: dernier?.clientVille ?? client.ville ?? "",
          clientEmail: dernier?.clientEmail ?? client.emails[0]?.adresse ?? null,
          clientTelephone: dernier?.clientTelephone ?? client.telephones[0]?.numero ?? "",
          objet: entree.nom,
          source: "ESPACE_CLIENT",
          prochaineAction: "Appeler : nouveau projet",
          prochaineActionDate: jourParis(maintenant),
          clientId: permanent.clientId,
        },
        { leadId: null, prospectId: null }
      );
      await enregistrerPrestations(dossier.id, Object.fromEntries(familles.map((f) => [f, []])), "CLIENT", tx);
      const projet = await tx.espaceClient.create({
        data: { code: await codeLibre(tx), dossierId: dossier.id, expireLe: JAMAIS, permanentId: permanent.id, nomProjet: entree.nom, premierAccesLe: maintenant, dernierAccesLe: maintenant, nbAcces: 1 },
      });
      await tx.dossierEvenement.create({
        data: { dossierId: dossier.id, type: "ESPACE_NOUVEAU_PROJET", direction: "ENTRANT", contenu: `Nouveau projet créé par le client dans son espace : « ${entree.nom} » (${libellesFamilles(familles)}). Un client qui revient.`, metadata: JSON.stringify({ espaceId: projet.id, permanentId: permanent.id, familles }) },
      });
      return { projet, dossierId: dossier.id };
    })
  );
  await prevenir(
    dossierId,
    { titre: `Nouveau projet — ${dernier?.clientNom ?? client.nom}`, texte: `Un client qui revient ouvre un projet dans son espace : « ${entree.nom} » (${libellesFamilles(familles)}).\nÀ vous : l'appeler.`, urgence: 5, telephone: dernier?.clientTelephone ?? client.telephones[0]?.numero ?? null, etiquette: `nouveau-projet-${dossierId}` },
    "espace-nouveau-projet"
  );
  return { projet, dossierId };
}

/** Le dossier le plus récent du client, pour y écrire ce qui concerne tout son espace. */
async function dossierDeReference(permanentId: string): Promise<{ id: string; clientNom: string; clientTelephone: string } | null> {
  const projets = await projetsVisibles(prisma, permanentId);
  const enCours = projets.filter((p) => !figeDuProjet(p.dossier.etape));
  const choisi = (enCours.length ? enCours : projets).at(-1);
  if (!choisi) return null;
  return prisma.dossier.findUnique({ where: { id: choisi.dossierId }, select: { id: true, clientNom: true, clientTelephone: true } });
}

/** « Demander à CoverSwap » : il voudrait un projet de plus. Noté, Lucas prévenu ; il accorde d'un clic. */
export async function demanderProjetDePlus(permanent: EspacePermanent): Promise<void> {
  const dossier = await dossierDeReference(permanent.id);
  await avecActeur(ACTEUR, async () => {
    await prisma.espacePermanent.update({ where: { id: permanent.id }, data: { projetDemandeLe: new Date() } });
    if (dossier) await prisma.dossierEvenement.create({ data: { dossierId: dossier.id, type: "ESPACE_PROJET_DEMANDE", direction: "ENTRANT", contenu: "Le client demande à ouvrir un projet de plus dans son espace (il en a déjà deux en cours).", metadata: JSON.stringify({ permanentId: permanent.id }) } });
  });
  if (dossier) await prevenir(dossier.id, { titre: `${dossier.clientNom} voudrait un projet de plus`, texte: "Il a déjà deux projets en cours dans son espace. Accordez-en un de plus en un clic (fiche client ou Espaces clients), ou appelez-le.", urgence: 4, telephone: dossier.clientTelephone, etiquette: `projet-demande-${permanent.id}` });
}

/** Lucas accorde des projets en cours de plus : la demande est close. */
export async function accorderProjets(permanentId: string, nombre = 1): Promise<{ projetsAccordes: number }> {
  if (!Number.isInteger(nombre) || nombre < 1 || nombre > 5) throw new ErreurMetier("Nombre de projets invalide (1 à 5).", 400);
  const mis = await prisma.espacePermanent.update({ where: { id: permanentId }, data: { projetsAccordes: { increment: nombre }, projetDemandeLe: null } });
  const dossier = await dossierDeReference(permanentId);
  if (dossier) await prisma.dossierEvenement.create({ data: { dossierId: dossier.id, type: "ESPACE_PROJET_ACCORDE", direction: "SORTANT", contenu: `${nombre} projet${nombre > 1 ? "s" : ""} en cours de plus accordé${nombre > 1 ? "s" : ""} au client dans son espace.`, metadata: JSON.stringify({ permanentId, nombre }) } });
  return { projetsAccordes: mis.projetsAccordes };
}
