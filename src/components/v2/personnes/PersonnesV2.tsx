"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PhoneForwarded, Plus, WifiOff } from "lucide-react";
import { toast } from "sonner";
import { CreationClient } from "@/app/(pilotage)/clients/_components/CreationClient";
import { ModeAppels } from "@/app/(pilotage)/leads/_components/ModeAppels";
import { NouveauContact } from "@/app/(pilotage)/leads/_components/NouveauContact";
import { PanneauEntrant } from "@/app/(pilotage)/leads/_components/PanneauEntrant";
import { ErreurApi, appelApi, envoyerJson, messageErreur } from "@/components/pilotage/client";
import { EVENEMENT_APPEL_TERMINE, EVENEMENT_LEADS_MODIFIES, type DetailAppelTermine } from "@/components/pilotage/evenements";
import { rafraichirCompteurs } from "@/components/pilotage/Navigation";
import { NotificationsAppareil } from "@/components/pilotage/NotificationsAppareil";
import { ecouterLeCache, vientDuCache } from "@/components/pilotage/serviDepuisLeCache";
import type { Candidat } from "@/lib/assistant/recherche";
import type { CategorieClient } from "@/lib/clients/constantes";
import type { PageClients } from "@/lib/clients/fiches";
import { pluriel } from "@/lib/commun/format";
import type { LigneLead, ListeLeads } from "@/lib/prospects/leads";
import { decouperLignes } from "@/lib/v2/dossiers";
import { LIGNES_VISIBLES, SEGMENTS_PERSONNES, adresseDuSegment, ecartesDeLaFile, fileDAppels, vueDuSegment, type SegmentPersonnes } from "@/lib/v2/personnes";
import { cn } from "@/lib/utils";
import { BOUTON_SECONDAIRE } from "../journal/GroupeParPersonne";
import { Segments } from "../liste/Segments";
import { BoutonVoirAutres, ChampRecherche, LISTE_V2, PagesV2, Vide } from "../liste/Troncature";
import { LigneClientV2, LigneLeadV2, LigneResultatV2 } from "./LignesPersonnes";

/**
 * Mission 22 (A4) — Personnes, l'écran v2 de `/leads` et `/clients` (docs/CRM-V2.md § Personnes) : la recherche
 * d'abord (`GET /api/recherche?q=`, la même fonction que l'outil `chercher` : dossier, contact, client, devis, facture),
 * puis les segments À appeler · À rappeler · Clients · Sans suite · Archivés (les quatre listes de `listerLeads` et la
 * liste des clients), cinq lignes puis « Voir les N autres », puis les pages du serveur. Changer de segment change
 * l'adresse sans changer de page (`replaceState` : `/leads?liste=…`, `/clients`). « Enchaîner les appels » = le mode
 * appels de la v1 ; « Ajouter » = un contact ou un client (les formulaires de la v1) ; la fiche d'un contact est le
 * `PanneauEntrant` de la v1 (`?lead=`), celle d'un client reste `/clients/<id>`. Aucun badge, aucun compteur.
 */
const ATTENTE_RECHERCHE_MS = 200;
const LONGUEUR_MIN = 2;

type Donnees = { cle: string; leads: ListeLeads | null; clients: PageClients | null };

