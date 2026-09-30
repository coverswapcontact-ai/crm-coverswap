import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod/v4";
import type { ReponseRelance } from "@/components/pilotage/analytique/Relancer";
import { analyser, lireCorpsJson, reponseErreur } from "@/lib/commun/api";
import { relancerSynchro } from "@/lib/analytique/synchro";
import { LIBELLES_SOURCE_SYNCHRONISEE, SOURCES_SYNCHRONISEES } from "@/lib/analytique/suivi";

export const dynamic = "force-dynamic";

const schema = z.object({ source: z.enum(SOURCES_SYNCHRONISEES, { error: "Source inconnue : Meta, Google Ads, Search Console ou fiche Google." }) });

/**
 * POST /api/analytique/synchro { source } — « Relancer » la synchronisation d'une source depuis l'écran Analytique :
 * une tâche neuve dans la file (relancerSynchro) ; l'état de la source se met à jour quand elle a tourné, et sa réussite
 * périme le cache de l'Analytique (analytique/memoire.ts : toute écriture sur les historiques ou l'état des sources).
 */
export async function POST(requete: NextRequest) {
  try {
    const { source } = analyser(schema, await lireCorpsJson(requete));
    const tache = await relancerSynchro(source);
    const reponse: ReponseRelance & { tache: string } = { ok: true, message: `Synchronisation « ${LIBELLES_SOURCE_SYNCHRONISEE[source]} » mise en file : l'état de la source et les chiffres changent dès qu'elle a abouti (quelques minutes au plus ; rouvrir l'onglet pour les voir).`, tache };
    return NextResponse.json(reponse, { status: 202 });
  } catch (erreur) {
    return reponseErreur(erreur, "POST /api/analytique/synchro");
  }
}
