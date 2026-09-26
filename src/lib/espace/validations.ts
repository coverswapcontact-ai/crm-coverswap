import type { EspaceClient } from "@prisma/client";
import prisma from "@/lib/prisma";
import { ErreurMetier } from "@/lib/commun/erreurs";
import { avecActeur } from "@/lib/journal/contexte";
import { alerter } from "@/lib/alertes/canaux";
import { idPhoto, lirePhotos } from "@/lib/dossiers/stockage";
import { appliquerChangementEtape, effetsDuChangementEtape, type ChangementEtape } from "@/lib/dossiers/transitions";
import type { EtapeDossier } from "@/lib/dossiers/constants";
import { objetDepuisFamilles } from "@/lib/dossiers/objet";
import { famillesDe } from "@/lib/prestations/prestations";
import { lireProjet, projetComplet, resumerProjet, type ProjetClient } from "./projet";
import { lireSelection } from "@/lib/prestations/prestations";

/**
 * Valider, dévalider, revalider — et tout ce qui se défait dans l'espace client.
 *
 * Chaque geste existe deux fois : fait par le CLIENT dans son espace, ou par
 * LUCAS à sa place depuis le CRM. Les deux passent ICI, écrivent le même
 * événement dans le dossier (avec qui l'a fait), déplacent le dossier dans le
 * même sens, et se défont de la même façon. L'historique garde l'aller et le
 * retour ; rien n'est effacé (une photo retirée reste sur le disque, un accord
 * retiré garde sa preuve, annotée).
 */

export type Auteur = "CLIENT" | "LUCAS";

const ACTEUR_CLIENT = { acteur: "EXTERNE:espace-client", origine: "espace-client" } as const;
const appUrl = () => (process.env.NEXT_PUBLIC_APP_URL || "https://crm.coverswap.fr").replace(/\/$/, "");

/** Le client n'a pas de session (acteur nommé) ; Lucas agit avec la sienne (le journal la connaît déjà). */
async function ecrire<T>(auteur: Auteur, travail: () => Promise<T>): Promise<T> {
  return auteur === "CLIENT" ? avecActeur(ACTEUR_CLIENT, travail) : travail();
}

const par = (auteur: Auteur) => (auteur === "CLIENT" ? "par le client" : "par Lucas, à la place du client");
const direction = (auteur: Auteur) => (auteur === "CLIENT" ? "ENTRANT" : "INTERNE");

async function prevenir(dossierId: string, titre: string, texte: string, urgence: 1 | 2 | 3 | 4 | 5, telephone?: string | null): Promise<void> {
  await alerter(
    { titre, texte, lien: `${appUrl()}/dossiers?dossier=${dossierId}`, libelleLien: "Ouvrir le dossier", telephone: telephone || undefined, urgence, etiquette: `espace-${dossierId}` },
    { origine: "espace-client", canaux: ["telegram", "ntfy", "pushweb"] }
  ).catch((erreur) => console.error(`[espace] alerte « ${titre} » non envoyée :`, erreur));
}

async function dossierDe(dossierId: string) {
  const dossier = await prisma.dossier.findUnique({ where: { id: dossierId }, select: { id: true, etape: true, clientNom: true, clientTelephone: true, prochaineAction: true, photos: true, prestations: true, objet: true, source: true, lead: { select: { typeProjet: true } } } });
  if (!dossier) throw new ErreurMetier("Projet introuvable.", 404);
  return dossier;
}

/** Déplace le dossier (avant ou arrière) à cause d'un geste de l'espace ; ne fait rien si l'étape n'est plus celle attendue. */
async function deplacerDossier(dossierId: string, de: EtapeDossier, vers: EtapeDossier, nature: "AUTOMATIQUE" | "RETOUR", raison: string): Promise<ChangementEtape | null> {
  try {
    const changement = await prisma.$transaction((tx) => appliquerChangementEtape(tx, { dossierId, de, vers, nature, raison }));
    await effetsDuChangementEtape(changement);
    return changement;
  } catch (erreur) {
    // L'étape a bougé entre-temps (Lucas a la main) : le geste du client reste enregistré, le dossier n'est pas forcé.
    console.warn(`[espace] dossier ${dossierId} non déplacé ${de} → ${vers} :`, erreur instanceof Error ? erreur.message : erreur);
    return null;
  }
}

