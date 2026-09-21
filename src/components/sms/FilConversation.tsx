"use client";

import Link from "next/link";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ArrowLeft, Check, CheckCheck, Clock, FileText, Link2, ListChecks, Loader2, MessageSquareText, PanelRight, Phone, RotateCcw, SendHorizontal, StickyNote, WifiOff } from "lucide-react";
import { toast } from "sonner";
import type { ConversationResume, ElementFil } from "@/lib/sms/conversations";
import type { ContexteConversation } from "@/lib/sms/contexte";
import type { Suggestion } from "@/lib/sms/suggestions";
import { LIBELLES_ETAPE, LIBELLES_TYPE_EVENEMENT, type EtapeDossier, type TypeEvenement } from "@/lib/dossiers/constants";
import { ISSUES_APPEL, LIBELLES_ISSUE, type IssueAppel, type SuiteAppel } from "@/lib/commercial/constantes";
import { mesurerSms, simplifierPourGsm } from "@/lib/sms/texte";
import { appelApi, envoyerJson, messageErreur } from "@/components/pilotage/client";
import { Bouton, Modale, Puces, TRANS, ZoneTexte } from "@/components/pilotage/ui";
import { cn } from "@/lib/utils";
import { RelancesProposees } from "./RelancesProposees";

/** Un SMS du fil, avec ce que seul l'écran sait : il n'a pas encore rejoint le serveur. */
export type ElementAffiche = ElementFil & { local?: "EN_COURS" | "HORS_LIGNE" };

export type DemandeEnvoi = { texte: string; modele: string | null; textePropose: string | null };

const ETAPES_RAPIDES: EtapeDossier[] = ["QUALIFICATION", "SIMULATION", "DEVIS_ENVOYE", "RELANCE", "EN_PAUSE"];

function jourDuFil(iso: string): string {
  const date = new Date(iso);
  const aujourdhui = new Date();
  const ecart = Math.floor((new Date(aujourdhui.toDateString()).getTime() - new Date(date.toDateString()).getTime()) / 86_400_000);
  if (ecart === 0) return "Aujourd'hui";
  if (ecart === 1) return "Hier";
  return date.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
}

const heure = (iso: string) => new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });

