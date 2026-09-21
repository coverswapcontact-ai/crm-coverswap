import { NextResponse, type NextRequest } from "next/server";
import { reponseErreur } from "@/lib/commun/api";
import { analysesConnues, catalogue } from "@/lib/simulateur/catalogue";
import { couleurEnMots } from "@/lib/simulateur/couleur";
import { correspondAuStyle, profilDe, resumerTeinte } from "@/lib/simulateur/teintes";
import { STYLES_CLIENT } from "@/lib/simulateur/types-surface";

export const dynamic = "force-dynamic";

/**
 * GET ?styles=bois-clair,blanc : le catalogue Cover Styl' (celui du site), avec
 * la couleur mesurée de chaque échantillon quand elle est connue, et, pour les
 * goûts du client, les teintes qui y correspondent (proposées en premier).
 */
export async function GET(requete: NextRequest) {
  try {
    const styles = (requete.nextUrl.searchParams.get("styles") ?? "").split(",").filter((s) => (STYLES_CLIENT as readonly string[]).includes(s));
    const [references, analyses] = await Promise.all([catalogue(), analysesConnues()]);
    return NextResponse.json({
      references: references.map((r) => {
        const analyse = analyses[r.id] ?? null;
        return {
          ref: r.id,
          nom: r.nom,
          famille: r.famille,
          profil: profilDe(r),
          resume: resumerTeinte(r, analyse),
          hex: analyse?.hex ?? null,
          couleur: analyse ? couleurEnMots(analyse).fr : null,
          image: `/api/simulateur/echantillons/${encodeURIComponent(r.id)}`,
          styles: styles.filter((s) => correspondAuStyle(r, s, analyse)),
        };
      }),
      analysees: Object.keys(analyses).length,
    });
  } catch (erreur) {
    return reponseErreur(erreur, "GET /api/simulateur/catalogue");
  }
}
