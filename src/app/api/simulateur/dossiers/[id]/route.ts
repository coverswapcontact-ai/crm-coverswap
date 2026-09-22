import { NextResponse, type NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { reponseErreur } from "@/lib/commun/api";
import { ErreurMetier } from "@/lib/commun/erreurs";
import { lireProjet, resumerProjet } from "@/lib/espace/projet";
import { photosAvantDuDossier, preparationsRecentes } from "@/lib/simulateur/preparation";
import { lireZones, typeSurfacePourProjet } from "@/lib/simulateur/types-surface";
import { famillesDe, lireSelection } from "@/lib/prestations/prestations";

export const dynamic = "force-dynamic";

/**
 * GET : ce que le simulateur doit savoir d'un dossier — ses photos « avant »,
 * le projet et les goûts que le client a dits dans son espace (proposés en
 * premier) — ses familles et sous-parties donnent les zones demandées et le type
 * de surface le plus probable (fichier des prestations) —, les teintes qu'il a déjà
 * essayées sur le site, et les préparations récentes.
 */
export async function GET(_requete: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const dossier = await prisma.dossier.findUnique({
      where: { id },
      select: { id: true, clientNom: true, clientVille: true, clientTelephone: true, etape: true, archiveLe: true, prestations: true, lead: { select: { typeProjet: true } }, espaces: { select: { souhaits: true, favoris: true, permanent: { select: { favoris: true } } } } },
    });
    if (!dossier || dossier.archiveLe) throw new ErreurMetier("Dossier introuvable ou archivé.", 404);
    const selection = lireSelection(dossier.prestations);
    const typeProjet = famillesDe(selection)[0] ?? dossier.lead?.typeProjet ?? "CUISINE";
    const projet = lireProjet(dossier.espaces[0]?.souhaits ?? null, selection, dossier.lead?.typeProjet);
    const [photos, preparations, simulationsSite] = await Promise.all([
      photosAvantDuDossier(id),
      preparationsRecentes(id),
      prisma.simulationEspace.findMany({ where: { dossierId: id, source: { in: ["SITE", "CLIENT"] }, archiveLe: null }, select: { zones: true, source: true } }),
    ]);
    const refsSite = [...new Set(simulationsSite.filter((s) => s.source === "SITE").flatMap((s) => lireZones(s.zones).map((z) => z.ref)))];
    // Ses favoris et les teintes de ses propres simulations (espace v3) : ce qu'il aime, proposé en premier.
    const favoris = (() => {
      try {
        const valeur: unknown = JSON.parse(dossier.espaces[0]?.permanent?.favoris ?? dossier.espaces[0]?.favoris ?? "[]");
        return Array.isArray(valeur) ? valeur.filter((r): r is string => typeof r === "string") : [];
      } catch {
        return [];
      }
    })();
    const refsClient = [...new Set([...favoris, ...simulationsSite.filter((s) => s.source === "CLIENT").flatMap((s) => lireZones(s.zones).map((z) => z.ref))])];
    return NextResponse.json({
      dossier: { id: dossier.id, clientNom: dossier.clientNom, ville: dossier.clientVille, telephone: dossier.clientTelephone, etape: dossier.etape, typeProjet },
      photos,
      projet: projet ? { ...projet, resume: resumerProjet(projet) } : null,
      typeSuggere: typeSurfacePourProjet(typeProjet, projet?.zones ?? []),
      refsSite,
      refsClient,
      preparations,
    });
  } catch (erreur) {
    return reponseErreur(erreur, "GET /api/simulateur/dossiers/[id]");
  }
}
