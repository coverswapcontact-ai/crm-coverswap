"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ChevronDown, Inbox, NotebookPen, Phone, Plus, Send, Sparkles, Zap } from "lucide-react";
import { toast } from "sonner";
import { CATALOGUE_MESSAGES } from "@/lib/messagerie/catalogue";
import { classerMessage } from "@/lib/messagerie/regles";
import type { OuEnEst } from "@/lib/messagerie/types";
import type { ElementFil, MessageVue } from "@/lib/messagerie/vues";
import { cn } from "@/lib/utils";
import { appelApi, envoyerJson, messageErreur } from "@/components/pilotage/client";
import { rafraichirCompteurs } from "@/components/pilotage/evenements";
import { noterDebutAppel } from "@/components/pilotage/NotesAppel";
import { TRANS } from "@/components/pilotage/ui";
import { CarteMessage, heureLisible } from "./CarteMessage";
import { FeuilleNote, FeuilleOutils, FeuilleReponseClient } from "./Feuilles";
import { OuEnEstEtJournal, type LigneJournalVue } from "./OuEnEst";

/**
 * Mission 25 — la conversation d'un client, comme Messages sur iPhone : tous les canaux dans l'ordre où ils sont
 * arrivés (bulles du client à gauche, les miennes à droite aux couleurs de CoverSwap, libellé SMS / Espace / Mail),
 * mails repliés, appels, notes et étapes en lignes grises, message prêt en bulle pointillée (Ouvrir Messages, puis ✅
 * Envoyé), message programmé en bulle pâle. En tête : nom, « Où on en est », « À toi » / « Au client », Appeler. En
 * bas : canal, ⚡ réponses rapides, ✨ rédiger avec l'IA, 📥 réponse du client, 📝 note, « + » outils.
 */

export type DetailConversation = {
  suivi: {
    id: string;
    nom: string;
    telephone: string | null;
    email: string | null;
    ville: string | null;
    dossierId: string | null;
    leadId: string | null;
    etape: string | null;
    main: string | null;
    pauseJusquau: string | null;
    pauseMotif: string | null;
    stop: boolean;
    archive: boolean;
  };
  ouEnEst: OuEnEst | null;
  journal: LigneJournalVue[];
  prochaineAction: string | null;
  fil: ElementFil[];
};

const RAPIDES = CATALOGUE_MESSAGES.filter((m) => m.groupe === "RAPIDES");

const etiquetteCanal = (canal: string) => (canal === "ESPACE" ? "Espace" : canal === "MAIL" ? "Mail" : "SMS");

function Bulle({ element }: { element: Extract<ElementFil, { genre: "BULLE" }> }) {
  const client = element.sens === "CLIENT";
  return (
    <div className={cn("flex", client ? "justify-start" : "justify-end")}>
      <div className="max-w-[85%]">
        <p className={cn("rounded-[18px] px-3.5 py-2 text-[16px] leading-snug whitespace-pre-wrap", client ? "rounded-bl-[6px] bg-surface-2 text-texte" : "rounded-br-[6px] bg-action text-action-texte")}>{element.texte}</p>
        <p className={cn("mt-0.5 text-[11.5px] text-texte-3", client ? "pl-2" : "pr-2 text-right")}>
          {etiquetteCanal(element.canal)}
          {element.code ? ` · ${element.code}` : ""}
          {element.etat ? ` · ${element.etat}` : ""} · {heureLisible(element.le)}
        </p>
      </div>
    </div>
  );
}

function Mail({ element }: { element: Extract<ElementFil, { genre: "MAIL" }> }) {
  const [ouvert, setOuvert] = useState(false);
  const client = element.sens === "CLIENT";
  return (
    <div className={cn("flex", client ? "justify-start" : "justify-end")}>
      <button type="button" onClick={() => setOuvert((o) => !o)} aria-expanded={ouvert} className={cn("max-w-[85%] rounded-[14px] border-[0.5px] border-trait bg-surface px-3 py-2 text-left", TRANS)}>
        <span className="flex items-center gap-1.5 text-[13px] font-medium text-texte-2">
          ✉️ {element.objet}
          <ChevronDown size={14} aria-hidden className={cn("transition-transform duration-150", ouvert && "rotate-180")} />
        </span>
        <span className={cn("mt-0.5 block text-[14px] text-texte-3", !ouvert && "line-clamp-1")}>{element.extrait}</span>
        <span className="mt-0.5 block text-[11.5px] text-texte-3">Mail · {heureLisible(element.le)}</span>
      </button>
    </div>
  );
}

