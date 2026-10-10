"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ListChecks, MoreHorizontal, PauseCircle, PlayCircle } from "lucide-react";
import { toast } from "sonner";
import type { FiltreConversations, LigneConversation } from "@/lib/messagerie/vues";
import { cn } from "@/lib/utils";
import { appelApi, envoyerJson, messageErreur } from "@/components/pilotage/client";
import { EVENEMENT_COMPTEURS, rafraichirCompteurs } from "@/components/pilotage/evenements";
import { NotificationsAppareil } from "@/components/pilotage/NotificationsAppareil";
import { TRANS } from "@/components/pilotage/ui";
import { Conversation } from "./Conversation";
import { ListeConversations } from "./Liste";
import { UnParUn } from "./UnParUn";

/**
 * Mission 25 — l'écran Messagerie, pensé d'abord pour le téléphone : la liste des conversations (une par client) et,
 * à l'appui, la conversation en plein écran ; sur ordinateur, les deux côte à côte. En haut : « Aujourd'hui : N à
 * faire » (le mode « Un par un »), « Tout mettre en pause », l'activation des notifications sur cet appareil.
 * `?suivi=` ouvre une conversation, `?message=` celle d'un message (lien d'une notification), `?vue=un-par-un` la file.
 */

type Liste = { lignes: LigneConversation[]; compteurs: Record<FiltreConversations, number> };
type Etat = { mode: "MANUEL" | "ANDROID"; pause: boolean; aEnvoyer: number; aValider: number; ia: { active: boolean; raison: string | null; depense: number; budget: number } };
type FileResume = { cartes: unknown[] };

