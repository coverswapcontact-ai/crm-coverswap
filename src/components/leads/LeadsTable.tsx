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
import LeadFunnel from "@/components/leads/LeadFunnel";
import DeleteRowButton from "@/components/ui/delete-row-button";

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
  lastActivityAt?: string;
  notes?: string | null;
  devisDemande?: boolean;
  aSimule?: boolean;
  soldeRecu?: boolean;
}

// Action attendue + urgence par statut
function getNextAction(statut: string): string {
  switch (statut) {
    case "NOUVEAU": return "À contacter";
    case "CONTACTE": return "Attente retour";
    case "DEVIS_ENVOYE": return "Relancer devis";
    case "SIGNE": return "Planifier chantier";
    case "CHANTIER_PLANIFIE": return "Commander matière";
    case "TERMINE": return "—";
    case "PERDU": return "—";
    default: return "";
  }
}

// Code couleur selon le temps écoulé depuis la dernière activité
// et la sensibilité au temps du statut courant
function getRelanceColor(days: number, statut: string): {
  bg: string;
  text: string;
  border: string;
  label: string;
  urgent: boolean;
} {
  const terminal = statut === "TERMINE" || statut === "PERDU";
  if (terminal) {
    return { bg: "bg-gray-50", text: "text-gray-400", border: "border-gray-100", label: `${days}j`, urgent: false };
  }

  // Seuils adaptés selon statut
  let seuilVert = 2;
  let seuilJaune = 5;
  let seuilOrange = 10;

  if (statut === "NOUVEAU") {
    seuilVert = 0; seuilJaune = 1; seuilOrange = 3; // très urgent sur lead neuf
  } else if (statut === "DEVIS_ENVOYE") {
    seuilVert = 3; seuilJaune = 7; seuilOrange = 14;
  } else if (statut === "CONTACTE") {
    seuilVert = 2; seuilJaune = 5; seuilOrange = 10;
  }

  if (days <= seuilVert)  return { bg: "bg-green-50",  text: "text-green-600",  border: "border-green-200",  label: days === 0 ? "Auj." : `${days}j`, urgent: false };
  if (days <= seuilJaune) return { bg: "bg-yellow-50", text: "text-yellow-600", border: "border-yellow-200", label: `${days}j`, urgent: false };
  if (days <= seuilOrange)return { bg: "bg-orange-50", text: "text-orange-600", border: "border-orange-200", label: `${days}j`, urgent: true };
  return { bg: "bg-red-50",    text: "text-red-600",    border: "border-red-200",    label: `${days}j`, urgent: true };
}

