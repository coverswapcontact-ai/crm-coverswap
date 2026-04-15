"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Download, Send, CheckCircle, XCircle, Loader2 } from "lucide-react";

interface DevisActionsProps {
  devisId: string;
  statut: string;
  leadEmail?: string | null;
  numero: string;
}

export default function DevisActions({ devisId, statut, leadEmail, numero }: DevisActionsProps) {
  const router = useRouter();
  const [loading, setLoading] = useState<string | null>(null);

  async function updateStatut(newStatut: string) {
    setLoading(newStatut);
    try {
      const res = await fetch(`/api/devis/${devisId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ statut: newStatut }),
      });
      if (!res.ok) throw new Error("Erreur");
      toast.success(`Devis ${numero} → ${newStatut.replace(/_/g, " ")}`);
      router.refresh();
    } catch {
      toast.error("Erreur lors de la mise à jour");
    } finally { setLoading(null); }
  }

  function downloadPDF() {
    window.open(`/api/pdf/devis/${devisId}`, "_blank");
  }

  return (
    <div className="flex items-center gap-1">
      <Button variant="ghost" size="icon" onClick={downloadPDF} title="Télécharger PDF" className="text-gray-400 hover:text-white h-8 w-8">
        <Download className="h-3.5 w-3.5" />
      </Button>
      {statut === "BROUILLON" && (
        <Button variant="ghost" size="icon" onClick={() => updateStatut("ENVOYE")} title="Marquer envoyé" className="text-blue-400 hover:text-blue-300 h-8 w-8" disabled={loading === "ENVOYE"}>
          {loading === "ENVOYE" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
        </Button>
      )}
      {(statut === "ENVOYE" || statut === "BROUILLON") && (
        <>
          <Button variant="ghost" size="icon" onClick={() => updateStatut("SIGNE")} title="Marquer signé" className="text-green-400 hover:text-green-300 h-8 w-8" disabled={loading === "SIGNE"}>
            {loading === "SIGNE" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle className="h-3.5 w-3.5" />}
          </Button>
          <Button variant="ghost" size="icon" onClick={() => updateStatut("REFUSE")} title="Marquer refusé" className="text-red-400 hover:text-red-300 h-8 w-8" disabled={loading === "REFUSE"}>
            {loading === "REFUSE" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <XCircle className="h-3.5 w-3.5" />}
          </Button>
        </>
      )}
    </div>
  );
}
