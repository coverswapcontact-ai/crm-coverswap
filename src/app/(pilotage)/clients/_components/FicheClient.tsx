"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  ArrowUpRight,
  FolderPlus,
  GitMerge,
  Pencil,
} from "lucide-react";
import { toast } from "sonner";
import { envoyerJson, messageErreur } from "@/components/pilotage/client";
import { rafraichirCompteurs } from "@/components/pilotage/Navigation";
import { Bouton, Champ, EtatVide, Modale, Pastille, TRANS, ZoneTexte, PastilleEtape } from "@/components/pilotage/ui";
import { LIBELLES_CATEGORIE_CLIENT, LIBELLES_SOURCE_CLIENT } from "@/lib/clients/constantes";
import { formaterSiret, sourceDepuisLead } from "@/lib/clients/normalisation";
import type { ClientDetail } from "@/lib/clients/types";
import { LIBELLES_ETAPE, type EtapeDossier } from "@/lib/dossiers/constants";
import { formatDateCourte, formatHorodatage } from "@/lib/dossiers/dates";
import { formatMontant } from "@/lib/dossiers/montants";
import { cn } from "@/lib/utils";
import { AnonymisationClient } from "./AnonymisationClient";
import { Chronologie } from "@/components/pilotage/Chronologie";
import { MessagesClient } from "./MessagesClient";
import { EspaceClientFiche } from "./EspaceClientFiche";
import { Carte, Ligne, libelleActeur } from "./fiche-ui";
import { Coordonnees } from "./FicheCoordonnees";
import { Consentement } from "./FicheConsentement";
import { ModaleModification } from "./ModaleModificationClient";

/* ── Fiche ─────────────────────────────────────────────────────────── */

