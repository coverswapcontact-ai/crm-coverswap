"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, EyeOff, X } from "lucide-react";
import { toast } from "sonner";
import { appelApi, messageErreur } from "@/components/pilotage/client";
import { Bouton, Champ, EnTetePage, EtatVide, ListeDeroulante, Pastille, TRANS } from "@/components/pilotage/ui";
import { formatHorodatage } from "@/lib/dossiers/dates";
import { FAMILLES_ACTEUR, LIBELLES_MODELE, LIBELLES_OPERATION, type LigneJournalVue, type OperationJournal, type PageJournal } from "@/lib/journal/libelles";
import { cn } from "@/lib/utils";

type Cible = { dossierId: string | null; clientId: string | null; modele: string | null; id: string | null };

const TONS_OPERATION: Record<string, "neutre" | "vert" | "ambre" | "bleu"> = {
  CREATION: "vert",
  ETAT_INITIAL: "neutre",
  MODIFICATION: "bleu",
  ARCHIVAGE: "ambre",
  RESTAURATION: "vert",
};

function LigneJournal({ ligne }: { ligne: LigneJournalVue }) {
  const [tout, setTout] = useState(false);
  const visibles = tout ? ligne.changements : ligne.changements.slice(0, 4);
  return (
    <li className="rounded-[11px] border-[0.5px] border-[#2A2D34] bg-[#1C1F25] px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-[#9CA3AF]">
        <Pastille ton={TONS_OPERATION[ligne.operation] ?? "neutre"}>{LIBELLES_OPERATION[ligne.operation as OperationJournal] ?? ligne.operation}</Pastille>
        <span className="font-medium text-[#F2F3F5]">{ligne.libelleModele}</span>
        {ligne.lien ? (
          <Link href={ligne.lien} className={cn("inline-flex items-center gap-0.5 text-[#9CA3AF] hover:text-[#F2F3F5]", TRANS)}>
            ouvrir <ArrowUpRight size={11} aria-hidden />
          </Link>
        ) : null}
        {ligne.caviarde ? (
          <Pastille titre="Données personnelles retirées de cette copie (RGPD)">
            <EyeOff size={11} aria-hidden /> Caviardé
          </Pastille>
        ) : null}
        <span className="ml-auto tabular-nums">{formatHorodatage(ligne.horodatage)}</span>
      </div>
      <p className="mt-1 text-[12px] text-[#6B7280]">
        {ligne.libelleActeur}
        {ligne.origine ? ` · ${ligne.origine}` : ""}
      </p>
      {visibles.length > 0 ? (
        <dl className="mt-2 grid gap-x-3 gap-y-1 text-[12.5px] sm:grid-cols-[minmax(0,10rem)_1fr]">
          {visibles.map((changement) => (
            <div key={changement.champ} className="contents">
              <dt className="truncate text-[#9CA3AF]">{changement.champ}</dt>
              <dd className="min-w-0 break-words text-[#D1D5DB]">
                {changement.avant !== null || ligne.operation === "MODIFICATION" ? (
                  <>
                    <span className="text-[#6B7280] line-through decoration-[#6B7280]/50">{changement.avant ?? "—"}</span>
                    <span aria-hidden className="px-1 text-[#6B7280]">→</span>
                  </>
                ) : null}
                {changement.apres ?? "—"}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      {ligne.changements.length > 4 && !tout ? (
        <Bouton variante="fantome" taille="sm" className="mt-1" onClick={() => setTout(true)}>
          {ligne.changements.length - 4} champ{ligne.changements.length - 4 > 1 ? "s" : ""} de plus
        </Bouton>
      ) : null}
    </li>
  );
}

/** Le journal des modifications : lecture seule, filtrable, par dossier, fiche ou enregistrement. */
export default function EcranJournal({ cibleInitiale }: { cibleInitiale: Cible }) {
  const [cible, setCible] = useState<Cible>(cibleInitiale);
  const [famille, setFamille] = useState("");
  const [modele, setModele] = useState(cibleInitiale.modele ?? "");
  const [du, setDu] = useState("");
  const [au, setAu] = useState("");
  const [page, setPage] = useState<PageJournal | null>(null);
  const [suiteEnCours, setSuiteEnCours] = useState(false);

  const requete = useMemo(() => {
    const parametres = new URLSearchParams();
    if (cible.dossierId) parametres.set("dossierId", cible.dossierId);
    if (cible.clientId) parametres.set("clientId", cible.clientId);
    if (cible.id) parametres.set("id", cible.id);
    if (modele) parametres.set("modele", modele);
    if (famille) parametres.set("famille", famille);
    if (du) parametres.set("du", du);
    if (au) parametres.set("au", au);
    return parametres.toString();
  }, [cible, modele, famille, du, au]);

  useEffect(() => {
    let actif = true;
    appelApi<PageJournal>(`/api/journal?${requete}`)
      .then((lue) => actif && setPage(lue))
      .catch((erreur) => toast.error("Journal illisible", { description: messageErreur(erreur) }));
    return () => {
      actif = false;
    };
  }, [requete]);

  async function plus() {
    if (!page?.suite) return;
    setSuiteEnCours(true);
    try {
      const suivante = await appelApi<PageJournal>(`/api/journal?${requete}&suite=${encodeURIComponent(page.suite)}`);
      setPage({ lignes: [...page.lignes, ...suivante.lignes], suite: suivante.suite });
    } catch (erreur) {
      toast.error("Suite illisible", { description: messageErreur(erreur) });
    } finally {
      setSuiteEnCours(false);
    }
  }

  const libelleCible = cible.dossierId ? "ce dossier et ce qui s'y rattache" : cible.clientId ? "cette fiche client et ce qui s'y rattache" : cible.id ? "cet enregistrement" : null;

  return (
    <div className="mx-auto w-full max-w-4xl px-5 py-6 md:px-8 md:py-8">
      <EnTetePage titre="Journal" sousTitre="Toutes les écritures, par qui, quand et d'où. Rien ne s'y modifie ; une copie peut seulement être caviardée (RGPD)." />

      {libelleCible ? (
        <p className="mt-4 flex flex-wrap items-center gap-2 text-[13px] text-[#9CA3AF]">
          Limité à {libelleCible}.
          <Bouton variante="fantome" taille="sm" icone={<X size={12} aria-hidden />} onClick={() => setCible({ dossierId: null, clientId: null, modele: null, id: null })}>
            Tout le journal
          </Bouton>
        </p>
      ) : null}

      <div className="mt-4 grid gap-3 sm:grid-cols-4">
        <ListeDeroulante libelle="Auteur" value={famille} onChange={(evenement) => setFamille(evenement.target.value)} options={[{ valeur: "", libelle: "Tous" }, ...FAMILLES_ACTEUR]} />
        <ListeDeroulante
          libelle="Type"
          value={modele}
          onChange={(evenement) => setModele(evenement.target.value)}
          options={[{ valeur: "", libelle: "Tous" }, ...Object.entries(LIBELLES_MODELE).map(([valeur, libelle]) => ({ valeur, libelle })).sort((a, b) => a.libelle.localeCompare(b.libelle, "fr"))]}
        />
        <Champ libelle="Du" type="date" value={du} onChange={(evenement) => setDu(evenement.target.value)} />
        <Champ libelle="Au" type="date" value={au} onChange={(evenement) => setAu(evenement.target.value)} />
      </div>

      <section className="mt-5">
        {page === null ? (
          <p className="text-[13px] text-[#6B7280]">Lecture du journal…</p>
        ) : page.lignes.length === 0 ? (
          <EtatVide titre="Aucune écriture pour ces filtres" />
        ) : (
          <>
            <ul className="flex flex-col gap-2">
              {page.lignes.map((ligne) => (
                <LigneJournal key={ligne.id} ligne={ligne} />
              ))}
            </ul>
            {page.suite ? (
              <div className="mt-3 flex justify-center">
                <Bouton chargement={suiteEnCours} onClick={() => void plus()}>
                  Écritures plus anciennes
                </Bouton>
              </div>
            ) : null}
          </>
        )}
      </section>
    </div>
  );
}
