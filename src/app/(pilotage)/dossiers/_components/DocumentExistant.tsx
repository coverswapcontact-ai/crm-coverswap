"use client";

import { useEffect, useId, useState } from "react";
import { AlertTriangle, FileUp } from "lucide-react";
import { toast } from "sonner";
import { ErreurApi, appelApi, envoyerJson, messageErreur } from "@/components/pilotage/client";
import { Puces, Bouton, Champ, Modale } from "@/components/pilotage/ui";
import { ETAPES_SIGNEES_PAR_DEVIS_ACCEPTE, LIBELLES_STATUT_DOCUMENT } from "@/lib/dossiers/constants";
import { formatDateCourte, jourParis } from "@/lib/dossiers/dates";
import { formatMontant, formatQuantite, lireNombre } from "@/lib/dossiers/montants";
import { numerosProposables } from "@/lib/dossiers/numeros-libres";
import type { NumeroLibre } from "@/lib/dossiers/registre";
import type { DocumentVue, DossierDetail } from "@/lib/dossiers/types";

type TypeExistant = "DEVIS" | "FACTURE";
const STATUTS_DEVIS = ["ENVOYE", "ACCEPTE", "REFUSE"] as const;

/** Mission 18 (B3) : le PDF parti de Gmail à enregistrer comme devis envoyé (GET /api/dossiers/[id]/devis-gmail). */
type DevisGmailVue = {
  messageId: string;
  pieceId: string;
  nom: string;
  envoyeLe: string;
  a: string;
  numero: string | null;
  devisCrm: { id: string; numero: string } | null;
  registre: { numero: string; montant: number | null; emisLe: string | null } | null;
};

/**
 * Devis ou facture émis avant le CRM : rattaché avec son numéro du registre,
 * sa date réelle, son montant et son PDF, sans rien générer. Aussi la
 * correction d'un document déjà repris (son numéro ne change pas).
 */
