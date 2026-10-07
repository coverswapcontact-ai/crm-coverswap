"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { FILTRES_JOURNAL, LIBELLES_FILTRE_JOURNAL, type EntreeJournal, type FiltreJournal, type ResultatJournal } from "@/lib/chronologie/journal-types";
import { depuisLisible } from "@/lib/v2/dates";
import { GROUPES_VISIBLES, basculerFiltre, compteEnMots, filtrer, grouperParPersonne, phraseRienDeNouveau } from "@/lib/v2/journal";
import { DUREE_ANNULATION_MS } from "../taches/toastAnnulable";
import { cn } from "@/lib/utils";
import { appelApi, envoyerJson, messageErreur } from "@/components/pilotage/client";
import { TRANS_V2 } from "../transitions";
import { BOUTON_SECONDAIRE, GroupeParPersonne, type GesteProposition } from "./GroupeParPersonne";

/**
 * Mission 22 (A1) — « Depuis ta dernière visite » : le journal global, groupé par personne, cinq groupes visibles puis
 * « Voir les N autres », les filtres Clients · Argent · Système (un seul actif, ou tous), « Tout vu » (le seul bouton
 * principal) qui pose JOURNAL_VU_LE et vide la liste. Chaque geste répond par une ligne écrite ; un geste sur une
 * proposition (Valider, Ignorer) part cinq secondes plus tard et s'annule d'ici là. Le lot A2 l'importe en `compact`
 * dans Aujourd'hui ; la page `/journal` le rend en entier.
 */
export type DonneesJournal = ResultatJournal & { vuLe: string | null };

const DELAI_ANNULATION_MS = DUREE_ANNULATION_MS;
/** « Ignorer » = rejeter avec le motif commun « Inutile » (validation/types.ts › MOTIFS_REJET_COMMUNS). */
const MOTIF_IGNORER = "INUTILE";

type Reponse = { texte: string; annuler?: () => void; erreur?: boolean };

const BOUTON_PRINCIPAL = cn("inline-flex h-11 items-center justify-center rounded-[8px] bg-action px-5 text-corps font-semibold text-action-texte hover:bg-action-clair focus-visible:ring-2 focus-visible:ring-action/50 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50", TRANS_V2);
const FILTRE = (actif: boolean) => cn("inline-flex h-11 items-center justify-center rounded-full border px-4 text-corps font-medium focus-visible:ring-2 focus-visible:ring-action/50 focus-visible:outline-none", actif ? "border-action bg-action-fond text-action-clair" : "border-trait bg-surface text-texte-2 hover:bg-surface-2", TRANS_V2);

