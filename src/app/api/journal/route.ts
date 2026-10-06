import { NextResponse, type NextRequest } from "next/server";
import { FILTRES_JOURNAL, depuisDeLaVisite, journal, type FiltreJournal } from "@/lib/chronologie/journal";
import { reponseErreur } from "@/lib/commun/api";

export const dynamic = "force-dynamic";

function dateDe(brut: string | null): Date | null {
  if (!brut) return null;
  const date = new Date(brut);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Mission 22 (A1) — `GET /api/journal?depuis&jusqua&filtres=CLIENTS,ARGENT,SYSTEME&page&par_page` : le journal global
 * (lib/chronologie/journal.ts). Sans `depuis` : depuis le dernier « Tout vu » (paramètre JOURNAL_VU_LE), sinon 48 h ;
 * jamais plus de 30 jours. Route non publique (session), comme `/api/chronologie`.
 */
export async function GET(requete: NextRequest) {
  try {
    const p = requete.nextUrl.searchParams;
    const maintenant = new Date();
    const visite = await depuisDeLaVisite(maintenant);
    const depuis = dateDe(p.get("depuis")) ?? visite.depuis;
    const jusqua = dateDe(p.get("jusqua")) ?? maintenant;
    const filtres = (p.get("filtres") ?? "").split(",").filter((f): f is FiltreJournal => (FILTRES_JOURNAL as readonly string[]).includes(f));
    const page = Number(p.get("page") ?? 1) || 1;
    const parPage = Number(p.get("par_page") ?? 50) || 50;
    const resultat = await journal({ depuis, jusqua, filtres, page, parPage });
    return NextResponse.json({ ...resultat, vuLe: visite.vuLe?.toISOString() ?? null });
  } catch (erreur) {
    return reponseErreur(erreur, "GET /api/journal");
  }
}
