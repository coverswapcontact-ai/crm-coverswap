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
  Mail,
  Pencil,
  Phone,
  Plus,
  ShieldCheck,
  Star,
} from "lucide-react";
import { toast } from "sonner";
import { envoyerJson, messageErreur } from "@/components/pilotage/client";
import { rafraichirCompteurs } from "@/components/pilotage/Navigation";
import {
  Bouton,
  Champ,
  EtatVide,
  ListeDeroulante,
  Modale,
  Pastille,
  Puces,
  TRANS,
  TitreSection,
  ZoneTexte,
} from "@/components/pilotage/ui";
import {
  CATEGORIES_CLIENT,
  LIBELLES_CATEGORIE_CLIENT,
  LIBELLES_MOYEN_CONSENTEMENT,
  LIBELLES_SOURCE_CLIENT,
  LIBELLES_STATUT_CONSENTEMENT,
  MOYENS_CONSENTEMENT,
  SOURCES_CLIENT,
  STATUTS_CONSENTEMENT,
  type CategorieClient,
  type MoyenConsentement,
  type SourceClient,
  type StatutConsentement,
} from "@/lib/clients/constantes";
import { avertissementSiret, erreurSaisieSiret, formaterSiret, formaterTelephone, sourceDepuisLead } from "@/lib/clients/normalisation";
import type { ClientDetail, CoordonneeVue, EntrepriseAnnuaire } from "@/lib/clients/types";
import { LIBELLES_ETAPE, type EtapeDossier } from "@/lib/dossiers/constants";
import { formatDateCourte, formatHorodatage, jourParis } from "@/lib/dossiers/dates";
import { formatMontant } from "@/lib/dossiers/montants";
import { cn } from "@/lib/utils";
import { PastilleEtape } from "../../dossiers/_components/ui";
import { ChoixRecommandeur, type Recommandeur } from "./ChoixRecommandeur";
import { AnonymisationClient } from "./AnonymisationClient";
import { Chronologie } from "@/components/pilotage/Chronologie";
import { MessagesClient } from "./MessagesClient";
import { EspaceClientFiche } from "./EspaceClientFiche";
import { RechercheAnnuaire } from "./RechercheAnnuaire";

