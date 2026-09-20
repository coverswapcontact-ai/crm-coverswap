import { NextResponse } from "next/server";
import { reponseErreur } from "@/lib/commun/api";
import { CANAUX_PUSH, alerter, canauxConfigures } from "@/lib/alertes/canaux";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Envoie une notification d'essai sur TOUS les canaux et rend le résultat de
 * chacun, y compris ceux qui ne sont pas configurés. C'est le bouton « Tester
 * la notification » de l'écran Publicité : il répond à la seule question qui
 * compte, est-ce que le téléphone sonne. Réservé aux personnes connectées.
 */
export async function POST() {
  try {
    const resultats = await alerter({
      titre: "Essai de notification CoverSwap",
      texte: [
        "Essai lancé depuis l'écran Publicité.",
        "Si ce message apparaît sur votre téléphone, ce canal fonctionne : un vrai lead vous préviendra de la même façon.",
      ].join("\n\n"),
      lien: `${(process.env.NEXT_PUBLIC_APP_URL || "https://crm.coverswap.fr").replace(/\/$/, "")}/publicite`,
      libelleLien: "Ouvrir l'écran Publicité",
      telephone: "+33612345678",
      urgence: 4,
    }, { origine: "essai" });
    return NextResponse.json({
      resultats,
      pousseRecue: resultats.some((r) => r.ok && CANAUX_PUSH.includes(r.canal)),
      canauxConfigures: canauxConfigures(),
    });
  } catch (erreur) {
    return reponseErreur(erreur, "POST /api/meta/notification");
  }
}
