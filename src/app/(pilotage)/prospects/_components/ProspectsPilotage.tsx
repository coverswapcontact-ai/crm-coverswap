"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FileUp, Inbox, Phone, Radar, Search, Sparkles, Star, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { appelApi, envoyerJson, messageErreur } from "@/components/pilotage/client";
import { rafraichirCompteurs } from "@/components/pilotage/Navigation";
import { Bouton, EnTetePage, EtatVide, ListeDeroulante, Modale, Pastille, TRANS } from "@/components/pilotage/ui";
import { LIBELLES_ETAPE, type EtapeDossier } from "@/lib/dossiers/constants";
import { formatDateCourte } from "@/lib/dossiers/dates";
import { formatMontant } from "@/lib/dossiers/montants";
import {
  GROUPES_DEMARCHAGE,
  GROUPES_ENTRANTS,
  LIBELLES_GROUPE_DEMARCHAGE,
  LIBELLES_GROUPE_ENTRANTS,
  LIBELLES_STATUT_LEAD,
  LIBELLES_STATUT_PROSPECT,
  LIBELLES_TYPE_ECHANGE,
  SOURCES_LEAD,
  libelleSourceLead,
  type GroupeDemarchage,
  type GroupeEntrants,
  type StatutLead,
} from "@/lib/prospects/constantes";
import type { EntrantResume, EtatAgent, ListeEntrants, ListeProspects, ProspectResume } from "@/lib/prospects/types";
import { cn } from "@/lib/utils";
import { NouveauContact } from "./NouveauContact";
import { PanneauEntrant } from "./PanneauEntrant";
import { PanneauProspect } from "./PanneauProspect";
import { PastilleIntention, PastillePriorite, PastilleScore } from "./pastilles";
import { pluriel } from "@/lib/commun/format";

type Onglet = "entrants" | "demarchage";
type EtatDemarchage = ListeProspects & { agents: EtatAgent[]; sourcingDisponible: boolean };

function Groupes<G extends string>({ groupes, libelles, compteurs, actif, onChoisir }: { groupes: readonly G[]; libelles: Record<G, string>; compteurs: Record<G, number>; actif: G; onChoisir: (groupe: G) => void }) {
  return (
    <div role="tablist" aria-label="Groupes" className="flex max-w-full items-center gap-1 overflow-x-auto pb-1">
      {groupes.map((groupe) => (
        <button
          key={groupe}
          type="button"
          role="tab"
          aria-selected={actif === groupe}
          onClick={() => onChoisir(groupe)}
          className={cn(
            "flex h-9 shrink-0 items-center gap-1.5 rounded-full border-[0.5px] px-3 text-[13px] font-medium whitespace-nowrap sm:h-8",
            actif === groupe ? "border-[#1D9E75]/60 bg-[#112B22] text-[#5DCAA5]" : "border-[#2A2D34] bg-[#1C1F25] text-[#9CA3AF] hover:text-[#F2F3F5]",
            TRANS
          )}
        >
          {libelles[groupe]}
          <span className="tabular-nums text-[12px] opacity-80">{compteurs[groupe]}</span>
        </button>
      ))}
    </div>
  );
}

