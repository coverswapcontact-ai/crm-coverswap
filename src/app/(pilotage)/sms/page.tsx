import type { Metadata } from "next";
import { Messagerie } from "@/components/sms/Messagerie";
import { listerConversations } from "@/lib/sms/conversations";
import { etatFournisseur } from "@/lib/sms/fournisseurs";

export const metadata: Metadata = {
  title: "SMS — CoverSwap",
  description: "Messagerie SMS : conversations avec les clients, contexte du dossier à portée de main.",
};

export const dynamic = "force-dynamic";

export default async function PageSms() {
  return <Messagerie initiale={{ ...(await listerConversations()), fournisseur: etatFournisseur() }} />;
}
