import { NextResponse, type NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { reponseErreur } from "@/lib/commun/api";
import { ErreurMetier } from "@/lib/commun/erreurs";
import { lireProjet, resumerProjet } from "@/lib/espace/projet";
import { photosAvantDuDossier, preparationsRecentes } from "@/lib/simulateur/preparation";
import { lireZones, typeSurfacePourProjet } from "@/lib/simulateur/types-surface";

export const dynamic = "force-dynamic";

/**
 * GET : ce que le simulateur doit savoir d'un dossier — ses photos « avant »,
 * le projet et les goûts que le client a dits dans son espace (proposés en
 * premier), le type de surface le plus probable, les teintes qu'il a déjà
 * essayées sur le site, et les préparations récentes.
 */
export async function GET(_requete: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const dossier = await prisma.dossier.findUnique({
      where: { id },
      select: { id: true, clientNom: true, clientVille: true, clientTelephone: true, etape: true, archiveLe: true, lead: { select: { typeProjet: true } }, espaces: { select: { souhaits: true } } },
    });
    if (!dossier || dossier.archiveLe) throw new ErreurMetier("Dossier introuvable ou archivé.", 404);
    const typeProjet = dossier.lead?.typeProjet ?? "CUISINE";
    const projet = lireProjet(dossier.espaces[0]?.souhaits ?? null);
    const [photos, preparations, simulationsSite] = await Promise.all([
      photosAvantDuDossier(id),
      preparationsRecentes(id),
      prisma.simulationEspace.findMany({ where: { dossierId: id, source: "SITE" }, select: { zones: true } }),
    ]);
    const refsSite = [...new Set(simulationsSite.flatMap((s) => lireZones(s.zones).map((z) => z.ref)))];
    return NextResponse.json({
      dossier: { id: dossier.id, clientNom: dossier.clientNom, ville: dossier.clientVille, telephone: dossier.clientTelephone, etape: dossier.etape, typeProjet },
      photos,
      projet: projet ? { ...projet, resume: resumerProjet(projet, typeProjet) } : null,
      typeSuggere: typeSurfacePourProjet(typeProjet, projet?.zones ?? []),
      refsSite,
      preparations,
    });
  } catch (erreur) {
    return reponseErreur(erreur, "GET /api/simulateur/dossiers/[id]");
  }
}
