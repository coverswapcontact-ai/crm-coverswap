"use client";

import { useCallback, useState, type ReactNode } from "react";
import { AlertTriangle, Ban, ChevronDown, CircleCheck, Clock, Loader2, RotateCw } from "lucide-react";
import { toast } from "sonner";
import { appelApi, envoyerJson, messageErreur } from "@/components/pilotage/client";
import { rafraichirCompteurs } from "@/components/pilotage/Navigation";
import { Bouton, EtatVide, Pagination, Pastille, TitreSection, TRANS } from "@/components/pilotage/ui";
import { formatHorodatage } from "@/lib/dossiers/dates";
import { LIBELLES_STATUT_TACHE } from "@/lib/taches/statuts";
import type { EtatTaches as Etat, TacheVue } from "@/lib/taches/lecture";
import { cn } from "@/lib/utils";

/**
 * Tâches de fond (mission 13, lot 3) : ce qui demande un regard d'abord (en
 * échec, en cours, en attente) ; les travaux périodiques et les tâches finies
 * repliés ; 50 lignes par page. Une tâche abandonnée par le ménage porte
 * « Abandonnée » et sa raison en première ligne.
 *
 * Mission 18 (A5) : un bloc de Paramètres › Système, et non plus un écran : plus
 * d'en-tête de page, un titre de section (l'ancienne adresse /taches-de-fond
 * redirige vers l'onglet). Les échecs ne font plus de compteur dans la
 * navigation : ils remontent comme tâche système dans Tâches.
 */

const TON_STATUT = {
  ECHEC_DEFINITIF: "rouge",
  EN_COURS: "bleu",
  EN_ATTENTE: "ambre",
  TERMINEE: "vert",
  ANNULEE: "neutre",
} as const;

const PAR_PAGE = 50;

function LigneTache({ tache, onChange }: { tache: TacheVue; onChange: () => void }) {
  const [occupee, setOccupee] = useState(false);

  async function agir(action: "relancer" | "annuler") {
    setOccupee(true);
    try {
      await envoyerJson(`/api/taches/${tache.id}/${action}`, "POST");
      toast.success(action === "relancer" ? "Tâche relancée" : "Tâche annulée");
      rafraichirCompteurs();
      onChange();
    } catch (erreur) {
      toast.error(action === "relancer" ? "Relance impossible" : "Annulation impossible", {
        description: messageErreur(erreur),
      });
    } finally {
      setOccupee(false);
    }
  }

  return (
    <li className="border-t-[0.5px] border-trait px-4 py-3 first:border-t-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[13.5px] font-medium text-texte">{tache.libelle}</p>
          {tache.abandonnee && tache.derniereErreur ? <p className="mt-1 text-[12.5px] leading-snug break-words text-attention-texte">{tache.derniereErreur}</p> : null}
          <p className="mt-0.5 text-[12px] text-texte-3">
            Demandée le {formatHorodatage(tache.createdAt)} · {tache.tentatives} tentative{tache.tentatives > 1 ? "s" : ""}
            {tache.statut === "EN_ATTENTE" && tache.tentatives > 0 ? ` · nouvel essai ${formatHorodatage(tache.prochainEssaiLe)}` : ""}
            {tache.termineLe && tache.statut === "TERMINEE" ? ` · terminée le ${formatHorodatage(tache.termineLe)}` : ""}
          </p>
        </div>
        {tache.abandonnee ? <Pastille ton="ambre">Abandonnée</Pastille> : <Pastille ton={TON_STATUT[tache.statut]}>{LIBELLES_STATUT_TACHE[tache.statut]}</Pastille>}
      </div>
      {tache.resume && tache.statut === "TERMINEE" ? <p className="mt-1.5 text-[12px] leading-snug break-words text-texte-3">{tache.resume}</p> : null}
      {tache.derniereErreur && !tache.abandonnee ? (
        <p className="mt-2 flex items-start gap-2 rounded-[8px] bg-attention/10 px-3 py-2 text-[12px] break-words text-attention-texte">
          <AlertTriangle size={13} aria-hidden className="mt-px shrink-0" />
          {tache.derniereErreur}
        </p>
      ) : null}
      {tache.statut === "ECHEC_DEFINITIF" || tache.statut === "EN_ATTENTE" ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {tache.statut === "ECHEC_DEFINITIF" ? (
            <Bouton taille="sm" icone={<RotateCw size={13} aria-hidden />} chargement={occupee} onClick={() => void agir("relancer")}>
              Relancer
            </Bouton>
          ) : null}
          <Bouton taille="sm" variante="fantome" icone={<Ban size={13} aria-hidden />} disabled={occupee} onClick={() => void agir("annuler")}>
            Annuler
          </Bouton>
        </div>
      ) : null}
    </li>
  );
}

