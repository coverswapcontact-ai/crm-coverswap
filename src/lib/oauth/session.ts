import { headers } from "next/headers";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { connexionLocaleDesactivee } from "@/lib/journal/acteur";

/**
 * La personne connectée au CRM (page de consentement, écrans Paramètres) :
 * son e-mail, ou « poste-local » quand la connexion est désactivée sur le
 * poste de Lucas (jamais en production). Null = personne : la route refuse.
 */
export async function utilisateurConnecte(): Promise<string | null> {
  const session = await getServerSession(authOptions).catch(() => null);
  const email = session?.user?.email?.trim().toLowerCase();
  if (email) return email;
  const entetes = await headers();
  return connexionLocaleDesactivee(entetes.get("host")) ? "poste-local" : null;
}
