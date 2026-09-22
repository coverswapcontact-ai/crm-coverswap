import { NextResponse, type NextRequest } from "next/server";
import { reponseErreur } from "@/lib/commun/api";
import { VUES_MAIL, listerVue, type VueMail } from "@/lib/mail/vues";

export const dynamic = "force-dynamic";

/** GET /api/mail?vue=A_TRAITER|CLIENTS|ADMINISTRATIF|RANGES&recherche=… : une vue de l'onglet Mail, et les compteurs des autres. */
export async function GET(requete: NextRequest) {
  try {
    const parametres = requete.nextUrl.searchParams;
    const demandee = parametres.get("vue") ?? "A_TRAITER";
    const vue = ((VUES_MAIL as readonly string[]).includes(demandee) ? demandee : "A_TRAITER") as VueMail;
    return NextResponse.json(await listerVue(vue, { recherche: parametres.get("recherche") ?? undefined }));
  } catch (erreur) {
    return reponseErreur(erreur, "GET /api/mail");
  }
}