function daysSince(dateStr: string | undefined): number {
  if (!dateStr) return 0;
  return Math.max(0, Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000));
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
  // Compare Paris calendar days (fix: timestamps bruts donnaient "Aujourd'hui"
  // pour un lead d'hier 23h quand on regardait ce matin 9h)
  const toParisYmd = (d: Date) =>
    d.toLocaleDateString("fr-CA", { timeZone: "Europe/Paris" }); // "YYYY-MM-DD"
  const today = toParisYmd(new Date());
  const leadDay = toParisYmd(new Date(dateStr));
  if (today === leadDay) return "Aujourd'hui";
  const [y1, m1, d1] = today.split("-").map(Number);
  const [y2, m2, d2] = leadDay.split("-").map(Number);
  const days = Math.round((Date.UTC(y1, m1 - 1, d1) - Date.UTC(y2, m2 - 1, d2)) / 86400000);
  if (days === 1) return "Hier";
  if (days < 0) return `Dans ${-days}j`;
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
            {leads.map((lead) => {
              const d = daysSince(lead.lastActivityAt || lead.createdAt);
              const rc = getRelanceColor(d, lead.statut);
              const action = getNextAction(lead.statut);
              return (
              <Link
                key={lead.id}
                href={`/leads/${lead.id}`}
                className={`flex items-center gap-4 px-5 py-3.5 hover:bg-gray-50/80 transition-colors group ${rc.urgent ? "bg-red-50/30" : ""}`}
              >
                <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center text-gray-500 text-[13px] font-semibold shrink-0 relative">
                  {lead.prenom[0]}{lead.nom[0]}
                  {rc.urgent && (
                    <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 bg-red-500 rounded-full ring-2 ring-white animate-pulse" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-[14px] font-medium text-gray-900 truncate">
                      {lead.prenom} {lead.nom}
                    </p>
                    <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full border ${STATUT_STYLES[lead.statut] || ""}`}>
                      {lead.statut.replace(/_/g, " ")}
                    </span>
                    {action && action !== "—" && (
                      <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${rc.bg} ${rc.text} ${rc.border}`}>
                        {action} · {rc.label}
                      </span>
                    )}
                    <IntentBadge devisDemande={lead.devisDemande} aSimule={lead.aSimule} />
                  </div>
                  <p className="text-[12px] text-gray-400 truncate">
                    {SOURCE_LABELS[lead.source] || lead.source} · {lead.typeProjet} · {lead.ville || "—"} · créé {timeAgo(lead.createdAt)}
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
              );
            })}
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
              <TableHead className="text-gray-500 text-[12px] font-semibold">Date</TableHead>
              <TableHead className="text-gray-500 text-[12px] font-semibold">Ville</TableHead>
              <TableHead className="text-gray-500 text-[12px] font-semibold">Source</TableHead>
              <TableHead className="text-gray-500 text-[12px] font-semibold">Statut</TableHead>
              <TableHead className="text-gray-500 text-[12px] font-semibold">Relance</TableHead>
              <TableHead className="text-gray-500 text-[12px] font-semibold">Type</TableHead>
              <TableHead className="text-gray-500 text-[12px] font-semibold">Ref.</TableHead>
              <TableHead className="text-gray-500 text-[12px] font-semibold text-right">Prix Devis</TableHead>
              <TableHead className="text-gray-500 text-[12px] font-semibold">Tunnel</TableHead>
              <TableHead className="text-gray-500 text-[12px] font-semibold"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {leads.map((lead) => {
              const d = daysSince(lead.lastActivityAt || lead.createdAt);
              const rc = getRelanceColor(d, lead.statut);
              const action = getNextAction(lead.statut);
              return (
              <TableRow
                key={lead.id}
                onClick={() => router.push(`/leads/${lead.id}`)}
                className={`border-gray-50 hover:bg-gray-50/60 cursor-pointer ${rc.urgent ? "bg-red-50/30" : ""}`}
              >
                <TableCell className="text-gray-900 font-medium text-[13px]">
                  <Link
                    href={`/leads/${lead.id}`}
                    onClick={(e) => e.stopPropagation()}
                    className="flex items-center gap-2 hover:text-[#CC0000] transition-colors"
                  >
                    {rc.urgent && <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse shrink-0" />}
                    {lead.prenom} {lead.nom}
                  </Link>
                </TableCell>
                <TableCell className="text-gray-500 text-[12px] whitespace-nowrap">
                  <div className="flex flex-col leading-tight">
                    <span className="text-gray-700">{new Date(lead.createdAt).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "2-digit", timeZone: "Europe/Paris" })}</span>
                    <span className="text-[10px] text-gray-400">{timeAgo(lead.createdAt)}</span>
                  </div>
                </TableCell>
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
                <TableCell>
                  {action && action !== "—" ? (
                    <div className="flex flex-col gap-0.5">
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border w-fit ${rc.bg} ${rc.text} ${rc.border}`}>
                        {action}
                      </span>
                      <span className={`text-[10px] ${rc.text}`}>{rc.label} sans contact</span>
                    </div>
                  ) : (
                    <span className="text-[11px] text-gray-300">—</span>
                  )}
                </TableCell>
                <TableCell className="text-gray-500 text-[13px]">{lead.typeProjet}</TableCell>
                <TableCell className="text-gray-500 text-[12px] font-mono">{lead.referenceChoisie || "—"}</TableCell>
                <TableCell className="text-right text-[#CC0000] font-semibold text-[13px]">
                  {lead.prixDevis ? formatEuros(lead.prixDevis) : "—"}
                </TableCell>
                <TableCell>
                  <LeadFunnel statut={lead.statut} soldeRecu={lead.soldeRecu} />
                </TableCell>
                <TableCell onClick={(e) => e.stopPropagation()}>
                  <div className="flex items-center gap-1 justify-end">
                    <Link href={`/leads/${lead.id}`}>
                      <Button variant="ghost" size="icon" className="text-gray-400 hover:text-gray-900 h-8 w-8">
                        <Eye className="h-4 w-4" />
                      </Button>
                    </Link>
                    <DeleteRowButton url={`/api/leads/${lead.id}`} entityLabel={`lead ${lead.prenom} ${lead.nom}`} />
                  </div>
                </TableCell>
              </TableRow>
              );
            })}
            {leads.length === 0 && (
              <TableRow><TableCell colSpan={11} className="text-center text-gray-400 py-8">Aucun lead trouve</TableCell></TableRow>
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
