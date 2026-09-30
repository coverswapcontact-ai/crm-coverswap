import { createHash, randomBytes } from "node:crypto";
import prisma from "@/lib/prisma";
import { ErreurMetier } from "@/lib/commun/erreurs";
import { avecActeur } from "@/lib/journal/contexte";
import { enregistrerFichierRecu, lireCible, verifierCompatibilite, verifierFichier, type CibleFichier, type ResultatEnregistrement } from "./enregistrement";
import { fichiersMaxPour, libelleDepot, MINUTES_ENVOI, MINUTES_VALIDITE_LIEN, OCTETS_MAX_DEPOT, OCTETS_MAX_FICHIER, type EntiteCible, type TypeFichier } from "./types";

/**
 * Mission 17 (partie C) — le lien de dépôt : Lucas l'ouvre sur son téléphone,
 * prend ou choisit plusieurs photos ou documents, et tout s'enregistre sur la
 * cible choisie à la création du lien (ou dans « À ranger » pour un dépôt libre).
 *
 * Le jeton : 32 octets aléatoires (base64url) dans l'adresse ; seule son empreinte
 * SHA-256 est gardée en base. Valable 30 minutes.
 *
 * « Usage unique », précisément : le lien est CONSOMMÉ à la première soumission
 * du formulaire de dépôt. Cette soumission annonce les fichiers choisis (nombre
 * et tailles) et reçoit, en échange, une clé d'envoi remise à elle seule ; elle
 * envoie ensuite ses fichiers un par un avec cette clé (un fichier par requête :
 * le proxy de Next.js ne garde que les 10 premiers Mo d'un corps), pendant 20
 * minutes au plus, sans dépasser ce qu'elle a annoncé. Une seconde soumission,
 * un rechargement de la page, un autre téléphone : « lien déjà utilisé ». Ouvrir
 * la page (aperçu d'une messagerie compris) ne consomme rien.
 *
 * Lien expiré, déjà utilisé ou inconnu : refusé, rien n'est écrit.
 */

export const ACTEUR_DEPOT = "EXTERNE:lien-depot";

const empreinteDe = (secret: string) => createHash("sha256").update(secret).digest("hex");
const FORMAT_JETON = /^[A-Za-z0-9_-]{32,64}$/;

export type LienDepotCree = { id: string; jeton: string; chemin: string; expireLe: Date; cible: { entite: EntiteCible; id: string; nom: string } | null; type: TypeFichier | null; fichiersMax: number };

/** Crée un lien de dépôt (cible absente : dépôt libre). La cible est vérifiée tout de suite. */
export async function creerLienDepot(entree: { cible: CibleFichier | null; type: TypeFichier | null; creePar: string; maintenant?: Date }): Promise<LienDepotCree> {
  const maintenant = entree.maintenant ?? new Date();
  const lue = entree.cible ? await lireCible(entree.cible) : null;
  if (lue?.entite === "PUBLICATION" && !lue.dossierId) throw new ErreurMetier("Cette réalisation n'est rattachée à aucun dossier : une photo publiée vient toujours d'un dossier. Rattache-la d'abord.", 409);
  if (lue?.entite === "PUBLICATION" && entree.type && entree.type !== "PHOTO_AVANT" && entree.type !== "PHOTO_APRES") throw new ErreurMetier("Une réalisation du site reçoit une photo avant ou après.", 400);
  if (lue?.entite === "DEPENSE" && entree.type && entree.type !== "JUSTIFICATIF") throw new ErreurMetier("Une dépense ne reçoit que son justificatif.", 400);
  if (lue?.entite === "LEAD" && entree.type === "PHOTO_APRES") throw new ErreurMetier("Une photo après chantier va sur le dossier, pas sur le lead.", 400);
  const jeton = randomBytes(32).toString("base64url");
  const expireLe = new Date(maintenant.getTime() + MINUTES_VALIDITE_LIEN * 60_000);
  const ligne = await prisma.jetonDepot.create({
    data: { empreinte: empreinteDe(jeton), cibleEntite: lue?.entite ?? null, cibleId: lue?.id ?? null, cibleNom: lue?.nom ?? null, type: entree.type, creePar: entree.creePar.slice(0, 200), expireLe },
  });
  return { id: ligne.id, jeton, chemin: `/depot/${jeton}`, expireLe, cible: lue ? { entite: lue.entite, id: lue.id, nom: lue.nom } : null, type: entree.type, fichiersMax: fichiersMaxPour(lue?.entite ?? null) };
}

