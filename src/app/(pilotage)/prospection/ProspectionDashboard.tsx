"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Check,
  CheckCheck,
  CircleCheck,
  Loader2,
  Pencil,
  Radar,
  Sparkles,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import type { AgentSlug } from "@/lib/prospection/constants";
import { AGENTS, KPIS, PROSPECTS, type ProspectMock } from "./mockData";

// Transition unique du module : 150ms ease (cf. directives design)
const TRANS = "transition-colors duration-150 ease-[ease]";

const formatNote = (n: number) => n.toFixed(1).replace(".", ",");

/* ── Liste réelle des prospects sourcés (GET /api/prospection/prospects) ── */
type ProspectSource = {
  id: string;
  nom: string;
  ville: string | null;
  codePostal: string | null;
  noteGoogle: number | null;
  nbAvis: number | null;
  statut: string;
  createdAt: string;
};

type ResultatSourcingApi = {
  nouveaux: number;
  rejetes: number;
  dejaConnus: number;
  evalues: number;
  motifsRejet: Record<string, number>;
  erreurs: string[];
};

const LIBELLES_STATUT: Record<string, string> = {
  SOURCE: "Sourcé",
  QUALIFIE: "Qualifié",
  ECARTE: "Écarté",
  CONTACTE: "Contacté",
  RELANCE: "Relancé",
  REPONDU: "Répondu",
  RDV: "RDV",
  CLIENT: "Client",
  OPT_OUT: "Opt-out",
};

const LIBELLES_MOTIF: Record<string, string> = {
  nonOperationnel: "fermés",
  horsHerault: "hors Hérault",
  franchiseBlacklist: "franchises exclues",
  nbAvisHorsPlage: "nb d'avis hors plage",
  noteHorsPlage: "note hors plage",
};

const formatDateSourcing = (iso: string) =>
  format(new Date(iso), "d MMM yyyy, HH:mm", { locale: fr });

function descriptionSourcing(r: ResultatSourcingApi): string | undefined {
  const morceaux: string[] = [];
  const motifs = Object.entries(r.motifsRejet ?? {})
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([motif, n]) => `${LIBELLES_MOTIF[motif] ?? motif} : ${n}`);
  if (motifs.length > 0) morceaux.push(motifs.join(" · "));
  if (r.dejaConnus > 0) morceaux.push(`déjà connus : ${r.dejaConnus}`);
  if (r.erreurs && r.erreurs.length > 0) {
    morceaux.push(`${r.erreurs.length} erreur(s) API — voir la console serveur`);
  }
  return morceaux.length > 0 ? morceaux.join(" — ") : undefined;
}

/* ── Anneau de score SVG, animé au chargement (stroke-dashoffset) ── */
function ScoreRing({ score, delay = 0 }: { score: number; delay?: number }) {
  const [drawn, setDrawn] = useState(false);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setDrawn(true));
    return () => cancelAnimationFrame(raf);
  }, []);
  const size = 52;
  const stroke = 3;
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const color = score >= 75 ? "#1D9E75" : score >= 50 ? "#EF9F27" : "#6B7280";
  return (
    <div
      className="relative h-[52px] w-[52px] shrink-0"
      role="img"
      aria-label={`Score ${score} sur 100`}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="#2A2D34"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={drawn ? circ * (1 - score / 100) : circ}
          style={{
            transition: `stroke-dashoffset 900ms cubic-bezier(0.22, 1, 0.36, 1) ${delay}ms`,
          }}
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-[13px] font-medium tabular-nums text-[#F2F3F5]">
        {score}
      </span>
    </div>
  );
}

/* ── Bouton icône (valider / éditer / rejeter) ── */
function IconBtn({
  label,
  onClick,
  positive = false,
  children,
}: {
  label: string;
  onClick: () => void;
  positive?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className={`flex h-8 w-8 items-center justify-center rounded-[8px] border-[0.5px] border-[#2A2D34] text-[#9CA3AF] ${TRANS} ${
        positive
          ? "hover:border-[#1D9E75]/50 hover:bg-[#112B22] hover:text-[#5DCAA5]"
          : "hover:border-[#3A3E47] hover:bg-[#22262D] hover:text-[#F2F3F5]"
      }`}
    >
      {children}
    </button>
  );
}

