"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, ImageIcon, Loader2, Search, X } from "lucide-react";
import { toast } from "sonner";
import { ETAPES, LIBELLES_ETAPE, LIBELLES_SOURCE, SOURCES_DOSSIER, type EtapeDossier, type SourceDossier } from "@/lib/dossiers/constants";
import type { EntrepriseAnnuaire } from "@/lib/clients/types";
import { lireNombre } from "@/lib/dossiers/montants";
import { estEtapeActive, rangEtape } from "@/lib/dossiers/regles";
import type { LeadTrouve } from "@/lib/dossiers/types";
import { cn } from "@/lib/utils";
import { appelApi, messageErreur, photoTropLourde, preparerPhoto } from "./client";
import { RepriseDossier } from "./RepriseDossier";
import { PARTICULIER, TypeClientDossier, erreurTypeClient, estEntreprise, sourceSelonSousTraitance, typeClientPourEnvoi, typeSelonSource, type TypeClientSaisi } from "./TypeClientDossier";
import { Bouton, Champ, CLASSE_SAISIE, ListeDeroulante, Modale, TRANS } from "./ui";
import { avertissementsCoordonnees, manquesCoordonnees, validerCoordonnees, type ChampsCoordonnees } from "./validation";

type Champs = ChampsCoordonnees & { prochaineAction: string; prochaineActionDate: string; etape: EtapeDossier; dateChantier: string };
type Erreurs = Partial<Record<keyof Champs | "photos", string>>;
type PhotoChoisie = { cle: string; fichier: File; apercu: string };
type Mode = "lead" | "direct" | "reprise";

const LIBELLES_ORIGINE: Record<LeadTrouve["origine"], string> = { CLIENT: "Client", LEAD: "Contact", PROSPECT: "Prospect" };

function champsDepuis(lead: LeadTrouve | null, conserves?: Champs): Champs {
  const pre = lead?.preRemplissage;
  return {
    clientNom: pre?.clientNom ?? "",
    clientTelephone: pre?.clientTelephone ?? "",
    clientEmail: pre?.clientEmail ?? "",
    clientAdresse: pre?.clientAdresse ?? "",
    clientCp: pre?.clientCp ?? "",
    clientVille: pre?.clientVille ?? "",
    objet: pre?.objet ?? "",
    source: pre?.source ?? "",
    montantEstime: conserves?.montantEstime ?? "",
    prochaineAction: conserves?.prochaineAction ?? "",
    prochaineActionDate: conserves?.prochaineActionDate ?? "",
    etape: conserves?.etape ?? "QUALIFICATION",
    dateChantier: conserves?.dateChantier ?? "",
  };
}

/**
 * « Ouvrir un dossier » : depuis un client ou un lead existant (coordonnées
 * pré-remplies, lien conservé) ou en création directe, à l'étape où en est
 * le chantier. Seul le nom du client est exigé : ce qui manque est signalé
 * sur le dossier.
 */
