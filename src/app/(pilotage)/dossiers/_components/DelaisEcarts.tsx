"use client";

import { useState } from "react";
import { AlertTriangle, Clock, Pencil } from "lucide-react";
import { toast } from "sonner";
import { Pastille } from "@/components/pilotage/ui";
import { LIBELLES_ETAPE } from "@/lib/dossiers/constants";
import { formatDateCourte, jourParis } from "@/lib/dossiers/dates";
import { dureeParEtape, formatDuree, type PassageEtape } from "@/lib/dossiers/delais";
import { formatMontant } from "@/lib/dossiers/montants";
import type { DossierDetail } from "@/lib/dossiers/types";
import { envoyerJson, messageErreur } from "./client";
import { Bouton, Champ, COULEURS_ETAPE, Modale, TitreSection } from "./ui";

function LignePrix({ libelle, montant, accent }: { libelle: string; montant: number | null; accent?: string }) {
  if (montant === null) return null;
  return (
    <div className="flex items-baseline justify-between gap-3 py-0.5 text-[13px]">
      <span className="text-[#9CA3AF]">{libelle}</span>
      <span className="text-[#F2F3F5] tabular-nums">
        {formatMontant(montant)}
        {accent ? <span className="ml-1.5 text-[12px] text-[#9CA3AF]">{accent}</span> : null}
      </span>
    </div>
  );
}

const libellePassage = (passage: PassageEtape) =>
  passage.ouverture ? `Ouverture · ${LIBELLES_ETAPE[passage.etape]}` : LIBELLES_ETAPE[passage.etape];

