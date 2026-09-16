"use client";

import { useCallback, useState } from "react";
import { AlertTriangle, Ban, CircleCheck, Clock, Loader2, RotateCw } from "lucide-react";
import { toast } from "sonner";
import { appelApi, envoyerJson, messageErreur } from "@/components/pilotage/client";
import { rafraichirCompteurs } from "@/components/pilotage/Navigation";
import { Bouton, EnTetePage, EtatVide, Pastille, TitreSection } from "@/components/pilotage/ui";
import { formatHorodatage } from "@/lib/dossiers/dates";
import { LIBELLES_STATUT_TACHE } from "@/lib/taches/statuts";
import type { EtatTaches as Etat, TacheVue } from "@/lib/taches/lecture";

const TON_STATUT = {
  ECHEC_DEFINITIF: "rouge",
  EN_COURS: "bleu",
  EN_ATTENTE: "ambre",
  TERMINEE: "vert",
  ANNULEE: "neutre",
} as const;

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
          <p className="mt-0.5 text-[12px] text-[#6B7280]">
            Demandée le {formatHorodatage(tache.createdAt)} · {tache.tentatives} tentative{tache.tentatives > 1 ? "s" : ""}
            {tache.statut === "EN_ATTENTE" && tache.tentatives > 0
              ? ` · nouvel essai ${formatHorodatage(tache.prochainEssaiLe)}`
              : ""}
            {tache.termineLe && tache.statut === "TERMINEE" ? ` · terminée le ${formatHorodatage(tache.termineLe)}` : ""}
          </p>
        </div>
        <Pastille ton={TON_STATUT[tache.statut]}>{LIBELLES_STATUT_TACHE[tache.statut]}</Pastille>
      </div>
      {tache.derniereErreur ? (
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

export default function EtatTaches({ initial }: { initial: Etat }) {
  const [etat, setEtat] = useState(initial);
  const [chargement, setChargement] = useState(false);

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
          <Bouton
            icone={chargement ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <RotateCw size={14} aria-hidden />}
            onClick={() => void recharger()}
          >
            Actualiser
          </Bouton>
        }
      />

      <section className="mt-6">
        <TitreSection>Travaux périodiques</TitreSection>
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
                  <p className="mt-2 rounded-[8px] bg-[#EF4444]/10 px-3 py-2 text-[12px] break-words text-[#F87171]">
                    {planification.derniereErreur}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-8">
        <TitreSection>Tâches</TitreSection>
        {etat.taches.length === 0 ? (
          <EtatVide
            icone={<CircleCheck size={18} className="text-[#1D9E75]" aria-hidden />}
            titre="Aucune tâche"
            texte="Envois validés, miroir Drive et relève des mails passeront par ici."
          />
        ) : (
          <ul className="overflow-hidden rounded-[11px] border-[0.5px] border-[#2A2D34] bg-[#1C1F25]">
            {etat.taches.map((tache) => (
              <LigneTache key={tache.id} tache={tache} onChange={() => void recharger()} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