/** Raison écrite dans le changement d'étape : c'est elle qui permet de défaire exactement ce mouvement-là. */
export const RAISON_PROJET_VALIDE = "projet validé dans l'espace client";
export const RAISON_PROJET_DEVALIDE = "projet dévalidé dans l'espace client";
export const RAISON_ACCORD_RETIRE = "bon pour accord retiré";

async function dernierMouvement(dossierId: string): Promise<{ vers?: string; raison?: string } | null> {
  const dernier = await prisma.dossierEvenement.findFirst({ where: { dossierId, type: "CHANGEMENT_ETAPE" }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { metadata: true } });
  try {
    return dernier ? (JSON.parse(dernier.metadata || "{}") as { vers?: string; raison?: string }) : null;
  } catch {
    return null;
  }
}

/* ── Le projet ─────────────────────────────────────────────────────── */

export async function validerProjet(espace: EspaceClient, auteur: Auteur): Promise<void> {
  const dossier = await dossierDe(espace.dossierId);
  const projet = lireProjet(espace.souhaits, lireSelection(dossier.prestations), dossier.lead?.typeProjet);
  const manque = projetComplet(projet);
  if (manque) throw new ErreurMetier(manque, 400, { raison: "incomplet" });
  if (espace.projetValideLe) return;
  const maintenant = new Date();
  await ecrire(auteur, async () => {
    await prisma.espaceClient.update({ where: { id: espace.id }, data: { projetValideLe: maintenant, projetValidePar: auteur } });
    await prisma.dossierEvenement.create({ data: { dossierId: espace.dossierId, type: "ESPACE_PROJET_VALIDE", direction: direction(auteur), contenu: `Projet validé ${par(auteur)} : ${resumerProjet(projet)}`.slice(0, 1500), metadata: JSON.stringify({ auteur, projet }) } });
    if (!dossier.prochaineAction || /attendre (les photos|qu'il|le projet)/i.test(dossier.prochaineAction)) {
      await prisma.dossier.update({ where: { id: espace.dossierId }, data: { prochaineAction: "Suivre ses simulations, ou lui en préparer une (projet validé)", prochaineActionDate: maintenant } });
    }
    // Mission 13 (B3) : un dossier ouvert sans objet ni source le reçoit du projet validé — ce que le client veut rénover,
    // venu de son espace. Un objet ou une source déjà écrits ne bougent pas.
    const complement = complementDuDossier(dossier, projet);
    if (complement) await prisma.dossier.update({ where: { id: espace.dossierId }, data: complement });
  });
  if (dossier.etape === "QUALIFICATION") await ecrire(auteur, () => deplacerDossier(espace.dossierId, "QUALIFICATION", "SIMULATION", "AUTOMATIQUE", RAISON_PROJET_VALIDE));
  if (auteur === "CLIENT") await prevenir(espace.dossierId, `Projet validé — ${dossier.clientNom}`, resumerProjet(projet), 3, dossier.clientTelephone);
}

/** Objet et source qui manquent au dossier, d'après le projet validé (mission 13, B3). Pure. */
export function complementDuDossier(dossier: { objet: string; source: string }, projet: Pick<ProjetClient, "familles"> | null): { objet?: string; source?: "ESPACE_CLIENT" } | null {
  const complement: { objet?: string; source?: "ESPACE_CLIENT" } = {};
  const objet = projet ? objetDepuisFamilles(famillesDe(projet.familles)) : "";
  if (!dossier.objet.trim() && objet) complement.objet = objet;
  if (dossier.source === "INCONNUE") complement.source = "ESPACE_CLIENT";
  return Object.keys(complement).length ? complement : null;
}

/** Le projet redevient modifiable : la pastille verte tombe, et le dossier recule s'il n'avait avancé que pour ça. */
export async function devaliderProjet(espace: EspaceClient, auteur: Auteur, motif = "pour le modifier"): Promise<void> {
  if (!espace.projetValideLe) return;
  const dossier = await dossierDe(espace.dossierId);
  await ecrire(auteur, async () => {
    await prisma.espaceClient.update({ where: { id: espace.id }, data: { projetValideLe: null, projetValidePar: null } });
    await prisma.dossierEvenement.create({ data: { dossierId: espace.dossierId, type: "ESPACE_PROJET_DEVALIDE", direction: direction(auteur), contenu: `Projet dévalidé ${par(auteur)} (${motif})`, metadata: JSON.stringify({ auteur }) } });
    // La prochaine action posée par la validation ne vaut plus.
    if (dossier.prochaineAction && /\(projet validé\)/i.test(dossier.prochaineAction)) {
      await prisma.dossier.update({ where: { id: espace.dossierId }, data: { prochaineAction: "Attendre qu'il valide son projet (il le modifie)", prochaineActionDate: null } });
    }
  });
  // Recul : seulement si le dossier est encore là où la validation l'avait mis, et que rien d'autre ne l'y retient.
  if (dossier.etape === "SIMULATION" && !espace.choixLe) {
    const mouvement = await dernierMouvement(espace.dossierId);
    if (mouvement?.vers === "SIMULATION" && mouvement.raison === RAISON_PROJET_VALIDE) {
      await ecrire(auteur, () => deplacerDossier(espace.dossierId, "SIMULATION", "QUALIFICATION", "RETOUR", RAISON_PROJET_DEVALIDE));
    }
  }
}

/* ── La simulation validée ─────────────────────────────────────────── */

export async function devisEmis(dossierId: string): Promise<boolean> {
  return (await prisma.document.count({ where: { dossierId, type: "DEVIS", archiveLe: null, numero: { not: null }, statut: { in: ["GENERE", "ENVOYE", "ACCEPTE"] } } })) > 0;
}

/** Il revient sur sa simulation validée : l'onglet Devis se referme, « préparer le devis » n'est plus à faire. */
export async function devaliderChoix(espace: EspaceClient, auteur: Auteur): Promise<void> {
  if (!espace.choixLe) return;
  if (auteur === "CLIENT" && (await devisEmis(espace.dossierId))) {
    throw new ErreurMetier("Votre devis est déjà établi sur la simulation validée. Pour en changer, appelez CoverSwap : nous l'ajustons avec vous.", 409, { raison: "devis-emis" });
  }
  const dossier = await dossierDe(espace.dossierId);
  await ecrire(auteur, async () => {
    await prisma.$transaction([
      prisma.simulationEspace.updateMany({ where: { espaceId: espace.id, choisieLe: { not: null } }, data: { choisieLe: null } }),
      prisma.espaceClient.update({ where: { id: espace.id }, data: { choix: null, choixLe: null } }),
      prisma.dossierEvenement.create({ data: { dossierId: espace.dossierId, type: "ESPACE_SIMULATION_DEVALIDEE", direction: direction(auteur), contenu: `Simulation dévalidée ${par(auteur)} : plus aucune simulation n'est validée`, metadata: JSON.stringify({ auteur, choixPrecedent: espace.choix ? (JSON.parse(espace.choix) as unknown) : null }) } }),
      ...(dossier.prochaineAction && /préparer le devis \(simulation/i.test(dossier.prochaineAction) ? [prisma.dossier.update({ where: { id: espace.dossierId }, data: { prochaineAction: "Attendre qu'il valide une simulation (il a dévalidé la sienne)", prochaineActionDate: null } })] : []),
    ]);
  });
  if (auteur === "CLIENT") await prevenir(espace.dossierId, `Simulation dévalidée — ${dossier.clientNom}`, "Le client est revenu sur la simulation qu'il avait validée. Le devis n'est plus attendu pour l'instant.", 3, dossier.clientTelephone);
}

/* ── La demande d'autre proposition ───────────────────────────────── */

export async function retirerDemandeProposition(espace: EspaceClient, auteur: Auteur): Promise<void> {
  if (!espace.propositionDemandeeLe) return;
  const dossier = await dossierDe(espace.dossierId);
  await ecrire(auteur, async () => {
    await prisma.$transaction([
      prisma.espaceClient.update({ where: { id: espace.id }, data: { propositionDemandeeLe: null, propositionMessage: null, propositionSimulationId: null } }),
      prisma.dossierEvenement.create({ data: { dossierId: espace.dossierId, type: "ESPACE_PROPOSITION_RETIREE", direction: direction(auteur), contenu: `Demande d'autre proposition retirée ${par(auteur)}${espace.propositionMessage ? ` (elle disait : « ${espace.propositionMessage} »)` : ""}`.slice(0, 1500), metadata: JSON.stringify({ auteur, message: espace.propositionMessage ?? null }) } }),
      ...(dossier.prochaineAction && /autre proposition/i.test(dossier.prochaineAction)
        ? [prisma.dossier.update({ where: { id: espace.dossierId }, data: espace.choixLe ? { prochaineAction: "Préparer le devis (simulation choisie)", prochaineActionDate: new Date() } : { prochaineAction: null, prochaineActionDate: null } })]
        : []),
    ]);
  });
}

/* ── Les photos ────────────────────────────────────────────────────── */

export type PhotoRetiree = { id: string; chemin: string; le: string; par: Auteur };

export function lirePhotosRetirees(json: string | null | undefined): PhotoRetiree[] {
  try {
    const valeur: unknown = JSON.parse(json ?? "[]");
    return Array.isArray(valeur) ? valeur.filter((p): p is PhotoRetiree => !!p && typeof p === "object" && typeof (p as PhotoRetiree).chemin === "string" && typeof (p as PhotoRetiree).id === "string") : [];
  } catch {
    return [];
  }
}

/**
 * Le client retire une photo : elle sort de la liste du dossier (et donc de son
 * espace et du simulateur), mais le fichier ne bouge pas — Lucas la voit dans
 * « photos retirées » et peut la remettre. Refusé pendant qu'une simulation
 * en cours s'appuie dessus.
 */
export async function retirerPhoto(espace: EspaceClient, photoId: string, auteur: Auteur): Promise<void> {
  const dossier = await dossierDe(espace.dossierId);
  const chemins = lirePhotos(dossier.photos);
  const chemin = chemins.find((c) => idPhoto(c) === photoId);
  if (!chemin) throw new ErreurMetier("Cette photo n'est plus dans votre espace.", 404);
  if (auteur === "CLIENT") {
    const { photosDuClient } = await import("./service");
    const siennes = await photosDuClient(espace.dossierId, dossier.photos);
    if (!siennes.some((p) => p.id === photoId)) throw new ErreurMetier("Cette photo ne peut pas être retirée d'ici.", 403);
  }
  const enCours = await prisma.preparationSimulation.count({ where: { dossierId: espace.dossierId, photoSource: chemin, statut: "EN_COURS", createdAt: { gte: new Date(Date.now() - 30 * 60_000) } } });
  if (enCours > 0) throw new ErreurMetier("Une simulation est en cours de création sur cette photo : attendez qu'elle soit terminée.", 409);
  const retirees = [...lirePhotosRetirees(espace.photosRetirees), { id: photoId, chemin, le: new Date().toISOString(), par: auteur }];
  await ecrire(auteur, async () => {
    const { count } = await prisma.dossier.updateMany({ where: { id: espace.dossierId, photos: dossier.photos }, data: { photos: JSON.stringify(chemins.filter((c) => c !== chemin)) } });
    if (count === 0) throw new ErreurMetier("Vos photos ont changé entre-temps : réessayez.", 409);
    await prisma.espaceClient.update({ where: { id: espace.id }, data: { photosRetirees: JSON.stringify(retirees) } });
    await prisma.dossierEvenement.create({ data: { dossierId: espace.dossierId, type: "ESPACE_PHOTO_RETIREE", direction: direction(auteur), contenu: `Photo retirée ${par(auteur)} (gardée : elle se remet depuis le bloc Espace client du dossier) — il en reste ${chemins.length - 1}`, metadata: JSON.stringify({ auteur, photoId, chemin }) } });
  });
}

/** Lucas remet une photo que le client avait retirée. */
export async function remettrePhoto(espaceId: string, photoId: string): Promise<void> {
  const espace = await prisma.espaceClient.findUnique({ where: { id: espaceId } });
  if (!espace) throw new ErreurMetier("Espace introuvable.", 404);
  const retirees = lirePhotosRetirees(espace.photosRetirees);
  const photo = retirees.find((p) => p.id === photoId);
  if (!photo) throw new ErreurMetier("Photo retirée introuvable.", 404);
  const dossier = await dossierDe(espace.dossierId);
  const chemins = lirePhotos(dossier.photos);
  if (!chemins.includes(photo.chemin)) {
    const { count } = await prisma.dossier.updateMany({ where: { id: espace.dossierId, photos: dossier.photos }, data: { photos: JSON.stringify([...chemins, photo.chemin]) } });
    if (count === 0) throw new ErreurMetier("Les photos ont changé entre-temps : recharge le dossier.", 409);
  }
  await prisma.espaceClient.update({ where: { id: espace.id }, data: { photosRetirees: JSON.stringify(retirees.filter((p) => p.id !== photoId)) } });
  await prisma.dossierEvenement.create({ data: { dossierId: espace.dossierId, type: "ESPACE_PHOTO_REMISE", direction: "INTERNE", contenu: "Photo retirée par le client remise dans le dossier par Lucas", metadata: JSON.stringify({ photoId, chemin: photo.chemin }) } });
}

/* ── Le bon pour accord ───────────────────────────────────────────── */

/**
 * Retirer un bon pour accord. Le client le peut tant que rien n'est encaissé
 * et que le chantier n'est pas planifié (au-delà : un appel). La preuve de
 * l'accord reste en base, annotée « retiré le … par … » ; le dossier revient à
 * « Devis envoyé », le devis redevient un devis émis ; Lucas est prévenu fort.
 */
export async function retirerAccord(espace: EspaceClient, auteur: Auteur, motif = ""): Promise<{ retire: boolean }> {
  const accord = await prisma.accordDevis.findFirst({ where: { dossierId: espace.dossierId, retireLe: null }, orderBy: { createdAt: "desc" } });
  if (!accord) return { retire: false };
  const dossier = await dossierDe(espace.dossierId);
  if (auteur === "CLIENT") {
    const encaisse = await prisma.encaissement.count({ where: { dossierId: espace.dossierId, statut: "VALIDE" } });
    if (encaisse > 0 || dossier.etape !== "SIGNE") {
      throw new ErreurMetier("Votre projet est déjà engagé (paiement reçu ou chantier planifié). Pour revenir sur votre accord, appelez CoverSwap.", 409, { raison: "engage" });
    }
  }
  const maintenant = new Date();
  await ecrire(auteur, async () => {
    await prisma.accordDevis.update({ where: { id: accord.id }, data: { retireLe: maintenant, retirePar: auteur, retireMotif: motif.slice(0, 500) || null } });
    // Mission 11 : les devis écartés au moment de l'accord redeviennent au choix.
    const rendus = await prisma.document.updateMany({ where: { dossierId: espace.dossierId, type: "DEVIS", statut: "NON_RETENU" }, data: { statut: "ENVOYE" } });
    await prisma.dossierEvenement.create({ data: { dossierId: espace.dossierId, type: "ESPACE_ACCORD_RETIRE", direction: direction(auteur), contenu: `Bon pour accord sur le devis ${accord.numeroDevis ?? ""} retiré ${par(auteur)}${motif ? ` : « ${motif} »` : ""}. La preuve de l'accord du ${accord.createdAt.toLocaleDateString("fr-FR", { timeZone: "Europe/Paris" })} est gardée.${rendus.count ? ` Les ${rendus.count} autre(s) devis proposé(s) redeviennent au choix.` : ""}`.slice(0, 1500), metadata: JSON.stringify({ auteur, accordId: accord.id, documentId: accord.documentId, rendus: rendus.count }) } });
    await prisma.dossier.update({ where: { id: espace.dossierId }, data: { prochaineAction: auteur === "CLIENT" ? "Appeler : il a retiré son bon pour accord" : "Refaire signer le devis", prochaineActionDate: maintenant } });
  });
  if (dossier.etape === "SIGNE") await ecrire(auteur, () => deplacerDossier(espace.dossierId, "SIGNE", "DEVIS_ENVOYE", "RETOUR", `${RAISON_ACCORD_RETIRE} ${par(auteur)}`));
  if (auteur === "CLIENT") await prevenir(espace.dossierId, `ACCORD RETIRÉ — ${dossier.clientNom}`, `Le client a retiré son bon pour accord sur le devis ${accord.numeroDevis ?? ""}${motif ? ` : « ${motif} »` : ""}.\nÀ vous : l'appeler.`, 5, dossier.clientTelephone);
  return { retire: true };
}

/**
 * Le dossier recule avant « Signé » depuis le CRM : l'accord en ligne ne vaut
 * plus (sinon l'espace dirait « signé » quand le dossier dit « devis envoyé »).
 * Appelé dans la transaction du changement d'étape.
 */
export async function retirerAccordsDuDossier(tx: { accordDevis: typeof prisma.accordDevis }, dossierId: string, motif: string): Promise<number> {
  const { count } = await tx.accordDevis.updateMany({ where: { dossierId, retireLe: null }, data: { retireLe: new Date(), retirePar: "LUCAS", retireMotif: motif } });
  return count;
}
