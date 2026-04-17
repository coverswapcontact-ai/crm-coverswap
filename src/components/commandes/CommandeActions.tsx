"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { CheckCircle, Loader2, Mail, Truck, Package } from "lucide-react";
import DeleteRowButton from "@/components/ui/delete-row-button";

interface CommandeActionsProps {
  commandeId: string;
  statut: string;
  reference: string;
  quantiteML: number;
}

export default function CommandeActions({ commandeId, statut, reference, quantiteML }: CommandeActionsProps) {
  const router = useRouter();
  const [loading, setLoading] = useState<string | null>(null);

  async function updateStatut(newStatut: string, extra: Record<string, any> = {}) {
    setLoading(newStatut);
    try {
      const res = await fetch(`/api/commandes`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: commandeId, statut: newStatut, ...extra }),
      });
      if (!res.ok) throw new Error("Erreur");
      toast.success(`Commande → ${newStatut.replace(/_/g, " ")}`);
      router.refresh();
    } catch {
      toast.error("Erreur");
    } finally { setLoading(null); }
  }

  function emailTego() {
    const subject = encodeURIComponent(`Commande Cover Styl' - ${reference} - ${quantiteML}ml`);
    const body = encodeURIComponent(`Bonjour,\n\nJe souhaite commander :\n- Référence : ${reference}\n- Quantité : ${quantiteML} ml\n\nMerci de me confirmer la disponibilité et le délai de livraison.\n\nCordialement,\nLucas Villemin\nCoverSwap\n06 70 35 28 69`);
    window.open(`mailto:France@tego.eu?subject=${subject}&body=${body}`, "_blank");
  }

  return (
    <div className="flex items-center gap-1">
      {statut === "A_COMMANDER" && (
        <>
          <Button variant="ghost" size="sm" onClick={emailTego} className="text-blue-400 hover:text-blue-300 text-xs h-7 px-2">
            <Mail className="h-3 w-3 mr-1" />Email Tego
          </Button>
          <Button variant="ghost" size="sm" onClick={() => updateStatut("COMMANDEE", { dateCommande: new Date().toISOString() })} disabled={loading === "COMMANDEE"} className="text-yellow-400 hover:text-yellow-300 text-xs h-7 px-2">
            {loading === "COMMANDEE" ? <Loader2 className="h-3 w-3 animate-spin" /> : <><Package className="h-3 w-3 mr-1" />Commandée</>}
          </Button>
        </>
      )}
      {statut === "COMMANDEE" && (
        <Button variant="ghost" size="sm" onClick={() => updateStatut("EN_TRANSIT")} disabled={loading === "EN_TRANSIT"} className="text-purple-400 hover:text-purple-300 text-xs h-7 px-2">
          {loading === "EN_TRANSIT" ? <Loader2 className="h-3 w-3 animate-spin" /> : <><Truck className="h-3 w-3 mr-1" />En transit</>}
        </Button>
      )}
      {statut === "EN_TRANSIT" && (
        <Button variant="ghost" size="sm" onClick={() => updateStatut("RECUE", { dateReceptionReelle: new Date().toISOString() })} disabled={loading === "RECUE"} className="text-green-400 hover:text-green-300 text-xs h-7 px-2">
          {loading === "RECUE" ? <Loader2 className="h-3 w-3 animate-spin" /> : <><CheckCircle className="h-3 w-3 mr-1" />Reçue</>}
        </Button>
      )}
      <DeleteRowButton url={`/api/commandes/${commandeId}`} entityLabel={`commande ${reference}`} />
    </div>
  );
}
