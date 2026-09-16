import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ErreurMetier } from "@/lib/commun/erreurs";
import { chargerFiche } from "@/lib/clients/fiches";
import type { ClientDetail } from "@/lib/clients/types";
import FicheClient from "../_components/FicheClient";

export const metadata: Metadata = {
  title: "Fiche client — CoverSwap",
};

export const dynamic = "force-dynamic";

async function ficheOuRien(id: string): Promise<ClientDetail | null> {
  try {
    return await chargerFiche(id);
  } catch (erreur) {
    if (erreur instanceof ErreurMetier && erreur.status === 404) return null;
    throw erreur;
  }
}

export default async function FicheClientPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const fiche = await ficheOuRien(id);
  if (!fiche) notFound();
  return <FicheClient initial={fiche} />;
}
