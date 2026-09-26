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
  description: "File des envois, du miroir Drive, des sauvegardes et de la relève des mails ; contrôle de cohérence ; connexions vérifiées ; sessions de l'assistant Claude.",
};

export const dynamic = "force-dynamic";

// Mission 13 (lot 3) : l'en-tête en haut, les tâches à voir d'abord ; cohérence, audit et sessions à la suite.
export default async function TachesPage() {
  const [audit, taches, coherence, sessions] = await Promise.all([auditerConnexions(), etatDesTaches(), controlerCoherence(), sessionsRecentes(10)]);
  return (
    <EtatTaches initial={taches}>
      <div className="mt-8">
        <ControleCoherence initial={coherence} />
        <AuditConnexions initial={audit} />
        <SessionsAssistant initial={sessions} />
      </div>
    </EtatTaches>
  );
}
