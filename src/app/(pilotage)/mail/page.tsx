import type { Metadata } from "next";
import { EnTeteEcran } from "@/components/v2/EnTeteEcran";
import { interfaceCourante } from "@/lib/interface/choix";
import { listerVue } from "@/lib/mail/vues";
import EcranMail from "./_components/EcranMail";

export const metadata: Metadata = {
  title: "Mail — CoverSwap",
  description: "La boîte triée d'office : ce qui attend une réponse, les échanges clients, l'administratif. Le bruit est rangé.",
};

export const dynamic = "force-dynamic";

// ?mail=<id> ouvre ce mail (liens des notifications, fiche client, dossier) ;
// ?client=<id>, ?lead=<id> ou ?dossier=<id> ouvre un nouveau mail pour ce contact, avec ?consigne= proposée à l'IA (jamais appelée d'office).
// Mission 22 (A5) : en v2 (`interfaceCourante()`), le même écran v1 sous l'en-tête v2 « Boîte mail » ; en v1 rien ne change.
export default async function MailPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const parametres = await searchParams;
  const mail = typeof parametres.mail === "string" && /^[a-z0-9]{10,40}$/i.test(parametres.mail) ? parametres.mail : null;
  const client = typeof parametres.client === "string" && /^[a-z0-9]{10,40}$/i.test(parametres.client) ? parametres.client : null;
  const lead = typeof parametres.lead === "string" && /^[a-z0-9]{10,40}$/i.test(parametres.lead) ? parametres.lead : null;
  const consigne = typeof parametres.consigne === "string" ? parametres.consigne.trim().slice(0, 300) || null : null;
  const dossier = typeof parametres.dossier === "string" && /^[a-z0-9]{10,40}$/i.test(parametres.dossier) ? parametres.dossier : null;
  const contact = client ? `client:${client}` : lead ? `lead:${lead}` : dossier ? `dossier:${dossier}` : null;
  const v = await interfaceCourante();
  const ecran = <EcranMail initial={await listerVue("A_TRAITER")} mailInitial={mail} contactInitial={contact} consigneInitiale={contact ? consigne : null} />;
  if (v === "v2") return <EnTeteEcran titre="Boîte mail" cadre="colonne-4">{ecran}</EnTeteEcran>;
  return ecran;
}
