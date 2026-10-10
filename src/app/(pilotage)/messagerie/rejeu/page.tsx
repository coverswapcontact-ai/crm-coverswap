import type { Metadata } from "next";
import { RejeuMessagerie } from "@/components/messagerie/Rejeu";

export const metadata: Metadata = {
  title: "Rejouer les événements — CoverSwap",
  description: "Les 20 derniers événements réels (réponses des clients, notes) relus à blanc par les règles fixes et, au choix, par l'IA : rien n'est écrit ni envoyé.",
};

export const dynamic = "force-dynamic";

// Mission 25 (lot 5) : le rejeu à blanc, ouvert depuis le menu de la Messagerie.
export default function RejeuPage() {
  return <RejeuMessagerie />;
}