export type EtatLien =
  | { etat: "valide"; id: string; titre: string; entite: EntiteCible | null; type: TypeFichier | null; expireLe: string; fichiersMax: number; octetsMaxFichier: number; octetsMaxDepot: number }
  | { etat: "expire" | "utilise" | "inconnu"; message: string };

export const MESSAGES_LIEN = {
  inconnu: "Ce lien de dépôt n'existe pas. Vérifie l'adresse, ou demande un nouveau lien à l'assistant.",
  expire: "Ce lien de dépôt a expiré (il est valable 30 minutes). Demande un nouveau lien à l'assistant : rien n'a été enregistré.",
  utilise: "Ce lien de dépôt a déjà servi : un lien ne sert qu'à un seul envoi. Demande un nouveau lien à l'assistant pour déposer d'autres fichiers.",
} as const;

async function ligneDuJeton(jeton: string) {
  if (!FORMAT_JETON.test(jeton)) return null;
  return prisma.jetonDepot.findUnique({ where: { empreinte: empreinteDe(jeton) } });
}

/** L'état du lien, pour la page : ne consomme rien, n'écrit rien. */
export async function etatLien(jeton: string, maintenant: Date = new Date()): Promise<EtatLien> {
  const ligne = await ligneDuJeton(jeton);
  if (!ligne || ligne.archiveLe) return { etat: "inconnu", message: MESSAGES_LIEN.inconnu };
  if (ligne.utiliseLe) return { etat: "utilise", message: MESSAGES_LIEN.utilise };
  if (ligne.expireLe <= maintenant) return { etat: "expire", message: MESSAGES_LIEN.expire };
  const entite = ligne.cibleEntite as EntiteCible | null;
  return { etat: "valide", id: ligne.id, titre: libelleDepot(entite, ligne.cibleNom, ligne.type as TypeFichier | null), entite, type: ligne.type as TypeFichier | null, expireLe: ligne.expireLe.toISOString(), fichiersMax: fichiersMaxPour(entite), octetsMaxFichier: OCTETS_MAX_FICHIER, octetsMaxDepot: OCTETS_MAX_DEPOT };
}

function refusDuLien(etat: EtatLien): never {
  if (etat.etat === "inconnu") throw new ErreurMetier(etat.message, 404);
  if (etat.etat === "expire" || etat.etat === "utilise") throw new ErreurMetier(etat.message, 410);
  throw new ErreurMetier(MESSAGES_LIEN.inconnu, 404);
}

/**
 * La soumission du formulaire : consomme le lien (une seule fois, atomiquement) et rend la clé d'envoi.
 * Annonce : les fichiers choisis (taille de chacun, après compression dans le navigateur).
 */
export async function ouvrirDepot(jeton: string, annonce: { tailles: number[] }, maintenant: Date = new Date()): Promise<{ cle: string; envoiExpireLe: Date; fichiers: number }> {
  const etat = await etatLien(jeton, maintenant);
  if (etat.etat !== "valide") refusDuLien(etat);
  const nombre = annonce.tailles.length;
  if (nombre === 0) throw new ErreurMetier("Choisis au moins un fichier.", 400);
  if (nombre > etat.fichiersMax) throw new ErreurMetier(etat.fichiersMax === 1 ? "Ce lien reçoit un seul fichier." : `${etat.fichiersMax} fichiers au plus par dépôt.`, 413);
  if (annonce.tailles.some((t) => !Number.isFinite(t) || t <= 0)) throw new ErreurMetier("Un des fichiers est vide.", 400);
  if (annonce.tailles.some((t) => t > OCTETS_MAX_FICHIER)) throw new ErreurMetier(`Un fichier dépasse ${Math.round(OCTETS_MAX_FICHIER / 1024 / 1024)} Mo : retire-le ou réduis-le.`, 413);
  const total = annonce.tailles.reduce((s, t) => s + t, 0);
  if (total > OCTETS_MAX_DEPOT) throw new ErreurMetier(`Trop lourd pour un seul dépôt : ${Math.round(OCTETS_MAX_DEPOT / 1024 / 1024)} Mo au plus en tout.`, 413);
  const cle = randomBytes(24).toString("base64url");
  const envoiExpireLe = new Date(maintenant.getTime() + MINUTES_ENVOI * 60_000);
  // Consommation atomique : deux soumissions simultanées, une seule passe.
  const { count } = await avecActeur({ acteur: ACTEUR_DEPOT, origine: `POST /api/depot (ouverture ${etat.id})` }, () =>
    prisma.jetonDepot.updateMany({ where: { id: etat.id, utiliseLe: null, expireLe: { gt: maintenant } }, data: { utiliseLe: maintenant, cleEnvoi: empreinteDe(cle), envoiExpireLe, fichiersAttendus: nombre, octetsAnnonces: total } })
  );
  if (count !== 1) throw new ErreurMetier(MESSAGES_LIEN.utilise, 410);
  return { cle, envoiExpireLe, fichiers: nombre };
}