/** Date réelle d'un passage : « signé en juillet », même saisi en septembre. L'ordre du parcours suit les dates. */
function ModaleDatePassage({
  detail,
  index,
  onFermer,
  onMisAJour,
}: {
  detail: DossierDetail;
  index: number;
  onFermer: () => void;
  onMisAJour: (detail: DossierDetail) => void;
}) {
  const passage = detail.parcours[index];
  const precedent = detail.parcours[index - 1];
  const suivant = detail.parcours[index + 1];
  const aujourdhui = jourParis(new Date());
  const [jour, setJour] = useState(passage.dateInconnue ? "" : jourParis(passage.debut));
  const [envoi, setEnvoi] = useState(false);

  const avertissement =
    jour && precedent && !precedent.dateInconnue && jour < jourParis(precedent.debut)
      ? `C'est avant « ${libellePassage(precedent)} » (${formatDateCourte(precedent.debut)}) : le parcours sera remis dans l'ordre des dates.`
      : jour && suivant && !suivant.dateInconnue && jour > jourParis(suivant.debut)
        ? `C'est après « ${libellePassage(suivant)} » (${formatDateCourte(suivant.debut)}) : le parcours sera remis dans l'ordre des dates.`
        : null;

  async function enregistrer() {
    if (!jour || !passage.evenementId) return;
    setEnvoi(true);
    try {
      onMisAJour(await envoyerJson<DossierDetail>(`/api/dossiers/${detail.id}/evenements/${passage.evenementId}`, "PATCH", { survenuLe: jour }));
      toast.success("Date enregistrée", { description: "L'ancienne date reste au journal." });
      onFermer();
    } catch (probleme) {
      toast.error("Date non enregistrée", { description: messageErreur(probleme) });
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <Modale
      ouverte
      onFermer={onFermer}
      largeur="sm"
      titre={`Date réelle : ${libellePassage(passage)}`}
      description={passage.saisiLe ? `Saisi dans le CRM le ${formatDateCourte(passage.saisiLe)}.` : "Le jour où c'est vraiment arrivé, même avant la saisie dans le CRM."}
      pied={
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Bouton variante="fantome" onClick={onFermer}>
            Annuler
          </Bouton>
          <Bouton variante="primaire" disabled={!jour || jour > aujourdhui} chargement={envoi} onClick={() => void enregistrer()}>
            Enregistrer la date
          </Bouton>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <Champ libelle="Date" type="date" max={aujourdhui} value={jour} onChange={(evenement) => setJour(evenement.target.value)} erreur={jour > aujourdhui ? "La date est à venir." : null} />
        {avertissement ? (
          <p className="flex gap-1.5 rounded-[8px] bg-[#EF9F27]/10 px-3 py-2 text-[12.5px] text-[#F5B454]">
            <AlertTriangle size={13} aria-hidden className="mt-0.5 shrink-0" />
            {avertissement}
          </p>
        ) : null}
      </div>
    </Modale>
  );
}

/** Temps passé à chaque étape, dates réelles des passages (corrigeables) et chemin du prix, du premier devis au facturé. */
export function DelaisEcarts({ detail, onMisAJour }: { detail: DossierDetail; onMisAJour: (detail: DossierDetail) => void }) {
  const [enCorrection, setEnCorrection] = useState<number | null>(null);
  const dernier = detail.parcours.at(-1);
  // L'étape du dossier fait foi : une date corrigée peut placer son passage avant d'autres.
  const courant = [...detail.parcours].reverse().find((passage) => passage.etape === detail.etape) ?? dernier;
  const desordre = Boolean(courant && dernier && courant !== dernier);
  const ouverture = detail.parcours.find((passage) => passage.ouverture) ?? detail.parcours[0];
  const durees = dureeParEtape(detail.parcours);
  const total = ouverture
    ? detail.parcours.filter((passage) => passage.debut >= ouverture.debut).reduce((somme, passage) => somme + passage.dureeMs, 0)
    : 0;
  const { ecarts, delais } = detail;
  const aDesPrix = [ecarts.estimation, ecarts.premierDevis, ecarts.devisSigne, ecarts.facture].some((montant) => montant !== null);
  if (!courant && !aDesPrix) return null;

  const delaisVisibles = [
    { libelle: "Ouverture → signature", duree: delais.ouvertureASignature },
    { libelle: "Signature → chantier", duree: delais.signatureAChantier },
    { libelle: "Facturation → encaissement", duree: delais.facturationAEncaissement },
    { libelle: "De bout en bout", duree: delais.boutEnBout },
  ].filter((ligne): ligne is { libelle: string; duree: number } => ligne.duree !== null);

  return (
    <section>
      <TitreSection>Délais et prix</TitreSection>
      <div className="space-y-3 rounded-[11px] border-[0.5px] border-[#2A2D34] bg-[#1C1F25] p-3.5">
        {courant ? (
          <p className="flex items-center gap-2 text-[13px] text-[#F2F3F5]">
            <Clock size={14} className="shrink-0 text-[#9CA3AF]" aria-hidden />
            {desordre ? (
              <>
                En « {LIBELLES_ETAPE[courant.etape]} » depuis le {formatDateCourte(courant.debut)}
              </>
            ) : (
              <>
                Depuis {formatDuree(courant.dureeMs)} en « {LIBELLES_ETAPE[courant.etape]} »
              </>
            )}
            <span className="text-[#6B7280]">· dossier ouvert depuis {formatDuree(total)}</span>
          </p>
        ) : null}
        {desordre ? (
          <p className="flex items-center gap-1.5 text-[12px] text-[#F5B454]">
            <AlertTriangle size={13} className="shrink-0" aria-hidden />
            Des dates du parcours ne se suivent pas : vérifie-les ci-dessous.
          </p>
        ) : null}

        {total > 0 ? (
          <div>
            <div className="flex h-2 overflow-hidden rounded-full bg-[#22262D]" aria-hidden>
              {detail.parcours.map((passage, index) => (
                <span
                  key={`${passage.etape}-${index}`}
                  style={{ width: `${(passage.dureeMs / total) * 100}%`, backgroundColor: COULEURS_ETAPE[passage.etape] }}
                />
              ))}
            </div>
            <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
              {Object.entries(durees).map(([etape, duree]) => (
                <li key={etape} className="flex items-center gap-1.5 text-[12px] text-[#9CA3AF]">
                  <span aria-hidden className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: COULEURS_ETAPE[etape as keyof typeof COULEURS_ETAPE] }} />
                  {LIBELLES_ETAPE[etape as keyof typeof LIBELLES_ETAPE]} : {formatDuree(duree ?? 0)}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {detail.parcours.length > 0 ? (
          <ol aria-label="Dates des étapes" className="border-t-[0.5px] border-[#2A2D34] pt-2">
            {detail.parcours.map((passage, index) => (
              <li key={passage.evenementId ?? `${passage.etape}-${index}`} className="flex min-h-8 items-center justify-between gap-3 text-[13px]">
                <span className="min-w-0 truncate text-[#9CA3AF]">{libellePassage(passage)}</span>
                <span className="flex shrink-0 items-center gap-1.5">
                  {passage.dateInconnue ? (
                    <Pastille ton="ambre">date inconnue</Pastille>
                  ) : (
                    <span className="text-[#F2F3F5] tabular-nums" title={passage.saisiLe ? `Saisi le ${formatDateCourte(passage.saisiLe)}` : undefined}>
                      {formatDateCourte(passage.debut)}
                    </span>
                  )}
                  {passage.evenementId ? (
                    <Bouton variante="fantome" taille="icone" className="h-8 w-8 sm:h-7 sm:w-7" aria-label={`Corriger la date : ${libellePassage(passage)}`} onClick={() => setEnCorrection(index)}>
                      <Pencil size={12} aria-hidden />
                    </Bouton>
                  ) : null}
                </span>
              </li>
            ))}
          </ol>
        ) : null}

        {delaisVisibles.length > 0 ? (
          <ul className="border-t-[0.5px] border-[#2A2D34] pt-2">
            {delaisVisibles.map((ligne) => (
              <li key={ligne.libelle} className="flex justify-between gap-3 py-0.5 text-[13px]">
                <span className="text-[#9CA3AF]">{ligne.libelle}</span>
                <span className="text-[#F2F3F5] tabular-nums">{formatDuree(ligne.duree)}</span>
              </li>
            ))}
          </ul>
        ) : null}

        {aDesPrix ? (
          <div className="border-t-[0.5px] border-[#2A2D34] pt-2">
            <LignePrix libelle="Estimation" montant={ecarts.estimation} />
            <LignePrix
              libelle="Premier devis"
              montant={ecarts.premierDevis}
              accent={ecarts.dernierDevis !== null && ecarts.dernierDevis !== ecarts.premierDevis ? `dernier : ${formatMontant(ecarts.dernierDevis)}` : undefined}
            />
            <LignePrix
              libelle="Signé"
              montant={ecarts.devisSigne}
              accent={
                ecarts.ecartSignature !== null && ecarts.ecartSignature !== 0
                  ? `${ecarts.ecartSignature > 0 ? "+" : ""}${formatMontant(ecarts.ecartSignature)} (${ecarts.ecartSignaturePct} %)`
                  : undefined
              }
            />
            <LignePrix libelle="Facturé" montant={ecarts.facture} />
          </div>
        ) : null}
      </div>
      {enCorrection !== null && detail.parcours[enCorrection] ? (
        <ModaleDatePassage key={enCorrection} detail={detail} index={enCorrection} onFermer={() => setEnCorrection(null)} onMisAJour={onMisAJour} />
      ) : null}
    </section>
  );
}
