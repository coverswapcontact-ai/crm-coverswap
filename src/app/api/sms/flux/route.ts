import type { NextRequest } from "next/server";
import { ecouterEvenementsSms } from "@/lib/sms/flux";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Flux temps réel de la messagerie (Server-Sent Events) : « cette conversation
 * a bougé ». L'écran va ensuite chercher ce qui a changé. Un battement toutes
 * les vingt secondes garde la connexion ouverte à travers les mandataires ; si
 * elle tombe, le navigateur se reconnecte seul, et l'écran se rabat sur une
 * relève périodique en attendant.
 */
export async function GET(requete: NextRequest) {
  const encodeur = new TextEncoder();
  let arreter: (() => void) | null = null;

  const flux = new ReadableStream<Uint8Array>({
    start(controleur) {
      const ecrire = (texte: string) => {
        try {
          controleur.enqueue(encodeur.encode(texte));
        } catch {
          arreter?.();
        }
      };
      ecrire("retry: 3000\n\n");
      const desabonner = ecouterEvenementsSms((evenement) => ecrire(`data: ${JSON.stringify(evenement)}\n\n`));
      const battement = setInterval(() => ecrire(": battement\n\n"), 20_000);
      arreter = () => {
        clearInterval(battement);
        desabonner();
        arreter = null;
        try {
          controleur.close();
        } catch {
          // Déjà fermé par le navigateur.
        }
      };
      requete.signal.addEventListener("abort", () => arreter?.());
    },
    cancel() {
      arreter?.();
    },
  });

  return new Response(flux, {
    headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" },
  });
}
