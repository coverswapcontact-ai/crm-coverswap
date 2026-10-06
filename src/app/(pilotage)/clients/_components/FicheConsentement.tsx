"use client";

import { useState } from "react";
import { ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { envoyerJson, messageErreur } from "@/components/pilotage/client";
import { Bouton, Champ, Modale, Pastille, Puces, ZoneTexte } from "@/components/pilotage/ui";
import {
  LIBELLES_MOYEN_CONSENTEMENT,
  LIBELLES_STATUT_CONSENTEMENT,
  MOYENS_CONSENTEMENT,
  STATUTS_CONSENTEMENT,
  type MoyenConsentement,
  type StatutConsentement,
} from "@/lib/clients/constantes";
import type { ClientDetail } from "@/lib/clients/types";
import { formatDateCourte, jourParis } from "@/lib/dossiers/dates";
import { Carte } from "./fiche-ui";

/** Mission 13 (lot 7) : la rubrique « Mails commerciaux » de la fiche client — la réponse courante, les déclarations précédentes, la saisie d'une nouvelle réponse. */
export function Consentement({ client, onMiseAJour }: { client: ClientDetail; onMiseAJour: (client: ClientDetail) => void }) {
  const [ouverte, setOuverte] = useState(false);
  const [statut, setStatut] = useState<StatutConsentement | null>(null);
  const [moyen, setMoyen] = useState<MoyenConsentement | null>(null);
  const [recueilliLe, setRecueilliLe] = useState(() => jourParis(new Date()));
  const [preuve, setPreuve] = useState("");
  const [envoi, setEnvoi] = useState(false);
  const courant = client.consentements[0];

  async function enregistrer() {
    if (!statut || !moyen) return;
    setEnvoi(true);
    try {
      const { client: misAJour } = await envoyerJson<{ client: ClientDetail }>(`/api/clients/${client.id}/consentements`, "POST", {
        statut,
        moyen,
        recueilliLe,
        preuve: preuve || null,
      });
      onMiseAJour(misAJour);
      setOuverte(false);
      toast.success("Réponse enregistrée", { description: "Les déclarations précédentes restent dans l'historique." });
    } catch (erreur) {
      toast.error("Enregistrement impossible", { description: messageErreur(erreur) });
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <Carte
      titre="Mails commerciaux"
      action={
        client.anonymiseLe || client.fusionneDans ? null : (
          <Bouton taille="sm" variante="fantome" icone={<ShieldCheck size={13} aria-hidden />} onClick={() => setOuverte(true)}>
            Enregistrer une réponse
          </Bouton>
        )
      }
    >
      {courant ? (
        <>
          <Pastille ton={courant.statut === "ACCORDE" ? "vert" : "rouge"}>{LIBELLES_STATUT_CONSENTEMENT[courant.statut]}</Pastille>
          <p className="mt-1.5 text-[12px] text-texte-3">
            Le {formatDateCourte(courant.recueilliLe)} · {LIBELLES_MOYEN_CONSENTEMENT[courant.moyen as MoyenConsentement] ?? courant.moyen}
            {courant.preuve ? ` · ${courant.preuve}` : ""}
          </p>
          {client.consentements.length > 1 ? (
            <ul className="mt-2 border-t-[0.5px] border-trait pt-2">
              {client.consentements.slice(1).map((ancien) => (
                <li key={ancien.id} className="text-[12px] text-texte-3">
                  {formatDateCourte(ancien.recueilliLe)} : {LIBELLES_STATUT_CONSENTEMENT[ancien.statut].toLowerCase()} ({LIBELLES_MOYEN_CONSENTEMENT[ancien.moyen as MoyenConsentement] ?? ancien.moyen})
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : (
        <p className="text-[13px] text-texte-3">
          Aucune réponse enregistrée : <span className="text-texte">pas de mail commercial</span>
          {" tant que le client n'a pas dit oui."}
        </p>
      )}

      <Modale
        ouverte={ouverte}
        onFermer={() => setOuverte(false)}
        titre="Réponse du client aux mails commerciaux"
        description="Une nouvelle déclaration s'ajoute ; les précédentes ne sont jamais modifiées."
        pied={
          <div className="flex justify-end gap-2">
            <Bouton variante="fantome" onClick={() => setOuverte(false)}>
              Annuler
            </Bouton>
            <Bouton variante="primaire" chargement={envoi} disabled={!statut || !moyen} onClick={() => void enregistrer()}>
              Enregistrer
            </Bouton>
          </div>
        }
      >
        <div className="flex flex-col gap-4">
          <Puces
            libelle="Réponse"
            obligatoire
            options={STATUTS_CONSENTEMENT.map((valeur) => ({ valeur, libelle: LIBELLES_STATUT_CONSENTEMENT[valeur] }))}
            valeur={statut}
            onChange={setStatut}
          />
          <Puces
            libelle="Comment"
            obligatoire
            options={MOYENS_CONSENTEMENT.map((valeur) => ({ valeur, libelle: LIBELLES_MOYEN_CONSENTEMENT[valeur] }))}
            valeur={moyen}
            onChange={setMoyen}
          />
          <Champ libelle="Date" type="date" obligatoire value={recueilliLe} onChange={(evenement) => setRecueilliLe(evenement.target.value)} />
          <ZoneTexte libelle="Preuve ou précision" rows={2} maxLength={1000} placeholder="Texte de la case, objet du mail…" value={preuve} onChange={(evenement) => setPreuve(evenement.target.value)} />
        </div>
      </Modale>
    </Carte>
  );
}