function Carte({ titre, action, children }: { titre: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-[11px] border-[0.5px] border-[#2A2D34] bg-[#1C1F25] p-4">
      <TitreSection action={action}>{titre}</TitreSection>
      {children}
    </section>
  );
}

function Ligne({ libelle, children }: { libelle: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap justify-between gap-x-4 gap-y-0.5 py-1.5 text-[13px]">
      <span className="text-[#9CA3AF]">{libelle}</span>
      <span className="min-w-0 text-right text-[#F2F3F5]">{children}</span>
    </div>
  );
}

function libelleActeur(acteur: string): string {
  const [type, ...reste] = acteur.split(":");
  const nom = reste.join(":");
  if (type === "HUMAIN") return nom === "poste-local" ? "moi (poste local)" : nom;
  if (type === "AGENT") return `agent ${nom}`;
  if (type === "MIGRATION") return "reprise des données";
  if (type === "EXTERNE") return "formulaire ou webhook";
  return type.toLowerCase();
}

/* ── Coordonnées ───────────────────────────────────────────────────── */

function Coordonnees({ client, onMiseAJour }: { client: ClientDetail; onMiseAJour: (client: ClientDetail) => void }) {
  const figee = Boolean(client.anonymiseLe || client.fusionneDans);
  const [ajout, setAjout] = useState<"email" | "telephone" | null>(null);
  const [edition, setEdition] = useState<{ nature: "email" | "telephone"; coordonnee: CoordonneeVue; valeur: string; libelle: string } | null>(null);
  const [valeur, setValeur] = useState("");
  const [libelle, setLibelle] = useState("");
  const [enArchivage, setEnArchivage] = useState<{ nature: "email" | "telephone"; coordonnee: CoordonneeVue } | null>(null);
  const [motif, setMotif] = useState("");
  const [envoi, setEnvoi] = useState(false);

  async function appeler(url: string, donnees: unknown, succes: string) {
    setEnvoi(true);
    try {
      const { client: misAJour } = await envoyerJson<{ client: ClientDetail }>(url, "POST", donnees);
      onMiseAJour(misAJour);
      toast.success(succes);
      return true;
    } catch (erreur) {
      toast.error("Modification impossible", { description: messageErreur(erreur) });
      return false;
    } finally {
      setEnvoi(false);
    }
  }

  const rendre = (nature: "email" | "telephone", liste: CoordonneeVue[]) => {
    const actives = liste.filter((coordonnee) => !coordonnee.archiveLe);
    const archivees = liste.filter((coordonnee) => coordonnee.archiveLe);
    return (
      <>
        {actives.map((coordonnee) => (
          <li key={coordonnee.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
            <a
              href={nature === "email" ? `mailto:${coordonnee.valeur}` : `tel:${coordonnee.valeur}`}
              className={cn("flex min-h-9 min-w-0 items-center gap-2 text-[13.5px] text-[#F2F3F5] hover:text-[#5DCAA5]", TRANS)}
            >
              {nature === "email" ? <Mail size={14} className="shrink-0 text-[#6B7280]" aria-hidden /> : <Phone size={14} className="shrink-0 text-[#6B7280]" aria-hidden />}
              <span className="truncate">{nature === "email" ? coordonnee.valeur : formaterTelephone(coordonnee.valeur)}</span>
              {coordonnee.libelle ? <span className="text-[12px] text-[#6B7280]">({coordonnee.libelle})</span> : null}
            </a>
            <span className="flex items-center gap-1">
              {coordonnee.principale ? (
                <Pastille ton="vert">
                  <Star size={10} aria-hidden className="fill-current" />
                  Principal
                </Pastille>
              ) : (
                <Bouton
                  taille="sm"
                  variante="fantome"
                  disabled={envoi || figee}
                  onClick={() =>
                    void appeler(`/api/clients/${client.id}/coordonnees/${coordonnee.id}`, { action: "principale", nature }, "Coordonnée principale changée")
                  }
                >
                  Rendre principal
                </Bouton>
              )}
              <Bouton
                taille="sm"
                variante="fantome"
                aria-label="Corriger"
                disabled={envoi || figee}
                onClick={() =>
                  setEdition({ nature, coordonnee, valeur: nature === "email" ? coordonnee.valeur : (coordonnee.saisi ?? formaterTelephone(coordonnee.valeur)), libelle: coordonnee.libelle ?? "" })
                }
              >
                <Pencil size={13} aria-hidden />
              </Bouton>
              <Bouton
                taille="sm"
                variante="fantome"
                aria-label="Archiver"
                disabled={envoi || figee}
                onClick={() => {
                  setMotif("");
                  setEnArchivage({ nature, coordonnee });
                }}
              >
                <Archive size={13} aria-hidden />
              </Bouton>
            </span>
          </li>
        ))}
        {archivees.map((coordonnee) => (
          <li key={coordonnee.id} className="py-1 text-[12px] text-[#6B7280] line-through decoration-[#6B7280]/50" title={coordonnee.archiveMotif ?? undefined}>
            {coordonnee.valeur.startsWith("anonymise-") ? "Effacé (RGPD)" : nature === "email" ? coordonnee.valeur : formaterTelephone(coordonnee.valeur)} — archivé
            {coordonnee.archiveMotif ? ` (${coordonnee.archiveMotif})` : ""}
          </li>
        ))}
      </>
    );
  };

  return (
    <Carte
      titre="Coordonnées"
      action={
        figee ? null : (
          <span className="flex gap-1">
            <Bouton taille="sm" variante="fantome" icone={<Plus size={13} aria-hidden />} onClick={() => setAjout("telephone")}>
              Numéro
            </Bouton>
            <Bouton taille="sm" variante="fantome" icone={<Plus size={13} aria-hidden />} onClick={() => setAjout("email")}>
              E-mail
            </Bouton>
          </span>
        )
      }
    >
      {client.telephones.length === 0 && client.emails.length === 0 ? (
        <p className="text-[13px] text-[#6B7280]">Aucune coordonnée.</p>
      ) : (
        <ul>
          {rendre("telephone", client.telephones)}
          {rendre("email", client.emails)}
        </ul>
      )}
      {client.adresse || client.ville ? (
        <p className="mt-2 border-t-[0.5px] border-[#2A2D34] pt-2 text-[13px] text-[#D1D5DB]">
          {[client.adresse, [client.codePostal, client.ville].filter(Boolean).join(" ")].filter(Boolean).join(", ")}
        </p>
      ) : null}

      <Modale
        ouverte={ajout !== null}
        onFermer={() => setAjout(null)}
        titre={ajout === "email" ? "Ajouter une adresse e-mail" : "Ajouter un numéro"}
        largeur="sm"
        pied={
          <div className="flex justify-end gap-2">
            <Bouton variante="fantome" onClick={() => setAjout(null)}>
              Annuler
            </Bouton>
            <Bouton
              variante="primaire"
              chargement={envoi}
              disabled={!valeur.trim()}
              onClick={() =>
                void appeler(`/api/clients/${client.id}/coordonnees`, { nature: ajout, valeur, libelle: libelle || null }, "Coordonnée ajoutée").then((ok) => {
                  if (ok) {
                    setAjout(null);
                    setValeur("");
                    setLibelle("");
                  }
                })
              }
            >
              Ajouter
            </Bouton>
          </div>
        }
      >
        <div className="flex flex-col gap-3">
          <Champ
            libelle={ajout === "email" ? "Adresse" : "Numéro"}
            type={ajout === "email" ? "email" : "tel"}
            inputMode={ajout === "email" ? "email" : "tel"}
            value={valeur}
            onChange={(evenement) => setValeur(evenement.target.value)}
          />
          <Champ libelle="Libellé (facultatif)" placeholder="pro, perso, comptabilité…" maxLength={40} value={libelle} onChange={(evenement) => setLibelle(evenement.target.value)} />
        </div>
      </Modale>

      <Modale
        ouverte={edition !== null}
        onFermer={() => setEdition(null)}
        titre={edition?.nature === "email" ? "Corriger l'adresse e-mail" : "Corriger le numéro"}
        description="Une faute de frappe se corrige sur place ; l'ancienne valeur reste au journal. Une coordonnée qui n'est plus utilisée s'archive plutôt."
        largeur="sm"
        pied={
          <div className="flex justify-end gap-2">
            <Bouton variante="fantome" onClick={() => setEdition(null)}>
              Annuler
            </Bouton>
            <Bouton
              variante="primaire"
              chargement={envoi}
              disabled={!edition?.valeur.trim()}
              onClick={() =>
                edition &&
                void appeler(
                  `/api/clients/${client.id}/coordonnees/${edition.coordonnee.id}`,
                  { action: "modifier", nature: edition.nature, valeur: edition.valeur, libelle: edition.libelle.trim() || null },
                  "Coordonnée corrigée"
                ).then((ok) => ok && setEdition(null))
              }
            >
              Enregistrer
            </Bouton>
          </div>
        }
      >
        {edition ? (
          <div className="flex flex-col gap-3">
            <Champ
              libelle={edition.nature === "email" ? "Adresse" : "Numéro"}
              type={edition.nature === "email" ? "email" : "tel"}
              inputMode={edition.nature === "email" ? "email" : "tel"}
              value={edition.valeur}
              onChange={(evenement) => setEdition({ ...edition, valeur: evenement.target.value })}
            />
            <Champ libelle="Libellé (facultatif)" placeholder="pro, perso, comptabilité…" maxLength={40} value={edition.libelle} onChange={(evenement) => setEdition({ ...edition, libelle: evenement.target.value })} />
          </div>
        ) : null}
      </Modale>

      <Modale
        ouverte={enArchivage !== null}
        onFermer={() => setEnArchivage(null)}
        titre="Archiver cette coordonnée"
        description="Elle reste visible, barrée, et dans l'historique."
        largeur="sm"
        pied={
          <div className="flex justify-end gap-2">
            <Bouton variante="fantome" onClick={() => setEnArchivage(null)}>
              Annuler
            </Bouton>
            <Bouton
              variante="danger"
              chargement={envoi}
              disabled={motif.trim().length < 3}
              onClick={() =>
                enArchivage &&
                void appeler(
                  `/api/clients/${client.id}/coordonnees/${enArchivage.coordonnee.id}`,
                  { action: "archiver", nature: enArchivage.nature, motif },
                  "Coordonnée archivée"
                ).then((ok) => ok && setEnArchivage(null))
              }
            >
              Archiver
            </Bouton>
          </div>
        }
      >
        <Puces
          libelle="Motif"
          obligatoire
          options={[
            { valeur: "Ne répond plus", libelle: "Ne répond plus" },
            { valeur: "Erreur de saisie", libelle: "Erreur de saisie" },
            { valeur: "Plus utilisée", libelle: "Plus utilisée" },
          ]}
          valeur={["Ne répond plus", "Erreur de saisie", "Plus utilisée"].includes(motif) ? motif : null}
          onChange={setMotif}
        />
        <Champ classeConteneur="mt-3" libelle="Ou préciser" value={motif} maxLength={300} onChange={(evenement) => setMotif(evenement.target.value)} />
      </Modale>
    </Carte>
  );
}

/* ── Consentement ──────────────────────────────────────────────────── */

function Consentement({ client, onMiseAJour }: { client: ClientDetail; onMiseAJour: (client: ClientDetail) => void }) {
  const [ouverte, setOuverte] = useState(false);
  const [statut, setStatut] = useState<StatutConsentement | null>(null);
  const [moyen, setMoyen] = useState<MoyenConsentement | null>(null);
  const [recueilliLe, setRecueilliLe] = useState(() => jourParis(new Date()));
  const [preuve, setPreuve] = useState("");
  const [envoi, setEnvoi] = useState(false);
  const courant = client.consentements[0];

  async function enregistrer() {
    if (!statut || !moyen) return;
    setEnvoi(true);
    try {
      const { client: misAJour } = await envoyerJson<{ client: ClientDetail }>(`/api/clients/${client.id}/consentements`, "POST", {
        statut,
        moyen,
        recueilliLe,
        preuve: preuve || null,
      });
      onMiseAJour(misAJour);
      setOuverte(false);
      toast.success("Réponse enregistrée", { description: "Les déclarations précédentes restent dans l'historique." });
    } catch (erreur) {
      toast.error("Enregistrement impossible", { description: messageErreur(erreur) });
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <Carte
      titre="Mails commerciaux"
      action={
        client.anonymiseLe || client.fusionneDans ? null : (
          <Bouton taille="sm" variante="fantome" icone={<ShieldCheck size={13} aria-hidden />} onClick={() => setOuverte(true)}>
            Enregistrer une réponse
          </Bouton>
        )
      }
    >
      {courant ? (
        <>
          <Pastille ton={courant.statut === "ACCORDE" ? "vert" : "rouge"}>{LIBELLES_STATUT_CONSENTEMENT[courant.statut]}</Pastille>
          <p className="mt-1.5 text-[12px] text-[#9CA3AF]">
            Le {formatDateCourte(courant.recueilliLe)} · {LIBELLES_MOYEN_CONSENTEMENT[courant.moyen as MoyenConsentement] ?? courant.moyen}
            {courant.preuve ? ` · ${courant.preuve}` : ""}
          </p>
          {client.consentements.length > 1 ? (
            <ul className="mt-2 border-t-[0.5px] border-[#2A2D34] pt-2">
              {client.consentements.slice(1).map((ancien) => (
                <li key={ancien.id} className="text-[12px] text-[#6B7280]">
                  {formatDateCourte(ancien.recueilliLe)} : {LIBELLES_STATUT_CONSENTEMENT[ancien.statut].toLowerCase()} ({LIBELLES_MOYEN_CONSENTEMENT[ancien.moyen as MoyenConsentement] ?? ancien.moyen})
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : (
        <p className="text-[13px] text-[#9CA3AF]">
          Aucune réponse enregistrée : <span className="text-[#F2F3F5]">pas de mail commercial</span>
          {" tant que le client n'a pas dit oui."}
        </p>
      )}

      <Modale
        ouverte={ouverte}
        onFermer={() => setOuverte(false)}
        titre="Réponse du client aux mails commerciaux"
        description="Une nouvelle déclaration s'ajoute ; les précédentes ne sont jamais modifiées."
        pied={
          <div className="flex justify-end gap-2">
            <Bouton variante="fantome" onClick={() => setOuverte(false)}>
              Annuler
            </Bouton>
            <Bouton variante="primaire" chargement={envoi} disabled={!statut || !moyen} onClick={() => void enregistrer()}>
              Enregistrer
            </Bouton>
          </div>
        }
      >
        <div className="flex flex-col gap-4">
          <Puces
            libelle="Réponse"
            obligatoire
            options={STATUTS_CONSENTEMENT.map((valeur) => ({ valeur, libelle: LIBELLES_STATUT_CONSENTEMENT[valeur] }))}
            valeur={statut}
            onChange={setStatut}
          />
          <Puces
            libelle="Comment"
            obligatoire
            options={MOYENS_CONSENTEMENT.map((valeur) => ({ valeur, libelle: LIBELLES_MOYEN_CONSENTEMENT[valeur] }))}
            valeur={moyen}
            onChange={setMoyen}
          />
          <Champ libelle="Date" type="date" obligatoire value={recueilliLe} onChange={(evenement) => setRecueilliLe(evenement.target.value)} />
          <ZoneTexte libelle="Preuve ou précision" rows={2} maxLength={1000} placeholder="Texte de la case, objet du mail…" value={preuve} onChange={(evenement) => setPreuve(evenement.target.value)} />
        </div>
      </Modale>
    </Carte>
  );
}

/* ── Modification de la fiche ──────────────────────────────────────── */

function ModaleModification({
  client,
  onFermer,
  onMiseAJour,
}: {
  client: ClientDetail;
  onFermer: () => void;
  onMiseAJour: (client: ClientDetail) => void;
}) {
  const [champs, setChamps] = useState({
    categorie: client.categorie,
    prenom: client.prenom ?? "",
    nomFamille: client.nomFamille ?? "",
    raisonSociale: client.raisonSociale ?? "",
    siret: client.siret ?? "",
    adresse: client.adresse ?? "",
    codePostal: client.codePostal ?? "",
    ville: client.ville ?? "",
    source: client.source,
    sourceDetail: client.sourceDetail ?? "",
    campagne: client.campagne ?? "",
    publicite: client.publicite ?? "",
    formulaire: client.formulaire ?? "",
    premierContactLe: jourParis(client.premierContactLe),
  });
  const [recommandeur, setRecommandeur] = useState<Recommandeur>({
    id: client.recommandePar?.id ?? null,
    nom: client.recommandePar?.nom ?? null,
    texte: client.recommandeParTexte,
  });
  const [envoi, setEnvoi] = useState(false);
  const [siretQuitte, setSiretQuitte] = useState(false);
  const changer = (cle: keyof typeof champs) => (evenement: { target: { value: string } }) =>
    setChamps((actuels) => ({ ...actuels, [cle]: evenement.target.value }));

  const estPro = champs.categorie !== "PARTICULIER";
  // Une fiche pro venue d'un formulaire ou d'un mail peut porter le nom de la personne qui a écrit :
  // il reste visible (et effaçable) tant qu'il existe ; une fiche pro créée ici n'en a pas.
  const contactEnregistre = Boolean(client.prenom || client.nomFamille);
  const siretModifie = champs.siret.replace(/\s/g, "") !== (client.siret ?? "");
  const siretEnErreur = estPro && siretModifie ? erreurSaisieSiret(champs.siret, true) : null;
  const raisonSocialeExigee = client.categorie === "PARTICULIER" || Boolean(client.raisonSociale);
  const raisonSocialeManquante = estPro && raisonSocialeExigee && !champs.raisonSociale.trim();
  const nomManquant = !estPro && client.categorie !== "PARTICULIER" && !champs.prenom.trim() && !champs.nomFamille.trim();
  const identiteRetiree = !estPro && (client.raisonSociale || client.siret);

  function remplirDepuisAnnuaire(entreprise: EntrepriseAnnuaire) {
    setSiretQuitte(false);
    setChamps((actuels) => ({
      ...actuels,
      raisonSociale: entreprise.raisonSociale ?? actuels.raisonSociale,
      siret: entreprise.siret ? formaterSiret(entreprise.siret) : "",
      ...(entreprise.adresse || entreprise.codePostal || entreprise.ville
        ? { adresse: entreprise.adresse ?? "", codePostal: entreprise.codePostal ?? "", ville: entreprise.ville ?? "" }
        : {}),
    }));
  }

  async function enregistrer() {
    setEnvoi(true);
    try {
      const { prenom, nomFamille, raisonSociale, siret, ...autres } = champs;
      // Un pro est une entité : le contact n'est renvoyé que s'il était affiché. Un particulier perd raison sociale et SIRET.
      const identite = estPro
        ? { raisonSociale, siret, ...(contactEnregistre ? { prenom, nomFamille } : {}) }
        : { prenom, nomFamille, raisonSociale: null, siret: null };
      const { client: misAJour, avertissements } = await envoyerJson<{ client: ClientDetail; avertissements: string[] }>(`/api/clients/${client.id}`, "PATCH", {
        ...autres,
        ...identite,
        recommandeParId: recommandeur.id,
        recommandeParTexte: recommandeur.texte,
      });
      onMiseAJour(misAJour);
      onFermer();
      toast.success("Fiche enregistrée", { description: avertissements.length ? avertissements.join(" ") : undefined });
    } catch (erreur) {
      toast.error("Enregistrement impossible", { description: messageErreur(erreur) });
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <Modale
      ouverte
      onFermer={onFermer}
      titre="Modifier la fiche"
      largeur="lg"
      pied={
        <div className="flex justify-end gap-2">
          <Bouton variante="fantome" onClick={onFermer}>
            Annuler
          </Bouton>
          <Bouton
            variante="primaire"
            chargement={envoi}
            disabled={Boolean(siretEnErreur) || raisonSocialeManquante || nomManquant}
            onClick={() => void enregistrer()}
          >
            Enregistrer
          </Bouton>
        </div>
      }
    >
      <div className="grid gap-4 md:grid-cols-2">
        <div className="flex flex-col gap-3">
          <Puces
            libelle="Catégorie"
            options={CATEGORIES_CLIENT.map((valeur) => ({ valeur, libelle: LIBELLES_CATEGORIE_CLIENT[valeur] }))}
            valeur={champs.categorie}
            onChange={(valeur: CategorieClient) => setChamps((actuels) => ({ ...actuels, categorie: valeur }))}
          />
          {estPro ? (
            <>
              <RechercheAnnuaire onChoisir={remplirDepuisAnnuaire} />
              <div className="grid gap-3 sm:grid-cols-[1fr_170px]">
                <Champ
                  libelle="Raison sociale"
                  obligatoire={raisonSocialeExigee}
                  erreur={raisonSocialeManquante ? "Pour un client pro, c'est l'entreprise qui est le client." : null}
                  value={champs.raisonSociale}
                  maxLength={160}
                  onChange={changer("raisonSociale")}
                />
                <Champ
                  libelle="SIRET"
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={17}
                  placeholder="14 chiffres"
                  value={champs.siret}
                  erreur={siretModifie ? erreurSaisieSiret(champs.siret, siretQuitte) : null}
                  aide={siretModifie ? (avertissementSiret(champs.siret) ?? undefined) : undefined}
                  onBlur={() => setSiretQuitte(true)}
                  onChange={(evenement) => {
                    changer("siret")(evenement);
                    setSiretQuitte(false);
                  }}
                />
              </div>
              {contactEnregistre ? (
                <div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Champ libelle="Contact : prénom" value={champs.prenom} maxLength={80} onChange={changer("prenom")} />
                    <Champ libelle="Contact : nom" value={champs.nomFamille} maxLength={120} onChange={changer("nomFamille")} />
                  </div>
                  <p className="mt-1 text-[12px] text-[#6B7280]">Personne qui a pris contact. Vide ces champs pour ne garder que l&apos;entreprise.</p>
                </div>
              ) : null}
            </>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <Champ libelle="Prénom" value={champs.prenom} maxLength={80} onChange={changer("prenom")} />
              <Champ libelle="Nom" value={champs.nomFamille} maxLength={120} onChange={changer("nomFamille")} />
            </div>
          )}
          {nomManquant ? <p className="text-[12px] text-[#F87171]">Indique un prénom ou un nom : un particulier est une personne.</p> : null}
          {identiteRetiree ? (
            <p className="text-[12px] text-[#F5B454]">La raison sociale et le SIRET seront retirés de la fiche ; l&apos;historique les garde.</p>
          ) : null}
          <Champ
            libelle={estPro ? "Adresse de facturation" : "Adresse"}
            aide={estPro ? "Siège ou établissement facturé. Le lieu du chantier se saisit dans le dossier." : undefined}
            value={champs.adresse}
            maxLength={200}
            onChange={changer("adresse")}
          />
          <div className="grid grid-cols-[110px_1fr] gap-3">
            <Champ libelle="Code postal" inputMode="numeric" maxLength={10} value={champs.codePostal} onChange={changer("codePostal")} />
            <Champ libelle="Ville" value={champs.ville} maxLength={80} onChange={changer("ville")} />
          </div>
        </div>
        <div className="flex flex-col gap-3">
          <ListeDeroulante
            libelle="Source"
            value={champs.source}
            onChange={(evenement) => setChamps((actuels) => ({ ...actuels, source: evenement.target.value as SourceClient }))}
            options={SOURCES_CLIENT.map((valeur) => ({ valeur, libelle: LIBELLES_SOURCE_CLIENT[valeur] }))}
          />
          <Champ libelle="Précision de la source" value={champs.sourceDetail} maxLength={160} onChange={changer("sourceDetail")} />
          <div className="grid gap-3 sm:grid-cols-2">
            <Champ libelle="Campagne" value={champs.campagne} maxLength={200} onChange={changer("campagne")} />
            <Champ libelle="Publicité" value={champs.publicite} maxLength={200} onChange={changer("publicite")} />
          </div>
          <Champ libelle="Formulaire" value={champs.formulaire} maxLength={200} onChange={changer("formulaire")} />
          <Champ libelle="Premier contact" type="date" value={champs.premierContactLe} onChange={changer("premierContactLe")} />
          <ChoixRecommandeur valeur={recommandeur} onChange={setRecommandeur} exclureId={client.id} />
        </div>
      </div>
    </Modale>
  );
}

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
      <Link href="/clients" className={cn("inline-flex min-h-8 items-center gap-1 text-[12px] text-[#6B7280] hover:text-[#F2F3F5]", TRANS)}>
        <ArrowLeft size={13} aria-hidden />
        Clients
      </Link>

      <header className="mt-2 flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <h1 className="text-[20px] font-medium tracking-tight text-[#F2F3F5]">{client.nom}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-1.5 text-[13px] text-[#9CA3AF]">
            <Pastille>{LIBELLES_CATEGORIE_CLIENT[client.categorie]}</Pastille>
            {lieu ? <span>{lieu}</span> : null}
            <span aria-hidden>·</span>
            <span>client depuis le {formatDateCourte(client.premierContactLe)}</span>
            {client.archiveLe ? <Pastille ton="ambre">Archivée{client.archiveMotif ? ` : ${client.archiveMotif}` : ""}</Pastille> : null}
          </p>
          {estPro && (client.siret || contact) ? (
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[12.5px] text-[#9CA3AF]">
              {client.siret ? (
                <a
                  href={`https://annuaire-entreprises.data.gouv.fr/etablissement/${client.siret}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Voir l'établissement dans l'annuaire des entreprises"
                  className={cn("inline-flex items-center gap-0.5 tabular-nums hover:text-[#F2F3F5]", TRANS)}
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
                  "inline-flex h-10 items-center gap-1.5 rounded-[8px] bg-[#1D9E75] px-3.5 text-[13px] font-medium text-[#0B1612] hover:bg-[#5DCAA5] sm:h-8",
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
        <p className="mt-4 rounded-[10px] border-[0.5px] border-[#2A2D34] bg-[#1C1F25] px-4 py-3 text-[13px] text-[#9CA3AF]">
          Fiche anonymisée le {formatDateCourte(client.anonymiseLe)} (RGPD) : identité, coordonnées, photos et mails effacés. Factures, avoirs et paiements sont conservés ; étapes et
          montants restent dans les statistiques, sans nom.
        </p>
      ) : null}

      {client.fusionneDans ? (
        <p className="mt-4 flex flex-wrap items-center gap-2 rounded-[10px] border-[0.5px] border-[#60A5FA]/40 bg-[#60A5FA]/10 px-4 py-3 text-[13px] text-[#93C5FD]">
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
          className={cn("mt-4 flex flex-wrap items-center gap-2 rounded-[10px] border-[0.5px] border-[#EF9F27]/40 bg-[#EF9F27]/10 px-4 py-3 text-[13px] text-[#F5B454] hover:bg-[#EF9F27]/15", TRANS)}
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
                <Link href={`/clients/${client.recommandePar.id}`} className="text-[#5DCAA5] hover:underline">
                  {client.recommandePar.nom}
                </Link>
              ) : (
                client.recommandeParTexte ?? <span className="text-[#6B7280]">—</span>
              )}
            </Ligne>
            {client.recommandations.length > 0 ? (
              <div className="mt-2 border-t-[0.5px] border-[#2A2D34] pt-2">
                <p className="text-[12px] text-[#9CA3AF]">
                  A recommandé {client.recommandations.length} client{client.recommandations.length > 1 ? "s" : ""}, pour{" "}
                  <span className="font-medium text-[#F2F3F5]">
                    {formatMontant(client.recommandations.reduce((somme, recommande) => somme + recommande.montantSigne, 0))}
                  </span>{" "}
                  signés
                </p>
                <ul className="mt-1">
                  {client.recommandations.map((recommande) => (
                    <li key={recommande.id} className="flex justify-between gap-3 py-0.5 text-[13px]">
                      <Link href={`/clients/${recommande.id}`} className="truncate text-[#F2F3F5] hover:text-[#5DCAA5]">
                        {recommande.nom}
                      </Link>
                      <span className="shrink-0 text-[#9CA3AF] tabular-nums">{recommande.montantSigne > 0 ? formatMontant(recommande.montantSigne) : "—"}</span>
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
              <p className="text-[13px] text-[#6B7280]">Aucun dossier pour l&apos;instant.</p>
            ) : (
              <ul>
                {client.dossiers.map((dossier) => (
                  <li key={dossier.id} className="border-t-[0.5px] border-[#2A2D34] first:border-t-0">
                    <Link href={`/dossiers?dossier=${dossier.id}`} className={cn("flex items-center justify-between gap-3 py-2 hover:bg-[#22262D]", TRANS)}>
                      <span className="min-w-0">
                        <span className="block truncate text-[13.5px] text-[#F2F3F5]">{dossier.objet}</span>
                        <span className="text-[12px] text-[#6B7280]">
                          {dossier.ville} · ouvert le {formatDateCourte(dossier.ouvertLe)}
                          {dossier.archiveLe ? " · archivé" : ""}
                        </span>
                      </span>
                      <span className="flex shrink-0 flex-col items-end gap-1">
                        <PastilleEtape etape={dossier.etape as EtapeDossier} libelle={LIBELLES_ETAPE[dossier.etape as EtapeDossier] ?? dossier.etape} />
                        {dossier.montant !== null ? <span className="text-[12px] text-[#9CA3AF] tabular-nums">{formatMontant(dossier.montant)}</span> : null}
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
                    <Link href={`/leads?lead=${lead.id}`} className="min-w-0 truncate text-[#D1D5DB] hover:text-[#F2F3F5]">
                      {lead.formulaire ?? LIBELLES_SOURCE_CLIENT[sourceDepuisLead(lead.source).source]}
                      {lead.campagne ? ` · ${lead.campagne}` : ""}
                    </Link>
                    <span className="shrink-0 text-[12px] text-[#6B7280]">{formatDateCourte(lead.createdAt)}</span>
                  </li>
                ))}
              </ul>
            </Carte>
          ) : null}

          <Chronologie cible={{ client: client.id }} titre="Chronologie" compact />

          <MessagesClient clientId={client.id} />

          <Carte
            titre="Historique de la fiche"
            action={
              <Link href={`/journal?clientId=${client.id}`} className={cn("text-[12px] text-[#9CA3AF] hover:text-[#F2F3F5]", TRANS)}>
                Journal complet
              </Link>
            }
          >
            {client.historique.length === 0 ? (
              <EtatVide titre="Aucune modification enregistrée" />
            ) : (
              <ol className="flex flex-col gap-1.5">
                {client.historique.map((ligne, index) => (
                  <li key={`${ligne.horodatage}-${index}`} className="text-[12.5px] text-[#D1D5DB]">
                    {ligne.resume}
                    <span className="block text-[11.5px] text-[#6B7280]">
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
          <p className="mt-3 rounded-[8px] bg-[#EF9F27]/10 px-3 py-2 text-[12.5px] text-[#F5B454]">
            {dossiersEnCours} dossier{dossiersEnCours > 1 ? "s" : ""} en cours : {dossiersEnCours > 1 ? "ils restent ouverts" : "il reste ouvert"} dans Dossiers, rattaché{dossiersEnCours > 1 ? "s" : ""} à cette fiche archivée.
          </p>
        ) : null}
      </Modale>
    </div>
  );
}