/* ── Carte KPI ── */
function KpiCard({
  label,
  value,
  sub,
  highlight = false,
}: {
  label: string;
  value: number;
  sub: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={`rounded-[11px] border-[0.5px] p-5 ${
        highlight
          ? "border-[#1D9E75]/30 bg-[#112B22]"
          : "border-[#2A2D34] bg-[#1C1F25]"
      }`}
    >
      <p className="text-[13px] text-[#9CA3AF]">{label}</p>
      <p
        className={`mt-3 text-[28px] font-medium leading-none tracking-tight tabular-nums ${
          highlight ? "text-[#5DCAA5]" : "text-[#F2F3F5]"
        }`}
      >
        {value}
      </p>
      <p className={`mt-3 text-[12px] ${highlight ? "text-[#5DCAA5]/70" : "text-[#6B7280]"}`}>
        {sub}
      </p>
    </div>
  );
}

/* ── Carte prospect de la file de validation ── */
function ProspectCard({
  prospect,
  index,
  onValider,
  onEditer,
  onRejeter,
}: {
  prospect: ProspectMock;
  index: number;
  onValider: () => void;
  onEditer: () => void;
  onRejeter: () => void;
}) {
  return (
    <article
      className={`flex items-center gap-4 rounded-[11px] border-[0.5px] border-[#2A2D34] bg-[#1C1F25] p-4 ${TRANS} hover:border-[#3A3E47]`}
    >
      <ScoreRing score={prospect.score} delay={index * 90} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <h3 className="text-[14px] font-medium text-[#F2F3F5]">{prospect.nom}</h3>
          <span className="text-[12px] text-[#6B7280]">
            {prospect.ville} · {formatNote(prospect.noteGoogle)} ★ · {prospect.nbAvis} avis
          </span>
        </div>
        <p className="mt-1 text-[13px] leading-relaxed text-[#9CA3AF]">
          « {prospect.signalPrincipal} »{" "}
          <span className="whitespace-nowrap text-[#6B7280]">— {prospect.signalSource}</span>
        </p>
        <p className="mt-1.5 flex items-center gap-1.5 text-[13px] text-[#5DCAA5]">
          <Sparkles size={13} className="shrink-0" aria-hidden />
          <span className="min-w-0 truncate">{prospect.angleSuggere}</span>
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1.5 self-center">
        <IconBtn positive label="Valider l'email" onClick={onValider}>
          <Check size={15} />
        </IconBtn>
        <IconBtn label="Éditer le brouillon" onClick={onEditer}>
          <Pencil size={14} />
        </IconBtn>
        <IconBtn label="Rejeter" onClick={onRejeter}>
          <X size={15} />
        </IconBtn>
      </div>
    </article>
  );
}

