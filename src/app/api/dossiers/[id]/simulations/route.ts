import { NextResponse, type NextRequest } from "next/server";
import { lireFormulaire, reponseErreur, texteFormulaire } from "@/lib/commun/api";
import { ErreurMetier } from "@/lib/commun/erreurs";
import { deposerSimulationDossier, listerSimulationsDossier, texteSmsPublication } from "@/lib/simulations/dossier";
import { preparationsRecentes } from "@/lib/simulateur/preparation";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET  : toutes les simulations du dossier (brouillons, publiées, masquées,
 *        celles du site), les préparations récentes et le SMS « simulations
 *        prêtes » tel qu'il partirait à la publication.
 * POST : multipart { image, titre?, description?, preparation? } — dépose une
 *        image (ChatGPT ou autre) en brouillon ; « preparation » vide ou « auto » :
 *        la dernière préparation ChatGPT du dossier est reprise.
 */
export async function GET(_requete: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const [liste, preparations, sms] = await Promise.all([listerSimulationsDossier(id), preparationsRecentes(id), texteSmsPublication(id).catch(() => ({ texte: null, raison: "SMS indisponible." }))]);
    return NextResponse.json({ ...liste, preparations, sms });
  } catch (erreur) {
    return reponseErreur(erreur, "GET /api/dossiers/[id]/simulations");
  }
}

export async function POST(requete: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const formulaire = await lireFormulaire(requete);
    const image = formulaire.get("image");
    if (!(image instanceof File)) throw new ErreurMetier("Aucune image reçue.", 400);
    const preparation = texteFormulaire(formulaire, "preparation");
    const simulation = await deposerSimulationDossier(id, image, {
      titre: texteFormulaire(formulaire, "titre"),
      description: texteFormulaire(formulaire, "description"),
      source: texteFormulaire(formulaire, "source") === "CHATGPT" ? "CHATGPT" : "MANUEL",
      preparationId: !preparation || preparation === "auto" ? "auto" : preparation === "aucune" ? null : preparation,
    });
    return NextResponse.json({ simulation }, { status: 201 });
  } catch (erreur) {
    return reponseErreur(erreur, "POST /api/dossiers/[id]/simulations");
  }
}
