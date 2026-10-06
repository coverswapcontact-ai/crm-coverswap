"use client";

import { useEffect, useState } from "react";
import { FolderInput, Send, Tags, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { appelApi, envoyerJson, messageErreur } from "@/components/pilotage/client";
import { Bouton, Champ, ListeDeroulante, Modale, Puces, TRANS, ZoneTexte } from "@/components/pilotage/ui";
import { CATEGORIES_CLIENT, LIBELLES_CATEGORIE_CLIENT, LIBELLES_SOURCE_CLIENT, SOURCES_CLIENT, type CategorieClient, type SourceClient } from "@/lib/clients/constantes";
import type { ClientDetail, ClientResume } from "@/lib/clients/types";
import { LIBELLES_ETAPE, type EtapeDossier } from "@/lib/dossiers/constants";
import { CATEGORIES_HORS_CLIENTS, LIBELLES_CATEGORIE_MESSAGE, type CategorieHorsClients, type MessageDetail } from "@/lib/messages/constantes";
import { cn } from "@/lib/utils";
import { expediteur } from "./expediteur";

/** Mission 13 (lot 7) : les quatre fenêtres du lecteur de mail — ranger chez un client, nouvelle demande, répondre, classer hors clients. */

const libelleEtape = (etape: string) => LIBELLES_ETAPE[etape as EtapeDossier] ?? etape;

/* ── Ranger chez un client ─────────────────────────────────────────── */

type DossierDuClient = ClientDetail["dossiers"][number];

export function ModaleRattacher({ detail, onFermer, onFait }: { detail: MessageDetail; onFermer: () => void; onFait: () => void }) {
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
        <div className="flex items-center justify-between gap-2 rounded-[8px] border-[0.5px] border-action/40 bg-action-fond/60 px-3 py-2">
          <span className="truncate text-[13px] text-texte">{client.nom}</span>
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
                  className={cn("flex min-h-10 w-full items-center justify-between gap-3 rounded-[8px] px-3 text-left text-[13px] text-texte-2 hover:bg-surface-2", TRANS)}
                >
                  <span className="truncate">{resultat.nom}</span>
                  <span className="shrink-0 text-[11.5px] text-texte-3">
                    {[resultat.ville, resultat.email, `${resultat.nbDossiersEnCours} en cours`].filter(Boolean).join(" · ")}
                  </span>
                </button>
              </li>
            ))}
            {recherche.trim().length >= 2 && resultats.length === 0 ? <li className="px-3 py-2 text-[12px] text-texte-3">Aucun client trouvé : c&apos;est peut-être une nouvelle demande.</li> : null}
          </ul>
        </div>
      )}

      {client ? (
        <div className="mt-4">
          <p className="mb-1.5 text-[12px] font-medium text-texte-3">Dossier</p>
          {dossiers === null ? (
            <p className="text-[12px] text-texte-3">Chargement des dossiers…</p>
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
                    dossierId === dossier.id ? "border-action/60 bg-action-fond text-action-clair" : "border-trait bg-fond text-texte-2 hover:border-trait-2",
                    TRANS
                  )}
                >
                  <span className="truncate">{dossier.objet}</span>
                  {dossier.etape ? <span className="shrink-0 text-[11.5px] text-texte-3">{libelleEtape(dossier.etape)}</span> : null}
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

export function ModaleNouvelleDemande({ detail, onFermer, onFait }: { detail: MessageDetail; onFermer: () => void; onFait: () => void }) {
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
          <p className="mt-1.5 text-[12px] text-texte-3">
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

export function ModaleReponse({ detail, onFermer, onFait }: { detail: MessageDetail; onFermer: () => void; onFait: () => void }) {
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
        <p className="text-[13px] text-texte-3">Préparation du brouillon…</p>
      )}
    </Modale>
  );
}

/* ── Hors clients ──────────────────────────────────────────────────── */

export function ModaleClasser({ detail, onFermer, onFait }: { detail: MessageDetail; onFermer: () => void; onFait: () => void }) {
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
