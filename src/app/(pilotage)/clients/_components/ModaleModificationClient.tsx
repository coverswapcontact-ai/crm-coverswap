"use client";

import { useState } from "react";
import { toast } from "sonner";
import { envoyerJson, messageErreur } from "@/components/pilotage/client";
import { Bouton, Champ, ListeDeroulante, Modale, Puces } from "@/components/pilotage/ui";
import {
  CATEGORIES_CLIENT,
  LIBELLES_CATEGORIE_CLIENT,
  LIBELLES_SOURCE_CLIENT,
  SOURCES_CLIENT,
  type CategorieClient,
  type SourceClient,
} from "@/lib/clients/constantes";
import { avertissementSiret, erreurSaisieSiret, formaterSiret } from "@/lib/clients/normalisation";
import type { ClientDetail, EntrepriseAnnuaire } from "@/lib/clients/types";
import { jourParis } from "@/lib/dossiers/dates";
import { ChoixRecommandeur, type Recommandeur } from "./ChoixRecommandeur";
import { RechercheAnnuaire } from "./RechercheAnnuaire";

/** Mission 13 (lot 7) : la fenêtre « Modifier la fiche » du client — catégorie, identité (annuaire, SIRET), adresse, provenance, recommandeur. */
export function ModaleModification({
  client,
  onFermer,
  onMiseAJour,
}: {
  client: ClientDetail;
  onFermer: () => void;
  onMiseAJour: (client: ClientDetail) => void;
}) {
  const [champs, setChamps] = useState({
    categorie: client.categorie,
    prenom: client.prenom ?? "",
    nomFamille: client.nomFamille ?? "",
    raisonSociale: client.raisonSociale ?? "",
    siret: client.siret ?? "",
    adresse: client.adresse ?? "",
    codePostal: client.codePostal ?? "",
    ville: client.ville ?? "",
    source: client.source,
    sourceDetail: client.sourceDetail ?? "",
    campagne: client.campagne ?? "",
    publicite: client.publicite ?? "",
    formulaire: client.formulaire ?? "",
    premierContactLe: jourParis(client.premierContactLe),
  });
  const [recommandeur, setRecommandeur] = useState<Recommandeur>({
    id: client.recommandePar?.id ?? null,
    nom: client.recommandePar?.nom ?? null,
    texte: client.recommandeParTexte,
  });
  const [envoi, setEnvoi] = useState(false);
  const [siretQuitte, setSiretQuitte] = useState(false);
  const changer = (cle: keyof typeof champs) => (evenement: { target: { value: string } }) =>
    setChamps((actuels) => ({ ...actuels, [cle]: evenement.target.value }));

  const estPro = champs.categorie !== "PARTICULIER";
  // Une fiche pro venue d'un formulaire ou d'un mail peut porter le nom de la personne qui a écrit :
  // il reste visible (et effaçable) tant qu'il existe ; une fiche pro créée ici n'en a pas.
  const contactEnregistre = Boolean(client.prenom || client.nomFamille);
  const siretModifie = champs.siret.replace(/\s/g, "") !== (client.siret ?? "");
  const siretEnErreur = estPro && siretModifie ? erreurSaisieSiret(champs.siret, true) : null;
  const raisonSocialeExigee = client.categorie === "PARTICULIER" || Boolean(client.raisonSociale);
  const raisonSocialeManquante = estPro && raisonSocialeExigee && !champs.raisonSociale.trim();
  const nomManquant = !estPro && client.categorie !== "PARTICULIER" && !champs.prenom.trim() && !champs.nomFamille.trim();
  const identiteRetiree = !estPro && (client.raisonSociale || client.siret);

  function remplirDepuisAnnuaire(entreprise: EntrepriseAnnuaire) {
    setSiretQuitte(false);
    setChamps((actuels) => ({
      ...actuels,
      raisonSociale: entreprise.raisonSociale ?? actuels.raisonSociale,
      siret: entreprise.siret ? formaterSiret(entreprise.siret) : "",
      ...(entreprise.adresse || entreprise.codePostal || entreprise.ville
        ? { adresse: entreprise.adresse ?? "", codePostal: entreprise.codePostal ?? "", ville: entreprise.ville ?? "" }
        : {}),
    }));
  }

  async function enregistrer() {
    setEnvoi(true);
    try {
      const { prenom, nomFamille, raisonSociale, siret, ...autres } = champs;
      // Un pro est une entité : le contact n'est renvoyé que s'il était affiché. Un particulier perd raison sociale et SIRET.
      const identite = estPro
        ? { raisonSociale, siret, ...(contactEnregistre ? { prenom, nomFamille } : {}) }
        : { prenom, nomFamille, raisonSociale: null, siret: null };
      const { client: misAJour, avertissements } = await envoyerJson<{ client: ClientDetail; avertissements: string[] }>(`/api/clients/${client.id}`, "PATCH", {
        ...autres,
        ...identite,
        recommandeParId: recommandeur.id,
        recommandeParTexte: recommandeur.texte,
      });
      onMiseAJour(misAJour);
      onFermer();
      toast.success("Fiche enregistrée", { description: avertissements.length ? avertissements.join(" ") : undefined });
    } catch (erreur) {
      toast.error("Enregistrement impossible", { description: messageErreur(erreur) });
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <Modale
      ouverte
      onFermer={onFermer}
      titre="Modifier la fiche"
      largeur="lg"
      pied={
        <div className="flex justify-end gap-2">
          <Bouton variante="fantome" onClick={onFermer}>
            Annuler
          </Bouton>
          <Bouton
            variante="primaire"
            chargement={envoi}
            disabled={Boolean(siretEnErreur) || raisonSocialeManquante || nomManquant}
            onClick={() => void enregistrer()}
          >
            Enregistrer
          </Bouton>
        </div>
      }
    >
      <div className="grid gap-4 md:grid-cols-2">
        <div className="flex flex-col gap-3">
          <Puces
            libelle="Catégorie"
            options={CATEGORIES_CLIENT.map((valeur) => ({ valeur, libelle: LIBELLES_CATEGORIE_CLIENT[valeur] }))}
            valeur={champs.categorie}
            onChange={(valeur: CategorieClient) => setChamps((actuels) => ({ ...actuels, categorie: valeur }))}
          />
          {estPro ? (
            <>
              <RechercheAnnuaire onChoisir={remplirDepuisAnnuaire} />
              <div className="grid gap-3 sm:grid-cols-[1fr_170px]">
                <Champ
                  libelle="Raison sociale"
                  obligatoire={raisonSocialeExigee}
                  erreur={raisonSocialeManquante ? "Pour un client pro, c'est l'entreprise qui est le client." : null}
                  value={champs.raisonSociale}
                  maxLength={160}
                  onChange={changer("raisonSociale")}
                />
                <Champ
                  libelle="SIRET"
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={17}
                  placeholder="14 chiffres"
                  value={champs.siret}
                  erreur={siretModifie ? erreurSaisieSiret(champs.siret, siretQuitte) : null}
                  aide={siretModifie ? (avertissementSiret(champs.siret) ?? undefined) : undefined}
                  onBlur={() => setSiretQuitte(true)}
                  onChange={(evenement) => {
                    changer("siret")(evenement);
                    setSiretQuitte(false);
                  }}
                />
              </div>
              {contactEnregistre ? (
                <div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Champ libelle="Contact : prénom" value={champs.prenom} maxLength={80} onChange={changer("prenom")} />
                    <Champ libelle="Contact : nom" value={champs.nomFamille} maxLength={120} onChange={changer("nomFamille")} />
                  </div>
                  <p className="mt-1 text-[12px] text-[#6B7280]">Personne qui a pris contact. Vide ces champs pour ne garder que l&apos;entreprise.</p>
                </div>
              ) : null}
            </>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <Champ libelle="Prénom" value={champs.prenom} maxLength={80} onChange={changer("prenom")} />
              <Champ libelle="Nom" value={champs.nomFamille} maxLength={120} onChange={changer("nomFamille")} />
            </div>
          )}
          {nomManquant ? <p className="text-[12px] text-[#F87171]">Indique un prénom ou un nom : un particulier est une personne.</p> : null}
          {identiteRetiree ? (
            <p className="text-[12px] text-[#F5B454]">La raison sociale et le SIRET seront retirés de la fiche ; l&apos;historique les garde.</p>
          ) : null}
          <Champ
            libelle={estPro ? "Adresse de facturation" : "Adresse"}
            aide={estPro ? "Siège ou établissement facturé. Le lieu du chantier se saisit dans le dossier." : undefined}
            value={champs.adresse}
            maxLength={200}
            onChange={changer("adresse")}
          />
          <div className="grid grid-cols-[110px_1fr] gap-3">
            <Champ libelle="Code postal" inputMode="numeric" maxLength={10} value={champs.codePostal} onChange={changer("codePostal")} />
            <Champ libelle="Ville" value={champs.ville} maxLength={80} onChange={changer("ville")} />
          </div>
        </div>
        <div className="flex flex-col gap-3">
          <ListeDeroulante
            libelle="Source"
            value={champs.source}
            onChange={(evenement) => setChamps((actuels) => ({ ...actuels, source: evenement.target.value as SourceClient }))}
            options={SOURCES_CLIENT.map((valeur) => ({ valeur, libelle: LIBELLES_SOURCE_CLIENT[valeur] }))}
          />
          <Champ libelle="Précision de la source" value={champs.sourceDetail} maxLength={160} onChange={changer("sourceDetail")} />
          <div className="grid gap-3 sm:grid-cols-2">
            <Champ libelle="Campagne" value={champs.campagne} maxLength={200} onChange={changer("campagne")} />
            <Champ libelle="Publicité" value={champs.publicite} maxLength={200} onChange={changer("publicite")} />
          </div>
          <Champ libelle="Formulaire" value={champs.formulaire} maxLength={200} onChange={changer("formulaire")} />
          <Champ libelle="Premier contact" type="date" value={champs.premierContactLe} onChange={changer("premierContactLe")} />
          <ChoixRecommandeur valeur={recommandeur} onChange={setRecommandeur} exclureId={client.id} />
        </div>
      </div>
    </Modale>
  );
}
