"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { calculerDevis } from "@/lib/calcul-devis";
import { formatEuros } from "@/lib/utils";
import { toast } from "sonner";
import { Calculator, FileText, Loader2 } from "lucide-react";

const REFERENCES = [
  { code: "K1", nom: "Bois clair", prixHT: 30 },
  { code: "NH10", nom: "Bois foncé", prixHT: 35 },
  { code: "NE81", nom: "Béton gris", prixHT: 32 },
  { code: "AA01", nom: "Uni blanc mat", prixHT: 28 },
  { code: "MK13", nom: "Marbre noir", prixHT: 38 },
  { code: "J15", nom: "Métal brossé", prixHT: 40 },
  { code: "W10", nom: "Bois naturel", prixHT: 33 },
  { code: "F1", nom: "Tissu gris", prixHT: 36 },
  { code: "RI01", nom: "Rouille", prixHT: 34 },
  { code: "S2", nom: "Pierre grise", prixHT: 37 },
];

interface Lead {
  id: string; nom: string; prenom: string; ville: string;
}

export default function DevisCalculateur({ leads, preselectedLeadId }: { leads: Lead[]; preselectedLeadId: string | null }) {
  const router = useRouter();
  const [leadId, setLeadId] = useState(preselectedLeadId || "");
  const [reference, setReference] = useState("K1");
  const [ml, setMl] = useState(10);
  const [fraisEnabled, setFraisEnabled] = useState(false);
  const [fraisDeplacement, setFraisDeplacement] = useState(0);
  const [loading, setLoading] = useState(false);

  const ref = REFERENCES.find((r) => r.code === reference) || REFERENCES[0];

  const calcul = useMemo(() => {
    return calculerDevis(ref.prixHT, ml, fraisEnabled ? fraisDeplacement : 0);
  }, [ref.prixHT, ml, fraisEnabled, fraisDeplacement]);

  async function creerDevis() {
    if (!leadId) { toast.error("Sélectionnez un lead"); return; }
    setLoading(true);
    try {
      const res = await fetch("/api/devis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leadId,
          reference,
          mlTotal: ml,
          prixHT: ref.prixHT,
          fraisDeplacement: fraisEnabled ? fraisDeplacement : 0,
        }),
      });
      if (!res.ok) throw new Error("Erreur");
      const data = await res.json();
      toast.success(`Devis ${data.numero} créé`);
      router.push("/devis");
    } catch {
      toast.error("Erreur lors de la création du devis");
    } finally { setLoading(false); }
  }

  return (
    <div className="space-y-6">
      <Card className="bg-[#262626] border-white/10">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2">
            <Calculator className="h-5 w-5 text-red-400" /> Calculateur de devis
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label className="text-gray-400">Client</Label>
            <Select value={leadId} onValueChange={(v) => v && setLeadId(v)}>
              <SelectTrigger className="bg-[#1a1a1a] border-white/10 text-white">
                <SelectValue placeholder="Sélectionner un lead..." />
              </SelectTrigger>
              <SelectContent>
                {leads.map((l) => (
                  <SelectItem key={l.id} value={l.id}>{l.prenom} {l.nom} — {l.ville}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label className="text-gray-400">Référence Cover Styl&apos;</Label>
              <Select value={reference} onValueChange={(v) => v && setReference(v)}>
                <SelectTrigger className="bg-[#1a1a1a] border-white/10 text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {REFERENCES.map((r) => (
                    <SelectItem key={r.code} value={r.code}>{r.code} — {r.nom} ({r.prixHT}€ HT/ml)</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-gray-400">Mètres linéaires</Label>
              <Input
                type="number" step="0.5" min="0.5" value={ml}
                onChange={(e) => setMl(parseFloat(e.target.value) || 0)}
                className="bg-[#1a1a1a] border-white/10 text-white"
              />
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <Switch checked={fraisEnabled} onCheckedChange={setFraisEnabled} />
              <Label className="text-gray-400">Frais de déplacement</Label>
            </div>
            {fraisEnabled && (
              <Input
                type="number" step="10" min="0" value={fraisDeplacement}
                onChange={(e) => setFraisDeplacement(parseFloat(e.target.value) || 0)}
                className="w-32 bg-[#1a1a1a] border-white/10 text-white"
                placeholder="€"
              />
            )}
          </div>
        </CardContent>
      </Card>

      <Card className="bg-[#262626] border-white/10">
        <CardContent className="pt-6">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <div className="p-4 rounded-lg bg-white/5">
              <p className="text-xs text-gray-400 mb-1">ML (arrondi)</p>
              <p className="text-xl font-bold text-white">{calcul.mlArrondi} ml</p>
            </div>
            <div className="p-4 rounded-lg bg-white/5">
              <p className="text-xs text-gray-400 mb-1">Coût matière TTC</p>
              <p className="text-xl font-bold text-white">{formatEuros(calcul.prixMatiere)}</p>
            </div>
            <div className="p-4 rounded-lg bg-red-500/10 border border-red-500/20">
              <p className="text-xs text-red-400 mb-1">Prix de vente TTC</p>
              <p className="text-2xl font-bold text-red-400">{formatEuros(calcul.prixVente)}</p>
            </div>
            <div className="p-4 rounded-lg bg-green-500/10 border border-green-500/20">
              <p className="text-xs text-green-400 mb-1">Marge nette</p>
              <p className="text-xl font-bold text-green-400">{formatEuros(calcul.margeNette)}</p>
            </div>
            <div className="p-4 rounded-lg bg-white/5">
              <p className="text-xs text-gray-400 mb-1">Acompte 30%</p>
              <p className="text-xl font-bold text-white">{formatEuros(calcul.acompte30)}</p>
            </div>
            <div className="p-4 rounded-lg bg-white/5">
              <p className="text-xs text-gray-400 mb-1">Solde 70%</p>
              <p className="text-xl font-bold text-white">{formatEuros(calcul.solde70)}</p>
            </div>
          </div>

          <Separator className="my-6 bg-white/10" />

          <Button onClick={creerDevis} disabled={loading || !leadId} className="w-full bg-red-600 hover:bg-red-700 text-white">
            {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <FileText className="h-4 w-4 mr-2" />}
            Générer le devis
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
