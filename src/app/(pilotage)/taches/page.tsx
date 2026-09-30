import type { Metadata } from "next";
import { listeTaches } from "@/lib/a-faire/lecture";
import EcranTaches from "./_components/EcranTaches";

export const metadata: Metadata = {
  title: "Tâches — CoverSwap",
  description: "Ce que Lucas a à faire aujourd'hui, en une liste : une ligne par tâche, l'action prête en un geste, puis Fait, Plus tard ou Pas à faire.",
};

export const dynamic = "force-dynamic";

// Mission 17 (partie A) : l'accueil de l'application. La liste est lue ici, en une requête, et rendue d'emblée (aucune
// attente réseau au premier affichage) ; l'écran se relit ensuite seul (gestes, retour d'onglet, toutes les 20 s).
export default async function TachesPage() {
  const initiale = await listeTaches(new Date());
  return <EcranTaches initiale={initiale} />;
}
