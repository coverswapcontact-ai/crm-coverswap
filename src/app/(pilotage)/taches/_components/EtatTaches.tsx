"use client";

import { useCallback, useState, type ReactNode } from "react";
import { AlertTriangle, Ban, ChevronDown, CircleCheck, Clock, Loader2, RotateCw } from "lucide-react";
import { toast } from "sonner";
import { appelApi, envoyerJson, messageErreur } from "@/components/pilotage/client";
import { rafraichirCompteurs } from "@/components/pilotage/Navigation";
import { Bouton, EnTetePage, EtatVide, Pastille, TitreSection, TRANS } from "@/components/pilotage/ui";
import { formatHorodatage } from "@/lib/dossiers/dates";
import { LIBELLES_STATUT_TACHE } from "@/lib/taches/statuts";
import type { EtatTaches as Etat, TacheVue } from "@/lib/taches/lecture";
import { cn } from "@/lib/utils";

/**
 * Tâches de fond (mission 13, lot 3) : l'en-tête en haut ; ce qui demande un
 * regard d'abord (en échec, en cours, en attente) ; les travaux périodiques et
 * les tâches finies repliés ; 50 lignes par page. Une tâche abandonnée par le
 * ménage porte « Abandonnée » et sa raison en première ligne.
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
    <li className="border-t-[0.5px] border-[#2A2D34] px-4 py-3 first:border-t-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[13.5px] font-medium text-[#F2F3F5]">{tache.libelle}</p>
          {tache.abandonnee && tache.derniereErreur ? <p className="mt-1 text-[12.5px] leading-snug break-words text-[#F5B454]">{tache.derniereErreur}</p> : null}
          <p className="mt-0.5 text-[12px] text-[#6B7280]">
            Demandée le {formatHorodatage(tache.createdAt)} · {tache.tentatives} tentative{tache.tentatives > 1 ? "s" : ""}
            {tache.statut === "EN_ATTENTE" && tache.tentatives > 0 ? ` · nouvel essai ${formatHorodatage(tache.prochainEssaiLe)}` : ""}
            {tache.termineLe && tache.statut === "TERMINEE" ? ` · terminée le ${formatHorodatage(tache.termineLe)}` : ""}
          </p>
        </div>
        {tache.abandonnee ? <Pastille ton="ambre">Abandonnée</Pastille> : <Pastille ton={TON_STATUT[tache.statut]}>{LIBELLES_STATUT_TACHE[tache.statut]}</Pastille>}
      </div>
      {tache.resume && tache.statut === "TERMINEE" ? <p className="mt-1.5 text-[12px] leading-snug break-words text-[#9CA3AF]">{tache.resume}</p> : null}
      {tache.derniereErreur && !tache.abandonnee ? (
        <p className="mt-2 flex items-start gap-2 rounded-[8px] bg-[#EF4444]/10 px-3 py-2 text-[12px] break-words text-[#F87171]">
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
      <button type="button" aria-expanded={ouvert} onClick={() => setOuvert((o) => !o)} className={cn("flex min-h-[44px] w-full items-center gap-2 rounded-[10px] px-1 text-left hover:bg-[#1C1F25]", TRANS)}>
        <span className="flex-1 text-[12px] font-medium tracking-wide text-[#9CA3AF] uppercase">{titre}</span>
        <span className={cn("text-[12px] tabular-nums", ton === "rouge" ? "text-[#F87171]" : "text-[#6B7280]")}>{nombre}</span>
        <ChevronDown size={16} aria-hidden className={cn("text-[#6B7280] transition-transform", ouvert && "rotate-180")} />
      </button>
      {ouvert ? <div className="mt-1.5">{children}</div> : null}
    </section>
  );
}

function Pagination({ total, page, onPage }: { total: number; page: number; onPage: (page: number) => void }) {
  if (total <= PAR_PAGE) return null;
  const derniere = Math.ceil(total / PAR_PAGE) - 1;
  return (
    <div className="mt-2 flex items-center justify-between gap-2 text-[12.5px] text-[#9CA3AF]">
      <span className="tabular-nums">
        {page * PAR_PAGE + 1}–{Math.min((page + 1) * PAR_PAGE, total)} sur {total}
      </span>
      <span className="flex gap-1.5">
        <Bouton taille="sm" variante="fantome" disabled={page === 0} onClick={() => onPage(page - 1)} className="min-h-[44px]">
          Précédentes
        </Bouton>
        <Bouton taille="sm" variante="fantome" disabled={page >= derniere} onClick={() => onPage(page + 1)} className="min-h-[44px]">
          Suivantes
        </Bouton>
      </span>
    </div>
  );
}

export default function EtatTaches({ initial, children }: { initial: Etat; children?: ReactNode }) {
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
    <div className="mx-auto w-full max-w-3xl px-5 py-6 md:px-8 md:py-8">
      <EnTetePage
        titre="Tâches de fond"
        sousTitre={
          compteurs.ECHEC_DEFINITIF > 0 ? (
            <span className="text-[#F87171]">
              {compteurs.ECHEC_DEFINITIF} en échec : à relancer une fois la cause réglée.
            </span>
          ) : (
            `${compteurs.EN_ATTENTE + compteurs.EN_COURS} en cours ou en attente · ${compteurs.TERMINEE} terminées`
          )
        }
        actions={
          <Bouton icone={chargement ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <RotateCw size={14} aria-hidden />} onClick={() => void recharger()}>
            Actualiser
          </Bouton>
        }
      />

      <section className="mt-6">
        <TitreSection>À voir · en échec, en cours, en attente ({aVoir.length})</TitreSection>
        {aVoir.length === 0 ? (
          <EtatVide icone={<CircleCheck size={18} className="text-[#1D9E75]" aria-hidden />} titre="Rien en échec ni en attente" texte="Envois validés, miroir Drive, relève des mails et sauvegardes passent par ici." />
        ) : (
          <>
            <ul className="overflow-hidden rounded-[11px] border-[0.5px] border-[#2A2D34] bg-[#1C1F25]">
              {tranche(aVoir, pageAVoir).map((tache) => (
                <LigneTache key={tache.id} tache={tache} onChange={() => void recharger()} />
              ))}
            </ul>
            <Pagination total={aVoir.length} page={pageAVoir} onPage={setPageAVoir} />
          </>
        )}
      </section>

      <Repli titre="Travaux périodiques" nombre={etat.planifications.length} ton={travauxEnEchec > 0 ? "rouge" : undefined} ouvertParDefaut={travauxEnEchec > 0}>
        {etat.planifications.length === 0 ? (
          <EtatVide titre="Aucun travail périodique" texte="Ils apparaissent dès qu'un volet (mail, Drive) est branché." />
        ) : (
          <ul className="overflow-hidden rounded-[11px] border-[0.5px] border-[#2A2D34] bg-[#1C1F25]">
            {etat.planifications.map((planification) => (
              <li key={planification.nom} className="border-t-[0.5px] border-[#2A2D34] px-4 py-3 first:border-t-0">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[13.5px] font-medium text-[#F2F3F5]">{planification.libelle}</p>
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
                <p className="mt-0.5 text-[12px] text-[#6B7280]">
                  {planification.dernierDebut ? `Dernier passage ${formatHorodatage(planification.dernierDebut)}` : "Jamais passé"}
                  {planification.prochainPassage ? ` · prochain ${formatHorodatage(planification.prochainPassage)}` : ""}
                </p>
                {planification.derniereErreur && planification.dernierStatut === "ECHEC" ? (
                  <p className="mt-2 rounded-[8px] bg-[#EF4444]/10 px-3 py-2 text-[12px] break-words text-[#F87171]">{planification.derniereErreur}</p>
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
            <ul className="overflow-hidden rounded-[11px] border-[0.5px] border-[#2A2D34] bg-[#1C1F25]">
              {tranche(finies, pageFinies).map((tache) => (
                <LigneTache key={tache.id} tache={tache} onChange={() => void recharger()} />
              ))}
            </ul>
            <Pagination total={finies.length} page={pageFinies} onPage={setPageFinies} />
            {finies.length < totalFinies ? <p className="mt-2 text-[12px] text-[#6B7280]">Les {finies.length} plus récentes sur {totalFinies}.</p> : null}
          </>
        )}
      </Repli>

      {children}
    </div>
  );
}
