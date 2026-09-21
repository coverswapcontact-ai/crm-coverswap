import { Messagerie } from "@/components/sms/Messagerie";
import { listerConversations } from "@/lib/sms/conversations";
import { etatFournisseur } from "@/lib/sms/fournisseurs";

export const dynamic = "force-dynamic";

export default async function PageMessagerie() {
  return <Messagerie application="messages" initiale={{ ...(await listerConversations()), fournisseur: etatFournisseur() }} />;
}
