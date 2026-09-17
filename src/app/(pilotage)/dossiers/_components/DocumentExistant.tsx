"use client";

import { useEffect, useId, useState } from "react";
import { AlertTriangle, FileUp } from "lucide-react";
import { toast } from "sonner";
import { ErreurApi } from "@/components/pilotage/client";
import { Puces } from "@/components/pilotage/ui";
import { LIBELLES_STATUT_DOCUMENT } from "@/lib/dossiers/constants";
import { jourParis } from "@/lib/dossiers/dates";
import { formatMontant, formatQuantite, lireNombre } from "@/lib/dossiers/montants";
import { numerosProposables } from "@/lib/dossiers/numeros-libres";
import type { NumeroLibre } from "@/lib/dossiers/registre";
import type { DocumentVue, DossierDetail } from "@/lib/dossiers/types";
import { appelApi, envoyerJson, messageErreur } from "./client";
import { Bouton, Champ, Modale } from "./ui";

type TypeExistant = "DEVIS" | "FACTURE";
const STATUTS_DEVIS = ["ENVOYE", "ACCEPTE", "REFUSE"] as const;

/**
 * Devis ou facture émis avant le CRM : rattaché avec son numéro du registre,
 * sa date réelle, son montant et son PDF, sans rien générer. Aussi la
 * correction d'un document déjà repris (son numéro ne change pas).
 */
