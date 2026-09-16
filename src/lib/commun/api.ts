import { NextResponse } from "next/server";
import { z } from "zod/v4";
import { ErreurMetier } from "./erreurs";

// Outils communs aux routes API : validation des entrées, erreurs en français.

const LOCALE_FR = z.locales.fr();

/**
 * Valide des données et renvoie leur version typée, ou lève une ErreurMetier
 * au message français. Les messages propres au module finissent par un point
 * et sont renvoyés tels quels ; un message générique de zod (structure
 * inattendue) est complété par le chemin du champ.
 */
export function analyser<T extends z.ZodType>(schema: T, donnees: unknown): z.output<T> {
  const resultat = schema.safeParse(donnees, { error: LOCALE_FR.localeError });
  if (resultat.success) return resultat.data;
  const probleme = resultat.error.issues[0];
  if (!probleme) throw new ErreurMetier("Données invalides.");
  const champ = probleme.path.length > 0 && !probleme.message.endsWith(".") ? ` (${probleme.path.join(".")})` : "";
  throw new ErreurMetier(`${probleme.message}${champ}`);
}

export async function lireCorpsJson(requete: Request): Promise<unknown> {
  try {
    return await requete.json();
  } catch {
    throw new ErreurMetier("Requête invalide : données JSON attendues.");
  }
}

export async function lireFormulaire(requete: Request): Promise<FormData> {
  try {
    return await requete.formData();
  } catch {
    throw new ErreurMetier("Envoi incomplet ou trop lourd : réessaie avec une photo à la fois.");
  }
}

export function reponseErreur(erreur: unknown, contexte: string): NextResponse {
  if (erreur instanceof ErreurMetier) {
    return NextResponse.json({ error: erreur.message }, { status: erreur.status });
  }
  console.error(`[api] ${contexte} :`, erreur);
  return NextResponse.json({ error: "Erreur serveur : réessaie dans un instant." }, { status: 500 });
}

/** Champ texte d'un FormData ; une valeur absente ou un fichier donne "". */
export function texteFormulaire(formulaire: FormData, nom: string): string {
  const valeur = formulaire.get(nom);
  return typeof valeur === "string" ? valeur : "";
}
