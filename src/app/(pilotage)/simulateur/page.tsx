import type { Metadata } from "next";
import EcranSimulateur from "./_components/EcranSimulateur";

export const metadata: Metadata = {
  title: "Simulateur — CoverSwap",
  description: "Préparer une simulation pour un client : par l'API (même moteur que le site) ou pour ChatGPT (prompt, planche des teintes, photo).",
};

export const dynamic = "force-dynamic";

// ?dossier=<id> : le client est déjà choisi (bouton « Simulateur » d'un dossier ou d'un espace).
export default async function SimulateurPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const parametres = await searchParams;
  const dossier = typeof parametres.dossier === "string" && /^[a-z0-9]{10,40}$/i.test(parametres.dossier) ? parametres.dossier : null;
  return <EcranSimulateur dossierInitial={dossier} />;
}
