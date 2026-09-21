import { NextResponse, type NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { reponseErreur } from "@/lib/commun/api";
import { photosDuClient } from "@/lib/espace/service";

export const dynamic = "force-dynamic";

/** GET ?q=… : les dossiers pour lesquels préparer une simulation (nom, téléphone, ville), les plus récents d'abord. */
export async function GET(requete: NextRequest) {
  try {
    const q = (requete.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 60);
    const chiffres = q.replace(/\D/g, "");
    const dossiers = await prisma.dossier.findMany({
      where: {
        etape: { notIn: ["ENCAISSE", "PERDU"] },
        ...(q ? { OR: [{ clientNom: { contains: q } }, { clientVille: { contains: q } }, ...(chiffres.length >= 4 ? [{ clientTelephone: { contains: chiffres.slice(-8) } }] : [])] } : {}),
      },
      orderBy: { updatedAt: "desc" },
      take: 25,
      select: { id: true, clientNom: true, clientVille: true, etape: true, photos: true, espaces: { select: { id: true } } },
    });
    const lignes = await Promise.all(
      dossiers.map(async (d) => ({ id: d.id, clientNom: d.clientNom, ville: d.clientVille, etape: d.etape, photos: (await photosDuClient(d.id, d.photos)).length, espace: d.espaces.length > 0 }))
    );
    return NextResponse.json({ dossiers: lignes });
  } catch (erreur) {
    return reponseErreur(erreur, "GET /api/simulateur/dossiers");
  }
}
