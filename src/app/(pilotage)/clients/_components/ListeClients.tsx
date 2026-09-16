"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Copy, Search, UserPlus, Users } from "lucide-react";
import { toast } from "sonner";
import { appelApi, envoyerJson, messageErreur } from "@/components/pilotage/client";
import { rafraichirCompteurs } from "@/components/pilotage/Navigation";
import { Bouton, EnTetePage, EtatVide, ListeDeroulante, Pastille, TRANS, TitreSection } from "@/components/pilotage/ui";
import {
  FAMILLES_SOURCE,
  LIBELLES_CATEGORIE_CLIENT,
  LIBELLES_FAMILLE_SOURCE,
  LIBELLES_SOURCE_CLIENT,
  SOURCES_CLIENT,
  type CategorieClient,
  type FamilleSource,
} from "@/lib/clients/constantes";
import { formaterTelephone } from "@/lib/clients/normalisation";
import type { ClientResume, LigneAcquisition } from "@/lib/clients/types";
import { formatDateCourte } from "@/lib/dossiers/dates";
import { formatMontant } from "@/lib/dossiers/montants";
import { cn } from "@/lib/utils";
import { CreationClient } from "./CreationClient";

const FILTRES_CATEGORIE: { valeur: CategorieClient | null; libelle: string }[] = [
  { valeur: null, libelle: "Tous" },
  { valeur: "PARTICULIER", libelle: "Particuliers" },
  { valeur: "PROFESSIONNEL", libelle: "Pros" },
  { valeur: "DONNEUR_ORDRE", libelle: "Donneurs d'ordre" },
];

