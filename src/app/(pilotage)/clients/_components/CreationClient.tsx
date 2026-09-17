"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Building2, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { ErreurApi, envoyerJson, messageErreur } from "@/components/pilotage/client";
import { Bouton, Champ, ListeDeroulante, Modale } from "@/components/pilotage/ui";
import { LIBELLES_SOURCE_CLIENT, SOURCES_CLIENT, type CategorieClient, type SourceClient } from "@/lib/clients/constantes";
import { avertissementSiret, erreurSaisieSiret, formaterSiret } from "@/lib/clients/normalisation";
import type { EntrepriseAnnuaire } from "@/lib/clients/types";
import { ChoixRecommandeur, type Recommandeur } from "./ChoixRecommandeur";
import { RechercheAnnuaire } from "./RechercheAnnuaire";
import { CaseSousTraitance, ChoixTypeClient } from "./TypeClient";

/**
 * Nouveau client saisi à la main. Un particulier est une personne (prénom,
 * nom) ; un client pro est une entité (raison sociale, SIRET, adresse de
 * facturation), sans prénom ni nom.
 */
export function CreationClient({ onFermer, categorieInitiale = "PARTICULIER" }: { onFermer: () => void; categorieInitiale?: CategorieClient }) {
  const router = useRouter();
  const [categorie, setCategorie] = useState<CategorieClient>(categorieInitiale);
  const [prenom, setPrenom] = useState("");
  const [nomFamille, setNomFamille] = useState("");
  const [raisonSociale, setRaisonSociale] = useState("");
  const [siret, setSiret] = useState("");
  const [siretQuitte, setSiretQuitte] = useState(false);
  const [telephone, setTelephone] = useState("");
  const [email, setEmail] = useState("");
  const [adresse, setAdresse] = useState("");
  const [codePostal, setCodePostal] = useState("");
  const [ville, setVille] = useState("");
  const [source, setSource] = useState<SourceClient | "">("");
  const [sourceDetail, setSourceDetail] = useState("");
  const [recommandeur, setRecommandeur] = useState<Recommandeur>({ id: null, nom: null, texte: null });
  const [envoi, setEnvoi] = useState(false);
  const [doublon, setDoublon] = useState<{ message: string; clientId: string | null } | null>(null);

  const estPro = categorie !== "PARTICULIER";
  const nomRenseigne = estPro ? Boolean(raisonSociale.trim()) : Boolean(prenom.trim() || nomFamille.trim());
  const siretEnErreur = estPro ? erreurSaisieSiret(siret, true) : null;

  function remplirDepuisAnnuaire(entreprise: EntrepriseAnnuaire) {
    if (entreprise.raisonSociale) setRaisonSociale(entreprise.raisonSociale);
    setSiret(entreprise.siret ? formaterSiret(entreprise.siret) : "");
    setSiretQuitte(false);
    if (entreprise.adresse || entreprise.codePostal || entreprise.ville) {
      setAdresse(entreprise.adresse ?? "");
      setCodePostal(entreprise.codePostal ?? "");
      setVille(entreprise.ville ?? "");
    }
    setDoublon(null);
  }

  async function creer(forcer: boolean) {
    if (!nomRenseigne || siretEnErreur) return;
    setEnvoi(true);
    try {
      const { id, avertissements } = await envoyerJson<{ id: string; avertissements: string[] }>("/api/clients", "POST", {
        categorie,
        prenom: estPro ? null : prenom,
        nomFamille: estPro ? null : nomFamille,
        raisonSociale: estPro ? raisonSociale : null,
        siret: estPro ? siret : null,
        adresse,
        codePostal,
        ville,
        source: source || null,
        sourceDetail,
        campagne: null,
        publicite: null,
        formulaire: null,
        recommandeParId: recommandeur.id,
        recommandeParTexte: recommandeur.texte,
        notes: null,
        telephone: telephone || null,
        email: email || null,
        forcer,
      });
      toast.success(estPro ? "Fiche entreprise créée" : "Fiche client créée", { description: avertissements.length ? avertissements.join(" ") : undefined });
      router.push(`/clients/${id}`);
    } catch (erreur) {
      if (erreur instanceof ErreurApi && erreur.status === 409) {
        const corps = erreur.corps as { clientExistantId?: unknown } | null;
        setDoublon({ message: erreur.message, clientId: typeof corps?.clientExistantId === "string" ? corps.clientExistantId : null });
      } else {
        toast.error("Création impossible", { description: messageErreur(erreur) });
      }
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <Modale
      ouverte
      onFermer={onFermer}
      titre={estPro ? "Nouveau client pro" : "Nouveau client"}
      description={
        estPro
          ? "La fiche porte l'entreprise : raison sociale, SIRET, adresse de facturation."
          : "Recommandation, bouche-à-oreille : tout particulier qui n'arrive pas par un formulaire."
      }
      pied={
        <div className="flex flex-wrap items-center justify-end gap-2">
          {doublon ? (
            <Bouton variante="secondaire" chargement={envoi} onClick={() => void creer(true)}>
              Créer quand même
            </Bouton>
          ) : null}
          <Bouton variante="fantome" onClick={onFermer}>
            Annuler
          </Bouton>
          <Bouton
            variante="primaire"
            icone={estPro ? <Building2 size={15} aria-hidden /> : <UserPlus size={15} aria-hidden />}
            disabled={!nomRenseigne || Boolean(siretEnErreur)}
            chargement={envoi && !doublon}
            onClick={() => void creer(false)}
          >
            Créer la fiche
          </Bouton>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        {doublon ? (
          <div className="rounded-[8px] border-[0.5px] border-[#EF9F27]/40 bg-[#EF9F27]/10 px-3 py-2 text-[13px] text-[#F5B454]">
            {doublon.message} La paire sera proposée à la fusion si tu crées quand même.
            {doublon.clientId ? (
              <Link href={`/clients/${doublon.clientId}`} className="ml-1 font-medium underline underline-offset-2 hover:text-[#F2F3F5]">
                Ouvrir sa fiche
              </Link>
            ) : null}
          </div>
        ) : null}

        <ChoixTypeClient estPro={estPro} onChange={(pro) => setCategorie(pro ? (estPro ? categorie : "PROFESSIONNEL") : "PARTICULIER")} />

        {estPro ? (
          <>
            <CaseSousTraitance categorie={categorie} onChange={setCategorie} />
            <RechercheAnnuaire onChoisir={remplirDepuisAnnuaire} />
            <div className="grid gap-3 sm:grid-cols-[1fr_190px]">
              <Champ
                libelle="Raison sociale"
                obligatoire
                autoComplete="organization"
                value={raisonSociale}
                maxLength={160}
                onChange={(evenement) => setRaisonSociale(evenement.target.value)}
              />
              <Champ
                libelle="SIRET"
                inputMode="numeric"
                autoComplete="off"
                maxLength={17}
                placeholder="14 chiffres"
                value={siret}
                erreur={erreurSaisieSiret(siret, siretQuitte)}
                aide={avertissementSiret(siret) ?? undefined}
                onBlur={() => setSiretQuitte(true)}
                onChange={(evenement) => {
                  setSiret(evenement.target.value);
                  setSiretQuitte(false);
                }}
              />
            </div>
          </>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <Champ libelle="Prénom" value={prenom} maxLength={80} onChange={(evenement) => setPrenom(evenement.target.value)} />
            <Champ libelle="Nom" value={nomFamille} maxLength={120} onChange={(evenement) => setNomFamille(evenement.target.value)} />
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <Champ libelle="Téléphone" type="tel" inputMode="tel" autoComplete="off" value={telephone} onChange={(evenement) => setTelephone(evenement.target.value)} />
          <Champ libelle="E-mail" type="email" inputMode="email" autoComplete="off" value={email} onChange={(evenement) => setEmail(evenement.target.value)} />
        </div>
        <Champ
          libelle={estPro ? "Adresse de facturation" : "Adresse"}
          aide={estPro ? "Siège ou établissement facturé. Le lieu du chantier se saisit dans le dossier." : undefined}
          value={adresse}
          maxLength={200}
          onChange={(evenement) => setAdresse(evenement.target.value)}
        />
        <div className="grid grid-cols-[110px_1fr] gap-3">
          <Champ libelle="Code postal" inputMode="numeric" maxLength={10} value={codePostal} onChange={(evenement) => setCodePostal(evenement.target.value)} />
          <Champ libelle="Ville" value={ville} maxLength={80} onChange={(evenement) => setVille(evenement.target.value)} />
        </div>
        <ListeDeroulante
          libelle="D'où vient ce client ?"
          value={source}
          onChange={(evenement) => setSource(evenement.target.value as SourceClient | "")}
          options={[{ valeur: "", libelle: "Non renseignée" }, ...SOURCES_CLIENT.filter((valeur) => valeur !== "INCONNUE").map((valeur) => ({ valeur, libelle: LIBELLES_SOURCE_CLIENT[valeur] }))]}
        />
        {source && source !== "RECOMMANDATION" ? (
          <Champ libelle="Précision" placeholder="Nom du salon, du réseau, de l'apporteur…" value={sourceDetail} maxLength={160} onChange={(evenement) => setSourceDetail(evenement.target.value)} />
        ) : null}
        {source === "RECOMMANDATION" || source === "BOUCHE_A_OREILLE" ? (
          <ChoixRecommandeur valeur={recommandeur} onChange={setRecommandeur} />
        ) : null}
      </div>
    </Modale>
  );
}
