import type { Metadata } from "next";
import { listerSequences } from "@/lib/mail/sequences";
import { lireParametre } from "@/lib/parametres/service";
import EcranSequences from "./_components/EcranSequences";

export const metadata: Metadata = {
  title: "Séquences — CoverSwap",
  description: "Les relances par mail, prêtes et inactives : lead injoignable, devis non signé, demande d'avis, réactivation à 6 mois.",
};

export const dynamic = "force-dynamic";

export default async function SequencesPage() {
  const [sequences, expediteur] = await Promise.all([listerSequences(), lireParametre("MAIL_EXPEDITEUR")]);
  return <EcranSequences initial={sequences} expediteur={typeof expediteur === "string" && expediteur.trim() ? expediteur.trim() : null} />;
}
