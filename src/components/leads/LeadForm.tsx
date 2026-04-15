"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { LEAD_SOURCES, TYPE_PROJETS } from "@/lib/utils";
import { toast } from "sonner";
import { Loader2, Save } from "lucide-react";

export default function LeadForm() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    nom: "", prenom: "", telephone: "", email: "", ville: "", codePostal: "",
    source: "AUTRE", typeProjet: "CUISINE", referenceChoisie: "", mlEstimes: "", notes: "",
  });

  const update = (field: string, value: string) => setForm((f) => ({ ...f, [field]: value }));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.nom || !form.prenom || !form.telephone || !form.ville) {
      toast.error("Veuillez remplir les champs obligatoires");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          mlEstimes: form.mlEstimes ? parseFloat(form.mlEstimes) : undefined,
          email: form.email || undefined,
          codePostal: form.codePostal || undefined,
          referenceChoisie: form.referenceChoisie || undefined,
          notes: form.notes || undefined,
        }),
      });
      if (!res.ok) throw new Error("Erreur lors de la création");
      const data = await res.json();
      toast.success("Lead créé avec succès");
      router.push(`/leads/${data.id}`);
    } catch (err) {
      toast.error("Erreur lors de la création du lead");
    } finally { setLoading(false); }
  }

  return (
    <Card className="bg-[#262626] border-white/10">
      <CardContent className="pt-6">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div><Label className="text-gray-400">Prénom *</Label><Input value={form.prenom} onChange={(e) => update("prenom", e.target.value)} className="bg-[#1a1a1a] border-white/10 text-white" /></div>
            <div><Label className="text-gray-400">Nom *</Label><Input value={form.nom} onChange={(e) => update("nom", e.target.value)} className="bg-[#1a1a1a] border-white/10 text-white" /></div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div><Label className="text-gray-400">Téléphone *</Label><Input value={form.telephone} onChange={(e) => update("telephone", e.target.value)} className="bg-[#1a1a1a] border-white/10 text-white" /></div>
            <div><Label className="text-gray-400">Email</Label><Input type="email" value={form.email} onChange={(e) => update("email", e.target.value)} className="bg-[#1a1a1a] border-white/10 text-white" /></div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div><Label className="text-gray-400">Ville *</Label><Input value={form.ville} onChange={(e) => update("ville", e.target.value)} className="bg-[#1a1a1a] border-white/10 text-white" /></div>
            <div><Label className="text-gray-400">Code Postal</Label><Input value={form.codePostal} onChange={(e) => update("codePostal", e.target.value)} className="bg-[#1a1a1a] border-white/10 text-white" /></div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label className="text-gray-400">Source</Label>
              <Select value={form.source} onValueChange={(v) => v && update("source", v)}>
                <SelectTrigger className="bg-[#1a1a1a] border-white/10 text-white"><SelectValue /></SelectTrigger>
                <SelectContent>{LEAD_SOURCES.map((s) => <SelectItem key={s} value={s}>{s.replace(/_/g, " ")}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-gray-400">Type de projet</Label>
              <Select value={form.typeProjet} onValueChange={(v) => v && update("typeProjet", v)}>
                <SelectTrigger className="bg-[#1a1a1a] border-white/10 text-white"><SelectValue /></SelectTrigger>
                <SelectContent>{TYPE_PROJETS.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div><Label className="text-gray-400">Référence Cover Styl</Label><Input value={form.referenceChoisie} onChange={(e) => update("referenceChoisie", e.target.value)} placeholder="ex: K1, NH10" className="bg-[#1a1a1a] border-white/10 text-white" /></div>
            <div><Label className="text-gray-400">ML estimés</Label><Input type="number" step="0.5" value={form.mlEstimes} onChange={(e) => update("mlEstimes", e.target.value)} className="bg-[#1a1a1a] border-white/10 text-white" /></div>
          </div>
          <div><Label className="text-gray-400">Notes</Label><Input value={form.notes} onChange={(e) => update("notes", e.target.value)} className="bg-[#1a1a1a] border-white/10 text-white" /></div>
          <Button type="submit" disabled={loading} className="w-full bg-red-600 hover:bg-red-700 text-white">
            {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
            Créer le lead
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
