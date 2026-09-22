import type { Metadata } from "next";
import { sessionsRecentes } from "@/lib/assistant/execution";
import { auditerConnexions } from "@/lib/audit/connexions";
import { controlerCoherence } from "@/lib/coherence/controle";
import { etatDesTaches } from "@/lib/taches/lecture";
import AuditConnexions from "./_components/AuditConnexions";
import ControleCoherence from "./_components/ControleCoherence";
import EtatTaches from "./_components/EtatTaches";
import SessionsAssistant from "./_components/SessionsAssistant";

export const metadata: Metadata = {
  title: "Tâches de fond — CoverSwap",
  description: "Connexions du CRM vérifiées sur les vraies données ; file des envois, du miroir Drive et de la relève des mails ; sessions de l'assistant Claude.",
};

export const dynamic = "force-dynamic";

export default async function TachesPage() {
  const [audit, taches, coherence, sessions] = await Promise.all([auditerConnexions(), etatDesTaches(), controlerCoherence(), sessionsRecentes(10)]);
  return (
    <>
      <div className="mx-auto w-full max-w-5xl px-5 pt-6 md:px-8 md:pt-8">
        <ControleCoherence initial={coherence} />
        <AuditConnexions initial={audit} />
        <SessionsAssistant initial={sessions} />
      </div>
      <EtatTaches initial={taches} />
    </>
  );
}