function EtatEnvoi({ element, onReessayer }: { element: ElementAffiche & { genre: "SMS" }; onReessayer: () => void }) {
  if (element.local === "HORS_LIGNE") {
    return (
      <span className="inline-flex items-center gap-1 text-[#F5B454]">
        <WifiOff size={11} aria-hidden /> En attente du réseau
      </span>
    );
  }
  if (element.local === "EN_COURS" || element.statut === "A_ENVOYER") {
    return (
      <span className="inline-flex items-center gap-1 text-[#8B919C]">
        <Clock size={11} aria-hidden /> Envoi…
      </span>
    );
  }
  if (element.statut === "ECHEC") {
    return (
      <button type="button" onClick={onReessayer} className="inline-flex items-center gap-1 text-[#F87171] underline-offset-2 hover:underline">
        <AlertTriangle size={11} aria-hidden /> Échec — réessayer
      </button>
    );
  }
  if (element.statut === "DELIVRE") {
    return (
      <span className="inline-flex items-center gap-1 text-[#5DCAA5]">
        <CheckCheck size={12} aria-hidden /> Délivré
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[#8B919C]">
      <Check size={12} aria-hidden /> Envoyé
    </span>
  );
}

export function FilConversation({
  conversation,
  elements,
  contexte,
  chargement,
  fournisseurPret,
  onRetour,
  onContexte,
  onEnvoyer,
  onReessayer,
  onBrouillon,
  brouillonInitial,
  onRafraichir,
  proposerAuChargement = null,
  onPropose,
}: {
  conversation: ConversationResume;
  elements: ElementAffiche[];
  contexte: ContexteConversation | null;
  chargement: boolean;
  /** Faux : aucun fournisseur de SMS configuré — on peut écrire, rien ne partira encore. */
  fournisseurPret: boolean;
  onRetour: () => void;
  onContexte: () => void;
  onEnvoyer: (demande: DemandeEnvoi) => void;
  onReessayer: (element: ElementAffiche) => void;
  onBrouillon: (texte: string) => void;
  brouillonInitial: string;
  onRafraichir: () => void;
  /** Après un appel noté ailleurs (écran Commercial) : ce message type est préparé à l'ouverture, à relire avant d'envoyer. */
  proposerAuChargement?: "LIEN_ESPACE" | "INJOIGNABLE_LIEN" | "LIEN_ESPACE_RAPPEL" | null;
  onPropose?: () => void;
}) {
  const [texte, setTexte] = useState(brouillonInitial);
  const [origine, setOrigine] = useState<{ modele: string; propose: string } | null>(null);
  const [feuille, setFeuille] = useState<"modeles" | "note" | "appel" | "etape" | null>(null);
  const [occupe, setOccupe] = useState<string | null>(null);
  const bas = useRef<HTMLDivElement>(null);
  const zone = useRef<HTMLTextAreaElement>(null);
  const dernierCompte = useRef(0);

  // Changement de conversation : on repart de son brouillon.
  const [idSuivi, setIdSuivi] = useState(conversation.id);
  if (idSuivi !== conversation.id) {
    setIdSuivi(conversation.id);
    setTexte(brouillonInitial);
    setOrigine(null);
    setFeuille(null);
  }

  // Le fil reste calé en bas : à l'ouverture, et à chaque message qui arrive.
  useLayoutEffect(() => {
    const nouveau = elements.length !== dernierCompte.current;
    dernierCompte.current = elements.length;
    if (nouveau) bas.current?.scrollIntoView({ block: "end" });
  }, [elements.length, conversation.id]);

  // La zone de saisie grandit avec le texte, jusqu'à six lignes.
  useEffect(() => {
    const el = zone.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 148)}px`;
  }, [texte]);

  const mesure = useMemo(() => mesurerSms(texte), [texte]);
  const telephone = conversation.numero;
  const dossier = contexte?.dossier ?? null;
  const leadId = conversation.leadId;
  const peutNoter = Boolean(dossier || leadId);

  function ecrire(valeur: string) {
    setTexte(valeur);
    onBrouillon(valeur);
  }

  function envoyer() {
    const propre = texte.trim();
    if (!propre || conversation.stop) return;
    onEnvoyer({ texte: propre, modele: origine?.modele ?? null, textePropose: origine?.propose ?? null });
    setTexte("");
    setOrigine(null);
    onBrouillon("");
    zone.current?.focus();
  }

  function proposer(code: string, propose: string) {
    setOrigine({ modele: code, propose });
    ecrire(propose);
    setFeuille(null);
    window.setTimeout(() => zone.current?.focus(), 50);
  }

  async function lienEspace(modele: "LIEN_ESPACE" | "INJOIGNABLE_LIEN" | "LIEN_ESPACE_RAPPEL" = "LIEN_ESPACE") {
    setOccupe("espace");
    try {
      const reponse = await envoyerJson<{ texte: string; modele: string }>(`/api/sms/conversations/${conversation.id}/espace`, "POST", { modele });
      proposer(reponse.modele, reponse.texte);
      onRafraichir();
      toast.success("Espace client prêt : relisez le message, puis envoyez.");
    } catch (erreur) {
      toast.error(messageErreur(erreur));
    } finally {
      setOccupe(null);
    }
  }

  useEffect(() => {
    if (!proposerAuChargement || conversation.stop) return;
    const minuterie = window.setTimeout(() => {
      onPropose?.();
      void lienEspace(proposerAuChargement);
    }, 0);
    return () => window.clearTimeout(minuterie);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proposerAuChargement, conversation.id]);

  let jourPrecedent = "";

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#16181D]">
      {/* En-tête : retour, nom, appel d'un tap, contexte */}
      <header className="flex items-center gap-1.5 border-b-[0.5px] border-[#2A2D34] bg-[#1C1F25] px-2 py-2 pt-[calc(0.5rem+env(safe-area-inset-top))] md:pt-2">
        <button type="button" onClick={onRetour} aria-label="Retour aux conversations" className={cn("flex h-11 w-10 items-center justify-center rounded-[10px] text-[#D1D5DB] hover:bg-[#22262D] lg:hidden", TRANS)}>
          <ArrowLeft size={20} aria-hidden />
        </button>
        <button type="button" onClick={onContexte} className="min-w-0 flex-1 px-1 text-left xl:pointer-events-none">
          <p className="truncate text-[15.5px] leading-tight font-medium text-[#F2F3F5]">{conversation.nom ?? conversation.numeroLisible}</p>
          <p className="truncate text-[12px] text-[#8B919C]">
            {conversation.nom ? conversation.numeroLisible : "Numéro inconnu"}
            {dossier ? ` · ${LIBELLES_ETAPE[dossier.etape as EtapeDossier] ?? dossier.etape}` : ""}
          </p>
        </button>
        <a href={`tel:${telephone}`} aria-label={`Appeler ${conversation.nom ?? conversation.numeroLisible}`} className={cn("flex h-11 w-11 items-center justify-center rounded-[10px] bg-[#1D9E75]/15 text-[#5DCAA5] hover:bg-[#1D9E75]/25", TRANS)}>
          <Phone size={19} aria-hidden />
        </a>
        <button type="button" onClick={onContexte} aria-label="Contexte du dossier" className={cn("flex h-11 w-11 items-center justify-center rounded-[10px] text-[#D1D5DB] hover:bg-[#22262D] xl:hidden", TRANS)}>
          <PanelRight size={19} aria-hidden />
        </button>
      </header>

      {/* Fil */}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3">
        {chargement && elements.length === 0 ? (
          <p className="flex items-center justify-center gap-2 py-10 text-[13px] text-[#6B7280]">
            <Loader2 size={15} className="animate-spin" aria-hidden /> Chargement…
          </p>
        ) : null}
        {!chargement && elements.length === 0 ? <p className="py-10 text-center text-[13px] text-[#6B7280]">Aucun message encore. Écrivez le premier ci-dessous.</p> : null}
        {elements.map((element) => {
          const jour = jourDuFil(element.le);
          const separateur = jour !== jourPrecedent;
          jourPrecedent = jour;
          return (
            <div key={element.id}>
              {separateur ? <p className="my-3 text-center text-[11px] font-medium tracking-wide text-[#6B7280] uppercase">{jour}</p> : null}
              {element.genre === "SMS" ? (
                <div className={cn("mb-1.5 flex", element.sens === "SORTANT" ? "justify-end" : "justify-start")}>
                  <div className="max-w-[82%] md:max-w-[70%]">
                    <p
                      className={cn(
                        "rounded-[18px] px-3.5 py-2 text-[15px] leading-snug break-words whitespace-pre-wrap",
                        element.sens === "SORTANT" ? "rounded-br-[6px] bg-[#1D9E75] text-[#06140F]" : "rounded-bl-[6px] bg-[#23272F] text-[#F2F3F5]",
                        element.sens === "SORTANT" && element.statut === "ECHEC" && "bg-[#EF4444]/25 text-[#FECACA]",
                        element.local && "opacity-80"
                      )}
                    >
                      {element.texte}
                    </p>
                    <p className={cn("mt-0.5 flex items-center gap-2 px-1.5 text-[11px] text-[#6B7280]", element.sens === "SORTANT" ? "justify-end" : "justify-start")}>
                      <span className="tabular-nums">{heure(element.le)}</span>
                      {element.origine === "ACCUSE_AUTO" ? <span>accusé automatique</span> : null}
                      {element.sens === "SORTANT" ? <EtatEnvoi element={element} onReessayer={() => onReessayer(element)} /> : null}
                    </p>
                    {element.statut === "ECHEC" && element.erreur ? <p className="px-1.5 text-right text-[11px] text-[#F87171]">{element.erreur}</p> : null}
                  </div>
                </div>
              ) : (
                <p className="mx-auto my-2 flex max-w-[92%] items-start justify-center gap-1.5 rounded-[10px] bg-[#1C1F25] px-3 py-1.5 text-center text-[12px] text-[#9CA3AF]">
                  {element.genre === "APPEL" ? <Phone size={12} aria-hidden className="mt-0.5 shrink-0 text-[#5DCAA5]" /> : element.genre === "NOTE" ? <StickyNote size={12} aria-hidden className="mt-0.5 shrink-0 text-[#F5B454]" /> : <ListChecks size={12} aria-hidden className="mt-0.5 shrink-0" />}
                  <span className="min-w-0 break-words">
                    {element.genre === "EVENEMENT" ? <span className="text-[#D1D5DB]">{LIBELLES_TYPE_EVENEMENT[element.titre as TypeEvenement] ?? element.titre} · </span> : null}
                    {element.texte} <span className="text-[#6B7280] tabular-nums">· {heure(element.le)}</span>
                  </span>
                </p>
              )}
            </div>
          );
        })}
        <div ref={bas} />
      </div>

      {/* Messages que le CRM propose pour cette personne : relus et envoyés ici */}
      {conversation.stop ? null : <RelancesProposees conversationId={conversation.id} version={elements.length} onFait={onRafraichir} />}

      {/* Actions rapides : toujours à portée du pouce */}
      <div className="flex gap-1.5 overflow-x-auto border-t-[0.5px] border-[#2A2D34] bg-[#1C1F25] px-2.5 pt-2 pb-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <ActionRapide icone={<Link2 size={14} aria-hidden />} libelle="Lien espace" chargement={occupe === "espace"} desactive={conversation.stop || (!leadId && !dossier)} onClick={() => void lienEspace()} />
        <ActionRapide icone={<MessageSquareText size={14} aria-hidden />} libelle="Message type" desactive={conversation.stop} onClick={() => setFeuille("modeles")} />
        <ActionRapide icone={<Phone size={14} aria-hidden />} libelle="Fin d'appel" desactive={!peutNoter} onClick={() => setFeuille("appel")} />
        <ActionRapide icone={<StickyNote size={14} aria-hidden />} libelle="Note" desactive={!peutNoter} onClick={() => setFeuille("note")} />
        {dossier ? (
          <>
            <Link href={`/dossiers?dossier=${dossier.id}`} className={CLASSE_ACTION}>
              <FileText size={14} aria-hidden /> Devis
            </Link>
            <ActionRapide icone={<ListChecks size={14} aria-hidden />} libelle="Étape" onClick={() => setFeuille("etape")} />
          </>
        ) : null}
      </div>

      {/* Saisie */}
      <div className="border-t-[0.5px] border-[#2A2D34] bg-[#1C1F25] px-2.5 pt-1.5 pb-[calc(0.6rem+env(safe-area-inset-bottom))]">
        {conversation.stop ? (
          <p className="rounded-[10px] bg-[#EF4444]/10 px-3 py-2.5 text-[13px] text-[#F87171]">Ce numéro a répondu STOP : plus aucun SMS ne peut lui être envoyé. Vous pouvez toujours l&apos;appeler.</p>
        ) : (
          <>
            {!fournisseurPret ? <p className="mb-1.5 rounded-[8px] bg-[#EF9F27]/10 px-2.5 py-1.5 text-[12px] text-[#F5B454]">Aucun fournisseur de SMS n&apos;est encore configuré : le message sera gardé et partira dès qu&apos;il le sera.</p> : null}
            {conversation.premierEnvoi && texte.trim() && !/\bstop\b/i.test(texte) ? <p className="mb-1 px-1 text-[11.5px] text-[#8B919C]">Premier message : « STOP pour ne plus recevoir nos SMS. » sera ajouté à la fin.</p> : null}
            <div className="flex items-end gap-2">
              <textarea
                ref={zone}
                value={texte}
                rows={1}
                onChange={(evenement) => ecrire(evenement.target.value)}
                onKeyDown={(evenement) => {
                  if (evenement.key !== "Enter" || evenement.nativeEvent.isComposing) return;
                  // Clavier d'ordinateur : Entrée envoie, Maj+Entrée va à la ligne. Au doigt, Entrée va à la ligne.
                  const clavierPhysique = window.matchMedia("(pointer: fine)").matches;
                  if (evenement.metaKey || evenement.ctrlKey || (clavierPhysique && !evenement.shiftKey)) {
                    evenement.preventDefault();
                    envoyer();
                  }
                }}
                placeholder="Votre message"
                aria-label="Votre message"
                className="max-h-[148px] min-h-[44px] flex-1 resize-none rounded-[20px] border-[0.5px] border-[#2A2D34] bg-[#16181D] px-4 py-2.5 text-[16px] leading-snug text-[#F2F3F5] placeholder:text-[#6B7280] focus:border-[#1D9E75]/60 focus:outline-none"
              />
              <button
                type="button"
                onClick={envoyer}
                disabled={!texte.trim()}
                aria-label="Envoyer"
                className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#1D9E75] text-[#06140F] hover:bg-[#5DCAA5] disabled:bg-[#23272F] disabled:text-[#6B7280]", TRANS)}
              >
                <SendHorizontal size={19} aria-hidden />
              </button>
            </div>
            {texte ? (
              <p className="mt-1 flex flex-wrap items-center gap-x-2 px-1.5 text-[11.5px] tabular-nums">
                <span className={mesure.segments > 1 ? "text-[#F5B454]" : "text-[#6B7280]"}>
                  {mesure.longueur} car. · {mesure.segments} SMS
                </span>
                {!mesure.gsm ? (
                  <button type="button" onClick={() => ecrire(simplifierPourGsm(texte))} className="text-[#F5B454] underline underline-offset-2">
                    {mesure.horsGsm.slice(0, 4).join(" ")} coûtent plus cher — simplifier
                  </button>
                ) : null}
                {origine && origine.propose !== texte ? <span className="text-[#8B919C]">message type corrigé</span> : null}
              </p>
            ) : null}
          </>
        )}
      </div>

      <FeuilleModeles ouverte={feuille === "modeles"} conversationId={conversation.id} onFermer={() => setFeuille(null)} onChoisir={proposer} onOuvrirEspace={() => void lienEspace()} />
      <FeuilleNote ouverte={feuille === "note"} leadId={leadId} dossierId={dossier?.id ?? null} onFermer={() => setFeuille(null)} onFait={onRafraichir} />
      <FeuilleAppel
        ouverte={feuille === "appel"}
        leadId={leadId}
        dossierId={dossier?.id ?? null}
        onFermer={() => setFeuille(null)}
        onFait={(suite) => {
          onRafraichir();
          if (suite.messagePropose && !conversation.stop) void lienEspace(suite.messagePropose);
        }}
      />
      {dossier ? <FeuilleEtape ouverte={feuille === "etape"} dossierId={dossier.id} etape={dossier.etape as EtapeDossier} onFermer={() => setFeuille(null)} onFait={onRafraichir} /> : null}
    </div>
  );
}

const CLASSE_ACTION = cn(
  "inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full border-[0.5px] border-[#2A2D34] bg-[#16181D] px-3.5 text-[13px] font-medium whitespace-nowrap text-[#E5E7EB] hover:border-[#3A3E47] disabled:opacity-40",
  TRANS
);

function ActionRapide({ icone, libelle, onClick, desactive, chargement }: { icone: React.ReactNode; libelle: string; onClick: () => void; desactive?: boolean; chargement?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={desactive || chargement} className={CLASSE_ACTION}>
      {chargement ? <Loader2 size={14} className="animate-spin" aria-hidden /> : icone} {libelle}
    </button>
  );
}

/* ── Feuilles : messages types, note, fin d'appel, étape ─────────────── */

function FeuilleModeles({ ouverte, conversationId, onFermer, onChoisir, onOuvrirEspace }: { ouverte: boolean; conversationId: string; onFermer: () => void; onChoisir: (code: string, texte: string) => void; onOuvrirEspace: () => void }) {
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null);
  useEffect(() => {
    if (!ouverte) return;
    let actif = true;
    appelApi<{ suggestions: Suggestion[] }>(`/api/sms/conversations/${conversationId}/suggestions`)
      .then((reponse) => actif && setSuggestions(reponse.suggestions))
      .catch((erreur) => toast.error(messageErreur(erreur)));
    return () => {
      actif = false;
    };
  }, [ouverte, conversationId]);

  return (
    <Modale ouverte={ouverte} onFermer={onFermer} titre="Message type" description="Le CRM pré-remplit : vous relisez, corrigez, puis envoyez. Rien ne part d'ici.">
      {!suggestions ? (
        <p className="flex items-center gap-2 py-6 text-[13px] text-[#6B7280]">
          <Loader2 size={14} className="animate-spin" aria-hidden /> Chargement…
        </p>
      ) : (
        <ul className="space-y-2">
          {suggestions.map((s) => (
            <li key={s.code}>
              <button
                type="button"
                onClick={() => (s.texte ? onChoisir(s.code, s.texte) : onOuvrirEspace())}
                className={cn("w-full rounded-[12px] border-[0.5px] p-3 text-left", TRANS, s.conseille ? "border-[#1D9E75]/50 bg-[#1D9E75]/10 hover:bg-[#1D9E75]/15" : "border-[#2A2D34] bg-[#16181D] hover:border-[#3A3E47]")}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="text-[13px] font-medium text-[#F2F3F5]">{s.libelle}</span>
                  {s.conseille ? <span className="shrink-0 rounded-full bg-[#1D9E75] px-2 text-[10.5px] leading-[17px] font-semibold text-[#06140F]">à cette étape</span> : null}
                </span>
                <span className="mt-1 block text-[12.5px] leading-snug text-[#9CA3AF]">{s.texte ?? "Ce message contient le lien de l'espace client : touchez pour ouvrir l'espace d'abord."}</span>
                {s.texte ? <span className="mt-1 block text-[11px] text-[#6B7280] tabular-nums">{s.segments} SMS</span> : null}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Modale>
  );
}

export function FeuilleNote({ ouverte, leadId, dossierId, onFermer, onFait }: { ouverte: boolean; leadId: string | null; dossierId: string | null; onFermer: () => void; onFait: () => void }) {
  const [contenu, setContenu] = useState("");
  const [envoi, setEnvoi] = useState(false);
  async function enregistrer() {
    setEnvoi(true);
    try {
      await envoyerJson("/api/commercial/notes", "POST", { ...(dossierId ? { dossierId } : { leadId }), contenu });
      toast.success("Note ajoutée");
      setContenu("");
      onFermer();
      onFait();
    } catch (erreur) {
      toast.error(messageErreur(erreur));
    } finally {
      setEnvoi(false);
    }
  }
  return (
    <Modale
      ouverte={ouverte}
      onFermer={onFermer}
      titre="Ajouter une note"
      pied={
        <Bouton variante="primaire" className="h-12 w-full text-[15px] sm:h-9 sm:text-[13px]" chargement={envoi} disabled={!contenu.trim()} onClick={() => void enregistrer()}>
          Enregistrer la note
        </Bouton>
      }
    >
      <ZoneTexte libelle="Note" rows={4} value={contenu} onChange={(evenement) => setContenu(evenement.target.value)} placeholder="Cuisine en L, 12 façades, veut du chêne clair…" autoFocus />
    </Modale>
  );
}

export function FeuilleAppel({ ouverte, leadId, dossierId, onFermer, onFait }: { ouverte: boolean; leadId: string | null; dossierId: string | null; onFermer: () => void; onFait: (suite: SuiteAppel) => void }) {
  const [issue, setIssue] = useState<IssueAppel | null>(null);
  const [note, setNote] = useState("");
  const [envoi, setEnvoi] = useState(false);
  async function enregistrer() {
    if (!issue) return;
    setEnvoi(true);
    try {
      const { suite } = await envoyerJson<{ suite: SuiteAppel }>("/api/commercial/appels", "POST", { ...(dossierId ? { dossierId } : { leadId }), issue, note });
      toast.success(suite.resume);
      setIssue(null);
      setNote("");
      onFermer();
      onFait(suite);
    } catch (erreur) {
      toast.error(messageErreur(erreur));
    } finally {
      setEnvoi(false);
    }
  }
  return (
    <Modale
      ouverte={ouverte}
      onFermer={onFermer}
      titre="Fin d'appel"
      description="Une ligne, une issue : le CRM fixe l'étape et la prochaine action."
      pied={
        <Bouton variante="primaire" className="h-12 w-full text-[15px] sm:h-9 sm:text-[13px]" chargement={envoi} disabled={!issue} onClick={() => void enregistrer()}>
          Enregistrer l&apos;appel
        </Bouton>
      }
    >
      <div className="space-y-4">
        <Puces libelle="Issue" options={ISSUES_APPEL.map((valeur) => ({ valeur, libelle: LIBELLES_ISSUE[valeur] }))} valeur={issue} onChange={(valeur: IssueAppel) => setIssue(valeur)} />
        <ZoneTexte libelle="En une ligne" rows={3} value={note} onChange={(evenement) => setNote(evenement.target.value)} placeholder="Cuisine de 2015, veut refaire les façades avant Noël" />
        {issue === "INTERESSE" ? <p className="text-[12.5px] text-[#9CA3AF]">Ensuite, le message avec le lien de son espace sera préparé : vous le relisez et l&apos;envoyez.</p> : null}
        {issue === "PAS_DE_REPONSE" ? <p className="text-[12.5px] text-[#9CA3AF]">Rappel posé à demain 10 h, et le SMS « j&apos;ai essayé de vous joindre » sera préparé pour relecture.</p> : null}
      </div>
    </Modale>
  );
}

function FeuilleEtape({ ouverte, dossierId, etape, onFermer, onFait }: { ouverte: boolean; dossierId: string; etape: EtapeDossier; onFermer: () => void; onFait: () => void }) {
  const [envoi, setEnvoi] = useState<EtapeDossier | null>(null);
  async function passer(vers: EtapeDossier) {
    setEnvoi(vers);
    try {
      await envoyerJson(`/api/dossiers/${dossierId}/etape`, "POST", { vers });
      toast.success(`Dossier : ${LIBELLES_ETAPE[vers]}`);
      onFermer();
      onFait();
    } catch (erreur) {
      toast.error(messageErreur(erreur));
    } finally {
      setEnvoi(null);
    }
  }
  return (
    <Modale ouverte={ouverte} onFermer={onFermer} titre="Passer l'étape" description={`Actuellement : ${LIBELLES_ETAPE[etape] ?? etape}`}>
      <div className="space-y-2">
        {ETAPES_RAPIDES.filter((e) => e !== etape).map((e) => (
          <Bouton key={e} className="h-12 w-full justify-start text-[15px] sm:h-9 sm:text-[13px]" chargement={envoi === e} onClick={() => void passer(e)}>
            {LIBELLES_ETAPE[e]}
          </Bouton>
        ))}
        <Link href={`/dossiers?dossier=${dossierId}`} className="flex items-center gap-1.5 pt-2 text-[13px] text-[#5DCAA5] hover:underline">
          <RotateCcw size={13} aria-hidden /> Signé, perdu, planifié… : depuis le dossier (acompte, motif, date)
        </Link>
      </div>
    </Modale>
  );
}
