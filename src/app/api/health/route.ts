import { NextResponse } from "next/server";

/**
 * Sonde de santé (Railway) : ne lit ni n'écrit la base. Elle dit aussi quel
 * commit tourne, pour savoir d'un coup d'œil si un déploiement est bien passé.
 * Railway pose RAILWAY_GIT_COMMIT_SHA à la construction.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    status: "ok",
    timestamp: Date.now(),
    commit: (process.env.RAILWAY_GIT_COMMIT_SHA || "inconnu").slice(0, 7),
  });
}
