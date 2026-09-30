"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { envoyerJson, messageErreur } from "@/components/pilotage/client";
import { Bouton } from "@/components/pilotage/ui";
import type { SourceDonnees } from "@/lib/analytique/types";

export type ReponseRelance = { ok: boolean; message: string };

/**
 * Mission 17 (partie B) — « Relancer » la synchronisation d'une source (POST /api/analytique/synchro), puis l'écran
 * se recalcule côté serveur (router.refresh) : les chiffres et l'état de la source se mettent à jour sans recharger.
 */
export function BoutonRelancer({ source, libelle = "Relancer", discret = false }: { source: SourceDonnees; libelle?: string; discret?: boolean }) {
  const router = useRouter();
  const [enCours, setEnCours] = useState(false);

  async function relancer() {
    setEnCours(true);
    try {
      const reponse = await envoyerJson<ReponseRelance>("/api/analytique/synchro", "POST", { source });
      if (reponse.ok) toast.success(reponse.message);
      else toast.error(reponse.message);
      router.refresh();
    } catch (erreur) {
      toast.error(messageErreur(erreur));
    } finally {
      setEnCours(false);
    }
  }

  return (
    <Bouton taille="sm" variante={discret ? "fantome" : "secondaire"} chargement={enCours} icone={<RefreshCw size={13} aria-hidden />} onClick={() => void relancer()}>
      {libelle}
    </Bouton>
  );
}