export function CreationDossier({
  ouverte,
  leadInitial,
  onFermer,
  onCree,
}: {
  ouverte: boolean;
  leadInitial: LeadTrouve | null;
  onFermer: () => void;
  onCree: (id: string) => void;
}) {
  const [mode, setMode] = useState<Mode>("lead");
  const [origine, setOrigine] = useState<LeadTrouve | null>(leadInitial);
  const [champs, setChamps] = useState<Champs>(() => champsDepuis(leadInitial));
  const [typeClient, setTypeClient] = useState<TypeClientSaisi>(PARTICULIER);
  const [adresseAnnuaire, setAdresseAnnuaire] = useState(false);
  const [photos, setPhotos] = useState<PhotoChoisie[]>([]);
  const [erreurs, setErreurs] = useState<Erreurs>({});
  const [envoi, setEnvoi] = useState<string | null>(null);
  const [recherche, setRecherche] = useState("");
  const [resultats, setResultats] = useState<LeadTrouve[] | null>(null);
  const [rechercheEnCours, setRechercheEnCours] = useState(false);
  const entreePhotos = useRef<HTMLInputElement>(null);
  const apercus = useRef<string[]>([]);

  const rechercheActive = ouverte && mode === "lead" && origine === null;

  // Recherche des leads, 250 ms après la dernière frappe.
  useEffect(() => {
    if (!rechercheActive) return;
    let actif = true;
    const minuteur = window.setTimeout(() => {
      setRechercheEnCours(true);
      appelApi<{ resultats: LeadTrouve[] }>(`/api/dossiers/leads?q=${encodeURIComponent(recherche)}`)
        .then((reponse) => {
          if (actif) setResultats(reponse.resultats);
        })
        .catch((probleme: unknown) => {
          if (actif) toast.error("Recherche impossible", { description: messageErreur(probleme) });
        })
        .finally(() => {
          if (actif) setRechercheEnCours(false);
        });
    }, 250);
    return () => {
      actif = false;
      window.clearTimeout(minuteur);
    };
  }, [rechercheActive, recherche]);

  // Libère les aperçus des photos à la fermeture du formulaire.
  useEffect(() => {
    apercus.current = photos.map((photo) => photo.apercu);
  }, [photos]);
  useEffect(() => {
    const liste = apercus;
    return () => liste.current.forEach((url) => URL.revokeObjectURL(url));
  }, []);

  const modifier = (cle: keyof Champs) => (evenement: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const valeur = evenement.target.value;
    setChamps((actuels) => ({ ...actuels, [cle]: valeur }));
    setErreurs((actuelles) => ({ ...actuelles, [cle]: undefined }));
  };

  // Entreprise trouvée dans l'annuaire : sa raison sociale nomme le dossier ; son
  // adresse ne remplit que des champs vides (le chantier peut être ailleurs).
  function remplirDepuisAnnuaire(entreprise: EntrepriseAnnuaire) {
    const adresseVide = !champs.clientAdresse.trim() && !champs.clientCp.trim() && !champs.clientVille.trim();
    setChamps((actuels) => ({
      ...actuels,
      clientNom: entreprise.raisonSociale ?? actuels.clientNom,
      ...(adresseVide ? { clientAdresse: entreprise.adresse ?? "", clientCp: entreprise.codePostal ?? "", clientVille: entreprise.ville ?? "" } : {}),
    }));
    setAdresseAnnuaire(adresseVide && Boolean(entreprise.adresse || entreprise.ville));
    setErreurs((actuelles) => ({ ...actuelles, clientNom: undefined }));
  }

  function choisirLead(lead: LeadTrouve) {
    setOrigine(lead);
    setChamps((actuels) => champsDepuis(lead, actuels));
    setErreurs({});
  }

  function changerMode(nouveau: Mode) {
    setMode(nouveau);
    if (nouveau !== "lead") setOrigine(null);
  }

  function ajouterPhotos(fichiers: FileList | null) {
    const nouvelles = Array.from(fichiers ?? []).map((fichier) => ({
      cle: crypto.randomUUID(),
      fichier,
      apercu: URL.createObjectURL(fichier),
    }));
    if (nouvelles.length === 0) return;
    setPhotos((actuelles) => [...actuelles, ...nouvelles]);
    setErreurs((actuelles) => ({ ...actuelles, photos: undefined }));
    if (entreePhotos.current) entreePhotos.current.value = "";
  }

  function retirerPhoto(cle: string) {
    setPhotos((actuelles) => {
      const retiree = actuelles.find((photo) => photo.cle === cle);
      if (retiree) URL.revokeObjectURL(retiree.apercu);
      return actuelles.filter((photo) => photo.cle !== cle);
    });
  }

  async function ouvrir() {
    const trouvees: Erreurs = { ...validerCoordonnees(champs) };
    if (!origine && estEntreprise(typeClient) && trouvees.clientNom) trouvees.clientNom = "La raison sociale est obligatoire.";
    setErreurs(trouvees);
    const siretFaux = origine ? null : erreurTypeClient(typeClient);
    if (siretFaux) {
      setTypeClient((actuel) => ({ ...actuel, siretQuitte: true }));
      toast.error("Dossier non ouvert", { description: `SIRET : ${siretFaux} Corrige-le ou laisse-le vide.` });
      return;
    }
    if (Object.keys(trouvees).length > 0) {
      toast.error("Dossier non ouvert", { description: "Corrige les champs signalés en rouge." });
      return;
    }

    try {
      setEnvoi("Préparation des photos…");
      const prets: File[] = [];
      for (const photo of photos) {
        const prete = await preparerPhoto(photo.fichier);
        if (photoTropLourde(prete)) throw new Error(`« ${photo.fichier.name} » dépasse 9 Mo.`);
        prets.push(prete);
      }

      setEnvoi(prets.length > 1 ? `Envoi de la photo 1 sur ${prets.length}…` : "Ouverture du dossier…");
      const avance = estEtapeActive(champs.etape) && rangEtape(champs.etape) >= rangEtape("PLANIFIE");
      const formulaire = new FormData();
      formulaire.set(
        "donnees",
        JSON.stringify({
          clientNom: champs.clientNom,
          clientTelephone: champs.clientTelephone,
          clientEmail: champs.clientEmail || null,
          clientAdresse: champs.clientAdresse,
          clientCp: champs.clientCp,
          clientVille: champs.clientVille,
          objet: champs.objet,
          source: champs.source || null,
          montantEstime: champs.montantEstime.trim() ? lireNombre(champs.montantEstime) : null,
          prochaineAction: champs.prochaineAction || null,
          prochaineActionDate: champs.prochaineActionDate || null,
          etape: champs.etape,
          dateChantier: avance && champs.dateChantier ? champs.dateChantier : null,
          leadId: origine?.origine === "LEAD" ? origine.id : null,
          prospectId: origine?.origine === "PROSPECT" ? origine.id : null,
          clientId: origine?.origine === "CLIENT" ? origine.id : null,
          // Sans fiche d'origine, le client est créé tel que déclaré : particulier ou entreprise.
          ...(origine ? {} : typeClientPourEnvoi(typeClient)),
        })
      );
      if (prets[0]) formulaire.append("photos", prets[0]);
      const { id } = await appelApi<{ id: string }>("/api/dossiers", { method: "POST", body: formulaire });

      // Photos suivantes une à une : le corps d'une requête est limité à 10 Mo.
      let manquantes = 0;
      for (let index = 1; index < prets.length; index++) {
        setEnvoi(`Envoi de la photo ${index + 1} sur ${prets.length}…`);
        const envoiPhoto = new FormData();
        envoiPhoto.set("photo", prets[index]);
        try {
          await appelApi(`/api/dossiers/${id}/photos`, { method: "POST", body: envoiPhoto });
        } catch {
          manquantes++;
        }
      }

      toast.success("Dossier ouvert", {
        description:
          manquantes > 0
            ? `${manquantes} photo${manquantes > 1 ? "s" : ""} non envoyée${manquantes > 1 ? "s" : ""} : ajoute-les depuis le dossier.`
            : undefined,
      });
      onCree(id);
    } catch (probleme) {
      toast.error("Ouverture du dossier impossible", { description: messageErreur(probleme) });
    } finally {
      setEnvoi(null);
    }
  }

  const formulaireVisible = mode === "direct" || origine !== null;
  const onglets = (
    <div
      role="tablist"
      aria-label="Origine du dossier"
      className="mb-4 flex w-full flex-wrap items-center rounded-[9px] border-[0.5px] border-[#2A2D34] bg-[#16181D] p-[3px] sm:w-fit"
    >
      {(
        [
          { valeur: "lead", libelle: "Client ou lead existant" },
          { valeur: "direct", libelle: "Création directe" },
          { valeur: "reprise", libelle: "Reprise d'un dossier en cours" },
        ] as const
      ).map(({ valeur, libelle }) => (
        <button
          key={valeur}
          type="button"
          role="tab"
          aria-selected={mode === valeur}
          onClick={() => changerMode(valeur)}
          className={cn(
            "h-9 flex-1 rounded-[7px] px-3.5 text-[13px] font-medium whitespace-nowrap sm:h-7 sm:flex-none",
            mode === valeur ? "bg-[#272B33] text-[#F2F3F5]" : "text-[#9CA3AF] hover:text-[#F2F3F5]",
            TRANS
          )}
        >
          {libelle}
        </button>
      ))}
    </div>
  );
  if (mode === "reprise") return <RepriseDossier ouverte={ouverte} onglets={onglets} onFermer={onFermer} onCree={onCree} />;
  const avertissements = avertissementsCoordonnees(champs);
  const manques = [...manquesCoordonnees(champs), ...(photos.length === 0 ? ["photos"] : [])];
  const etapeAvancee = estEtapeActive(champs.etape) && rangEtape(champs.etape) >= rangEtape("PLANIFIE");

  return (
    <Modale
      ouverte={ouverte}
      onFermer={() => (envoi ? undefined : onFermer())}
      titre="Ouvrir un dossier"
      description="Seul le nom du client est obligatoire : ce qui manque sera signalé sur le dossier, à compléter quand tu l'as."
      pied={
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Bouton variante="fantome" onClick={onFermer} disabled={envoi !== null}>
            Annuler
          </Bouton>
          {formulaireVisible ? (
            <Bouton variante="primaire" chargement={envoi !== null} onClick={() => void ouvrir()}>
              {envoi ?? "Ouvrir le dossier"}
            </Bouton>
          ) : null}
        </div>
      }
    >
      {onglets}

      {mode === "lead" && origine === null ? (
        <div>
          <label className="relative block">
            <span className="sr-only">Rechercher un client, un lead ou un prospect</span>
            <Search size={14} aria-hidden className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[#6B7280]" />
            <input
              type="search"
              autoFocus
              value={recherche}
              onChange={(evenement) => setRecherche(evenement.target.value)}
              placeholder="Nom, téléphone, e-mail, ville…"
              className={cn(CLASSE_SAISIE, "h-10 pl-8 sm:h-9")}
            />
            {rechercheEnCours ? (
              <Loader2 size={14} aria-hidden className="absolute top-1/2 right-3 -translate-y-1/2 animate-spin text-[#6B7280]" />
            ) : null}
          </label>
          {resultats === null ? null : resultats.length === 0 ? (
            <p className="mt-4 text-[13px] text-[#9CA3AF]">
              Aucun client ni lead trouvé.{" "}
              <button type="button" onClick={() => changerMode("direct")} className="text-[#5DCAA5] underline-offset-2 hover:underline">
                Créer le dossier directement
              </button>
            </p>
          ) : (
            <ul className="mt-3 overflow-hidden rounded-[11px] border-[0.5px] border-[#2A2D34]">
              {resultats.map((resultat) => (
                <li key={`${resultat.origine}-${resultat.id}`} className="border-t-[0.5px] border-[#2A2D34] first:border-t-0">
                  <button
                    type="button"
                    onClick={() => choisirLead(resultat)}
                    className={cn("flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left hover:bg-[#22262D]", TRANS)}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] font-medium text-[#F2F3F5]">{resultat.libelle}</span>
                      <span className="block truncate text-[12px] text-[#6B7280]">{resultat.detail}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-1.5">
                      {resultat.nbDossiers > 0 ? (
                        <span className="rounded-full bg-[#EF9F27]/10 px-2 py-px text-[11px] text-[#EF9F27]">
                          {resultat.nbDossiers} dossier{resultat.nbDossiers > 1 ? "s" : ""}
                        </span>
                      ) : null}
                      <span className="rounded-full border-[0.5px] border-[#2A2D34] px-2 py-px text-[11px] text-[#9CA3AF]">
                        {LIBELLES_ORIGINE[resultat.origine]}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      {formulaireVisible ? (
        <div className="space-y-4">
          {origine ? (
            <div className="flex items-center justify-between gap-3 rounded-[9px] border-[0.5px] border-[#1D9E75]/30 bg-[#112B22]/60 px-3 py-2">
              <p className="min-w-0 truncate text-[13px] text-[#D1FAE5]">
                {LIBELLES_ORIGINE[origine.origine]} : <span className="font-medium">{origine.libelle}</span>
                {origine.nbDossiers > 0 ? (
                  <span className="text-[#EF9F27]"> · déjà {origine.nbDossiers} dossier{origine.nbDossiers > 1 ? "s" : ""}</span>
                ) : null}
              </p>
              <Bouton variante="fantome" taille="sm" onClick={() => setOrigine(null)}>
                Changer
              </Bouton>
            </div>
          ) : null}

          {origine ? null : (
            <TypeClientDossier
              valeur={typeClient}
              onChange={setTypeClient}
              onEntreprise={remplirDepuisAnnuaire}
              onSousTraitance={(coche) => setChamps((actuels) => ({ ...actuels, source: sourceSelonSousTraitance(actuels.source, coche) as SourceDossier | "" }))}
              champNom={
                <Champ
                  libelle={estEntreprise(typeClient) ? "Raison sociale" : "Nom du client"}
                  obligatoire
                  autoComplete={estEntreprise(typeClient) ? "organization" : undefined}
                  value={champs.clientNom}
                  onChange={modifier("clientNom")}
                  erreur={erreurs.clientNom}
                />
              }
            />
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            {origine ? (
              <Champ libelle="Nom du client" obligatoire value={champs.clientNom} onChange={modifier("clientNom")} erreur={erreurs.clientNom} classeConteneur="sm:col-span-2" />
            ) : null}
            <Champ libelle="Téléphone" type="tel" inputMode="tel" value={champs.clientTelephone} onChange={modifier("clientTelephone")} erreur={erreurs.clientTelephone} aide={avertissements.clientTelephone} />
            <Champ libelle="E-mail" type="email" inputMode="email" value={champs.clientEmail} onChange={modifier("clientEmail")} erreur={erreurs.clientEmail} />
            <Champ
              libelle="Adresse du chantier"
              value={champs.clientAdresse}
              onChange={modifier("clientAdresse")}
              erreur={erreurs.clientAdresse}
              aide={adresseAnnuaire ? "Adresse de l'établissement, reprise de l'annuaire : corrige-la si le chantier est ailleurs." : undefined}
              classeConteneur="sm:col-span-2"
            />
            <Champ libelle="Code postal" inputMode="numeric" maxLength={10} value={champs.clientCp} onChange={modifier("clientCp")} erreur={erreurs.clientCp} aide={avertissements.clientCp} />
            <Champ libelle="Ville" value={champs.clientVille} onChange={modifier("clientVille")} erreur={erreurs.clientVille} />
            <Champ libelle="Objet du chantier" placeholder="Ex. Façades de cuisine et portes de dressing" value={champs.objet} onChange={modifier("objet")} erreur={erreurs.objet} classeConteneur="sm:col-span-2" />
            <ListeDeroulante
              libelle="Étape actuelle"
              options={ETAPES.map((etape) => ({ valeur: etape, libelle: LIBELLES_ETAPE[etape] }))}
              value={champs.etape}
              onChange={(evenement) => setChamps((actuels) => ({ ...actuels, etape: evenement.target.value as EtapeDossier }))}
              aide={champs.etape === "QUALIFICATION" ? "Un chantier déjà avancé s'ouvre à son étape." : undefined}
            />
            {etapeAvancee ? (
              <Champ libelle="Date du chantier" type="date" value={champs.dateChantier} onChange={modifier("dateChantier")} />
            ) : null}
            <ListeDeroulante
              libelle="Source"
              options={[
                { valeur: "", libelle: "Non renseignée" },
                ...SOURCES_DOSSIER.filter((source) => source !== "INCONNUE").map((source) => ({ valeur: source, libelle: LIBELLES_SOURCE[source] })),
              ]}
              value={champs.source}
              onChange={(evenement) => {
                const source = evenement.target.value as SourceDossier | "";
                setChamps((actuels) => ({ ...actuels, source }));
                if (!origine) setTypeClient((actuel) => typeSelonSource(actuel, source));
                setErreurs((actuelles) => ({ ...actuelles, source: undefined }));
              }}
              erreur={erreurs.source}
            />
            <Champ libelle="Montant estimé (€)" inputMode="decimal" placeholder="Ex. 2 500" value={champs.montantEstime} onChange={modifier("montantEstime")} erreur={erreurs.montantEstime} />
            <Champ libelle="Prochaine action" placeholder="Ex. Préparer la simulation" maxLength={140} value={champs.prochaineAction} onChange={modifier("prochaineAction")} />
            <Champ libelle="Date de la prochaine action" type="date" value={champs.prochaineActionDate} onChange={modifier("prochaineActionDate")} />
          </div>

          <div>
            <p className="mb-1.5 text-[12px] font-medium text-[#9CA3AF]">Photos du chantier</p>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
              {photos.map((photo) => (
                <div key={photo.cle} className="relative aspect-square overflow-hidden rounded-[9px] border-[0.5px] border-[#2A2D34] bg-[#1C1F25]">
                  <span className="absolute inset-0 flex flex-col items-center justify-center gap-1 p-1 text-[#6B7280]">
                    <ImageIcon size={16} aria-hidden />
                    <span className="w-full truncate text-center text-[10px]">{photo.fichier.name}</span>
                  </span>
                  {/* Aperçu local (blob:) : next/image n'apporte rien ici. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={photo.apercu}
                    alt=""
                    className="relative h-full w-full object-cover"
                    onError={(evenement) => {
                      evenement.currentTarget.style.visibility = "hidden";
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => retirerPhoto(photo.cle)}
                    aria-label="Retirer la photo"
                    className="absolute top-1 right-1 flex h-8 w-8 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80 sm:h-6 sm:w-6"
                  >
                    <X size={13} aria-hidden />
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => entreePhotos.current?.click()}
                className={cn(
                  "flex aspect-square flex-col items-center justify-center gap-1 rounded-[9px] border-[0.5px] border-dashed border-[#3A3E47] text-[12px] text-[#9CA3AF] hover:border-[#3A3E47] hover:text-[#F2F3F5]",
                  TRANS
                )}
              >
                <Camera size={18} aria-hidden />
                Ajouter
              </button>
            </div>
            <input
              ref={entreePhotos}
              type="file"
              accept="image/*"
              multiple
              className="sr-only"
              aria-label="Choisir des photos du chantier"
              onChange={(evenement) => ajouterPhotos(evenement.target.files)}
            />
            <p className="mt-1 text-[12px] text-[#6B7280]">Facultatives, réduites avant l&apos;envoi. Ajoutables ensuite depuis le dossier.</p>
          </div>

          {manques.length > 0 ? (
            <p className="rounded-[8px] bg-[#22262D] px-3 py-2 text-[12px] text-[#9CA3AF]">
              Sera signalé à compléter sur le dossier : {manques.join(", ")}.
            </p>
          ) : null}
        </div>
      ) : null}
    </Modale>
  );
}
