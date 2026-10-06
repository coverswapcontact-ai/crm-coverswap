import type { Metadata } from "next";
import { EnTeteEcran } from "@/components/v2/EnTeteEcran";
import { interfaceCourante } from "@/lib/interface/choix";
import EcranSimulateur from "./_components/EcranSimulateur";

export const metadata: Metadata = {
  title: "Simulateur — CoverSwap",
  description: "Préparer une simulation pour un client : par l'API (même moteur que le site) ou pour ChatGPT (prompt, planche des teintes, photo).",
};

export const dynamic = "force-dynamic";

// ?dossier=<id> : le client est déjà choisi (bouton « Simulateur » d'un dossier ou d'un espace).
// Mission 22 (A5) : en v2 (`interfaceCourante()`), le même écran v1 sous l'en-tête v2 « Simulateur » ; en v1 rien ne change.
export default async function SimulateurPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const parametres = await searchParams;
  const dossier = typeof parametres.dossier === "string" && /^[a-z0-9]{10,40}$/i.test(parametres.dossier) ? parametres.dossier : null;
  // ?preparation=<id> : une préparation faite par l'assistant (mission 10), rouverte prête à copier.
  const preparation = typeof parametres.preparation === "string" && /^[a-z0-9]{10,40}$/i.test(parametres.preparation) ? parametres.preparation : null;
  const v = await interfaceCourante();
  const ecran = <EcranSimulateur dossierInitial={dossier} preparationInitiale={preparation} />;
  if (v === "v2") return <EnTeteEcran titre="Simulateur" cadre="colonne-4">{ecran}</EnTeteEcran>;
  return ecran;
}