export function PersonnesV2({ segmentInitial, leads, clients, leadInitial = null, appelsInitial = false, qInitial = "" }: { segmentInitial: SegmentPersonnes; leads: ListeLeads | null; clients: PageClients | null; leadInitial?: string | null; appelsInitial?: boolean; qInitial?: string }) {
  const [segment, setSegment] = useState<SegmentPersonnes>(segmentInitial);
  const [page, setPage] = useState(1);
  const [donnees, setDonnees] = useState<Donnees>({ cle: `${segmentInitial}|1`, leads, clients });
  const [chargement, setChargement] = useState(false);
  const [horsLigne, setHorsLigne] = useState(false);
  const [tout, setTout] = useState(false);
  const [q, setQ] = useState(qInitial);
  const [resultats, setResultats] = useState<Candidat[] | null>(null);
  const [toutResultats, setToutResultats] = useState(false);
  const [etatRecherche, setEtatRecherche] = useState<"repos" | "cherche" | "erreur">("repos");
  const [ouvert, setOuvert] = useState<string | null>(leadInitial);
  const [menuAjout, setMenuAjout] = useState(false);
  const [nouveau, setNouveau] = useState<"CONTACT" | CategorieClient | null>(null);
  const [maintenant, setMaintenant] = useState(() => Date.now());

  /* ── Le serveur : la liste du segment, une page à la fois ─────────────────────────────────────────────────────── */
  const cle = `${segment}|${page}`;
  const filtres = useRef({ segment, page });
  const rafraichir = useCallback(async () => {
    const { segment: s, page: p } = filtres.current;
    setChargement(true);
    try {
      const vue = vueDuSegment(s);
      if (vue) {
        const lues = await appelApi<ListeLeads>(`/api/leads?${new URLSearchParams({ vue, page: String(p) })}`);
        setDonnees({ cle: `${s}|${p}`, leads: lues, clients: null });
      } else {
        const lus = await appelApi<PageClients>(`/api/clients?${new URLSearchParams({ page: String(p) })}`);
        setDonnees({ cle: `${s}|${p}`, leads: null, clients: lus });
      }
      setHorsLigne(vientDuCache());
      setMaintenant(Date.now());
      rafraichirCompteurs();
    } catch (erreur) {
      if (erreur instanceof ErreurApi) toast.error(messageErreur(erreur));
      else setHorsLigne(true);
    } finally {
      setChargement(false);
    }
  }, []);

  useEffect(() => {
    filtres.current = { segment, page };
    if (donnees.cle === cle && (donnees.leads || donnees.clients)) return;
    const minuterie = window.setTimeout(() => void rafraichir(), 0);
    return () => window.clearTimeout(minuterie);
  }, [segment, page, cle, donnees, rafraichir]);

  // Un lead qui arrive, un appel fini, le retour sur l'onglet : la liste se relit ; l'horloge des phrases tourne chaque demi-minute.
  useEffect(() => {
    const surRetour = () => document.visibilityState === "visible" && void rafraichir();
    const surModification = () => void rafraichir();
    const horloge = window.setInterval(() => setMaintenant(Date.now()), 30_000);
    const releve = window.setInterval(surRetour, 60_000);
    document.addEventListener("visibilitychange", surRetour);
    window.addEventListener("online", surRetour);
    window.addEventListener(EVENEMENT_LEADS_MODIFIES, surModification);
    const oublier = ecouterLeCache(() => setHorsLigne(true));
    return () => {
      window.clearInterval(horloge);
      window.clearInterval(releve);
      document.removeEventListener("visibilitychange", surRetour);
      window.removeEventListener("online", surRetour);
      window.removeEventListener(EVENEMENT_LEADS_MODIFIES, surModification);
      oublier();
    };
  }, [rafraichir]);

  // L'adresse suit le segment et la recherche, sans changer de page (`/leads?liste=…`, `/clients`, `?q=`).
  useEffect(() => {
    const url = new URL(adresseDuSegment(segment, q), window.location.origin);
    if (ouvert) url.searchParams.set("lead", ouvert);
    window.history.replaceState(window.history.state, "", url);
  }, [segment, q, ouvert]);

  /* ── La recherche d'abord ─────────────────────────────────────────────────────────────────────────────────────── */
  const texte = q.trim();
  useEffect(() => {
    if (texte.length < LONGUEUR_MIN) {
      const vider = window.setTimeout(() => {
        setResultats(null);
        setEtatRecherche("repos");
      }, 0);
      return () => window.clearTimeout(vider);
    }
    let valide = true;
    const minuterie = window.setTimeout(() => {
      setEtatRecherche("cherche");
      appelApi<{ resultats: Candidat[] }>(`/api/recherche?q=${encodeURIComponent(texte)}`)
        .then(({ resultats: trouves }) => {
          if (!valide) return;
          setResultats(trouves);
          setToutResultats(false);
          setEtatRecherche("repos");
        })
        .catch(() => valide && setEtatRecherche("erreur"));
    }, ATTENTE_RECHERCHE_MS);
    return () => {
      valide = false;
      window.clearTimeout(minuterie);
    };
  }, [texte]);
  const enRecherche = texte.length >= LONGUEUR_MIN;

  /* ── Les appels à la suite (le mode appels de la v1) ───────────────────────────────────────────────────────────── */
  const lignes = useMemo(() => (donnees.cle === cle ? (donnees.leads?.lignes ?? []) : []), [donnees, cle]);
  const [modeAppels, setModeAppels] = useState(appelsInitial);
  const [passes, setPasses] = useState<Set<string>>(new Set());
  const [affiche, setAffiche] = useState<LigneLead | null>(null);
  const [totalAppels, setTotalAppels] = useState(0);
  const [ouverture, setOuverture] = useState<string | null>(null);
  const aEnchainer = useMemo(() => fileDAppels(segment, lignes), [segment, lignes]);
  const vivante = useMemo(() => aEnchainer.filter((lead) => !passes.has(lead.id)), [aEnchainer, passes]);
  // Le lead affiché reste en tête jusqu'à son issue ou « Passer », même si une relecture l'a retiré de la liste.
  const file = useMemo(() => {
    if (!modeAppels || !affiche || passes.has(affiche.id)) return vivante;
    return [vivante.find((lead) => lead.id === affiche.id) ?? affiche, ...vivante.filter((lead) => lead.id !== affiche.id)];
  }, [modeAppels, affiche, passes, vivante]);
  if (modeAppels && (file[0]?.id ?? null) !== (affiche?.id ?? null)) setAffiche(file[0] ?? null);
  const passer = (id: string) => setPasses((actuels) => new Set(actuels).add(id));

  useEffect(() => {
    const surAppelTermine = (evenement: Event) => {
      const leadId = (evenement as CustomEvent<DetailAppelTermine>).detail?.leadId;
      if (leadId) setPasses((actuels) => new Set(actuels).add(leadId));
    };
    window.addEventListener(EVENEMENT_APPEL_TERMINE, surAppelTermine);
    return () => window.removeEventListener(EVENEMENT_APPEL_TERMINE, surAppelTermine);
  }, []);

  function demarrerAppels() {
    setAffiche(null);
    setPasses(new Set());
    setTotalAppels(aEnchainer.length);
    setModeAppels(true);
  }

  async function ouvrirDossier(lead: LigneLead): Promise<string | null> {
    setOuverture(lead.id);
    try {
      const resultat = await envoyerJson<{ dossierId: string; cree: boolean; photosRangees: number; simulationsRangees: number }>(`/api/leads/${lead.id}/dossier`, "POST");
      const rangees = resultat.photosRangees + resultat.simulationsRangees;
      toast.success(resultat.cree ? `Dossier ouvert pour ${lead.nom}` : `${lead.nom} avait déjà un dossier`, { description: rangees > 0 ? `${pluriel(rangees, "image rangée", "images rangées")} dans ses photos.` : "Coordonnées, projet et réponses repris." });
      await rafraichir();
      return resultat.dossierId;
    } catch (erreur) {
      toast.error("Dossier non ouvert", { description: messageErreur(erreur) });
      return null;
    } finally {
      setOuverture(null);
    }
  }

  /* ── Ce qui s'affiche ─────────────────────────────────────────────────────────────────────────────────────────── */
  const clientsPage = donnees.cle === cle ? donnees.clients : null;
  const listeLeads = donnees.cle === cle ? donnees.leads : null;
  const total = segment === "CLIENTS" ? (clientsPage?.total ?? 0) : (listeLeads?.total ?? lignes.length);
  const parPage = segment === "CLIENTS" ? (clientsPage?.parPage ?? 50) : (listeLeads?.parPage ?? 50);
  const decoupeLeads = decouperLignes(lignes, tout, LIGNES_VISIBLES);
  const decoupeClients = decouperLignes(clientsPage?.clients ?? [], tout, LIGNES_VISIBLES);
  const decoupeResultats = decouperLignes(resultats ?? [], toutResultats, LIGNES_VISIBLES);
  const instant = useMemo(() => new Date(maintenant), [maintenant]);
  const segmentDAppels = segment === "A_APPELER" || segment === "A_RAPPELER";
  const aideRecherche = etatRecherche === "erreur" ? "La recherche n'a pas répondu : réessaie." : etatRecherche === "cherche" && !resultats ? "Recherche en cours…" : resultats && resultats.length === 0 ? "Personne ne correspond." : null;

  const choisirSegment = (s: SegmentPersonnes) => {
    setSegment(s);
    setPage(1);
    setTout(false);
  };

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-4 md:px-8 md:py-6">
      <h1 className="sr-only">Personnes</h1>
      <div className="flex flex-col gap-4">
        {horsLigne ? (
          <p role="status" className="flex min-h-11 items-center gap-2 rounded-[8px] border border-attention/60 bg-surface px-4 py-2 text-corps-tel text-attention-texte md:text-corps">
            <WifiOff size={18} aria-hidden /> Hors ligne : voici la dernière liste connue. Appeler reste possible.
          </p>
        ) : null}
        <NotificationsAppareil application="crm" />

        {/* 1. La recherche */}
        <section aria-label="Rechercher une personne">
          <ChampRecherche valeur={q} onChange={setQ} placeholder="Nom, téléphone, ville, numéro de devis ou de facture…" libelle="Rechercher une personne, un dossier, un devis ou une facture" autoFocus={Boolean(qInitial)} />
        </section>

        {enRecherche ? (
          /* Les résultats, en phrases, à la place des listes */
          <section aria-label="Résultats" aria-busy={etatRecherche === "cherche"} className="flex flex-col gap-3">
            {aideRecherche ? <p className="px-1 text-corps-tel text-texte-3 md:text-corps">{aideRecherche}</p> : null}
            {resultats && resultats.length > 0 ? (
              <>
                <ul className={LISTE_V2}>
                  {decoupeResultats.visibles.map((candidat) => (
                    <LigneResultatV2 key={`${candidat.type}-${candidat.id}`} candidat={candidat} maintenant={instant} onOuvrirLead={setOuvert} />
                  ))}
                </ul>
                <BoutonVoirAutres reste={decoupeResultats.reste} onClick={() => setToutResultats(true)} />
              </>
            ) : null}
          </section>
        ) : (
          <>
            {/* 2. Les segments, et les deux gestes secondaires */}
            <section aria-label="Quelles personnes" className="flex flex-col gap-3">
              <Segments libelle="Quelles personnes" options={SEGMENTS_PERSONNES} actif={segment} onChoisir={choisirSegment} />
              <div className="flex flex-wrap items-center gap-2">
                {segmentDAppels ? (
                  <button type="button" onClick={demarrerAppels} disabled={aEnchainer.length === 0} className={cn(BOUTON_SECONDAIRE, "gap-2")}>
                    <PhoneForwarded size={18} aria-hidden />
                    Enchaîner les appels
                  </button>
                ) : null}
                <div className="relative">
                  <button type="button" aria-expanded={menuAjout} aria-controls="menu-ajouter" onClick={() => setMenuAjout((v) => !v)} className={cn(BOUTON_SECONDAIRE, "gap-2")}>
                    <Plus size={18} aria-hidden /> Ajouter
                  </button>
                  {menuAjout ? (
                    <ul id="menu-ajouter" className="absolute top-full left-0 z-30 mt-1 w-72 overflow-hidden rounded-[11px] border border-trait bg-surface">
                      {(
                        [
                          { valeur: "CONTACT", libelle: "Un contact à appeler" },
                          { valeur: "PARTICULIER", libelle: "Un client particulier" },
                          { valeur: "PROFESSIONNEL", libelle: "Un client professionnel" },
                        ] as const
                      ).map((choix) => (
                        <li key={choix.valeur} className="border-t border-trait first:border-t-0">
                          <button
                            type="button"
                            onClick={() => {
                              setMenuAjout(false);
                              setNouveau(choix.valeur);
                            }}
                            className="flex min-h-11 w-full items-center px-4 py-2 text-left text-corps-tel text-texte hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none md:text-corps"
                          >
                            {choix.libelle}
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              </div>
            </section>

            {/* 3. La liste du segment */}
            <section aria-label={SEGMENTS_PERSONNES.find((s) => s.valeur === segment)?.libelle} aria-busy={chargement} className={cn("flex flex-col gap-3", chargement && "opacity-60")}>
              {segment === "CLIENTS" ? (
                !clientsPage ? (
                  <p className="px-1 text-corps-tel text-texte-3 md:text-corps">Lecture…</p>
                ) : clientsPage.clients.length === 0 ? (
                  <Vide>Aucun client pour l&apos;instant. Les clients arrivent avec les contacts, les dossiers et les fiches créées ici.</Vide>
                ) : (
                  <>
                    <ul className={LISTE_V2}>
                      {decoupeClients.visibles.map((client) => (
                        <LigneClientV2 key={client.id} client={client} />
                      ))}
                    </ul>
                    <BoutonVoirAutres reste={decoupeClients.reste} onClick={() => setTout(true)} />
                  </>
                )
              ) : !listeLeads ? (
                <p className="px-1 text-corps-tel text-texte-3 md:text-corps">Lecture…</p>
              ) : lignes.length === 0 ? (
                <Vide>
                  {segment === "A_APPELER"
                    ? "Personne à appeler. Les demandes du site, de la publicité et les contacts saisis à la main arrivent ici tant qu'ils n'ont pas été appelés ; ceux qui ont un dossier sont dans Dossiers."
                    : segment === "A_RAPPELER"
                      ? "Aucun rappel. Un contact appelé arrive ici avec sa date de rappel ; il en sort vers un dossier, sans suite ou archivé."
                      : segment === "ARCHIVES"
                        ? "Aucun contact archivé."
                        : "Aucun contact sans suite."}
                </Vide>
              ) : (
                <>
                  <ul className={LISTE_V2}>
                    {decoupeLeads.visibles.map((lead, index) => (
                      <LigneLeadV2 key={lead.id} lead={lead} maintenant={instant} principal={index === 0} onOuvrir={setOuvert} />
                    ))}
                  </ul>
                  <BoutonVoirAutres reste={decoupeLeads.reste} onClick={() => setTout(true)} />
                </>
              )}
              <PagesV2
                total={total}
                page={page}
                parPage={parPage}
                onPage={(p) => {
                  setPage(p);
                  setTout(false);
                }}
              />
            </section>
          </>
        )}
      </div>

      <PanneauEntrant id={ouvert} ligne={lignes.find((l) => l.id === ouvert) ?? null} onRecharger={rafraichir} onFermer={() => setOuvert(null)} onModifie={() => void rafraichir()} />

      {nouveau === "CONTACT" ? (
        <NouveauContact
          onFermer={() => setNouveau(null)}
          onCree={(id) => {
            setNouveau(null);
            setOuvert(id);
            void rafraichir();
          }}
        />
      ) : nouveau ? (
        <CreationClient categorieInitiale={nouveau} onFermer={() => setNouveau(null)} />
      ) : null}

      {modeAppels ? (
        <ModeAppels
          file={file}
          total={Math.max(totalAppels, file.length)}
          ecartes={ecartesDeLaFile(segment, lignes)}
          maintenant={maintenant}
          occupe={ouverture !== null}
          onQuitter={() => setModeAppels(false)}
          onPasser={passer}
          // Comme en v1 : son dossier ouvert, il quitte la file.
          onDossier={(lead) => void ouvrirDossier(lead).then((dossierId) => dossierId && passer(lead.id))}
        />
      ) : null}
    </div>
  );
}
