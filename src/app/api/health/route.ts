import { NextResponse } from "next/server";
import { CANAUX, canalConfigure, pushDisponible } from "@/lib/alertes/canaux";

/**
 * Sonde de santé (Railway) : ne lit ni n'écrit la base. Elle dit aussi quel
 * commit tourne, pour savoir d'un coup d'œil si un déploiement est bien passé.
 * Railway pose RAILWAY_GIT_COMMIT_SHA à la construction.
 *
 * Elle dit enfin quels canaux d'alerte sont configurés : des NOMS de variables
 * et des booléens, jamais une valeur. Sans cela, un CRM qui ne prévient plus
 * personne a l'air parfaitement sain vu de l'extérieur.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    status: "ok",
    timestamp: Date.now(),
    commit: (process.env.RAILWAY_GIT_COMMIT_SHA || "inconnu").slice(0, 7),
    alertes: {
      canaux: Object.fromEntries(CANAUX.map((canal) => [canal, canalConfigure(canal)])),
      push: pushDisponible(),
    },
  });
}
