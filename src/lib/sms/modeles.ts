import prisma, { type BaseDonnees } from "@/lib/prisma";
import { ErreurMetier } from "@/lib/commun/erreurs";
import { remplirModele } from "./texte";

/**
 * Messages types : le CRM pré-remplit, Lucas relit, corrige, envoie.
 *
 * Les textes vivent en base (ModeleSms) et se modifient depuis Paramètres ;
 * ceux-ci ne sont que la première version, posée une fois par la migration.
 * Ils sont écrits dans l'alphabet GSM-7 (pas de ê, ç, œ, guillemets français ni
 * apostrophe courbe) : un caractère hors alphabet triple le prix du SMS.
 * Seuls les deux accusés de réception partent sans validation.
 */
export type ModeleParDefaut = { code: string; libelle: string; texte: string; automatique?: boolean; ordre: number };

export const MODELES_PAR_DEFAUT: readonly ModeleParDefaut[] = [
  {
    code: "ACCUSE_RECEPTION",
    libelle: "Accusé de réception (automatique, en journée)",
    texte: "Bonjour {prenom}, Lucas de CoverSwap. Merci pour votre demande, je vous appelle dans les prochaines minutes. Ce numéro sert à nos échanges par SMS. STOP pour ne plus en recevoir.",
    automatique: true,
    ordre: 1,
  },
  {
    code: "ACCUSE_RECEPTION_HORS_HORAIRES",
    libelle: "Accusé de réception (automatique, soir et dimanche)",
    texte: "Bonjour {prenom}, Lucas de CoverSwap. Merci pour votre demande, je vous appelle dès demain matin. Ce numéro sert à nos échanges par SMS. STOP pour ne plus en recevoir.",
    automatique: true,
    ordre: 2,
  },
  {
    code: "LIEN_ESPACE",
    libelle: "Pendant l'appel : lien de l'espace client",
    texte: "Bonjour {prenom}, c'est Lucas de CoverSwap. Comme convenu, voici votre espace personnel pour déposer 2 ou 3 photos : {lien} Je vous prépare une simulation dès que je les ai.",
    ordre: 10,
  },
  {
    code: "LIEN_ESPACE_SIMULATION",
    libelle: "Pendant l'appel : lien de l'espace (il a fait une simulation sur le site)",
    texte: "Bonjour {prenom}, c'est Lucas de CoverSwap. Comme convenu, votre simulation vous attend dans votre espace personnel : {lien} Ajoutez-y 2 ou 3 photos de la pièce, je vous prépare mes propositions.",
    ordre: 10,
  },
  {
    code: "INJOIGNABLE_LIEN",
    libelle: "Pas de réponse : SMS immédiat avec le lien",
    texte: "Bonjour {prenom}, Lucas de CoverSwap. J'ai essayé de vous joindre pour votre projet. Voici votre espace pour déposer vos photos quand vous voulez : {lien} Je vous rappelle demain.",
    ordre: 11,
  },
  {
    code: "LIEN_ESPACE_RAPPEL",
    libelle: "Renvoyer le lien de l'espace (projet en cours)",
    texte: "Bonjour {prenom}, Lucas de CoverSwap. Voici à nouveau le lien de votre espace : tout votre projet y est, à jour. {lien}",
    ordre: 13,
  },
  {
    code: "INJOIGNABLE_J3",
    libelle: "Pas de réponse : second SMS à J+3",
    texte: "Bonjour {prenom}, Lucas de CoverSwap. Je n'ai pas réussi à vous joindre. Dites-moi quand vous rappeler, ou déposez vos photos ici et je vous envoie une simulation : {lien}",
    ordre: 12,
  },
  {
    code: "RELANCE_PHOTOS",
    libelle: "Relance J+2 : photos non déposées",
    texte: "Bonjour {prenom}, Lucas de CoverSwap. Avez-vous pu prendre 2 ou 3 photos ? Vous pouvez les déposer ici en une minute : {lien} Je vous prépare la simulation dans la foulée.",
    ordre: 20,
  },
  {
    code: "SIMULATION_PRETE",
    libelle: "Simulation déposée dans l'espace",
    texte: "Bonjour {prenom}, votre simulation est en ligne dans votre espace : {lien} Dites-moi ce que vous en pensez, on ajuste ensemble si besoin. Lucas, CoverSwap",
    ordre: 21,
  },
  {
    code: "RELANCE_SIMULATION",
    libelle: "Relance J+3 : simulation vue, pas de retour",
    texte: "Bonjour {prenom}, qu'avez-vous pensé de la simulation ? Si une teinte ou un détail vous fait hésiter, dites-le moi, je vous en prépare une autre. {lien} Lucas, CoverSwap",
    ordre: 22,
  },
  {
    code: "DEVIS_PRET",
    libelle: "Devis disponible dans l'espace",
    texte: "Bonjour {prenom}, votre devis est dans votre espace : {lien} Vous pouvez le valider en un clic (bon pour accord). Je reste disponible pour toute question. Lucas, CoverSwap",
    ordre: 30,
  },
  {
    code: "RELANCE_DEVIS",
    libelle: "Relance J+4 : devis non signé",
    texte: "Bonjour {prenom}, je bloque mes prochains chantiers cette semaine. Pour vous garder un créneau, il me faut votre accord sur le devis : {lien} Une question ? Appelez-moi. Lucas, CoverSwap",
    ordre: 31,
  },
  {
    code: "RELANCE_DEVIS_QUESTIONS",
    libelle: "Devis relu plusieurs fois, pas encore signé",
    texte: "Bonjour {prenom}, avez-vous des questions sur votre devis ? Je peux ajuster une finition ou un détail, et je reste joignable au 06 70 35 28 69. Votre espace : {lien} Lucas, CoverSwap",
    ordre: 33,
  },
  {
    code: "RELANCE_DERNIERE",
    libelle: "Dernière relance J+10",
    texte: "Bonjour {prenom}, dernier message de ma part : votre devis reste valable jusqu'au {validite}, ensuite je ne pourrai plus garantir le tarif ni le créneau. Votre espace : {lien} Bonne journée, Lucas",
    ordre: 32,
  },
  {
    code: "MERCI_ACCORD",
    libelle: "Après le bon pour accord",
    texte: "Merci {prenom}, votre accord est bien enregistré ! Je vous appelle pour fixer la date du chantier. Lucas, CoverSwap",
    ordre: 40,
  },
];

