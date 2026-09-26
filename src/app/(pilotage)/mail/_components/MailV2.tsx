"use client";

import { useState } from "react";
import { AlarmClock, CalendarPlus, Check, Pencil, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { envoyerJson, messageErreur } from "@/components/pilotage/client";
import { Bouton, CLASSE_SAISIE, Pastille, TRANS } from "@/components/pilotage/ui";
import type { DetailMail } from "@/lib/mail/detail";
import { INTENTIONS, LIBELLES_INTENTION } from "@/lib/mail/intentions";
import { cn } from "@/lib/utils";

/**
 * Mail v2 (mission 9) : ce que Claude a écrit sur le mail, et ce que Lucas en
 * fait au pouce — intention et attendu (corrigeables), résumé de fil, cartes
 * de mise à jour (valider / ignorer), dates extraites (Planifier pré-rempli),
 * remise à plus tard, brouillon déposé (Reprendre → Envoyer).
 */

const TON_INTENTION: Record<string, "ambre" | "bleu" | "neutre"> = { REPONSE: "ambre", ACTION: "bleu", INFORMATION: "neutre" };
const quand = (iso: string) => new Date(iso).toLocaleString("fr-FR", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export function BlocIntention({ detail, onChange }: { detail: DetailMail; onChange: () => void }) {
  const [edition, setEdition] = useState(false);
  const [intention, setIntention] = useState(detail.intention ?? "NON_CLASSE");
  const [attendu, setAttendu] = useState(detail.attendu ?? "");
  const [occupe, setOccupe] = useState(false);

  async function enregistrer() {
    setOccupe(true);
    try {
      await envoyerJson(`/api/mail/${detail.messageId}/intention`, "POST", { intention, attendu: attendu.trim() || null });
      toast.success("Intention enregistrée");
      setEdition(false);
      onChange();
    } catch (erreur) {
      toast.error(messageErreur(erreur));
    } finally {
      setOccupe(false);
    }
  }

  if (edition) {
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-[10px] border-[0.5px] border-[#2A2D34] bg-[#1C1F25] p-2.5">
        <select value={intention} onChange={(e) => setIntention(e.target.value)} className={cn(CLASSE_SAISIE, "w-auto")} aria-label="Intention">
          <option value="NON_CLASSE">Non classé</option>
          {INTENTIONS.map((i) => (
            <option key={i} value={i}>
              {LIBELLES_INTENTION[i]}
            </option>
          ))}
        </select>
        <input value={attendu} onChange={(e) => setAttendu(e.target.value)} maxLength={300} placeholder="Ce qui est attendu (« Il demande le délai de pose »)" className={cn(CLASSE_SAISIE, "min-w-[220px] flex-1")} aria-label="Ce qui est attendu" />
        <Bouton taille="sm" variante="primaire" chargement={occupe} onClick={() => void enregistrer()} icone={<Check size={13} aria-hidden />}>
          Enregistrer
        </Bouton>
        <Bouton taille="sm" variante="fantome" onClick={() => setEdition(false)} icone={<X size={13} aria-hidden />}>
          Annuler
        </Bouton>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
      {detail.intention ? <Pastille ton={TON_INTENTION[detail.intention] ?? "neutre"}>{LIBELLES_INTENTION[detail.intention as keyof typeof LIBELLES_INTENTION] ?? detail.intention}</Pastille> : <Pastille ton="neutre">Non classé</Pastille>}
      {detail.attendu ? <span className="text-[#E5E7EB]">{detail.attendu}</span> : detail.intention ? null : <span className="text-[#8B919C]">Dites à Claude « classe mes mails », ou classez-le ici.</span>}
      {detail.intentionPar ? <span className="text-[11px] text-[#6B7280]">{detail.intentionPar.startsWith("ASSISTANT") ? "par Claude" : "par vous"}</span> : null}
      <button type="button" onClick={() => setEdition(true)} className={cn("inline-flex h-11 sm:h-7 items-center gap-1 rounded-[7px] px-1.5 text-[12px] text-[#9CA3AF] hover:bg-[#22262D] hover:text-[#F2F3F5]", TRANS)}>
        <Pencil size={12} aria-hidden /> {detail.intention ? "Corriger" : "Classer"}
      </button>
    </div>
  );
}

export function BlocResume({ resume }: { resume: NonNullable<DetailMail["resume"]> }) {
  return (
    <div className="rounded-[10px] border-[0.5px] border-[#2A2D34] bg-[#1C1F25] p-3">
      <p className="flex flex-wrap items-center gap-2 text-[11.5px] tracking-wide text-[#8B919C] uppercase">
        Résumé du fil
        <span className="normal-case tracking-normal">{resume.par?.startsWith("ASSISTANT") ? "par Claude" : "par vous"} · {quand(resume.le)}</span>
        {resume.perime ? <Pastille ton="ambre">De nouveaux messages depuis</Pastille> : null}
      </p>
      <p className="mt-1.5 text-[13.5px] leading-relaxed whitespace-pre-wrap text-[#E5E7EB]">{resume.resume}</p>
      {resume.pointsEnSuspens.length ? (
        <ul className="mt-2 list-disc space-y-0.5 pl-4 text-[12.5px] text-[#D1D5DB]">
          {resume.pointsEnSuspens.map((p, i) => (
            <li key={i}>
              {p.texte}
              {p.date ? <span className="text-[#8B919C]"> · {new Date(`${p.date}T12:00:00`).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function CartesPropositions({ propositions, onChange }: { propositions: DetailMail["propositions"]; onChange: () => void }) {
  const [occupe, setOccupe] = useState<string | null>(null);
  if (!propositions.length) return null;

  async function decider(id: string, action: "valider" | "ignorer", sensible: boolean, titre: string) {
    if (action === "valider" && sensible && !window.confirm(`Appliquer « ${titre} » ? (montant, adresse ou date de chantier : cette modification engage le dossier)`)) return;
    setOccupe(id);
    try {
      const { proposition } = await envoyerJson<{ proposition: { statut: string; erreurExecution: string | null } }>(`/api/mail/propositions/${id}`, "POST", action === "valider" ? { action } : { action, motif: "INUTILE" });
      if (action === "valider" && proposition.statut !== "EXECUTEE") toast.error("Pas appliquée", { description: proposition.erreurExecution ?? proposition.statut });
      else toast.success(action === "valider" ? "Appliquée : le dossier est à jour" : "Ignorée");
      onChange();
    } catch (erreur) {
      toast.error(messageErreur(erreur));
    } finally {
      setOccupe(null);
    }
  }

  return (
    <section aria-label="Ce que ce mail change" className="space-y-2">
      <p className="text-[11.5px] tracking-wide text-[#8B919C] uppercase">Ce que ce mail change · {propositions.length} carte{propositions.length > 1 ? "s" : ""} à valider</p>
      {propositions.map((p) => (
        <div key={p.id} className={cn("rounded-[10px] border-[0.5px] p-3", p.sensible ? "border-[#EF9F27]/40 bg-[#EF9F27]/[0.06]" : "border-[#2A2D34] bg-[#1C1F25]")}>
          <p className="flex flex-wrap items-center gap-2 text-[13.5px] font-medium text-[#F2F3F5]">
            {p.titre}
            {p.sensible ? <Pastille ton="ambre">Sensible</Pastille> : null}
          </p>
          {p.resume ? <p className="mt-1 text-[12.5px] leading-relaxed text-[#9CA3AF]">{p.resume}</p> : null}
          {p.erreurExecution ? <p className="mt-1 text-[12px] text-[#F87171]">{p.erreurExecution}</p> : null}
          <div className="mt-2 flex gap-1.5">
            <Bouton taille="sm" variante="primaire" className="h-11 sm:h-8" chargement={occupe === p.id} onClick={() => void decider(p.id, "valider", p.sensible, p.titre)} icone={<Check size={13} aria-hidden />}>
              Valider
            </Bouton>
            <Bouton taille="sm" variante="fantome" className="h-11 sm:h-8" disabled={occupe === p.id} onClick={() => void decider(p.id, "ignorer", false, p.titre)} icone={<X size={13} aria-hidden />}>
              Ignorer
            </Bouton>
          </div>
        </div>
      ))}
    </section>
  );
}

export function DatesExtraites({ messageId, dates, onChange }: { messageId: string; dates: DetailMail["datesExtraites"]; onChange: () => void }) {
  const [occupe, setOccupe] = useState<number | null>(null);
  if (!dates.length) return null;

  async function planifier(i: number) {
    const d = dates[i];
    const action = window.prompt("Quelle action ?", d.nature === "ECHEANCE" ? "Échéance à honorer" : "Rappeler");
    if (!action?.trim()) return;
    setOccupe(i);
    try {
      const r = await envoyerJson<{ texte: string }>(`/api/mail/${messageId}/planifier`, "POST", { date: d.date, heure: d.heure ?? undefined, action: action.trim() });
      toast.success("Planifié", { description: r.texte });
      onChange();
    } catch (erreur) {
      toast.error(messageErreur(erreur));
    } finally {
      setOccupe(null);
    }
  }

  return (
    <ul className="space-y-1.5">
      {dates.map((d, i) => (
        <li key={`${d.date}-${i}`} className="flex flex-wrap items-center justify-between gap-2 rounded-[10px] border-[0.5px] border-[#2A2D34] bg-[#1C1F25] px-3 py-2 text-[12.5px]">
          <span className="min-w-0">
            <span className="font-medium text-[#F2F3F5] tabular-nums">
              {new Date(`${d.date}T12:00:00`).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" })}
              {d.heure ? ` ${d.heure}` : ""}
            </span>
            <span className="ml-2 text-[#8B919C]">{d.nature === "ECHEANCE" ? "échéance" : "disponibilité"} · « {d.passage} »</span>
          </span>
          <Bouton taille="sm" variante="secondaire" className="h-11 sm:h-8" chargement={occupe === i} onClick={() => void planifier(i)} icone={<CalendarPlus size={13} aria-hidden />}>
            Planifier
          </Bouton>
        </li>
      ))}
    </ul>
  );
}

const CHOIX_SNOOZE: { libelle: string; quand: string }[] = [
  { libelle: "Demain 9 h", quand: "demain 9h" },
  { libelle: "Lundi 9 h", quand: "lundi prochain 9h" },
  { libelle: "Dans une semaine", quand: "dans une semaine" },
];

export function BoutonSnooze({ messageId, snoozeJusqua, onChange }: { messageId: string; snoozeJusqua: string | null; onChange: () => void }) {
  const [ouvert, setOuvert] = useState(false);
  const [occupe, setOccupe] = useState(false);

  async function envoyer(corps: { quand: string } | { annuler: true }) {
    setOccupe(true);
    try {
      const r = await envoyerJson<{ jusqua: string | null }>(`/api/mail/${messageId}/snooze`, "POST", corps);
      toast.success(r.jusqua ? `Remis au ${quand(r.jusqua)}` : "Remise à plus tard annulée");
      setOuvert(false);
      onChange();
    } catch (erreur) {
      toast.error(messageErreur(erreur));
    } finally {
      setOccupe(false);
    }
  }

  const actif = snoozeJusqua && new Date(snoozeJusqua) > new Date();
  return (
    <span className="relative">
      <Bouton taille="sm" variante={actif ? "primaire" : "secondaire"} className="h-11 sm:h-8" disabled={occupe} onClick={() => (actif ? void envoyer({ annuler: true }) : setOuvert((o) => !o))} icone={<AlarmClock size={14} aria-hidden />}>
        {actif ? `Remis au ${quand(snoozeJusqua)} · annuler` : "Plus tard"}
      </Bouton>
      {ouvert && !actif ? (
        <span className="absolute left-0 z-10 mt-1 flex w-[220px] flex-col rounded-[10px] border-[0.5px] border-[#2A2D34] bg-[#1C1F25] p-1 shadow-lg">
          {CHOIX_SNOOZE.map((c) => (
            <button key={c.quand} type="button" onClick={() => void envoyer({ quand: c.quand })} className={cn("rounded-[7px] px-2.5 py-2 text-left text-[13px] text-[#E5E7EB] hover:bg-[#22262D]", TRANS)}>
              {c.libelle}
            </button>
          ))}
          <button
            type="button"
            onClick={() => {
              const quandDit = window.prompt("Quand ? (« vendredi 14h », « 2026-10-01 09:00 », « dans 3 jours »)");
              if (quandDit?.trim()) void envoyer({ quand: quandDit.trim() });
            }}
            className={cn("rounded-[7px] px-2.5 py-2 text-left text-[13px] text-[#9CA3AF] hover:bg-[#22262D]", TRANS)}
          >
            Une autre date…
          </button>
        </span>
      ) : null}
    </span>
  );
}

export type BrouillonRepris = { id: string; a: string | null; objet: string; texte: string };

export function BrouillonsDeposes({ brouillons, onReprendre }: { brouillons: DetailMail["brouillons"]; onReprendre: (b: BrouillonRepris) => void }) {
  const prets = brouillons.filter((b) => b.statut === "BROUILLON" && b.source === "ASSISTANT" && b.texte);
  if (!prets.length) return null;
  return (
    <section aria-label="Brouillon déposé par Claude" className="space-y-2">
      {prets.map((b) => (
        <div key={b.id} className="rounded-[10px] border-[0.5px] border-[#1D9E75]/35 bg-[#112B22]/40 p-3">
          <p className="flex flex-wrap items-center gap-2 text-[12px] text-[#5DCAA5]">
            <Sparkles size={13} aria-hidden /> Brouillon déposé par Claude · {quand(b.createdAt)}
            {b.manques.length ? <Pastille ton="ambre">{b.manques[0]}</Pastille> : null}
          </p>
          {b.objet ? <p className="mt-1 text-[13px] font-medium text-[#F2F3F5]">{b.objet}</p> : null}
          <p className="mt-1 line-clamp-6 text-[13px] leading-relaxed whitespace-pre-wrap text-[#E5E7EB]">{b.texte}</p>
          <Bouton taille="sm" variante="primaire" className="mt-2 h-11 sm:h-8" onClick={() => onReprendre({ id: b.id, a: null, objet: b.objet ?? "", texte: b.texte ?? "" })}>
            Reprendre dans la réponse
          </Bouton>
        </div>
      ))}
    </section>
  );
}
