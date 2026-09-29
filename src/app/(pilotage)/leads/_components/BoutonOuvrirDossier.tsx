"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FolderPlus } from "lucide-react";
import { toast } from "sonner";
import { envoyerJson, messageErreur } from "@/components/pilotage/client";
import { TRANS } from "@/components/pilotage/ui";
import { cn } from "@/lib/utils";

/** Mission 13 (lot 7) — « Ouvrir son dossier » : tout ce qu'on sait du contact passe dans le dossier ; extrait de PanneauEntrant. */

/** Un clic : le dossier s'ouvre avec tout ce qu'on sait du contact (coordonnées, réponses, photos, simulations), et on y arrive. */
export function BoutonOuvrirDossier({ leadId, nom }: { leadId: string; nom: string }) {
  const routeur = useRouter();
  const [envoi, setEnvoi] = useState(false);
  async function ouvrir() {
    setEnvoi(true);
    try {
      const { dossierId, cree } = await envoyerJson<{ dossierId: string; cree: boolean }>(`/api/leads/${leadId}/dossier`, "POST");
      toast.success(cree ? `Dossier ouvert pour ${nom}` : `${nom} avait déjà un dossier`);
      routeur.push(`/dossiers?dossier=${dossierId}`);
    } catch (erreur) {
      toast.error("Dossier non ouvert", { description: messageErreur(erreur) });
      setEnvoi(false);
    }
  }
  return (
    <button
      type="button"
      disabled={envoi}
      onClick={() => void ouvrir()}
      className={cn("inline-flex h-11 items-center gap-1.5 rounded-[8px] bg-[#1D9E75] px-3.5 text-[13px] font-medium text-[#0B1612] hover:bg-[#5DCAA5] disabled:opacity-60 sm:h-8", TRANS)}
    >
      <FolderPlus size={14} aria-hidden /> {envoi ? "Ouverture…" : "Ouvrir un dossier"}
    </button>
  );
}
