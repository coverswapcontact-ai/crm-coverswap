import type { Metadata } from "next";
import { EnTeteEcran } from "@/components/v2/EnTeteEcran";
import { interfaceCourante } from "@/lib/interface/choix";
import { dossiersAvecPhotosApres, listerPublications } from "@/lib/site/publications";
import EcranSite from "./_components/EcranSite";

export const metadata: Metadata = {
  title: "Site — CoverSwap",
  description: "Réalisations et avis publiés sur coverswap.fr.",
};

export const dynamic = "force-dynamic";

// Mission 22 (A5) : en v2 (`interfaceCourante()`), le même écran v1 sous l'en-tête v2 « Le site » ; en v1 rien ne change.
export default async function SitePage() {
  const [publications, dossiers, v] = await Promise.all([listerPublications(), dossiersAvecPhotosApres(), interfaceCourante()]);
  const ecran = <EcranSite initiales={publications} dossiers={dossiers} />;
  if (v === "v2") return <EnTeteEcran titre="Le site" cadre="large-5">{ecran}</EnTeteEcran>;
  return ecran;
}