export function ModaleDocumentExistant({
  detail,
  document,
  depotDevis = false,
  pieceGmail,
  onFermer,
  onMisAJour,
}: {
  detail: DossierDetail;
  /** Document repris à corriger ; absent : nouveau rattachement. */
  document?: DocumentVue;
  /** Mission 11 : « Déposer un devis PDF » — un devis fait ailleurs, proposé au client à côté des autres. */
  depotDevis?: boolean;
  /** Mission 18 (B3) : « Enregistrer comme devis envoyé » — la pièce (PDF) d'un mail parti de Gmail. */
  pieceGmail?: string;
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
  const [libelle, setLibelle] = useState(document?.libelleVariante ?? "");
  const [visible, setVisible] = useState(document?.visibleEspace ?? true);
  const [pdf, setPdf] = useState<File | null>(null);
  const [libres, setLibres] = useState<NumeroLibre[]>([]);
  const [absent, setAbsent] = useState(false);
  const [envoi, setEnvoi] = useState(false);
  const [gmail, setGmail] = useState<DevisGmailVue | null>(null);
  const [erreurGmail, setErreurGmail] = useState<string | null>(null);

  useEffect(() => {
    if (!pieceGmail) return;
    let actif = true;
    appelApi<DevisGmailVue>(`/api/dossiers/${detail.id}/devis-gmail?piece=${encodeURIComponent(pieceGmail)}`)
      .then((lu) => {
        if (!actif) return;
        setGmail(lu);
        // Prérempli : numéro lu dans le nom du fichier (ou celui du registre), date du mail, montant du registre.
        setNumero(lu.registre?.numero ?? lu.numero ?? "");
        setDateEmission(jourParis(lu.envoyeLe));
        if (lu.registre?.montant) setMontant(formatQuantite(lu.registre.montant));
      })
      .catch((erreur) => actif && setErreurGmail(messageErreur(erreur)));
    return () => {
      actif = false;
    };
  }, [pieceGmail, detail.id]);

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
  const complet = gmail?.devisCrm ? true : Boolean(numero.trim() && dateEmission && montantLu && montantLu > 0 && !erreurDate && !erreurAcompte);
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

  /** Mission 18 (B3) : le devis parti de Gmail, déposé avec son PDF (ou le devis du CRM passé « Envoyé »), daté du mail. */
  async function enregistrerGmail(lu: DevisGmailVue, inscrireAuRegistre: boolean) {
    const reponse = await envoyerJson<{ numero: string; avertissements: string[]; gmail: { nature: "DEPOSE" | "ENVOYE"; deja: boolean } | null; dossier: DossierDetail }>(`/api/dossiers/${detail.id}/devis-gmail`, "POST", {
      messageId: lu.messageId,
      pieceId: lu.pieceId,
      numero: lu.devisCrm ? lu.devisCrm.numero : numero.trim(),
      montant: lu.devisCrm ? null : montantLu,
      dateEmission: lu.devisCrm ? null : dateEmission,
      acomptePct: lu.devisCrm ? null : acompteLu,
      libelleVariante: lu.devisCrm ? null : libelle.trim() || null,
      objet: lu.devisCrm ? null : objet.trim() || null,
      inscrireAuRegistre,
    });
    onMisAJour(reponse.dossier);
    toast.success(reponse.gmail?.deja ? `Devis ${reponse.numero} déjà enregistré` : `Devis ${reponse.numero} enregistré comme envoyé`, {
      description: [...reponse.avertissements, reponse.gmail?.deja ? "" : "Relances comptées depuis le mail. Aucun mail n'est parti."].filter(Boolean).join(" "),
    });
    onFermer();
  }

  async function enregistrer(inscrireAuRegistre = false) {
    if (!complet) return;
    setEnvoi(true);
    try {
      if (gmail) {
        await enregistrerGmail(gmail, inscrireAuRegistre);
        return;
      }
      const commun = {
        dateEmission,
        montant: montantLu!,
        objet: objet.trim() || null,
        ...(type === "DEVIS" ? { statut, acomptePct: acompteLu, libelleVariante: libelle.trim() || null, visibleEspace: visible } : {}),
      };
      let avertissements: string[];
      let nouveau: DossierDetail;
      if (document) {
        const reponse = await envoyerJson<{ avertissements: string[]; dossier: DossierDetail }>(`/api/dossiers/${detail.id}/documents/${document.id}`, "PATCH", commun);
        avertissements = reponse.avertissements;
        nouveau = (await envoyerPdf(document.id)) ?? reponse.dossier;
      } else {
        // Mission 18 (B4) : le PDF part dans la même requête — vérifié avant toute écriture, puis document, PDF et étape
        // d'un bloc (un faux PDF ne consomme pas le numéro et ne fait pas bouger le dossier).
        const donnees = { ...commun, type, numero: numero.trim(), inscrireAuRegistre };
        let corps: RequestInit;
        if (pdf) {
          const formulaire = new FormData();
          formulaire.set("donnees", JSON.stringify(donnees));
          formulaire.set("pdf", pdf);
          corps = { method: "POST", body: formulaire };
        } else {
          corps = { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(donnees) };
        }
        const reponse = await appelApi<{ documentId: string; numero: string; avertissements: string[]; changements: { vers: string }[]; dossier: DossierDetail }>(`/api/dossiers/${detail.id}/documents/existant`, corps);
        avertissements = [...reponse.avertissements, ...(reponse.changements.some((c) => c.vers === "SIGNE") ? ["Le dossier passe en « Signé » ; les autres devis proposés : non retenus."] : [])];
        nouveau = reponse.dossier;
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
      titre={document ? `Corriger ${document.type === "DEVIS" ? "le devis" : "la facture"} ${document.numero}` : pieceGmail ? "Enregistrer comme devis envoyé" : depotDevis ? "Déposer un devis déjà fait" : "Enregistrer un document existant"}
      description={
        document
          ? "Document émis avant le CRM : tout se corrige sauf son numéro. L'ancienne valeur reste au journal."
          : pieceGmail
            ? gmail
              ? gmail.devisCrm
                ? `Le devis ${gmail.devisCrm.numero} du CRM est parti depuis Gmail le ${formatDateCourte(gmail.envoyeLe)}${gmail.a ? ` à ${gmail.a}` : ""} : il passe « Envoyé », visible dans son espace, le dossier en « Devis envoyé ». Les relances partent de la date du mail. Aucun mail ne part.`
                : `« ${gmail.nom} », envoyé depuis Gmail le ${formatDateCourte(gmail.envoyeLe)}${gmail.a ? ` à ${gmail.a}` : ""} : rattaché avec ce PDF, visible dans son espace, le dossier en « Devis envoyé ». Les relances partent de la date du mail. Aucun mail ne part.`
              : (erreurGmail ?? "Lecture du mail…")
            : depotDevis
            ? "Un devis fait ailleurs (PDF) : son numéro, son libellé, son montant. Il est proposé au client dans son espace, à côté des autres devis du dossier."
            : "Un devis ou une facture déjà émis à la main : il garde son numéro du registre, rien n'est généré et le compteur ne bouge pas."
      }
      pied={
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Bouton variante="fantome" onClick={onFermer}>
            Annuler
          </Bouton>
          <Bouton variante="primaire" icone={<FileUp size={14} aria-hidden />} disabled={!complet || (Boolean(pieceGmail) && !gmail)} chargement={envoi && !absent} onClick={() => void enregistrer()}>
            {document ? "Enregistrer la correction" : pieceGmail ? "Enregistrer comme envoyé" : "Rattacher au dossier"}
          </Bouton>
        </div>
      }
    >
      {pieceGmail && !gmail ? null : gmail?.devisCrm ? (
        <p className="text-[12.5px] text-[#9CA3AF]">PDF du mail : {gmail.nom} (le devis garde le PDF du CRM).</p>
      ) : (
      <div className="flex flex-col gap-3">
        {document || pieceGmail ? null : (
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
        {type === "DEVIS" && !pieceGmail ? (
          <div>
            <Puces libelle="Où en est ce devis" options={STATUTS_DEVIS.map((valeur) => ({ valeur, libelle: LIBELLES_STATUT_DOCUMENT[valeur] }))} valeur={statut} onChange={setStatut} />
            {statut === "ACCEPTE" && document?.statut !== "ACCEPTE" && ETAPES_SIGNEES_PAR_DEVIS_ACCEPTE.includes(detail.etape) ? (
              <p className="mt-1 text-[12px] text-[#6B7280]">Accepté (signé hors ligne) : le dossier passera en « Signé », les autres devis proposés deviendront « non retenus ».</p>
            ) : null}
          </div>
        ) : null}
        {type === "DEVIS" ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Champ libelle="Libellé de la variante" maxLength={80} placeholder="Ex. façades + plan de travail" value={libelle} onChange={(evenement) => setLibelle(evenement.target.value)} aide="Facultatif : le client le voit dans son espace, à côté du montant." />
            {pieceGmail ? null : (
              <label className="flex items-center gap-2 self-start pt-7 text-[13px] text-[#D1D5DB]">
                <input type="checkbox" className="accent-[#1D9E75]" checked={visible} onChange={(evenement) => setVisible(evenement.target.checked)} />
                Visible dans l&apos;espace client
              </label>
            )}
          </div>
        ) : null}
        <Champ libelle="Objet" maxLength={160} value={objet} onChange={(evenement) => setObjet(evenement.target.value)} />
        {pieceGmail && gmail ? (
          <p className="text-[12.5px] text-[#9CA3AF]">PDF du mail : {gmail.nom}</p>
        ) : (
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
        )}

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
      )}
    </Modale>
  );
}