export type ModeleVue = { id: string; code: string; libelle: string; texte: string; actif: boolean; automatique: boolean; ordre: number };

export async function listerModeles(): Promise<ModeleVue[]> {
  const lignes = await prisma.modeleSms.findMany({ orderBy: [{ ordre: "asc" }, { libelle: "asc" }] });
  return lignes.map((m) => ({ id: m.id, code: m.code, libelle: m.libelle, texte: m.texte, actif: m.actif, automatique: m.automatique, ordre: m.ordre }));
}

export async function lireModele(code: string): Promise<ModeleVue | null> {
  const m = await prisma.modeleSms.findUnique({ where: { code } });
  return m && !m.archiveLe ? { id: m.id, code: m.code, libelle: m.libelle, texte: m.texte, actif: m.actif, automatique: m.automatique, ordre: m.ordre } : null;
}

export async function modifierModele(id: string, entree: { libelle?: string; texte?: string; actif?: boolean }): Promise<ModeleVue> {
  const modele = await prisma.modeleSms.findUnique({ where: { id } });
  if (!modele) throw new ErreurMetier("Message type introuvable.", 404);
  if (entree.texte !== undefined && !entree.texte.trim()) throw new ErreurMetier("Le texte du message est vide.", 400);
  if (entree.texte !== undefined && entree.texte.length > 600) throw new ErreurMetier("Message type trop long (600 caractères au plus).", 400);
  const m = await prisma.modeleSms.update({
    where: { id },
    data: { ...(entree.libelle?.trim() ? { libelle: entree.libelle.trim().slice(0, 120) } : {}), ...(entree.texte !== undefined ? { texte: entree.texte.trim() } : {}), ...(entree.actif !== undefined ? { actif: entree.actif } : {}) },
  });
  return { id: m.id, code: m.code, libelle: m.libelle, texte: m.texte, actif: m.actif, automatique: m.automatique, ordre: m.ordre };
}

/** Pose les messages types qui manquent, sans jamais réécrire un texte déjà en base. Rend le nombre de créations. */
export async function poserModelesParDefaut(client: BaseDonnees = prisma): Promise<number> {
  let crees = 0;
  for (const modele of MODELES_PAR_DEFAUT) {
    const existe = await client.modeleSms.findUnique({ where: { code: modele.code }, select: { id: true } });
    if (existe) continue;
    await client.modeleSms.create({ data: { code: modele.code, libelle: modele.libelle, texte: modele.texte, automatique: modele.automatique ?? false, ordre: modele.ordre } });
    crees++;
  }
  return crees;
}

/** Texte proposé à partir d'un message type : ce que Lucas verra, prêt à corriger. Null si le modèle est absent ou coupé. */
export async function proposerTexte(code: string, variables: Record<string, string | null | undefined>): Promise<string | null> {
  const modele = await lireModele(code);
  if (!modele || !modele.actif) return null;
  return remplirModele(modele.texte, variables);
}
