"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatEuros, statutColor, sourceLabel, LEAD_STATUTS, LEAD_SOURCES } from "@/lib/utils";
import { Search, ChevronLeft, ChevronRight, Eye, Phone } from "lucide-react";
import { useViewMode } from "@/components/layout/ViewModeProvider";
import Link from "next/link";

interface Lead {
  id: string;
  nom: string;
  prenom: string;
  ville: string;
  telephone: string;
  email?: string;
  source: string;
  statut: string;
  typeProjet: string;
  referenceChoisie: string | null;
  lienSimulation?: string | null;
  prixDevis: number | null;
  scoreSignature: number;
  createdAt: string;
  notes?: string | null;
  devisDemande?: boolean;
  aSimule?: boolean;
}

function IntentBadge({ devisDemande, aSimule }: { devisDemande?: boolean; aSimule?: boolean }) {
  if (devisDemande) {
    return (
      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-red-50 text-red-600 border border-red-200 whitespace-nowrap">
        Devis demandé
      </span>
    );
  }
  if (aSimule) {
    return (
      <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-600 border border-amber-200 whitespace-nowrap">
        Simulation seule
      </span>
    );
  }
  return null;
}

const SOURCE_LABELS: Record<string, string> = {
  SITE_SIMULATEUR: "Simulateur IA",
  SITE_CONTACT: "Formulaire",
  SITE_DEVIS: "Devis web",
  META_ADS: "Meta Ads",
  ORGANIQUE: "Organique",
  AUTRE: "Autre",
};

const STATUT_STYLES: Record<string, string> = {
  NOUVEAU: "bg-blue-50 text-blue-600 border-blue-200",
  CONTACTE: "bg-yellow-50 text-yellow-600 border-yellow-200",
  DEVIS_ENVOYE: "bg-purple-50 text-purple-600 border-purple-200",
  SIGNE: "bg-green-50 text-green-600 border-green-200",
  CHANTIER_PLANIFIE: "bg-indigo-50 text-indigo-600 border-indigo-200",
  TERMINE: "bg-emerald-50 text-emerald-700 border-emerald-200",
  PERDU: "bg-gray-50 text-gray-500 border-gray-200",
};

function timeAgo(dateStr: string): string {
  const days = Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
  if (days === 0) return "Aujourd'hui";
  if (days === 1) return "Hier";
  return `Il y a ${days}j`;
}

