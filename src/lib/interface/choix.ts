/**
 * Mission 22 — quelle interface servir : la v1 (par défaut) ou la v2 « claire ».
 *
 * Drapeau `CRM_INTERFACE`, lu côté serveur à chaque requête (jamais au build) :
 *  - absent ou `v1` : l'interface actuelle ;
 *  - `v2` : la nouvelle, pour tout le monde — sauf la session qui a ouvert `?interface=v1` (cookie `crm-interface=v1`),
 *    qui revient à la v1 pour comparer (correctifs du 07/10) ; `?interface=v2` la ramène ;
 *  - `apercu` : la v1 par défaut, la v2 pour la session qui a ouvert `?interface=v2`
 *    (cookie `crm-interface` posé pour 7 jours par `GET /api/interface`, `?interface=v1` pour revenir).
 * Toute autre valeur vaut `v1` : une faute de frappe sur Railway ne change rien en production.
 *
 * Module sans dépendance React : `interfaceDemandee` est pure (testée), `interfaceCourante` lit l'environnement et le
 * cookie de la requête (`next/headers` à la demande, dans un try, comme `lib/journal/acteur.ts`).
 */
export type Interface = "v1" | "v2";

export const COOKIE_INTERFACE = "crm-interface";
export const DUREE_COOKIE_S = 7 * 24 * 3600;

export function interfaceDemandee({ env, cookie }: { env: string | undefined | null; cookie: string | undefined | null }): Interface {
  const drapeau = (env ?? "").trim().toLowerCase();
  const demande = (cookie ?? "").trim();
  if (drapeau === "v2") return demande === "v1" ? "v1" : "v2";
  if (drapeau === "apercu") return demande === "v2" ? "v2" : "v1";
  return "v1";
}

export async function interfaceCourante(): Promise<Interface> {
  let cookie: string | undefined;
  try {
    const { cookies } = await import("next/headers");
    cookie = (await cookies()).get(COOKIE_INTERFACE)?.value;
  } catch {
    // Hors d'une requête (script, test) : pas de cookie, le drapeau seul décide.
    cookie = undefined;
  }
  return interfaceDemandee({ env: process.env.CRM_INTERFACE, cookie });
}
