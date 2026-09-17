import type { Metadata } from "next";
import { dossiersAvecPhotosApres, listerPublications } from "@/lib/site/publications";
import EcranSite from "./_components/EcranSite";

export const metadata: Metadata = {
  title: "Site — CoverSwap",
  description: "Réalisations et avis publiés sur coverswap.fr.",
};

export const dynamic = "force-dynamic";

export default async function SitePage() {
  const [publications, dossiers] = await Promise.all([listerPublications(), dossiersAvecPhotosApres()]);
  return <EcranSite initiales={publications} dossiers={dossiers} />;
}
