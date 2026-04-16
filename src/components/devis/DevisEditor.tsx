"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import {
  calculerDevis,
  GAMMES,
  type LigneAdditionnelle,
  type LigneAdditionnelleType,
} from "@/lib/calcul-devis";
import { formatEuros } from "@/lib/utils";
import { toast } from "sonner";
import {
  Loader2,
  Plus,
  Trash2,
  Save,
  FileDown,
  ArrowLeft,
  CheckCircle,
  Mail,
  RotateCcw,
} from "lucide-react";
import { buildGmailComposeUrl, emailDevisTemplate } from "@/lib/gmail";

interface DevisData {
  id: string;
  numero: string;
  statut: string;
  reference: string;
  nomReference: string | null;
  gamme: string;
  complexite: number;
  mlTotal: number;
  prixVenteHTml: number;
  prixMatiere: number;
  prixVente: number;
  margeNette: number;
  fraisDeplacement: number;
  acompte30: number;
  solde70: number;
  objet: string | null;
  lignesAdditionnelles: string;
  notesInternes: string | null;
  expiresAt: string;
  lead: { id: string; prenom: string; nom: string; ville: string; codePostal: string | null; email: string | null; telephone: string };
}

const TYPES_LIGNE: { value: LigneAdditionnelleType; label: string; defaultQty: number; suggestion: string }[] = [
  { value: "MAIN_OEUVRE_EXTRA", label: "Main d'œuvre supplémentaire", defaultQty: 1, suggestion: "Prestation de pose additionnelle" },
  { value: "DEPLACEMENT", label: "Déplacement", defaultQty: 1, suggestion: "Frais de déplacement" },
  { value: "FOURNITURES", label: "Fournitures", defaultQty: 1, suggestion: "Colle, protection sol, outillage spécifique" },
  { value: "DEMONTAGE_REMONTAGE", label: "Démontage / remontage", defaultQty: 1, suggestion: "Démontage et repose éléments (électroménager, plomberie...)" },
  { value: "REMISE", label: "Remise commerciale", defaultQty: 1, suggestion: "Remise commerciale" },
  { value: "LIBRE", label: "Ligne libre", defaultQty: 1, suggestion: "" },
];