export default function FicheClient({ initial }: { initial: ClientDetail }) {
  const [client, setClient] = useState(initial);
  const [modification, setModification] = useState(false);
  const [archivage, setArchivage] = useState(false);
  const [motifArchivage, setMotifArchivage] = useState("");
  const [notes, setNotes] = useState(initial.notes ?? "");
  const [envoi, setEnvoi] = useState(false);

  async function appeler(url: string, methode: "POST" | "PATCH", donnees: unknown, succes: string) {
    setEnvoi(true);
    try {
      const { client: misAJour, avertissements } = await envoyerJson<{ client: ClientDetail; avertissements?: string[] }>(url, methode, donnees);
      setClient(misAJour);
      toast.success(succes, { description: avertissements?.length ? avertissements.join(" ") : undefined });
      rafraichirCompteurs();
      return true;
    } catch (erreur) {
      toast.error("Action impossible", { description: messageErreur(erreur) });
      return false;
    } finally {
      setEnvoi(false);
    }
  }

  const lieu = [client.codePostal, client.ville].filter(Boolean).join(" ");
  const dossiersEnCours = client.dossiers.filter((dossier) => !dossier.archiveLe && dossier.etape !== "PERDU" && dossier.etape !== "ENCAISSE").length;
  const estPro = client.categorie !== "PARTICULIER";
  // Sur une fiche pro, la personne qui a pris contact, quand la raison sociale donne déjà le nom de la fiche.
  const contact = estPro && client.raisonSociale ? [client.prenom, client.nomFamille].filter(Boolean).join(" ") : "";

  return (
    <div className="mx-auto w-full max-w-5xl px-5 py-6 md:px-8 md:py-8">
      <Link href="/clients" className={cn("inline-flex min-h-11 sm:min-h-8 items-center gap-1 text-[12px] text-texte-3 hover:text-texte", TRANS)}>
        <ArrowLeft size={13} aria-hidden />
        Clients
      </Link>

      <header className="mt-2 flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <h1 className="text-[20px] font-medium tracking-tight text-texte">{client.nom}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-1.5 text-[13px] text-texte-3">
            <Pastille>{LIBELLES_CATEGORIE_CLIENT[client.categorie]}</Pastille>
            {lieu ? <span>{lieu}</span> : null}
            <span aria-hidden>·</span>
            <span>client depuis le {formatDateCourte(client.premierContactLe)}</span>
            {client.archiveLe ? <Pastille ton="ambre">Archivée{client.archiveMotif ? ` : ${client.archiveMotif}` : ""}</Pastille> : null}
          </p>
          {estPro && (client.siret || contact) ? (
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[12.5px] text-texte-3">
              {client.siret ? (
                <a
                  href={`https://annuaire-entreprises.data.gouv.fr/etablissement/${client.siret}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Voir l'établissement dans l'annuaire des entreprises"
                  className={cn("inline-flex items-center gap-0.5 tabular-nums hover:text-texte", TRANS)}
                >
                  SIRET {formaterSiret(client.siret)}
                  <ArrowUpRight size={11} aria-hidden />
                </a>
              ) : null}
              {contact ? <span>Contact : {contact}</span> : null}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {client.anonymiseLe ? null : client.archiveLe ? (
            client.fusionneDans ? null : (
              <>
                <Bouton icone={<ArchiveRestore size={14} aria-hidden />} chargement={envoi} onClick={() => void appeler(`/api/clients/${client.id}/restaurer`, "POST", undefined, "Fiche restaurée")}>
                  Restaurer
                </Bouton>
                <Bouton variante="fantome" icone={<Pencil size={14} aria-hidden />} onClick={() => setModification(true)}>
                  Modifier
                </Bouton>
              </>
            )
          ) : (
            <>
              <Link
                href={`/dossiers?client=${client.id}`}
                className={cn(
                  "inline-flex h-11 items-center gap-1.5 rounded-[8px] bg-action px-3.5 text-[13px] font-medium text-action-texte hover:bg-action-clair sm:h-8",
                  TRANS
                )}
              >
                <FolderPlus size={15} aria-hidden />
                Ouvrir un dossier
              </Link>
              <Bouton icone={<Pencil size={14} aria-hidden />} onClick={() => setModification(true)}>
                Modifier
              </Bouton>
              <Bouton variante="fantome" icone={<Archive size={14} aria-hidden />} onClick={() => setArchivage(true)}>
                Archiver
              </Bouton>
            </>
          )}
          <AnonymisationClient client={client} onAnonymise={setClient} />
        </div>
      </header>

      {client.anonymiseLe ? (
        <p className="mt-4 rounded-[10px] border-[0.5px] border-trait bg-surface px-4 py-3 text-[13px] text-texte-3">
          Fiche anonymisée le {formatDateCourte(client.anonymiseLe)} (RGPD) : identité, coordonnées, photos et mails effacés. Factures, avoirs et paiements sont conservés ; étapes et
          montants restent dans les statistiques, sans nom.
        </p>
      ) : null}

      {client.fusionneDans ? (
        <p className="mt-4 flex flex-wrap items-center gap-2 rounded-[10px] border-[0.5px] border-info/40 bg-info/10 px-4 py-3 text-[13px] text-info-texte">
          <GitMerge size={15} aria-hidden />
          Fiche fusionnée dans{" "}
          <Link href={`/clients/${client.fusionneDans.id}`} className="font-medium underline underline-offset-2">
            {client.fusionneDans.nom}
          </Link>
          : tout ce qu&apos;elle portait y a été rattaché.
        </p>
      ) : null}
      {client.propositionsEnAttente.length > 0 ? (
        <Link
          href="/validation"
          className={cn("mt-4 flex flex-wrap items-center gap-2 rounded-[10px] border-[0.5px] border-attention/40 bg-attention/10 px-4 py-3 text-[13px] text-attention-texte hover:bg-attention/15", TRANS)}
        >
          <GitMerge size={15} aria-hidden />
          {client.propositionsEnAttente[0].titre}
          {client.propositionsEnAttente.length > 1 ? ` (+${client.propositionsEnAttente.length - 1})` : ""} — à examiner
        </Link>
      ) : null}

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <div className="flex flex-col gap-4">
          <Coordonnees client={client} onMiseAJour={setClient} />
          <Carte titre="Provenance">
            <Ligne libelle="Source">
              {LIBELLES_SOURCE_CLIENT[client.source]}
              {client.sourceDetail ? ` · ${client.sourceDetail}` : ""}
            </Ligne>
            {client.campagne ? <Ligne libelle="Campagne">{client.campagne}</Ligne> : null}
            {client.publicite ? <Ligne libelle="Publicité">{client.publicite}</Ligne> : null}
            {client.formulaire ? <Ligne libelle="Formulaire">{client.formulaire}</Ligne> : null}
            <Ligne libelle="Recommandé par">
              {client.recommandePar ? (
                <Link href={`/clients/${client.recommandePar.id}`} className="text-action-clair hover:underline">
                  {client.recommandePar.nom}
                </Link>
              ) : (
                client.recommandeParTexte ?? <span className="text-texte-3">—</span>
              )}
            </Ligne>
            {client.recommandations.length > 0 ? (
              <div className="mt-2 border-t-[0.5px] border-trait pt-2">
                <p className="text-[12px] text-texte-3">
                  A recommandé {client.recommandations.length} client{client.recommandations.length > 1 ? "s" : ""}, pour{" "}
                  <span className="font-medium text-texte">
                    {formatMontant(client.recommandations.reduce((somme, recommande) => somme + recommande.montantSigne, 0))}
                  </span>{" "}
                  signés
                </p>
                <ul className="mt-1">
                  {client.recommandations.map((recommande) => (
                    <li key={recommande.id} className="flex justify-between gap-3 py-0.5 text-[13px]">
                      <Link href={`/clients/${recommande.id}`} className="truncate text-texte hover:text-action-clair">
                        {recommande.nom}
                      </Link>
                      <span className="shrink-0 text-texte-3 tabular-nums">{recommande.montantSigne > 0 ? formatMontant(recommande.montantSigne) : "—"}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </Carte>
          <Consentement client={client} onMiseAJour={setClient} />
        </div>

        <div className="flex flex-col gap-4">
          <Carte titre={`Dossiers · ${client.dossiers.length}`}>
            {client.dossiers.length === 0 ? (
              <p className="text-[13px] text-texte-3">Aucun dossier pour l&apos;instant.</p>
            ) : (
              <ul>
                {client.dossiers.map((dossier) => (
                  <li key={dossier.id} className="border-t-[0.5px] border-trait first:border-t-0">
                    <Link href={`/dossiers?dossier=${dossier.id}`} className={cn("flex items-center justify-between gap-3 py-2 hover:bg-surface-2", TRANS)}>
                      <span className="min-w-0">
                        <span className="block truncate text-[13.5px] text-texte">{dossier.objet}</span>
                        <span className="text-[12px] text-texte-3">
                          {dossier.ville} · ouvert le {formatDateCourte(dossier.ouvertLe)}
                          {dossier.archiveLe ? " · archivé" : ""}
                        </span>
                      </span>
                      <span className="flex shrink-0 flex-col items-end gap-1">
                        <PastilleEtape etape={dossier.etape as EtapeDossier} libelle={LIBELLES_ETAPE[dossier.etape as EtapeDossier] ?? dossier.etape} />
                        {dossier.montant !== null ? <span className="text-[12px] text-texte-3 tabular-nums">{formatMontant(dossier.montant)}</span> : null}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Carte>

          <EspaceClientFiche clientId={client.id} />

          <Carte
            titre="Passif"
            action={
              notes !== (client.notes ?? "") && !client.anonymiseLe && !client.fusionneDans ? (
                <Bouton taille="sm" variante="primaire" chargement={envoi} onClick={() => void appeler(`/api/clients/${client.id}`, "PATCH", { notes }, "Passif enregistré")}>
                  Enregistrer
                </Bouton>
              ) : null
            }
          >
            <ZoneTexte
              libelle="Ce qu'il faut savoir sur ce client"
              classeConteneur="[&>label]:sr-only"
              rows={4}
              maxLength={10000}
              disabled={Boolean(client.anonymiseLe || client.fusionneDans)}
              placeholder="Habitudes, exigences, incidents, contexte familial ou d'entreprise…"
              value={notes}
              onChange={(evenement) => setNotes(evenement.target.value)}
            />
          </Carte>

          {client.leads.length > 0 ? (
            <Carte titre="Contacts entrants">
              <ul>
                {client.leads.map((lead) => (
                  <li key={lead.id} className="flex justify-between gap-3 py-1 text-[13px]">
                    <Link href={`/leads?lead=${lead.id}`} className="min-w-0 truncate text-texte-2 hover:text-texte">
                      {lead.formulaire ?? LIBELLES_SOURCE_CLIENT[sourceDepuisLead(lead.source).source]}
                      {lead.campagne ? ` · ${lead.campagne}` : ""}
                    </Link>
                    <span className="shrink-0 text-[12px] text-texte-3">{formatDateCourte(lead.createdAt)}</span>
                  </li>
                ))}
              </ul>
            </Carte>
          ) : null}

          <Chronologie cible={{ client: client.id }} titre="Chronologie" compact />

          <MessagesClient clientId={client.id} />

          <Carte titre="Historique de la fiche">
            {client.historique.length === 0 ? (
              <EtatVide titre="Aucune modification enregistrée" />
            ) : (
              <ol className="flex flex-col gap-1.5">
                {client.historique.map((ligne, index) => (
                  <li key={`${ligne.horodatage}-${index}`} className="text-[12.5px] text-texte-2">
                    {ligne.resume}
                    <span className="block text-[11.5px] text-texte-3">
                      {formatHorodatage(ligne.horodatage)} · {libelleActeur(ligne.acteur)}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </Carte>
        </div>
      </div>

      {modification ? <ModaleModification client={client} onFermer={() => setModification(false)} onMiseAJour={setClient} /> : null}
      <Modale
        ouverte={archivage}
        onFermer={() => setArchivage(false)}
        titre="Archiver la fiche"
        description="Elle disparaît des listes mais reste consultable, avec son historique."
        largeur="sm"
        pied={
          <div className="flex justify-end gap-2">
            <Bouton variante="fantome" onClick={() => setArchivage(false)}>
              Annuler
            </Bouton>
            <Bouton
              variante="danger"
              chargement={envoi}
              disabled={motifArchivage.trim().length < 3}
              onClick={() =>
                void appeler(`/api/clients/${client.id}/archiver`, "POST", { motif: motifArchivage }, "Fiche archivée").then((ok) => ok && setArchivage(false))
              }
            >
              Archiver
            </Bouton>
          </div>
        }
      >
        <Champ libelle="Motif" obligatoire value={motifArchivage} maxLength={500} onChange={(evenement) => setMotifArchivage(evenement.target.value)} />
        {dossiersEnCours > 0 ? (
          <p className="mt-3 rounded-[8px] bg-attention/10 px-3 py-2 text-[12.5px] text-attention-texte">
            {dossiersEnCours} dossier{dossiersEnCours > 1 ? "s" : ""} en cours : {dossiersEnCours > 1 ? "ils restent ouverts" : "il reste ouvert"} dans Dossiers, rattaché{dossiersEnCours > 1 ? "s" : ""} à cette fiche archivée.
          </p>
        ) : null}
      </Modale>
    </div>
  );
}
