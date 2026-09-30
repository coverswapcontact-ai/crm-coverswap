"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Archive, ArchiveRestore, ExternalLink, FolderPlus, Link2, Mail, MessageSquare, NotebookPen, Pencil, Phone, UserRound, X } from "lucide-react";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { appelApi, envoyerJson, messageErreur } from "@/components/pilotage/client";
import { NotesAppelDuLead, noterDebutAppel } from "@/components/pilotage/NotesAppel";
import { noterUnAppel } from "@/components/pilotage/RetourAppel";
import { ouvrirEcranSms } from "@/components/pilotage/sms/EcranSms";
import { Bouton, Champ, Modale, Pastille, Puces, TitreSection, ZoneTexte } from "@/components/pilotage/ui";
import { LIBELLES_ETAPE, LIBELLES_MOTIF_PERTE, MOTIFS_PERTE, type EtapeDossier, type MotifPerte } from "@/lib/dossiers/constants";
import { formatDateCourte, formatHorodatage } from "@/lib/dossiers/dates";
import { formatMontant } from "@/lib/dossiers/montants";
import { jourHeure, jourSemaineHeure, pluriel } from "@/lib/commun/format";
import { LIBELLES_STATUT_LEAD, LIBELLES_TYPE_ECHANGE, LIBELLES_TYPE_PROJET, STATUTS_LEAD_MANUELS, TYPES_ECHANGE, libelleSourceLead, type StatutLead, type StatutLeadManuel, type TypeEchange } from "@/lib/prospects/constantes";
import type { EntrantDetail } from "@/lib/prospects/types";
import type { LigneLead } from "@/lib/prospects/leads";
import { SignalDoublon } from "./SignalDoublon";
import { PuceRappel } from "./DateRappel";
import { cn } from "@/lib/utils";
import { PastilleIntention, PastillePriorite } from "./pastilles";
import { LIBELLES_PRIORITE, PRIORITES, type Priorite } from "@/lib/prospects/priorite";
import { CARTE_REMPLIE, LIEN_ACTION } from "./styles-entrant";
import { BoutonOuvrirDossier } from "./BoutonOuvrirDossier";
import { EditionEntrant } from "./EditionEntrant";
import { ImagesDuLead } from "./ImagesDuLead";

