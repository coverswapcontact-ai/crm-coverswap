"use client";

import { useState } from "react";
import { toast } from "sonner";
import { LIBELLES_SOURCE, SOURCES_DOSSIER, type SourceDossier } from "@/lib/dossiers/constants";
import { jourParis } from "@/lib/dossiers/dates";
import { formatQuantite, lireNombre } from "@/lib/dossiers/montants";
import type { DossierDetail } from "@/lib/dossiers/types";
import { envoyerJson, messageErreur } from "./client";
import { Bouton, Champ, ListeDeroulante, TitreSection } from "./ui";
import { validerCoordonnees, type ChampsCoordonnees, type ErreursCoordonnees } from "./validation";

type Saisie = ChampsCoordonnees & { dateChantier: string };

function saisieDepuis(detail: DossierDetail): Saisie {
  return {
    clientNom: detail.clientNom,
    clientTelephone: detail.clientTelephone,
    clientEmail: detail.clientEmail ?? "",
    clientAdresse: detail.clientAdresse,
    clientCp: detail.clientCp,
    clientVille: detail.clientVille,
    objet: detail.objet,
    source: detail.source,
    montantEstime: detail.montantEstime === null ? "" : formatQuantite(detail.montantEstime),
    dateChantier: detail.dateChantier ? jourParis(detail.dateChantier) : "",
  };
}

/** Coordonnées client et informations du dossier, éditables. */
export function CoordonneesClient({
  detail,
  onMisAJour,
}: {
  detail: DossierDetail;
  onMisAJour: (detail: DossierDetail) => void;
}) {
  const initiale = saisieDepuis(detail);
  const [saisie, setSaisie] = useState<Saisie>(initiale);
  const [erreurs, setErreurs] = useState<ErreursCoordonnees>({});
  const [envoi, setEnvoi] = useState(false);
  const modifiee = (Object.keys(initiale) as (keyof Saisie)[]).some((cle) => saisie[cle] !== initiale[cle]);

  const champ = (cle: keyof Saisie) => ({
    value: saisie[cle],
    onChange: (evenement: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setSaisie((actuelle) => ({ ...actuelle, [cle]: evenement.target.value })),
    erreur: erreurs[cle as keyof ErreursCoordonnees],
  });

  async function enregistrer(evenement: React.FormEvent) {
    evenement.preventDefault();
    const trouvees = validerCoordonnees(saisie);
    setErreurs(trouvees);
    if (Object.keys(trouvees).length > 0) return;
    setEnvoi(true);
    try {
      const nouveau = await envoyerJson<DossierDetail>(`/api/dossiers/${detail.id}`, "PATCH", {
        clientNom: saisie.clientNom,
        clientTelephone: saisie.clientTelephone,
        clientEmail: saisie.clientEmail || null,
        clientAdresse: saisie.clientAdresse,
        clientCp: saisie.clientCp,
        clientVille: saisie.clientVille,
        objet: saisie.objet,
        source: saisie.source,
        montantEstime: saisie.montantEstime.trim() ? lireNombre(saisie.montantEstime) : null,
        ...(saisie.dateChantier !== initiale.dateChantier ? { dateChantier: saisie.dateChantier || null } : {}),
      });
      onMisAJour(nouveau);
      toast.success("Dossier enregistré");
    } catch (probleme) {
      toast.error("Modifications non enregistrées", { description: messageErreur(probleme) });
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <section>
      <TitreSection>Client et chantier</TitreSection>
      <form onSubmit={enregistrer} noValidate className="grid gap-3 sm:grid-cols-2">
        <Champ libelle="Nom du client" obligatoire autoComplete="off" {...champ("clientNom")} classeConteneur="sm:col-span-2" />
        <Champ libelle="Téléphone" obligatoire type="tel" inputMode="tel" {...champ("clientTelephone")} />
        <Champ libelle="E-mail" type="email" inputMode="email" {...champ("clientEmail")} />
        <Champ libelle="Adresse" obligatoire {...champ("clientAdresse")} classeConteneur="sm:col-span-2" />
        <Champ libelle="Code postal" obligatoire inputMode="numeric" maxLength={5} {...champ("clientCp")} />
        <Champ libelle="Ville" obligatoire {...champ("clientVille")} />
        <Champ libelle="Objet du chantier" obligatoire {...champ("objet")} classeConteneur="sm:col-span-2" />
        <ListeDeroulante
          libelle="Source"
          obligatoire
          options={SOURCES_DOSSIER.map((source) => ({ valeur: source, libelle: LIBELLES_SOURCE[source] }))}
          value={saisie.source}
          onChange={(evenement) => setSaisie((actuelle) => ({ ...actuelle, source: evenement.target.value as SourceDossier }))}
        />
        <Champ libelle="Montant estimé (€)" inputMode="decimal" placeholder="Ex. 2 500" {...champ("montantEstime")} />
        <Champ
          libelle="Date du chantier"
          type="date"
          {...champ("dateChantier")}
          aide={detail.dateChantier ? undefined : "Exigée pour passer à « Planifié »."}
        />
        <div className="flex items-end justify-end sm:col-span-2">
          <Bouton type="submit" variante={modifiee ? "primaire" : "secondaire"} disabled={!modifiee} chargement={envoi}>
            Enregistrer
          </Bouton>
        </div>
      </form>
    </section>
  );
}
