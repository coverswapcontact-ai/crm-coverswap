"use client";

import { useState } from "react";
import Link from "next/link";
import { AlertTriangle, Ban, ChevronLeft, ChevronRight, Download, Landmark, Plus, SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";
import { ModaleActionEncaissement, ModalePaiementFacture, type TypeActionEncaissement } from "@/components/pilotage/ActionsEncaissement";
import { appelApi, messageErreur } from "@/components/pilotage/client";
import { useParametresExiges } from "@/components/pilotage/SaisieParametres";
import { Bouton, EnTetePage, Pastille, TRANS, TitreSection, CARTE } from "@/components/pilotage/ui";
import { formatMontant } from "@/lib/dossiers/montants";
import { LIBELLES_TRANCHE } from "@/lib/finances/calculs";
import { libelleMois } from "@/lib/finances/periodes";
import type { ChequeACrediter, LigneEncours, TableauFinances as Tableau } from "@/lib/finances/tableau";
import { DEFINITIONS_PARAMETRES, type CleParametre } from "@/lib/parametres/definitions";
import { cn } from "@/lib/utils";
import { dateCourte } from "@/lib/commun/format";


function AParametrer({ manquants, pourquoi, onRenseigner }: { manquants: CleParametre[]; pourquoi: string; onRenseigner: () => void }) {
  return (
    <div className={cn(CARTE, "flex flex-col gap-2.5 p-4 sm:flex-row sm:items-center")}>
      <SlidersHorizontal size={16} aria-hidden className="shrink-0 text-[#F5B454]" />
      <p className="flex-1 text-[13px] text-[#D1D5DB]">
        {pourquoi} Il manque : {manquants.map((cle) => DEFINITIONS_PARAMETRES[cle].libelle.toLowerCase()).join(" ; ")}.
      </p>
      <Bouton variante="secondaire" onClick={onRenseigner}>
        Renseigner
      </Bouton>
    </div>
  );
}

export default function TableauFinances({ initial }: { initial: Tableau }) {
  const [tableau, setTableau] = useState(initial);
  const [paiement, setPaiement] = useState<LigneEncours | null>(null);
  const [action, setAction] = useState<{ type: TypeActionEncaissement; cheque: ChequeACrediter } | null>(null);
  const { demander, modale } = useParametresExiges();
  const { annee, recettes, encours, cheques, qualite } = tableau;

  async function recharger() {
    try {
      setTableau(await appelApi<Tableau>(`/api/finances?annee=${annee}`));
    } catch (erreur) {
      toast.error("Actualisation impossible", { description: messageErreur(erreur) });
    }
  }

  const totalCheques = cheques.reduce((somme, cheque) => somme + cheque.montant, 0);

  return (
    <div className="mx-auto w-full max-w-5xl px-5 py-6 md:px-8 md:py-8">
      <EnTetePage
        titre="Finances"
        sousTitre="Encaisser, créditer les chèques, corriger, tenir le livre des recettes."
        actions={
          <div className="flex items-center gap-2">
            <Link href={`/finances?annee=${annee - 1}`} aria-label={`Année ${annee - 1}`} className={cn("rounded-[8px] p-2 text-[#9CA3AF] hover:bg-[#22262D] hover:text-[#F2F3F5]", TRANS)}>
              <ChevronLeft size={16} aria-hidden />
            </Link>
            <span className="text-[14px] font-medium text-[#F2F3F5] tabular-nums">{annee}</span>
            <Link href={`/finances?annee=${annee + 1}`} aria-label={`Année ${annee + 1}`} className={cn("rounded-[8px] p-2 text-[#9CA3AF] hover:bg-[#22262D] hover:text-[#F2F3F5]", TRANS)}>
              <ChevronRight size={16} aria-hidden />
            </Link>
          </div>
        }
      />

      {recettes.etat === "PARAMETRES" ? (
        <div className="mt-6">
          <AParametrer
            manquants={recettes.manquants}
            pourquoi="Pour dater les chèques dans le livre des recettes, une règle doit être choisie (à confirmer par le comptable)."
            onRenseigner={() => demander(recettes.manquants, recharger)}
          />
        </div>
      ) : null}

      {/* Mission 17 (partie B) : les chiffres (encaissé de l'année et du mois, URSSAF, seuils, encaissements par mois) sont
          dans l'Analytique, onglet Argent ; cet écran garde le travail : encaisser, créditer, corriger, tenir le livre. */}
      <p className="mt-4 text-[13px] text-[#9CA3AF]">
        Encaissé, URSSAF, franchise de TVA et courbes par mois&nbsp;:{" "}
        <Link href="/analytique?onglet=argent" className="text-[#5DCAA5] hover:underline">
          Analytique, onglet Argent
        </Link>
        .
      </p>

      <section className="mt-8">
        <TitreSection action={encours.lignes.length > 0 ? <span className="text-[13px] font-medium text-[#F5B454] tabular-nums">{formatMontant(encours.total)}</span> : undefined}>Reste à encaisser</TitreSection>
        {encours.lignes.length === 0 ? (
          <p className="text-[13px] text-[#6B7280]">Aucune facture en attente de paiement.</p>
        ) : (
          <ul className={cn(CARTE, "overflow-hidden")}>
            {encours.lignes.map((ligne) => (
              <li key={ligne.registreId} className="flex items-center gap-3 border-t-[0.5px] border-[#2A2D34] px-4 py-3 first:border-t-0">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                    {ligne.dossierId ? (
                      <Link href={`/dossiers?dossier=${ligne.dossierId}`} className="text-[13px] font-medium text-[#F2F3F5] tabular-nums hover:underline">
                        {ligne.numero}
                      </Link>
                    ) : (
                      <span className="text-[13px] font-medium text-[#F2F3F5] tabular-nums">{ligne.numero}</span>
                    )}
                    <span className="truncate text-[13px] text-[#D1D5DB]">{ligne.client}</span>
                    <Pastille ton={ligne.tranche === "NON_ECHUE" ? "neutre" : ligne.tranche === "J30" ? "ambre" : ligne.tranche === "INCONNUE" ? "neutre" : "rouge"}>
                      {ligne.tranche === "NON_ECHUE" || ligne.tranche === "INCONNUE" ? LIBELLES_TRANCHE[ligne.tranche] : `${ligne.joursRetard} j de retard`}
                    </Pastille>
                  </div>
                  <p className="mt-0.5 text-[12px] text-[#6B7280]">
                    {ligne.emiseLe ? `Émise le ${dateCourte(ligne.emiseLe)}` : "Date d'émission inconnue"}
                    {ligne.echeance && ligne.echeance !== ligne.emiseLe ? ` · échéance ${dateCourte(ligne.echeance)}` : ""}
                    {ligne.regle > 0 ? ` · déjà réglé ${formatMontant(ligne.regle)} sur ${formatMontant(ligne.montant)}` : ""}
                  </p>
                </div>
                <span className="shrink-0 text-[14px] font-medium text-[#F5B454] tabular-nums">{formatMontant(ligne.reste)}</span>
                <Bouton taille="icone" variante="fantome" aria-label={`Paiement reçu pour ${ligne.numero}`} onClick={() => setPaiement(ligne)}>
                  <Plus size={15} aria-hidden />
                </Bouton>
              </li>
            ))}
          </ul>
        )}
      </section>

      {cheques.length > 0 ? (
        <section className="mt-8">
          <TitreSection action={<span className="text-[13px] font-medium text-[#D1D5DB] tabular-nums">{formatMontant(totalCheques)}</span>}>Chèques à créditer</TitreSection>
          <ul className={cn(CARTE, "overflow-hidden")}>
            {cheques.map((cheque) => (
              <li key={cheque.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t-[0.5px] border-[#2A2D34] px-4 py-3 first:border-t-0">
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] text-[#F2F3F5]">
                    <span className="font-medium tabular-nums">{formatMontant(cheque.montant)}</span> · {cheque.payeur}
                    {cheque.reference ? <span className="text-[#9CA3AF]"> · n° {cheque.reference}</span> : null}
                  </p>
                  <p className={cn("mt-0.5 text-[12px]", cheque.joursDepuisReception > 15 ? "text-[#F5B454]" : "text-[#6B7280]")}>
                    Reçu le {dateCourte(cheque.recuLe)} · il y a {cheque.joursDepuisReception} j
                  </p>
                </div>
                <div className="flex gap-1.5">
                  <Bouton taille="sm" icone={<Landmark size={13} aria-hidden />} onClick={() => setAction({ type: "credit", cheque })}>
                    Crédité
                  </Bouton>
                  <Bouton taille="sm" variante="danger" icone={<Ban size={13} aria-hidden />} onClick={() => setAction({ type: "rejet", cheque })}>
                    Rejeté
                  </Bouton>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {qualite.length > 0 ? (
        <section className="mt-8">
          <TitreSection>À corriger pour des chiffres justes</TitreSection>
          <ul className="space-y-2">
            {qualite.map((point) => (
              <li key={point.code} className={cn(CARTE, "p-3.5")}>
                <details>
                  <summary className="flex cursor-pointer items-start gap-2 text-[13px] text-[#D1D5DB]">
                    <AlertTriangle size={14} aria-hidden className="mt-0.5 shrink-0 text-[#F5B454]" />
                    <span className="flex-1">
                      {point.libelle} <span className="text-[#F5B454] tabular-nums">({point.detail.length})</span>
                    </span>
                  </summary>
                  <ul className="mt-2 space-y-0.5 pl-6 text-[12px] text-[#9CA3AF]">
                    {point.detail.slice(0, 50).map((ligne, index) => (
                      <li key={`${point.code}:${index}`}>{ligne}</li>
                    ))}
                  </ul>
                  {point.lien ? (
                    <Link href={point.lien} className="mt-2 inline-block pl-6 text-[12px] text-[#5DCAA5] hover:underline">
                      Corriger
                    </Link>
                  ) : null}
                </details>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {recettes.etat === "OK" ? (
        <section className="mt-8">
          <TitreSection
            action={
              <a
                href={`/api/finances/livre?annee=${annee}`}
                className={cn("flex items-center gap-1.5 rounded-[8px] px-2.5 py-1.5 text-[12px] text-[#9CA3AF] hover:bg-[#22262D] hover:text-[#F2F3F5]", TRANS)}
              >
                <Download size={13} aria-hidden /> Exporter (CSV)
              </a>
            }
          >
            Livre des recettes {annee}
          </TitreSection>
          {recettes.donnees.lignes.length === 0 ? (
            <p className="text-[13px] text-[#6B7280]">Aucun encaissement en {annee}.</p>
          ) : (
            <div className={cn(CARTE, "overflow-hidden")}>
              {Array.from({ length: 12 }, (_, index) => index + 1)
                .filter((mois) => recettes.donnees.lignes.some((ligne) => Number(ligne.jour.slice(5, 7)) === mois))
                .map((mois) => (
                  <div key={mois}>
                    <div className="flex justify-between border-t-[0.5px] border-[#2A2D34] bg-[#191B20] px-4 py-2 text-[12px] first:border-t-0">
                      <span className="font-medium text-[#9CA3AF] first-letter:uppercase">{libelleMois(mois)}</span>
                      <span className="text-[#D1D5DB] tabular-nums">{formatMontant(recettes.donnees.parMois[mois - 1])}</span>
                    </div>
                    <ul>
                      {recettes.donnees.lignes
                        .filter((ligne) => Number(ligne.jour.slice(5, 7)) === mois)
                        .map((ligne, index) => (
                          <li key={`${ligne.encaissementId}:${ligne.mouvement}:${index}`} className="flex gap-3 border-t-[0.5px] border-[#2A2D34] px-4 py-2.5">
                            <span className="w-[74px] shrink-0 text-[12px] text-[#9CA3AF] tabular-nums">{dateCourte(ligne.jour)}</span>
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-[13px] text-[#F2F3F5]">
                                {ligne.client} <span className="text-[#9CA3AF]">· {ligne.nature}</span>
                              </p>
                              <p className="truncate text-[12px] text-[#6B7280]">
                                {[ligne.pieces, ligne.moyenRenseigne ? ligne.moyen : "mode de règlement non renseigné", ligne.reference ? `réf. ${ligne.reference}` : null]
                                  .filter(Boolean)
                                  .join(" · ")}
                              </p>
                              {ligne.mouvement !== "RECETTE" ? (
                                <p className="text-[12px] text-[#F87171]">
                                  {ligne.mouvement === "REJET" ? "Chèque rejeté" : "Annulation"}
                                  {ligne.motif ? ` : ${ligne.motif}` : ""}
                                </p>
                              ) : null}
                            </div>
                            <span className={cn("shrink-0 text-[13px] tabular-nums", ligne.montant < 0 ? "text-[#F87171]" : "text-[#F2F3F5]")}>
                              {formatMontant(ligne.montant)}
                            </span>
                          </li>
                        ))}
                    </ul>
                  </div>
                ))}
            </div>
          )}
        </section>
      ) : null}

      {paiement ? (
        <ModalePaiementFacture
          facture={{ registreId: paiement.registreId, numero: paiement.numero, client: paiement.client, reste: paiement.reste }}
          onFermer={() => setPaiement(null)}
          onFait={() => void recharger()}
        />
      ) : null}
      {action ? (
        <ModaleActionEncaissement<unknown>
          key={`${action.type}:${action.cheque.id}`}
          encaissement={{ id: action.cheque.id, montant: action.cheque.montant, moyen: "CHEQUE", reference: action.cheque.reference, recuLe: `${action.cheque.recuLe}T12:00:00Z` }}
          type={action.type}
          onFermer={() => setAction(null)}
          onFait={() => void recharger()}
        />
      ) : null}
      {modale}
    </div>
  );
}
