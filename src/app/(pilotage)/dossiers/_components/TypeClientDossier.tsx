"use client";

import type { CategorieClient } from "@/lib/clients/constantes";
import { avertissementSiret, erreurSaisieSiret, formaterSiret } from "@/lib/clients/normalisation";
import type { EntrepriseAnnuaire } from "@/lib/clients/types";
import { RechercheAnnuaire } from "../../clients/_components/RechercheAnnuaire";
import { CaseSousTraitance, ChoixTypeClient } from "../../clients/_components/TypeClient";
import { Champ } from "./ui";

/** `choisi` : la personne a elle-même choisi particulier ou entreprise (sinon la source peut le déduire). */
export type TypeClientSaisi = { categorie: CategorieClient; siret: string; siretQuitte: boolean; choisi: boolean };

export const PARTICULIER: TypeClientSaisi = { categorie: "PARTICULIER", siret: "", siretQuitte: false, choisi: false };

export const estEntreprise = (saisie: TypeClientSaisi) => saisie.categorie !== "PARTICULIER";

/** SIRET mal formé : bloque l'ouverture (un SIRET se corrige ou se laisse vide). */
export function erreurTypeClient(saisie: TypeClientSaisi): string | null {
  return estEntreprise(saisie) ? erreurSaisieSiret(saisie.siret, true) : null;
}

/**
 * La source du dossier dit parfois qui est le client : « Sous-traitance », une
 * entreprise donneuse d'ordre ; « Prospection », une entreprise, tant que rien
 * d'autre n'a été choisi.
 */
export function typeSelonSource(actuel: TypeClientSaisi, source: string): TypeClientSaisi {
  if (source === "SOUS_TRAITANCE") return { ...actuel, categorie: "DONNEUR_ORDRE" };
  if (source === "PROSPECTION" && !actuel.choisi && actuel.categorie === "PARTICULIER") return { ...actuel, categorie: "PROFESSIONNEL" };
  return actuel;
}

/** Source après avoir coché ou décoché « Sous-traitance » : renseignée si vide, retirée si elle ne disait que ça. */
export function sourceSelonSousTraitance(source: string, sousTraitance: boolean): string {
  if (sousTraitance) return source || "SOUS_TRAITANCE";
  return source === "SOUS_TRAITANCE" ? "" : source;
}

/** Ce que reçoit l'API d'ouverture (création directe ou reprise, sans fiche client choisie). */
export function typeClientPourEnvoi(saisie: TypeClientSaisi): { clientCategorie: CategorieClient; clientSiret: string | null } {
  return { clientCategorie: saisie.categorie, clientSiret: estEntreprise(saisie) && saisie.siret.trim() ? saisie.siret : null };
}

/**
 * Nouveau client d'un dossier : particulier, ou entreprise (client direct ou
 * donneur d'ordre) avec son SIRET, cherchée dans l'annuaire des entreprises.
 * Le nom du dossier devient alors la raison sociale de la fiche.
 */
export function TypeClientDossier({
  valeur,
  onChange,
  onEntreprise,
  onSousTraitance,
  champNom,
}: {
  valeur: TypeClientSaisi;
  onChange: (valeur: TypeClientSaisi) => void;
  onEntreprise: (entreprise: EntrepriseAnnuaire) => void;
  /** La case « Sous-traitance » vient d'être cochée ou décochée. */
  onSousTraitance: (sousTraitance: boolean) => void;
  /** Le champ du nom (ou de la raison sociale), placé à côté du SIRET pour une entreprise. */
  champNom: React.ReactNode;
}) {
  const pro = estEntreprise(valeur);
  return (
    <div className="space-y-3">
      <ChoixTypeClient
        estPro={pro}
        onChange={(choix) => {
          onChange({ ...valeur, choisi: true, categorie: choix ? (pro ? valeur.categorie : "PROFESSIONNEL") : "PARTICULIER" });
          if (!choix && valeur.categorie === "DONNEUR_ORDRE") onSousTraitance(false);
        }}
      />
      {pro ? (
        <>
          <CaseSousTraitance
            categorie={valeur.categorie}
            onChange={(categorie) => {
              onChange({ ...valeur, choisi: true, categorie });
              onSousTraitance(categorie === "DONNEUR_ORDRE");
            }}
          />
          <RechercheAnnuaire
            onChoisir={(entreprise) => {
              onChange({ ...valeur, siret: entreprise.siret ? formaterSiret(entreprise.siret) : valeur.siret, siretQuitte: false });
              onEntreprise(entreprise);
            }}
          />
          <div className="grid gap-3 sm:grid-cols-[1fr_190px]">
            {champNom}
            <Champ
              libelle="SIRET"
              inputMode="numeric"
              autoComplete="off"
              maxLength={17}
              placeholder="14 chiffres, facultatif"
              value={valeur.siret}
              erreur={erreurSaisieSiret(valeur.siret, valeur.siretQuitte)}
              aide={avertissementSiret(valeur.siret) ?? undefined}
              onBlur={() => onChange({ ...valeur, siretQuitte: true })}
              onChange={(evenement) => onChange({ ...valeur, siret: evenement.target.value, siretQuitte: false })}
            />
          </div>
        </>
      ) : (
        champNom
      )}
    </div>
  );
}
