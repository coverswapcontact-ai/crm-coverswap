import { NextResponse, type NextRequest } from "next/server";
import { COOKIE_INTERFACE, DUREE_COOKIE_S } from "@/lib/interface/choix";

export const dynamic = "force-dynamic";

/**
 * Mission 22 — `GET /api/interface?v=v2|v1&retour=/chemin` : pose le cookie `crm-interface` (`v2` ou `v1`, 7 jours)
 * puis redirige vers `retour`. Le cookie compte en `CRM_INTERFACE=apercu` (v2 pour la session qui porte `v2`) et en
 * `CRM_INTERFACE=v2` (la session qui porte `v1` revient à la v1, pour comparer) ; sans drapeau, il est sans effet
 * (lib/interface/choix.ts). Route NON publique : elle passe par la session, comme les autres `/api`.
 * `retour` doit être un chemin relatif du CRM (jamais une adresse extérieure) ; sinon `/taches`.
 */
const ORIGINE_FACTICE = "http://x";

export function cheminDeRetour(brut: string | null | undefined): string {
  const chemin = (brut ?? "").trim();
  if (!chemin.startsWith("/") || /\s/.test(chemin)) return "/taches";
  // Résolu contre une origine factice : tout ce qui en sort (`//hôte`, `/\hôte`, tabulation avalée…) est refusé.
  let url: URL;
  try {
    url = new URL(chemin, ORIGINE_FACTICE);
  } catch {
    return "/taches";
  }
  if (url.origin !== ORIGINE_FACTICE) return "/taches";
  return `${url.pathname}${url.search}${url.hash}`;
}

export async function GET(requete: NextRequest) {
  const url = new URL(requete.url);
  const v = url.searchParams.get("v") === "v2" ? "v2" : "v1";
  const retour = cheminDeRetour(url.searchParams.get("retour"));
  const reponse = NextResponse.redirect(new URL(retour, url.origin), 303);
  reponse.cookies.set(COOKIE_INTERFACE, v, { path: "/", sameSite: "lax", maxAge: DUREE_COOKIE_S });
  return reponse;
}
