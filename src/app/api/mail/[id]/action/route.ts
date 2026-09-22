import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod/v4";
import { analyser, lireCorpsJson, reponseErreur } from "@/lib/commun/api";
import { archiverFil, classerALaMain, marquerLu, nePlusMontrer, remonter } from "@/lib/mail/boite";

export const dynamic = "force-dynamic";

const schema = z.object({
  action: z.enum(["LU", "NON_LU", "ARCHIVER", "DESARCHIVER", "REMONTER", "NE_PLUS_MONTRER", "CLASSER"], "Geste inconnu."),
  classe: z.enum(["ADMINISTRATIF", "HUMAIN", "CLIENT"]).optional(),
  pourLExpediteur: z.boolean().optional(),
});

/** POST { action } : les gestes au pouce — lu, non lu, archiver, remonter, ne plus montrer cet expéditeur, classer. */
export async function POST(requete: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { action, classe, pourLExpediteur } = analyser(schema, await lireCorpsJson(requete));
    switch (action) {
      case "LU":
      case "NON_LU":
        await marquerLu(id, action === "LU");
        return NextResponse.json({ ok: true });
      case "ARCHIVER":
      case "DESARCHIVER":
        await archiverFil(id, action === "ARCHIVER");
        return NextResponse.json({ ok: true });
      case "REMONTER":
        await remonter(id);
        return NextResponse.json({ ok: true });
      case "NE_PLUS_MONTRER":
        return NextResponse.json(await nePlusMontrer(id));
      case "CLASSER":
        await classerALaMain(id, classe ?? "HUMAIN", pourLExpediteur === true);
        return NextResponse.json({ ok: true });
    }
  } catch (erreur) {
    return reponseErreur(erreur, "POST /api/mail/[id]/action");
  }
}
