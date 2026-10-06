import { NextResponse } from "next/server";
import { marquerJournalVu } from "@/lib/chronologie/journal";
import { reponseErreur } from "@/lib/commun/api";

export const dynamic = "force-dynamic";

/** Mission 22 (A1) — `POST /api/journal/vu` : « Tout vu », pose JOURNAL_VU_LE à l'instant. Route non publique. */
export async function POST() {
  try {
    const vuLe = await marquerJournalVu(new Date(), "Tout vu (journal)");
    return NextResponse.json({ vuLe: vuLe.toISOString() });
  } catch (erreur) {
    return reponseErreur(erreur, "POST /api/journal/vu");
  }
}
