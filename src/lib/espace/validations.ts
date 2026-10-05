import type { EspaceClient } from "@prisma/client";
import prisma from "@/lib/prisma";
import { ErreurMetier } from "@/lib/commun/erreurs";
import { avecActeur } from "@/lib/journal/contexte";
import { alerter } from "@/lib/alertes/canaux";
import { idPhoto, lirePhotos } from "@/lib/dossiers/stockage";
import { appliquerChangementEtape, effetsDuChangementEtape, type ChangementEtape } from "@/lib/dossiers/transitions";
import type { EtapeDossier } from "@/lib/dossiers/constants";
import { objetDepuisFamilles, objetDepuisProjet } from "@/lib/dossiers/objet";
import { famillesDe } from "@/lib/prestations/prestations";
import { lireProjet, projetComplet, resumerProjet, type ProjetClient } from "./projet";
import { lireSelection } from "@/lib/prestations/prestations";
import type { Transaction } from "@/lib/prisma";
import { appliquerEvenementDossier, RAISON_PROJET_VALIDE, suitesEvenementDossier, type Suites } from "@/lib/dossiers/synchro";
import { estAvenant } from "./faits";

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
  const dossier = await prisma.dossier.findUnique({ where: { id: dossierId }, select: { id: true, etape: true, clientNom: true, clientTelephone: true, prochaineAction: true, photos: true, prestations: true, objet: true, objetManuelLe: true, source: true, lead: { select: { typeProjet: true } } } });
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

/**
 * Raison écrite dans le changement d'étape : c'est elle qui permet de défaire exactement ce mouvement-là. Mission 18
 * (B9) : le passage en Simulation du projet validé est écrit par le point d'entrée (synchro.ts), dans la transaction.
 */
export { RAISON_PROJET_VALIDE };
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
  const suites = await ecrire(auteur, () =>
    prisma.$transaction(async (tx) => {
      await tx.espaceClient.update({ where: { id: espace.id }, data: { projetValideLe: maintenant, projetValidePar: auteur } });
      await tx.dossierEvenement.create({ data: { dossierId: espace.dossierId, type: "ESPACE_PROJET_VALIDE", direction: direction(auteur), contenu: `Projet validé ${par(auteur)} : ${resumerProjet(projet)}`.slice(0, 1500), metadata: JSON.stringify({ auteur, projet }) } });
      // Mission 13 (B3) : un dossier ouvert sans objet ni source le reçoit du projet validé — ce que le client veut rénover,
      // venu de son espace. Une source déjà écrite ne bouge pas.
      // Mission 14 (R3) : l'objet suit la famille validée (même s'il venait du lead), sauf si Lucas l'a écrit à la main.
      const complement = { ...complementDuDossier(dossier, projet), ...objetSuivi(dossier, projet) };
      if (Object.keys(complement).length) await tx.dossier.update({ where: { id: espace.dossierId }, data: complement });
      return appliquerEvenementDossier(tx, espace.dossierId, { type: "PROJET_VALIDE" }, maintenant);
    })
  );
  // Mission 18 (B9) : Qualification → Simulation est écrit dans la transaction, par le point d'entrée (PROJET_VALIDE).
  await suitesEvenementDossier(suites);
  if (auteur === "CLIENT") await prevenir(espace.dossierId, `Projet validé — ${dossier.clientNom}`, resumerProjet(projet), 3, dossier.clientTelephone);
}

/** Mission 14 (R3) : l'objet d'après le projet validé, s'il change et que personne ne l'a écrit à la main. Pure. */
export function objetSuivi(dossier: { objet: string; objetManuelLe: Date | null }, projet: Pick<ProjetClient, "familles"> | null): { objet?: string } {
  if (dossier.objetManuelLe) return {};
  const objet = objetDepuisProjet(projet);
  return objet && objet !== dossier.objet ? { objet } : {};
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
  const suites = await ecrire(auteur, () =>
    prisma.$transaction(async (tx) => {
      await tx.espaceClient.update({ where: { id: espace.id }, data: { projetValideLe: null, projetValidePar: null } });
      await tx.dossierEvenement.create({ data: { dossierId: espace.dossierId, type: "ESPACE_PROJET_DEVALIDE", direction: direction(auteur), contenu: `Projet dévalidé ${par(auteur)} (${motif})`, metadata: JSON.stringify({ auteur }) } });
      // La prochaine action posée par la validation ne vaut plus.
      return appliquerEvenementDossier(tx, espace.dossierId, { type: "PROJET_DEVALIDE" });
    })
  );
  await suitesEvenementDossier(suites);
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
  const suites = await ecrire(auteur, () => prisma.$transaction((tx) => devaliderChoixDansTransaction(tx, espace, auteur)));
  await suitesEvenementDossier(suites);
  if (auteur === "CLIENT") await prevenir(espace.dossierId, `Simulation dévalidée — ${dossier.clientNom}`, "Le client est revenu sur la simulation qu'il avait validée. Le devis n'est plus attendu pour l'instant.", 3, dossier.clientTelephone);
}

