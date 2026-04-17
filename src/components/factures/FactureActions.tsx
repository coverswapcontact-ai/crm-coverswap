"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { CheckCircle, Loader2, Download } from "lucide-react";
import DeleteRowButton from "@/components/ui/delete-row-button";

interface FactureActionsProps {
  factureId: string;
  statut: string;
  acompteRecu: boolean;
  soldeRecu: boolean;
}

export default function FactureActions({ factureId, statut, acompteRecu, soldeRecu }: FactureActionsProps) {
  const router = useRouter();
  const [loading, setLoading] = useState<string | null>(null);

  async function markAcompte() {
    setLoading("acompte");
    try {
      const res = await fetch(`/api/factures/${factureId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ acompteRecu: true }),
      });
      if (!res.ok) throw new Error("Erreur");
      toast.success("Acompte marqué comme reçu");
      router.refresh();
    } catch {
      toast.error("Erreur");
    } finally { setLoading(null); }
  }

  async function markSolde() {
    setLoading("solde");
    try {
      const res = await fetch(`/api/factures/${factureId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ soldeRecu: true }),
      });
      if (!res.ok) throw new Error("Erreur");
      toast.success("Facture soldée");
      router.refresh();
    } catch {
      toast.error("Erreur");
    } finally { setLoading(null); }
  }

  return (
    <div className="flex items-center gap-1">
      <Button variant="ghost" size="icon" onClick={() => window.open(`/api/pdf/facture/${factureId}`, "_blank")} title="PDF" className="text-gray-400 hover:text-white h-8 w-8">
        <Download className="h-3.5 w-3.5" />
      </Button>
      {!acompteRecu && (
        <Button variant="ghost" size="sm" onClick={markAcompte} disabled={loading === "acompte"} className="text-yellow-400 hover:text-yellow-300 text-xs h-7 px-2">
          {loading === "acompte" ? <Loader2 className="h-3 w-3 animate-spin" /> : <><CheckCircle className="h-3 w-3 mr-1" />Acompte</>}
        </Button>
      )}
      {acompteRecu && !soldeRecu && (
        <Button variant="ghost" size="sm" onClick={markSolde} disabled={loading === "solde"} className="text-green-400 hover:text-green-300 text-xs h-7 px-2">
          {loading === "solde" ? <Loader2 className="h-3 w-3 animate-spin" /> : <><CheckCircle className="h-3 w-3 mr-1" />Solde</>}
        </Button>
      )}
      <DeleteRowButton url={`/api/factures/${factureId}`} entityLabel="facture" />
    </div>
  );
}
