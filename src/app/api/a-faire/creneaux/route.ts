import { NextResponse, type NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { reponseErreur } from "@/lib/commun/api";
import { ErreurMetier } from "@/lib/commun/erreurs";
import { jourParis } from "@/lib/dossiers/dates";
import { creneauxLibres } from "@/lib/agenda/creneaux";

export const dynamic = "force-dynamic";

/**
 * GET /api/a-faire/creneaux?dossierId=… : les jours libres des 10 prochains jours ouvrés pour fixer la date du chantier
 * (agenda Google lu s'il est connecté, sinon les jours ouvrés, en le disant), et le dossier (nom, date déjà posée,
 * date souhaitée par le client). N'écrit rien : la date se pose par PATCH /api/dossiers/<id> { dateChantier }.
 */
export async function GET(requete: NextRequest) {
  try {
    const dossierId = requete.nextUrl.searchParams.get("dossierId")?.trim() ?? "";
    let dossier: { id: string; clientNom: string; dateChantier: string | null; dateSouhaitee: string | null } | null = null;
    if (dossierId) {
      if (!/^[a-z0-9]{10,40}$/i.test(dossierId)) throw new ErreurMetier("Dossier introuvable.", 404);
      const lu = await prisma.dossier.findUnique({ where: { id: dossierId }, select: { id: true, clientNom: true, dateChantier: true, dateSouhaitee: true } });
      if (!lu) throw new ErreurMetier("Dossier introuvable.", 404);
      dossier = { id: lu.id, clientNom: lu.clientNom, dateChantier: lu.dateChantier ? jourParis(lu.dateChantier) : null, dateSouhaitee: lu.dateSouhaitee ? jourParis(lu.dateSouhaitee) : null };
    }
    return NextResponse.json({ ...(await creneauxLibres(new Date())), dossier });
  } catch (erreur) {
    return reponseErreur(erreur, "GET /api/a-faire/creneaux");
  }
}