/**
 * La dévalidation elle-même, dans la transaction de l'appelant : plus aucune simulation validée, l'événement, puis le
 * point d'entrée (CHOIX_DEVALIDE). Mission 18 (B9) : aussi quand Lucas masque, repasse en brouillon ou retire une
 * simulation qui fait partie du choix (simulations/dossier.ts › changerStatutSimulation), d'un bloc avec ce geste ;
 * `raison` le dit dans l'historique. Les suites sont à lancer après la transaction.
 */
export async function devaliderChoixDansTransaction(tx: Transaction, espace: Pick<EspaceClient, "id" | "dossierId" | "choix">, auteur: Auteur, raison?: string): Promise<Suites> {
  await tx.simulationEspace.updateMany({ where: { espaceId: espace.id, choisieLe: { not: null } }, data: { choisieLe: null } });
  await tx.espaceClient.update({ where: { id: espace.id }, data: { choix: null, choixLe: null } });
  await tx.dossierEvenement.create({ data: { dossierId: espace.dossierId, type: "ESPACE_SIMULATION_DEVALIDEE", direction: direction(auteur), contenu: `Simulation dévalidée ${par(auteur)}${raison ? ` (${raison})` : ""} : plus aucune simulation n'est validée`, metadata: JSON.stringify({ auteur, choixPrecedent: espace.choix ? (JSON.parse(espace.choix) as unknown) : null, ...(raison ? { raison } : {}) }) } });
  return appliquerEvenementDossier(tx, espace.dossierId, { type: "CHOIX_DEVALIDE" });
}

/**
 * Mission 18 (B9) : la simulation fait-elle partie du choix du client ? La simulation validée (mode UNE), ou celle d'une
 * des zones d'un mélange (mode COMPOSITE). Pure : lit `EspaceClient.choix` (JSON) ; illisible = non.
 */
export function simulationDansLeChoix(choix: string | null, simulationId: string): boolean {
  if (!choix) return false;
  try {
    const lu = JSON.parse(choix) as { mode?: unknown; simulationId?: unknown; zones?: unknown };
    if (lu?.mode === "UNE") return lu.simulationId === simulationId;
    if (lu?.mode === "COMPOSITE" && Array.isArray(lu.zones)) return lu.zones.some((z: { simulationId?: unknown } | null) => z?.simulationId === simulationId);
    return false;
  } catch {
    return false;
  }
}

/* ── La demande d'autre proposition ───────────────────────────────── */

