"use client";

import { useViewMode } from "@/components/layout/ViewModeProvider";
import { formatEuros } from "@/lib/utils";
import { differenceInDays } from "date-fns";
import Link from "next/link";
import Sparkline from "@/components/ui/sparkline";
import {
  TrendingUp, Users, Euro, Target, BarChart3,
  AlertTriangle, Calendar, Phone, ArrowUpRight,
  ChevronRight, AlertCircle, Wallet,
} from "lucide-react";

/* ── Types ── */
interface Lead {
  id: string;
  prenom: string;
  nom: string;
  telephone: string;
  email?: string;
  ville: string;
  source: string;
  statut: string;
  typeProjet: string;
  scoreSignature: number;
  prixDevis?: number;
  createdAt: string;
  updatedAt: string;
  referenceChoisie?: string;
  lienSimulation?: string;
}

interface Facture {
  id: string;
  numero: string;
  montantTotal: number;
  createdAt: string;
  devis: { lead: Lead };
}

interface Chantier {
  id: string;
  adresse: string;
  dateIntervention: string;
  lead: Lead;
}

interface DashboardData {
  caTotal: number;
  caMois: number;
  caPipeline: number;
  tauxConversion: number;
  panierMoyen: number;
  leadsTotal: number;
  leadsNouveaux: number;
  leadsSigned: number;
  devisTotal: number;
  impayesTotal: number;
  impayesCount: number;
  tresoreriePrevue: number;
  caHistorique: { month: string; ca: number }[];
  relances: Lead[];
  acomptesEnAttente: Facture[];
  chantiersProchains: Chantier[];
  leadsRecents: Lead[];
  facturesImpayees: Facture[];
  now: string;
}

/* ── Helpers ── */
const SOURCE_LABELS: Record<string, string> = {
  SITE_SIMULATEUR: "Simulateur",
  SITE_CONTACT: "Formulaire",
  SITE_DEVIS: "Devis web",
  META_ADS: "Meta Ads",
  ORGANIQUE: "Organique",
  AUTRE: "Autre",
};

const STATUT_STYLES: Record<string, string> = {
  NOUVEAU: "bg-blue-50 text-blue-600",
  CONTACTE: "bg-yellow-50 text-yellow-600",
  DEVIS_ENVOYE: "bg-purple-50 text-purple-600",
  SIGNE: "bg-green-50 text-green-600",
  CHANTIER_PLANIFIE: "bg-indigo-50 text-indigo-600",
  TERMINE: "bg-emerald-50 text-emerald-700",
  PERDU: "bg-gray-100 text-gray-500",
};

function timeAgo(dateStr: string): string {
  const days = differenceInDays(new Date(), new Date(dateStr));
  if (days === 0) return "Aujourd'hui";
  if (days === 1) return "Hier";
  return `Il y a ${days}j`;
}

