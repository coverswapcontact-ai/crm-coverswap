"use client";

import { useState } from "react";
import { toast } from "sonner";
import { envoyerJson, messageErreur } from "@/components/pilotage/client";
import { Bouton, Champ, ListeDeroulante, Modale } from "@/components/pilotage/ui";
import { LIBELLES_TYPE_PROJET, TYPES_PROJET } from "@/lib/prospects/constantes";
import type { EntrantDetail } from "@/lib/prospects/types";

/** Mission 13 (lot 7) — la fiche du contact en édition ; extrait de PanneauEntrant. */

export function EditionEntrant({ detail, onFermer, onMisAJour }: { detail: EntrantDetail; onFermer: () => void; onMisAJour: (detail: EntrantDetail) => void }) {
  const [initiaux] = useState(() => ({
    prenom: detail.prenom,
    nomFamille: detail.nomFamille,
    telephone: detail.telephone ?? "",
    email: detail.email ?? "",
    ville: detail.ville ?? "",
    codePostal: detail.codePostal ?? "",
    typeProjet: detail.typeProjet,
  }));
  const [champs, setChamps] = useState(initiaux);
  const [envoi, setEnvoi] = useState(false);
  const changer = (cle: keyof typeof champs) => (evenement: { target: { value: string } }) =>
    setChamps((actuels) => ({ ...actuels, [cle]: evenement.target.value }));

  async function enregistrer() {
    setEnvoi(true);
    try {
      // Seuls les champs changés partent : un numéro relu tel quel ne réécrit pas celui reçu.
      const changes = Object.fromEntries(
        (Object.keys(champs) as (keyof typeof champs)[])
          .filter((cle) => champs[cle].trim() !== initiaux[cle].trim())
          .map((cle) => [cle, (cle === "email" || cle === "codePostal") && !champs[cle].trim() ? null : champs[cle]])
      );
      if (Object.keys(changes).length === 0) {
        onFermer();
        return;
      }
      const { entrant, avertissements } = await envoyerJson<{ entrant: EntrantDetail; avertissements: string[] }>(`/api/prospects/entrants/${detail.id}`, "PATCH", changes);
      onMisAJour(entrant);
      onFermer();
      toast.success("Contact corrigé", { description: avertissements.length ? avertissements.join(" ") : undefined });
    } catch (probleme) {
      toast.error("Correction impossible", {
        description: messageErreur(probleme),
      });
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <Modale
      ouverte
      onFermer={onFermer}
      titre="Corriger le contact"
      description="Un numéro ou une adresse corrigés rejoignent aussi la fiche client."
      pied={
        <div className="flex justify-end gap-2">
          <Bouton variante="fantome" onClick={onFermer}>
            Annuler
          </Bouton>
          <Bouton variante="primaire" chargement={envoi} disabled={!champs.prenom.trim() && !champs.nomFamille.trim()} onClick={() => void enregistrer()}>
            Enregistrer
          </Bouton>
        </div>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Champ libelle="Prénom" maxLength={80} value={champs.prenom} onChange={changer("prenom")} />
        <Champ libelle="Nom" maxLength={120} value={champs.nomFamille} onChange={changer("nomFamille")} />
        <Champ libelle="Téléphone" type="tel" inputMode="tel" maxLength={40} value={champs.telephone} onChange={changer("telephone")} />
        <Champ libelle="E-mail" type="email" inputMode="email" maxLength={160} value={champs.email} onChange={changer("email")} />
        <Champ libelle="Ville" maxLength={80} value={champs.ville} onChange={changer("ville")} />
        <Champ libelle="Code postal" inputMode="numeric" maxLength={10} value={champs.codePostal} onChange={changer("codePostal")} />
        <ListeDeroulante
          libelle="Projet"
          classeConteneur="sm:col-span-2"
          value={champs.typeProjet}
          onChange={(evenement) =>
            setChamps((actuels) => ({
              ...actuels,
              typeProjet: evenement.target.value,
            }))
          }
          options={TYPES_PROJET.map((valeur) => ({
            valeur,
            libelle: LIBELLES_TYPE_PROJET[valeur],
          }))}
        />
      </div>
    </Modale>
  );
}