export function ModaleDocumentExistant({
  detail,
  document,
  onFermer,
  onMisAJour,
}: {
  detail: DossierDetail;
  /** Document repris à corriger ; absent : nouveau rattachement. */
  document?: DocumentVue;
  onFermer: () => void;
  onMisAJour: (detail: DossierDetail) => void;
}) {
  const idListe = useId();
  const aujourdhui = jourParis(new Date());
  const [type, setType] = useState<TypeExistant>(document?.type === "FACTURE" ? "FACTURE" : "DEVIS");
  const [numero, setNumero] = useState(document?.numero ?? "");
  const [dateEmission, setDateEmission] = useState(document?.dateEmission ? jourParis(document.dateEmission) : "");
  const [montant, setMontant] = useState(document ? formatQuantite(document.totalHt) : "");
  const [statut, setStatut] = useState<string>(document?.statut && document.statut !== "GENERE" ? document.statut : "ENVOYE");
  const [objet, setObjet] = useState(document?.objet ?? detail.objet);
  const [acompte, setAcompte] = useState(document?.acomptePct != null ? String(document.acomptePct) : "");
  const [pdf, setPdf] = useState<File | null>(null);
  const [libres, setLibres] = useState<NumeroLibre[]>([]);
  const [absent, setAbsent] = useState(false);
  const [envoi, setEnvoi] = useState(false);

  useEffect(() => {
    if (document) return;
    let actif = true;
    appelApi<{ libres: NumeroLibre[] }>("/api/numeros?libres=1")
      .then((reponse) => actif && setLibres(reponse.libres))
      .catch(() => {
        // Sans suggestions, le numéro se tape à la main.
      });
    return () => {
      actif = false;
    };
  }, [document]);

  const montantLu = montant.trim() ? lireNombre(montant) : null;
  const acompteLu = acompte.trim() ? Number(acompte) : null;
  const erreurMontant = montant.trim() && (montantLu === null || montantLu <= 0) ? "Montant invalide." : null;
  const erreurAcompte = acompte.trim() && (!Number.isInteger(acompteLu) || acompteLu! < 0 || acompteLu! > 100) ? "Pourcentage entre 0 et 100." : null;
  const erreurDate = dateEmission > aujourdhui ? "La date est à venir." : null;
  const complet = Boolean(numero.trim() && dateEmission && montantLu && montantLu > 0 && !erreurDate && !erreurAcompte);
  const suggestions = numerosProposables(libres, type);
  const connu = libres.find((libre) => libre.numero.toLowerCase() === numero.trim().toLowerCase());

  function choisirNumero(valeur: string) {
    setNumero(valeur);
    setAbsent(false);
    const libre = libres.find((candidat) => candidat.numero.toLowerCase() === valeur.trim().toLowerCase());
    if (libre?.emisLe && !dateEmission) setDateEmission(jourParis(libre.emisLe));
    if (libre?.montant && !montant.trim()) setMontant(formatQuantite(libre.montant));
  }

  async function envoyerPdf(documentId: string): Promise<DossierDetail | null> {
    if (!pdf) return null;
    const formulaire = new FormData();
    formulaire.set("pdf", pdf);
    try {
      return await appelApi<DossierDetail>(`/api/dossiers/${detail.id}/documents/${documentId}/pdf`, { method: "POST", body: formulaire });
    } catch (erreur) {
      toast.error("PDF non importé", { description: `${messageErreur(erreur)} Le document est bien enregistré : réessaie depuis sa ligne.` });
      return null;
    }
  }

  async function enregistrer(inscrireAuRegistre = false) {
    if (!complet) return;
    setEnvoi(true);
    try {
      const commun = {
        dateEmission,
        montant: montantLu!,
        objet: objet.trim() || null,
        ...(type === "DEVIS" ? { statut, acomptePct: acompteLu } : {}),
      };
      let avertissements: string[];
      let nouveau: DossierDetail;
      if (document) {
        const reponse = await envoyerJson<{ avertissements: string[]; dossier: DossierDetail }>(`/api/dossiers/${detail.id}/documents/${document.id}`, "PATCH", commun);
        avertissements = reponse.avertissements;
        nouveau = (await envoyerPdf(document.id)) ?? reponse.dossier;
      } else {
        const reponse = await envoyerJson<{ documentId: string; numero: string; avertissements: string[]; dossier: DossierDetail }>(
          `/api/dossiers/${detail.id}/documents/existant`,
          "POST",
          { ...commun, type, numero: numero.trim(), inscrireAuRegistre }
        );
        avertissements = reponse.avertissements;
        nouveau = (await envoyerPdf(reponse.documentId)) ?? reponse.dossier;
      }
      onMisAJour(nouveau);
      toast.success(document ? "Document corrigé" : `${type === "DEVIS" ? "Devis" : "Facture"} ${numero.trim()} rattaché${type === "FACTURE" ? "e" : ""}`, {
        description: avertissements.length ? avertissements.join(" ") : undefined,
      });
      onFermer();
    } catch (erreur) {
      if (erreur instanceof ErreurApi && erreur.status === 404 && (erreur.corps as { absentDuRegistre?: boolean } | null)?.absentDuRegistre) {
        setAbsent(true);
      } else {
        toast.error(document ? "Correction non enregistrée" : "Document non rattaché", { description: messageErreur(erreur) });
      }
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <Modale
      ouverte
      onFermer={onFermer}
      titre={document ? `Corriger ${document.type === "DEVIS" ? "le devis" : "la facture"} ${document.numero}` : "Enregistrer un document existant"}
      description={
        document
          ? "Document émis avant le CRM : tout se corrige sauf son numéro. L'ancienne valeur reste au journal."
          : "Un devis ou une facture déjà émis à la main : il garde son numéro du registre, rien n'est généré et le compteur ne bouge pas."
      }
      pied={
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Bouton variante="fantome" onClick={onFermer}>
            Annuler
          </Bouton>
          <Bouton variante="primaire" icone={<FileUp size={14} aria-hidden />} disabled={!complet} chargement={envoi && !absent} onClick={() => void enregistrer()}>
            {document ? "Enregistrer la correction" : "Rattacher au dossier"}
          </Bouton>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        {document ? null : (
          <Puces
            libelle="Document"
            obligatoire
            options={[
              { valeur: "DEVIS" as const, libelle: "Devis" },
              { valeur: "FACTURE" as const, libelle: "Facture" },
            ]}
            valeur={type}
            onChange={(valeur) => {
              setType(valeur);
              setAbsent(false);
            }}
          />
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Champ
              libelle="Numéro"
              obligatoire
              list={document ? undefined : idListe}
              readOnly={Boolean(document)}
              autoComplete="off"
              placeholder={type === "DEVIS" ? "2026-012" : "F2026-004"}
              value={numero}
              onChange={(evenement) => choisirNumero(evenement.target.value)}
              aide={
                document
                  ? "Un numéro émis ne change jamais."
                  : connu
                    ? `Au registre${connu.destinataire ? ` · ${connu.destinataire}` : ""}${connu.montant ? ` · ${formatMontant(connu.montant)}` : ""}`
                    : suggestions.length
                      ? `${suggestions.length} numéro${suggestions.length > 1 ? "s" : ""} du registre à rattacher`
                      : undefined
              }
            />
            {document ? null : (
              <datalist id={idListe}>
                {suggestions.map((libre) => (
                  <option key={libre.id} value={libre.numero}>
                    {[libre.destinataire, libre.montant ? formatMontant(libre.montant) : null].filter(Boolean).join(" · ")}
                  </option>
                ))}
              </datalist>
            )}
          </div>
          <Champ libelle="Émis le" obligatoire type="date" max={aujourdhui} value={dateEmission} erreur={erreurDate} onChange={(evenement) => setDateEmission(evenement.target.value)} />
          <Champ libelle="Montant (€)" obligatoire inputMode="decimal" placeholder="Ex. 3 200" value={montant} erreur={erreurMontant} onChange={(evenement) => setMontant(evenement.target.value)} />
          {type === "DEVIS" ? (
            <Champ libelle="Acompte prévu (%)" inputMode="numeric" placeholder="Ex. 30" value={acompte} erreur={erreurAcompte} onChange={(evenement) => setAcompte(evenement.target.value)} />
          ) : null}
        </div>
        {type === "DEVIS" ? (
          <Puces libelle="Où en est ce devis" options={STATUTS_DEVIS.map((valeur) => ({ valeur, libelle: LIBELLES_STATUT_DOCUMENT[valeur] }))} valeur={statut} onChange={setStatut} />
        ) : null}
        <Champ libelle="Objet" maxLength={160} value={objet} onChange={(evenement) => setObjet(evenement.target.value)} />
        <div>
          <label className="mb-1.5 block text-[12px] font-medium text-[#9CA3AF]" htmlFor={`${idListe}-pdf`}>
            {document?.pdfUrl ? "Remplacer le PDF (l'ancien reste aux archives)" : "PDF du document"}
          </label>
          <input
            id={`${idListe}-pdf`}
            type="file"
            accept="application/pdf,.pdf"
            onChange={(evenement) => setPdf(evenement.target.files?.[0] ?? null)}
            className="block w-full text-[13px] text-[#9CA3AF] file:mr-3 file:h-9 file:rounded-[8px] file:border-[0.5px] file:border-[#2A2D34] file:bg-[#1C1F25] file:px-3 file:text-[13px] file:text-[#F2F3F5] hover:file:bg-[#22262D]"
          />
          <p className="mt-1 text-[12px] text-[#6B7280]">Facultatif : sans PDF, le document ne s&apos;ouvre ni ne s&apos;envoie depuis le CRM.</p>
        </div>

        {absent ? (
          <div className="rounded-[9px] border-[0.5px] border-[#EF9F27]/40 bg-[#EF9F27]/10 px-3 py-2.5">
            <p className="flex items-start gap-1.5 text-[12.5px] text-[#F5B454]">
              <AlertTriangle size={13} aria-hidden className="mt-0.5 shrink-0" />
              {`${numero.trim()} n'est pas au registre des numéros. Vérifie la saisie : un numéro inscrit y reste pour toujours.`}
            </p>
            <Bouton className="mt-2" taille="sm" variante="secondaire" chargement={envoi} onClick={() => void enregistrer(true)}>
              L&apos;inscrire au registre et le rattacher
            </Bouton>
          </div>
        ) : null}
      </div>
    </Modale>
  );
}