export function Conversation({ suiviId, onRetour, onChange }: { suiviId: string; onRetour?: () => void; onChange?: () => void }) {
  const [detail, setDetail] = useState<DetailConversation | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [texte, setTexte] = useState("");
  const [canal, setCanal] = useState<"SMS" | "ESPACE" | "MAIL" | null>(null);
  const [rapidesOuvertes, setRapidesOuvertes] = useState(false);
  const [feuille, setFeuille] = useState<"REPONSE" | "NOTE" | "OUTILS" | null>(null);
  const [occupe, setOccupe] = useState(false);
  const bas = useRef<HTMLDivElement>(null);

  const charger = useCallback(async () => {
    try {
      const lu = await appelApi<DetailConversation>(`/api/messagerie/conversations/${suiviId}`);
      setDetail(lu);
      setErreur(null);
    } catch (e) {
      setErreur(messageErreur(e));
    }
  }, [suiviId]);

  useEffect(() => {
    void charger();
    void envoyerJson(`/api/messagerie/conversations/${suiviId}`, "POST", { action: "lu" }).then(() => onChange?.()).catch(() => undefined);
    const relire = () => {
      if (document.visibilityState === "visible") void charger();
    };
    document.addEventListener("visibilitychange", relire);
    const minuterie = window.setInterval(relire, 30_000);
    return () => {
      document.removeEventListener("visibilitychange", relire);
      window.clearInterval(minuterie);
    };
  }, [charger, suiviId, onChange]);

  useEffect(() => {
    bas.current?.scrollIntoView({ block: "end" });
  }, [detail?.fil.length]);

  const apresGeste = useCallback(() => {
    void charger();
    onChange?.();
    rafraichirCompteurs();
  }, [charger, onChange]);

  // Les outils les plus probables au-dessus du clavier, d'après le dernier message du client.
  const suggestions = useMemo(() => {
    const dernier = [...(detail?.fil ?? [])].reverse().find((e) => e.genre === "BULLE" && e.sens === "CLIENT") as Extract<ElementFil, { genre: "BULLE" }> | undefined;
    if (!dernier) return [];
    const classe = classerMessage(dernier.texte);
    if (classe === "PRIX" || classe === "TROP_CHER") return ["Devis"];
    if (classe === "DISPONIBILITES") return ["Rappel"];
    if (classe === "VISITE") return ["Visite"];
    if (classe === "LIEN_PERDU") return ["Lien"];
    return [];
  }, [detail?.fil]);

  async function preparerLibre(code?: string) {
    setOccupe(true);
    try {
      await envoyerJson<{ message: MessageVue }>(`/api/messagerie/conversations/${suiviId}`, "POST", { action: "libre", ...(code ? { code } : { texte }), ...(canal ? { canal } : {}) });
      setTexte("");
      setRapidesOuvertes(false);
      apresGeste();
    } catch (e) {
      toast.error(messageErreur(e));
    } finally {
      setOccupe(false);
    }
  }

  async function redigerAvecIa() {
    setOccupe(true);
    try {
      const r = await envoyerJson<{ texte: string | null; raison: string | null }>(`/api/messagerie/conversations/${suiviId}`, "POST", { action: "rediger" });
      if (r.texte) setTexte(r.texte);
      else toast.info(r.raison ?? "L'IA n'a rien proposé : prends une réponse rapide.");
    } catch (e) {
      toast.error(messageErreur(e));
    } finally {
      setOccupe(false);
    }
  }

  if (erreur) return <p className="p-4 text-[14px] text-retard-texte">{erreur}</p>;
  if (!detail) return <p className="p-4 text-[14px] text-texte-3">Chargement…</p>;
  const { suivi } = detail;
  const telephone = suivi.telephone;
  const lienFiche = suivi.dossierId ? `/dossiers?dossier=${suivi.dossierId}` : suivi.leadId ? `/leads?lead=${suivi.leadId}` : null;
  const canalAuto = suivi.stop ? null : telephone && /^\+33[67]/.test(telephone) ? "SMS" : suivi.dossierId ? "ESPACE" : suivi.email ? "MAIL" : null;
  const canalAffiche = canal ?? canalAuto;
  const mainLibelle = suivi.main === "CLIENT" ? "Au client" : suivi.main === "MOI" ? "À toi" : null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="shrink-0 border-b-[0.5px] border-trait bg-fond px-3 pt-2 pb-2">
        <div className="flex items-center gap-2">
          {onRetour ? (
            <button type="button" onClick={onRetour} aria-label="Retour à la liste" className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-[10px] text-texte-2 hover:text-texte md:hidden", TRANS)}>
              <ArrowLeft size={20} aria-hidden />
            </button>
          ) : null}
          <div className="min-w-0 flex-1">
            {lienFiche ? (
              <a href={lienFiche} className="block truncate text-[18px] font-semibold text-texte hover:underline">
                {suivi.nom}
              </a>
            ) : (
              <p className="truncate text-[18px] font-semibold text-texte">{suivi.nom}</p>
            )}
            <p className="text-[12.5px] text-texte-3">
              {[suivi.ville, mainLibelle, suivi.stop ? "STOP" : null, suivi.pauseJusquau ? `relances en pause jusqu'au ${new Date(suivi.pauseJusquau).toLocaleDateString("fr-FR", { timeZone: "Europe/Paris", day: "2-digit", month: "2-digit" })}` : null].filter(Boolean).join(" · ")}
            </p>
          </div>
          {telephone ? (
            <a
              href={`tel:${telephone}`}
              onClick={() => noterDebutAppel(suivi.leadId ?? `dossier:${suivi.dossierId}`, { nom: suivi.nom, dossierId: suivi.dossierId })}
              className={cn("flex h-11 shrink-0 items-center gap-1.5 rounded-[10px] bg-action px-3 text-[14px] font-semibold text-action-texte hover:bg-action-clair", TRANS)}
            >
              <Phone size={16} aria-hidden /> Appeler
            </a>
          ) : null}
        </div>
      </header>

      <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto px-3 py-3">
        <OuEnEstEtJournal key={detail.ouEnEst?.le ?? "vide"} suiviId={suivi.id} ouEnEst={detail.ouEnEst} journal={detail.journal} lienHistorique={lienFiche ? `${lienFiche}${suivi.dossierId ? "&rubrique=historique" : ""}` : null} onCorrige={() => apresGeste()} />
        {detail.fil.length === 0 ? <p className="py-6 text-center text-[14px] text-texte-3">Aucun échange pour l&apos;instant.</p> : null}
        {detail.fil.map((element) =>
          element.genre === "BULLE" ? (
            <Bulle key={element.id} element={element} />
          ) : element.genre === "MAIL" ? (
            <Mail key={element.id} element={element} />
          ) : element.genre === "LIGNE" ? (
            <p key={element.id} className="px-6 text-center text-[12.5px] text-texte-3">
              {element.texte} · {heureLisible(element.le)}
            </p>
          ) : (
            <div key={element.id} className="flex justify-end">
              <div className="w-full max-w-[92%]">
                <CarteMessage message={element.message} nom={suivi.nom} onChange={() => apresGeste()} compacte />
              </div>
            </div>
          )
        )}
        <div ref={bas} />
      </div>

      <footer className="shrink-0 border-t-[0.5px] border-trait bg-fond px-2 pt-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))]">
        {suggestions.length ? (
          <div className="mb-1.5 flex gap-1.5 overflow-x-auto px-1">
            {suggestions.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => (s === "Devis" && suivi.dossierId ? (window.location.href = `/dossiers?dossier=${suivi.dossierId}&rubrique=devis`) : s === "Visite" ? void preparerLibre("Q5") : setFeuille("OUTILS"))}
                className={cn("min-h-[36px] shrink-0 rounded-full border-[0.5px] border-action/50 px-3 text-[13px] text-action-clair", TRANS)}
              >
                {s === "Devis" ? "📄 Devis" : s === "Rappel" ? "⏰ Rappel" : s === "Visite" ? "📍 Proposer une visite" : "🔗 Lien de l'espace"}
              </button>
            ))}
          </div>
        ) : null}
        {rapidesOuvertes ? (
          <div className="mb-2 max-h-56 space-y-1 overflow-y-auto rounded-[12px] border-[0.5px] border-trait bg-surface p-1.5">
            {RAPIDES.map((r) => (
              <button key={r.code} type="button" disabled={occupe} onClick={() => preparerLibre(r.code)} className={cn("block min-h-[44px] w-full rounded-[10px] px-2.5 py-2 text-left text-[14px] text-texte-2 hover:bg-surface-2", TRANS)}>
                <span className="text-texte-3">{r.code} · </span>
                {r.textes.defaut.replace("{creneau_1}", "…").replace("{creneau_2}", "…")}
              </button>
            ))}
          </div>
        ) : null}
        <div className="flex items-center gap-1 px-1 pb-1.5">
          <button type="button" onClick={() => setFeuille("OUTILS")} aria-label="Outils" className={cn("flex h-11 w-11 items-center justify-center rounded-full bg-surface-2 text-texte-2 hover:text-texte", TRANS)}>
            <Plus size={20} aria-hidden />
          </button>
          <button type="button" onClick={() => setRapidesOuvertes((o) => !o)} aria-label="Réponses rapides" aria-expanded={rapidesOuvertes} className={cn("flex h-11 items-center gap-1 rounded-[10px] px-2 text-[13px] text-texte-2 hover:text-texte", TRANS)}>
            <Zap size={16} aria-hidden /> Rapides
          </button>
          <button type="button" disabled={occupe} onClick={redigerAvecIa} aria-label="Rédiger avec l'IA" className={cn("flex h-11 items-center gap-1 rounded-[10px] px-2 text-[13px] text-texte-2 hover:text-texte", TRANS)}>
            <Sparkles size={16} aria-hidden /> IA
          </button>
          <button type="button" onClick={() => setFeuille("REPONSE")} className={cn("flex h-11 items-center gap-1 rounded-[10px] px-2 text-[13px] text-texte-2 hover:text-texte", TRANS)}>
            <Inbox size={16} aria-hidden /> Sa réponse
          </button>
          <button type="button" onClick={() => setFeuille("NOTE")} className={cn("flex h-11 items-center gap-1 rounded-[10px] px-2 text-[13px] text-texte-2 hover:text-texte", TRANS)}>
            <NotebookPen size={16} aria-hidden /> Note
          </button>
        </div>
        <div className="flex items-end gap-2 px-1">
          <select
            value={canalAffiche ?? ""}
            onChange={(e) => setCanal((e.target.value || null) as typeof canal)}
            aria-label="Canal"
            className="h-11 shrink-0 rounded-[10px] border-[0.5px] border-trait bg-surface px-2 text-[14px] text-texte-2"
          >
            {canalAuto === null && !canal ? <option value="">—</option> : null}
            <option value="SMS">SMS</option>
            <option value="ESPACE">Espace</option>
            <option value="MAIL">Mail</option>
          </select>
          <textarea
            value={texte}
            onChange={(e) => setTexte(e.target.value)}
            rows={1}
            placeholder={suivi.stop ? "STOP : plus de SMS" : "Écris ou dicte ton message"}
            aria-label="Message"
            className="max-h-36 min-h-[44px] flex-1 resize-none rounded-[20px] border-[0.5px] border-trait bg-surface px-3.5 py-2.5 text-[16px] text-texte focus:border-action focus:outline-none"
          />
          <button type="button" disabled={!texte.trim() || occupe} onClick={() => preparerLibre()} aria-label="Préparer le message" className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-action text-action-texte disabled:opacity-40", TRANS)}>
            <Send size={18} aria-hidden />
          </button>
        </div>
      </footer>

      <FeuilleReponseClient suiviId={suivi.id} nom={suivi.nom} ouverte={feuille === "REPONSE"} onFermer={() => setFeuille(null)} onFait={apresGeste} />
      <FeuilleNote suiviId={suivi.id} nom={suivi.nom} ouverte={feuille === "NOTE"} onFermer={() => setFeuille(null)} onFait={apresGeste} />
      <FeuilleOutils
        suiviId={suivi.id}
        nom={suivi.nom}
        telephone={telephone}
        dossierId={suivi.dossierId}
        leadId={suivi.leadId}
        ouverte={feuille === "OUTILS"}
        onFermer={() => setFeuille(null)}
        onTexte={(t) => setTexte((avant) => (avant.trim() ? `${avant.trim()} ${t}` : t))}
        onPrepare={() => apresGeste()}
        onNote={() => setFeuille("NOTE")}
        onFait={apresGeste}
      />
    </div>
  );
}
