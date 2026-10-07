"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Download, Euro } from "lucide-react";
import { toast } from "sonner";
import ListeDepenses from "@/app/(pilotage)/finances/_components/ListeDepenses";
import { ModaleActionEncaissement, ModalePaiementFacture, type TypeActionEncaissement } from "@/components/pilotage/ActionsEncaissement";
import { appelApi, messageErreur } from "@/components/pilotage/client";
import { useParametresExiges } from "@/components/pilotage/SaisieParametres";
import { ouvrirEcranSms } from "@/components/pilotage/sms/EcranSms";
import type { ChantierPropose } from "@/lib/depenses/constantes";
import { SECTION_DEPENSES } from "@/lib/depenses/constantes";
import type { ListeDepenses as Depenses } from "@/lib/depenses/service";
import { formatMontant } from "@/lib/dossiers/montants";
import type { ChequeACrediter, LigneEncours, TableauFinances as Tableau } from "@/lib/finances/tableau";
import { DEFINITIONS_PARAMETRES } from "@/lib/parametres/definitions";
import { ENCOURS_VISIBLES, moisDuLivre, moyenDeRelance, phraseCheque, phraseFacture, phraseRetard, propositionRelanceFacture, troisNombres } from "@/lib/v2/argent";
import { decouperLignes } from "@/lib/v2/dossiers";
import { cn } from "@/lib/utils";
import { BOUTON_SECONDAIRE } from "../journal/GroupeParPersonne";
import { BoutonVoirAutres, LIGNE_V2, LISTE_V2, TITRE_BLOC_V2, TitreRepliable, Vide } from "../liste/Troncature";
import { TRANS_V2 } from "../transitions";

/**
 * Mission 22 (A4) — Argent, l'écran v2 de `/finances` (docs/CRM-V2.md § Argent) : trois nombres en phrases d'abord
 * (à encaisser, encaissé ce mois, dépensé ce mois ; rouge seulement si une facture est en retard), puis l'encours (une
 * ligne par facture, « Encaisser » en principal → `ModalePaiementFacture`, « Relancer » en contour → le SMS prêt à
 * copier, ou le mail), les chèques à créditer (`ModaleActionEncaissement`), les dépenses (`ListeDepenses` de la v1,
 * repliées sauf `?section=depenses`), le livre des recettes (les mois, l'export CSV, l'année), et « À corriger »
 * replié. Sept blocs au plus ; cinq lignes puis « Voir les N autres » partout ; chaque geste répond par une ligne.
 */
export type MoisArgent = { encaisse: number; depense: number; libelle: string };

const BOUTON_ENCAISSER = cn("inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-[8px] bg-action px-4 text-corps font-semibold text-action-texte hover:bg-action-clair focus-visible:ring-2 focus-visible:ring-action/50 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50", TRANS_V2);
/** Correctifs du 07/10 (É8) : le vert reste à la première ligne (la facture la plus en retard) ; les autres « Encaisser » sont en contour, comme Ensuite après Maintenant. */
const BOUTON_ENCAISSER_LIGNE = cn(BOUTON_SECONDAIRE, "gap-2");

