"use client";

import { RotateCcw, WandSparkles } from "lucide-react";
import { Bouton, Pastille, TRANS } from "@/components/pilotage/ui";
import { Visionneuse } from "@/components/pilotage/Visionneuse";
import type { VueEspaceCrm } from "@/lib/espace/vue-crm";
import { jour, jourHeure } from "@/lib/commun/format";
import { cn } from "@/lib/utils";
import { Rubrique, type ConfirmationEspace, type FaireGeste } from "./RubriqueEspace";

const LIBELLES_SOURCE: Record<string, string> = { SITE: "Faite sur le site", CLIENT: "Créée par le client", API: "Préparée par moi", CHATGPT: "Préparée par moi", MANUEL: "Déposée par moi" };

/** Mission 13 (lot 7) : la rubrique « Ses simulations » de l'espace client vu du dossier — sa demande d'une autre proposition, sa galerie (valider, dévalider, masquer, publier), son mélange validé, les simulations accordées. */
export function RubriqueSimulationsEspace({
  espace,
  occupe,
  geste,
  simulation,
  simulationOuverte,
  setSimulationOuverte,
  setConfirmation,
}: {
  espace: VueEspaceCrm;
  occupe: string | null;
  geste: FaireGeste;
  /** Masquer ou republier une simulation (elle reste dans sa galerie). */
  simulation: (id: string, action: "masquer" | "afficher") => Promise<void>;
  simulationOuverte: number | null;
  setSimulationOuverte: (index: number | null) => void;
  setConfirmation: (confirmation: ConfirmationEspace) => void;
}) {
  return (
    <Rubrique
      titre="Ses simulations"
      etat={
        <Pastille ton={espace.creation.restantes === 0 ? "ambre" : "neutre"}>
          {espace.creation.faites} faite{espace.creation.faites > 1 ? "s" : ""} sur {espace.creation.offertes}
          {espace.creation.faitesSite ? ` (dont ${espace.creation.faitesSite} sur le site)` : ""} · {espace.creation.restantes} restante{espace.creation.restantes > 1 ? "s" : ""}
        </Pastille>
      }
    >
      {espace.proposition ? (
        <div className="mb-2 rounded-[8px] border-[0.5px] border-attention-texte/40 bg-attention-texte/10 p-2.5">
          <p className="text-[12px] font-medium text-attention-texte">Il demande une autre proposition — le {jourHeure(espace.proposition.le)}</p>
          {espace.proposition.message ? <p className="mt-1 text-[13px] leading-relaxed whitespace-pre-wrap text-texte">« {espace.proposition.message} »</p> : <p className="mt-1 text-[12px] text-texte-3">Sans message.</p>}
          <button type="button" disabled={occupe !== null} onClick={() => void geste({ geste: "retirer-demande" }, "Demande retirée")} className={cn("mt-1.5 text-[11.5px] font-medium text-texte-2 underline-offset-2 hover:underline disabled:opacity-50", TRANS)}>
            Retirer sa demande (traitée autrement)
          </button>
        </div>
      ) : null}
      {espace.creation.demandeesLe ? <p className="mb-2 text-[12.5px] text-attention-texte">Il demande d&apos;autres simulations depuis le {jour(espace.creation.demandeesLe)}.</p> : null}
      {simulationOuverte !== null && espace.simulations[simulationOuverte] ? <Visionneuse images={espace.simulations.map((s) => ({ id: s.id, url: s.url, legende: [s.titre, LIBELLES_SOURCE[s.source] ?? s.source, jour(s.le)].filter(Boolean).join(" · ") }))} index={simulationOuverte} onIndex={setSimulationOuverte} onFermer={() => setSimulationOuverte(null)} /> : null}
      {espace.simulations.length ? (
        <ul className="space-y-1.5">
          {espace.simulations.map((s, index) => (
            <li key={s.id} className={cn("flex gap-2.5 rounded-[8px] border-[0.5px] p-1.5", s.choisie ? "border-action/60 bg-action/10" : "border-trait bg-fond")}>
              <button type="button" onClick={() => setSimulationOuverte(index)} aria-label={`Agrandir ${s.titre ?? "la simulation"}`} className="block h-14 w-20 shrink-0 overflow-hidden rounded-[6px]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={s.url} alt={s.titre ?? "Simulation"} loading="lazy" className={cn("h-full w-full object-cover", s.statut !== "PUBLIEE" && "opacity-50")} />
              </button>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1">
                  <span className="text-[11px] text-texte-3">{LIBELLES_SOURCE[s.source] ?? s.source} · {jour(s.le)}</span>
                  {s.choisie ? <Pastille ton="vert">Validée</Pastille> : null}
                  {s.statut === "BROUILLON" ? <Pastille ton="ambre">Brouillon</Pastille> : s.statut === "MASQUEE" ? <Pastille>Masquée</Pastille> : null}
                </div>
                <p className="line-clamp-2 text-[12.5px] text-texte-2">{s.zones.map((z) => `${z.libelle || z.zone} : ${z.nom || z.ref}`).join(" · ") || s.titre || "Simulation"}</p>
                {s.commentaire ? <p className="text-[12px] whitespace-pre-wrap text-texte">« {s.commentaire} »</p> : null}
                <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11.5px] font-medium">
                  {s.statut === "PUBLIEE" && !s.choisie ? (
                    <button type="button" disabled={occupe !== null} onClick={() => void geste({ geste: "valider-simulation", simulationId: s.id }, "Simulation validée à sa place : le devis est à préparer")} className={cn("text-action-clair hover:underline disabled:opacity-50", TRANS)}>
                      Valider à sa place
                    </button>
                  ) : null}
                  {s.choisie ? (
                    <button type="button" disabled={occupe !== null} onClick={() => void geste({ geste: "devalider-simulation" }, "Simulation dévalidée")} className={cn("text-texte-2 hover:underline disabled:opacity-50", TRANS)}>
                      Dévalider
                    </button>
                  ) : null}
                  {s.statut === "PUBLIEE" ? (
                    <button type="button" disabled={occupe !== null} onClick={() => void simulation(s.id, "masquer")} className={cn("text-texte-3 hover:text-texte-2 hover:underline disabled:opacity-50", TRANS)}>
                      Masquer
                    </button>
                  ) : (
                    <button type="button" disabled={occupe !== null} onClick={() => void simulation(s.id, "afficher")} className={cn("text-action-clair hover:underline disabled:opacity-50", TRANS)}>
                      {s.statut === "BROUILLON" ? "Publier" : "Republier"}
                    </button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[12.5px] text-texte-3">Aucune simulation pour l&apos;instant.</p>
      )}
      {espace.choix?.mode === "COMPOSITE" ? <p className="mt-1.5 text-[12.5px] text-action-clair">Son mélange validé : {espace.choix.zones.map((z) => `${z.libelle || z.zone} — ${z.nom || z.ref}`).join(" · ")}</p> : null}
      {espace.choix?.commentaire ? <p className="mt-1 text-[12.5px] text-texte">Son mot en validant : « {espace.choix.commentaire} »</p> : null}
      <div className="mt-2 flex flex-wrap gap-1.5">
        <Bouton taille="sm" variante={espace.creation.demandeesLe ? "primaire" : "secondaire"} icone={<WandSparkles size={13} aria-hidden />} chargement={occupe === "accorder"} onClick={() => void geste({ geste: "accorder", nombre: 3 }, "3 simulations accordées : le client peut en refaire")}>
          Accorder 3 simulations
        </Bouton>
        {espace.choix || espace.proposition ? (
          <Bouton taille="sm" variante="fantome" icone={<RotateCcw size={13} aria-hidden />} onClick={() => setConfirmation({ titre: "Réinitialiser l'étape « Simulations » ?", texte: "Plus aucune simulation n'est validée et sa demande en attente est retirée. Ses simulations restent dans sa galerie.", bouton: "Réinitialiser", geste: { geste: "reinitialiser", etape: "SIMULATIONS" }, succes: "Étape « Simulations » réinitialisée" })}>
            Réinitialiser
          </Bouton>
        ) : null}
      </div>
      {espace.favoris.length ? <p className="mt-1.5 text-[11.5px] text-texte-3">Ses teintes favorites : {espace.favoris.join(", ")}</p> : null}
    </Rubrique>
  );
}
