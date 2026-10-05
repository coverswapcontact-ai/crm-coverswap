import { NextResponse, type NextRequest } from "next/server";
import { analyser, lireCorpsJson, reponseErreur } from "@/lib/commun/api";
import { deposerDocument } from "@/lib/dossiers/depot-document";
import { lireDevisGmail, schemaDevisGmail } from "@/lib/dossiers/devis-gmail";
import { chargerDetail } from "@/lib/dossiers/dossiers";
import { ErreurMetier } from "@/lib/commun/erreurs";

type Contexte = { params: Promise<{ id: string }> };

export const dynamic = "force-dynamic";

/**
 * Mission 18 (B3) — « Enregistrer comme devis envoyé » : un PDF parti de Gmail chez le client du dossier.
 * GET ?piece= : ce que la modale préremplit (nom, date du mail, numéro lu dans le nom, devis du CRM de ce numéro,
 * montant du registre). POST : le dépôt, par la même fonction que l'outil « ajouter_fichier » (`deposerDocument`).
 */
export async function GET(requete: NextRequest, { params }: Contexte) {
  try {
    const { id } = await params;
    const piece = requete.nextUrl.searchParams.get("piece");
    if (!piece) throw new ErreurMetier("Pièce manquante.", 400);
    return NextResponse.json(await lireDevisGmail(id, piece));
  } catch (erreur) {
    return reponseErreur(erreur, "GET /api/dossiers/[id]/devis-gmail");
  }
}

export async function POST(requete: NextRequest, { params }: Contexte) {
  try {
    const { id } = await params;
    const e = analyser(schemaDevisGmail, await lireCorpsJson(requete));
    const depot = await deposerDocument(id, {
      type: "DEVIS",
      statut: "ENVOYE",
      numero: e.numero ?? undefined,
      montant: e.montant ?? undefined,
      date_emission: e.dateEmission ?? undefined,
      acompte_pct: e.acomptePct ?? undefined,
      libelle: e.libelleVariante ?? undefined,
      objet: e.objet ?? undefined,
      inscrire_au_registre: e.inscrireAuRegistre ?? false,
      source: { message_id: e.messageId, piece_id: e.pieceId },
    });
    if (depot.nature !== "DOCUMENT") throw new ErreurMetier("Dépôt inattendu.", 500);
    return NextResponse.json({ documentId: depot.documentId, numero: depot.numero, avertissements: depot.avertissements, gmail: depot.gmail ?? null, dossier: await chargerDetail(id) }, { status: 201 });
  } catch (erreur) {
    return reponseErreur(erreur, "POST /api/dossiers/[id]/devis-gmail");
  }
}
