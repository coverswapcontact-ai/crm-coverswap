"use client";

import { Heading } from "lucide-react";
import { LIBELLES_UNITE, UNITES } from "@/lib/dossiers/constants";
import { formatCentimes, lireNombre, totalLigneCentimes } from "@/lib/dossiers/montants";
import { cn } from "@/lib/utils";
import { CLASSE_SAISIE } from "@/components/pilotage/ui";
import { ActionsLigne } from "./ActionsLigne";
import type { Erreurs, LigneSaisie } from "./generateur-lignes";

/** Mission 13 (lot 7) : une ligne du générateur de document en cours de saisie — section (libellé) ou prestation (désignation, quantité, unité, prix unitaire), avec son total, ses erreurs et ses actions. */
export function LigneGenerateur({
  ligne,
  premiere,
  derniere,
  erreurs,
  modifier,
  deplacer,
  supprimer,
}: {
  ligne: LigneSaisie;
  premiere: boolean;
  derniere: boolean;
  erreurs: Erreurs;
  modifier: (cle: string, champs: Partial<Record<string, string>>) => void;
  deplacer: (cle: string, sens: -1 | 1) => void;
  supprimer: (cle: string) => void;
}) {
  return (
    <li>
      {ligne.type === "SECTION" ? (
        <div className="rounded-[9px] border-[0.5px] border-[#3A3E47] bg-[#2A2D34]/50 p-2">
          <div className="flex items-center gap-2">
            <Heading size={14} className="ml-1 shrink-0 text-[#9CA3AF]" aria-hidden />
            <input
              aria-label="Libellé de la section"
              value={ligne.libelle}
              maxLength={120}
              onChange={(evenement) => modifier(ligne.cle, { libelle: evenement.target.value })}
              placeholder="Section (ex. CUISINE, DRESSING N°1 — CHAMBRE)"
              aria-invalid={erreurs[`${ligne.cle}:libelle`] ? true : undefined}
              className={cn(CLASSE_SAISIE, "h-11 font-medium sm:h-8")}
            />
            <ActionsLigne
              premiere={premiere}
              derniere={derniere}
              onMonter={() => deplacer(ligne.cle, -1)}
              onDescendre={() => deplacer(ligne.cle, 1)}
              onSupprimer={() => supprimer(ligne.cle)}
            />
          </div>
          {erreurs[`${ligne.cle}:libelle`] ? (
            <p className="mt-1.5 pl-7 text-[12px] text-[#F87171]">{erreurs[`${ligne.cle}:libelle`]}</p>
          ) : null}
        </div>
      ) : (
        <div className="rounded-[9px] border-[0.5px] border-[#2A2D34] bg-[#16181D] p-2.5">
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_72px_92px_96px_96px_108px] sm:items-start">
            <div className="space-y-1.5">
              <input
                aria-label="Désignation"
                value={ligne.designation}
                maxLength={200}
                onChange={(evenement) => modifier(ligne.cle, { designation: evenement.target.value })}
                placeholder="Désignation"
                aria-invalid={erreurs[`${ligne.cle}:designation`] ? true : undefined}
                className={cn(CLASSE_SAISIE, "h-11 sm:h-8")}
              />
              <input
                aria-label="Sous-désignation"
                value={ligne.sousDesignation}
                maxLength={200}
                onChange={(evenement) => modifier(ligne.cle, { sousDesignation: evenement.target.value })}
                placeholder="Sous-désignation (facultative)"
                className={cn(CLASSE_SAISIE, "h-11 font-semibold italic sm:h-8")}
              />
            </div>
            <div className="grid grid-cols-3 gap-2 sm:contents">
              <input
                aria-label="Quantité"
                inputMode="decimal"
                value={ligne.quantite}
                onChange={(evenement) => modifier(ligne.cle, { quantite: evenement.target.value })}
                aria-invalid={erreurs[`${ligne.cle}:quantite`] ? true : undefined}
                className={cn(CLASSE_SAISIE, "h-11 text-center sm:h-8")}
              />
              <select
                aria-label="Unité"
                value={ligne.unite}
                onChange={(evenement) => modifier(ligne.cle, { unite: evenement.target.value })}
                className={cn(CLASSE_SAISIE, "h-11 px-2 sm:h-8")}
              >
                {UNITES.map((unite) => (
                  <option key={unite} value={unite}>
                    {LIBELLES_UNITE[unite]}
                  </option>
                ))}
              </select>
              <input
                aria-label="Prix unitaire HT"
                inputMode="decimal"
                value={ligne.prixUnitaire}
                onChange={(evenement) => modifier(ligne.cle, { prixUnitaire: evenement.target.value })}
                placeholder="PU HT"
                aria-invalid={erreurs[`${ligne.cle}:prixUnitaire`] ? true : undefined}
                className={cn(CLASSE_SAISIE, "h-11 text-right sm:h-8")}
              />
            </div>
            <div className="flex items-center justify-between gap-2 sm:contents">
              <span className="text-[13px] text-[#F2F3F5] tabular-nums sm:pt-1.5 sm:text-right">
                {(() => {
                  const quantite = lireNombre(ligne.quantite);
                  const prixUnitaire = lireNombre(ligne.prixUnitaire);
                  return quantite !== null && prixUnitaire !== null
                    ? formatCentimes(totalLigneCentimes({ quantite, prixUnitaire }))
                    : "—";
                })()}
              </span>
              <ActionsLigne
                premiere={premiere}
                derniere={derniere}
                onMonter={() => deplacer(ligne.cle, -1)}
                onDescendre={() => deplacer(ligne.cle, 1)}
                onSupprimer={() => supprimer(ligne.cle)}
              />
            </div>
          </div>
          {[
            erreurs[`${ligne.cle}:designation`],
            erreurs[`${ligne.cle}:quantite`],
            erreurs[`${ligne.cle}:prixUnitaire`],
          ].filter(Boolean).length > 0 ? (
            <p className="mt-1.5 text-[12px] text-[#F87171]">
              {[
                erreurs[`${ligne.cle}:designation`],
                erreurs[`${ligne.cle}:quantite`],
                erreurs[`${ligne.cle}:prixUnitaire`],
              ]
                .filter(Boolean)
                .join(" ")}
            </p>
          ) : null}
        </div>
      )}
    </li>
  );
}
