import { NextResponse, type NextRequest } from "next/server";
import { COOKIE_INTERFACE, DUREE_COOKIE_S } from "@/lib/interface/choix";

export const dynamic = "force-dynamic";

/**
 * Mission 22 — `GET /api/interface?v=v2|v1&retour=/chemin` : pose le cookie `crm-interface` (7 jours, `v1` l'efface)
 * puis redirige vers `retour`. Le cookie ne compte que si le serveur est en `CRM_INTERFACE=apercu` ; sinon le drapeau
 * seul décide (lib/interface/choix.ts). Route NON publique : elle passe par la session, comme les autres `/api`.
 * `retour` doit être un chemin relatif du CRM (jamais une adresse extérieure) ; sinon `/taches`.
 */
export function cheminDeRetour(brut: string | null | undefined): string {
  const chemin = (brut ?? "").trim();
  if (!chemin.startsWith("/") || chemin.startsWith("//") || chemin.startsWith("/\\") || /[\r\n]/.test(chemin)) return "/taches";
  return chemin;
}

export async function GET(requete: NextRequest) {
  const url = new URL(requete.url);
  const v = url.searchParams.get("v") === "v2" ? "v2" : "v1";
  const retour = cheminDeRetour(url.searchParams.get("retour"));
  const reponse = NextResponse.redirect(new URL(retour, url.origin), 303);
  if (v === "v2") reponse.cookies.set(COOKIE_INTERFACE, "v2", { path: "/", sameSite: "lax", maxAge: DUREE_COOKIE_S });
  else reponse.cookies.set(COOKIE_INTERFACE, "", { path: "/", sameSite: "lax", maxAge: 0 });
  return reponse;
}
