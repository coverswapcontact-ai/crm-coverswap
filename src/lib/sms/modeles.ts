import prisma, { type BaseDonnees } from "@/lib/prisma";
import { ErreurMetier } from "@/lib/commun/erreurs";
import { CATALOGUE_SMS, definitionSms, verifierTexteSms, type DefinitionSms } from "./catalogue";
import { remplirModele } from "./texte";

/**
 * Les textes du catalogue SMS (`./catalogue`), tels que Lucas les a écrits.
 *
 * Chaque code du catalogue a une ligne en base (ModeleSms) : son texte, modifiable
 * dans Paramètres → SMS, et son interrupteur (les accusés et l'ancien circuit). Toute
 * lecture d'un texte passe par `texteDuCatalogue`. Seuls les deux accusés de
 * réception partent sans validation ; les autres SMS sont copiés par Lucas.
 */

export type ModeleVue = { id: string; code: string; libelle: string; texte: string; actif: boolean; automatique: boolean; ordre: number };

/** Un code du catalogue et son texte du moment, pour Paramètres → SMS (dans l'ordre du catalogue ; les codes archivés n'y sont pas). */
export type ModeleCatalogue = Omit<DefinitionSms, "variables"> & { variables: string[]; id: string | null; texte: string; actif: boolean };

type LigneModele = { id: string; code: string; libelle: string; texte: string; actif: boolean; automatique: boolean; ordre: number };
const versVue = (m: LigneModele): ModeleVue => ({ id: m.id, code: m.code, libelle: m.libelle, texte: m.texte, actif: m.actif, automatique: m.automatique, ordre: m.ordre });

export async function listerCatalogue(): Promise<ModeleCatalogue[]> {
  const lignes = await prisma.modeleSms.findMany({ where: { code: { in: CATALOGUE_SMS.map((d) => d.code) } } });
  const parCode = new Map(lignes.map((l) => [l.code, l]));
  return CATALOGUE_SMS.map((definition) => {
    const ligne = parCode.get(definition.code);
    return { ...definition, variables: [...definition.variables], id: ligne?.id ?? null, texte: ligne?.texte ?? definition.defaut, actif: ligne?.actif ?? true };
  });
}

export async function lireModele(code: string): Promise<ModeleVue | null> {
  const m = await prisma.modeleSms.findUnique({ where: { code } });
  return m && !m.archiveLe ? versVue(m) : null;
}

/**
 * Le texte d'un code, rempli : la ligne en base (non archivée), sinon le texte de départ du catalogue.
 * L'interrupteur `actif` n'entre pas en compte : il ne concerne que les accusés et l'ancien circuit, dont
 * l'envoi se décide par `lireModele` ; ici, on veut toujours le texte que Lucas a écrit.
 * `remplirModele` retire proprement une variable vide : « Bonjour {prenom}, » sans prénom devient « Bonjour, ».
 */
export async function texteDuCatalogue(code: string, variables: Record<string, string | null | undefined> = {}): Promise<string> {
  const definition = definitionSms(code);
  if (!definition) throw new ErreurMetier(`Code SMS inconnu : ${code}.`, 400);
  const ligne = await prisma.modeleSms.findUnique({ where: { code }, select: { texte: true, archiveLe: true } });
  const modele = ligne && !ligne.archiveLe && ligne.texte.trim() ? ligne.texte : definition.defaut;
  return remplirModele(modele, variables);
}

export async function modifierModele(id: string, entree: { libelle?: string; texte?: string; actif?: boolean }): Promise<ModeleVue> {
  const modele = await prisma.modeleSms.findUnique({ where: { id } });
  if (!modele) throw new ErreurMetier("Message type introuvable.", 404);
  if (entree.texte !== undefined && !entree.texte.trim()) throw new ErreurMetier("Le texte du message est vide.", 400);
  if (entree.texte !== undefined && entree.texte.length > 600) throw new ErreurMetier("Message type trop long (600 caractères au plus).", 400);
  // Mission 14 (partie 5) : le lien en dernier, seulement pour un code qui le porte ; seules les variables du code.
  const refus = entree.texte !== undefined ? verifierTexteSms(modele.code, entree.texte) : null;
  if (refus) throw new ErreurMetier(refus, 400);
  const m = await prisma.modeleSms.update({
    where: { id },
    data: { ...(entree.libelle?.trim() ? { libelle: entree.libelle.trim().slice(0, 120) } : {}), ...(entree.texte !== undefined ? { texte: entree.texte.trim() } : {}), ...(entree.actif !== undefined ? { actif: entree.actif } : {}) },
  });
  return versVue(m);
}

/** Pose les codes du catalogue qui manquent, avec leur texte de départ, sans jamais réécrire un texte déjà en base. Rend le nombre de créations. */
export async function poserModelesParDefaut(client: BaseDonnees = prisma): Promise<number> {
  let crees = 0;
  for (const [rang, definition] of CATALOGUE_SMS.entries()) {
    const existe = await client.modeleSms.findUnique({ where: { code: definition.code }, select: { id: true } });
    if (existe) continue;
    await client.modeleSms.create({ data: { code: definition.code, libelle: definition.libelle, texte: definition.defaut, automatique: definition.automatique, ordre: rang + 1 } });
    crees++;
  }
  return crees;
}
