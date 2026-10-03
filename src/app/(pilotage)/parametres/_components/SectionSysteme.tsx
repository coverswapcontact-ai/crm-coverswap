"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Loader2, RotateCw } from "lucide-react";
import { appelApi, messageErreur } from "@/components/pilotage/client";
import { Bouton, TitreSection } from "@/components/pilotage/ui";
import type { SessionVue } from "@/lib/assistant/execution";
import type { AuditConnexions as Audit } from "@/lib/audit/connexions";
import type { RapportCoherence } from "@/lib/coherence/controle";
import type { EtatTaches as Etat } from "@/lib/taches/lecture";
import AuditConnexions from "./AuditConnexions";
import ControleCoherence from "./ControleCoherence";
import EtatTaches from "./EtatTaches";
import SessionsAssistant from "./SessionsAssistant";

/**
 * Mission 18 (A5) — Paramètres › Système : l'ancien écran Tâches de fond (/taches-de-fond y redirige), dans le même
 * ordre : la file des tâches de fond et les travaux périodiques, le contrôle de cohérence, l'audit des connexions, les
 * sessions de l'assistant Claude.
 *
 * Chaque bloc se lit à l'ouverture de l'onglet, par sa propre route (celle de son bouton « Actualiser ») : le contrôle
 * de cohérence parcourt tous les dossiers, il ne doit ralentir ni la page Paramètres ni les autres onglets. Un bloc
 * en panne n'empêche pas les autres de s'afficher.
 */

type Lecture<T> = { etat: "chargement" } | { etat: "pret"; valeur: T } | { etat: "erreur"; message: string };

function Bloc<T>({ id, titre, url, children }: { id: string; titre: string; url: string; children: (valeur: T) => ReactNode }) {
  const [lecture, setLecture] = useState<Lecture<T>>({ etat: "chargement" });
  const [essai, setEssai] = useState(0);

  useEffect(() => {
    let actif = true;
    appelApi<T>(url)
      .then((valeur) => {
        if (actif) setLecture({ etat: "pret", valeur });
      })
      .catch((erreur) => {
        if (actif) setLecture({ etat: "erreur", message: messageErreur(erreur) });
      });
    return () => {
      actif = false;
    };
  }, [url, essai]);

  // Une ancre (#coherence, #audit…) vise un bloc lu après coup : on y descend une fois qu'il est affiché.
  const pret = lecture.etat === "pret";
  useEffect(() => {
    if (pret && window.location.hash === `#${id}`) document.getElementById(id)?.scrollIntoView({ block: "start" });
  }, [pret, id]);

  if (lecture.etat === "pret") return <>{children(lecture.valeur)}</>;
  return (
    <section id={id} className="mb-10 scroll-mt-20" aria-busy={lecture.etat === "chargement"}>
      <TitreSection>{titre}</TitreSection>
      {lecture.etat === "chargement" ? (
        <p className="flex items-center gap-2 rounded-[11px] border-[0.5px] border-dashed border-[#2A2D34] px-4 py-6 text-[12.5px] text-[#6B7280]">
          <Loader2 size={14} className="animate-spin" aria-hidden />
          Lecture en cours…
        </p>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-[11px] border-[0.5px] border-[#EF4444]/40 bg-[#EF4444]/10 px-4 py-3">
          <p className="min-w-0 text-[12.5px] break-words text-[#F87171]">Lecture impossible : {lecture.message}</p>
          <Bouton
            taille="sm"
            icone={<RotateCw size={13} aria-hidden />}
            onClick={() => {
              setLecture({ etat: "chargement" });
              setEssai((n) => n + 1);
            }}
          >
            Réessayer
          </Bouton>
        </div>
      )}
    </section>
  );
}

export default function SectionSysteme() {
  return (
    <div className="mt-6">
      <Bloc<Etat> id="taches-de-fond" titre="Tâches de fond" url="/api/taches">
        {(etat) => <EtatTaches initial={etat} />}
      </Bloc>
      <Bloc<RapportCoherence> id="coherence" titre="Cohérence" url="/api/coherence">
        {(rapport) => <ControleCoherence initial={rapport} />}
      </Bloc>
      <Bloc<Audit> id="audit" titre="Connexions du CRM" url="/api/audit/connexions">
        {(audit) => <AuditConnexions initial={audit} />}
      </Bloc>
      <Bloc<{ sessions: SessionVue[] }> id="sessions" titre="Sessions de l'assistant Claude" url="/api/assistant/sessions">
        {({ sessions }) => <SessionsAssistant initial={sessions} />}
      </Bloc>
    </div>
  );
}
