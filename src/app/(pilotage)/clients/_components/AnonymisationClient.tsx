"use client";

import { useEffect, useState } from "react";
import { EyeOff } from "lucide-react";
import { toast } from "sonner";
import { appelApi, envoyerJson, messageErreur } from "@/components/pilotage/client";
import { rafraichirCompteurs } from "@/components/pilotage/Navigation";
import { Bouton, CaseACocher, Modale, Puces, ZoneTexte } from "@/components/pilotage/ui";
import type { ClientDetail } from "@/lib/clients/types";
import type { ApercuAnonymisation } from "@/lib/rgpd/anonymisation";
import { pluriel } from "@/lib/commun/format";

const MOTIFS = [
  { valeur: "DEMANDE_PERSONNE", libelle: "Demande de la personne (droit à l'effacement)" },
  { valeur: "DUREE_ECOULEE", libelle: "Durée de conservation écoulée" },
  { valeur: "AUTRE", libelle: "Autre motif" },
] as const;
type Motif = (typeof MOTIFS)[number]["valeur"];


/** Anonymisation RGPD d'une fiche : ce qui part, ce qui reste, ce qui est à faire à la main ; définitive. */
export function AnonymisationClient({ client, onAnonymise }: { client: ClientDetail; onAnonymise: (client: ClientDetail) => void }) {
  const [ouverte, setOuverte] = useState(false);
  const [apercu, setApercu] = useState<ApercuAnonymisation | null>(null);
  const [motif, setMotif] = useState<Motif | null>(null);
  const [commentaire, setCommentaire] = useState("");
  const [confirmation, setConfirmation] = useState(false);
  const [envoi, setEnvoi] = useState(false);

  useEffect(() => {
    if (!ouverte) return;
    let actif = true;
    appelApi<ApercuAnonymisation>(`/api/clients/${client.id}/anonymisation`)
      .then((lu) => actif && setApercu(lu))
      .catch((erreur) => toast.error("Aperçu indisponible", { description: messageErreur(erreur) }));
    return () => {
      actif = false;
    };
  }, [ouverte, client.id]);

  async function anonymiser() {
    if (!motif || !confirmation) return;
    setEnvoi(true);
    try {
      const { client: anonymise } = await envoyerJson<{ client: ClientDetail }>(`/api/clients/${client.id}/anonymisation`, "POST", {
        motif,
        commentaire: commentaire.trim() || null,
        confirmation: true,
      });
      toast.success("Fiche anonymisée", { description: "Photos et pièces jointes effacées en tâche de fond ; factures et paiements conservés." });
      setOuverte(false);
      rafraichirCompteurs();
      onAnonymise(anonymise);
    } catch (erreur) {
      toast.error("Anonymisation impossible", { description: messageErreur(erreur) });
    } finally {
      setEnvoi(false);
    }
  }

  if (client.anonymiseLe || client.fusionneDans) return null;
  const bloque = (apercu?.bloquants.length ?? 0) > 0;
  const commentaireExige = motif === "AUTRE" && commentaire.trim().length < 3;

  return (
    <>
      <Bouton variante="fantome" icone={<EyeOff size={14} aria-hidden />} onClick={() => setOuverte(true)}>
        Anonymiser (RGPD)
      </Bouton>
      <Modale
        ouverte={ouverte}
        onFermer={() => setOuverte(false)}
        titre="Anonymiser la fiche (RGPD)"
        description="Définitif : l'identité ne pourra pas être retrouvée. Les pièces que la loi impose de garder restent."
        pied={
          <div className="flex flex-wrap justify-end gap-2">
            <Bouton variante="fantome" onClick={() => setOuverte(false)}>
              Annuler
            </Bouton>
            <Bouton variante="danger" icone={<EyeOff size={14} aria-hidden />} disabled={!apercu || bloque || !motif || !confirmation || commentaireExige} chargement={envoi} onClick={() => void anonymiser()}>
              Anonymiser définitivement
            </Bouton>
          </div>
        }
      >
        {!apercu ? (
          <p className="text-[13px] text-[#6B7280]">Préparation de l&apos;aperçu…</p>
        ) : (
          <div className="flex flex-col gap-4 text-[13px] leading-relaxed">
            {bloque ? (
              <ul className="rounded-[8px] bg-[#EF4444]/10 px-3 py-2 text-[#F87171]">
                {apercu.bloquants.map((bloquant) => (
                  <li key={bloquant}>{bloquant}</li>
                ))}
              </ul>
            ) : null}
            <div>
              <p className="font-medium text-[#F2F3F5]">Effacé</p>
              <p className="text-[#9CA3AF]">
                Nom, adresse, e-mails, téléphones, notes ; {pluriel(apercu.efface.dossiers, "dossier")} (coordonnées, notes, texte libre de l&apos;historique) ;{" "}
                {pluriel(apercu.efface.photos, "photo")} et pièce{apercu.efface.photos > 1 ? "s" : ""} jointe{apercu.efface.photos > 1 ? "s" : ""} ; {pluriel(apercu.efface.mails, "mail")} ;{" "}
                {pluriel(apercu.efface.propositions, "proposition")}
                {" de l'agent ; les copies de tout cela dans le journal et, pour les photos, dans Drive."}
              </p>
            </div>
            <div>
              <p className="font-medium text-[#F2F3F5]">Gardé</p>
              <p className="text-[#9CA3AF]">
                {`${apercu.garde.documentsEmis} document${apercu.garde.documentsEmis > 1 ? "s" : ""} émis`} (factures, avoirs, devis, avec l&apos;identité imprimée) et {pluriel(apercu.garde.encaissements, "paiement")} (payeur, montant) :
                conservation légale. Étapes, montants et dates restent pour les statistiques, sans nom (référence {apercu.reference}).
              </p>
            </div>
            {apercu.adresses.length > 0 || apercu.telephones.length > 0 ? (
              <div className="rounded-[8px] border-[0.5px] border-[#EF9F27]/40 bg-[#EF9F27]/10 px-3 py-2 text-[#F5B454]">
                <p className="font-medium">À faire à la main, hors du CRM (il ne supprime jamais rien dans Gmail)</p>
                {apercu.adresses.length > 0 ? <p className="mt-1">Dans Gmail, chercher et supprimer les mails de : {apercu.adresses.join(", ")}.</p> : null}
                {apercu.telephones.length > 0 ? <p className="mt-1">Sur le téléphone, retirer le contact : {apercu.telephones.join(", ")}.</p> : null}
                <p className="mt-1 text-[12px] opacity-80">Notez-les maintenant : après l&apos;anonymisation, le CRM ne les connaît plus.</p>
              </div>
            ) : null}
            <Puces libelle="Motif" obligatoire options={MOTIFS} valeur={motif} onChange={setMotif} />
            <ZoneTexte
              libelle={motif === "AUTRE" ? "Précision" : "Précision (facultative)"}
              obligatoire={motif === "AUTRE"}
              rows={2}
              maxLength={500}
              placeholder="Date et moyen de la demande, sans nom"
              value={commentaire}
              onChange={(evenement) => setCommentaire(evenement.target.value)}
            />
            <CaseACocher libelle="Je comprends que c'est définitif" description="Aucune restauration possible." checked={confirmation} onChange={setConfirmation} disabled={bloque} />
          </div>
        )}
      </Modale>
    </>
  );
}
