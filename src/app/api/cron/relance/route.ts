import { NextRequest, NextResponse } from "next/server";
import { proposerRelances } from "@/lib/relances/service";

// ============================================================================
// GET /api/cron/relance — appelée par un cron (Railway…), protégée par
// CRON_SECRET (en-tête Authorization). Route publique : sans CRON_SECRET
// configurée, elle refuse tout.
//
// Elle n'envoie plus aucun mail : elle propose les relances dues dans
// « À valider », où une personne relit et envoie (ou rejette). La même
// proposition tourne aussi en tâche de fond toutes les six heures.
// ============================================================================
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }
  try {
    const resume = await proposerRelances();
    return NextResponse.json({ ...resume, envoi: "Aucun mail envoyé : les relances sont proposées dans « À valider »." });
  } catch (erreur) {
    console.error("[cron/relance] Erreur :", erreur);
    return NextResponse.json({ error: "Erreur serveur : réessaie dans un instant." }, { status: 500 });
  }
}