export function EcranMessagerie({ suiviInitial, unParUnInitial }: { suiviInitial: string | null; unParUnInitial: boolean }) {
  const [filtre, setFiltre] = useState<FiltreConversations>("TOUS");
  const [recherche, setRecherche] = useState("");
  const [liste, setListe] = useState<Liste | null>(null);
  const [etat, setEtat] = useState<Etat | null>(null);
  const [aFaire, setAFaire] = useState<number | null>(null);
  const [actif, setActif] = useState<string | null>(suiviInitial);
  const [unParUn, setUnParUn] = useState(unParUnInitial);
  const [menu, setMenu] = useState(false);
  const minuterieRecherche = useRef<number | null>(null);
  const cadre = useRef<HTMLDivElement>(null);
  const [haut, setHaut] = useState(0);

  // La hauteur suit ce qui est au-dessus (bandeau d'essai, zone sûre de l'iPhone) : la zone de saisie reste au-dessus
  // de la barre du bas, sans défilement de la page.
  useEffect(() => {
    const el = cadre.current;
    if (!el) return;
    const mesurer = () => setHaut(Math.max(0, Math.round(el.getBoundingClientRect().top + window.scrollY)));
    const observateur = new ResizeObserver(mesurer);
    observateur.observe(document.body);
    window.addEventListener("resize", mesurer);
    return () => {
      observateur.disconnect();
      window.removeEventListener("resize", mesurer);
    };
  }, []);

  const charger = useCallback(async (f: FiltreConversations, q: string) => {
    try {
      const [l, e, file] = await Promise.all([
        appelApi<Liste>(`/api/messagerie/conversations?filtre=${f}${q ? `&q=${encodeURIComponent(q)}` : ""}`),
        appelApi<Etat>("/api/messagerie/etat"),
        appelApi<FileResume>("/api/messagerie/file"),
      ]);
      setListe(l);
      setEtat(e);
      setAFaire(file.cartes.length);
    } catch (erreur) {
      toast.error(messageErreur(erreur));
    }
  }, []);

  useEffect(() => {
    void charger(filtre, recherche);
    const relire = () => {
      if (document.visibilityState === "visible") void charger(filtre, recherche);
    };
    document.addEventListener("visibilitychange", relire);
    window.addEventListener(EVENEMENT_COMPTEURS, relire);
    const minuterie = window.setInterval(relire, 30_000);
    return () => {
      document.removeEventListener("visibilitychange", relire);
      window.removeEventListener(EVENEMENT_COMPTEURS, relire);
      window.clearInterval(minuterie);
    };
    // La recherche relit avec un léger délai (ci-dessous), pas à chaque frappe.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [charger, filtre]);

  // L'adresse suit la conversation ouverte (retour arrière du téléphone compris).
  useEffect(() => {
    const url = new URL(window.location.href);
    if (actif) url.searchParams.set("suivi", actif);
    else url.searchParams.delete("suivi");
    url.searchParams.delete("message");
    if (unParUn) url.searchParams.set("vue", "un-par-un");
    else url.searchParams.delete("vue");
    window.history.replaceState(null, "", url.toString());
  }, [actif, unParUn]);

  function chercher(q: string) {
    setRecherche(q);
    if (minuterieRecherche.current) window.clearTimeout(minuterieRecherche.current);
    minuterieRecherche.current = window.setTimeout(() => void charger(filtre, q), 250);
  }

  async function geste(suiviId: string, action: string, message: string) {
    try {
      await envoyerJson(`/api/messagerie/conversations/${suiviId}`, "POST", { action });
      toast.success(message);
      void charger(filtre, recherche);
      rafraichirCompteurs();
    } catch (erreur) {
      toast.error(messageErreur(erreur));
    }
  }

  async function basculerPause() {
    if (!etat) return;
    try {
      setEtat(await envoyerJson<Etat>("/api/messagerie/etat", "POST", { pause: !etat.pause }));
      toast.success(etat.pause ? "Messagerie relancée" : "Tout est en pause : rien n'est préparé ni envoyé");
      setMenu(false);
    } catch (erreur) {
      toast.error(messageErreur(erreur));
    }
  }

  async function creerDemo() {
    if (!window.confirm("Créer le dossier « Démo Messagerie » ? Numéro fictif, aucun vrai client : le premier message (A1) se prépare et l'alerte part sur tes appareils. Une ancienne démo est archivée.")) return;
    setMenu(false);
    try {
      const { suiviId } = await envoyerJson<{ suiviId: string | null }>("/api/messagerie/demo", "POST", {});
      toast.success("Dossier « Démo Messagerie » créé : le premier message est prêt");
      await charger(filtre, recherche);
      rafraichirCompteurs();
      if (suiviId) {
        setUnParUn(false);
        setActif(suiviId);
      }
    } catch (erreur) {
      toast.error(messageErreur(erreur));
    }
  }

  const conversationOuverte = Boolean(actif) && !unParUn;
  return (
    <div ref={cadre} style={{ ["--haut" as string]: `${haut}px` }} className="mx-auto flex h-[calc(100dvh-var(--haut)-4rem-env(safe-area-inset-bottom))] max-w-[1400px] md:h-[calc(100dvh-var(--haut))]">
      <section className={cn("flex min-h-0 w-full flex-col border-r-[0.5px] border-trait md:w-[380px] md:shrink-0", (conversationOuverte || unParUn) && "max-md:hidden")}>
        <header className="shrink-0 px-3 pt-3 pb-1">
          <div className="flex items-center gap-2">
            <h1 className="flex-1 text-[22px] font-semibold text-texte">Messagerie</h1>
            <div className="relative">
              <button type="button" onClick={() => setMenu((m) => !m)} aria-label="Réglages de la messagerie" aria-expanded={menu} className={cn("flex h-11 w-11 items-center justify-center rounded-[10px] text-texte-2 hover:text-texte", TRANS)}>
                <MoreHorizontal size={20} aria-hidden />
              </button>
              {menu ? (
                <div className="absolute top-12 right-0 z-30 w-72 rounded-[12px] border-[0.5px] border-trait bg-surface p-2 shadow-lg shadow-black/40">
                  <button type="button" onClick={basculerPause} className={cn("flex min-h-[48px] w-full items-center gap-2 rounded-[10px] px-2 text-left text-[15px] hover:bg-surface-2", TRANS, etat?.pause ? "text-action-clair" : "text-attention-texte")}>
                    {etat?.pause ? <PlayCircle size={18} aria-hidden /> : <PauseCircle size={18} aria-hidden />}
                    {etat?.pause ? "Relancer la messagerie" : "Tout mettre en pause"}
                  </button>
                  <p className="px-2 pt-1 text-[12.5px] text-texte-3">
                    Mode d&apos;envoi : {etat?.mode === "ANDROID" ? "Android" : "Manuel"} (Paramètres → SMS). IA : {etat?.ia.active ? `active, ${etat.ia.depense.toFixed(2).replace(".", ",")} € sur ${etat.ia.budget} € ce mois` : "en pause, règles fixes"}.
                  </p>
                  <a href="/parametres?section=sms" className="mt-1 flex min-h-[44px] items-center rounded-[10px] px-2 text-[14px] text-texte-2 hover:bg-surface-2">
                    Les messages et leurs modes
                  </a>
                  <button type="button" onClick={() => void creerDemo()} className={cn("flex min-h-[44px] w-full items-center rounded-[10px] px-2 text-left text-[14px] text-texte-2 hover:bg-surface-2", TRANS)}>
                    Créer le dossier « Démo Messagerie »
                  </button>
                </div>
              ) : null}
            </div>
          </div>
          {etat?.pause ? <p className="mt-1 rounded-[10px] bg-surface-2 p-2.5 text-[13px] text-attention-texte">Tout est en pause : rien n&apos;est préparé ni envoyé.</p> : null}
          <button
            type="button"
            onClick={() => {
              setUnParUn(true);
              setActif(null);
            }}
            className={cn("mt-2 flex min-h-[52px] w-full items-center justify-between rounded-[12px] bg-action px-4 text-[16px] font-semibold text-action-texte hover:bg-action-clair", TRANS)}
          >
            <span className="flex items-center gap-2">
              <ListChecks size={18} aria-hidden /> Aujourd&apos;hui : {aFaire ?? "…"} à faire
            </span>
            <span className="text-[14px] font-medium">Un par un</span>
          </button>
          <div className="mt-2">
            <NotificationsAppareil compact />
          </div>
        </header>
        {liste ? (
          <ListeConversations
            lignes={liste.lignes}
            compteurs={liste.compteurs}
            filtre={filtre}
            recherche={recherche}
            actif={actif}
            onFiltre={(f) => setFiltre(f)}
            onRecherche={chercher}
            onOuvrir={(id) => {
              setUnParUn(false);
              setActif(id);
            }}
            onArchiver={(l) => geste(l.suiviId, l.archive ? "desarchiver" : "archiver", l.archive ? "Conversation désarchivée" : "Conversation archivée")}
            onLu={(l) => geste(l.suiviId, l.nonLu ? "lu" : "non-lu", l.nonLu ? "Marquée lue" : "Marquée non lue")}
          />
        ) : (
          <p className="p-4 text-[14px] text-texte-3">Chargement…</p>
        )}
      </section>
      <section className={cn("min-h-0 flex-1", !conversationOuverte && !unParUn && "max-md:hidden")}>
        {unParUn ? (
          <UnParUn
            onFermer={() => {
              setUnParUn(false);
              void charger(filtre, recherche);
            }}
            onOuvrirConversation={(id) => {
              setUnParUn(false);
              setActif(id);
            }}
          />
        ) : actif ? (
          <Conversation key={actif} suiviId={actif} onRetour={() => setActif(null)} onChange={() => void charger(filtre, recherche)} />
        ) : (
          <div className="hidden h-full items-center justify-center text-[15px] text-texte-3 md:flex">Choisis une conversation, ou « Un par un ».</div>
        )}
      </section>
    </div>
  );
}
