"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { UserPlus } from "lucide-react";
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
import { ChoixRecommandeur, type Recommandeur } from "./ChoixRecommandeur";

export function CreationClient({ onFermer }: { onFermer: () => void }) {
  const router = useRouter();
  const [categorie, setCategorie] = useState<CategorieClient>("PARTICULIER");
  const [prenom, setPrenom] = useState("");
  const [nomFamille, setNomFamille] = useState("");
  const [raisonSociale, setRaisonSociale] = useState("");
  const [telephone, setTelephone] = useState("");
  const [email, setEmail] = useState("");
  const [adresse, setAdresse] = useState("");
  const [codePostal, setCodePostal] = useState("");
  const [ville, setVille] = useState("");
  const [source, setSource] = useState<SourceClient | "">("");
  const [sourceDetail, setSourceDetail] = useState("");
  const [recommandeur, setRecommandeur] = useState<Recommandeur>({ id: null, nom: null, texte: null });
  const [envoi, setEnvoi] = useState(false);
  const [doublon, setDoublon] = useState<string | null>(null);

  const estPersonne = categorie === "PARTICULIER";
  const nomRenseigne = estPersonne ? Boolean(prenom.trim() || nomFamille.trim()) : Boolean(raisonSociale.trim());

  async function creer(forcer: boolean) {
    if (!nomRenseigne || !source) return;
    setEnvoi(true);
    try {
      const { id } = await envoyerJson<{ id: string }>("/api/clients", "POST", {
        categorie,
        prenom: estPersonne ? prenom : null,
        nomFamille: estPersonne ? nomFamille : null,
        raisonSociale: estPersonne ? null : raisonSociale,
        siret: null,
        adresse,
        codePostal,
        ville,
        source,
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
      toast.success("Fiche client créée");
      router.push(`/clients/${id}`);
    } catch (erreur) {
      const message = messageErreur(erreur);
      if (message.includes("déjà cet e-mail ou ce numéro")) setDoublon(message);
      else toast.error("Création impossible", { description: message });
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <Modale
      ouverte
      onFermer={onFermer}
      titre="Nouveau client"
      description="Recommandation, bouche-à-oreille, sous-traitance : tout client qui n'arrive pas par un formulaire."
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
            icone={<UserPlus size={15} aria-hidden />}
            disabled={!nomRenseigne || !source}
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
          <p className="rounded-[8px] border-[0.5px] border-[#EF9F27]/40 bg-[#EF9F27]/10 px-3 py-2 text-[13px] text-[#F5B454]">
            {doublon} La paire sera proposée à la fusion si tu crées quand même.
          </p>
        ) : null}
        <Puces
          libelle="Catégorie"
          obligatoire
          options={CATEGORIES_CLIENT.map((valeur) => ({ valeur, libelle: LIBELLES_CATEGORIE_CLIENT[valeur] }))}
          valeur={categorie}
          onChange={setCategorie}
        />
        {estPersonne ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Champ libelle="Prénom" value={prenom} maxLength={80} onChange={(evenement) => setPrenom(evenement.target.value)} />
            <Champ libelle="Nom" value={nomFamille} maxLength={120} onChange={(evenement) => setNomFamille(evenement.target.value)} />
          </div>
        ) : (
          <Champ libelle="Raison sociale" obligatoire value={raisonSociale} maxLength={160} onChange={(evenement) => setRaisonSociale(evenement.target.value)} />
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <Champ libelle="Téléphone" type="tel" inputMode="tel" autoComplete="off" value={telephone} onChange={(evenement) => setTelephone(evenement.target.value)} />
          <Champ libelle="E-mail" type="email" inputMode="email" autoComplete="off" value={email} onChange={(evenement) => setEmail(evenement.target.value)} />
        </div>
        <Champ libelle="Adresse" value={adresse} maxLength={200} onChange={(evenement) => setAdresse(evenement.target.value)} />
        <div className="grid grid-cols-[110px_1fr] gap-3">
          <Champ libelle="Code postal" inputMode="numeric" maxLength={5} value={codePostal} onChange={(evenement) => setCodePostal(evenement.target.value)} />
          <Champ libelle="Ville" value={ville} maxLength={80} onChange={(evenement) => setVille(evenement.target.value)} />
        </div>
        <ListeDeroulante
          libelle="D'où vient ce client ?"
          obligatoire
          value={source}
          onChange={(evenement) => setSource(evenement.target.value as SourceClient)}
          options={[{ valeur: "", libelle: "Choisir…" }, ...SOURCES_CLIENT.map((valeur) => ({ valeur, libelle: LIBELLES_SOURCE_CLIENT[valeur] }))]}
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
