"use client";

import Link from "next/link";
import { useState } from "react";
import { GitMerge } from "lucide-react";
import { toast } from "sonner";
import { envoyerJson, messageErreur } from "@/components/pilotage/client";
import { Bouton } from "@/components/pilotage/ui";
import type { LigneLead } from "@/lib/prospects/leads";

/** Doublon probable : la même personne, revenue avec un autre numéro et un autre e-mail. Fusion en un clic, ou « ce n'est pas elle ». */
export function SignalDoublon({ lead, onRecharger }: { lead: LigneLead; onRecharger: () => Promise<void> }) {
  const [occupe, setOccupe] = useState<"fusionner" | "ecarter" | null>(null);
  if (!lead.doublon) return null;
  async function agir(action: "fusionner" | "ecarter") {
    setOccupe(action);
    try {
      const resultat = await envoyerJson<{ dossierId?: string | null; simulations?: number }>(`/api/leads/${lead.id}/doublon`, "POST", { action });
      toast.success(action === "fusionner" ? `Fusionné avec ${lead.doublon!.nom}` : "Signalement écarté", {
        description: action === "fusionner" ? `${resultat.simulations ? `${resultat.simulations} simulation(s) rangée(s) dans son dossier. ` : ""}Le contact en double est archivé ; rien n'est effacé.` : undefined,
      });
      await onRecharger();
    } catch (erreur) {
      toast.error(messageErreur(erreur));
    } finally {
      setOccupe(null);
    }
  }
  return (
    <div className="rounded-[10px] border-[0.5px] border-[#EF9F27]/40 bg-[#EF9F27]/[0.08] p-2.5">
      <p className="flex items-start gap-1.5 text-[12.5px] leading-snug text-[#FCD9A0]">
        <GitMerge size={14} className="mt-px shrink-0" aria-hidden />
        <span>
          Doublon probable — {lead.doublon.motif}.
          {lead.doublon.dossierId ? (
            <Link href={`/dossiers?dossier=${lead.doublon.dossierId}`} className="ml-1 text-[#F5B454] underline underline-offset-2">
              Voir son dossier
            </Link>
          ) : null}
        </span>
      </p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <Bouton taille="sm" variante="primaire" chargement={occupe === "fusionner"} disabled={occupe !== null} onClick={() => void agir("fusionner")}>
          Fusionner avec {lead.doublon.nom}
        </Bouton>
        <Bouton taille="sm" variante="fantome" chargement={occupe === "ecarter"} disabled={occupe !== null} onClick={() => void agir("ecarter")}>
          Ce n&apos;est pas la même personne
        </Bouton>
      </div>
    </div>
  );
}