/** Fiche d'un contact entrant, jusqu'à l'ouverture de son dossier. */
export function PanneauEntrant({ id, onFermer, onModifie, ligne = null, onRecharger }: { id: string | null; onFermer: () => void; onModifie: () => void; ligne?: LigneLead | null; onRecharger?: () => Promise<void> }) {
  const [detail, setDetail] = useState<EntrantDetail | null>(null);
  const [echec, setEchec] = useState<{ id: string; message: string } | null>(null);

  useEffect(() => {
    if (!id) return;
    let actif = true;
    appelApi<{ entrant: EntrantDetail }>(`/api/prospects/entrants/${id}`)
      .then(({ entrant }) => actif && setDetail(entrant))
      .catch((probleme) => actif && setEchec({ id, message: messageErreur(probleme) }));
    return () => {
      actif = false;
    };
  }, [id]);

  const appliquer = useCallback(
    (entrant: EntrantDetail) => {
      setDetail(entrant);
      onModifie();
    },
    [onModifie],
  );

  const affiche = detail && detail.id === id ? detail : null;
  const erreur = echec && echec.id === id ? echec.message : null;

  return (
    <Sheet open={id !== null} onOpenChange={(ouvert) => (ouvert ? undefined : onFermer())}>
      <SheetContent
        side="right"
        showCloseButton={false}
        className="gap-0 border-[#2A2D34] bg-[#16181D] p-0 text-[#F2F3F5] data-[side=right]:w-full data-[side=right]:sm:max-w-[620px]"
      >
        {affiche ? (
          <Contenu detail={affiche} ligne={ligne && ligne.id === affiche.id ? ligne : null} onRecharger={onRecharger} onFermer={onFermer} onMisAJour={appliquer} />
        ) : (
          <div className="flex h-full flex-col">
            <div className="flex items-center justify-between gap-3 border-b-[0.5px] border-[#2A2D34] px-5 py-4">
              <SheetTitle className="text-[15px] font-medium text-[#F2F3F5]">{erreur ? "Contact indisponible" : "Chargement du contact…"}</SheetTitle>
              <Bouton variante="fantome" taille="icone" onClick={onFermer} aria-label="Fermer">
                <X size={16} />
              </Bouton>
            </div>
            {erreur ? <p className="px-5 py-6 text-[13px] text-[#F87171]">{erreur}</p> : null}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Contenu({ detail, ligne, onRecharger, onFermer, onMisAJour }: { detail: EntrantDetail; ligne: LigneLead | null; onRecharger?: () => Promise<void>; onFermer: () => void; onMisAJour: (detail: EntrantDetail) => void }) {
  const [envoi, setEnvoi] = useState<string | null>(null);
  const [typeEchange, setTypeEchange] = useState<TypeEchange>("APPEL");
  const [echange, setEchange] = useState("");
  const [sansSuite, setSansSuite] = useState(false);
  const [motif, setMotif] = useState("");
  // Mission 12 : motif structuré obligatoire pour « sans suite ».
  const [motifPerte, setMotifPerte] = useState<MotifPerte | null>(null);
  const [notes, setNotes] = useState(detail.notes ?? "");
  const [edition, setEdition] = useState(false);
  const [archivage, setArchivage] = useState(false);
  const [motifArchivage, setMotifArchivage] = useState("");
  const telephone = detail.telephone?.replace(/[^\d+]/g, "") ?? "";

  async function appeler(nom: string, url: string, methode: "POST" | "PATCH", donnees: unknown, succes: string) {
    setEnvoi(nom);
    try {
      const reponse = await envoyerJson<{
        entrant: EntrantDetail;
        avertissements?: string[];
      }>(url, methode, donnees);
      onMisAJour(reponse.entrant);
      toast.success(succes, {
        description: reponse.avertissements?.length ? reponse.avertissements.join(" ") : undefined,
      });
      return true;
    } catch (probleme) {
      toast.error("Action impossible", {
        description: messageErreur(probleme),
      });
      return false;
    } finally {
      setEnvoi(null);
    }
  }

  const relire = () => appelApi<{ entrant: EntrantDetail }>(`/api/prospects/entrants/${detail.id}`).then((reponse) => onMisAJour(reponse.entrant)).catch(() => undefined);

  const statutManuel = (STATUTS_LEAD_MANUELS as readonly string[]).includes(detail.statut) ? (detail.statut as StatutLeadManuel) : null;
  /** Mission 14 (partie 3) : la date de rappel, changée d'un geste (effacée : « Sans date » dans « À rappeler » s'il a déjà été appelé, sinon retour dans « À appeler »). */
  const poserRappel = (rappelLe: string | null) => void appeler("rappel", `/api/prospects/entrants/${detail.id}`, "PATCH", { rappelLe }, rappelLe ? `Rappel déplacé au ${jourSemaineHeure(rappelLe)}` : "Rappel sans date");

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-start justify-between gap-3 border-b-[0.5px] border-[#2A2D34] px-5 py-4">
        <div className="min-w-0">
          <SheetTitle className="truncate text-[17px] font-medium text-[#F2F3F5]">{detail.nom}</SheetTitle>
          <SheetDescription className="mt-0.5 text-[12.5px] text-[#9CA3AF]">
            {[libelleSourceLead(detail.source), detail.ville, `reçu le ${formatDateCourte(detail.recuLe)}`].filter(Boolean).join(" · ")}
          </SheetDescription>
          <p className="mt-2 flex flex-wrap gap-1.5">
            {detail.dossier ? null : <PastillePriorite priorite={detail.priorite} motif={detail.prioriteMotif} />}
            <PastilleIntention intention={detail.intention} />
            <Pastille ton={detail.statut === "PERDU" ? "rouge" : detail.dossier ? "vert" : "neutre"}>
              {LIBELLES_STATUT_LEAD[detail.statut as StatutLead] ?? detail.statut}
            </Pastille>
            {detail.archiveLe ? <Pastille ton="ambre">Archivé{detail.archiveMotif ? ` : ${detail.archiveMotif}` : ""}</Pastille> : null}
          </p>
        </div>
        <Bouton variante="fantome" taille="icone" onClick={onFermer} aria-label="Fermer">
          <X size={16} />
        </Bouton>
      </div>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
        {ligne?.doublon && onRecharger && !detail.archiveLe ? <SignalDoublon lead={ligne} onRecharger={onRecharger} /> : null}
        <div className="flex flex-wrap gap-2">
          {detail.dossier ? (
            <Link href={`/dossiers?dossier=${detail.dossier.id}`} className={cn(LIEN_ACTION, "border-[#1D9E75]/50 text-[#5DCAA5]")}>
              <FolderPlus size={14} aria-hidden /> Dossier · {LIBELLES_ETAPE[detail.dossier.etape as EtapeDossier] ?? detail.dossier.etape}
            </Link>
          ) : detail.archiveLe ? null : (
            <BoutonOuvrirDossier leadId={detail.id} nom={detail.nom} />
          )}
          {telephone ? (
            <>
              <a href={`tel:${telephone}`} onClick={() => noterDebutAppel(detail.id, { nom: detail.nom, dossierId: detail.dossier?.id ?? null })} className={LIEN_ACTION}>
                <Phone size={14} aria-hidden /> {detail.telephone}
              </a>
            </>
          ) : null}
          {/* Mission 14 (partie 4) : la feuille de fin d'appel, sans être passé par « Appeler » ; la fiche se relit ensuite. */}
          {detail.archiveLe ? null : (
            <button type="button" className={LIEN_ACTION} onClick={() => noterUnAppel({ leadId: detail.id, nom: detail.nom, dossierId: detail.dossier?.id ?? null, onEnregistre: () => void relire() })}>
              <NotebookPen size={14} aria-hidden /> Noter l&apos;appel
            </button>
          )}

          {detail.archiveLe ? null : (
            <button
              type="button"
              disabled={envoi === "espace"}
              className={LIEN_ACTION}
              onClick={async () => {
                setEnvoi("espace");
                try {
                  const { lien } = await envoyerJson<{ lien: string }>(`/api/prospects/entrants/${detail.id}/espace`, "POST");
                  await navigator.clipboard.writeText(lien).catch(() => undefined);
                  toast.success("Lien de l'espace client copié", { description: lien });
                  onMisAJour(await appelApi<{ entrant: EntrantDetail }>(`/api/prospects/entrants/${detail.id}`).then((reponse) => reponse.entrant));
                } catch (probleme) {
                  toast.error("Espace client indisponible", { description: messageErreur(probleme) });
                } finally {
                  setEnvoi(null);
                }
              }}
            >
              <Link2 size={14} aria-hidden /> Lien espace client
            </button>
          )}
          {/* Mission 14 (partie 5) : le lien par SMS, prérempli (premier lien ou « à nouveau »), copié = envoyé. */}
          {detail.archiveLe ? null : (
            // L'espace (et le dossier) a pu s'ouvrir pour préparer le SMS : la fiche se relit, copié ou non.
            <button type="button" className={LIEN_ACTION} onClick={() => ouvrirEcranSms({ demande: { action: "ENVOYER_LIEN", leadId: detail.id, dossierId: detail.dossier?.id ?? null }, onFini: () => void relire() })}>
              <MessageSquare size={14} aria-hidden /> SMS avec le lien
            </button>
          )}
          {detail.email ? (
            <Link href={`/mail?lead=${detail.id}`} className={LIEN_ACTION}>
              <Mail size={14} aria-hidden /> Écrire un mail
            </Link>
          ) : null}
          {detail.client ? (
            <Link href={`/clients/${detail.client.id}`} className={LIEN_ACTION}>
              <UserRound size={14} aria-hidden /> Fiche client
            </Link>
          ) : null}
        </div>

        {/* Mission 14 (partie 3) : le rappel se règle ici ; avec un dossier, il vit sur le dossier. */}
        {detail.dossier || detail.archiveLe || detail.statut === "PERDU" ? null : (
          <section>
            <TitreSection>Rappel</TitreSection>
            <div className={cn(CARTE_REMPLIE, "space-y-1")}>
              <div className="flex flex-wrap items-center gap-x-3">
                <PuceRappel rappelLe={detail.rappelLe} enRetard={detail.rappelEnRetard} occupe={envoi === "rappel"} onChoisir={poserRappel} />
                {detail.rappelLe ? (
                  <button type="button" disabled={envoi === "rappel"} onClick={() => poserRappel(null)} className="h-11 text-[12.5px] text-[#9CA3AF] hover:text-[#F2F3F5] disabled:opacity-50 sm:h-8">
                    Retirer la date
                  </button>
                ) : null}
              </div>
              <p className="text-[12.5px] text-[#8B919C]">
                {detail.dernierAppelLe
                  ? `Dernier appel le ${jourHeure(detail.dernierAppelLe)}${detail.tentatives > 0 ? ` · ${pluriel(detail.tentatives, "tentative")} sans réponse` : ""}. Il est dans « À rappeler ».`
                  : detail.dernierContactLe
                    ? `Pas encore appelé, contacté par écrit le ${jourHeure(detail.dernierContactLe)} : il est dans « À rappeler ».`
                    : detail.rappelLe
                      ? "Pas encore appelé, rappel daté : il est dans « À rappeler »."
                      : "Jamais appelé : il est dans « À appeler ». Dater un rappel le passe dans « À rappeler »."}
              </p>
            </div>
          </section>
        )}

        {detail.archiveLe ? null : (
          <section>
            <TitreSection>Notes d&apos;appel</TitreSection>
            <NotesAppelDuLead leadId={detail.id} />
          </section>
        )}

        {detail.dossier || detail.archiveLe ? null : (
          <section>
            <TitreSection>Priorité de rappel</TitreSection>
            <div className={CARTE_REMPLIE}>
              <p className="text-[13px] text-[#D1D5DB]">
                {detail.prioriteMotif ?? "Pas encore classé."}
                {detail.tailleCuisine ? <span className="text-[#9CA3AF]">{` · taille : ${detail.tailleCuisine}`}</span> : null}
              </p>
              <div className="mt-3">
                <Puces
                  libelle={detail.prioriteManuelle ? "Classe posée à la main" : "Classe calculée — la changer si besoin"}
                  options={[...PRIORITES.map((valeur) => ({ valeur: valeur as Priorite | "AUTO", libelle: LIBELLES_PRIORITE[valeur] })), ...(detail.prioriteManuelle ? [{ valeur: "AUTO" as const, libelle: "Recalculer" }] : [])]}
                  valeur={(detail.priorite as Priorite | null) ?? null}
                  onChange={(valeur: Priorite | "AUTO") => void appeler("priorite", `/api/prospects/entrants/${detail.id}`, "PATCH", { priorite: valeur }, valeur === "AUTO" ? "Priorité recalculée" : "Priorité enregistrée")}
                />
              </div>
            </div>
          </section>
        )}

        <section>
          <TitreSection>Où en est-on</TitreSection>
          <div className={CARTE_REMPLIE}>
            {detail.dossier ? (
              <p className="text-[13px] text-[#9CA3AF]">
                {`Statut : ${(LIBELLES_STATUT_LEAD[detail.statut as StatutLead] ?? detail.statut).toLowerCase()}. Il suit maintenant le dossier : c'est le dossier qu'on fait avancer.`}
              </p>
            ) : (
              <Puces
                libelle="Statut"
                options={STATUTS_LEAD_MANUELS.map((valeur) => ({
                  valeur,
                  libelle: LIBELLES_STATUT_LEAD[valeur],
                }))}
                valeur={sansSuite ? "PERDU" : statutManuel}
                onChange={(valeur: StatutLeadManuel) => {
                  if (valeur === "PERDU") {
                    setSansSuite(true);
                    return;
                  }
                  setSansSuite(false);
                  void appeler("statut", `/api/prospects/entrants/${detail.id}`, "PATCH", { statut: valeur }, "Statut enregistré");
                }}
              />
            )}
            {sansSuite && detail.statut !== "PERDU" ? (
              <div className="mt-3 flex flex-wrap items-end gap-2">
                <div className="basis-full">
                  <Puces libelle="Pourquoi sans suite ?" obligatoire options={MOTIFS_PERTE.map((valeur) => ({ valeur, libelle: LIBELLES_MOTIF_PERTE[valeur] }))} valeur={motifPerte} onChange={setMotifPerte} />
                </div>
                <Champ
                  classeConteneur="min-w-[220px] flex-1"
                  libelle={motifPerte === "AUTRE" ? "Précision (obligatoire)" : "Précision (facultative)"}
                  placeholder="Un mot sur la raison…"
                  maxLength={300}
                  value={motif}
                  onChange={(evenement) => setMotif(evenement.target.value)}
                />
                <Bouton
                  variante="danger"
                  chargement={envoi === "perdu"}
                  disabled={!motifPerte || (motifPerte === "AUTRE" && motif.trim().length < 3)}
                  onClick={() =>
                    void appeler(
                      "perdu",
                      `/api/prospects/entrants/${detail.id}`,
                      "PATCH",
                      { statut: "PERDU", motifPerte, motif: motif.trim() || null },
                      "Contact classé sans suite",
                    ).then((ok) => ok && setSansSuite(false))
                  }
                >
                  Classer sans suite
                </Bouton>
              </div>
            ) : null}
          </div>
        </section>

        <section>
          <TitreSection>Noter un échange</TitreSection>
          {detail.dossier ? (
            <p className={cn(CARTE_REMPLIE, "text-[13px] text-[#9CA3AF]")}>
              {"Le suivi se note maintenant sur le dossier : "}
              <Link href={`/dossiers?dossier=${detail.dossier.id}`} className="text-[#5DCAA5] hover:underline">
                ouvrir le dossier
              </Link>
              .
            </p>
          ) : (
            <div className={cn(CARTE_REMPLIE, "space-y-3")}>
              <Puces
                libelle="Type"
                options={TYPES_ECHANGE.map((valeur) => ({
                  valeur,
                  libelle: LIBELLES_TYPE_ECHANGE[valeur],
                }))}
                valeur={typeEchange}
                onChange={setTypeEchange}
              />
              <ZoneTexte
                libelle="Ce qui s'est dit"
                rows={2}
                maxLength={5000}
                placeholder="Rappel jeudi, veut un devis pour sa salle de bain…"
                value={echange}
                onChange={(evenement) => setEchange(evenement.target.value)}
              />
              <div className="flex justify-end">
                <Bouton
                  variante="primaire"
                  disabled={echange.trim().length < 2}
                  chargement={envoi === "echange"}
                  onClick={() =>
                    void appeler(
                      "echange",
                      `/api/prospects/entrants/${detail.id}/echanges`,
                      "POST",
                      { type: typeEchange, contenu: echange },
                      "Échange noté",
                    ).then((ok) => ok && setEchange(""))
                  }
                >
                  Enregistrer
                </Bouton>
              </div>
            </div>
          )}
        </section>

        <section>
          <TitreSection>Échanges · {detail.echanges.length}</TitreSection>
          {detail.echanges.length === 0 ? (
            <p className="text-[13px] text-[#6B7280]">Aucun échange noté.</p>
          ) : (
            <ol className="space-y-2">
              {detail.echanges.map((un) => (
                <li key={un.id} className="rounded-[9px] border-[0.5px] border-[#2A2D34] bg-[#1C1F25] px-3 py-2">
                  <p className="text-[11.5px] text-[#6B7280]">
                    {LIBELLES_TYPE_ECHANGE[un.type] ?? un.type} · {formatHorodatage(un.le)}
                  </p>
                  <p className="mt-0.5 text-[13px] whitespace-pre-line text-[#D1D5DB]">{un.contenu}</p>
                </li>
              ))}
            </ol>
          )}
        </section>

        {detail.message || detail.styleSouhaite ? (
          <section>
            <TitreSection>Sa demande</TitreSection>
            <div className={CARTE_REMPLIE}>
              {detail.styleSouhaite ? (
                <p className="text-[12px] text-[#6B7280]">
                  Style souhaité : <span className="text-[#D1D5DB]">{detail.styleSouhaite}</span>
                </p>
              ) : null}
              {detail.message ? <p className="mt-1 text-[13.5px] whitespace-pre-line text-[#F2F3F5]">{detail.message}</p> : null}
            </div>
          </section>
        ) : null}

        <ImagesDuLead detail={detail} />

        <section>
          <TitreSection
            action={
              <Bouton taille="sm" variante="fantome" icone={<Pencil size={13} aria-hidden />} onClick={() => setEdition(true)}>
                Corriger
              </Bouton>
            }
          >
            Demande
          </TitreSection>
          <div className={cn(CARTE_REMPLIE, "space-y-1.5 text-[13px]")}>
            <p className="flex justify-between gap-3">
              <span className="text-[#9CA3AF]">Projet</span>
              <span>{LIBELLES_TYPE_PROJET[detail.typeProjet] ?? detail.typeProjet}</span>
            </p>
            {detail.prixSimule ? (
              <p className="flex justify-between gap-3">
                <span className="text-[#9CA3AF]">Prix simulé</span>
                <span className="tabular-nums">{formatMontant(detail.prixSimule)}</span>
              </p>
            ) : null}
            {[
              ["Formulaire", detail.formulaire],
              ["Campagne", detail.campagne],
              ["Publicité", detail.publicite],
              ["Code postal", detail.codePostal],
            ].map(([libelle, valeur]) =>
              valeur ? (
                <p key={libelle} className="flex justify-between gap-3">
                  <span className="text-[#9CA3AF]">{libelle}</span>
                  <span className="min-w-0 truncate text-right">{valeur}</span>
                </p>
              ) : null,
            )}
            <ZoneTexte
              classeConteneur="pt-2"
              libelle="Notes"
              rows={3}
              maxLength={5000}
              value={notes}
              onChange={(evenement) => setNotes(evenement.target.value)}
            />
            {notes !== (detail.notes ?? "") ? (
              <div className="flex justify-end">
                <Bouton
                  taille="sm"
                  variante="primaire"
                  chargement={envoi === "notes"}
                  onClick={() => void appeler("notes", `/api/prospects/entrants/${detail.id}`, "PATCH", { notes: notes.trim() || null }, "Notes enregistrées")}
                >
                  Enregistrer les notes
                </Bouton>
              </div>
            ) : null}
          </div>
        </section>

        {detail.dossiers.length > 0 ? (
          <section>
            <TitreSection>Dossiers</TitreSection>
            <ul className={cn(CARTE_REMPLIE, "space-y-1")}>
              {detail.dossiers.map((dossier) => (
                <li key={dossier.id}>
                  <Link
                    href={`/dossiers?dossier=${dossier.id}`}
                    className="flex items-center justify-between gap-3 text-[13px] text-[#F2F3F5] hover:text-[#5DCAA5]"
                  >
                    <span className="truncate">{dossier.objet || "Dossier"}</span>
                    <span className="shrink-0 text-[12px] text-[#9CA3AF]">
                      {LIBELLES_ETAPE[dossier.etape as EtapeDossier] ?? dossier.etape} · {formatDateCourte(dossier.ouvertLe)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {detail.anciensDevis.length > 0 || detail.ancienChantier ? (
          <section>
            <TitreSection>Ancien CRM</TitreSection>
            <div className={cn(CARTE_REMPLIE, "space-y-1.5 text-[13px]")}>
              {detail.anciensDevis.map((devis) => (
                <div key={devis.id} className="space-y-1">
                  <p className="flex items-center justify-between gap-3">
                    <span>
                      Devis {devis.numero}{" "}
                      <span className="text-[#6B7280]">
                        · {devis.statut.toLowerCase()} · {formatDateCourte(devis.le)}
                      </span>
                    </span>
                    <a
                      href={devis.pdf}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex shrink-0 items-center gap-1 text-[#5DCAA5] hover:underline"
                    >
                      {formatMontant(devis.montant)} <ExternalLink size={12} aria-hidden />
                    </a>
                  </p>
                  {devis.facture ? (
                    <p className="flex items-center justify-between gap-3 pl-3 text-[#9CA3AF]">
                      <span>Facture {devis.facture.numero}</span>
                      <a
                        href={devis.facture.pdf}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex shrink-0 items-center gap-1 text-[#5DCAA5] hover:underline"
                      >
                        Voir <ExternalLink size={12} aria-hidden />
                      </a>
                    </p>
                  ) : null}
                </div>
              ))}
              {detail.ancienChantier ? (
                <p className="text-[#9CA3AF]">
                  Chantier du {formatDateCourte(detail.ancienChantier.dateIntervention)} · {detail.ancienChantier.adresse} ·{" "}
                  {detail.ancienChantier.statut.toLowerCase().replace(/_/g, " ")}
                  {detail.ancienChantier.soldeRecu ? " · soldé" : detail.ancienChantier.acompteRecu ? " · acompte reçu" : ""}
                  {detail.ancienChantier.commandes.length > 0
                    ? ` · commandes : ${detail.ancienChantier.commandes.map((commande) => `${commande.reference} (${commande.statut.toLowerCase().replace(/_/g, " ")})`).join(", ")}`
                    : ""}
                </p>
              ) : null}
            </div>
          </section>
        ) : null}

        <div className="border-t-[0.5px] border-[#2A2D34] pt-4">
          {detail.archiveLe ? (
            <Bouton
              icone={<ArchiveRestore size={14} aria-hidden />}
              chargement={envoi === "restaurer"}
              onClick={() => void appeler("restaurer", `/api/prospects/entrants/${detail.id}/restaurer`, "POST", {}, "Contact restauré")}
            >
              Restaurer le contact
            </Bouton>
          ) : (
            <Bouton variante="fantome" icone={<Archive size={14} aria-hidden />} onClick={() => setArchivage(true)}>
              Archiver le contact
            </Bouton>
          )}
        </div>
      </div>

      {edition ? <EditionEntrant detail={detail} onFermer={() => setEdition(false)} onMisAJour={onMisAJour} /> : null}
      <Modale
        ouverte={archivage}
        onFermer={() => setArchivage(false)}
        titre="Archiver ce contact"
        description="Il quitte les listes mais reste consultable, avec ses échanges. Rien n'est supprimé."
        largeur="sm"
        pied={
          <div className="flex justify-end gap-2">
            <Bouton variante="fantome" onClick={() => setArchivage(false)}>
              Annuler
            </Bouton>
            <Bouton
              variante="danger"
              disabled={motifArchivage.trim().length < 3}
              chargement={envoi === "archiver"}
              onClick={() =>
                void appeler("archiver", `/api/prospects/entrants/${detail.id}/archiver`, "POST", { motif: motifArchivage }, "Contact archivé").then(
                  (ok) => ok && setArchivage(false),
                )
              }
            >
              Archiver
            </Bouton>
          </div>
        }
      >
        <Champ
          libelle="Motif"
          obligatoire
          placeholder="Doublon, faux contact, demande hors zone…"
          maxLength={500}
          value={motifArchivage}
          onChange={(evenement) => setMotifArchivage(evenement.target.value)}
        />
      </Modale>
    </div>
  );
}

