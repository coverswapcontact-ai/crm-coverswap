"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Search } from "lucide-react";
import { toast } from "sonner";
import { LIBELLES_SOURCE, SOURCES_DOSSIER, type SourceDossier } from "@/lib/dossiers/constants";
import { jourParis } from "@/lib/dossiers/dates";
import { formatQuantite, lireNombre } from "@/lib/dossiers/montants";
import type { ClientResume } from "@/lib/clients/types";
import type { DossierDetail } from "@/lib/dossiers/types";
import { cn } from "@/lib/utils";
import { appelApi, envoyerJson, messageErreur } from "./client";
import { Bouton, Champ, CLASSE_SAISIE, ListeDeroulante, Modale, TitreSection, TRANS } from "./ui";
import { avertissementsCoordonnees, validerCoordonnees, type ChampsCoordonnees, type ErreursCoordonnees } from "./validation";

type Saisie = ChampsCoordonnees & { dateChantier: string; dateSouhaitee: string; dateFinChantier: string };

function saisieDepuis(detail: DossierDetail): Saisie {
  return {
    clientNom: detail.clientNom,
    clientTelephone: detail.clientTelephone,
    clientEmail: detail.clientEmail ?? "",
    clientAdresse: detail.clientAdresse,
    clientCp: detail.clientCp,
    clientVille: detail.clientVille,
    objet: detail.objet,
    source: detail.source === "INCONNUE" ? "" : detail.source,
    montantEstime: detail.montantEstime === null ? "" : formatQuantite(detail.montantEstime),
    dateChantier: detail.dateChantier ? jourParis(detail.dateChantier) : "",
    dateSouhaitee: detail.dateSouhaitee ? jourParis(detail.dateSouhaitee) : "",
    dateFinChantier: detail.dateFinChantier ? jourParis(detail.dateFinChantier) : "",
  };
}

