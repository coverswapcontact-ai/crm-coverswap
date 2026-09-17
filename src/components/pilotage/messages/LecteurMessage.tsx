"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Archive,
  ArchiveRestore,
  ArrowDownLeft,
  ArrowUpRight,
  Bot,
  ChevronDown,
  CircleAlert,
  ExternalLink,
  FileText,
  FolderInput,
  FolderOpen,
  Paperclip,
  RefreshCw,
  Reply,
  Search,
  Send,
  Tags,
  UserPlus,
} from "lucide-react";
import { toast } from "sonner";
import { appelApi, envoyerJson, messageErreur } from "@/components/pilotage/client";
import { rafraichirCompteurs } from "@/components/pilotage/Navigation";
import { CarteProposition, ModaleCorrection, ModaleRejet } from "@/components/pilotage/Propositions";
import { Bouton, Champ, ListeDeroulante, Modale, Pastille, Puces, TRANS, ZoneTexte } from "@/components/pilotage/ui";
import { CATEGORIES_CLIENT, LIBELLES_CATEGORIE_CLIENT, LIBELLES_SOURCE_CLIENT, SOURCES_CLIENT, type CategorieClient, type SourceClient } from "@/lib/clients/constantes";
import type { ClientDetail, ClientResume } from "@/lib/clients/types";
import { LIBELLES_ETAPE, type EtapeDossier } from "@/lib/dossiers/constants";
import { formatHorodatage } from "@/lib/dossiers/dates";
import {
  CATEGORIES_HORS_CLIENTS,
  LIBELLES_CATEGORIE_MESSAGE,
  LIBELLES_STATUT_MESSAGE,
  formatTaille,
  type AnalyseVue,
  type CategorieHorsClients,
  type MessageDetail,
  type StatutMessage,
} from "@/lib/messages/constantes";
import { cn } from "@/lib/utils";
import type { PropositionVue } from "@/lib/validation/types";

export const TON_STATUT_MESSAGE: Record<StatutMessage, "neutre" | "vert" | "ambre" | "rouge" | "bleu"> = {
  A_ANALYSER: "bleu",
  A_TRIER: "ambre",
  RATTACHE: "vert",
  BRUIT: "neutre",
  IGNORE: "neutre",
};

export function expediteur(message: { sens: string; de: string; deNom: string | null; a: string[] }): string {
  if (message.sens === "SORTANT") return `À ${message.a.join(", ") || "?"}`;
  return message.deNom ? `${message.deNom} <${message.de}>` : message.de;
}

const libelleEtape = (etape: string) => LIBELLES_ETAPE[etape as EtapeDossier] ?? etape;
const euros = (montant: number) => `${montant.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 3 })} €`;

/* ── Ce que l'agent en a compris ──────────────────────────────────── */

