import { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic();

const SYSTEM_PROMPT = `Tu es l'assistant IA de CoverSwap, une entreprise specialisee dans la renovation de plans de travail de cuisine et salle de bain par recouvrement (covering).

Contexte metier :
- CoverSwap pose des films adhesifs haut de gamme sur les plans de travail existants
- Les references proviennent du fournisseur Tego France (France@tego.eu)
- Le prix est calcule au metre lineaire (ML) avec un prix HT par ML
- Un supplement est applique : 4.80 EUR/ML si < 10 ML, sinon 2.40 EUR/ML
- Les frais de deplacement sont ajoutes au total
- L'acompte est de 30%, le solde de 70%
- Le processus : Lead -> Devis -> Signature -> Commande materiel -> Chantier -> Facturation

Tu peux aider avec :
- Questions sur les leads et le suivi commercial
- Calcul de devis et marges
- Suivi des chantiers et commandes
- Conseils sur la relation client
- Analyse des performances commerciales

Reponds toujours en francais, de maniere professionnelle et concise.`;

export async function POST(request: NextRequest) {
  try {
    const { messages } = await request.json();

    if (!messages || !Array.isArray(messages)) {
      return new Response(
        JSON.stringify({ error: "Messages requis" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const stream = await anthropic.messages.stream({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: messages.map((m: { role: string; content: string }) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })),
    });

    const encoder = new TextEncoder();

    const readableStream = new ReadableStream({
      async start(controller) {
        try {
          for await (const event of stream) {
            if (
              event.type === "content_block_delta" &&
              event.delta.type === "text_delta"
            ) {
              controller.enqueue(encoder.encode(event.delta.text));
            }
          }
          controller.close();
        } catch (err) {
          controller.error(err);
        }
      },
    });

    return new Response(readableStream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    console.error("POST /api/assistant error:", error);
    return new Response(
      JSON.stringify({ error: "Erreur lors de la generation de la reponse" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
