import { NextResponse, type NextRequest } from "next/server";
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

export async function GET(requete: NextRequest) {
  // ?reseau=1 : ce que le serveur arrive à joindre (ntfy, Telegram, Brevo…), avec
  // la cause exacte d'un échec. Résultat gardé une minute ; aucun secret n'y figure.
  const reseau = new URL(requete.url).searchParams.get("reseau") === "1" ? await (await import("@/lib/alertes/reseau")).sonderReseau() : undefined;
  // Mission 11 : le registre des outils MCP (nombre, empreinte), pour vérifier un déploiement d'un coup d'œil.
  const outils = await import("@/lib/assistant/couverture").then(({ registreOutils }) => {
    const r = registreOutils();
    return { nombre: r.nombre, empreinte: r.empreinte };
  }).catch(() => null);
  return NextResponse.json({
    status: "ok",
    timestamp: Date.now(),
    commit: (process.env.RAILWAY_GIT_COMMIT_SHA || "inconnu").slice(0, 7),
    alertes: {
      canaux: Object.fromEntries(CANAUX.map((canal) => [canal, canalConfigure(canal)])),
      push: pushDisponible(),
    },
    outils,
    ...(reseau ? { reseau } : {}),
  });
}