function Acquisition({ lignes }: { lignes: LigneAcquisition[] }) {
  const [detail, setDetail] = useState(false);
  const familles = (Object.keys(FAMILLES_SOURCE) as FamilleSource[])
    .map((famille) => {
      const concernees = lignes.filter((ligne) => ligne.famille === famille);
      return {
        famille,
        clients: concernees.reduce((somme, ligne) => somme + ligne.clients, 0),
        clientsSignes: concernees.reduce((somme, ligne) => somme + ligne.clientsSignes, 0),
        montantSigne: concernees.reduce((somme, ligne) => somme + ligne.montantSigne, 0),
        sources: concernees,
      };
    })
    .filter((famille) => famille.clients > 0)
    .sort((a, b) => b.montantSigne - a.montantSigne || b.clients - a.clients);
  const totalSigne = familles.reduce((somme, famille) => somme + famille.montantSigne, 0);
  if (familles.length === 0) return null;

  return (
    <section className="mt-6 rounded-[11px] border-[0.5px] border-[#2A2D34] bg-[#1C1F25] p-4">
      <TitreSection
        action={
          <button
            type="button"
            onClick={() => setDetail((ouvert) => !ouvert)}
            className={cn("min-h-8 text-[12px] text-[#9CA3AF] hover:text-[#F2F3F5]", TRANS)}
          >
            {detail ? "Par famille" : "Détail par source"}
          </button>
        }
      >
        D&apos;où viennent les clients
      </TitreSection>
      <ul className="flex flex-col gap-2.5">
        {familles.map((famille) => {
          const part = totalSigne > 0 ? famille.montantSigne / totalSigne : 0;
          return (
            <li key={famille.famille}>
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                <span className="text-[13px] text-[#F2F3F5]">{LIBELLES_FAMILLE_SOURCE[famille.famille]}</span>
                <span className="text-[12px] text-[#9CA3AF] tabular-nums">
                  {famille.clients} client{famille.clients > 1 ? "s" : ""} · {famille.clientsSignes} signé
                  {famille.clientsSignes > 1 ? "s" : ""} ·{" "}
                  <span className="font-medium text-[#F2F3F5]">{formatMontant(famille.montantSigne)}</span>
                </span>
              </div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[#22262D]" aria-hidden>
                <div className="h-full rounded-full bg-[#1D9E75]" style={{ width: `${Math.round(part * 100)}%` }} />
              </div>
              {detail ? (
                <ul className="mt-1.5 flex flex-col gap-0.5 pl-3">
                  {famille.sources.map((ligne) => (
                    <li key={ligne.source} className="flex justify-between gap-3 text-[12px] text-[#9CA3AF] tabular-nums">
                      <span>{LIBELLES_SOURCE_CLIENT[ligne.source]}</span>
                      <span>
                        {ligne.clients} · {ligne.clientsSignes} signé{ligne.clientsSignes > 1 ? "s" : ""} · {formatMontant(ligne.montantSigne)}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ul>
      <p className="mt-3 text-[11.5px] text-[#6B7280]">
        Montant signé : devis acceptés. Les encaissements réels sont dans Finances.
      </p>
    </section>
  );
}

export default function ListeClients({
  initiaux,
  acquisition,
}: {
  initiaux: ClientResume[];
  acquisition: LigneAcquisition[];
}) {
  const router = useRouter();
  const [clients, setClients] = useState(initiaux);
  const [recherche, setRecherche] = useState("");
  const [categorie, setCategorie] = useState<CategorieClient | null>(null);
  const [source, setSource] = useState("");
  const [archives, setArchives] = useState(false);
  const [chargement, setChargement] = useState(false);
  const [creation, setCreation] = useState(false);
  const [rechercheDoublons, setRechercheDoublons] = useState(false);

  const filtresActifs = recherche.trim() !== "" || categorie !== null || source !== "" || archives;

  useEffect(() => {
    if (!filtresActifs) return;
    let actif = true;
    const minuterie = window.setTimeout(() => {
      setChargement(true);
      const parametres = new URLSearchParams();
      if (recherche.trim()) parametres.set("recherche", recherche.trim());
      if (categorie) parametres.set("categorie", categorie);
      if (source) parametres.set("source", source);
      if (archives) parametres.set("archives", "1");
      appelApi<{ clients: ClientResume[] }>(`/api/clients?${parametres}`)
        .then(({ clients: lus }) => {
          if (actif) setClients(lus);
        })
        .catch((erreur) => toast.error("Recherche impossible", { description: messageErreur(erreur) }))
        .finally(() => {
          if (actif) setChargement(false);
        });
    }, 250);
    return () => {
      actif = false;
      window.clearTimeout(minuterie);
    };
  }, [recherche, categorie, source, archives, filtresActifs]);

  const affiches = filtresActifs ? clients : initiaux;
  const signes = useMemo(() => initiaux.filter((client) => client.montantSigne > 0).length, [initiaux]);

  async function chercherDoublons() {
    setRechercheDoublons(true);
    try {
      const { nouvelles } = await envoyerJson<{ nouvelles: number }>("/api/clients/doublons", "POST");
      if (nouvelles > 0) {
        toast.success(`${nouvelles} doublon${nouvelles > 1 ? "s" : ""} possible${nouvelles > 1 ? "s" : ""} à examiner`, {
          description: "Rien n'est fusionné sans ta validation.",
          action: { label: "Voir", onClick: () => router.push("/validation") },
        });
        rafraichirCompteurs();
      } else {
        toast("Aucun nouveau doublon", { description: "Les paires déjà proposées ou rejetées ne reviennent pas." });
      }
    } catch (erreur) {
      toast.error("Recherche impossible", { description: messageErreur(erreur) });
    } finally {
      setRechercheDoublons(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-5 py-6 md:px-8 md:py-8">
      <EnTetePage
        titre="Clients"
        sousTitre={`${initiaux.length} client${initiaux.length > 1 ? "s" : ""} · ${signes} avec un devis signé`}
        actions={
          <>
            <Bouton icone={<Copy size={14} aria-hidden />} chargement={rechercheDoublons} onClick={() => void chercherDoublons()}>
              Chercher les doublons
            </Bouton>
            <Bouton variante="primaire" icone={<UserPlus size={15} aria-hidden />} onClick={() => setCreation(true)}>
              Nouveau client
            </Bouton>
          </>
        }
      />

      <Acquisition lignes={acquisition} />

      <div className="mt-6 flex flex-wrap items-center gap-2">
        <label className="relative min-w-[200px] flex-1">
          <span className="sr-only">Rechercher un client</span>
          <Search size={14} aria-hidden className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[#6B7280]" />
          <input
            type="search"
            value={recherche}
            onChange={(evenement) => setRecherche(evenement.target.value)}
            placeholder="Nom, ville, e-mail, téléphone…"
            className={cn(
              "h-10 w-full rounded-[8px] border-[0.5px] border-[#2A2D34] bg-[#1C1F25] pr-3 pl-8 text-[16px] text-[#F2F3F5] placeholder:text-[#6B7280] sm:h-8 sm:text-[13px]",
              "hover:border-[#3A3E47] focus:border-[#1D9E75]/60 focus:outline-none",
              TRANS
            )}
          />
        </label>
        <div role="tablist" aria-label="Catégorie" className="flex max-w-full items-center overflow-x-auto rounded-[9px] border-[0.5px] border-[#2A2D34] bg-[#1C1F25] p-[3px]">
          {FILTRES_CATEGORIE.map((filtre) => (
            <button
              key={filtre.libelle}
              type="button"
              role="tab"
              aria-selected={categorie === filtre.valeur}
              onClick={() => setCategorie(filtre.valeur)}
              className={cn(
                "flex h-9 shrink-0 items-center rounded-[7px] px-3 text-[13px] font-medium whitespace-nowrap sm:h-7",
                categorie === filtre.valeur ? "bg-[#272B33] text-[#F2F3F5]" : "text-[#9CA3AF] hover:text-[#F2F3F5]",
                TRANS
              )}
            >
              {filtre.libelle}
            </button>
          ))}
        </div>
        <ListeDeroulante
          libelle="Source"
          classeConteneur="sr-only-libelle min-w-[180px] [&>label]:sr-only"
          value={source}
          onChange={(evenement) => setSource(evenement.target.value)}
          options={[{ valeur: "", libelle: "Toutes les sources" }, ...SOURCES_CLIENT.map((valeur) => ({ valeur, libelle: LIBELLES_SOURCE_CLIENT[valeur] }))]}
        />
        <label className="flex min-h-10 items-center gap-2 text-[13px] text-[#9CA3AF] sm:min-h-8">
          <input type="checkbox" checked={archives} onChange={(evenement) => setArchives(evenement.target.checked)} className="h-4 w-4 accent-[#1D9E75]" />
          Fiches archivées
        </label>
      </div>

      <section aria-busy={chargement} className={cn("mt-4", chargement && "opacity-60")}>
        {affiches.length === 0 ? (
          <EtatVide
            icone={<Users size={18} className="text-[#6B7280]" aria-hidden />}
            titre={filtresActifs ? "Aucun client trouvé" : "Aucun client"}
            texte={filtresActifs ? undefined : "Les clients arrivent avec les leads, les dossiers et les fiches créées ici."}
          />
        ) : (
          <ul className="overflow-hidden rounded-[11px] border-[0.5px] border-[#2A2D34] bg-[#1C1F25]">
            {affiches.map((client) => (
              <li key={client.id} className="border-t-[0.5px] border-[#2A2D34] first:border-t-0">
                <Link
                  href={`/clients/${client.id}`}
                  className={cn("flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 hover:bg-[#22262D]", TRANS)}
                >
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="truncate text-[14px] font-medium text-[#F2F3F5]">{client.nom}</span>
                      {client.categorie !== "PARTICULIER" ? <Pastille>{LIBELLES_CATEGORIE_CLIENT[client.categorie]}</Pastille> : null}
                      {client.archiveLe ? <Pastille ton="ambre">Archivée</Pastille> : null}
                    </p>
                    <p className="mt-0.5 truncate text-[12px] text-[#6B7280]">
                      {[client.ville, LIBELLES_SOURCE_CLIENT[client.source], client.telephone ? formaterTelephone(client.telephone) : client.email]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                    {client.recommandePar ? (
                      <p className="mt-0.5 truncate text-[12px] text-[#9CA3AF]">Recommandé par {client.recommandePar.nom}</p>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-0.5 text-right">
                    <span className="text-[13px] font-medium text-[#F2F3F5] tabular-nums">
                      {client.montantSigne > 0 ? formatMontant(client.montantSigne) : "—"}
                    </span>
                    <span className="text-[12px] text-[#6B7280]">
                      {client.nbDossiers} dossier{client.nbDossiers > 1 ? "s" : ""}
                      {client.nbDossiersEnCours > 0 ? ` · ${client.nbDossiersEnCours} en cours` : ""} · {formatDateCourte(client.derniereActiviteLe)}
                    </span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {creation ? <CreationClient onFermer={() => setCreation(false)} /> : null}
    </div>
  );
}
