import type { Metadata } from "next";
import { listerPropositions } from "@/lib/validation/service";
import FileValidation from "./_components/FileValidation";

export const metadata: Metadata = {
  title: "À valider — CoverSwap",
  description: "Propositions de l'agent et du système : rien ne part sans validation.",
};

export const dynamic = "force-dynamic";

export default async function ValidationPage() {
  const propositions = await listerPropositions({ statuts: ["EN_ATTENTE"], limite: 200 });
  return <FileValidation initiales={propositions} />;
}