/* ── Dashboard ── */
export default function ProspectionDashboard() {
  const [agent, setAgent] = useState<AgentSlug>("hotels");
  // Ids traités localement (mock) — par agent, pour que le switch conserve l'état
  const [traites, setTraites] = useState<Record<AgentSlug, string[]>>({
    hotels: [],
    restaurants: [],
  });

  // Prospects sourcés (données réelles) — rechargés au switch d'agent et après sourcing
  const [prospects, setProspects] = useState<ProspectSource[]>([]);
  const [totalProspects, setTotalProspects] = useState(0);
  const [chargementListe, setChargementListe] = useState(true);
  const [sourcingEnCours, setSourcingEnCours] = useState(false);
  const [refreshListe, setRefreshListe] = useState(0);

  useEffect(() => {
    let actif = true;
    setChargementListe(true);
    fetch(`/api/prospection/prospects?agent=${agent}`)
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
        if (!actif) return;
        setProspects(json.prospects ?? []);
        setTotalProspects(json.total ?? 0);
      })
      .catch((erreur: unknown) => {
        if (!actif) return;
        setProspects([]);
        setTotalProspects(0);
        toast.error("Lecture des prospects impossible", {
          description: erreur instanceof Error ? erreur.message : undefined,
        });
      })
      .finally(() => {
        if (actif) setChargementListe(false);
      });
    return () => {
      actif = false;
    };
  }, [agent, refreshListe]);

  const kpis = KPIS[agent];
  const file = useMemo(
    () => PROSPECTS.filter((p) => p.agent === agent && !traites[agent].includes(p.id)),
    [agent, traites]
  );

  const retirer = (ids: string[]) =>
    setTraites((t) => ({ ...t, [agent]: [...t[agent], ...ids] }));

  const valider = (p: ProspectMock) => {
    retirer([p.id]);
    toast.success(`${p.nom} — brouillon validé`, {
      description: "Prêt pour l'envoi (étape 3).",
    });
  };
  const editer = (p: ProspectMock) => {
    toast(`${p.nom} — édition du brouillon`, {
      description: "L'éditeur d'email arrive à l'étape 3.",
    });
  };
  const rejeter = (p: ProspectMock) => {
    retirer([p.id]);
    toast(`${p.nom} — écarté de la file`);
  };
  const toutValider = () => {
    const n = file.length;
    retirer(file.map((p) => p.id));
    toast.success(`${n} brouillon${n > 1 ? "s" : ""} validé${n > 1 ? "s" : ""}`);
  };
  const sourcer = async () => {
    if (sourcingEnCours) return;
    setSourcingEnCours(true);
    const libelle = AGENTS.find((a) => a.slug === agent)?.label ?? agent;
    try {
      const res = await fetch("/api/prospection/sourcing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentSlug: agent }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
      const resultat = json as ResultatSourcingApi;
      toast.success(
        `Sourcing ${libelle} : ${resultat.nouveaux} nouveaux, ${resultat.rejetes} rejetés`,
        { description: descriptionSourcing(resultat) }
      );
      setRefreshListe((n) => n + 1);
    } catch (erreur) {
      toast.error("Sourcing impossible", {
        description: erreur instanceof Error ? erreur.message : undefined,
      });
    } finally {
      setSourcingEnCours(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-5xl px-5 py-8 md:px-8 md:py-12">
      {/* ── Header : titre + switcher d'agents + sourcing ── */}
      <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-4">
        <div>
          <h1 className="text-[18px] font-medium tracking-tight text-[#F2F3F5]">
            Prospection
          </h1>
          <p className="mt-1 text-[13px] text-[#9CA3AF]">
            Agent commercial IA — hôtels & restaurants de l’Hérault
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <div
            role="tablist"
            aria-label="Profil d'agent"
            className="flex items-center rounded-[9px] border-[0.5px] border-[#2A2D34] bg-[#1C1F25] p-[3px]"
          >
            {AGENTS.map((a) => {
              const active = agent === a.slug;
              return (
                <button
                  key={a.slug}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setAgent(a.slug)}
                  className={`flex items-center gap-2 rounded-[7px] px-3.5 py-1.5 text-[13px] font-medium ${TRANS} ${
                    active
                      ? "bg-[#272B33] text-[#F2F3F5]"
                      : "text-[#9CA3AF] hover:text-[#F2F3F5]"
                  }`}
                >
                  <span
                    aria-hidden
                    title={a.actif ? "Agent actif" : "Agent inactif"}
                    className={`h-1.5 w-1.5 rounded-full ${a.actif ? "bg-[#1D9E75]" : "bg-[#6B7280]"}`}
                  />
                  {a.label}
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={sourcer}
            disabled={sourcingEnCours}
            aria-busy={sourcingEnCours}
            className={`inline-flex h-8 items-center gap-1.5 rounded-[8px] border-[0.5px] border-[#2A2D34] bg-[#1C1F25] px-3.5 text-[13px] font-medium text-[#F2F3F5] ${TRANS} hover:border-[#3A3E47] hover:bg-[#22262D] disabled:pointer-events-none disabled:opacity-60`}
          >
            {sourcingEnCours ? (
              <Loader2 size={14} className="animate-spin text-[#9CA3AF]" aria-hidden />
            ) : (
              <Radar size={14} className="text-[#9CA3AF]" aria-hidden />
            )}
            {sourcingEnCours ? "Sourcing…" : "Sourcer"}
          </button>
        </div>
      </header>

      {/* ── KPI (2x2 sous 768px, 4 colonnes au-delà) ── */}
      <section aria-label="Indicateurs" className="mt-8 grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard label="Sourcés" value={kpis.sources.value} sub={kpis.sources.sub} />
        <KpiCard label="Qualifiés" value={kpis.qualifies.value} sub={kpis.qualifies.sub} />
        <KpiCard label="Envoyés" value={kpis.envoyes.value} sub={kpis.envoyes.sub} />
        <KpiCard
          label="Réponses"
          value={kpis.reponses.value}
          sub={kpis.reponses.sub}
          highlight
        />
      </section>

      {/* ── File de validation ── */}
      <section className="mt-10">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <h2 className="text-[15px] font-medium text-[#F2F3F5]">File de validation</h2>
            <span className="rounded-full border-[0.5px] border-[#2A2D34] bg-[#1C1F25] px-2 py-0.5 text-[11px] tabular-nums text-[#9CA3AF]">
              {file.length} en attente
            </span>
          </div>
          <button
            type="button"
            onClick={toutValider}
            disabled={file.length === 0}
            className={`inline-flex h-8 items-center gap-1.5 rounded-[8px] bg-[#1D9E75] px-3.5 text-[13px] font-medium text-[#0B1612] ${TRANS} hover:bg-[#5DCAA5] disabled:pointer-events-none disabled:opacity-40`}
          >
            <CheckCheck size={15} aria-hidden />
            Tout valider
          </button>
        </div>

        {/* key={agent} : les anneaux se réaniment au switch d'agent */}
        <div key={agent} className="mt-4 flex flex-col gap-2.5">
          {file.length === 0 ? (
            <div className="flex flex-col items-center gap-1.5 rounded-[11px] border-[0.5px] border-dashed border-[#2A2D34] px-6 py-12 text-center">
              <CircleCheck size={18} className="text-[#1D9E75]" aria-hidden />
              <p className="mt-1 text-[13px] text-[#F2F3F5]">File de validation vide</p>
              <p className="text-[12px] text-[#6B7280]">
                Tous les brouillons de cet agent ont été traités. Lance un sourcing pour
                alimenter la file.
              </p>
            </div>
          ) : (
            file.map((p, i) => (
              <ProspectCard
                key={p.id}
                prospect={p}
                index={i}
                onValider={() => valider(p)}
                onEditer={() => editer(p)}
                onRejeter={() => rejeter(p)}
              />
            ))
          )}
        </div>
      </section>

      {/* ── Prospects sourcés (données réelles Google Places) ── */}
      <section className="mt-10">
        <div className="flex items-center gap-2.5">
          <h2 className="text-[15px] font-medium text-[#F2F3F5]">Prospects sourcés</h2>
          <span className="rounded-full border-[0.5px] border-[#2A2D34] bg-[#1C1F25] px-2 py-0.5 text-[11px] tabular-nums text-[#9CA3AF]">
            {totalProspects}
          </span>
        </div>

        <div className="mt-4">
          {chargementListe ? (
            <div className="flex items-center gap-2 rounded-[11px] border-[0.5px] border-[#2A2D34] bg-[#1C1F25] px-4 py-6 text-[13px] text-[#6B7280]">
              <Loader2 size={14} className="animate-spin" aria-hidden />
              Chargement des prospects…
            </div>
          ) : prospects.length === 0 ? (
            <div className="flex flex-col items-center gap-1.5 rounded-[11px] border-[0.5px] border-dashed border-[#2A2D34] px-6 py-12 text-center">
              <Radar size={18} className="text-[#6B7280]" aria-hidden />
              <p className="mt-1 text-[13px] text-[#F2F3F5]">Aucun prospect sourcé</p>
              <p className="text-[12px] text-[#6B7280]">
                Lance un sourcing pour alimenter la liste depuis Google Places.
              </p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-[11px] border-[0.5px] border-[#2A2D34] bg-[#1C1F25]">
              {prospects.map((p) => (
                <div
                  key={p.id}
                  className={`flex items-center justify-between gap-4 border-t-[0.5px] border-[#2A2D34] px-4 py-3 first:border-t-0 ${TRANS} hover:bg-[#22262D]`}
                >
                  <div className="min-w-0">
                    <p className="truncate text-[14px] font-medium text-[#F2F3F5]">
                      {p.nom}
                    </p>
                    <p className="mt-0.5 text-[12px] text-[#6B7280]">
                      {p.ville ?? "Ville inconnue"}
                      {p.noteGoogle != null && <> · {formatNote(p.noteGoogle)} ★</>}
                      {p.nbAvis != null && <> · {p.nbAvis} avis</>}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <span className="rounded-full border-[0.5px] border-[#2A2D34] px-2 py-0.5 text-[11px] text-[#9CA3AF]">
                      {LIBELLES_STATUT[p.statut] ?? p.statut}
                    </span>
                    <span className="text-[11px] tabular-nums text-[#6B7280]">
                      {formatDateSourcing(p.createdAt)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      <p className="mt-12 border-t-[0.5px] border-[#2A2D34] pt-4 text-[12px] text-[#6B7280]">
        KPI et file de validation : données de démonstration (scoring et emails à
        l’étape 3). Liste des prospects sourcés : données réelles Google Places.
      </p>
    </div>
  );
}
