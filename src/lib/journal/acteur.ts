import { basename } from "node:path";
import { contexteExplicite, type ContexteEcriture } from "./contexte";
import { ENTETE_ORIGINE, ENTETE_REQUETE } from "./entetes";

/**
 * Contexte de l'écriture en cours, par ordre de priorité :
 * 1. un contexte explicite (avecActeur) : tâche, agent, script, migration ;
 * 2. la requête HTTP : personne connectée (session NextAuth vérifiée), poste
 *    local sans connexion, ou appel externe (webhook) ;
 * 3. hors de Next (script lancé par tsx) : SCRIPT:nom-du-script ;
 * 4. sinon INCONNU, visible dans le journal et compté par la synthèse.
 */
export async function resoudreContexte(): Promise<ContexteEcriture> {
  const explicite = contexteExplicite();
  if (explicite) return explicite;

  if (process.env.NEXT_RUNTIME === "nodejs") {
    const requete = await contexteDeLaRequete();
    return requete ?? { acteur: "INCONNU:hors-requete" };
  }
  const script = process.argv[1] ? basename(process.argv[1]).replace(/\.[cm]?[jt]sx?$/, "") : "inconnu";
  return { acteur: `SCRIPT:${script}` };
}

async function contexteDeLaRequete(): Promise<ContexteEcriture | null> {
  let entetes: Headers;
  let biscuits: Awaited<ReturnType<typeof import("next/headers").cookies>>;
  try {
    const { cookies, headers } = await import("next/headers");
    entetes = new Headers(await headers());
    biscuits = await cookies();
  } catch {
    // Appelé hors d'une requête (tâche de fond sans contexte explicite).
    return null;
  }

  const origine = entetes.get(ENTETE_ORIGINE) ?? undefined;
  const requete = entetes.get(ENTETE_REQUETE) ?? undefined;

  const email = await emailDeLaSession(biscuits, entetes);
  if (email) return { acteur: `HUMAIN:${email}`, origine, requete };

  if (connexionLocaleDesactivee(entetes.get("host"))) {
    return { acteur: "HUMAIN:poste-local", origine, requete };
  }

  // Sans session, seules les routes publiques du middleware écrivent : webhooks
  // du site, de Meta et de Zapier, tâches planifiées protégées par secret.
  const chemin = origine?.split(" ")[1];
  return { acteur: chemin ? `EXTERNE:${chemin}` : "INCONNU:requete-sans-origine", origine, requete };
}

// Déchiffrer le jeton de session coûte une dérivation de clé : on garde les
// derniers résultats (jeton → email) le temps d'une rafale d'écritures.
const sessionsConnues = new Map<string, { email: string | null; expire: number }>();

async function emailDeLaSession(
  biscuits: { getAll: () => { name: string; value: string }[] },
  entetes: Headers
): Promise<string | null> {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) return null;
  const jetonBrut = biscuits
    .getAll()
    .filter((biscuit) => biscuit.name.includes("next-auth.session-token"))
    .map((biscuit) => `${biscuit.name}=${biscuit.value}`)
    .join(";");
  if (!jetonBrut) return null;

  const connu = sessionsConnues.get(jetonBrut);
  if (connu && connu.expire > Date.now()) return connu.email;

  const { getToken } = await import("next-auth/jwt");
  const session = await getToken({
    req: { cookies: biscuits, headers: Object.fromEntries(entetes.entries()) } as never,
    secret,
  }).catch(() => null);
  const email = typeof session?.email === "string" ? session.email.toLowerCase() : null;

  if (sessionsConnues.size > 100) sessionsConnues.clear();
  sessionsConnues.set(jetonBrut, { email, expire: Date.now() + 60_000 });
  return email;
}

/** Même garde que le middleware : poste de Lucas uniquement, jamais en production. */
export function connexionLocaleDesactivee(hote: string | null): boolean {
  const hoteDemande = (hote ?? "").replace(/:\d+$/, "").toLowerCase();
  return (
    process.env.DESACTIVER_CONNEXION_LOCALE === "1" &&
    process.env.NODE_ENV !== "production" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(hoteDemande)
  );
}
