"use client";

import { useState } from "react";
import { AlertTriangle, Hourglass, X } from "lucide-react";
import { toast } from "sonner";
import type { DossierDetail } from "@/lib/dossiers/types";
import { cn } from "@/lib/utils";
import { appelApi, envoyerJson, messageErreur } from "@/components/pilotage/client";

/** Mission 13 (lot 7) — les points à compléter d'un dossier (masquables) ; extrait de PanneauDossier. */

/**
 * Ce qui manque au dossier : signalé, jamais exigé. En alerte (orange) ce que
 * moi seul peux compléter ; en neutre ce que le client peut encore fournir
 * depuis son espace (« en attente du client ») ; chaque point a sa croix pour
 * le masquer sur ce dossier (mémorisé, réaffichable). Un point rempli disparaît.
 */
export function ACompleter({ detail, onMisAJour }: { detail: DossierDetail; onMisAJour: (detail: DossierDetail) => void }) {
  const [occupe, setOccupe] = useState<string | null>(null);
  const [voirMasques, setVoirMasques] = useState(false);
  const alertes = detail.completude.filter((p) => !p.masque && !p.attenteClient);
  const attente = detail.completude.filter((p) => !p.masque && p.attenteClient);
  const masques = detail.completude.filter((p) => p.masque);
  if (detail.completude.length === 0) return null;

  async function basculer(code: string, masque: boolean) {
    setOccupe(code);
    try {
      await envoyerJson(`/api/dossiers/${detail.id}/completude`, "PATCH", { code, masque });
      onMisAJour(await appelApi<DossierDetail>(`/api/dossiers/${detail.id}`));
      if (masque) toast.success("Point masqué pour ce dossier", { description: "Il ne revient pas ; « réafficher » le remet." });
    } catch (probleme) {
      toast.error(messageErreur(probleme));
    } finally {
      setOccupe(null);
    }
  }

  const puce = (point: DossierDetail["completude"][number], ton: "alerte" | "neutre") => (
    <li
      key={point.code}
      className={cn(
        "flex items-center gap-0.5 rounded-full border-[0.5px] py-0.5 pr-0.5 pl-2 text-[12px]",
        ton === "alerte" ? "border-[#EF9F27]/30 text-[#FCD9A0]" : "border-[#3A3E47] text-[#B4BAC4]"
      )}
    >
      {point.libelle}
      <button
        type="button"
        disabled={occupe !== null}
        onClick={() => basculer(point.code, true)}
        aria-label={`Masquer « ${point.libelle} » pour ce dossier`}
        title="Pas nécessaire pour ce dossier : masquer"
        className={cn("flex h-11 w-11 items-center justify-center rounded-full hover:bg-white/10 disabled:opacity-40 sm:h-5 sm:w-5", ton === "alerte" ? "text-[#F5B454]" : "text-[#8B919C]")}
      >
        <X size={12} aria-hidden />
      </button>
    </li>
  );

  return (
    <div className="space-y-2">
      {alertes.length > 0 ? (
        <section aria-label="À compléter" className="rounded-[11px] border-[0.5px] border-[#EF9F27]/35 bg-[#EF9F27]/[0.07] px-3.5 py-3">
          <p className="flex items-center gap-1.5 text-[12.5px] font-medium text-[#F5B454]">
            <AlertTriangle size={13} aria-hidden />
            À compléter · {alertes.length}
          </p>
          <ul className="mt-1.5 flex flex-wrap gap-1.5">{alertes.map((p) => puce(p, "alerte"))}</ul>
        </section>
      ) : null}
      {attente.length > 0 ? (
        <section aria-label="En attente du client" className="rounded-[11px] border-[0.5px] border-[#2A2D34] bg-[#16181D] px-3.5 py-3">
          <p className="flex items-center gap-1.5 text-[12.5px] font-medium text-[#B4BAC4]">
            <Hourglass size={13} aria-hidden />
            En attente du client · il peut le donner dans son espace
          </p>
          <ul className="mt-1.5 flex flex-wrap gap-1.5">{attente.map((p) => puce(p, "neutre"))}</ul>
        </section>
      ) : null}
      {masques.length > 0 ? (
        <div className="text-[12px] text-[#6B7280]">
          <button type="button" onClick={() => setVoirMasques((v) => !v)} className="underline-offset-2 hover:text-[#9CA3AF] hover:underline">
            {masques.length} point{masques.length > 1 ? "s" : ""} masqué{masques.length > 1 ? "s" : ""} · {voirMasques ? "cacher" : "voir"}
          </button>
          {voirMasques ? (
            <ul className="mt-1.5 flex flex-wrap gap-1.5">
              {masques.map((p) => (
                <li key={p.code} className="flex items-center gap-1.5 rounded-full border-[0.5px] border-[#2A2D34] py-0.5 pr-1 pl-2 text-[#8B919C]">
                  {p.libelle}
                  <button type="button" disabled={occupe !== null} onClick={() => basculer(p.code, false)} className="rounded-full px-1.5 text-[#5DCAA5] hover:bg-white/5 disabled:opacity-40">
                    Réafficher
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