/* ══════════════════════════════════════════════════════════════
   SIMPLE MODE — L'essentiel en un coup d'oeil
══════════════════════════════════════════════════════════════ */
function SimpleDashboard({ data }: { data: DashboardData }) {
  const now = new Date(data.now);

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      {/* Header */}
      <div className="text-center pt-4 px-4">
        <h1 className="text-[24px] sm:text-[28px] font-bold text-gray-900 tracking-tight">
          Bonjour Lucas
        </h1>
        <p className="text-gray-400 mt-1 text-[13px] sm:text-[15px]">
          {new Date().toLocaleDateString("fr-FR", {
            weekday: "long", day: "numeric", month: "long",
          })}
        </p>
      </div>

      {/* KPI cards - responsive 2 cols mobile, 3 desktop */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <div className="glass-card p-4 sm:p-5 text-center">
          <p className="text-[10px] sm:text-[11px] text-gray-400 font-medium uppercase tracking-wider">
            Nouveaux leads
          </p>
          <p className="text-[26px] sm:text-[32px] font-bold text-gray-900 mt-1 leading-none">
            {data.leadsNouveaux}
          </p>
          <p className="text-[11px] sm:text-[12px] text-gray-400 mt-1">{data.leadsTotal} au total</p>
        </div>
        <div className="glass-card p-4 sm:p-5 text-center">
          <p className="text-[10px] sm:text-[11px] text-gray-400 font-medium uppercase tracking-wider">
            CA ce mois
          </p>
          <p className="text-[26px] sm:text-[32px] font-bold text-gray-900 mt-1 leading-none">
            {data.caMois >= 1000 ? `${(data.caMois / 1000).toFixed(1)}k` : formatEuros(data.caMois)}
          </p>
          <p className="text-[11px] sm:text-[12px] text-gray-400 mt-1 truncate">
            Pipeline {formatEuros(data.caPipeline)}
          </p>
        </div>
        <div className="glass-card p-4 sm:p-5 text-center col-span-2 sm:col-span-1">
          <p className="text-[10px] sm:text-[11px] text-gray-400 font-medium uppercase tracking-wider">
            Conversion
          </p>
          <p className="text-[26px] sm:text-[32px] font-bold text-gray-900 mt-1 leading-none">
            {data.tauxConversion}%
          </p>
          <p className="text-[11px] sm:text-[12px] text-gray-400 mt-1">
            {data.leadsSigned} signes
          </p>
        </div>
      </div>

      {/* Factures impayees — urgent */}
      {data.impayesCount > 0 && (
        <Link
          href="/factures"
          className="block glass-card p-5 bg-red-50/40 border-red-100 hover:bg-red-50/60 transition-colors"
        >
          <div className="flex items-center gap-4">
            <div className="w-11 h-11 rounded-xl bg-red-100 flex items-center justify-center shrink-0">
              <AlertCircle className="w-5 h-5 text-red-500" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[13px] text-red-500 font-semibold uppercase tracking-wide">
                Factures impayees
              </p>
              <p className="text-[20px] font-bold text-gray-900 leading-tight">
                {formatEuros(data.impayesTotal)}
              </p>
              <p className="text-[12px] text-gray-500">{data.impayesCount} facture{data.impayesCount > 1 ? "s" : ""} a relancer</p>
            </div>
            <ChevronRight className="w-5 h-5 text-red-300 shrink-0" />
          </div>
        </Link>
      )}

      {/* Sparkline CA 6 mois */}
      <div className="glass-card p-5">
        <div className="flex items-center justify-between mb-3">
          <div>
            <p className="text-[11px] text-gray-400 font-medium uppercase tracking-wider">
              CA 6 derniers mois
            </p>
            <p className="text-[22px] font-bold text-gray-900 leading-tight">
              {formatEuros(data.caHistorique.reduce((s, m) => s + m.ca, 0))}
            </p>
          </div>
          <div className="text-right">
            <p className="text-[11px] text-gray-400 font-medium uppercase tracking-wider">Prev.</p>
            <p className="text-[14px] font-semibold text-emerald-600">
              {formatEuros(data.tresoreriePrevue)}
            </p>
          </div>
        </div>
        <Sparkline
          data={data.caHistorique.map((m) => ({ label: m.month, value: m.ca }))}
          color="#CC0000"
          height={56}
          formatTooltip={(v) => formatEuros(v)}
        />
        <div className="flex justify-between mt-2 px-0.5">
          {data.caHistorique.map((m) => (
            <span key={m.month} className="text-[10px] text-gray-400 capitalize">
              {m.month}
            </span>
          ))}
        </div>
      </div>

      {/* A traiter — urgences */}
      {(data.relances.length > 0 || data.leadsNouveaux > 0) && (
        <div className="glass-card overflow-hidden">
          <div className="px-5 py-3.5 border-b border-gray-100 flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-[#CC0000] animate-pulse" />
            <h2 className="text-[14px] font-semibold text-gray-900">A traiter</h2>
          </div>
          <div className="divide-y divide-gray-50">
            {data.leadsRecents
              .filter((l) => l.statut === "NOUVEAU")
              .slice(0, 5)
              .map((lead) => (
                <Link
                  key={lead.id}
                  href={`/leads/${lead.id}`}
                  className="flex items-center gap-3 sm:gap-4 px-4 sm:px-5 py-3.5 hover:bg-gray-50/80 transition-colors group"
                >
                  <div className="w-9 h-9 rounded-full bg-blue-50 flex items-center justify-center text-blue-500 text-[13px] font-semibold shrink-0">
                    {lead.prenom[0]}{lead.nom[0]}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[14px] font-medium text-gray-900 truncate">
                      {lead.prenom} {lead.nom}
                    </p>
                    <p className="text-[12px] text-gray-400 truncate">
                      {SOURCE_LABELS[lead.source] || lead.source} · {lead.typeProjet} · {timeAgo(lead.createdAt)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <a
                      href={`tel:${lead.telephone}`}
                      onClick={(e) => e.stopPropagation()}
                      className="w-8 h-8 rounded-full bg-green-50 flex items-center justify-center text-green-500 hover:bg-green-100 transition-colors"
                    >
                      <Phone className="w-3.5 h-3.5" />
                    </a>
                    <ChevronRight className="w-4 h-4 text-gray-300 group-hover:text-gray-500 transition-colors" />
                  </div>
                </Link>
              ))}

            {data.relances.map((lead) => (
              <Link
                key={lead.id}
                href={`/leads/${lead.id}`}
                className="flex items-center gap-3 sm:gap-4 px-4 sm:px-5 py-3.5 hover:bg-gray-50/80 transition-colors group"
              >
                <div className="w-9 h-9 rounded-full bg-orange-50 flex items-center justify-center text-orange-500 text-[13px] font-semibold shrink-0">
                  <AlertTriangle className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[14px] font-medium text-gray-900 truncate">
                    {lead.prenom} {lead.nom}
                  </p>
                  <p className="text-[12px] text-orange-500 font-medium">
                    {differenceInDays(now, new Date(lead.updatedAt))}j sans contact
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {lead.prixDevis && (
                    <span className="text-[13px] font-semibold text-gray-900">
                      {formatEuros(lead.prixDevis)}
                    </span>
                  )}
                  <ChevronRight className="w-4 h-4 text-gray-300 group-hover:text-gray-500 transition-colors" />
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Derniers leads */}
      <div className="glass-card overflow-hidden">
        <div className="px-5 py-3.5 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-[14px] font-semibold text-gray-900">Derniers leads</h2>
          <Link href="/leads" className="text-[13px] text-[#CC0000] font-medium flex items-center gap-1 hover:underline">
            Voir tout <ArrowUpRight className="w-3.5 h-3.5" />
          </Link>
        </div>
        <div className="divide-y divide-gray-50">
          {data.leadsRecents.map((lead) => (
            <Link
              key={lead.id}
              href={`/leads/${lead.id}`}
              className="flex items-center gap-3 sm:gap-4 px-4 sm:px-5 py-3 hover:bg-gray-50/80 transition-colors group"
            >
              <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-gray-500 text-[12px] font-semibold shrink-0">
                {lead.prenom[0]}{lead.nom[0]}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-medium text-gray-900 truncate">
                  {lead.prenom} {lead.nom}
                </p>
                <p className="text-[11px] text-gray-400 truncate">
                  {lead.ville || "—"} · {lead.typeProjet}
                </p>
              </div>
              <div className="text-right shrink-0">
                <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${STATUT_STYLES[lead.statut] || "bg-gray-100 text-gray-500"}`}>
                  {lead.statut.replace(/_/g, " ")}
                </span>
              </div>
            </Link>
          ))}
        </div>
      </div>

      {/* Prochains chantiers */}
      {data.chantiersProchains.length > 0 && (
        <div className="glass-card overflow-hidden">
          <div className="px-5 py-3.5 border-b border-gray-100 flex items-center gap-2">
            <Calendar className="w-4 h-4 text-blue-500" />
            <h2 className="text-[14px] font-semibold text-gray-900">Prochains chantiers</h2>
          </div>
          <div className="divide-y divide-gray-50">
            {data.chantiersProchains.map((c) => (
              <Link
                key={c.id}
                href="/chantiers/calendrier"
                className="flex items-center gap-3 sm:gap-4 px-4 sm:px-5 py-3.5 hover:bg-gray-50/80 transition-colors"
              >
                <div className="w-11 h-11 rounded-xl bg-blue-50 flex flex-col items-center justify-center shrink-0">
                  <span className="text-[10px] text-blue-400 font-medium uppercase leading-none">
                    {new Date(c.dateIntervention).toLocaleDateString("fr-FR", { month: "short" })}
                  </span>
                  <span className="text-[18px] font-bold text-blue-600 leading-none">
                    {new Date(c.dateIntervention).getDate()}
                  </span>
                </div>
                <div className="min-w-0">
                  <p className="text-[14px] font-medium text-gray-900 truncate">
                    {c.lead.prenom} {c.lead.nom}
                  </p>
                  <p className="text-[12px] text-gray-400 truncate">{c.adresse}</p>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   ADVANCED MODE — Tout le detail business
══════════════════════════════════════════════════════════════ */
function AdvancedDashboard({ data }: { data: DashboardData }) {
  const now = new Date(data.now);

  const kpis = [
    { label: "CA Encaisse", value: formatEuros(data.caTotal), icon: Euro, color: "text-green-500", bg: "bg-green-50" },
    { label: "CA Ce Mois", value: formatEuros(data.caMois), icon: TrendingUp, color: "text-blue-500", bg: "bg-blue-50" },
    { label: "CA Pipeline", value: formatEuros(data.caPipeline), icon: BarChart3, color: "text-purple-500", bg: "bg-purple-50" },
    { label: "Conversion", value: `${data.tauxConversion}%`, icon: Target, color: "text-amber-500", bg: "bg-amber-50" },
    { label: "Panier Moyen", value: formatEuros(data.panierMoyen), icon: Euro, color: "text-[#CC0000]", bg: "bg-red-50" },
    { label: "Leads / Devis", value: `${data.leadsTotal}/${data.devisTotal}`, icon: Users, color: "text-orange-500", bg: "bg-orange-50" },
    { label: "Tresorerie prev.", value: formatEuros(data.tresoreriePrevue), icon: Wallet, color: "text-emerald-500", bg: "bg-emerald-50" },
    { label: "Impayes", value: formatEuros(data.impayesTotal), icon: AlertCircle, color: data.impayesCount > 0 ? "text-red-500" : "text-gray-400", bg: data.impayesCount > 0 ? "bg-red-50" : "bg-gray-50" },
  ];

  return (
    <div className="space-y-6 sm:space-y-8">
      <div>
        <h1 className="text-[22px] sm:text-[24px] font-bold text-gray-900">Dashboard</h1>
        <p className="text-gray-400 mt-0.5 text-[13px] sm:text-[14px]">
          Vue d&apos;ensemble de votre activite CoverSwap
        </p>
      </div>

      {/* KPI grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
        {kpis.map((kpi) => (
          <div key={kpi.label} className="glass-card p-4 sm:p-5">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-[11px] sm:text-[12px] text-gray-400 font-medium truncate">{kpi.label}</p>
                <p className="text-[18px] sm:text-[22px] font-bold text-gray-900 mt-1 truncate">{kpi.value}</p>
              </div>
              <div className={`w-9 h-9 sm:w-10 sm:h-10 rounded-xl ${kpi.bg} flex items-center justify-center shrink-0`}>
                <kpi.icon className={`h-4 w-4 sm:h-5 sm:w-5 ${kpi.color}`} />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Sparkline CA */}
      <div className="glass-card p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-[14px] font-semibold text-gray-900">CA 6 derniers mois</h2>
          <span className="text-[13px] font-semibold text-[#CC0000]">
            {formatEuros(data.caHistorique.reduce((s, m) => s + m.ca, 0))}
          </span>
        </div>
        <Sparkline
          data={data.caHistorique.map((m) => ({ label: m.month, value: m.ca }))}
          color="#CC0000"
          height={72}
          formatTooltip={(v) => formatEuros(v)}
        />
        <div className="flex justify-between mt-2 px-0.5">
          {data.caHistorique.map((m) => (
            <span key={m.month} className="text-[10px] text-gray-400 capitalize">
              {m.month}
            </span>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
        {/* Factures impayees */}
        {data.facturesImpayees.length > 0 && (
          <div className="glass-card overflow-hidden border-red-100 bg-red-50/30">
            <div className="px-5 py-4 border-b border-red-100 flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-red-500" />
              <h2 className="text-[15px] font-semibold text-gray-900">
                Factures impayees ({data.facturesImpayees.length})
              </h2>
            </div>
            <div className="divide-y divide-red-50">
              {data.facturesImpayees.slice(0, 5).map((f) => (
                <Link
                  key={f.id}
                  href="/factures"
                  className="flex items-center justify-between px-5 py-3.5 hover:bg-red-50/40 transition-colors"
                >
                  <div className="min-w-0">
                    <p className="text-[14px] font-medium text-gray-900 truncate">
                      {f.devis.lead.prenom} {f.devis.lead.nom}
                    </p>
                    <p className="text-[12px] text-gray-400">{f.numero}</p>
                  </div>
                  <div className="text-right shrink-0 ml-3">
                    <p className="text-[14px] font-bold text-red-500">
                      {formatEuros(f.montantTotal)}
                    </p>
                    <p className="text-[11px] text-red-400 font-medium">
                      {differenceInDays(now, new Date(f.createdAt))}j
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* Relances prioritaires */}
        {data.relances.length > 0 && (
          <div className="glass-card overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-orange-500" />
              <h2 className="text-[15px] font-semibold text-gray-900">Relances prioritaires</h2>
            </div>
            <div className="divide-y divide-gray-50">
              {data.relances.map((lead) => (
                <Link
                  key={lead.id}
                  href={`/leads/${lead.id}`}
                  className="flex items-center justify-between px-5 py-3.5 hover:bg-gray-50/80 transition-colors"
                >
                  <div className="min-w-0">
                    <p className="text-[14px] font-medium text-gray-900 truncate">
                      {lead.prenom} {lead.nom}
                    </p>
                    <p className="text-[12px] text-gray-400 truncate">
                      {lead.ville} · {lead.statut.replace(/_/g, " ")}
                    </p>
                  </div>
                  <div className="text-right shrink-0 ml-3">
                    {lead.prixDevis && (
                      <p className="text-[14px] font-bold text-[#CC0000]">
                        {formatEuros(lead.prixDevis)}
                      </p>
                    )}
                    <p className="text-[11px] text-orange-500 font-medium">
                      {differenceInDays(now, new Date(lead.updatedAt))}j
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* Acomptes en attente */}
        {data.acomptesEnAttente.length > 0 && (
          <div className="glass-card overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
              <Euro className="h-4 w-4 text-amber-500" />
              <h2 className="text-[15px] font-semibold text-gray-900">
                Acomptes en attente ({data.acomptesEnAttente.length})
              </h2>
            </div>
            <div className="divide-y divide-gray-50">
              {data.acomptesEnAttente.map((f) => (
                <Link
                  key={f.id}
                  href="/factures"
                  className="flex items-center justify-between px-5 py-3.5 hover:bg-gray-50/80 transition-colors"
                >
                  <div className="min-w-0">
                    <p className="text-[14px] font-medium text-gray-900 truncate">
                      {f.devis.lead.prenom} {f.devis.lead.nom}
                    </p>
                    <p className="text-[12px] text-gray-400">{f.numero}</p>
                  </div>
                  <div className="text-right shrink-0 ml-3">
                    <p className="text-[14px] font-bold text-amber-600">
                      {formatEuros(f.montantTotal * 0.3)}
                    </p>
                    <p className="text-[11px] text-gray-400">
                      {differenceInDays(now, new Date(f.createdAt))}j
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* Chantiers prochains */}
        {data.chantiersProchains.length > 0 && (
          <div className="glass-card overflow-hidden lg:col-span-2">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
              <Calendar className="h-4 w-4 text-blue-500" />
              <h2 className="text-[15px] font-semibold text-gray-900">Chantiers a venir</h2>
            </div>
            <div className="divide-y divide-gray-50">
              {data.chantiersProchains.map((c) => (
                <Link
                  key={c.id}
                  href="/chantiers/calendrier"
                  className="flex items-center justify-between px-5 py-3.5 hover:bg-gray-50/80 transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-xl bg-blue-50 flex flex-col items-center justify-center shrink-0">
                      <span className="text-[9px] text-blue-400 font-medium uppercase leading-none">
                        {new Date(c.dateIntervention).toLocaleDateString("fr-FR", { month: "short" })}
                      </span>
                      <span className="text-[16px] font-bold text-blue-600 leading-none">
                        {new Date(c.dateIntervention).getDate()}
                      </span>
                    </div>
                    <div className="min-w-0">
                      <p className="text-[14px] font-medium text-gray-900 truncate">
                        {c.lead.prenom} {c.lead.nom}
                      </p>
                      <p className="text-[12px] text-gray-400 truncate">{c.adresse}</p>
                    </div>
                  </div>
                  <span className="text-[12px] text-blue-500 font-medium shrink-0 ml-3">
                    dans {differenceInDays(new Date(c.dateIntervention), now)}j
                  </span>
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   EXPORT — switch selon le mode
══════════════════════════════════════════════════════════════ */
export default function DashboardClient({ data }: { data: DashboardData }) {
  const { isSimple } = useViewMode();
  return isSimple ? <SimpleDashboard data={data} /> : <AdvancedDashboard data={data} />;
}