/**
 * Un fichier de la soumission : vérifié (octets magiques, taille), compté dans ce qui a été annoncé, puis enregistré
 * sur la cible du lien. Une clé fausse, un envoi fini ou expiré : refusé, rien n'est écrit.
 */
export async function recevoirFichier(jeton: string, cle: string, fichier: { contenu: Buffer; nom: string | null }, maintenant: Date = new Date()): Promise<ResultatEnregistrement> {
  const ligne = await ligneDuJeton(jeton);
  if (!ligne || ligne.archiveLe) throw new ErreurMetier(MESSAGES_LIEN.inconnu, 404);
  if (!ligne.utiliseLe || !ligne.cleEnvoi || !cle || ligne.cleEnvoi !== empreinteDe(cle)) throw new ErreurMetier(ligne.utiliseLe ? MESSAGES_LIEN.utilise : "Envoi non ouvert : soumets le formulaire de dépôt.", ligne.utiliseLe ? 410 : 400);
  if (ligne.termineLe) throw new ErreurMetier("Ce dépôt est terminé : tous les fichiers annoncés sont arrivés.", 410);
  if (!ligne.envoiExpireLe || ligne.envoiExpireLe <= maintenant) throw new ErreurMetier("Le temps d'envoi est écoulé (20 minutes) : demande un nouveau lien.", 410);

  // Vérifié AVANT d'être compté : un fichier refusé (format, taille) n'entame rien.
  const verifie = await verifierFichier(fichier);
  const entite = ligne.cibleEntite as EntiteCible | null;
  const type = (ligne.type as TypeFichier | null) ?? null;
  if (type) verifierCompatibilite(entite, type, verifie.format);
  const taille = fichier.contenu.length;

  return avecActeur({ acteur: ACTEUR_DEPOT, origine: `POST /api/depot (${ligne.id}, lien demandé par ${ligne.creePar})` }, async () => {
    // Réservation atomique : on ne reçoit pas plus de fichiers ni d'octets que la soumission n'en a annoncé.
    const { count } = await prisma.jetonDepot.updateMany({
      where: { id: ligne.id, termineLe: null, fichiersRecus: { lt: ligne.fichiersAttendus }, octetsRecus: { lte: ligne.octetsAnnonces - taille } },
      data: { fichiersRecus: { increment: 1 }, octetsRecus: { increment: taille } },
    });
    if (count !== 1) throw new ErreurMetier("Ce fichier dépasse ce que le formulaire a annoncé : rien de plus n'est accepté.", 413);
    try {
      return await enregistrerFichierRecu(ligne.cibleEntite && ligne.cibleId ? { entite: entite!, id: ligne.cibleId } : null, type, verifie, { voie: "LIEN_DEPOT", jetonId: ligne.id, origine: `lien de dépôt ${ligne.id}` });
    } finally {
      const apres = await prisma.jetonDepot.findUnique({ where: { id: ligne.id }, select: { fichiersRecus: true, fichiersAttendus: true } });
      if (apres && apres.fichiersRecus >= apres.fichiersAttendus) await prisma.jetonDepot.updateMany({ where: { id: ligne.id, termineLe: null }, data: { termineLe: new Date() } });
    }
  });
}

/** Les fichiers reçus par un lien (pour ajouter_fichier source.lien_depot et voir_fichiers). */
export async function fichiersDuLien(jetonId: string) {
  return prisma.fichierDepose.findMany({ where: { jetonId, archiveLe: null }, orderBy: { createdAt: "asc" } });
}
