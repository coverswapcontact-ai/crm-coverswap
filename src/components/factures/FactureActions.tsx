"use client";

import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";

interface FactureActionsProps {
  factureId: string;
}

// Anciennes factures en lecture seule : les factures s'émettent et se suivent dans /dossiers.
export default function FactureActions({ factureId }: FactureActionsProps) {
  return (
    <div className="flex items-center gap-1">
      <Button
        variant="ghost"
        size="icon"
        onClick={() => window.open(`/api/pdf/facture/${factureId}`, "_blank")}
        title="PDF"
        className="text-gray-400 hover:text-white h-8 w-8"
      >
        <Download className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
