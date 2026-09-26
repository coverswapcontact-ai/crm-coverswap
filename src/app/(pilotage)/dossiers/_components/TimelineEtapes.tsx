"use client";

import { useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { toast } from "sonner";
import {
  ETAPES_ACTIVES,
  ETAPES_SORTIE,
  LIBELLES_ETAPE,
  REGLES_ETAPES,
  type EtapeDossier,
} from "@/lib/dossiers/constants";
import { formatHorodatage } from "@/lib/dossiers/dates";
import { estEtapeActive, rangEtape } from "@/lib/dossiers/regles";
import type { DossierDetail } from "@/lib/dossiers/types";
import { cn } from "@/lib/utils";
import { envoyerJson, messageErreur } from "./client";
import { Bouton, CLASSE_SAISIE, COULEURS_ETAPE, TRANS } from "./ui";

type Statut = "passee" | "courante" | "a-venir";

/** Timeline verticale des étapes ; sous chaque étape, ses notes et un champ d'ajout. */
export function TimelineEtapes({
  detail,
  onNoteAjoutee,
}: {
  detail: DossierDetail;
  onNoteAjoutee: () => Promise<void>;
}) {
  // Étape de référence pour « passé / à venir » : l'étape active, ou celle
  // quittée pour une sortie (perdu, en pause).
  const reference = estEtapeActive(detail.etape) ? detail.etape : detail.etapeAvantSortie;
  const rangReference = reference ? rangEtape(reference) : -1;
  const etapes: EtapeDossier[] = [
    ...ETAPES_ACTIVES,
    ...ETAPES_SORTIE.filter((sortie) => sortie === detail.etape || detail.notes.some((note) => note.etape === sortie)),
  ];

  const [ouvertes, setOuvertes] = useState<EtapeDossier[]>([detail.etape]);
  const [etapeSuivie, setEtapeSuivie] = useState(detail.etape);
  // Quand le dossier change d'étape, la nouvelle étape s'ouvre d'elle-même.
  if (etapeSuivie !== detail.etape) {
    setEtapeSuivie(detail.etape);
    setOuvertes((actuelles) => (actuelles.includes(detail.etape) ? actuelles : [...actuelles, detail.etape]));
  }

  const basculer = (etape: EtapeDossier) =>
    setOuvertes((actuelles) =>
      actuelles.includes(etape) ? actuelles.filter((e) => e !== etape) : [...actuelles, etape]
    );

  return (
    <ol>
      {etapes.map((etape, index) => {
        const statut: Statut =
          etape === detail.etape
            ? "courante"
            : estEtapeActive(etape) && rangEtape(etape) < rangReference
              ? "passee"
              : "a-venir";
        const notes = detail.notes.filter((note) => note.etape === etape);
        const ouverte = ouvertes.includes(etape);
        const couleur = COULEURS_ETAPE[etape];
        const derniere = index === etapes.length - 1;

        return (
          <li key={etape} className="relative pb-1 pl-8">
            {!derniere ? (
              <span
                aria-hidden
                className="absolute top-5 bottom-0 left-[7px] w-px"
                style={{ backgroundColor: statut === "passee" ? `${couleur}66` : "#2A2D34" }}
              />
            ) : null}
            <span
              aria-hidden
              className={cn(
                "absolute top-[7px] left-0 flex h-[15px] w-[15px] items-center justify-center rounded-full border",
                statut === "a-venir" && "border-[#3A3E47] bg-[#16181D]"
              )}
              style={
                statut === "courante"
                  ? { borderColor: couleur, backgroundColor: `${couleur}33`, boxShadow: `0 0 0 4px ${couleur}22` }
                  : statut === "passee"
                    ? { borderColor: couleur, backgroundColor: couleur }
                    : undefined
              }
            >
              {statut === "passee" ? <Check size={9} strokeWidth={3} className="text-[#0B1612]" /> : null}
            </span>

            <button
              type="button"
              aria-expanded={ouverte}
              onClick={() => basculer(etape)}
              className={cn(
                "flex min-h-[36px] w-full items-center justify-between gap-2 rounded-[8px] px-2 text-left hover:bg-[#1C1F25]",
                statut === "courante" && "bg-[#1C1F25]",
                TRANS
              )}
            >
              <span
                className={cn(
                  "flex items-center gap-2 text-[13px]",
                  statut === "courante" ? "font-medium text-[#F2F3F5]" : statut === "passee" ? "text-[#D1D5DB]" : "text-[#6B7280]"
                )}
              >
                {LIBELLES_ETAPE[etape]}
                {statut === "courante" ? (
                  <span
                    className="rounded-full px-1.5 py-px text-[10px] font-medium"
                    style={{ color: couleur, backgroundColor: `${couleur}1A` }}
                  >
                    étape actuelle
                  </span>
                ) : null}
              </span>
              <span className="flex items-center gap-1.5 text-[11px] text-[#6B7280]">
                {notes.length > 0 ? `${notes.length} note${notes.length > 1 ? "s" : ""}` : null}
                <ChevronDown size={14} aria-hidden className={cn("transition-transform", ouverte && "rotate-180")} />
              </span>
            </button>

            {ouverte ? (
              <div className="mt-1 mb-3 space-y-2 pl-2">
                <p className="text-[12px] text-[#6B7280]">{REGLES_ETAPES[etape].description}</p>
                {notes.map((note) => (
                  <div key={note.id} className="rounded-[8px] border-[0.5px] border-[#2A2D34] bg-[#1C1F25] px-3 py-2">
                    <p className="text-[13px] leading-relaxed whitespace-pre-wrap text-[#E5E7EB]">{note.contenu}</p>
                    <p className="mt-1 text-[11px] text-[#6B7280]">{formatHorodatage(note.createdAt)}</p>
                  </div>
                ))}
                <AjoutNote dossierId={detail.id} etape={etape} onAjoutee={onNoteAjoutee} />
              </div>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

function AjoutNote({
  dossierId,
  etape,
  onAjoutee,
}: {
  dossierId: string;
  etape: EtapeDossier;
  onAjoutee: () => Promise<void>;
}) {
  const [contenu, setContenu] = useState("");
  const [envoi, setEnvoi] = useState(false);

  async function ajouter() {
    if (!contenu.trim() || envoi) return;
    setEnvoi(true);
    try {
      await envoyerJson(`/api/dossiers/${dossierId}/notes`, "POST", { etape, contenu });
      setContenu("");
      await onAjoutee();
    } catch (probleme) {
      toast.error("Note non enregistrée", { description: messageErreur(probleme) });
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <div className="flex items-end gap-2">
      <textarea
        aria-label={`Ajouter une note à l'étape ${LIBELLES_ETAPE[etape]}`}
        value={contenu}
        rows={1}
        maxLength={4000}
        placeholder="Ajouter une note…"
        onChange={(evenement) => setContenu(evenement.target.value)}
        onKeyDown={(evenement) => {
          if (evenement.key === "Enter" && (evenement.metaKey || evenement.ctrlKey)) {
            evenement.preventDefault();
            void ajouter();
          }
        }}
        className={cn(CLASSE_SAISIE, "field-sizing-content max-h-40 min-h-11 resize-none py-2 leading-relaxed sm:min-h-9")}
      />
      <Bouton variante="secondaire" disabled={!contenu.trim()} chargement={envoi} onClick={() => void ajouter()}>
        Ajouter
      </Bouton>
    </div>
  );
}