export function Journal({ initiale, compact = false, titre = "Depuis ta dernière visite" }: { initiale: DonneesJournal; compact?: boolean; titre?: string }) {
  const [entrees, setEntrees] = useState<EntreeJournal[]>(initiale.entrees);
  const [page, setPage] = useState(initiale.page);
  const [pages, setPages] = useState(initiale.pages);
  const [vuLe, setVuLe] = useState<string | null>(initiale.vuLe);
  const [depuis, setDepuis] = useState(initiale.depuis);
  const [filtre, setFiltre] = useState<FiltreJournal | null>(null);
  const [toutMontrer, setToutMontrer] = useState(false);
  const [reponse, setReponse] = useState<Reponse | null>(null);
  const [enAttente, setEnAttente] = useState<Set<string>>(new Set());
  const [occupe, setOccupe] = useState(false);
  // Correctifs du 07/10 (É4) : « Tout vu » part 5 s plus tard, comme Valider ; la liste s'efface tout de suite et revient sur « Annuler ».
  const [toutVuEnAttente, setToutVuEnAttente] = useState(false);
  const minuterieToutVu = useRef<number | null>(null);
  const ligneReponse = useRef<HTMLParagraphElement>(null);
  // Mission 22 (A2) : l'heure du rendu serveur d'abord (`jusqua`), la même au serveur et au navigateur (sinon une
  // minute passée entre les deux fait échouer l'hydratation) ; l'horloge de l'appareil prend le relais à la minute.
  const [maintenant, setMaintenant] = useState(() => new Date(initiale.jusqua));
  const minuteries = useRef(new Map<string, number>());

  // L'heure de référence des dates relatives suit le temps (une fois par minute), sans rien faire bouger d'autre.
  useEffect(() => {
    const minuterie = window.setInterval(() => setMaintenant(new Date()), 60_000);
    return () => window.clearInterval(minuterie);
  }, []);
  useEffect(() => {
    const encours = minuteries.current;
    return () => {
      for (const m of encours.values()) window.clearTimeout(m);
      if (minuterieToutVu.current) window.clearTimeout(minuterieToutVu.current);
    };
  }, []);
  // Correctifs du 07/10 (É3) : la ligne de réponse se rend en haut du journal ; si le geste a eu lieu plus bas, elle est amenée en vue.
  useEffect(() => {
    if (reponse) ligneReponse.current?.scrollIntoView({ block: "nearest" });
  }, [reponse]);

  const visibles = toutVuEnAttente ? [] : filtrer(entrees, filtre);
  const groupes = grouperParPersonne(visibles);
  const montres = toutMontrer ? groupes : groupes.slice(0, GROUPES_VISIBLES);
  const caches = groupes.length - montres.length;
  const total = entrees.length;

  const retirer = useCallback((id: string) => {
    setEntrees((liste) => liste.filter((e) => e.id !== id));
    setEnAttente((s) => {
      const copie = new Set(s);
      copie.delete(id);
      return copie;
    });
  }, []);

  /** Le geste part dans 5 s ; « Annuler » d'ici là le retient. Après l'envoi, plus d'annulation : la ligne le dit. */
  const surGeste = useCallback(
    (entree: EntreeJournal, geste: GesteProposition) => {
      const chemin = geste === "valider" ? entree.gestes?.valider : entree.gestes?.ignorer;
      if (!chemin) return;
      setEnAttente((s) => new Set(s).add(entree.id));
      const annuler = () => {
        const m = minuteries.current.get(entree.id);
        if (m) window.clearTimeout(m);
        minuteries.current.delete(entree.id);
        setEnAttente((s) => {
          const copie = new Set(s);
          copie.delete(entree.id);
          return copie;
        });
        setReponse({ texte: "Annulé : rien n'a été fait." });
      };
      const minuterie = window.setTimeout(async () => {
        minuteries.current.delete(entree.id);
        try {
          await envoyerJson(chemin, "POST", geste === "valider" ? {} : { motif: MOTIF_IGNORER, commentaire: null });
          retirer(entree.id);
          setReponse({ texte: geste === "valider" ? `Fait : proposition validée (${entree.titre.replace(/^À valider : /, "")}).` : `Fait : proposition ignorée (${entree.titre.replace(/^À valider : /, "")}). Elle reste dans À valider, onglet Historique.` });
        } catch (erreur) {
          setEnAttente((s) => {
            const copie = new Set(s);
            copie.delete(entree.id);
            return copie;
          });
          setReponse({ texte: messageErreur(erreur), erreur: true });
        }
      }, DELAI_ANNULATION_MS);
      minuteries.current.set(entree.id, minuterie);
      setReponse({ texte: geste === "valider" ? "Validée dans 5 s." : "Ignorée dans 5 s.", annuler });
    },
    [retirer]
  );

  /** « Tout vu » : « Tout est vu. » avec « Annuler » pendant 5 s, puis l'écriture ; l'en-tête passe à « Rien de nouveau depuis … ». */
  const toutVu = useCallback(() => {
    setToutVuEnAttente(true);
    const annuler = () => {
      if (minuterieToutVu.current) window.clearTimeout(minuterieToutVu.current);
      minuterieToutVu.current = null;
      setToutVuEnAttente(false);
      setReponse({ texte: "Annulé : le journal reste à lire." });
    };
    minuterieToutVu.current = window.setTimeout(async () => {
      minuterieToutVu.current = null;
      setOccupe(true);
      try {
        const { vuLe: pose } = await envoyerJson<{ vuLe: string }>("/api/journal/vu", "POST");
        setVuLe(pose);
        setDepuis(pose);
        setEntrees([]);
        setToutMontrer(false);
        // A6 : la ligne de réponse confirme le geste ; l'en-tête dit « Rien de nouveau depuis … » (pas deux fois la même phrase).
        setReponse({ texte: "Tout est vu." });
      } catch (erreur) {
        setReponse({ texte: messageErreur(erreur), erreur: true });
      } finally {
        setOccupe(false);
        setToutVuEnAttente(false);
      }
    }, DELAI_ANNULATION_MS);
    setReponse({ texte: "Tout est vu.", annuler });
  }, []);

  const suite = useCallback(async () => {
    setOccupe(true);
    try {
      const r = await appelApi<DonneesJournal>(`/api/journal?depuis=${encodeURIComponent(depuis)}&jusqua=${encodeURIComponent(initiale.jusqua)}&page=${page + 1}&par_page=200`);
      setEntrees((liste) => {
        const connus = new Set(liste.map((e) => e.id));
        return [...liste, ...r.entrees.filter((e) => !connus.has(e.id))];
      });
      setPage(r.page);
      setPages(r.pages);
    } catch (erreur) {
      setReponse({ texte: messageErreur(erreur), erreur: true });
    } finally {
      setOccupe(false);
    }
  }, [depuis, initiale.jusqua, page]);

  const Titre = compact ? "h2" : "h1";
  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="flex flex-col gap-1">
          <Titre className="text-titre font-semibold text-texte">{titre}</Titre>
          <p className="text-corps-tel text-texte-2 md:text-corps">
            {total > 0 ? `${depuisLisible(depuis, maintenant).replace(/^depuis/, "Depuis")} : ${compteEnMots(total)}` : phraseRienDeNouveau(vuLe, depuis, maintenant)}
          </p>
        </div>
        {total > 0 && !toutVuEnAttente ? (
          // Mission 22 (A2) : dans Aujourd'hui (compact), le seul bouton principal de l'écran est le geste prêt de
          // « Maintenant » ; « Tout vu » y passe en contour. Sur /journal, il reste le bouton principal.
          <button type="button" className={compact ? BOUTON_SECONDAIRE : BOUTON_PRINCIPAL} onClick={toutVu} disabled={occupe}>
            Tout vu
          </button>
        ) : null}
      </header>

      {reponse ? (
        <p ref={ligneReponse} role="status" aria-live="polite" className={cn("flex min-h-11 flex-wrap items-center gap-3 rounded-[8px] border px-4 py-2 text-corps-tel md:text-corps", reponse.erreur ? "border-attention/60 bg-surface text-attention-texte" : "border-action/40 bg-action-fond text-action-clair")}>
          <span>{reponse.texte}</span>
          {reponse.annuler ? (
            <button type="button" className={BOUTON_SECONDAIRE} onClick={reponse.annuler}>
              Annuler
            </button>
          ) : null}
        </p>
      ) : null}

      {total > 0 && !toutVuEnAttente ? (
        <div role="group" aria-label="Filtrer le journal" className="flex flex-wrap gap-2">
          {FILTRES_JOURNAL.map((f) => (
            <button key={f} type="button" aria-pressed={filtre === f} className={FILTRE(filtre === f)} onClick={() => setFiltre((actif) => basculerFiltre(actif, f))}>
              {LIBELLES_FILTRE_JOURNAL[f]}
            </button>
          ))}
        </div>
      ) : null}

      {montres.map((g) => (
        <GroupeParPersonne key={g.cle} groupe={g} maintenant={maintenant} enAttente={enAttente} onGeste={surGeste} />
      ))}

      {total > 0 && visibles.length === 0 ? <p className="text-corps-tel text-texte-3 md:text-corps">Rien dans ce filtre.</p> : null}

      {caches > 0 ? (
        <button type="button" className={BOUTON_SECONDAIRE} onClick={() => setToutMontrer(true)}>
          Voir {caches === 1 ? "l'autre" : `les ${caches} autres`}
        </button>
      ) : null}
      {toutMontrer && page < pages ? (
        <button type="button" className={BOUTON_SECONDAIRE} onClick={() => void suite()} disabled={occupe}>
          Charger la suite
        </button>
      ) : null}

      {compact ? (
        <Link href="/journal" className={cn("inline-flex min-h-11 items-center self-start text-corps-tel text-texte-2 underline-offset-4 hover:text-texte hover:underline md:text-corps", TRANS_V2)}>
          Tout le journal
        </Link>
      ) : null}
    </div>
  );
}