/** Une section repliée : un bouton de 44 px, le nombre, le contenu au toucher. */
function Repli({ titre, nombre, ton, ouvertParDefaut = false, children }: { titre: string; nombre: number; ton?: "rouge"; ouvertParDefaut?: boolean; children: ReactNode }) {
  const [ouvert, setOuvert] = useState(ouvertParDefaut);
  return (
    <section className="mt-6">
      <button type="button" aria-expanded={ouvert} onClick={() => setOuvert((o) => !o)} className={cn("flex min-h-[44px] w-full items-center gap-2 rounded-[10px] px-1 text-left hover:bg-surface", TRANS)}>
        <span className="flex-1 text-[12px] font-medium tracking-wide text-texte-3 uppercase">{titre}</span>
        <span className={cn("text-[12px] tabular-nums", ton === "rouge" ? "text-attention-texte" : "text-texte-3")}>{nombre}</span>
        <ChevronDown size={16} aria-hidden className={cn("text-texte-3 transition-transform", ouvert && "rotate-180")} />
      </button>
      {ouvert ? <div className="mt-1.5">{children}</div> : null}
    </section>
  );
}

export default function EtatTaches({ initial }: { initial: Etat }) {
  const [etat, setEtat] = useState(initial);
  const [chargement, setChargement] = useState(false);
  const [pageAVoir, setPageAVoir] = useState(0);
  const [pageFinies, setPageFinies] = useState(0);

  const recharger = useCallback(async () => {
    setChargement(true);
    try {
      setEtat(await appelApi<Etat>("/api/taches"));
    } catch (erreur) {
      toast.error("Lecture impossible", { description: messageErreur(erreur) });
    } finally {
      setChargement(false);
    }
  }, []);

  const { compteurs } = etat;
  const aVoir = etat.taches.filter((t) => t.statut === "ECHEC_DEFINITIF" || t.statut === "EN_COURS" || t.statut === "EN_ATTENTE");
  const finies = etat.taches.filter((t) => t.statut === "TERMINEE" || t.statut === "ANNULEE");
  const totalFinies = compteurs.TERMINEE + compteurs.ANNULEE;
  const travauxEnEchec = etat.planifications.filter((p) => p.dernierStatut === "ECHEC").length;
  const tranche = (liste: TacheVue[], page: number) => liste.slice(page * PAR_PAGE, (page + 1) * PAR_PAGE);

  return (
    <section id="taches-de-fond" className="mb-10 scroll-mt-20">
      <TitreSection
        action={
          <Bouton taille="sm" icone={chargement ? <Loader2 size={13} className="animate-spin" aria-hidden /> : <RotateCw size={13} aria-hidden />} onClick={() => void recharger()}>
            Actualiser
          </Bouton>
        }
      >
        Tâches de fond
      </TitreSection>
      <p className={cn("-mt-1.5 mb-4 text-[12.5px]", compteurs.ECHEC_DEFINITIF > 0 ? "text-attention-texte" : "text-texte-3")}>
        {compteurs.ECHEC_DEFINITIF > 0
          ? `${compteurs.ECHEC_DEFINITIF} en échec : à relancer une fois la cause réglée.`
          : `${compteurs.EN_ATTENTE + compteurs.EN_COURS} en cours ou en attente · ${compteurs.TERMINEE} terminées`}
      </p>

      <section>
        <TitreSection>À voir · en échec, en cours, en attente ({aVoir.length})</TitreSection>
        {aVoir.length === 0 ? (
          <EtatVide icone={<CircleCheck size={18} className="text-action" aria-hidden />} titre="Rien en échec ni en attente" texte="Envois validés, miroir Drive, relève des mails et sauvegardes passent par ici." />
        ) : (
          <>
            <ul className="overflow-hidden rounded-[11px] border-[0.5px] border-trait bg-surface">
              {tranche(aVoir, pageAVoir).map((tache) => (
                <LigneTache key={tache.id} tache={tache} onChange={() => void recharger()} />
              ))}
            </ul>
            <Pagination total={aVoir.length} page={pageAVoir + 1} parPage={PAR_PAGE} feminin onPage={(p) => setPageAVoir(p - 1)} />
          </>
        )}
      </section>

      <Repli titre="Travaux périodiques" nombre={etat.planifications.length} ton={travauxEnEchec > 0 ? "rouge" : undefined} ouvertParDefaut={travauxEnEchec > 0}>
        {etat.planifications.length === 0 ? (
          <EtatVide titre="Aucun travail périodique" texte="Ils apparaissent dès qu'un volet (mail, Drive) est branché." />
        ) : (
          <ul className="overflow-hidden rounded-[11px] border-[0.5px] border-trait bg-surface">
            {etat.planifications.map((planification) => (
              <li key={planification.nom} className="border-t-[0.5px] border-trait px-4 py-3 first:border-t-0">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[13.5px] font-medium text-texte">{planification.libelle}</p>
                  {planification.dernierStatut === "ECHEC" ? (
                    <Pastille ton="rouge">
                      {planification.echecsConsecutifs} échec{planification.echecsConsecutifs > 1 ? "s" : ""} de suite
                    </Pastille>
                  ) : planification.dernierStatut === "IGNORE" ? (
                    <Pastille>Inactif</Pastille>
                  ) : planification.dernierStatut === "SUCCES" ? (
                    <Pastille ton="vert">
                      <CircleCheck size={11} aria-hidden />
                      OK
                    </Pastille>
                  ) : (
                    <Pastille>
                      <Clock size={11} aria-hidden />
                      Pas encore passé
                    </Pastille>
                  )}
                </div>
                <p className="mt-0.5 text-[12px] text-texte-3">
                  {planification.dernierDebut ? `Dernier passage ${formatHorodatage(planification.dernierDebut)}` : "Jamais passé"}
                  {planification.prochainPassage ? ` · prochain ${formatHorodatage(planification.prochainPassage)}` : ""}
                </p>
                {planification.derniereErreur && planification.dernierStatut === "ECHEC" ? (
                  <p className="mt-2 rounded-[8px] bg-attention/10 px-3 py-2 text-[12px] break-words text-attention-texte">{planification.derniereErreur}</p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Repli>

      <Repli titre="Terminées et annulées" nombre={totalFinies}>
        {finies.length === 0 ? (
          <EtatVide titre="Aucune tâche terminée" />
        ) : (
          <>
            <ul className="overflow-hidden rounded-[11px] border-[0.5px] border-trait bg-surface">
              {tranche(finies, pageFinies).map((tache) => (
                <LigneTache key={tache.id} tache={tache} onChange={() => void recharger()} />
              ))}
            </ul>
            <Pagination total={finies.length} page={pageFinies + 1} parPage={PAR_PAGE} feminin onPage={(p) => setPageFinies(p - 1)} />
            {finies.length < totalFinies ? <p className="mt-2 text-[12px] text-texte-3">Les {finies.length} plus récentes sur {totalFinies}.</p> : null}
          </>
        )}
      </Repli>
    </section>
  );
}
