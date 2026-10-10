import type { Metadata } from "next";
import { TableauDeBord } from "@/components/messagerie/TableauDeBord";
import { tableauMessagerie } from "@/lib/messagerie/tableau";

export const metadata: Metadata = {
  title: "Tableau de la messagerie — CoverSwap",
  description: "Semaine par semaine : taux de réponse par message, délai, messages préparés, envoyés, reportés, refusés, relances retenues et pourquoi, STOP, devis signés après une relance, coût de l'IA du mois.",
};

export const dynamic = "force-dynamic";

// Mission 25 (lot 7) : le tableau de bord hebdomadaire, ouvert depuis le menu de la Messagerie ; lu par le serveur.
export default async function TableauMessageriePage() {
  return <TableauDeBord tableau={await tableauMessagerie()} />;
}