export default function DevisEditor({ devis: initial }: { devis: DevisData }) {
  const router = useRouter();

  // État édition principale
  const [reference, setReference] = useState(initial.reference);
  const [nomReference, setNomReference] = useState(initial.nomReference ?? "");
  const [gamme, setGamme] = useState(initial.gamme);
  const [complexite, setComplexite] = useState(initial.complexite);
  const [ml, setMl] = useState(initial.mlTotal);
  const [fraisDeplacement, setFraisDeplacement] = useState(initial.fraisDeplacement);
  const [objet, setObjet] = useState(initial.objet ?? "");
  const [notesInternes, setNotesInternes] = useState(initial.notesInternes ?? "");

  // Lignes additionnelles
  const [lignes, setLignes] = useState<LigneAdditionnelle[]>(() => {
    try {
      return JSON.parse(initial.lignesAdditionnelles) as LigneAdditionnelle[];
    } catch {
      return [];
    }
  });

  const [saving, setSaving] = useState(false);

  // Recalcul live de la base
  const calcul = useMemo(
    () => calculerDevis({ gammeCode: gamme, ml, complexite, fraisDeplacement }),
    [gamme, ml, complexite, fraisDeplacement]
  );

  const totalLignes = useMemo(
    () => lignes.reduce((sum, l) => sum + l.total, 0),
    [lignes]
  );

  const totalFinal = calcul.prixVente + totalLignes;
  const acompte30Final = Math.round(totalFinal * 0.30 * 100) / 100;
  const solde70Final = Math.round(totalFinal * 0.70 * 100) / 100;

  function addLigne(type: LigneAdditionnelleType) {
    const meta = TYPES_LIGNE.find((t) => t.value === type)!;
    const newLigne: LigneAdditionnelle = {
      id: crypto.randomUUID(),
      type,
      designation: meta.suggestion,
      quantite: meta.defaultQty,
      prixUnitaire: 0,
      total: 0,
    };
    setLignes([...lignes, newLigne]);
  }

  function updateLigne(id: string, patch: Partial<LigneAdditionnelle>) {
    setLignes((prev) =>
      prev.map((l) => {
        if (l.id !== id) return l;
        const merged = { ...l, ...patch };
        // Pour remise, prix unitaire négatif
        const pu = merged.type === "REMISE" ? -Math.abs(merged.prixUnitaire) : merged.prixUnitaire;
        const total = Math.round(merged.quantite * pu * 100) / 100;
        return { ...merged, prixUnitaire: pu, total };
      })
    );
  }

  function removeLigne(id: string) {
    setLignes(lignes.filter((l) => l.id !== id));
  }

  async function changeStatut(newStatut: string) {
    setSaving(true);
    try {
      const res = await fetch(`/api/devis/${initial.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ statut: newStatut }),
      });
      if (!res.ok) throw new Error("Erreur");
      toast.success(`Statut → ${newStatut.replace(/_/g, " ")}`);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    } finally {
      setSaving(false);
    }
  }

  async function envoyerParEmail() {
    if (!initial.lead.email) {
      toast.error("Aucun email renseigné pour ce client. Modifiez la fiche lead d'abord.");
      return;
    }
    // 1. Sauvegarder + marquer ENVOYE
    setSaving(true);
    try {
      await fetch(`/api/devis/${initial.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reference: reference.trim(),
          nomReference: nomReference.trim() || undefined,
          gamme,
          complexite,
          mlTotal: ml,
          fraisDeplacement,
          objet: objet.trim() || undefined,
          notesInternes: notesInternes.trim() || undefined,
          lignesAdditionnelles: JSON.stringify(lignes),
          prixVenteHTml: calcul.prixVenteHTml,
          prixMatiere: calcul.coutMatiereTTC + calcul.supplementCoverStyl,
          prixVente: totalFinal,
          margeNette: calcul.margeNette + totalLignes,
          acompte30: acompte30Final,
          solde70: solde70Final,
          statut: "ENVOYE",
        }),
      });

      // 2. Construire l'URL Gmail prérempli
      const { subject, body } = emailDevisTemplate({
        prenomClient: initial.lead.prenom,
        numero: initial.numero,
        montant: totalFinal,
        acompte30: acompte30Final,
        objet,
        expiresAt: initial.expiresAt,
      });
      const gmailUrl = buildGmailComposeUrl({ to: initial.lead.email, subject, body });

      // 3. Ouvrir Gmail compose + PDF en parallèle
      window.open(gmailUrl, "_blank", "noopener");
      window.open(`/api/pdf/devis/${initial.id}`, "_blank", "noopener");

      toast.success("Devis marqué ENVOYE — Gmail ouvert + PDF à télécharger");
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    } finally {
      setSaving(false);
    }
  }

  async function save(afterSave: "stay" | "pdf" | "list" = "stay") {
    setSaving(true);
    try {
      const res = await fetch(`/api/devis/${initial.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reference: reference.trim(),
          nomReference: nomReference.trim() || undefined,
          gamme,
          complexite,
          mlTotal: ml,
          fraisDeplacement,
          objet: objet.trim() || undefined,
          notesInternes: notesInternes.trim() || undefined,
          lignesAdditionnelles: JSON.stringify(lignes),
          prixVenteHTml: calcul.prixVenteHTml,
          prixMatiere: calcul.coutMatiereTTC + calcul.supplementCoverStyl,
          prixVente: totalFinal,
          margeNette: calcul.margeNette + totalLignes,
          acompte30: acompte30Final,
          solde70: solde70Final,
        }),
      });
      if (!res.ok) throw new Error("Erreur sauvegarde");
      toast.success("Devis enregistré");
      if (afterSave === "pdf") {
        window.open(`/api/pdf/devis/${initial.id}`, "_blank");
      } else if (afterSave === "list") {
        router.push("/devis");
      } else {
        router.refresh();
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => router.push("/devis")}
            className="text-white"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold text-white">Devis {initial.numero}</h1>
            <p className="text-sm text-gray-400">
              {initial.lead.prenom} {initial.lead.nom} — {initial.lead.ville}
            </p>
          </div>
        </div>
        <div className="flex gap-2 items-center flex-wrap">
          <Badge
            variant="outline"
            className={`text-white border-white/20 ${
              initial.statut === "SIGNE" ? "bg-green-500/20 border-green-500/40 text-green-400" :
              initial.statut === "ENVOYE" ? "bg-blue-500/20 border-blue-500/40 text-blue-400" :
              initial.statut === "REFUSE" ? "bg-red-500/20 border-red-500/40 text-red-400" :
              ""
            }`}
          >
            {initial.statut.replace(/_/g, " ")}
          </Badge>

          {/* Actions de statut contextuelles */}
          {initial.statut === "SIGNE" && (
            <Button
              variant="outline"
              onClick={() => changeStatut("ENVOYE")}
              disabled={saving}
              className="border-orange-500/40 text-orange-400 hover:bg-orange-500/10"
              title="Annuler la signature et repasser en envoyé"
            >
              <RotateCcw className="h-4 w-4 mr-2" />
              Annuler signature
            </Button>
          )}
          {initial.statut === "ENVOYE" && (
            <>
              <Button
                onClick={() => changeStatut("SIGNE")}
                disabled={saving}
                className="bg-green-600 hover:bg-green-700 text-white"
              >
                <CheckCircle className="h-4 w-4 mr-2" />
                Marquer signé
              </Button>
              <Button
                variant="outline"
                onClick={() => changeStatut("REFUSE")}
                disabled={saving}
                className="border-red-500/40 text-red-400 hover:bg-red-500/10"
              >
                Refusé
              </Button>
            </>
          )}

          <Button
            onClick={envoyerParEmail}
            disabled={saving}
            className="bg-blue-600 hover:bg-blue-700 text-white"
            title={initial.lead.email ? `Préparer email à ${initial.lead.email}` : "Aucun email renseigné"}
          >
            <Mail className="h-4 w-4 mr-2" />
            Envoyer par email
          </Button>

          <Button
            variant="outline"
            onClick={() => save("pdf")}
            disabled={saving}
            className="border-white/20 text-white hover:bg-white/10"
          >
            <FileDown className="h-4 w-4 mr-2" />
            PDF
          </Button>
          <Button
            onClick={() => save("stay")}
            disabled={saving}
            className="bg-red-600 hover:bg-red-700 text-white"
          >
            {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
            Enregistrer
          </Button>
        </div>
      </div>

      {/* Infos principales */}
      <Card className="bg-[#262626] border-white/10">
        <CardHeader>
          <CardTitle className="text-white">Informations du devis</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label className="text-gray-400">Objet</Label>
            <Input
              value={objet}
              onChange={(e) => setObjet(e.target.value)}
              placeholder="Ex: Rénovation par covering meuble coiffeur"
              className="bg-[#1a1a1a] border-white/10 text-white"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label className="text-gray-400">Code référence</Label>
              <Input
                value={reference}
                onChange={(e) => setReference(e.target.value.toUpperCase())}
                className="bg-[#1a1a1a] border-white/10 text-white uppercase"
              />
            </div>
            <div>
              <Label className="text-gray-400">Nom commercial</Label>
              <Input
                value={nomReference}
                onChange={(e) => setNomReference(e.target.value)}
                className="bg-[#1a1a1a] border-white/10 text-white"
              />
            </div>
          </div>

          <div>
            <Label className="text-gray-400">Gamme</Label>
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

          <div className="grid grid-cols-3 gap-4">
            <div>
              <Label className="text-gray-400">Complexité</Label>
              <Select
                value={String(complexite)}
                onValueChange={(v) => v && setComplexite(parseInt(v))}
              >
                <SelectTrigger className="bg-[#1a1a1a] border-white/10 text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">1 — Standard</SelectItem>
                  <SelectItem value="2">2 — +10%</SelectItem>
                  <SelectItem value="3">3 — +20%</SelectItem>
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
            <div>
              <Label className="text-gray-400">Frais déplacement (€)</Label>
              <Input
                type="number"
                step="10"
                min="0"
                value={fraisDeplacement}
                onChange={(e) => setFraisDeplacement(parseFloat(e.target.value) || 0)}
                className="bg-[#1a1a1a] border-white/10 text-white"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Ligne principale (résumé) */}
      <Card className="bg-[#262626] border-white/10">
        <CardHeader>
          <CardTitle className="text-white">Prestation principale</CardTitle>
        </CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-gray-400 border-b border-white/10">
                <th className="text-left py-2">Désignation</th>
                <th className="text-right py-2">Qté</th>
                <th className="text-right py-2">PU HT</th>
                <th className="text-right py-2">Total HT</th>
              </tr>
            </thead>
            <tbody>
              <tr className="text-white border-b border-white/5">
                <td className="py-2">
                  <div className="font-medium">Revêtement adhésif</div>
                  <div className="text-xs text-gray-400">
                    Réf. {reference} {nomReference ? `— ${nomReference}` : ""} ({calcul.gamme.label})
                  </div>
                </td>
                <td className="text-right">{calcul.mlArrondi} ml</td>
                <td className="text-right">{formatEuros(calcul.prixVenteHTml)}</td>
                <td className="text-right font-semibold">{formatEuros(calcul.totalMatiereVente)}</td>
              </tr>
              {fraisDeplacement > 0 && (
                <tr className="text-white border-b border-white/5">
                  <td className="py-2">Frais de déplacement</td>
                  <td className="text-right">1</td>
                  <td className="text-right">{formatEuros(fraisDeplacement)}</td>
                  <td className="text-right font-semibold">{formatEuros(fraisDeplacement)}</td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* Lignes additionnelles */}
      <Card className="bg-[#262626] border-white/10">
        <CardHeader>
          <CardTitle className="text-white flex items-center justify-between">
            <span>Lignes additionnelles ({lignes.length})</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {lignes.length === 0 && (
            <p className="text-sm text-gray-500 italic">Aucune ligne additionnelle. Ajoutez-en ci-dessous si nécessaire.</p>
          )}

          {lignes.map((l) => (
            <div key={l.id} className="grid grid-cols-12 gap-2 items-end bg-white/5 p-3 rounded-lg">
              <div className="col-span-12 md:col-span-5">
                <Label className="text-xs text-gray-400">
                  {TYPES_LIGNE.find((t) => t.value === l.type)?.label}
                </Label>
                <Input
                  value={l.designation}
                  onChange={(e) => updateLigne(l.id, { designation: e.target.value })}
                  placeholder="Désignation"
                  className="bg-[#1a1a1a] border-white/10 text-white"
                />
              </div>
              <div className="col-span-4 md:col-span-2">
                <Label className="text-xs text-gray-400">Qté</Label>
                <Input
                  type="number"
                  step="0.5"
                  value={l.quantite}
                  onChange={(e) => updateLigne(l.id, { quantite: parseFloat(e.target.value) || 0 })}
                  className="bg-[#1a1a1a] border-white/10 text-white"
                />
              </div>
              <div className="col-span-4 md:col-span-2">
                <Label className="text-xs text-gray-400">PU HT</Label>
                <Input
                  type="number"
                  step="1"
                  value={Math.abs(l.prixUnitaire)}
                  onChange={(e) => updateLigne(l.id, { prixUnitaire: parseFloat(e.target.value) || 0 })}
                  className="bg-[#1a1a1a] border-white/10 text-white"
                />
              </div>
              <div className="col-span-3 md:col-span-2 text-right">
                <Label className="text-xs text-gray-400">Total</Label>
                <p className={`font-bold ${l.total < 0 ? "text-yellow-400" : "text-white"}`}>
                  {formatEuros(l.total)}
                </p>
              </div>
              <div className="col-span-1 flex justify-end">
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => removeLigne(l.id)}
                  className="text-red-400 hover:bg-red-500/10"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}

          <Separator className="bg-white/10" />

          <div>
            <p className="text-xs text-gray-400 mb-3 uppercase tracking-wider font-semibold">
              Ajouter une ligne
            </p>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              {TYPES_LIGNE.map((t) => (
                <button
                  key={t.value}
                  onClick={() => addLigne(t.value)}
                  className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-white/10 hover:bg-red-600/20 border border-white/20 hover:border-red-500/40 text-white text-sm font-medium transition-colors text-left"
                >
                  <Plus className="h-4 w-4 text-red-400 shrink-0" />
                  <span className="truncate">{t.label}</span>
                </button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Totaux */}
      <Card className="bg-[#262626] border-white/10">
        <CardContent className="pt-6 space-y-3">
          <div className="flex justify-between text-sm text-gray-400">
            <span>Sous-total prestation principale</span>
            <span>{formatEuros(calcul.prixVente)}</span>
          </div>
          {totalLignes !== 0 && (
            <div className="flex justify-between text-sm text-gray-400">
              <span>Lignes additionnelles</span>
              <span className={totalLignes < 0 ? "text-yellow-400" : ""}>{formatEuros(totalLignes)}</span>
            </div>
          )}
          <Separator className="bg-white/10" />
          <div className="flex justify-between items-center">
            <span className="text-white font-semibold">TOTAL TTC</span>
            <span className="text-2xl font-bold text-red-400">{formatEuros(totalFinal)}</span>
          </div>
          <p className="text-xs text-gray-500">TVA non applicable — article 293 B du CGI</p>
          <Separator className="bg-white/10" />
          <div className="grid grid-cols-2 gap-4 pt-2">
            <div className="p-3 rounded bg-white/5">
              <p className="text-xs text-gray-400">Acompte 30%</p>
              <p className="text-lg font-bold text-white">{formatEuros(acompte30Final)}</p>
            </div>
            <div className="p-3 rounded bg-white/5">
              <p className="text-xs text-gray-400">Solde 70%</p>
              <p className="text-lg font-bold text-white">{formatEuros(solde70Final)}</p>
            </div>
          </div>
          <div className="p-3 rounded bg-green-500/10 border border-green-500/20 flex justify-between">
            <span className="text-sm text-green-400">Marge nette estimée</span>
            <span className="font-bold text-green-400">
              {formatEuros(calcul.margeNette + totalLignes)}
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Notes internes */}
      <Card className="bg-[#262626] border-white/10">
        <CardHeader>
          <CardTitle className="text-white text-sm">Notes internes (non visibles sur le PDF)</CardTitle>
        </CardHeader>
        <CardContent>
          <Textarea
            value={notesInternes}
            onChange={(e) => setNotesInternes(e.target.value)}
            placeholder="Remarques internes, détails chantier..."
            className="bg-[#1a1a1a] border-white/10 text-white min-h-[80px]"
          />
        </CardContent>
      </Card>

      {/* Actions bas */}
      <div className="flex justify-between">
        <Button
          variant="outline"
          onClick={() => router.push("/devis")}
          className="border-white/20 text-white hover:bg-white/10"
        >
          Annuler
        </Button>
        <div className="flex gap-2">
          <Button
            onClick={() => save("pdf")}
            disabled={saving}
            variant="outline"
            className="border-white/20 text-white hover:bg-white/10"
          >
            <FileDown className="h-4 w-4 mr-2" />
            Enregistrer & Générer PDF
          </Button>
          <Button
            onClick={() => save("list")}
            disabled={saving}
            className="bg-red-600 hover:bg-red-700 text-white"
          >
            {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <CheckCircle className="h-4 w-4 mr-2" />}
            Valider
          </Button>
        </div>
      </div>
    </div>
  );
}