export function ArgentV2({ initial, depenses, mois, section }: { initial: Tableau; depenses: { liste: Depenses; chantiers: ChantierPropose[] }; mois: MoisArgent; section: string | null }) {
  const routeur = useRouter();
  const [tableau, setTableau] = useState(initial);
  const [paiement, setPaiement] = useState<LigneEncours | null>(null);
  const [action, setAction] = useState<{ type: TypeActionEncaissement; cheque: ChequeACrediter } | null>(null);
  const [toutEncours, setToutEncours] = useState(false);
  const [toutCheques, setToutCheques] = useState(false);
  const [toutLivre, setToutLivre] = useState(false);
  const [depensesOuvertes, setDepensesOuvertes] = useState(section === SECTION_DEPENSES);
  const [qualiteOuverte, setQualiteOuverte] = useState(false);
  const [maintenant, setMaintenant] = useState(() => new Date(`${initial.aujourdhui}T12:00:00.000Z`));
  const { demander, modale } = useParametresExiges();
  const { annee, recettes, encours, cheques, qualite } = tableau;

  // L'heure de l'appareil prend le relais du jour du serveur (dates relatives), une fois par minute.
  useEffect(() => {
    const poser = window.setTimeout(() => setMaintenant(new Date()), 0);
    const minuterie = window.setInterval(() => setMaintenant(new Date()), 60_000);
    return () => {
      window.clearTimeout(poser);
      window.clearInterval(minuterie);
    };
  }, []);

  useEffect(() => {
    if (section) document.getElementById(section)?.scrollIntoView({ block: "start" });
  }, [section]);

  async function recharger() {
    try {
      setTableau(await appelApi<Tableau>(`/api/finances?annee=${annee}`));
    } catch (erreur) {
      toast.error("Actualisation impossible", { description: messageErreur(erreur) });
    }
  }

  /** « Relancer » une facture : le SMS prêt à copier (copier vaut relance, tracé sur le dossier), sinon le mail du dossier. */
  function relancer(ligne: LigneEncours) {
    const moyen = moyenDeRelance(ligne);
    if (moyen === "SMS") {
      return ouvrirEcranSms({
        proposition: propositionRelanceFacture(ligne),
        onFini: ({ copie }) => {
          if (!copie) return;
          toast.success(`Facture ${ligne.numero} relancée par SMS`, { description: "Le SMS copié est tracé dans le dossier." });
          void recharger();
        },
      });
    }
    if (moyen === "MAIL") return routeur.push(`/mail?dossier=${encodeURIComponent(ligne.dossierId ?? "")}`);
    toast.info("Facture émise hors CRM : pas de dossier à relancer d'ici.", { description: ligne.client });
  }

  const nombres = troisNombres({ encours, encaisseMois: mois.encaisse, depenseMois: mois.depense });
  const decoupeEncours = decouperLignes(encours.lignes, toutEncours, ENCOURS_VISIBLES);
  const decoupeCheques = decouperLignes(cheques, toutCheques, ENCOURS_VISIBLES);
  const totalCheques = cheques.reduce((somme, cheque) => somme + cheque.montant, 0);
  const livre = recettes.etat === "OK" ? moisDuLivre(recettes.donnees.parMois, annee, maintenant) : [];
  const decoupeLivre = decouperLignes(livre, toutLivre, ENCOURS_VISIBLES);
  const adresseAnnee = (valeur: number) => `/finances?annee=${valeur}${section ? `&section=${section}` : ""}`;

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-4 md:px-8 md:py-6">
      <h1 className="sr-only">Argent</h1>
      <div className="flex flex-col gap-6">
        {/* 1. Les trois nombres */}
        <section aria-label="Les trois nombres" className="grid gap-3 sm:grid-cols-3">
          {nombres.map((nombre) => (
            <p key={nombre.cle} className="flex flex-col gap-1 rounded-[11px] border border-trait bg-surface p-4">
              <span className="text-corps text-texte-2">{nombre.libelle}{nombre.cle !== "A_ENCAISSER" ? ` (${mois.libelle})` : ""}</span>
              <strong className={cn("text-grand leading-tight font-semibold tabular-nums", nombre.retard ? "text-retard-texte" : "text-texte")}>{formatMontant(nombre.montant)}</strong>
            </p>
          ))}
        </section>

        {recettes.etat === "PARAMETRES" ? (
          <section aria-label="À renseigner" className="flex flex-col gap-3 rounded-[11px] border border-attention/60 bg-surface p-4 sm:flex-row sm:items-center">
            <p className="flex-1 text-corps-tel text-texte md:text-corps">
              Pour dater les chèques dans le livre des recettes, une règle doit être choisie (à confirmer par le comptable). Il manque : {recettes.manquants.map((cle) => DEFINITIONS_PARAMETRES[cle].libelle.toLowerCase()).join(" ; ")}.
            </p>
            <button type="button" onClick={() => demander(recettes.manquants, recharger)} className={BOUTON_SECONDAIRE}>
              Renseigner
            </button>
          </section>
        ) : null}

        {/* 2. L'encours : une facture par ligne, Encaisser en principal, Relancer en contour */}
        <section aria-labelledby="encours-titre" className="flex flex-col gap-3">
          <h2 id="encours-titre" className={cn(TITRE_BLOC_V2, "px-1")}>
            Factures à encaisser
          </h2>
          {encours.lignes.length === 0 ? (
            <Vide>Aucune facture en attente de paiement.</Vide>
          ) : (
            <>
              <ul className={LISTE_V2}>
                {decoupeEncours.visibles.map((ligne, index) => {
                  const retard = phraseRetard(ligne);
                  return (
                    <li key={ligne.registreId} className={cn(LIGNE_V2, "flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center")}>
                      <div className="min-w-0 flex-1">
                        <p className="flex flex-wrap items-center gap-x-2 text-corps-tel text-texte md:text-corps">
                          {ligne.dossierId ? (
                            <Link href={`/dossiers?dossier=${ligne.dossierId}`} className="inline-flex min-h-11 items-center font-medium tabular-nums hover:underline">
                              {ligne.numero}
                            </Link>
                          ) : (
                            <span className="font-medium tabular-nums">{ligne.numero}</span>
                          )}
                          <span className="truncate text-texte-2">{ligne.client}</span>
                          <span className="font-medium tabular-nums">{formatMontant(ligne.reste)}</span>
                          {retard ? <span className={retard.retard ? "text-retard-texte" : "text-texte-3"}>{retard.texte}</span> : null}
                        </p>
                        <p className="text-petit text-texte-3">{phraseFacture(ligne, maintenant)}</p>
                      </div>
                      <div className="flex shrink-0 gap-2">
                        <button type="button" onClick={() => setPaiement(ligne)} className={index === 0 ? BOUTON_ENCAISSER : BOUTON_ENCAISSER_LIGNE}>
                          <Euro size={18} aria-hidden /> Encaisser
                        </button>
                        <button type="button" onClick={() => relancer(ligne)} className={BOUTON_SECONDAIRE}>
                          Relancer
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
              <BoutonVoirAutres reste={decoupeEncours.reste} onClick={() => setToutEncours(true)} />
            </>
          )}
        </section>

        {/* 3. Les chèques à créditer */}
        {cheques.length > 0 ? (
          <section aria-labelledby="cheques-titre" className="flex flex-col gap-3">
            <h2 id="cheques-titre" className={cn(TITRE_BLOC_V2, "px-1")}>
              Chèques à créditer
            </h2>
            <ul className={LISTE_V2}>
              {decoupeCheques.visibles.map((cheque) => {
                const phrase = phraseCheque(cheque, maintenant);
                return (
                  <li key={cheque.id} className={cn(LIGNE_V2, "flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center")}>
                    <p className={cn("min-w-0 flex-1 text-corps-tel md:text-corps", phrase.vieux ? "text-attention-texte" : "text-texte")}>{phrase.texte}</p>
                    <div className="flex shrink-0 gap-2">
                      <button type="button" onClick={() => setAction({ type: "credit", cheque })} className={BOUTON_SECONDAIRE}>
                        Crédité
                      </button>
                      <button type="button" onClick={() => setAction({ type: "rejet", cheque })} className={cn(BOUTON_SECONDAIRE, "text-texte-3")}>
                        Rejeté
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
            <BoutonVoirAutres reste={decoupeCheques.reste} onClick={() => setToutCheques(true)} />
            <p className="px-1 text-corps-tel text-texte-2 md:text-corps">En attente de crédit : {formatMontant(totalCheques)}.</p>
          </section>
        ) : null}

        {/* 4. Les dépenses (l'écran de la v1, replié) */}
        <section id={SECTION_DEPENSES} aria-labelledby="depenses-v2-titre" className="flex scroll-mt-20 flex-col gap-2">
          <TitreRepliable id="depenses-v2" titre={`Dépenses ${annee}`} ouvert={depensesOuvertes} onBasculer={() => setDepensesOuvertes((v) => !v)} />
          <Link href="/depenses/nouvelle" className={cn(BOUTON_SECONDAIRE, "self-start")}>
            Ajouter une dépense
          </Link>
          {depensesOuvertes ? (
            <div id="depenses-v2-contenu" className="-mt-6">
              <ListeDepenses initiale={depenses.liste} chantiers={depenses.chantiers} />
            </div>
          ) : null}
        </section>

        {/* 5. Le livre des recettes */}
        <section aria-labelledby="livre-titre" className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2 px-1">
            <h2 id="livre-titre" className={TITRE_BLOC_V2}>
              Livre des recettes {annee}
            </h2>
            <nav aria-label="Année" className="flex items-center gap-2">
              <Link href={adresseAnnee(annee - 1)} className={BOUTON_SECONDAIRE}>
                {annee - 1}
              </Link>
              <Link href={adresseAnnee(annee + 1)} className={BOUTON_SECONDAIRE}>
                {annee + 1}
              </Link>
            </nav>
          </div>
          {recettes.etat !== "OK" ? (
            <Vide>Le livre attend la règle de datation des chèques (ci-dessus).</Vide>
          ) : livre.length === 0 ? (
            <Vide>Aucun encaissement en {annee}.</Vide>
          ) : (
            <>
              <ul className={LISTE_V2}>
                {decoupeLivre.visibles.map((m) => (
                  <li key={m.mois} className={cn(LIGNE_V2, "flex min-h-11 items-center justify-between gap-3 px-4 py-2 text-corps-tel md:text-corps")}>
                    <span className="text-texte">{m.libelle}</span>
                    <span className="text-texte tabular-nums">{formatMontant(m.montant)}</span>
                  </li>
                ))}
              </ul>
              <BoutonVoirAutres reste={decoupeLivre.reste} onClick={() => setToutLivre(true)} />
              <p className="px-1 text-corps-tel text-texte-2 md:text-corps">Encaissé en {annee} : {formatMontant(recettes.donnees.total)}.</p>
            </>
          )}
          {recettes.etat === "OK" ? (
            <a href={`/api/finances/livre?annee=${annee}`} className={cn(BOUTON_SECONDAIRE, "gap-2 self-start")}>
              <Download size={18} aria-hidden /> Exporter le livre {annee} (CSV)
            </a>
          ) : null}
        </section>

        {/* 6. À corriger, replié */}
        {qualite.length > 0 ? (
          <section aria-labelledby="qualite-titre" className="flex flex-col gap-2">
            <TitreRepliable id="qualite" titre="À corriger pour des chiffres justes" ouvert={qualiteOuverte} onBasculer={() => setQualiteOuverte((v) => !v)} />
            {qualiteOuverte ? (
              <ul id="qualite-contenu" className={LISTE_V2}>
                {qualite.map((point) => (
                  <li key={point.code} className={cn(LIGNE_V2, "flex flex-col gap-1 px-4 py-3")}>
                    <p className="text-corps-tel text-texte md:text-corps">{point.libelle}</p>
                    <p className="text-petit text-texte-3">
                      {point.detail.slice(0, ENCOURS_VISIBLES).join(" ; ")}
                      {point.detail.length > ENCOURS_VISIBLES ? ` ; et ${point.detail.length - ENCOURS_VISIBLES} autres` : ""}
                    </p>
                    {point.lien ? (
                      <Link href={point.lien} className={cn(BOUTON_SECONDAIRE, "mt-1 self-start")}>
                        Corriger
                      </Link>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        ) : null}
      </div>

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