export default function LeadsTable({ leads, total, page, totalPages }: { leads: Lead[]; total: number; page: number; totalPages: number }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [search, setSearch] = useState(searchParams.get("search") || "");
  const { isSimple } = useViewMode();

  function navigate(params: Record<string, string>) {
    const sp = new URLSearchParams(searchParams.toString());
    Object.entries(params).forEach(([k, v]) => { if (v) sp.set(k, v); else sp.delete(k); });
    router.push(`/leads?${sp.toString()}`);
  }

  /* ── MODE SIMPLE — liste epuree type Apple Contacts ── */
  if (isSimple) {
    return (
      <div className="space-y-4">
        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-300" />
          <Input
            placeholder="Rechercher un lead..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && navigate({ search, page: "1" })}
            className="pl-10 bg-white border-gray-200 text-gray-900 placeholder:text-gray-400 rounded-xl h-11 shadow-sm"
          />
        </div>

        {/* List */}
        <div className="glass-card overflow-hidden">
          <div className="divide-y divide-gray-50">
            {leads.map((lead) => (
              <Link
                key={lead.id}
                href={`/leads/${lead.id}`}
                className="flex items-center gap-4 px-5 py-3.5 hover:bg-gray-50/80 transition-colors group"
              >
                <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center text-gray-500 text-[13px] font-semibold shrink-0">
                  {lead.prenom[0]}{lead.nom[0]}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-[14px] font-medium text-gray-900 truncate">
                      {lead.prenom} {lead.nom}
                    </p>
                    <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full border ${STATUT_STYLES[lead.statut] || ""}`}>
                      {lead.statut.replace(/_/g, " ")}
                    </span>
                    <IntentBadge devisDemande={lead.devisDemande} aSimule={lead.aSimule} />
                  </div>
                  <p className="text-[12px] text-gray-400 truncate">
                    {SOURCE_LABELS[lead.source] || lead.source} · {lead.typeProjet} · {lead.ville || "—"} · {timeAgo(lead.createdAt)}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {lead.prixDevis && (
                    <span className="text-[13px] font-semibold text-gray-700">
                      {formatEuros(lead.prixDevis)}
                    </span>
                  )}
                  <a
                    href={`tel:${lead.telephone}`}
                    onClick={(e) => e.stopPropagation()}
                    className="w-8 h-8 rounded-full bg-green-50 flex items-center justify-center text-green-500 hover:bg-green-100 transition-colors"
                  >
                    <Phone className="w-3.5 h-3.5" />
                  </a>
                </div>
              </Link>
            ))}
            {leads.length === 0 && (
              <div className="text-center text-gray-400 py-12 text-[14px]">
                Aucun lead trouve
              </div>
            )}
          </div>
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between">
          <p className="text-[13px] text-gray-400">{total} leads · Page {page}/{totalPages}</p>
          <div className="flex gap-1.5">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => navigate({ page: String(page - 1) })}
              className="border-gray-200 text-gray-500 rounded-lg h-8"><ChevronLeft className="h-4 w-4" /></Button>
            <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => navigate({ page: String(page + 1) })}
              className="border-gray-200 text-gray-500 rounded-lg h-8"><ChevronRight className="h-4 w-4" /></Button>
          </div>
        </div>
      </div>
    );
  }

  /* ── MODE AVANCE — tableau complet ── */
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-300" />
          <Input
            placeholder="Rechercher..." value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && navigate({ search, page: "1" })}
            className="pl-10 bg-white border-gray-200 text-gray-900 rounded-xl h-10"
          />
        </div>
        <Select onValueChange={(v) => { if (v) navigate({ statut: v === "all" ? "" : v, page: "1" }); }} defaultValue={searchParams.get("statut") || "all"}>
          <SelectTrigger className="w-[160px] bg-white border-gray-200 text-gray-700 rounded-xl"><SelectValue placeholder="Statut" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tous les statuts</SelectItem>
            {LEAD_STATUTS.map((s) => <SelectItem key={s} value={s}>{s.replace(/_/g, " ")}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select onValueChange={(v) => { if (v) navigate({ source: v === "all" ? "" : v, page: "1" }); }} defaultValue={searchParams.get("source") || "all"}>
          <SelectTrigger className="w-[140px] bg-white border-gray-200 text-gray-700 rounded-xl"><SelectValue placeholder="Source" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Toutes sources</SelectItem>
            {LEAD_SOURCES.map((s) => <SelectItem key={s} value={s}>{sourceLabel(s)}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div className="glass-card overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="border-gray-100 hover:bg-transparent">
              <TableHead className="text-gray-500 text-[12px] font-semibold">Nom</TableHead>
              <TableHead className="text-gray-500 text-[12px] font-semibold">Ville</TableHead>
              <TableHead className="text-gray-500 text-[12px] font-semibold">Source</TableHead>
              <TableHead className="text-gray-500 text-[12px] font-semibold">Statut</TableHead>
              <TableHead className="text-gray-500 text-[12px] font-semibold">Type</TableHead>
              <TableHead className="text-gray-500 text-[12px] font-semibold">Ref.</TableHead>
              <TableHead className="text-gray-500 text-[12px] font-semibold text-right">Prix Devis</TableHead>
              <TableHead className="text-gray-500 text-[12px] font-semibold text-right">Score</TableHead>
              <TableHead className="text-gray-500 text-[12px] font-semibold"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {leads.map((lead) => (
              <TableRow key={lead.id} className="border-gray-50 hover:bg-gray-50/60">
                <TableCell className="text-gray-900 font-medium text-[13px]">{lead.prenom} {lead.nom}</TableCell>
                <TableCell className="text-gray-500 text-[13px]">{lead.ville}</TableCell>
                <TableCell>
                  <span className="text-[11px] font-medium text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
                    {SOURCE_LABELS[lead.source] || lead.source}
                  </span>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-1.5">
                    <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full border ${STATUT_STYLES[lead.statut] || ""}`}>
                      {lead.statut.replace(/_/g, " ")}
                    </span>
                    <IntentBadge devisDemande={lead.devisDemande} aSimule={lead.aSimule} />
                  </div>
                </TableCell>
                <TableCell className="text-gray-500 text-[13px]">{lead.typeProjet}</TableCell>
                <TableCell className="text-gray-500 text-[12px] font-mono">{lead.referenceChoisie || "—"}</TableCell>
                <TableCell className="text-right text-[#CC0000] font-semibold text-[13px]">
                  {lead.prixDevis ? formatEuros(lead.prixDevis) : "—"}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-2">
                    <div className="w-12 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full bg-[#CC0000] rounded-full" style={{ width: `${lead.scoreSignature}%` }} />
                    </div>
                    <span className="text-[11px] text-gray-400 w-6">{lead.scoreSignature}</span>
                  </div>
                </TableCell>
                <TableCell>
                  <Link href={`/leads/${lead.id}`}>
                    <Button variant="ghost" size="icon" className="text-gray-400 hover:text-gray-900 h-8 w-8">
                      <Eye className="h-4 w-4" />
                    </Button>
                  </Link>
                </TableCell>
              </TableRow>
            ))}
            {leads.length === 0 && (
              <TableRow><TableCell colSpan={9} className="text-center text-gray-400 py-8">Aucun lead trouve</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-between">
        <p className="text-[13px] text-gray-400">{total} leads · Page {page}/{totalPages}</p>
        <div className="flex gap-1.5">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => navigate({ page: String(page - 1) })}
            className="border-gray-200 text-gray-500 rounded-lg"><ChevronLeft className="h-4 w-4" /></Button>
          <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => navigate({ page: String(page + 1) })}
            className="border-gray-200 text-gray-500 rounded-lg"><ChevronRight className="h-4 w-4" /></Button>
        </div>
      </div>
    </div>
  );
}
