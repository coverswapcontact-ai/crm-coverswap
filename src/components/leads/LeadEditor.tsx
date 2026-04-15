"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Loader2, Save, Trash2, Pencil, X } from "lucide-react";

interface LeadEditorProps {
  lead: {
    id: string;
    prenom: string;
    nom: string;
    email: string | null;
    telephone: string;
    ville: string;
    codePostal: string | null;
    typeProjet: string;
    referenceChoisie: string | null;
    mlEstimes: number | null;
    prixDevis: number | null;
    notes: string | null;
  };
}

export default function LeadEditor({ lead }: LeadEditorProps) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [form, setForm] = useState({
    prenom: lead.prenom,
    nom: lead.nom,
    email: lead.email || "",
    telephone: lead.telephone,
    ville: lead.ville,
    codePostal: lead.codePostal || "",
    typeProjet: lead.typeProjet,
    referenceChoisie: lead.referenceChoisie || "",
    mlEstimes: lead.mlEstimes?.toString() || "",
    prixDevis: lead.prixDevis?.toString() || "",
    notes: lead.notes || "",
  });

  function setField<K extends keyof typeof form>(k: K, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function handleSave() {
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        prenom: form.prenom.trim(),
        nom: form.nom.trim(),
        telephone: form.telephone.trim(),
        ville: form.ville.trim() || "Non renseignée",
        typeProjet: form.typeProjet,
      };
      if (form.email.trim()) payload.email = form.email.trim();
      if (form.codePostal.trim()) payload.codePostal = form.codePostal.trim();
      if (form.referenceChoisie.trim()) payload.referenceChoisie = form.referenceChoisie.trim();
      if (form.mlEstimes.trim() && !isNaN(Number(form.mlEstimes))) payload.mlEstimes = Number(form.mlEstimes);
      if (form.prixDevis.trim() && !isNaN(Number(form.prixDevis))) payload.prixDevis = Number(form.prixDevis);
      if (form.notes.trim()) payload.notes = form.notes.trim();

      const res = await fetch(`/api/leads/${lead.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || "Erreur");
      }
      toast.success("Lead mis à jour");
      setEditing(false);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur lors de la sauvegarde");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    const ok = window.confirm(
      `Supprimer définitivement le lead "${lead.prenom} ${lead.nom}" ?\n\nCette action est irréversible et supprimera aussi toutes les interactions, simulations, devis et chantiers associés.`
    );
    if (!ok) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/leads/${lead.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Erreur");
      toast.success("Lead supprimé");
      router.push("/leads");
      router.refresh();
    } catch {
      toast.error("Erreur lors de la suppression");
      setDeleting(false);
    }
  }

  const inputCls =
    "bg-[#1a1a1a] border-white/10 text-white placeholder:text-gray-600";
  const labelCls = "text-gray-400 text-xs mb-1 block";

  return (
    <Card className="bg-[#262626] border-white/10">
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-white">Informations</CardTitle>
        <div className="flex gap-2">
          {editing ? (
            <>
              <Button
                size="sm"
                variant="outline"
                className="border-white/20 text-white hover:bg-white/10"
                onClick={() => setEditing(false)}
                disabled={saving}
              >
                <X className="h-3 w-3 mr-1" /> Annuler
              </Button>
              <Button
                size="sm"
                className="bg-red-600 hover:bg-red-700"
                onClick={handleSave}
                disabled={saving}
              >
                {saving ? (
                  <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                ) : (
                  <Save className="h-3 w-3 mr-1" />
                )}
                Enregistrer
              </Button>
            </>
          ) : (
            <>
              <Button
                size="sm"
                variant="outline"
                className="border-white/20 text-white hover:bg-white/10"
                onClick={() => setEditing(true)}
              >
                <Pencil className="h-3 w-3 mr-1" /> Modifier
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="border-red-500/40 text-red-400 hover:bg-red-500/10 hover:text-red-300"
                onClick={handleDelete}
                disabled={deleting}
              >
                {deleting ? (
                  <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                ) : (
                  <Trash2 className="h-3 w-3 mr-1" />
                )}
                Supprimer
              </Button>
            </>
          )}
        </div>
      </CardHeader>
      <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
        <div>
          <span className={labelCls}>Prénom</span>
          {editing ? (
            <Input className={inputCls} value={form.prenom} onChange={(e) => setField("prenom", e.target.value)} />
          ) : (
            <p className="text-white">{lead.prenom}</p>
          )}
        </div>
        <div>
          <span className={labelCls}>Nom</span>
          {editing ? (
            <Input className={inputCls} value={form.nom} onChange={(e) => setField("nom", e.target.value)} />
          ) : (
            <p className="text-white">{lead.nom}</p>
          )}
        </div>
        <div>
          <span className={labelCls}>Téléphone</span>
          {editing ? (
            <Input className={inputCls} value={form.telephone} onChange={(e) => setField("telephone", e.target.value)} />
          ) : (
            <p className="text-white">{lead.telephone}</p>
          )}
        </div>
        <div>
          <span className={labelCls}>Email</span>
          {editing ? (
            <Input type="email" className={inputCls} value={form.email} onChange={(e) => setField("email", e.target.value)} />
          ) : (
            <p className="text-white">{lead.email || "—"}</p>
          )}
        </div>
        <div>
          <span className={labelCls}>Ville</span>
          {editing ? (
            <Input className={inputCls} value={form.ville} onChange={(e) => setField("ville", e.target.value)} />
          ) : (
            <p className="text-white">{lead.ville}</p>
          )}
        </div>
        <div>
          <span className={labelCls}>Code postal</span>
          {editing ? (
            <Input className={inputCls} value={form.codePostal} onChange={(e) => setField("codePostal", e.target.value)} />
          ) : (
            <p className="text-white">{lead.codePostal || "—"}</p>
          )}
        </div>
        <div>
          <span className={labelCls}>Type projet</span>
          {editing ? (
            <Input className={inputCls} value={form.typeProjet} onChange={(e) => setField("typeProjet", e.target.value)} />
          ) : (
            <p className="text-white">{lead.typeProjet}</p>
          )}
        </div>
        <div>
          <span className={labelCls}>Référence</span>
          {editing ? (
            <Input className={inputCls} value={form.referenceChoisie} onChange={(e) => setField("referenceChoisie", e.target.value)} />
          ) : (
            <p className="text-white font-mono">{lead.referenceChoisie || "—"}</p>
          )}
        </div>
        <div>
          <span className={labelCls}>ML estimés</span>
          {editing ? (
            <Input type="number" step="0.1" className={inputCls} value={form.mlEstimes} onChange={(e) => setField("mlEstimes", e.target.value)} />
          ) : (
            <p className="text-white">{lead.mlEstimes ? `${lead.mlEstimes} ml` : "—"}</p>
          )}
        </div>
        <div>
          <span className={labelCls}>Prix devis (€)</span>
          {editing ? (
            <Input type="number" step="0.01" className={inputCls} value={form.prixDevis} onChange={(e) => setField("prixDevis", e.target.value)} />
          ) : (
            <p className="text-red-400 font-bold">{lead.prixDevis ? `${lead.prixDevis.toFixed(2)} €` : "—"}</p>
          )}
        </div>
        <div className="md:col-span-2">
          <span className={labelCls}>Notes</span>
          {editing ? (
            <textarea
              className={`${inputCls} w-full rounded-md px-3 py-2 min-h-[80px]`}
              value={form.notes}
              onChange={(e) => setField("notes", e.target.value)}
            />
          ) : (
            <p className="text-white whitespace-pre-wrap">{lead.notes || "—"}</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
