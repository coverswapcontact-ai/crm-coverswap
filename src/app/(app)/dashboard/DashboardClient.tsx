"use client";

import { useViewMode } from "@/components/layout/ViewModeProvider";
import { formatEuros } from "@/lib/utils";
import { differenceInDays } from "date-fns";
import Link from "next/link";
import {
  TrendingUp, Users, Euro, Target, BarChart3,
  AlertTriangle, Calendar, Phone, Clock, ArrowUpRight,
  Sparkles, ChevronRight,
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
  relances: Lead[];
  acomptesEnAttente: Facture[];
  chantiersProchains: Chantier[];
  leadsRecents: Lead[];
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
      <div className="text-center pt-4">
        <h1 className="text-[28px] font-bold text-gray-900 tracking-tight">
          Bonjour Lucas
        </h1>
        <p className="text-gray-400 mt-1 text-[15px]">
          {new Date().toLocaleDateString("fr-FR", {
            weekday: "long", day: "numeric", month: "long",
          })}
        </p>
      </div>

      {/* 3 KPI cards */}
      <div className="grid grid-cols-3 gap-3">
        <div className="glass-card p-5 text-center">
          <p className="text-[11px] text-gray-400 font-medium uppercase tracking-wider">
            Nouveaux leads
          </p>
          <p className="text-[32px] font-bold text-gray-900 mt-1 leading-none">
            {data.leadsNouveaux}
          </p>
          <p className="text-[12px] text-gray-400 mt-1">{data.leadsTotal} au total</p>
        </div>
        <div className="glass-card p-5 text-center">
          <p className="text-[11px] text-gray-400 font-medium uppercase tracking-wider">
            CA ce mois
          </p>
          <p className="text-[32px] font-bold text-gray-900 mt-1 leading-none">
            {data.caMois >= 1000 ? `${(data.caMois / 1000).toFixed(1)}k` : formatEuros(data.caMois)}
          </p>
          <p className="text-[12px] text-gray-400 mt-1">
            Pipeline : {formatEuros(data.caPipeline)}
          </p>
        </div>
        <div className="glass-card p-5 text-center">
          <p className="text-[11px] text-gray-400 font-medium uppercase tracking-wider">
            Conversion
          </p>
          <p className="text-[32px] font-bold text-gray-900 mt-1 leading-none">
            {data.tauxConversion}%
          </p>
          <p className="text-[12px] text-gray-400 mt-1">
            {data.leadsSigned} signes
          </p>
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
                  className="flex items-center gap-4 px-5 py-3.5 hover:bg-gray-50/80 transition-colors group"
                >
                  <div className="w-9 h-9 rounded-full bg-blue-50 flex items-center justify-center text-blue-500 text-[13px] font-semibold shrink-0">
                    {lead.prenom[0]}{lead.nom[0]}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[14px] font-medium text-gray-900 truncate">
                      {lead.prenom} {lead.nom}
                    </p>
                    <p className="text-[12px] text-gray-400">
                      {SOURCE_LABELS[lead.source] || lead.source} · {lead.typeProjet} · {timeAgo(lead.createdAt)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
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
                className="flex items-center gap-4 px-5 py-3.5 hover:bg-gray-50/80 transition-colors group"
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
                <div className="flex items-center gap-2">
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
              className="flex items-center gap-4 px-5 py-3 hover:bg-gray-50/80 transition-colors group"
            >
              <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-gray-500 text-[12px] font-semibold shrink-0">
                {lead.prenom[0]}{lead.nom[0]}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-medium text-gray-900 truncate">
                  {lead.prenom} {lead.nom}
                </p>
                <p className="text-[11px] text-gray-400">
                  {lead.ville || "—"} · {lead.typeProjet}
                </p>
              </div>
              <div className="text-right">
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
                className="flex items-center gap-4 px-5 py-3.5 hover:bg-gray-50/80 transition-colors"
              >
                <div className="w-11 h-11 rounded-xl bg-blue-50 flex flex-col items-center justify-center shrink-0">
                  <span className="text-[10px] text-blue-400 font-medium uppercase leading-none">
                    {new Date(c.dateIntervention).toLocaleDateString("fr-FR", { month: "short" })}
                  </span>
                  <span className="text-[18px] font-bold text-blue-600 leading-none">
                    {new Date(c.dateIntervention).getDate()}
                  </span>
                </div>
                <div>
                  <p className="text-[14px] font-medium text-gray-900">
                    {c.lead.prenom} {c.lead.nom}
                  </p>
                  <p className="text-[12px] text-gray-400">{c.adresse}</p>
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
    { label: "CA Encaisse (total)", value: formatEuros(data.caTotal), icon: Euro, color: "text-green-500", bg: "bg-green-50" },
    { label: "CA Ce Mois", value: formatEuros(data.caMois), icon: TrendingUp, color: "text-blue-500", bg: "bg-blue-50" },
    { label: "CA Pipeline", value: formatEuros(data.caPipeline), icon: BarChart3, color: "text-purple-500", bg: "bg-purple-50" },
    { label: "Taux Conversion", value: `${data.tauxConversion}%`, icon: Target, color: "text-amber-500", bg: "bg-amber-50" },
    { label: "Panier Moyen", value: formatEuros(data.panierMoyen), icon: Euro, color: "text-red-500", bg: "bg-red-50" },
    { label: "Leads / Devis", value: `${data.leadsTotal} / ${data.devisTotal}`, icon: Users, color: "text-orange-500", bg: "bg-orange-50" },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-[24px] font-bold text-gray-900">Dashboard</h1>
        <p className="text-gray-400 mt-0.5 text-[14px]">
          Vue d&apos;ensemble de votre activite CoverSwap
        </p>
      </div>

      {/* KPI grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {kpis.map((kpi) => (
          <div key={kpi.label} className="glass-card p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[12px] text-gray-400 font-medium">{kpi.label}</p>
                <p className="text-[24px] font-bold text-gray-900 mt-1">{kpi.value}</p>
              </div>
              <div className={`w-10 h-10 rounded-xl ${kpi.bg} flex items-center justify-center`}>
                <kpi.icon className={`h-5 w-5 ${kpi.color}`} />
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Relances prioritaires */}
        {data.relances.length > 0 && (
          <div className="glass-card overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-orange-500" />
              <h2 className="text-[15px] font-semibold text-gray-900">Relances Prioritaires</h2>
            </div>
            <div className="divide-y divide-gray-50">
              {data.relances.map((lead) => (
                <Link
                  key={lead.id}
                  href={`/leads/${lead.id}`}
                  className="flex items-center justify-between px-5 py-3.5 hover:bg-gray-50/80 transition-colors"
                >
                  <div>
                    <p className="text-[14px] font-medium text-gray-900">
                      {lead.prenom} {lead.nom}
                    </p>
                    <p className="text-[12px] text-gray-400">
                      {lead.ville} · {lead.statut.replace(/_/g, " ")}
                    </p>
                  </div>
                  <div className="text-right">
                    {lead.prixDevis && (
                      <p className="text-[14px] font-bold text-[#CC0000]">
                        {formatEuros(lead.prixDevis)}
                      </p>
                    )}
                    <p className="text-[11px] text-orange-500 font-medium">
                      {differenceInDays(now, new Date(lead.updatedAt))}j sans contact
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
                  <div>
                    <p className="text-[14px] font-medium text-gray-900">
                      {f.devis.lead.prenom} {f.devis.lead.nom}
                    </p>
                    <p className="text-[12px] text-gray-400">{f.numero}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-[14px] font-bold text-amber-600">
                      {formatEuros(f.montantTotal * 0.3)}
                    </p>
                    <p className="text-[11px] text-gray-400">
                      {differenceInDays(now, new Date(f.createdAt))}j d&apos;attente
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
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-blue-50 flex flex-col items-center justify-center">
                      <span className="text-[9px] text-blue-400 font-medium uppercase leading-none">
                        {new Date(c.dateIntervention).toLocaleDateString("fr-FR", { month: "short" })}
                      </span>
                      <span className="text-[16px] font-bold text-blue-600 leading-none">
                        {new Date(c.dateIntervention).getDate()}
                      </span>
                    </div>
                    <div>
                      <p className="text-[14px] font-medium text-gray-900">
                        {c.lead.prenom} {c.lead.nom}
                      </p>
                      <p className="text-[12px] text-gray-400">{c.adresse}</p>
                    </div>
                  </div>
                  <span className="text-[12px] text-blue-500 font-medium">
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
