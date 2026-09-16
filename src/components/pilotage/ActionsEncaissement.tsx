"use client";

import { useState } from "react";
import { toast } from "sonner";
import { formatDateCourte, jourParis } from "@/lib/dossiers/dates";
import { formatMontant } from "@/lib/dossiers/montants";
import { LIBELLES_MOYEN, MOTIFS_ANNULATION, MOTIFS_REJET, type MoyenPaiement } from "@/lib/encaissements/constantes";
import { envoyerJson, messageErreur } from "./client";
import { ChampsPaiement, lirePaiement, saisiePaiement, type SaisiePaiement } from "./SaisiePaiement";
import { Bouton, Champ, Modale, Puces } from "./ui";

export type TypeActionEncaissement = "credit" | "rejet" | "annulation";

export type EncaissementResume = {
  id: string;
  montant: number;
  moyen: MoyenPaiement | null;
  reference: string | null;
  recuLe: string;
};

const TITRES: Record<TypeActionEncaissement, string> = {
  credit: "Chèque crédité sur le compte",
  rejet: "Chèque rejeté",
  annulation: "Annuler ce paiement",
};

/**
 * Suite d'un encaissement : chèque crédité (date du relevé), chèque rejeté
 * (date et motif), paiement annulé pour erreur de saisie (motif). Rien ne
 * s'efface : le paiement reste visible, avec ce qui lui est arrivé.
 */
export function ModaleActionEncaissement<R>({
  encaissement,
  type,
  onFermer,
  onFait,
  precisionSucces,
}: {
  encaissement: EncaissementResume;
  type: TypeActionEncaissement;
  onFermer: () => void;
  onFait: (reponse: R) => void;
  /** Complément du message de réussite (l'étape du dossier a changé…). */
  precisionSucces?: (reponse: R) => string | undefined;
}) {
  const [le, setLe] = useState(jourParis(new Date()));
  const [motif, setMotif] = useState<string | null>(null);
  const [precision, setPrecision] = useState("");
  const [envoi, setEnvoi] = useState(false);

  const description = `${formatMontant(encaissement.montant)}${encaissement.moyen ? ` par ${LIBELLES_MOYEN[encaissement.moyen].toLowerCase()}` : ""}${
    encaissement.reference ? ` n° ${encaissement.reference}` : ""
  }, reçu le ${formatDateCourte(encaissement.recuLe)}.`;
  const motifs = type === "rejet" ? MOTIFS_REJET : MOTIFS_ANNULATION;
  const complet = type === "credit" ? Boolean(le) : Boolean(motif) && (motif !== "AUTRE" || precision.trim().length >= 3) && (type !== "rejet" || Boolean(le));

  async function valider() {
    if (!complet) return;
    setEnvoi(true);
    try {
      const corps =
        type === "credit"
          ? { crediteLe: le }
          : type === "rejet"
            ? { le, motif, precision: precision.trim() || undefined }
            : { motif, precision: precision.trim() || undefined };
      const reponse = await envoyerJson<R>(`/api/encaissements/${encaissement.id}/${type}`, "POST", corps);
      onFait(reponse);
      toast.success(type === "credit" ? "Chèque crédité" : type === "rejet" ? "Chèque rejeté" : "Paiement annulé", {
        description: precisionSucces?.(reponse),
      });
      onFermer();
    } catch (erreur) {
      toast.error("Action refusée", { description: messageErreur(erreur) });
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <Modale
      ouverte
      onFermer={onFermer}
      largeur="sm"
      titre={TITRES[type]}
      description={
        type === "annulation"
          ? `${description} Pour une erreur de saisie : le paiement reste visible, barré, et ne compte plus.`
          : type === "rejet"
            ? `${description} Le paiement ne compte plus ; ce qu'il réglait est de nouveau dû.`
            : description
      }
      pied={
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Bouton variante="fantome" onClick={onFermer}>
            Retour
          </Bouton>
          <Bouton variante={type === "credit" ? "primaire" : "danger"} disabled={!complet} chargement={envoi} onClick={() => void valider()}>
            {type === "credit" ? "Enregistrer le crédit" : type === "rejet" ? "Enregistrer le rejet" : "Annuler le paiement"}
          </Bouton>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        {type !== "annulation" ? (
          <Champ
            libelle={type === "credit" ? "Crédité le (date du relevé)" : "Rejeté le"}
            obligatoire
            type="date"
            min={jourParis(encaissement.recuLe)}
            max={jourParis(new Date())}
            value={le}
            onChange={(evenement) => setLe(evenement.target.value)}
          />
        ) : null}
        {type !== "credit" ? (
          <>
            <Puces libelle="Motif" obligatoire options={motifs.map((option) => ({ valeur: option.code as string, libelle: option.libelle }))} valeur={motif} onChange={setMotif} />
            <Champ
              libelle={motif === "AUTRE" ? "Précision" : "Précision (facultative)"}
              obligatoire={motif === "AUTRE"}
              maxLength={300}
              value={precision}
              onChange={(evenement) => setPrecision(evenement.target.value)}
            />
          </>
        ) : null}
      </div>
    </Modale>
  );
}

/** Paiement reçu pour une facture précise (depuis l'encours : facture du CRM ou émise ailleurs). */
export function ModalePaiementFacture({
  facture,
  onFermer,
  onFait,
}: {
  facture: { registreId: string; numero: string; client: string; reste: number };
  onFermer: () => void;
  onFait: () => void;
}) {
  const [saisie, setSaisie] = useState<SaisiePaiement>(() => saisiePaiement(facture.reste));
  const [envoi, setEnvoi] = useState(false);
  const { paiement } = lirePaiement(saisie);

  async function enregistrer() {
    if (!paiement) return;
    setEnvoi(true);
    try {
      await envoyerJson("/api/encaissements", "POST", { paiement, numeroDocumentId: facture.registreId, payeur: facture.client });
      toast.success("Paiement enregistré", { description: `Facture ${facture.numero}` });
      onFait();
      onFermer();
    } catch (erreur) {
      toast.error("Paiement non enregistré", { description: messageErreur(erreur) });
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <Modale
      ouverte
      onFermer={onFermer}
      largeur="sm"
      titre={`Paiement reçu · facture ${facture.numero}`}
      description={`${facture.client} · reste ${formatMontant(facture.reste)}. À la date où il a été reçu, même lointaine.`}
      pied={
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Bouton variante="fantome" onClick={onFermer}>
            Annuler
          </Bouton>
          <Bouton variante="primaire" disabled={!paiement} chargement={envoi} onClick={() => void enregistrer()}>
            Enregistrer le paiement
          </Bouton>
        </div>
      }
    >
      <ChampsPaiement saisie={saisie} onChange={setSaisie} />
    </Modale>
  );
}
