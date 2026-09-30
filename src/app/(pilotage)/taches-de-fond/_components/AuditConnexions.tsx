"use client";

import { useState } from "react";
import { CircleAlert, CircleCheck, CircleDashed, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import type { AuditConnexions as Audit } from "@/lib/audit/connexions";
import { appelApi, messageErreur } from "@/components/pilotage/client";
import { Bouton, TitreSection } from "@/components/pilotage/ui";
import { cn } from "@/lib/utils";

/**
 * Chaque maillon du CRM vérifié sur les vraies données, en lecture seule :
 * rien n'est créé, rien n'est envoyé. « Rien à vérifier » = le cas ne s'est pas
 * encore présenté en production (il est couvert par les essais automatiques).
 */
export default function AuditConnexions({ initial }: { initial: Audit }) {
  const [audit, setAudit] = useState(initial);
  const [charge, setCharge] = useState(false);

  async function relancer() {
    setCharge(true);
    try {
      setAudit(await appelApi<Audit>("/api/audit/connexions"));
    } catch (erreur) {
      toast.error("Audit impossible", { description: messageErreur(erreur) });
    } finally {
      setCharge(false);
    }
  }

  return (
    <section className="mb-10">
      <TitreSection
        action={
          <Bouton taille="sm" icone={<RefreshCw size={13} aria-hidden />} chargement={charge} onClick={() => void relancer()}>
            Revérifier
          </Bouton>
        }
      >
        Connexions du CRM — {audit.alertes === 0 ? "tout est relié" : `${audit.alertes} point${audit.alertes > 1 ? "s" : ""} à regarder`}
      </TitreSection>
      <ul className="divide-y-[0.5px] divide-[#2A2D34] rounded-[11px] border-[0.5px] border-[#2A2D34] bg-[#1C1F25]">
        {audit.maillons.map((maillon) => (
          <li key={maillon.cle} className="flex items-start gap-3 px-4 py-3">
            <span className={cn("mt-0.5 shrink-0", maillon.etat === "OK" ? "text-[#5DCAA5]" : maillon.etat === "ALERTE" ? "text-[#F5B454]" : "text-[#6B7280]")}>
              {maillon.etat === "OK" ? <CircleCheck size={16} aria-hidden /> : maillon.etat === "ALERTE" ? <CircleAlert size={16} aria-hidden /> : <CircleDashed size={16} aria-hidden />}
            </span>
            <div className="min-w-0">
              <p className="text-[13.5px] font-medium text-[#F2F3F5]">
                {maillon.libelle}
                {maillon.etat === "RIEN_A_VERIFIER" ? <span className="ml-2 text-[11.5px] font-normal text-[#6B7280]">rien à vérifier pour l&apos;instant</span> : null}
              </p>
              <p className="mt-0.5 text-[12.5px] leading-relaxed text-[#9CA3AF]">{maillon.constat}</p>
              {maillon.aFaire ? <p className="mt-1 text-[12.5px] leading-relaxed text-[#F5B454]">À faire : {maillon.aFaire}</p> : null}
            </div>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[11.5px] text-[#6B7280]">Vérifié le {new Date(audit.le).toLocaleString("fr-FR")} en {audit.dureeMs} ms. Lecture seule : aucune donnée créée, aucun message envoyé.</p>
    </section>
  );
}
