import type { Metadata } from "next";
import { listerPrompts } from "@/lib/simulateur/bibliotheque";
import EcranPrompts from "./_components/EcranPrompts";

export const metadata: Metadata = {
  title: "Prompts ChatGPT — CoverSwap",
  description: "La bibliothèque des prompts du simulateur : un par type de surface, versionnés, avec retour en arrière.",
};

export const dynamic = "force-dynamic";

export default async function PromptsPage() {
  return <EcranPrompts initial={await listerPrompts()} />;
}
