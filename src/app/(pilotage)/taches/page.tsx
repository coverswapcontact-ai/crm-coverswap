import type { Metadata } from "next";
import { Aujourdhui } from "@/components/v2/taches/Aujourdhui";
import { listeTaches } from "@/lib/a-faire/lecture";
import { depuisDeLaVisite, journal } from "@/lib/chronologie/journal";
import { interfaceCourante } from "@/lib/interface/choix";
import { JOURNAL_PAR_PAGE } from "@/lib/v2/aujourdhui";
import { lireReprendre } from "@/lib/v2/reprendre-serveur";
import EcranTaches from "./_components/EcranTaches";

export const metadata: Metadata = {
  title: "Tâches — CoverSwap",
  description: "Ce que Lucas a à faire aujourd'hui, en une liste : une ligne par tâche, l'action prête en un geste, puis Fait, Plus tard ou Pas à faire.",
};

export const dynamic = "force-dynamic";

// Mission 17 (partie A) : l'accueil de l'application. La liste est lue ici, en une requête, et rendue d'emblée (aucune
// attente réseau au premier affichage) ; l'écran se relit ensuite seul (gestes, retour d'onglet, toutes les 20 s).
// Mission 22 (A2) : en v2 (`interfaceCourante()`), l'écran Aujourd'hui (`components/v2/taches/Aujourdhui`), avec le
// journal compact depuis la dernière visite et le bandeau « Reprendre » lus en parallèle ; la v1 est servie telle quelle.
export default async function TachesPage() {
  const v = await interfaceCourante();
  if (v !== "v2") {
    const initiale = await listeTaches(new Date());
    return <EcranTaches initiale={initiale} />;
  }
  const maintenant = new Date();
  const [initiale, visite, reprendre] = await Promise.all([listeTaches(maintenant), depuisDeLaVisite(maintenant), lireReprendre(maintenant)]);
  const lu = await journal({ depuis: visite.depuis, jusqua: maintenant, parPage: JOURNAL_PAR_PAGE });
  return <Aujourdhui initiale={initiale} journal={{ ...lu, vuLe: visite.vuLe?.toISOString() ?? null }} reprendre={reprendre} />;
}
