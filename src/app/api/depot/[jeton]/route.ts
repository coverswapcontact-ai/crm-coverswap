import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod/v4";
import { analyser, reponseErreur } from "@/lib/commun/api";
import { ErreurMetier } from "@/lib/commun/erreurs";
import { ouvrirDepot, recevoirFichier, verifierEnvoiOuvert } from "@/lib/fichiers-depot/jetons";
import { FICHIERS_MAX_DEPOT, OCTETS_MAX_FICHIER } from "@/lib/fichiers-depot/types";
import { adresseIp, autoriserAppel } from "@/lib/oauth/limite";

/**
 * Mission 17 (partie C) — la route publique du lien de dépôt (routes-publiques.ts) :
 * sans session, protégée par le jeton du lien (32 octets aléatoires, empreinte seule
 * en base, 30 minutes, usage unique) et par une limite par adresse.
 *
 * - POST JSON { tailles: number[] } : la soumission du formulaire. Consomme le lien
 *   (une seule fois) et rend la clé d'envoi de cette soumission.
 * - POST octets bruts (un fichier), en-têtes X-Cle-Depot et X-Nom-Fichier : un fichier
 *   de la soumission, vérifié (octets magiques, taille) puis enregistré sur la cible.
 *
 * Lien expiré, déjà utilisé ou inconnu, clé fausse : refus, rien n'est écrit.
 */

export const dynamic = "force-dynamic";

const ENTETES = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" };
const schemaOuverture = z.object({ tailles: z.array(z.number().int().min(0)).min(1).max(FICHIERS_MAX_DEPOT) });

/** Le corps, coupé au-delà de `max` octets (sans tout lire d'abord). */
async function corpsBorne(requete: Request, max: number): Promise<Buffer> {
  const annonce = Number(requete.headers.get("content-length") ?? "");
  if (Number.isFinite(annonce) && annonce > max) throw new ErreurMetier(`Fichier trop lourd : ${Math.round(max / 1024 / 1024)} Mo maximum.`, 413);
  if (!requete.body) return Buffer.alloc(0);
  const lecteur = requete.body.getReader();
  const morceaux: Buffer[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await lecteur.read();
    if (done) break;
    total += value.length;
    if (total > max) {
      await lecteur.cancel().catch(() => undefined);
      throw new ErreurMetier(`Fichier trop lourd : ${Math.round(max / 1024 / 1024)} Mo maximum.`, 413);
    }
    morceaux.push(Buffer.from(value));
  }
  return Buffer.concat(morceaux);
}

export async function POST(requete: NextRequest, { params }: { params: Promise<{ jeton: string }> }) {
  try {
    const { jeton } = await params;
    const ip = adresseIp(requete);
    if (!autoriserAppel(`depot:${ip}`, 120, 10 * 60_000)) throw new ErreurMetier("Trop d'envois depuis cette adresse : réessaie dans quelques minutes.", 429);
    const type = requete.headers.get("content-type") ?? "";
    if (type.includes("application/json")) {
      if (!autoriserAppel(`depot-ouverture:${ip}`, 20, 10 * 60_000)) throw new ErreurMetier("Trop d'essais depuis cette adresse : réessaie dans quelques minutes.", 429);
      let brut: unknown;
      try {
        brut = JSON.parse((await corpsBorne(requete, 8_000)).toString("utf8"));
      } catch (erreur) {
        if (erreur instanceof ErreurMetier) throw erreur;
        throw new ErreurMetier("Requête invalide.", 400);
      }
      const { tailles } = analyser(schemaOuverture, brut);
      const ouvert = await ouvrirDepot(jeton, { tailles });
      return NextResponse.json({ ok: true, cle: ouvert.cle, fichiers: ouvert.fichiers, envoiExpireLe: ouvert.envoiExpireLe.toISOString() }, { headers: ENTETES });
    }
    const cle = requete.headers.get("x-cle-depot") ?? "";
    let nom: string | null = null;
    try {
      nom = decodeURIComponent(requete.headers.get("x-nom-fichier") ?? "") || null;
    } catch {
      nom = null;
    }
    // Jeton et clé vérifiés AVANT de lire le corps : un envoi sans lien valide ne fait lire aucun octet.
    await verifierEnvoiOuvert(jeton, cle);
    const contenu = await corpsBorne(requete, OCTETS_MAX_FICHIER);
    const recu = await recevoirFichier(jeton, cle, { contenu, nom });
    return NextResponse.json({ ok: true, nom: recu.nom, destination: recu.destination, avertissements: recu.avertissements }, { headers: ENTETES });
  } catch (erreur) {
    const reponse = reponseErreur(erreur, "POST /api/depot/[jeton]");
    for (const [cle, valeur] of Object.entries(ENTETES)) reponse.headers.set(cle, valeur);
    return reponse;
  }
}
