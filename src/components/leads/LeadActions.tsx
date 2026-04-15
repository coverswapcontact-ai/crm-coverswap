"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LEAD_STATUTS, statutColor } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Loader2, Plus } from "lucide-react";

interface LeadActionsProps {
  leadId: string;
  currentStatut: string;
}

export function StatusChanger({ leadId, currentStatut }: LeadActionsProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function changeStatut(newStatut: string | null) {
    if (!newStatut || newStatut === currentStatut) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/leads/${leadId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ statut: newStatut }),
      });
      if (!res.ok) throw new Error("Erreur");
      toast.success(`Statut chang\u00e9 \u2192 ${newStatut.replace(/_/g, " ")}`);
      router.refresh();
    } catch {
      toast.error("Erreur lors du changement de statut");
    } finally { setLoading(false); }
  }

  return (
    <div className="flex items-center gap-2">
      <Select onValueChange={changeStatut} defaultValue={currentStatut}>
        <SelectTrigger className="w-[200px] bg-[#1a1a1a] border-white/10 text-white">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {LEAD_STATUTS.map((s) => (
            <SelectItem key={s} value={s}>
              <div className="flex items-center gap-2">
                <Badge className={statutColor(s) + " text-[10px]"}>{s.replace(/_/g, " ")}</Badge>
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {loading && <Loader2 className="h-4 w-4 animate-spin text-gray-400" />}
    </div>
  );
}

export function InteractionForm({ leadId }: { leadId: string }) {
  const router = useRouter();
  const [type, setType] = useState("APPEL");
  const [contenu, setContenu] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!contenu.trim()) { toast.error("Contenu requis"); return; }
    setLoading(true);
    try {
      const res = await fetch(`/api/leads/${leadId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          interaction: { type, contenu },
        }),
      });
      if (!res.ok) throw new Error("Erreur");
      toast.success("Interaction ajout\u00e9e");
      setContenu("");
      router.refresh();
    } catch {
      toast.error("Erreur lors de l'ajout");
    } finally { setLoading(false); }
  }

  return (
    <Card className="bg-[#262626] border-white/10">
      <CardHeader><CardTitle className="text-white text-sm">Ajouter une interaction</CardTitle></CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-3">
          <Select value={type} onValueChange={(v) => v && setType(v)}>
            <SelectTrigger className="bg-[#1a1a1a] border-white/10 text-white">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="APPEL">Appel</SelectItem>
              <SelectItem value="SMS">SMS</SelectItem>
              <SelectItem value="EMAIL">Email</SelectItem>
              <SelectItem value="NOTE">Note</SelectItem>
            </SelectContent>
          </Select>
          <Input
            placeholder="Contenu de l'interaction..."
            value={contenu}
            onChange={(e) => setContenu(e.target.value)}
            className="bg-[#1a1a1a] border-white/10 text-white"
          />
          <Button type="submit" disabled={loading} className="w-full bg-red-600 hover:bg-red-700 text-white" size="sm">
            {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Plus className="h-4 w-4 mr-2" />}
            Ajouter
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