/** Choix de la fiche client rattachée au dossier : ses pièces et paiements la suivent. */
function ChoixFicheClient({ detail, onFermer, onMisAJour }: { detail: DossierDetail; onFermer: () => void; onMisAJour: (detail: DossierDetail) => void }) {
  const [recherche, setRecherche] = useState(detail.clientNom);
  const [resultats, setResultats] = useState<ClientResume[] | null>(null);
  const [envoi, setEnvoi] = useState<string | null>(null);

  useEffect(() => {
    if (recherche.trim().length < 2) return;
    let actif = true;
    const minuterie = window.setTimeout(() => {
      appelApi<{ clients: ClientResume[] }>(`/api/clients?recherche=${encodeURIComponent(recherche.trim())}&limite=12`)
        .then((reponse) => actif && setResultats(reponse.clients))
        .catch((probleme: unknown) => actif && toast.error("Recherche impossible", { description: messageErreur(probleme) }));
    }, 250);
    return () => {
      actif = false;
      window.clearTimeout(minuterie);
    };
  }, [recherche]);

  async function rattacher(client: ClientResume) {
    setEnvoi(client.id);
    try {
      onMisAJour(await envoyerJson<DossierDetail>(`/api/dossiers/${detail.id}`, "PATCH", { clientId: client.id }));
      toast.success("Fiche client rattachée", { description: "Les devis, factures et paiements du dossier la suivent." });
      onFermer();
    } catch (probleme) {
      toast.error("Rattachement impossible", { description: messageErreur(probleme) });
    } finally {
      setEnvoi(null);
    }
  }

  return (
    <Modale ouverte onFermer={onFermer} largeur="sm" titre="Rattacher une autre fiche client" description="Le changement est tracé ; l'ancienne fiche reste dans le journal.">
      <label className="relative block">
        <span className="sr-only">Rechercher un client</span>
        <Search size={14} aria-hidden className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[#6B7280]" />
        <input
          type="search"
          autoFocus
          value={recherche}
          onChange={(evenement) => setRecherche(evenement.target.value)}
          placeholder="Nom, téléphone, e-mail, ville…"
          className={cn(CLASSE_SAISIE, "h-10 pl-8 sm:h-9")}
        />
      </label>
      {resultats === null ? null : resultats.length === 0 ? (
        <p className="mt-3 text-[13px] text-[#9CA3AF]">
          Aucune fiche trouvée.{" "}
          <Link href="/clients" className="text-[#5DCAA5] underline-offset-2 hover:underline">
            Créer la fiche dans Clients
          </Link>
        </p>
      ) : (
        <ul className="mt-3 overflow-hidden rounded-[11px] border-[0.5px] border-[#2A2D34]">
          {resultats.map((client) => (
            <li key={client.id} className="border-t-[0.5px] border-[#2A2D34] first:border-t-0">
              <button
                type="button"
                disabled={envoi !== null || client.id === detail.client?.id}
                onClick={() => void rattacher(client)}
                className={cn("flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left hover:bg-[#22262D] disabled:opacity-60", TRANS)}
              >
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-medium text-[#F2F3F5]">{client.nom}</span>
                  <span className="block truncate text-[12px] text-[#6B7280]">
                    {[client.ville, client.telephone ?? client.email, `${client.nbDossiers} dossier${client.nbDossiers > 1 ? "s" : ""}`].filter(Boolean).join(" · ")}
                  </span>
                </span>
                <span className="shrink-0 text-[12px] text-[#9CA3AF]">{client.id === detail.client?.id ? "Actuelle" : envoi === client.id ? "…" : "Rattacher"}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Modale>
  );
}

/** Client, chantier et informations du dossier : tout se modifie, seul le nom est exigé. */
export function CoordonneesClient({
  detail,
  onMisAJour,
}: {
  detail: DossierDetail;
  onMisAJour: (detail: DossierDetail) => void;
}) {
  const initiale = saisieDepuis(detail);
  const [saisie, setSaisie] = useState<Saisie>(initiale);
  const [erreurs, setErreurs] = useState<ErreursCoordonnees>({});
  const [envoi, setEnvoi] = useState(false);
  const [choixFiche, setChoixFiche] = useState(false);
  const modifiee = (Object.keys(initiale) as (keyof Saisie)[]).some((cle) => saisie[cle] !== initiale[cle]);
  const avertissements = avertissementsCoordonnees(saisie);

  const champ = (cle: keyof Saisie) => ({
    value: saisie[cle],
    onChange: (evenement: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setSaisie((actuelle) => ({ ...actuelle, [cle]: evenement.target.value })),
    erreur: erreurs[cle as keyof ErreursCoordonnees],
    aide: avertissements[cle as keyof ErreursCoordonnees],
  });

  async function enregistrer(evenement: React.FormEvent) {
    evenement.preventDefault();
    const trouvees = validerCoordonnees(saisie);
    setErreurs(trouvees);
    if (Object.keys(trouvees).length > 0) return;
    setEnvoi(true);
    try {
      const nouveau = await envoyerJson<DossierDetail>(`/api/dossiers/${detail.id}`, "PATCH", {
        clientNom: saisie.clientNom,
        clientTelephone: saisie.clientTelephone,
        clientEmail: saisie.clientEmail || null,
        clientAdresse: saisie.clientAdresse,
        clientCp: saisie.clientCp,
        clientVille: saisie.clientVille,
        objet: saisie.objet,
        source: saisie.source || null,
        montantEstime: saisie.montantEstime.trim() ? lireNombre(saisie.montantEstime) : null,
        ...(saisie.dateChantier !== initiale.dateChantier ? { dateChantier: saisie.dateChantier || null } : {}),
        ...(saisie.dateSouhaitee !== initiale.dateSouhaitee ? { dateSouhaitee: saisie.dateSouhaitee || null } : {}),
        ...(saisie.dateFinChantier !== initiale.dateFinChantier ? { dateFinChantier: saisie.dateFinChantier || null } : {}),
      });
      onMisAJour(nouveau);
      toast.success("Dossier enregistré");
    } catch (probleme) {
      toast.error("Modifications non enregistrées", { description: messageErreur(probleme) });
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <section>
      <TitreSection>Client et chantier</TitreSection>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-[9px] border-[0.5px] border-[#2A2D34] bg-[#1C1F25] px-3 py-2">
        <p className="min-w-0 text-[13px] text-[#9CA3AF]">
          Fiche client :{" "}
          {detail.client ? (
            <Link href={`/clients/${detail.client.id}`} className={cn("inline-flex items-center gap-0.5 font-medium text-[#F2F3F5] hover:text-[#5DCAA5]", TRANS)}>
              {detail.client.nom}
              <ArrowUpRight size={12} aria-hidden />
            </Link>
          ) : (
            <span className="text-[#F5B454]">aucune</span>
          )}
        </p>
        <Bouton taille="sm" variante="fantome" onClick={() => setChoixFiche(true)}>
          {detail.client ? "Changer" : "Rattacher"}
        </Bouton>
      </div>
      <form onSubmit={enregistrer} noValidate className="grid gap-3 sm:grid-cols-2">
        <Champ libelle="Nom du client" obligatoire autoComplete="off" {...champ("clientNom")} classeConteneur="sm:col-span-2" />
        <Champ libelle="Téléphone" type="tel" inputMode="tel" {...champ("clientTelephone")} />
        <Champ libelle="E-mail" type="email" inputMode="email" {...champ("clientEmail")} />
        <Champ libelle="Adresse du chantier" {...champ("clientAdresse")} classeConteneur="sm:col-span-2" />
        <Champ libelle="Code postal" inputMode="numeric" maxLength={10} {...champ("clientCp")} />
        <Champ libelle="Ville" {...champ("clientVille")} />
        <Champ libelle="Objet du chantier" {...champ("objet")} classeConteneur="sm:col-span-2" />
        <ListeDeroulante
          libelle="Source"
          options={[
            { valeur: "", libelle: "Non renseignée" },
            ...SOURCES_DOSSIER.filter((source) => source !== "INCONNUE").map((source) => ({ valeur: source, libelle: LIBELLES_SOURCE[source] })),
          ]}
          value={saisie.source}
          onChange={(evenement) => setSaisie((actuelle) => ({ ...actuelle, source: evenement.target.value as SourceDossier | "" }))}
        />
        <Champ libelle="Montant estimé (€)" inputMode="decimal" placeholder="Ex. 2 500" {...champ("montantEstime")} />
        <Champ libelle="Date du chantier" type="date" {...champ("dateChantier")} />
        <Champ libelle="Date souhaitée par le client" type="date" {...champ("dateSouhaitee")} />
        <Champ libelle="Fin du chantier" type="date" {...champ("dateFinChantier")} />
        <div className="flex items-end justify-end sm:col-span-2">
          <Bouton type="submit" variante={modifiee ? "primaire" : "secondaire"} disabled={!modifiee} chargement={envoi}>
            Enregistrer
          </Bouton>
        </div>
      </form>
      {choixFiche ? <ChoixFicheClient detail={detail} onFermer={() => setChoixFiche(false)} onMisAJour={onMisAJour} /> : null}
    </section>
  );
}
