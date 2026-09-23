import { NextResponse, type NextRequest } from "next/server";
import { chronologieDuContact } from "@/lib/chronologie/chronologie";
import { FAMILLES_CHRONOLOGIE, type FamilleChronologie } from "@/lib/chronologie/familles";
import { reponseErreur } from "@/lib/commun/api";

export const dynamic = "force-dynamic";

/** GET ?client=|lead=|dossier=&familles=MAIL,APPEL&limite=80 : le fil unique d'un contact (mission 9). */
export async function GET(requete: NextRequest) {
  try {
    const p = requete.nextUrl.searchParams;
    const familles = (p.get("familles") ?? "").split(",").filter((f): f is FamilleChronologie => (FAMILLES_CHRONOLOGIE as readonly string[]).includes(f));
    const limite = Math.min(200, Math.max(1, Number(p.get("limite") ?? 80) || 80));
    const resultat = await chronologieDuContact({ clientId: p.get("client"), leadId: p.get("lead"), dossierId: p.get("dossier") }, { familles, limite });
    return NextResponse.json(resultat);
  } catch (erreur) {
    return reponseErreur(erreur, "GET /api/chronologie");
  }
}