function ChampRecherche({ valeur, onChange, placeholder }: { valeur: string; onChange: (valeur: string) => void; placeholder: string }) {
  return (
    <label className="relative min-w-[200px] flex-1">
      <span className="sr-only">Rechercher</span>
      <Search size={14} aria-hidden className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[#6B7280]" />
      <input
        type="search"
        value={valeur}
        onChange={(evenement) => onChange(evenement.target.value)}
        placeholder={placeholder}
        className={cn(
          "h-10 w-full rounded-[8px] border-[0.5px] border-[#2A2D34] bg-[#1C1F25] pr-3 pl-8 text-[16px] text-[#F2F3F5] placeholder:text-[#6B7280] sm:h-8 sm:text-[13px]",
          "hover:border-[#3A3E47] focus:border-[#1D9E75]/60 focus:outline-none",
          TRANS
        )}
      />
    </label>
  );
}

function LigneEntrant({ entrant, onOuvrir }: { entrant: EntrantResume; onOuvrir: () => void }) {
  const enAttente = entrant.groupe === "A_TRAITER" && entrant.joursSansNouvelle >= 2;
  return (
    <li className="border-t-[0.5px] border-[#2A2D34] first:border-t-0">
      <div className="flex items-stretch">
        <button type="button" onClick={onOuvrir} className={cn("min-w-0 flex-1 px-4 py-3 text-left hover:bg-[#22262D]", TRANS)}>
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="truncate text-[14px] font-medium text-[#F2F3F5]">{entrant.nom}</span>
            {entrant.groupe === "A_TRAITER" || entrant.groupe === "CONTACTES" ? <PastillePriorite priorite={entrant.priorite} motif={entrant.prioriteMotif} /> : null}
            <PastilleIntention intention={entrant.intention} />
            {entrant.dossier ? (
              <Pastille ton="vert">Dossier · {LIBELLES_ETAPE[entrant.dossier.etape as EtapeDossier] ?? entrant.dossier.etape}</Pastille>
            ) : entrant.groupe !== "A_TRAITER" ? (
              <Pastille>{LIBELLES_STATUT_LEAD[entrant.statut as StatutLead] ?? entrant.statut}</Pastille>
            ) : null}
          </p>
          <p className="mt-0.5 truncate text-[12px] text-[#6B7280]">
            {[libelleSourceLead(entrant.source), entrant.ville, `reçu le ${formatDateCourte(entrant.recuLe)}`].filter(Boolean).join(" · ")}
          </p>
          {entrant.dernierEchange ? (
            <p className="mt-0.5 truncate text-[12px] text-[#9CA3AF]">
              {LIBELLES_TYPE_ECHANGE[entrant.dernierEchange.type] ?? entrant.dernierEchange.type} · {entrant.dernierEchange.contenu}
            </p>
          ) : null}
        </button>
        <div className="flex shrink-0 flex-col items-end justify-center gap-1 px-4 py-3 text-right">
          {entrant.prixSimule ? <span className="text-[13px] font-medium text-[#F2F3F5] tabular-nums">{formatMontant(entrant.prixSimule)}</span> : null}
          <span className={cn("text-[12px] tabular-nums", enAttente ? "text-[#F5B454]" : "text-[#6B7280]")}>
            {entrant.joursSansNouvelle === 0 ? "aujourd'hui" : `${entrant.joursSansNouvelle} j sans nouvelle`}
          </span>
          {entrant.telephone ? (
            <a
              href={`tel:${entrant.telephone.replace(/[^\d+]/g, "")}`}
              aria-label={`Appeler ${entrant.nom}`}
              className={cn("inline-flex h-8 items-center gap-1 rounded-[7px] border-[0.5px] border-[#2A2D34] px-2 text-[12px] text-[#D1D5DB] hover:border-[#3A3E47] hover:text-[#F2F3F5]", TRANS)}
            >
              <Phone size={12} aria-hidden /> Appeler
            </a>
          ) : null}
        </div>
      </div>
    </li>
  );
}

function LigneProspect({ prospect, onOuvrir }: { prospect: ProspectResume; onOuvrir: () => void }) {
  return (
    <li className="border-t-[0.5px] border-[#2A2D34] first:border-t-0">
      <button type="button" onClick={onOuvrir} className={cn("flex w-full items-start gap-4 px-4 py-3 text-left hover:bg-[#22262D]", TRANS)}>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="truncate text-[14px] font-medium text-[#F2F3F5]">{prospect.nom}</span>
            <PastilleScore score={prospect.score} />
            {prospect.dossier ? <Pastille ton="vert">Dossier · {LIBELLES_ETAPE[prospect.dossier.etape as EtapeDossier] ?? prospect.dossier.etape}</Pastille> : null}
            {prospect.groupe === "EN_COURS" ? <Pastille ton="bleu">{LIBELLES_STATUT_PROSPECT[prospect.statut] ?? prospect.statut}</Pastille> : null}
          </p>
          <p className="mt-0.5 truncate text-[12px] text-[#6B7280]">
            {[prospect.agent.nom.replace(/^Agent /, ""), prospect.ville, prospect.noteGoogle ? `${prospect.noteGoogle.toLocaleString("fr-FR")} ★ (${prospect.nbAvis ?? 0} avis)` : null].filter(Boolean).join(" · ")}
          </p>
          {prospect.signalPrincipal ? <p className="mt-0.5 line-clamp-2 text-[12px] text-[#9CA3AF]">« {prospect.signalPrincipal} »</p> : null}
        </div>
        {/* En suivi : la dernière activité ; sinon la date du sourcing (un import ou un rescoring ne la déplace pas). */}
        <span className="shrink-0 text-[12px] text-[#6B7280]">
          {prospect.groupe === "EN_COURS" || prospect.groupe === "CONVERTIS" || prospect.groupe === "NE_PAS_CONTACTER"
            ? formatDateCourte(prospect.derniereActiviteLe)
            : `sourcé le ${formatDateCourte(prospect.sourceLe)}`}
        </span>
      </button>
    </li>
  );
}

/** Tout ce qui précède un dossier : contacts entrants et démarchage, jusqu'à « Ouvrir un dossier ». */
export default function ProspectsPilotage({
  ongletInitial,
  entrantsInitiaux,
  demarchageInitial,
  leadInitialId,
  prospectInitialId,
  nouveauInitial,
}: {
  ongletInitial: Onglet;
  entrantsInitiaux: ListeEntrants;
  demarchageInitial: EtatDemarchage;
  leadInitialId: string | null;
  prospectInitialId: string | null;
  nouveauInitial: boolean;
}) {
  const [onglet, setOnglet] = useState<Onglet>(ongletInitial);
  const [entrants, setEntrants] = useState(entrantsInitiaux);
  const [demarchage, setDemarchage] = useState(demarchageInitial);
  const [groupeEntrants, setGroupeEntrants] = useState<GroupeEntrants>("A_TRAITER");
  const [groupeDemarchage, setGroupeDemarchage] = useState<GroupeDemarchage>("A_CONTACTER");
  const [source, setSource] = useState("");
  const [agent, setAgent] = useState("");
  const [recherche, setRecherche] = useState("");
  const [chargement, setChargement] = useState(false);
  const [leadOuvert, setLeadOuvert] = useState<string | null>(leadInitialId);
  const [prospectOuvert, setProspectOuvert] = useState<string | null>(prospectInitialId);
  const [nouveau, setNouveau] = useState(nouveauInitial);
  const [action, setAction] = useState<string | null>(null);
  const [sourcingAConfirmer, setSourcingAConfirmer] = useState<EtatAgent | null>(null);
  const importFichier = useRef<HTMLInputElement>(null);
  const premierRendu = useRef(true);

  const chargerEntrants = useCallback(async () => {
    const parametres = new URLSearchParams({ groupe: groupeEntrants });
    if (source) parametres.set("source", source);
    if (recherche.trim()) parametres.set("recherche", recherche.trim());
    setEntrants(await appelApi<ListeEntrants>(`/api/prospects/entrants?${parametres}`));
  }, [groupeEntrants, source, recherche]);

  const chargerDemarchage = useCallback(async () => {
    const parametres = new URLSearchParams({ groupe: groupeDemarchage });
    if (agent) parametres.set("agent", agent);
    if (recherche.trim()) parametres.set("recherche", recherche.trim());
    setDemarchage(await appelApi<EtatDemarchage>(`/api/prospects/demarchage?${parametres}`));
  }, [groupeDemarchage, agent, recherche]);

  useEffect(() => {
    if (premierRendu.current) {
      premierRendu.current = false;
      return;
    }
    let actif = true;
    const minuterie = window.setTimeout(() => {
      setChargement(true);
      (onglet === "entrants" ? chargerEntrants() : chargerDemarchage())
        .catch((erreur) => actif && toast.error("Liste non chargée", { description: messageErreur(erreur) }))
        .finally(() => actif && setChargement(false));
    }, 250);
    return () => {
      actif = false;
      window.clearTimeout(minuterie);
    };
  }, [onglet, chargerEntrants, chargerDemarchage]);

  // L'URL suit ce qui est ouvert : un lien (mail de notification, journal, dossier) rouvre la fiche.
  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set("onglet", onglet);
    if (leadOuvert) url.searchParams.set("lead", leadOuvert);
    else url.searchParams.delete("lead");
    if (prospectOuvert) url.searchParams.set("prospect", prospectOuvert);
    else url.searchParams.delete("prospect");
    url.searchParams.delete("nouveau");
    window.history.replaceState(window.history.state, "", url);
  }, [onglet, leadOuvert, prospectOuvert]);

  const rafraichir = useCallback(() => {
    void (onglet === "entrants" ? chargerEntrants() : chargerDemarchage()).catch(() => undefined);
    rafraichirCompteurs();
  }, [onglet, chargerEntrants, chargerDemarchage]);

  async function scorer(slug: string) {
    setAction(`scorer:${slug}`);
    try {
      const resultat = await envoyerJson<{ evalues: number; qualifies: number; ecartes: number }>("/api/prospects/demarchage/scorer", "POST", { agent: slug });
      toast.success(`${resultat.evalues} prospect${resultat.evalues > 1 ? "s" : ""} scoré${resultat.evalues > 1 ? "s" : ""}`, {
        description: `${resultat.qualifies} à contacter, ${resultat.ecartes} écarté${resultat.ecartes > 1 ? "s" : ""}.`,
      });
      await chargerDemarchage();
    } catch (erreur) {
      toast.error("Scoring impossible", { description: messageErreur(erreur) });
    } finally {
      setAction(null);
    }
  }

  async function sourcer(slug: string) {
    setAction(`sourcer:${slug}`);
    try {
      const resultat = await envoyerJson<{ nouveaux: number; dejaConnus: number; rejetes: number; erreurs: string[] }>("/api/prospects/demarchage/sourcer", "POST", { agent: slug });
      toast.success(`${resultat.nouveaux} nouveau${resultat.nouveaux > 1 ? "x" : ""} prospect${resultat.nouveaux > 1 ? "s" : ""}`, {
        description: `${resultat.dejaConnus} déjà connus, ${resultat.rejetes} hors critères. À scorer ensuite.${resultat.erreurs.length ? ` ${pluriel(resultat.erreurs.length, "erreur")} Google.` : ""}`,
      });
      setGroupeDemarchage("A_SCORER");
      await chargerDemarchage();
    } catch (erreur) {
      toast.error("Sourcing impossible", { description: messageErreur(erreur) });
    } finally {
      setAction(null);
    }
  }

  async function importer(fichier: File) {
    setAction("import");
    try {
      const contenu = JSON.parse(await fichier.text()) as unknown;
      const resultat = await envoyerJson<{ agentsCrees: number; prospectsCrees: number; dejaConnus: number }>("/api/prospects/demarchage/import", "POST", contenu);
      toast.success(`${resultat.prospectsCrees} prospect${resultat.prospectsCrees > 1 ? "s" : ""} importé${resultat.prospectsCrees > 1 ? "s" : ""}`, {
        description: `${resultat.dejaConnus} déjà présent${resultat.dejaConnus > 1 ? "s" : ""}, laissé${resultat.dejaConnus > 1 ? "s" : ""} tel${resultat.dejaConnus > 1 ? "s" : ""} quel${resultat.dejaConnus > 1 ? "s" : ""}.`,
      });
      await chargerDemarchage();
    } catch (erreur) {
      toast.error("Import impossible", { description: erreur instanceof SyntaxError ? "Fichier illisible : un export JSON de prospects est attendu." : messageErreur(erreur) });
    } finally {
      setAction(null);
      if (importFichier.current) importFichier.current.value = "";
    }
  }

  const aTraiter = entrants.compteurs.A_TRAITER;
  const aContacter = demarchage.compteurs.A_CONTACTER;

  return (
    <div className="mx-auto w-full max-w-5xl px-5 py-6 md:px-8 md:py-8">
      <EnTetePage
        titre="Prospects"
        sousTitre={`${aTraiter} contact${aTraiter > 1 ? "s" : ""} à traiter · ${aContacter} établissement${aContacter > 1 ? "s" : ""} à démarcher. Un prospect devient un dossier.`}
        actions={
          <Bouton variante="primaire" icone={<UserPlus size={15} aria-hidden />} onClick={() => setNouveau(true)}>
            Nouveau contact
          </Bouton>
        }
      />

      <div role="tablist" aria-label="Origine des prospects" className="mt-5 flex w-full items-center rounded-[9px] border-[0.5px] border-[#2A2D34] bg-[#1C1F25] p-[3px] sm:w-fit">
        {(
          [
            { valeur: "entrants", libelle: "Entrants", Icone: Inbox, nombre: aTraiter },
            { valeur: "demarchage", libelle: "Démarchage", Icone: Radar, nombre: aContacter },
          ] as const
        ).map(({ valeur, libelle, Icone, nombre }) => (
          <button
            key={valeur}
            type="button"
            role="tab"
            aria-selected={onglet === valeur}
            onClick={() => {
              setOnglet(valeur);
              setRecherche("");
            }}
            className={cn(
              "flex h-9 flex-1 items-center justify-center gap-1.5 rounded-[7px] px-4 text-[13px] font-medium whitespace-nowrap sm:h-8 sm:flex-none",
              onglet === valeur ? "bg-[#272B33] text-[#F2F3F5]" : "text-[#9CA3AF] hover:text-[#F2F3F5]",
              TRANS
            )}
          >
            <Icone size={14} aria-hidden />
            {libelle}
            {nombre > 0 ? <span className="rounded-full bg-[#1D9E75] px-1.5 text-[10.5px] leading-[18px] font-semibold text-[#0B1612] tabular-nums">{nombre > 99 ? "99+" : nombre}</span> : null}
          </button>
        ))}
      </div>

      {onglet === "entrants" ? (
        <section className="mt-4">
          <p className="mb-3 text-[12.5px] text-[#6B7280]">Formulaires du site, simulateur, publicités Meta et contacts saisis à la main. Un appel ou un message noté les passe en « Contactés ».</p>
          <Groupes groupes={GROUPES_ENTRANTS} libelles={LIBELLES_GROUPE_ENTRANTS} compteurs={entrants.compteurs} actif={groupeEntrants} onChoisir={setGroupeEntrants} />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <ChampRecherche valeur={recherche} onChange={setRecherche} placeholder="Nom, ville, e-mail, téléphone…" />
            <ListeDeroulante
              libelle="Source"
              classeConteneur="min-w-[180px] [&>label]:sr-only"
              value={source}
              onChange={(evenement) => setSource(evenement.target.value)}
              options={[{ valeur: "", libelle: "Toutes les sources" }, ...SOURCES_LEAD.map((valeur) => ({ valeur, libelle: libelleSourceLead(valeur) }))]}
            />
          </div>
          <div aria-busy={chargement} className={cn("mt-3", chargement && "opacity-60")}>
            {entrants.lignes.length === 0 ? (
              <EtatVide
                icone={<Inbox size={18} className="text-[#6B7280]" aria-hidden />}
                titre={groupeEntrants === "A_TRAITER" ? "Aucun contact à traiter" : "Aucun contact ici"}
                texte={groupeEntrants === "A_TRAITER" ? "Les demandes du site, du simulateur et de Meta arrivent ici dès leur réception." : undefined}
              />
            ) : (
              <ul className="overflow-hidden rounded-[11px] border-[0.5px] border-[#2A2D34] bg-[#1C1F25]">
                {entrants.lignes.map((entrant) => (
                  <LigneEntrant key={entrant.id} entrant={entrant} onOuvrir={() => setLeadOuvert(entrant.id)} />
                ))}
              </ul>
            )}
          </div>
        </section>
      ) : (
        <section className="mt-4">
          <p className="mb-3 text-[12.5px] text-[#6B7280]">
            Établissements trouvés sur Google Places et scorés sur les signes d&apos;usure de leurs avis. Rien n&apos;est envoyé automatiquement.
          </p>
          <div className="mb-3 grid gap-2 sm:grid-cols-2">
            {demarchage.agents.length === 0 ? (
              <p className="text-[12.5px] text-[#9CA3AF]">Aucun agent de prospection : ils sont créés au démarrage du serveur.</p>
            ) : (
              demarchage.agents.map((etat) => (
                <div key={etat.slug} className="rounded-[11px] border-[0.5px] border-[#2A2D34] bg-[#1C1F25] p-3">
                  <p className="flex items-center justify-between gap-2 text-[13.5px] font-medium text-[#F2F3F5]">
                    {etat.nom.replace(/^Agent /, "")}
                    <span className="text-[12px] font-normal text-[#6B7280] tabular-nums">{etat.prospects} prospects</span>
                  </p>
                  <p className="mt-0.5 text-[12px] text-[#9CA3AF]">
                    {etat.aContacter} à contacter · {etat.aScorer} à scorer
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Bouton
                      taille="sm"
                      icone={<Sparkles size={13} aria-hidden />}
                      chargement={action === `scorer:${etat.slug}`}
                      disabled={etat.aScorer === 0 || action !== null}
                      onClick={() => void scorer(etat.slug)}
                    >
                      Scorer {etat.aScorer > 0 ? `(${etat.aScorer})` : ""}
                    </Bouton>
                    <Bouton
                      taille="sm"
                      variante="fantome"
                      icone={<Radar size={13} aria-hidden />}
                      chargement={action === `sourcer:${etat.slug}`}
                      disabled={!demarchage.sourcingDisponible || action !== null}
                      onClick={() => setSourcingAConfirmer(etat)}
                    >
                      Sourcer
                    </Bouton>
                  </div>
                  {!demarchage.sourcingDisponible ? (
                    <p className="mt-1.5 text-[11.5px] text-[#6B7280]">Sourcing indisponible : clé Google Places (GOOGLE_PLACES_API_KEY) absente du serveur. Appels payants au-delà du quota gratuit.</p>
                  ) : (
                    <p className="mt-1.5 text-[11.5px] text-[#6B7280]">Sourcing : 30 à 90 s, appels à Google Places (payants au-delà du quota gratuit).</p>
                  )}
                </div>
              ))
            )}
          </div>
          <Groupes groupes={GROUPES_DEMARCHAGE} libelles={LIBELLES_GROUPE_DEMARCHAGE} compteurs={demarchage.compteurs} actif={groupeDemarchage} onChoisir={setGroupeDemarchage} />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <ChampRecherche valeur={recherche} onChange={setRecherche} placeholder="Nom, ville, téléphone…" />
            <ListeDeroulante
              libelle="Agent"
              classeConteneur="min-w-[160px] [&>label]:sr-only"
              value={agent}
              onChange={(evenement) => setAgent(evenement.target.value)}
              options={[{ valeur: "", libelle: "Tous les agents" }, ...demarchage.agents.map((etat) => ({ valeur: etat.slug, libelle: etat.nom.replace(/^Agent /, "") }))]}
            />
            <input ref={importFichier} type="file" accept="application/json,.json" className="hidden" onChange={(evenement) => evenement.target.files?.[0] && void importer(evenement.target.files[0])} />
            <Bouton taille="sm" variante="fantome" icone={<FileUp size={13} aria-hidden />} chargement={action === "import"} disabled={action !== null} onClick={() => importFichier.current?.click()}>
              Importer
            </Bouton>
          </div>
          <div aria-busy={chargement} className={cn("mt-3", chargement && "opacity-60")}>
            {demarchage.lignes.length === 0 ? (
              <EtatVide
                icone={<Star size={18} className="text-[#6B7280]" aria-hidden />}
                titre={groupeDemarchage === "A_CONTACTER" ? "Aucun établissement à contacter" : "Aucun prospect ici"}
                texte={groupeDemarchage === "A_CONTACTER" ? "Sourcez puis scorez : les établissements aux avis les plus marqués par l'usure arrivent ici." : undefined}
              />
            ) : (
              <ul className="overflow-hidden rounded-[11px] border-[0.5px] border-[#2A2D34] bg-[#1C1F25]">
                {demarchage.lignes.map((prospect) => (
                  <LigneProspect key={prospect.id} prospect={prospect} onOuvrir={() => setProspectOuvert(prospect.id)} />
                ))}
              </ul>
            )}
          </div>
        </section>
      )}

      <PanneauEntrant id={leadOuvert} onFermer={() => setLeadOuvert(null)} onModifie={rafraichir} />
      <PanneauProspect id={prospectOuvert} onFermer={() => setProspectOuvert(null)} onModifie={rafraichir} />
      <Modale
        ouverte={sourcingAConfirmer !== null}
        onFermer={() => setSourcingAConfirmer(null)}
        titre={`Sourcer : ${sourcingAConfirmer?.nom.replace(/^Agent /, "").toLowerCase() ?? ""}`}
        description="Recherche de nouveaux établissements sur Google Places, dans 15 villes de l'Hérault."
        pied={
          <div className="flex justify-end gap-2">
            <Bouton variante="fantome" onClick={() => setSourcingAConfirmer(null)}>
              Annuler
            </Bouton>
            <Bouton
              variante="primaire"
              icone={<Radar size={15} aria-hidden />}
              onClick={() => {
                const slug = sourcingAConfirmer?.slug;
                setSourcingAConfirmer(null);
                if (slug) void sourcer(slug);
              }}
            >
              Lancer le sourcing
            </Bouton>
          </div>
        }
      >
        <ul className="list-disc space-y-1.5 pl-5 text-[13px] text-[#D1D5DB]">
          <li>{"Jusqu'à 45 recherches Google Places et une fiche d'avis par nouvel établissement (60 au plus)."}</li>
          <li>Gratuit dans le quota mensuel offert par Google, facturé sur le compte Google Cloud au-delà.</li>
          <li>{"30 à 90 secondes ; les nouveaux prospects arrivent « à scorer ». Aucun message n'est envoyé."}</li>
        </ul>
      </Modale>
      {nouveau ? (
        <NouveauContact
          onFermer={() => setNouveau(false)}
          onCree={(id) => {
            setNouveau(false);
            setOnglet("entrants");
            setGroupeEntrants("A_TRAITER");
            setLeadOuvert(id);
            rafraichir();
          }}
        />
      ) : null}
    </div>
  );
}
