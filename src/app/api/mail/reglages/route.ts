import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod/v4";
import prisma from "@/lib/prisma";
import { analyser, lireCorpsJson, reponseErreur } from "@/lib/commun/api";
import { EVENEMENTS_NOTIFIES, LIBELLES_NOTIFICATION, enregistrerModeleNotification, modeleNotification } from "@/lib/mail/notifications";
import { poserRegle } from "@/lib/mail/boite";
import { TYPE_REGLE_TRI } from "@/lib/mail/propositions-maj";
import { enregistrerGuideStyle, lireGuideStyle } from "@/lib/mail/redaction";
import { listerPropositions } from "@/lib/validation/service";

export const dynamic = "force-dynamic";

async function reglages() {
  const [guide, modeles, regles, proposees] = await Promise.all([
    lireGuideStyle(),
    Promise.all(EVENEMENTS_NOTIFIES.map(async (evenement) => ({ evenement, libelle: LIBELLES_NOTIFICATION[evenement], ...(await modeleNotification(evenement)) }))),
    prisma.regleExpediteur.findMany({ where: { archiveLe: null }, orderBy: { createdAt: "desc" }, take: 300, select: { id: true, cible: true, action: true, motif: true, createdAt: true } }),
    listerPropositions({ type: TYPE_REGLE_TRI, statuts: ["EN_ATTENTE"], limite: 50 }),
  ]);
  return { guide, modeles, regles: regles.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })), proposees };
}

/** GET : guide de style, modèles des notifications, décisions sur les expéditeurs. */
export async function GET() {
  try {
    return NextResponse.json(await reglages());
  } catch (erreur) {
    return reponseErreur(erreur, "GET /api/mail/reglages");
  }
}

const schema = z.object({
  guide: z.string().trim().min(20).max(4000).optional(),
  modele: z.object({ evenement: z.enum(EVENEMENTS_NOTIFIES), objet: z.string().trim().min(3).max(150), phrase: z.string().trim().min(10).max(600), bouton: z.string().trim().min(2).max(40), actif: z.boolean() }).optional(),
  archiverRegle: z.string().max(40).optional(),
  /** Mission 9 : une règle posée à la main (adresse exacte ou « @domaine »). */
  regle: z.object({ cible: z.string().trim().min(3).max(160), action: z.enum(["RANGER", "NE_JAMAIS_RANGER", "ADMINISTRATIF"]) }).optional(),
});

/** PATCH : écrire le guide de style, un modèle de notification, ou retirer une décision sur un expéditeur (archivée). */
export async function PATCH(requete: NextRequest) {
  try {
    const entree = analyser(schema, await lireCorpsJson(requete));
    if (entree.guide) await enregistrerGuideStyle(entree.guide, "LUCAS");
    if (entree.modele) {
      const { evenement, ...modele } = entree.modele;
      await enregistrerModeleNotification(evenement, modele, "LUCAS");
    }
    if (entree.archiverRegle) await prisma.regleExpediteur.update({ where: { id: entree.archiverRegle }, data: { archiveLe: new Date(), archiveMotif: "Retirée par Lucas (Paramètres)" } });
    if (entree.regle) {
      const cible = entree.regle.cible.toLowerCase();
      if (!cible.includes("@")) return NextResponse.json({ error: "La cible est une adresse (« x@y.fr ») ou un domaine (« @y.fr »)." }, { status: 400 });
      await poserRegle(cible, entree.regle.action, "Posée à la main dans Paramètres", "LUCAS", cible.startsWith("@"));
    }
    return NextResponse.json(await reglages());
  } catch (erreur) {
    return reponseErreur(erreur, "PATCH /api/mail/reglages");
  }
}
