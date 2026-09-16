import type { Metadata } from "next";
import { etatAgentMail, listerMessages } from "@/lib/messages/consultation";
import FileMessages from "./_components/FileMessages";

export const metadata: Metadata = {
  title: "Messages — CoverSwap",
  description: "Mails de la boîte : ce que l'agent a rangé, et ce qui reste à trier.",
};

export const dynamic = "force-dynamic";

// ?message=<id> ouvre directement un mail (lien depuis une proposition ou un dossier).
export default async function MessagesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const parametres = await searchParams;
  const [messages, agent] = await Promise.all([listerMessages({ statut: "A_TRIER", limite: 150 }), etatAgentMail()]);
  return <FileMessages initiaux={messages} agent={agent} messageInitialId={typeof parametres.message === "string" ? parametres.message : null} />;
}
