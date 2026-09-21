import type { Metadata } from "next";
import { auditerConnexions } from "@/lib/audit/connexions";
import { etatDesTaches } from "@/lib/taches/lecture";
import AuditConnexions from "./_components/AuditConnexions";
import EtatTaches from "./_components/EtatTaches";

export const metadata: Metadata = {
  title: "Tâches de fond — CoverSwap",
  description: "Connexions du CRM vérifiées sur les vraies données ; file des envois, du miroir Drive et de la relève des mails.",
};

export const dynamic = "force-dynamic";

export default async function TachesPage() {
  const [audit, taches] = await Promise.all([auditerConnexions(), etatDesTaches()]);
  return (
    <>
      <div className="mx-auto w-full max-w-5xl px-5 pt-6 md:px-8 md:pt-8">
        <AuditConnexions initial={audit} />
      </div>
      <EtatTaches initial={taches} />
    </>
  );
}
