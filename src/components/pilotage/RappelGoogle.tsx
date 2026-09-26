"use client";

import { AlertTriangle, Link2Off } from "lucide-react";
import { formatHorodatage } from "@/lib/dossiers/dates";
import { dureeRestante, type RappelGoogle } from "@/lib/google/echeance";
import { cn } from "@/lib/utils";
import { TRANS } from "./ui";

/**
 * Rappel sur tous les écrans de pilotage : la connexion Google expire dans
 * moins de 48 h (application en mode Test, jeton valable 7 jours) ou elle est
 * déjà coupée. Il disparaît dès que le compte est reconnecté.
 */
export function BandeauRappelGoogle({ rappel }: { rappel: RappelGoogle }) {
  const expiree = rappel.niveau === "EXPIREE";
  const echeance = rappel.expireLe ? formatHorodatage(rappel.expireLe) : null;
  const message = rappel.coupee
    ? "Google a coupé l'accès du CRM : le miroir Drive et l'agent mail sont à l'arrêt."
    : expiree
      ? `La connexion Google a expiré${echeance ? ` le ${echeance}` : ""} : le miroir Drive et l'agent mail sont à l'arrêt.`
      : `La connexion Google expire dans ${dureeRestante(rappel.resteMs ?? 0)}${echeance ? ` (${echeance})` : ""}. Reconnecte-la pour que Drive et Gmail continuent.`;

  return (
    <div
      role={expiree ? "alert" : "status"}
      className={cn("border-b-[0.5px]", expiree ? "border-[#EF4444]/40 bg-[#EF4444]/10" : "border-[#EF9F27]/40 bg-[#EF9F27]/10")}
    >
      <div className="mx-auto flex max-w-[1680px] flex-col gap-2 px-4 py-2.5 sm:flex-row sm:items-center sm:gap-3 md:px-8">
        <div className="flex min-w-0 flex-1 items-start gap-2.5">
          {expiree ? (
            <Link2Off size={15} aria-hidden className="mt-0.5 shrink-0 text-[#F87171]" />
          ) : (
            <AlertTriangle size={15} aria-hidden className="mt-0.5 shrink-0 text-[#F5B454]" />
          )}
          <p className={cn("min-w-0 text-[13px] leading-snug", expiree ? "text-[#FCA5A5]" : "text-[#F5B454]", rappel.niveau === "IMMINENTE" && "font-medium")}>
            {message}
            <span className="hidden font-normal text-[#9CA3AF] sm:inline">
              {" "}
              {rappel.compte} · application Google en mode Test : reconnexion tous les 7 jours.
            </span>
          </p>
        </div>
        <a
          href="/api/google/connexion"
          className={cn(
            "ml-[25px] inline-flex h-11 shrink-0 items-center self-start rounded-[8px] bg-[#1D9E75] px-3.5 text-[13px] font-medium text-[#0B1612] hover:bg-[#5DCAA5] sm:ml-0 sm:h-8 sm:self-auto",
            TRANS
          )}
        >
          Reconnecter Google
        </a>
      </div>
    </div>
  );
}
