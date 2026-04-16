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
import { calculerDevis, GAMMES } from "@/lib/calcul-devis";
import { formatEuros } from "@/lib/utils";
import { toast } from "sonner";
import { Calculator, FileText, Loader2, TrendingUp, User, AlertTriangle, Mail, Phone, MapPin } from "lucide-react";

interface Lead {
  id: string;
  nom: string;
  prenom: string;
  ville: string;
  codePostal: string | null;
  email: string | null;
  telephone: string;
  typeProjet: string;
}

const COMPLEXITES = [
  { value: 1, label: "1 — Standard", suffix: "prix base" },
  { value: 2, label: "2 — Modéré", suffix: "+10%" },
  { value: 3, label: "3 — Difficile", suffix: "+20%" },
];

const OBJET_PAR_PROJET: Record<string, string> = {
  CUISINE: "Rénovation par covering cuisine",
  SDB: "Rénovation par covering salle de bain",
  MEUBLES: "Rénovation par covering meubles",
  PRO: "Rénovation par covering local professionnel",
  AUTRE: "Rénovation par covering",
};

export default function DevisCalculateur({
  leads,
  preselectedLeadId,
  prefillReference,
  prefillMl,
  prefillObjet,
}: {
  leads: Lead[];
  preselectedLeadId: string | null;
  prefillReference?: string;
  prefillMl?: number;
  prefillObjet?: string;
}) {
  const router = useRouter();
  const [leadId, setLeadId] = useState(preselectedLeadId || "");
  const [reference, setReference] = useState(prefillReference || "K1");
  const [nomReference, setNomReference] = useState("");
  const [gamme, setGamme] = useState("ESSENTIAL");
  const [complexite, setComplexite] = useState(1);
  const [ml, setMl] = useState(prefillMl || 10);
  const [fraisEnabled, setFraisEnabled] = useState(false);
  const [fraisDeplacement, setFraisDeplacement] = useState(0);
  const [objet, setObjet] = useState(prefillObjet || "");
  const [loading, setLoading] = useState(false);

  const selectedLead = useMemo(
    () => leads.find((l) => l.id === leadId) || null,
    [leads, leadId]
  );

  // Auto-prefill objet depuis typeProjet si vide
  useMemo(() => {
    if (!objet && selectedLead?.typeProjet) {
      setObjet(OBJET_PAR_PROJET[selectedLead.typeProjet] || "");
    }
  }, [selectedLead, objet]);

  const calcul = useMemo(
    () =>
      calculerDevis({
        gammeCode: gamme,
        ml,
        complexite,
        fraisDeplacement: fraisEnabled ? fraisDeplacement : 0,
      }),
    [gamme, ml, complexite, fraisEnabled, fraisDeplacement]
  );

  async function creerDevis(mode: "brouillon" | "editer") {
    if (!leadId) {
      toast.error("Sélectionnez un lead");
      return;
    }
    if (!reference.trim()) {
      toast.error("Code référence requis");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/devis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leadId,
          reference: reference.trim(),
          nomReference: nomReference.trim() || undefined,
          gamme,
          complexite,
          mlTotal: ml,
          fraisDeplacement: fraisEnabled ? fraisDeplacement : 0,
          objet: objet.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Erreur");
      }
      const data = await res.json();
      toast.success(`Devis ${data.numero} créé`);
      if (mode === "editer") {
        router.push(`/devis/${data.id}/edit`);
      } else {
        router.push("/devis");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur lors de la création");
    } finally {
      setLoading(false);
    }
  }

  const margeColor =
    calcul.margePct >= 60
      ? "text-green-400"
      : calcul.margePct >= 40
      ? "text-yellow-400"
      : "text-red-400";

  // Champs manquants du lead pour le PDF
  const missingFields: string[] = [];
  if (selectedLead) {
    if (!selectedLead.codePostal) missingFields.push("code postal");
    if (!selectedLead.email) missingFields.push("email");
  }

  return (
    <div className="space-y-6">
      {/* --- Configuration --- */}
      <Card className="bg-[#262626] border-white/10">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2">
            <Calculator className="h-5 w-5 text-red-400" /> Configuration du devis
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
                  <SelectItem key={l.id} value={l.id}>
                    {l.prenom} {l.nom} — {l.ville}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Bloc infos client prérempli */}
          {selectedLead && (
            <div className="p-4 rounded-lg bg-white/5 border border-white/10 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-white font-medium">
                  <User className="h-4 w-4 text-red-400" />
                  {selectedLead.prenom} {selectedLead.nom}
                </div>
                <span className="text-[10px] text-gray-400 uppercase tracking-wider">
                  Apparaîtra sur le PDF
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs text-gray-300">
                <div className="flex items-center gap-1.5">
                  <Phone className="h-3 w-3 text-gray-500" />
                  {selectedLead.telephone}
                </div>
                <div className="flex items-center gap-1.5">
                  <Mail className="h-3 w-3 text-gray-500" />
                  {selectedLead.email || <span className="text-yellow-400">non renseigné</span>}
                </div>
                <div className="flex items-center gap-1.5 col-span-2">
                  <MapPin className="h-3 w-3 text-gray-500" />
                  {selectedLead.ville}
                  {selectedLead.codePostal ? ` (${selectedLead.codePostal})` : (
                    <span className="text-yellow-400 ml-1">— code postal manquant</span>
                  )}
                </div>
              </div>
              {missingFields.length > 0 && (
                <div className="flex items-center gap-1.5 text-[11px] text-yellow-400 mt-2 pt-2 border-t border-white/10">
                  <AlertTriangle className="h-3 w-3" />
                  Champs manquants : {missingFields.join(", ")} — modifiable sur la fiche lead
                </div>
              )}
            </div>
          )}

          <div>
            <Label className="text-gray-400">Objet du devis</Label>
            <Input
              value={objet}
              onChange={(e) => setObjet(e.target.value)}
              placeholder="Ex: Rénovation par covering meuble coiffeur"
              className="bg-[#1a1a1a] border-white/10 text-white"
            />
          </div>

          <Separator className="bg-white/10" />

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label className="text-gray-400">Code référence</Label>
              <Input
                value={reference}
                onChange={(e) => setReference(e.target.value.toUpperCase())}
                placeholder="K1"
                className="bg-[#1a1a1a] border-white/10 text-white uppercase"
              />
            </div>
            <div>
              <Label className="text-gray-400">Nom commercial</Label>
              <Input
                value={nomReference}
                onChange={(e) => setNomReference(e.target.value)}
                placeholder="Black mat"
                className="bg-[#1a1a1a] border-white/10 text-white"
              />
            </div>
          </div>

          <div>
            <Label className="text-gray-400">Gamme Cover Styl&apos;</Label>
            <Select value={gamme} onValueChange={(v) => v && setGamme(v)}>
              <SelectTrigger className="bg-[#1a1a1a] border-white/10 text-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {GAMMES.map((g) => (
                  <SelectItem key={g.code} value={g.code}>
                    {g.label} — {g.prixMatiereHT}€ HT/ml
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label className="text-gray-400">Complexité de pose</Label>
              <Select
                value={String(complexite)}
                onValueChange={(v) => v && setComplexite(parseInt(v))}
              >
                <SelectTrigger className="bg-[#1a1a1a] border-white/10 text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {COMPLEXITES.map((c) => (
                    <SelectItem key={c.value} value={String(c.value)}>
                      {c.label} ({c.suffix})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-gray-400">Mètres linéaires</Label>
              <Input
                type="number"
                step="0.5"
                min="0.5"
                value={ml}
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
                type="number"
                step="10"
                min="0"
                value={fraisDeplacement}
                onChange={(e) => setFraisDeplacement(parseFloat(e.target.value) || 0)}
                className="w-32 bg-[#1a1a1a] border-white/10 text-white"
                placeholder="€"
              />
            )}
          </div>
        </CardContent>
      </Card>

      {/* --- Résultat --- */}
      <Card className="bg-[#262626] border-white/10">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-red-400" /> Calcul
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
            <div className="p-3 rounded-lg bg-white/5">
              <p className="text-gray-400">ML arrondi</p>
              <p className="text-lg font-bold text-white">{calcul.mlArrondi} ml</p>
            </div>
            <div className="p-3 rounded-lg bg-white/5">
              <p className="text-gray-400">Coef ml</p>
              <p className="text-lg font-bold text-white">×{calcul.coefMl}</p>
            </div>
            <div className="p-3 rounded-lg bg-white/5">
              <p className="text-gray-400">Ratio gamme</p>
              <p className="text-lg font-bold text-white">×{calcul.gamme.ratioVente.toFixed(2)}</p>
            </div>
            <div className="p-3 rounded-lg bg-white/5">
              <p className="text-gray-400">Complexité</p>
              <p className="text-lg font-bold text-white">×{calcul.coefComplexite.toFixed(2)}</p>
            </div>
          </div>

          <Separator className="bg-white/10" />

          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <div className="p-4 rounded-lg bg-white/5">
              <p className="text-xs text-gray-400 mb-1">PU HT / ml</p>
              <p className="text-xl font-bold text-white">{formatEuros(calcul.prixVenteHTml)}</p>
            </div>
            <div className="p-4 rounded-lg bg-white/5">
              <p className="text-xs text-gray-400 mb-1">Coût matière réel</p>
              <p className="text-xl font-bold text-white">
                {formatEuros(calcul.coutMatiereTTC + calcul.supplementCoverStyl)}
              </p>
              <p className="text-[10px] text-gray-500">TVA 20% incluse + suppl. Cover Styl&apos;</p>
            </div>
            <div className="p-4 rounded-lg bg-red-500/10 border border-red-500/20">
              <p className="text-xs text-red-400 mb-1">Prix de vente client</p>
              <p className="text-2xl font-bold text-red-400">{formatEuros(calcul.prixVente)}</p>
              <p className="text-[10px] text-gray-500">TVA non applicable (293B)</p>
            </div>
            <div className="p-4 rounded-lg bg-green-500/10 border border-green-500/20">
              <p className="text-xs text-green-400 mb-1">Marge nette</p>
              <p className={`text-xl font-bold ${margeColor}`}>{formatEuros(calcul.margeNette)}</p>
              <p className="text-[10px] text-gray-500">{calcul.margePct}% du CA</p>
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

          <Separator className="bg-white/10" />

          <div className="grid grid-cols-2 gap-3">
            <Button
              onClick={() => creerDevis("brouillon")}
              disabled={loading || !leadId}
              variant="outline"
              className="border-white/20 text-white hover:bg-white/10"
            >
              {loading ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <FileText className="h-4 w-4 mr-2" />
              )}
              Enregistrer brouillon
            </Button>
            <Button
              onClick={() => creerDevis("editer")}
              disabled={loading || !leadId}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              {loading ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <FileText className="h-4 w-4 mr-2" />
              )}
              Passer en mode devis →
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