export async function retirerDemandeProposition(espace: EspaceClient, auteur: Auteur): Promise<void> {
  if (!espace.propositionDemandeeLe) return;
  await dossierDe(espace.dossierId);
  const suites = await ecrire(auteur, () =>
    prisma.$transaction(async (tx) => {
      await tx.espaceClient.update({ where: { id: espace.id }, data: { propositionDemandeeLe: null, propositionMessage: null, propositionSimulationId: null } });
      await tx.dossierEvenement.create({ data: { dossierId: espace.dossierId, type: "ESPACE_PROPOSITION_RETIREE", direction: direction(auteur), contenu: `Demande d'autre proposition retirée ${par(auteur)}${espace.propositionMessage ? ` (elle disait : « ${espace.propositionMessage} »)` : ""}`.slice(0, 1500), metadata: JSON.stringify({ auteur, message: espace.propositionMessage ?? null }) } });
      return appliquerEvenementDossier(tx, espace.dossierId, { type: "PROPOSITION_RETIREE", choixValide: Boolean(espace.choixLe) });
    })
  );
  await suitesEvenementDossier(suites);
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
export async function retirerAccord(espace: EspaceClient, auteur: Auteur, motif = "", documentId?: string | null): Promise<{ retire: boolean }> {
  // Mission 18 (B7) : avec un devis nommé, l'accord de CE devis (un avenant se retire seul) ; sans, l'accord du devis
  // signé d'origine (le plus ancien en cours : l'ancien site, le geste de Lucas, « Réinitialiser » l'étape Devis).
  const accord = await prisma.accordDevis.findFirst({ where: { dossierId: espace.dossierId, retireLe: null, ...(documentId ? { documentId } : {}) }, orderBy: { createdAt: documentId ? "desc" : "asc" } });
  if (!accord) return { retire: false };
  const dossier = await dossierDe(espace.dossierId);
  const devisDuDossier = await prisma.document.findMany({ where: { dossierId: espace.dossierId, type: "DEVIS", archiveLe: null, numero: { not: null } }, select: { id: true, statut: true, createdAt: true, numero: true } });
  const devisDeLAccord = devisDuDossier.find((d) => d.id === accord.documentId);
  if (devisDeLAccord && estAvenant(devisDeLAccord, devisDuDossier)) return retirerAccordAvenant(espace, auteur, motif, accord, dossier);
  if (auteur === "CLIENT") {
    const encaisse = await prisma.encaissement.count({ where: { dossierId: espace.dossierId, statut: "VALIDE" } });
    if (encaisse > 0 || dossier.etape !== "SIGNE") {
      throw new ErreurMetier("Votre projet est déjà engagé (paiement reçu ou chantier planifié). Pour revenir sur votre accord, appelez CoverSwap.", 409, { raison: "engage" });
    }
  }
  const maintenant = new Date();
  const suites = await ecrire(auteur, () =>
    prisma.$transaction(async (tx) => {
      await tx.accordDevis.update({ where: { id: accord.id }, data: { retireLe: maintenant, retirePar: auteur, retireMotif: motif.slice(0, 500) || null } });
      // Mission 11 : les devis écartés au moment de l'accord redeviennent au choix.
      const rendus = await tx.document.updateMany({ where: { dossierId: espace.dossierId, type: "DEVIS", statut: "NON_RETENU" }, data: { statut: "ENVOYE" } });
      await tx.dossierEvenement.create({ data: { dossierId: espace.dossierId, type: "ESPACE_ACCORD_RETIRE", direction: direction(auteur), contenu: `Bon pour accord sur le devis ${accord.numeroDevis ?? ""} retiré ${par(auteur)}${motif ? ` : « ${motif} »` : ""}. La preuve de l'accord du ${accord.createdAt.toLocaleDateString("fr-FR", { timeZone: "Europe/Paris" })} est gardée.${rendus.count > 1 ? ` Les ${rendus.count} autres devis proposés redeviennent au choix.` : rendus.count === 1 ? " L'autre devis proposé redevient au choix." : ""}`.slice(0, 1500), metadata: JSON.stringify({ auteur, accordId: accord.id, documentId: accord.documentId, rendus: rendus.count }) } });
      return appliquerEvenementDossier(tx, espace.dossierId, { type: "ACCORD_RETIRE", auteur }, maintenant);
    })
  );
  if (dossier.etape === "SIGNE") await ecrire(auteur, () => deplacerDossier(espace.dossierId, "SIGNE", "DEVIS_ENVOYE", "RETOUR", `${RAISON_ACCORD_RETIRE} ${par(auteur)}`));
  // Mission 14 (partie 7) : la prochaine action remplacée (un « Rappeler » daté peut-être) → l'agenda suit (mission 18 : les suites).
  await suitesEvenementDossier(suites);
  if (auteur === "CLIENT") await prevenir(espace.dossierId, `ACCORD RETIRÉ — ${dossier.clientNom}`, `Le client a retiré son bon pour accord sur le devis ${accord.numeroDevis ?? ""}${motif ? ` : « ${motif} »` : ""}.\nÀ vous : l'appeler.`, 5, dossier.clientTelephone);
  return { retire: true };
}

/** Les étapes où le client peut encore retirer son accord sur un avenant : le chantier n'a pas commencé. */
export const ETAPES_AVENANT_RETIRABLE: readonly EtapeDossier[] = ["SIGNE", "PLANIFIE"];

/**
 * Mission 18 (B7) : retirer l'accord d'un avenant. Le devis signé d'origine tient toujours : l'étape ne recule pas,
 * l'acompte ne bouge pas. L'avenant redevient à signer (« Envoyé » : le client l'a eu en main), les devis qu'il avait
 * écartés en le signant redeviennent au choix ; la preuve de l'accord reste, annotée. Une transaction, le point
 * d'entrée (prochaine action, main), puis les suites et l'alerte.
 */
async function retirerAccordAvenant(espace: EspaceClient, auteur: Auteur, motif: string, accord: { id: string; documentId: string; numeroDevis: string | null; createdAt: Date }, dossier: Awaited<ReturnType<typeof dossierDe>>): Promise<{ retire: boolean }> {
  if (auteur === "CLIENT" && !ETAPES_AVENANT_RETIRABLE.includes(dossier.etape as EtapeDossier)) {
    throw new ErreurMetier("Le chantier a commencé. Pour revenir sur votre accord, appelez CoverSwap.", 409, { raison: "engage" });
  }
  const maintenant = new Date();
  const suites = await ecrire(auteur, () =>
    prisma.$transaction(async (tx) => {
      const pris = await tx.accordDevis.updateMany({ where: { id: accord.id, retireLe: null }, data: { retireLe: maintenant, retirePar: auteur, retireMotif: motif.slice(0, 500) || null } });
      if (pris.count === 0) return null;
      await tx.document.updateMany({ where: { id: accord.documentId, statut: "ACCEPTE" }, data: { statut: "ENVOYE" } });
      // Les devis que cet accord avait écartés (lus dans son événement) redeviennent au choix ; pas ceux de la signature d'origine.
      const signature = await tx.dossierEvenement.findFirst({ where: { dossierId: espace.dossierId, type: "ESPACE_DEVIS_ACCEPTE", metadata: { contains: accord.documentId } }, orderBy: { createdAt: "desc" }, select: { metadata: true } });
      const ecartes = (() => {
        try {
          const meta = JSON.parse(signature?.metadata ?? "{}") as { documentId?: unknown; nonRetenus?: { id?: unknown }[] };
          return meta.documentId === accord.documentId && Array.isArray(meta.nonRetenus) ? meta.nonRetenus.map((n) => n.id).filter((id): id is string => typeof id === "string") : [];
        } catch {
          return [];
        }
      })();
      const rendus = ecartes.length ? await tx.document.updateMany({ where: { id: { in: ecartes }, dossierId: espace.dossierId, statut: "NON_RETENU" }, data: { statut: "ENVOYE" } }) : { count: 0 };
      await tx.dossierEvenement.create({ data: { dossierId: espace.dossierId, type: "ESPACE_ACCORD_RETIRE", direction: direction(auteur), contenu: `Bon pour accord sur l'avenant ${accord.numeroDevis ?? ""} retiré ${par(auteur)}${motif ? ` : « ${motif} »` : ""}. Le devis signé d'origine tient toujours ; la preuve de l'accord du ${accord.createdAt.toLocaleDateString("fr-FR", { timeZone: "Europe/Paris" })} est gardée.${rendus.count > 1 ? ` Les ${rendus.count} autres devis proposés redeviennent au choix.` : rendus.count === 1 ? " L'autre devis proposé redevient au choix." : ""}`.slice(0, 1500), metadata: JSON.stringify({ auteur, accordId: accord.id, documentId: accord.documentId, rendus: rendus.count, avenant: true }) } });
      return appliquerEvenementDossier(tx, espace.dossierId, { type: "ACCORD_RETIRE", auteur, avenant: true }, maintenant);
    })
  );
  if (!suites) return { retire: false };
  await suitesEvenementDossier(suites);
  if (auteur === "CLIENT") await prevenir(espace.dossierId, `ACCORD RETIRÉ — ${dossier.clientNom}`, `Le client a retiré son bon pour accord sur l'avenant ${accord.numeroDevis ?? ""}${motif ? ` : « ${motif} »` : ""} (le devis signé d'origine tient toujours).\nÀ vous : l'appeler.`, 4, dossier.clientTelephone);
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
