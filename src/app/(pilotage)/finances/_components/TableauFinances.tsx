"use client";

import { useState } from "react";
import Link from "next/link";
import { AlertTriangle, Ban, ChevronLeft, ChevronRight, Download, Landmark, Plus, SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";
import { ModaleActionEncaissement, ModalePaiementFacture, type TypeActionEncaissement } from "@/components/pilotage/ActionsEncaissement";
import { appelApi, messageErreur } from "@/components/pilotage/client";
import { useParametresExiges } from "@/components/pilotage/SaisieParametres";
import { Bouton, EnTetePage, Pastille, TRANS, TitreSection } from "@/components/pilotage/ui";
import { formatDateCourte } from "@/lib/dossiers/dates";
import { formatMontant } from "@/lib/dossiers/montants";
import { LIBELLES_TRANCHE, type Urssaf } from "@/lib/finances/calculs";
import { libelleMois } from "@/lib/finances/periodes";
import type { ChequeACrediter, LigneEncours, TableauFinances as Tableau } from "@/lib/finances/tableau";
import { DEFINITIONS_PARAMETRES, type CleParametre } from "@/lib/parametres/definitions";
import { cn } from "@/lib/utils";

const CARTE = "rounded-[11px] border-[0.5px] border-[#2A2D34] bg-[#1C1F25]";
const jour = (valeur: string) => formatDateCourte(`${valeur}T12:00:00Z`);

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

function Chiffre({ libelle, valeur, detail, ton }: { libelle: string; valeur: string; detail?: string; ton?: "ambre" | "vert" }) {
  return (
    <div className={cn(CARTE, "p-3.5")}>
      <p className="text-[12px] text-[#9CA3AF]">{libelle}</p>
      <p className={cn("mt-1 text-[20px] font-semibold tabular-nums", ton === "ambre" ? "text-[#F5B454]" : ton === "vert" ? "text-[#5DCAA5]" : "text-[#F2F3F5]")}>
        {valeur}
      </p>
      {detail ? <p className="mt-0.5 text-[12px] text-[#6B7280]">{detail}</p> : null}
    </div>
  );
}

function BlocUrssaf({ titre, urssaf, aujourdhui }: { titre: string; urssaf: Urssaf; aujourdhui: string }) {
  const echeancePassee = urssaf.periode.echeanceDeclaration < aujourdhui;
  const close = urssaf.periode.fin < aujourdhui;
  const lignes: [string, number | null, number | null][] = [
    ["Cotisations sociales", urssaf.cotisations, urssaf.taux.cotisations],
    ["Formation professionnelle", urssaf.cfp, urssaf.taux.cfp],
    ["Versement libératoire", urssaf.versementLiberatoire, urssaf.taux.versementLiberatoire],
  ];
  return (
    <div className={cn(CARTE, "p-4")}>
      <p className="text-[12px] text-[#9CA3AF]">{titre}</p>
      <p className="mt-0.5 text-[14px] font-medium text-[#F2F3F5] first-letter:uppercase">{urssaf.periode.libelle}</p>
      <p className={cn("text-[12px]", close && !echeancePassee ? "text-[#F5B454]" : "text-[#6B7280]")}>
        {echeancePassee
          ? `Échéance de déclaration passée (${jour(urssaf.periode.echeanceDeclaration)})`
          : close
            ? `À déclarer au plus tard le ${jour(urssaf.periode.echeanceDeclaration)}`
            : `En cours · à déclarer entre le ${jour(urssaf.periode.fin)} et le ${jour(urssaf.periode.echeanceDeclaration)}`}
      </p>
      <dl className="mt-3 space-y-1.5 text-[13px]">
        <div className="flex justify-between gap-3">
          <dt className="text-[#9CA3AF]">Chiffre d&apos;affaires encaissé</dt>
          <dd className="font-medium text-[#F2F3F5] tabular-nums">{formatMontant(urssaf.chiffreAffaires)}</dd>
        </div>
        {lignes
          .filter(([, montant]) => montant !== null)
          .map(([libelle, montant, taux]) => (
            <div key={libelle} className="flex justify-between gap-3">
              <dt className="text-[#9CA3AF]">
                {libelle}
                {taux !== null ? <span className="text-[#6B7280]"> · {String(taux).replace(".", ",")} %</span> : null}
              </dt>
              <dd className="text-[#D1D5DB] tabular-nums">{formatMontant(montant ?? 0)}</dd>
            </div>
          ))}
        <div className="flex justify-between gap-3 border-t-[0.5px] border-[#2A2D34] pt-1.5">
          <dt className="text-[#D1D5DB]">Total estimé</dt>
          <dd className="font-semibold text-[#F2F3F5] tabular-nums">{formatMontant(urssaf.total)}</dd>
        </div>
      </dl>
    </div>
  );
}

function Barres({ parMois, annee, aujourdhui }: { parMois: number[]; annee: number; aujourdhui: string }) {
  const max = Math.max(...parMois, 1);
  const moisCourant = aujourdhui.startsWith(`${annee}-`) ? Number(aujourdhui.slice(5, 7)) : 13;
  return (
    <div className={cn(CARTE, "p-4")}>
      <div className="flex h-28 items-end gap-1.5" role="img" aria-label={`Encaissements par mois en ${annee}`}>
        {parMois.map((montant, index) => (
          <div key={index} className="flex flex-1 flex-col items-center gap-1" title={`${libelleMois(index + 1)} : ${formatMontant(montant)}`}>
            <div
              className={cn("w-full rounded-t-[3px]", index + 1 === moisCourant ? "bg-[#1D9E75]" : index + 1 > moisCourant ? "bg-[#2A2D34]" : "bg-[#1D9E75]/55")}
              style={{ height: `${Math.max(2, (Math.max(montant, 0) / max) * 96)}px` }}
            />
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex gap-1.5">
        {parMois.map((_, index) => (
          <span key={index} className="flex-1 text-center text-[10.5px] text-[#6B7280]">
            {libelleMois(index + 1).slice(0, 1).toUpperCase()}
          </span>
        ))}
      </div>
    </div>
  );
}

export default function TableauFinances({ initial }: { initial: Tableau }) {
  const [tableau, setTableau] = useState(initial);
  const [paiement, setPaiement] = useState<LigneEncours | null>(null);
  const [action, setAction] = useState<{ type: TypeActionEncaissement; cheque: ChequeACrediter } | null>(null);
  const { demander, modale } = useParametresExiges();
  const { annee, aujourdhui, recettes, urssaf, seuils, encours, cheques, qualite } = tableau;

  async function recharger() {
    try {
      setTableau(await appelApi<Tableau>(`/api/finances?annee=${annee}`));
    } catch (erreur) {
      toast.error("Actualisation impossible", { description: messageErreur(erreur) });
    }
  }

  const moisCourant = aujourdhui.startsWith(`${annee}-`) ? Number(aujourdhui.slice(5, 7)) : null;
  const totalCheques = cheques.reduce((somme, cheque) => somme + cheque.montant, 0);

  return (
    <div className="mx-auto w-full max-w-5xl px-5 py-6 md:px-8 md:py-8">
      <EnTetePage
        titre="Finances"
        sousTitre="Tenues sur les encaissements : ce qui est réellement reçu, à sa date."
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

      <div className="mt-6 grid grid-cols-2 gap-2.5 md:grid-cols-4">
        <Chiffre
          libelle={`Encaissé en ${annee}`}
          valeur={recettes.etat === "OK" ? formatMontant(recettes.donnees.total) : "—"}
          detail={recettes.etat === "OK" ? `${annee - 1} : ${formatMontant(recettes.donnees.anneePrecedente)}` : undefined}
        />
        <Chiffre
          libelle={moisCourant ? `En ${libelleMois(moisCourant)}` : "Mois en cours"}
          valeur={recettes.etat === "OK" && moisCourant ? formatMontant(recettes.donnees.parMois[moisCourant - 1]) : "—"}
        />
        <Chiffre
          libelle="Reste à encaisser"
          valeur={formatMontant(encours.total)}
          detail={`${encours.lignes.length} facture${encours.lignes.length > 1 ? "s" : ""}`}
          ton={encours.lignes.some((ligne) => (ligne.joursRetard ?? 0) > 30) ? "ambre" : undefined}
        />
        <Chiffre libelle="Chèques à créditer" valeur={formatMontant(totalCheques)} detail={`${cheques.length} chèque${cheques.length > 1 ? "s" : ""}`} />
      </div>

      <section className="mt-8">
        <TitreSection>URSSAF</TitreSection>
        {recettes.etat === "PARAMETRES" ? (
          <p className="text-[13px] text-[#6B7280]">Calculé une fois la règle de date des chèques renseignée (ci-dessus).</p>
        ) : urssaf.etat === "OK" ? (
          <>
            <div className="grid gap-2.5 md:grid-cols-2">
              <BlocUrssaf titre="Période précédente" urssaf={urssaf.donnees.aDeclarer} aujourdhui={aujourdhui} />
              <BlocUrssaf titre="Période en cours" urssaf={urssaf.donnees.enCours} aujourdhui={aujourdhui} />
            </div>
            <p className="mt-2 text-[12px] text-[#6B7280]">
              Estimation aux taux saisis dans les paramètres ; le montant exact est calculé par l&apos;URSSAF sur le chiffre d&apos;affaires déclaré.
            </p>
          </>
        ) : (
          <AParametrer manquants={urssaf.manquants} pourquoi="Pour estimer ce qui est dû à l'URSSAF." onRenseigner={() => demander(urssaf.manquants, recharger)} />
        )}
      </section>

      <section className="mt-8">
        <TitreSection>Seuils de l&apos;année</TitreSection>
        {recettes.etat === "PARAMETRES" ? (
          <p className="text-[13px] text-[#6B7280]">Calculé une fois la règle de date des chèques renseignée (ci-dessus).</p>
        ) : seuils.etat === "OK" ? (
          <div className={cn(CARTE, "space-y-4 p-4")}>
            {seuils.donnees.seuils.map((seuil) => {
              const ton = seuil.pourcentage >= 100 ? "#EF4444" : seuil.pourcentage >= 80 ? "#EF9F27" : "#1D9E75";
              return (
                <div key={seuil.cle}>
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-[13px]">
                    <span className="text-[#D1D5DB]">{seuil.libelle}</span>
                    <span className="text-[#9CA3AF] tabular-nums">
                      {formatMontant(seuil.chiffreAffaires)} / {formatMontant(seuil.seuil)} · {String(seuil.pourcentage).replace(".", ",")} %
                    </span>
                  </div>
                  <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-[#2A2D34]">
                    <div className="h-full rounded-full" style={{ width: `${Math.min(100, seuil.pourcentage)}%`, backgroundColor: ton }} />
                  </div>
                  {seuil.projection !== null ? (
                    <p className={cn("mt-1 text-[12px]", seuil.projection > seuil.seuil ? "text-[#F5B454]" : "text-[#6B7280]")}>
                      Au rythme actuel : {formatMontant(seuil.projection)} au 31 décembre
                      {seuil.projection > seuil.seuil ? " — seuil dépassé si le rythme continue" : ""}
                    </p>
                  ) : null}
                </div>
              );
            })}
            <p className="text-[12px] text-[#6B7280]">
              Chiffre d&apos;affaires encaissé du 1er janvier à aujourd&apos;hui ; en {annee - 1} : {formatMontant(seuils.donnees.anneePrecedente)}. Les règles de
              dépassement (année précédente, seuil majoré) sont à vérifier avec le comptable.
            </p>
          </div>
        ) : (
          <AParametrer manquants={seuils.manquants} pourquoi="Pour suivre la progression vers les seuils fiscaux." onRenseigner={() => demander(seuils.manquants, recharger)} />
        )}
      </section>

      {recettes.etat === "OK" ? (
        <section className="mt-8">
          <TitreSection>Encaissements par mois</TitreSection>
          <Barres parMois={recettes.donnees.parMois} annee={annee} aujourdhui={aujourdhui} />
        </section>
      ) : null}

      <section className="mt-8">
        <TitreSection>Reste à encaisser</TitreSection>
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
                    {ligne.emiseLe ? `Émise le ${jour(ligne.emiseLe)}` : "Date d'émission inconnue"}
                    {ligne.echeance && ligne.echeance !== ligne.emiseLe ? ` · échéance ${jour(ligne.echeance)}` : ""}
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
          <TitreSection>Chèques à créditer</TitreSection>
          <ul className={cn(CARTE, "overflow-hidden")}>
            {cheques.map((cheque) => (
              <li key={cheque.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t-[0.5px] border-[#2A2D34] px-4 py-3 first:border-t-0">
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] text-[#F2F3F5]">
                    <span className="font-medium tabular-nums">{formatMontant(cheque.montant)}</span> · {cheque.payeur}
                    {cheque.reference ? <span className="text-[#9CA3AF]"> · n° {cheque.reference}</span> : null}
                  </p>
                  <p className={cn("mt-0.5 text-[12px]", cheque.joursDepuisReception > 15 ? "text-[#F5B454]" : "text-[#6B7280]")}>
                    Reçu le {jour(cheque.recuLe)} · il y a {cheque.joursDepuisReception} j
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
                            <span className="w-[74px] shrink-0 text-[12px] text-[#9CA3AF] tabular-nums">{jour(ligne.jour)}</span>
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