function Analyses({ analyses }: { analyses: AnalyseVue[] }) {
  const [tout, setTout] = useState(false);
  if (analyses.length === 0) return null;
  const visibles = tout ? analyses : analyses.slice(0, 2);
  return (
    <section className="mt-4">
      <p className="mb-2 flex items-center gap-1.5 text-[12px] font-medium tracking-wide text-[#9CA3AF] uppercase">
        <Bot size={13} aria-hidden /> {"Ce que l'agent en a compris"}
      </p>
      <ul className="flex flex-col gap-2">
        {visibles.map((analyse) => (
          <li key={analyse.id} className="rounded-[8px] bg-[#16181D] px-3 py-2 text-[12.5px] leading-relaxed">
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-[#6B7280]">
              <span>{analyse.methode === "MODELE" ? "Lecture par l'IA" : "Règles sûres"}</span>
              <span aria-hidden>·</span>
              <span>{formatHorodatage(analyse.createdAt)}</span>
              {analyse.libelleCategorie ? (
                <>
                  <span aria-hidden>·</span>
                  <span className="text-[#D1D5DB]">{analyse.libelleCategorie}</span>
                </>
              ) : null}
              {analyse.confiance !== null ? (
                <>
                  <span aria-hidden>·</span>
                  <span title="Confiance calculée par le système">confiance {Math.round(analyse.confiance * 100)} %</span>
                </>
              ) : null}
              {analyse.coutEuros ? (
                <>
                  <span aria-hidden>·</span>
                  <span>{euros(analyse.coutEuros)}</span>
                </>
              ) : null}
            </p>
            {analyse.erreur ? (
              <p className="mt-1 flex items-start gap-1.5 text-[#F5B454]">
                <CircleAlert size={13} aria-hidden className="mt-0.5 shrink-0" />
                {analyse.erreur}
              </p>
            ) : null}
            {analyse.raisonnement ? <p className="mt-1 whitespace-pre-wrap text-[#D1D5DB]">{analyse.raisonnement}</p> : null}
          </li>
        ))}
      </ul>
      {analyses.length > 2 && !tout ? (
        <Bouton variante="fantome" taille="sm" className="mt-1" onClick={() => setTout(true)}>
          Voir les {analyses.length - 2} analyses précédentes
        </Bouton>
      ) : null}
    </section>
  );
}

/* ── Ranger chez un client ─────────────────────────────────────────── */

type DossierDuClient = ClientDetail["dossiers"][number];

function ModaleRattacher({ detail, onFermer, onFait }: { detail: MessageDetail; onFermer: () => void; onFait: () => void }) {
  const [client, setClient] = useState<{ id: string; nom: string } | null>(detail.client);
  const [recherche, setRecherche] = useState(detail.client ? "" : (detail.deNom ?? ""));
  const [resultats, setResultats] = useState<ClientResume[]>([]);
  const [dossiers, setDossiers] = useState<DossierDuClient[] | null>(null);
  const [dossierId, setDossierId] = useState<string | null>(detail.dossier?.id ?? null);
  const [envoi, setEnvoi] = useState(false);

  useEffect(() => {
    if (client || recherche.trim().length < 2) return;
    let actif = true;
    const minuterie = window.setTimeout(() => {
      appelApi<{ clients: ClientResume[] }>(`/api/clients?recherche=${encodeURIComponent(recherche.trim())}&limite=8`)
        .then(({ clients }) => actif && setResultats(clients))
        .catch(() => actif && setResultats([]));
    }, 250);
    return () => {
      actif = false;
      window.clearTimeout(minuterie);
    };
  }, [recherche, client]);

  useEffect(() => {
    if (!client) return;
    let actif = true;
    appelApi<{ client: ClientDetail }>(`/api/clients/${client.id}`)
      .then(({ client: fiche }) => {
        if (!actif) return;
        const vivants = fiche.dossiers.filter((dossier) => !dossier.archiveLe);
        const enCours = vivants.filter((dossier) => dossier.etape !== "ENCAISSE" && dossier.etape !== "PERDU");
        setDossiers([...enCours, ...vivants.filter((dossier) => !enCours.includes(dossier))]);
        setDossierId((actuel) => actuel ?? (enCours.length === 1 ? enCours[0].id : null));
      })
      .catch((erreur) => toast.error("Dossiers du client illisibles", { description: messageErreur(erreur) }));
    return () => {
      actif = false;
    };
  }, [client]);

  async function ranger() {
    if (!client) return;
    setEnvoi(true);
    try {
      await envoyerJson(`/api/messages/${detail.id}/rattacher`, "POST", { clientId: client.id, dossierId });
      toast.success("Mail rangé", { description: dossierId ? "Il figure dans l'historique du dossier." : `Sur la fiche de ${client.nom}.` });
      onFait();
    } catch (erreur) {
      toast.error("Rangement impossible", { description: messageErreur(erreur) });
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <Modale
      ouverte
      onFermer={onFermer}
      titre="Ranger chez un client"
      description={detail.objet ?? "(sans objet)"}
      pied={
        <div className="flex flex-wrap justify-end gap-2">
          <Bouton variante="fantome" onClick={onFermer}>
            Retour
          </Bouton>
          <Bouton variante="primaire" icone={<FolderInput size={15} aria-hidden />} disabled={!client} chargement={envoi} onClick={() => void ranger()}>
            Ranger {dossierId ? "dans ce dossier" : "sur la fiche"}
          </Bouton>
        </div>
      }
    >
      {client ? (
        <div className="flex items-center justify-between gap-2 rounded-[8px] border-[0.5px] border-[#1D9E75]/40 bg-[#112B22]/60 px-3 py-2">
          <span className="truncate text-[13px] text-[#F2F3F5]">{client.nom}</span>
          <Bouton
            variante="fantome"
            taille="sm"
            onClick={() => {
              setClient(null);
              setDossiers(null);
              setDossierId(null);
            }}
          >
            Changer
          </Bouton>
        </div>
      ) : (
        <div>
          <Champ
            libelle="Client"
            placeholder="Nom, e-mail, téléphone, ville…"
            value={recherche}
            onChange={(evenement) => setRecherche(evenement.target.value)}
            aide="Le mail sera rangé sur sa fiche ; son adresse n'y est pas ajoutée d'office."
            autoFocus
          />
          <ul className="mt-2 flex flex-col gap-1">
            {resultats.map((resultat) => (
              <li key={resultat.id}>
                <button
                  type="button"
                  onClick={() => setClient({ id: resultat.id, nom: resultat.nom })}
                  className={cn("flex min-h-10 w-full items-center justify-between gap-3 rounded-[8px] px-3 text-left text-[13px] text-[#D1D5DB] hover:bg-[#22262D]", TRANS)}
                >
                  <span className="truncate">{resultat.nom}</span>
                  <span className="shrink-0 text-[11.5px] text-[#6B7280]">
                    {[resultat.ville, resultat.email, `${resultat.nbDossiersEnCours} en cours`].filter(Boolean).join(" · ")}
                  </span>
                </button>
              </li>
            ))}
            {recherche.trim().length >= 2 && resultats.length === 0 ? <li className="px-3 py-2 text-[12px] text-[#6B7280]">Aucun client trouvé : c&apos;est peut-être une nouvelle demande.</li> : null}
          </ul>
        </div>
      )}

      {client ? (
        <div className="mt-4">
          <p className="mb-1.5 text-[12px] font-medium text-[#9CA3AF]">Dossier</p>
          {dossiers === null ? (
            <p className="text-[12px] text-[#6B7280]">Chargement des dossiers…</p>
          ) : (
            <div role="radiogroup" className="flex flex-col gap-1">
              {[{ id: null, objet: "Sur la fiche seulement", etape: null as string | null }, ...dossiers].map((dossier) => (
                <button
                  key={dossier.id ?? "fiche"}
                  type="button"
                  role="radio"
                  aria-checked={dossierId === dossier.id}
                  onClick={() => setDossierId(dossier.id)}
                  className={cn(
                    "flex min-h-10 items-center justify-between gap-3 rounded-[8px] border-[0.5px] px-3 text-left text-[13px]",
                    dossierId === dossier.id ? "border-[#1D9E75]/60 bg-[#112B22] text-[#5DCAA5]" : "border-[#2A2D34] bg-[#16181D] text-[#D1D5DB] hover:border-[#3A3E47]",
                    TRANS
                  )}
                >
                  <span className="truncate">{dossier.objet}</span>
                  {dossier.etape ? <span className="shrink-0 text-[11.5px] text-[#6B7280]">{libelleEtape(dossier.etape)}</span> : null}
                </button>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </Modale>
  );
}

/* ── Nouvelle demande ──────────────────────────────────────────────── */

function ModaleNouvelleDemande({ detail, onFermer, onFait }: { detail: MessageDetail; onFermer: () => void; onFait: () => void }) {
  const photos = detail.pieces.filter((piece) => piece.estImage && piece.statut === "CONSERVEE").length;
  const [valeurs, setValeurs] = useState({
    prenom: detail.demande.prenom ?? "",
    nomFamille: detail.demande.nomFamille ?? "",
    raisonSociale: detail.demande.raisonSociale ?? "",
    telephone: detail.demande.telephone ?? "",
    objet: detail.demande.objet ?? "",
    adresse: detail.demande.adresse ?? "",
    codePostal: detail.demande.codePostal ?? "",
    ville: detail.demande.ville ?? "",
    prochaineAction: detail.demande.prochaineAction ?? "",
    prochaineActionDate: detail.demande.prochaineActionDate ?? "",
    note: detail.demande.note ?? "",
  });
  const [categorie, setCategorie] = useState<CategorieClient>(
    (CATEGORIES_CLIENT as readonly string[]).includes(detail.demande.categorieClient ?? "")
      ? (detail.demande.categorieClient as CategorieClient)
      : detail.demande.raisonSociale
        ? "PROFESSIONNEL"
        : "PARTICULIER"
  );
  const [source, setSource] = useState<SourceClient>((SOURCES_CLIENT as readonly string[]).includes(detail.demande.source ?? "") ? (detail.demande.source as SourceClient) : "INCONNUE");
  const complet = Boolean(valeurs.adresse && valeurs.codePostal && valeurs.ville && valeurs.telephone && valeurs.objet && photos > 0);
  const [ouvrir, setOuvrir] = useState<"OUI" | "NON">(detail.demande.ouvrirDossier ?? (complet ? "OUI" : "NON"));
  const [envoi, setEnvoi] = useState(false);
  const changer = (cle: keyof typeof valeurs) => (evenement: { target: { value: string } }) => setValeurs((actuelles) => ({ ...actuelles, [cle]: evenement.target.value }));
  const nul = (valeur: string) => valeur.trim() || null;

  async function creer() {
    setEnvoi(true);
    try {
      await envoyerJson(`/api/messages/${detail.id}/nouvelle-demande`, "POST", {
        clientId: detail.client?.id ?? null,
        categorieClient: categorie,
        prenom: nul(valeurs.prenom),
        nomFamille: nul(valeurs.nomFamille),
        raisonSociale: nul(valeurs.raisonSociale),
        telephone: nul(valeurs.telephone),
        source,
        ouvrirDossier: ouvrir,
        objet: nul(valeurs.objet),
        adresse: nul(valeurs.adresse),
        codePostal: nul(valeurs.codePostal),
        ville: nul(valeurs.ville),
        prochaineAction: nul(valeurs.prochaineAction),
        prochaineActionDate: nul(valeurs.prochaineActionDate),
        note: nul(valeurs.note),
      });
      toast.success(ouvrir === "OUI" ? "Fiche et dossier créés" : detail.client ? "Mail rangé sur la fiche" : "Fiche client créée", { description: "Le mail y est rangé." });
      onFait();
    } catch (erreur) {
      toast.error("Création impossible", { description: messageErreur(erreur) });
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <Modale
      ouverte
      onFermer={onFermer}
      titre={detail.client ? `Nouvelle demande de ${detail.client.nom}` : "Nouvelle demande"}
      description={`${expediteur(detail)} — pré-rempli d'après le mail${detail.propositionsEnAttente ? " et l'agent" : ""} : à vérifier.`}
      largeur="lg"
      pied={
        <div className="flex flex-wrap justify-end gap-2">
          <Bouton variante="fantome" onClick={onFermer}>
            Retour
          </Bouton>
          <Bouton variante="primaire" icone={<UserPlus size={15} aria-hidden />} chargement={envoi} onClick={() => void creer()}>
            {ouvrir === "OUI" ? (detail.client ? "Ouvrir le dossier" : "Créer la fiche et le dossier") : detail.client ? "Ranger sur la fiche" : "Créer la fiche"}
          </Bouton>
        </div>
      }
    >
      <div className="grid gap-4 md:grid-cols-2">
        {detail.client ? null : (
          <>
            <Champ libelle="Prénom" value={valeurs.prenom} onChange={changer("prenom")} autoComplete="off" />
            <Champ libelle="Nom" value={valeurs.nomFamille} onChange={changer("nomFamille")} autoComplete="off" />
            <Champ libelle="Raison sociale" aide="Pour un professionnel." value={valeurs.raisonSociale} onChange={changer("raisonSociale")} autoComplete="off" />
            <Champ libelle="Téléphone" type="tel" inputMode="tel" value={valeurs.telephone} onChange={changer("telephone")} autoComplete="off" />
            <div className="md:col-span-2">
              <Puces
                libelle="Catégorie"
                options={CATEGORIES_CLIENT.map((valeur) => ({ valeur, libelle: LIBELLES_CATEGORIE_CLIENT[valeur] }))}
                valeur={categorie}
                onChange={setCategorie}
              />
            </div>
            <ListeDeroulante
              libelle="D'où vient ce contact"
              aide="Ce que dit le mail (« vu votre publicité », « recommandé par… »)."
              value={source}
              onChange={(evenement) => setSource(evenement.target.value as SourceClient)}
              options={SOURCES_CLIENT.map((valeur) => ({ valeur, libelle: LIBELLES_SOURCE_CLIENT[valeur] }))}
            />
          </>
        )}
        <div className="md:col-span-2">
          <Puces
            libelle="Ouvrir le dossier"
            obligatoire
            options={[
              { valeur: "OUI", libelle: "Oui : le chantier est prêt à suivre" },
              { valeur: "NON", libelle: detail.client ? "Non : ranger sur la fiche" : "Non : la fiche seule pour l'instant" },
            ]}
            valeur={ouvrir}
            onChange={(valeur) => setOuvrir(valeur as "OUI" | "NON")}
          />
          <p className="mt-1.5 text-[12px] text-[#6B7280]">
            {photos > 0 ? `${photos} photo${photos > 1 ? "s" : ""} reçue${photos > 1 ? "s" : ""} : ajoutée${photos > 1 ? "s" : ""} au dossier.` : "Aucune photo reçue : le dossier s'ouvre quand même, le manque y est signalé (les demander dans la réponse)."}
          </p>
        </div>
        {ouvrir === "OUI" ? (
          <>
            <Champ libelle="Objet du chantier" value={valeurs.objet} onChange={changer("objet")} placeholder="Rénovation plan de travail cuisine" classeConteneur="md:col-span-2" />
            <Champ libelle="Adresse du chantier" value={valeurs.adresse} onChange={changer("adresse")} classeConteneur="md:col-span-2" />
            <Champ libelle="Code postal" inputMode="numeric" value={valeurs.codePostal} onChange={changer("codePostal")} />
            <Champ libelle="Ville" value={valeurs.ville} onChange={changer("ville")} />
            {detail.client ? <Champ libelle="Téléphone du chantier" type="tel" inputMode="tel" value={valeurs.telephone} onChange={changer("telephone")} /> : null}
            <Champ libelle="Prochaine action" value={valeurs.prochaineAction} onChange={changer("prochaineAction")} placeholder="Appeler pour une visite" />
            <Champ libelle="Date de la prochaine action" type="date" value={valeurs.prochaineActionDate} onChange={changer("prochaineActionDate")} />
            <ZoneTexte libelle="Note au dossier" rows={3} value={valeurs.note} onChange={changer("note")} classeConteneur="md:col-span-2" />
          </>
        ) : null}
      </div>
    </Modale>
  );
}

/* ── Répondre ──────────────────────────────────────────────────────── */

function ModaleReponse({ detail, onFermer, onFait }: { detail: MessageDetail; onFermer: () => void; onFait: () => void }) {
  const [brouillon, setBrouillon] = useState<{ a: string; objet: string; texte: string; propositionId: string | null } | null>(null);
  const [envoi, setEnvoi] = useState(false);

  useEffect(() => {
    let actif = true;
    appelApi<{ a: string; objet: string; texte: string; propositionId: string | null }>(`/api/messages/${detail.id}/reponse`)
      .then((lu) => actif && setBrouillon(lu))
      .catch((erreur) => toast.error("Brouillon illisible", { description: messageErreur(erreur) }));
    return () => {
      actif = false;
    };
  }, [detail.id]);

  async function envoyer() {
    if (!brouillon) return;
    setEnvoi(true);
    try {
      await envoyerJson(`/api/messages/${detail.id}/reponse`, "POST", { objet: brouillon.objet, texte: brouillon.texte });
      toast.success("Réponse validée", { description: "Envoi en cours depuis la boîte de l'entreprise." });
      onFait();
    } catch (erreur) {
      toast.error("Envoi impossible", { description: messageErreur(erreur) });
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <Modale
      ouverte
      onFermer={onFermer}
      titre={`Répondre à ${detail.deNom ?? detail.de}`}
      description={brouillon?.propositionId ? "Brouillon préparé par l'agent : relis, corrige, envoie." : "Rien ne part avant ce clic."}
      largeur="lg"
      pied={
        <div className="flex flex-wrap justify-end gap-2">
          <Bouton variante="fantome" onClick={onFermer}>
            Retour
          </Bouton>
          <Bouton variante="primaire" icone={<Send size={14} aria-hidden />} disabled={!brouillon?.texte.trim() || !brouillon.objet.trim()} chargement={envoi} onClick={() => void envoyer()}>
            Envoyer la réponse
          </Bouton>
        </div>
      }
    >
      {brouillon ? (
        <div className="flex flex-col gap-4">
          <Champ libelle="À" value={brouillon.a} disabled />
          <Champ libelle="Objet" obligatoire value={brouillon.objet} maxLength={200} onChange={(evenement) => setBrouillon({ ...brouillon, objet: evenement.target.value })} />
          <ZoneTexte libelle="Message" obligatoire rows={12} maxLength={10_000} value={brouillon.texte} onChange={(evenement) => setBrouillon({ ...brouillon, texte: evenement.target.value })} />
        </div>
      ) : (
        <p className="text-[13px] text-[#6B7280]">Préparation du brouillon…</p>
      )}
    </Modale>
  );
}

/* ── Hors clients ──────────────────────────────────────────────────── */

function ModaleClasser({ detail, onFermer, onFait }: { detail: MessageDetail; onFermer: () => void; onFait: () => void }) {
  const [categorie, setCategorie] = useState<CategorieHorsClients | null>(
    (CATEGORIES_HORS_CLIENTS as readonly string[]).includes(detail.categorie ?? "") ? (detail.categorie as CategorieHorsClients) : null
  );
  const [envoi, setEnvoi] = useState(false);

  async function classer() {
    if (!categorie) return;
    setEnvoi(true);
    try {
      await envoyerJson(`/api/messages/${detail.id}/classer`, "POST", { categorie });
      toast.success("Mail classé hors clients");
      onFait();
    } catch (erreur) {
      toast.error("Classement impossible", { description: messageErreur(erreur) });
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <Modale
      ouverte
      onFermer={onFermer}
      titre="Classer hors clients"
      description="Il reste dans la boîte de réception ; il sort de la file à trier."
      largeur="sm"
      pied={
        <div className="flex justify-end gap-2">
          <Bouton variante="fantome" onClick={onFermer}>
            Retour
          </Bouton>
          <Bouton variante="primaire" icone={<Tags size={14} aria-hidden />} disabled={!categorie} chargement={envoi} onClick={() => void classer()}>
            Classer
          </Bouton>
        </div>
      }
    >
      <Puces
        libelle="Ce mail vient de"
        obligatoire
        options={CATEGORIES_HORS_CLIENTS.map((valeur) => ({ valeur, libelle: LIBELLES_CATEGORIE_MESSAGE[valeur] }))}
        valeur={categorie}
        onChange={setCategorie}
      />
    </Modale>
  );
}

/* ── Lecteur ───────────────────────────────────────────────────────── */

type Vue = "lecture" | "rattacher" | "demande" | "reponse" | "classer";

const ORDRE_PROPOSITIONS = ["RATTACHER_MESSAGE", "NOUVELLE_DEMANDE", "ARCHIVER_MESSAGE", "CLASSER_MESSAGE", "CHANGEMENT_ETAPE", "PROCHAINE_ACTION", "NOTE_DOSSIER", "ENVOI_MAIL"];

/**
 * Un mail, tel que l'agent l'a lu : texte (sans l'historique cité), pièces
 * jointes, conversation, analyses et propositions en attente ; et les gestes
 * de tri. Une seule fenêtre à la fois (pas de fenêtres empilées au téléphone).
 */
export function LecteurMessage({ messageId, onFermer, onModifie }: { messageId: string; onFermer: () => void; onModifie?: () => void }) {
  const [courant, setCourant] = useState(messageId);
  const [detail, setDetail] = useState<MessageDetail | null>(null);
  const [propositions, setPropositions] = useState<PropositionVue[]>([]);
  const [complet, setComplet] = useState(false);
  const [vue, setVue] = useState<Vue>("lecture");
  const [occupe, setOccupe] = useState<string | null>(null);
  const [enCorrection, setEnCorrection] = useState<PropositionVue | null>(null);
  const [enRejet, setEnRejet] = useState<PropositionVue | null>(null);

  const charger = useCallback(async (id: string) => {
    try {
      const [lu, { propositions: enAttente }] = await Promise.all([
        appelApi<MessageDetail>(`/api/messages/${id}`),
        appelApi<{ propositions: PropositionVue[] }>(`/api/validation?messageId=${id}&statut=EN_ATTENTE`),
      ]);
      setDetail(lu);
      setPropositions(enAttente);
    } catch (erreur) {
      toast.error("Mail illisible", { description: messageErreur(erreur) });
    }
  }, []);

  useEffect(() => {
    void charger(courant);
  }, [charger, courant]);

  const apresAction = useCallback(() => {
    setVue("lecture");
    setEnCorrection(null);
    setEnRejet(null);
    rafraichirCompteurs();
    onModifie?.();
    void charger(courant);
  }, [charger, courant, onModifie]);

  async function geste(nom: string, appel: () => Promise<unknown>, reussite: string, description?: string) {
    setOccupe(nom);
    try {
      await appel();
      toast.success(reussite, { description });
      apresAction();
    } catch (erreur) {
      toast.error("Action refusée", { description: messageErreur(erreur) });
    } finally {
      setOccupe(null);
    }
  }

  async function validerProposition(proposition: PropositionVue, corrections?: Record<string, unknown>) {
    setOccupe(proposition.id);
    try {
      const { proposition: resultat } = await envoyerJson<{ proposition: PropositionVue }>(`/api/validation/${proposition.id}/valider`, "POST", { corrections });
      toast.success(resultat.statut === "VALIDEE" ? "Validée : exécution en cours" : "Validée et exécutée", { description: proposition.titre });
      apresAction();
    } catch (erreur) {
      toast.error("Validation impossible", { description: messageErreur(erreur) });
    } finally {
      setOccupe(null);
    }
  }

  async function rejeterProposition(proposition: PropositionVue, motif: string, commentaire: string) {
    setOccupe(proposition.id);
    try {
      await envoyerJson(`/api/validation/${proposition.id}/rejeter`, "POST", { motif, commentaire: commentaire || null });
      toast("Proposition rejetée", { description: proposition.titre });
      apresAction();
    } catch (erreur) {
      toast.error("Rejet impossible", { description: messageErreur(erreur) });
    } finally {
      setOccupe(null);
    }
  }

  const aTrier = detail ? ["A_TRIER", "IGNORE"].includes(detail.statut) : false;
  const entrant = detail?.sens === "ENTRANT";
  const texte = detail ? (complet ? detail.texte : detail.texteUtile) : null;

  return (
    <>
      <Modale
        ouverte={vue === "lecture" && !enCorrection && !enRejet}
        onFermer={onFermer}
        largeur="lg"
        titre={detail ? (detail.objet ?? "(sans objet)") : "Chargement du mail…"}
        description={detail ? `${expediteur(detail)} · ${formatHorodatage(detail.recuLe)}` : undefined}
        pied={
          detail ? (
            <div className="flex flex-wrap items-center justify-end gap-2">
              {detail.lienBoite ? (
                <a
                  href={detail.lienBoite}
                  target="_blank"
                  rel="noreferrer"
                  className={cn("mr-auto inline-flex min-h-8 items-center gap-1 text-[12px] text-[#9CA3AF] hover:text-[#F2F3F5]", TRANS)}
                >
                  <ExternalLink size={12} aria-hidden /> Ouvrir dans Gmail
                </a>
              ) : null}
              {entrant && detail.ia.active && detail.statut !== "BRUIT" ? (
                <Bouton variante="fantome" taille="sm" icone={<RefreshCw size={13} aria-hidden />} chargement={occupe === "relire"} onClick={() => void geste("relire", () => envoyerJson(`/api/messages/${detail.id}/relire`, "POST"), "Relecture demandée", "Les suggestions arrivent d'ici une minute.")}>
                  Relire avec l&apos;IA
                </Bouton>
              ) : null}
              {detail.statut === "BRUIT" ? (
                <Bouton icone={<ArchiveRestore size={14} aria-hidden />} chargement={occupe === "bruit"} onClick={() => void geste("bruit", () => envoyerJson(`/api/messages/${detail.id}/pas-du-bruit`, "POST"), "Remis à trier", "Il revient aussi dans la boîte de réception.")}>
                  Ce n&apos;est pas du bruit
                </Bouton>
              ) : null}
              {aTrier ? (
                <>
                  <Bouton variante="fantome" icone={<Archive size={14} aria-hidden />} chargement={occupe === "archiver"} onClick={() => void geste("archiver", () => envoyerJson(`/api/messages/${detail.id}/archiver`, "POST"), "Archivé comme bruit", "Retiré de la boîte de réception, jamais supprimé.")}>
                    Bruit
                  </Bouton>
                  <Bouton variante="fantome" icone={<Tags size={14} aria-hidden />} onClick={() => setVue("classer")}>
                    Hors clients
                  </Bouton>
                </>
              ) : null}
              {entrant && detail.statut !== "BRUIT" ? (
                <Bouton icone={<Reply size={14} aria-hidden />} onClick={() => setVue("reponse")}>
                  Répondre
                </Bouton>
              ) : null}
              {entrant && (aTrier || (detail.statut === "RATTACHE" && !detail.dossier)) ? (
                <Bouton icone={<UserPlus size={14} aria-hidden />} onClick={() => setVue("demande")}>
                  Nouvelle demande
                </Bouton>
              ) : null}
              {detail.statut !== "A_ANALYSER" ? (
                <Bouton variante={aTrier ? "primaire" : "secondaire"} icone={<FolderInput size={14} aria-hidden />} onClick={() => setVue("rattacher")}>
                  {detail.statut === "RATTACHE" ? "Changer de dossier" : "Ranger chez un client"}
                </Bouton>
              ) : null}
            </div>
          ) : null
        }
      >
        {detail ? (
          <div>
            <div className="flex flex-wrap items-center gap-1.5">
              <Pastille ton={TON_STATUT_MESSAGE[detail.statut]}>{LIBELLES_STATUT_MESSAGE[detail.statut]}</Pastille>
              {detail.categorie && detail.categorie !== "CLIENT" ? <Pastille>{LIBELLES_CATEGORIE_MESSAGE[detail.categorie]}</Pastille> : null}
              {detail.sens === "SORTANT" ? (
                <Pastille ton="bleu">
                  <ArrowUpRight size={11} aria-hidden /> Envoyé
                </Pastille>
              ) : null}
              {detail.boiteArchiveLe ? <Pastille titre="Retiré de la boîte de réception, sous le libellé « CoverSwap CRM/Bruit archivé »">Hors de la boîte de réception</Pastille> : null}
              {detail.client ? (
                <Link href={`/clients/${detail.client.id}`} className={cn("inline-flex min-h-7 items-center gap-1 text-[12px] text-[#9CA3AF] hover:text-[#F2F3F5]", TRANS)}>
                  {detail.client.nom}
                </Link>
              ) : null}
              {detail.dossier ? (
                <Link href={`/dossiers?dossier=${detail.dossier.id}`} className={cn("inline-flex min-h-7 items-center gap-1 text-[12px] text-[#9CA3AF] hover:text-[#F2F3F5]", TRANS)}>
                  <FolderOpen size={12} aria-hidden /> {detail.dossier.objet}
                </Link>
              ) : null}
            </div>

            {propositions.length > 0 ? (
              <section className="mt-4">
                <p className="mb-2 text-[12px] font-medium tracking-wide text-[#9CA3AF] uppercase">À valider pour ce mail</p>
                <div className="flex flex-col gap-2">
                  {[...propositions].sort((a, b) => ORDRE_PROPOSITIONS.indexOf(a.type) - ORDRE_PROPOSITIONS.indexOf(b.type)).map((proposition) => (
                    <CarteProposition
                      key={proposition.id}
                      proposition={{ ...proposition, liens: proposition.liens.filter((lien) => !lien.href.includes(`message=${detail.id}`)) }}
                      occupee={occupe === proposition.id}
                      onValider={() => void validerProposition(proposition)}
                      onCorriger={() => setEnCorrection(proposition)}
                      onRejeter={() => setEnRejet(proposition)}
                      onReessayer={() => undefined}
                    />
                  ))}
                </div>
              </section>
            ) : null}

            <section className="mt-4">
              {texte ? (
                <p className="rounded-[8px] border-[0.5px] border-[#2A2D34] bg-[#16181D] px-3.5 py-3 text-[13.5px] leading-relaxed break-words whitespace-pre-wrap text-[#E5E7EB]">{texte}</p>
              ) : (
                <p className="text-[13px] text-[#6B7280]">{detail.extrait ?? "Texte indisponible (mail sans texte, ou effacé au titre du RGPD)."}</p>
              )}
              {detail.texte && detail.texteUtile && detail.texte.length > detail.texteUtile.length + 20 ? (
                <Bouton variante="fantome" taille="sm" className="mt-1" icone={<ChevronDown size={13} aria-hidden className={cn("transition-transform", complet && "rotate-180")} />} onClick={() => setComplet((valeur) => !valeur)}>
                  {complet ? "Masquer l'historique cité" : "Afficher tout le mail (historique cité)"}
                </Bouton>
              ) : null}
            </section>

            {detail.pieces.length > 0 ? (
              <section className="mt-4">
                <p className="mb-2 flex items-center gap-1.5 text-[12px] font-medium tracking-wide text-[#9CA3AF] uppercase">
                  <Paperclip size={13} aria-hidden /> Pièces jointes
                </p>
                <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {detail.pieces.map((piece) => (
                    <li key={piece.id} className="overflow-hidden rounded-[8px] border-[0.5px] border-[#2A2D34] bg-[#16181D]">
                      {piece.url && piece.estImage ? (
                        <a href={piece.url} target="_blank" rel="noreferrer" className="block aspect-[4/3] bg-[#0F1115]">
                          {/* eslint-disable-next-line @next/next/no-img-element -- pièce servie par l'API authentifiée */}
                          <img src={piece.url} alt={piece.nom} loading="lazy" className="h-full w-full object-cover" />
                        </a>
                      ) : null}
                      <div className="px-2.5 py-2 text-[12px]">
                        {piece.url ? (
                          <a href={piece.url} target="_blank" rel="noreferrer" className={cn("flex items-center gap-1 truncate text-[#D1D5DB] hover:text-[#F2F3F5]", TRANS)}>
                            {piece.estImage ? null : <FileText size={12} aria-hidden className="shrink-0" />}
                            <span className="truncate">{piece.nom}</span>
                          </a>
                        ) : (
                          <p className="truncate text-[#D1D5DB]">{piece.nom}</p>
                        )}
                        <p className="mt-0.5 text-[11px] text-[#6B7280]">{piece.statut === "CONSERVEE" ? formatTaille(piece.taille) : (piece.raison ?? "En attente de téléchargement")}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            <Analyses analyses={detail.analyses} />

            {detail.fil.length > 0 ? (
              <section className="mt-4">
                <p className="mb-2 text-[12px] font-medium tracking-wide text-[#9CA3AF] uppercase">Même conversation</p>
                <ul className="flex flex-col gap-1">
                  {detail.fil.map((autre) => (
                    <li key={autre.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setDetail(null);
                          setComplet(false);
                          setCourant(autre.id);
                        }}
                        className={cn("flex min-h-10 w-full items-center gap-2.5 rounded-[8px] px-2.5 text-left text-[12.5px] hover:bg-[#22262D]", TRANS)}
                      >
                        {autre.sens === "SORTANT" ? <ArrowUpRight size={13} className="shrink-0 text-[#93C5FD]" aria-hidden /> : <ArrowDownLeft size={13} className="shrink-0 text-[#9CA3AF]" aria-hidden />}
                        <span className="shrink-0 text-[#6B7280]">{formatHorodatage(autre.recuLe)}</span>
                        <span className="truncate text-[#D1D5DB]">{autre.extrait ?? autre.objet ?? ""}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </div>
        ) : (
          <p className="flex items-center gap-2 text-[13px] text-[#6B7280]">
            <Search size={14} aria-hidden /> Lecture…
          </p>
        )}
      </Modale>

      {detail && vue === "rattacher" ? <ModaleRattacher detail={detail} onFermer={() => setVue("lecture")} onFait={apresAction} /> : null}
      {detail && vue === "demande" ? <ModaleNouvelleDemande detail={detail} onFermer={() => setVue("lecture")} onFait={apresAction} /> : null}
      {detail && vue === "reponse" ? <ModaleReponse detail={detail} onFermer={() => setVue("lecture")} onFait={apresAction} /> : null}
      {detail && vue === "classer" ? <ModaleClasser detail={detail} onFermer={() => setVue("lecture")} onFait={apresAction} /> : null}
      {enCorrection ? <ModaleCorrection proposition={enCorrection} onFermer={() => setEnCorrection(null)} onValider={(corrections) => validerProposition(enCorrection, corrections)} /> : null}
      {enRejet ? <ModaleRejet proposition={enRejet} onFermer={() => setEnRejet(null)} onRejeter={(motif, commentaire) => rejeterProposition(enRejet, motif, commentaire)} /> : null}
    </>
  );
}
