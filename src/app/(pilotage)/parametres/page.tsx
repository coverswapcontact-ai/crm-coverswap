import type { Metadata } from "next";
import { parametresPourEcran } from "@/lib/parametres/service";
import AssistantClaude from "./_components/AssistantClaude";
import Connexions from "./_components/Connexions";
import EcranParametres from "./_components/EcranParametres";
import MessagerieSms from "./_components/MessagerieSms";
import MarqueEspace from "./_components/MarqueEspace";
import ReglagesMail from "./_components/ReglagesMail";

export const metadata: Metadata = {
  title: "Paramètres — CoverSwap",
  description: "Seuils fiscaux, taux et règles datés ; connexions Google et miroir Drive ; mail (guide de style, mails automatiques, expéditeurs) ; messagerie SMS ; photo de l'espace client ; assistant Claude (serveur MCP, consignes, accès).",
};

export const dynamic = "force-dynamic";

export default async function ParametresPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const parametres = await searchParams;
  const texte = (cle: string) => (typeof parametres[cle] === "string" ? (parametres[cle] as string) : null);
  return (
    <>
      <EcranParametres initiaux={await parametresPourEcran()} />
      <div className="mx-auto w-full max-w-3xl px-5 pb-10 md:px-8">
        <Connexions retour={{ google: texte("google"), compte: texte("compte"), message: texte("message") }} />
        <ReglagesMail />
        <MessagerieSms />
        <MarqueEspace />
        <AssistantClaude />
      </div>
    </>
  );
}
