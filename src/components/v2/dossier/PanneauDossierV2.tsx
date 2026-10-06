"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, X } from "lucide-react";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { appelApi, messageErreur } from "@/components/pilotage/client";
import { noterDebutAppel } from "@/components/pilotage/NotesAppel";
import { RelectureMail } from "@/components/pilotage/relances/FeuilleRelances";
import { ouvrirEcranSms, type DemandeEcranSms } from "@/components/pilotage/sms/EcranSms";
import type { DemandeOuverture } from "@/app/(pilotage)/dossiers/_components/PanneauDossier";
import { ModaleDocumentExistant } from "@/app/(pilotage)/dossiers/_components/DocumentExistant";
import { GenerateurDocument } from "@/app/(pilotage)/dossiers/_components/GenerateurDocument";
import { ModalePaiement } from "@/app/(pilotage)/dossiers/_components/PaiementsDossier";
import { ProchaineActionEditeur } from "@/app/(pilotage)/dossiers/_components/ProchaineActionEditeur";
import { FeuilleDateChantier } from "@/app/(pilotage)/taches/_components/FeuilleDateChantier";
import type { EtapeDossier, TypeDocument } from "@/lib/dossiers/constants";
import { autresGestes, gestePrincipal, tachePrete, type AutreGeste, type GestePrincipal } from "@/lib/dossiers/geste-principal";
import type { DocumentVue, DossierDetail } from "@/lib/dossiers/types";
import type { RelancesProposables } from "@/lib/relances/proposables";
import type { DemandeOuvertureV2 } from "@/lib/v2/dossiers";
import { cibleDuDefilement, rubriqueDeLEtape, rubriqueDemandee, type RubriqueV2 } from "@/lib/v2/rubriques-dossier";
import { cn } from "@/lib/utils";
import { BOUTON_SECONDAIRE } from "../journal/GroupeParPersonne";
import { BoutonGesteDossier } from "../taches/BoutonGeste";
import { FeuillesRaccourcis } from "../taches/PanneauxRaccourcis";
import { useGestesTaches } from "../taches/useGestesTaches";
import { AFaireIci } from "./AFaireIci";
import { CeQuiSestPasseIci } from "./CeQuiSestPasseIci";
import { EnTeteSituation } from "./EnTeteSituation";
import { RubriquesDossier } from "./RubriquesDossier";

/**
 * Mission 22 (A3) — le panneau de dossier de la v2 (docs/CRM-V2.md § Panneau de dossier), même contrat que
 * `PanneauDossier` de la v1 (intouché) : même `Sheet` à droite, même fermeture au pouce, mêmes `?rubrique=` et
 * `?devis=`, même relecture toutes les 30 s et au retour sur l'onglet. Cinq blocs, dans cet ordre :
 * 1. l'en-tête de situation (trois lignes, « Modifier ») ; 2. l'unique bouton principal (`lib/dossiers/geste-principal.ts`)
 * et « Autres gestes » repliés ; 3. « À faire ici » (les tâches du dossier, mêmes gestes qu'Aujourd'hui) ;
 * 4. « Ce qui s'est passé ici » (cinq lignes) ; 5. les rubriques, toutes fermées sauf celle de l'étape.
 * Les sections, modales et feuilles sont celles de la v1 ; le moteur et les routes ne changent pas.
 * Mission 22 (A4) — la demande d'ouverture porte aussi un `geste` (`lib/v2/dossiers.ts › DemandeOuvertureV2`) : la
 * ligne de la liste Dossiers fait exécuter son geste principal par le panneau (facture, encaissement, date du chantier,
 * relance, avis) dès l'ouverture, par les mêmes modales et feuilles. Une `DemandeOuverture` de la v1 reste acceptée.
 */
export function PanneauDossierV2({ dossierId, maintenant, onFermer, onMisAJour, onArchive, demande = null }: { dossierId: string | null; maintenant: Date; onFermer: () => void; onMisAJour: (detail: DossierDetail) => void; onArchive?: (dossierId: string) => void; demande?: DemandeOuverture | DemandeOuvertureV2 | null }) {
  const [detail, setDetail] = useState<DossierDetail | null>(null);
  const [echec, setEchec] = useState<{ dossierId: string; message: string } | null>(null);

  // Une réponse d'écriture (PATCH, étape, paiement…) ne porte ni `espace` ni `taches` : on garde les précédents.
  const appliquer = useCallback(
    (nouveau: DossierDetail) => {
      setDetail((precedent) => (precedent && precedent.id === nouveau.id ? { ...nouveau, espace: nouveau.espace === undefined ? precedent.espace : nouveau.espace, taches: nouveau.taches ?? precedent.taches } : nouveau));
      onMisAJour(nouveau);
    },
    [onMisAJour]
  );

  useEffect(() => {
    if (!dossierId) return;
    let actif = true;
    appelApi<DossierDetail>(`/api/dossiers/${dossierId}`)
      .then((charge) => actif && appliquer(charge))
      .catch((probleme: unknown) => actif && setEchec({ dossierId, message: messageErreur(probleme) }));
    return () => {
      actif = false;
    };
  }, [dossierId, appliquer]);

  const recharger = useCallback(async () => {
    if (!dossierId) return;
    try {
      appliquer(await appelApi<DossierDetail>(`/api/dossiers/${dossierId}`));
    } catch (probleme) {
      toast.error("Dossier non rechargé", { description: messageErreur(probleme) });
    }
  }, [dossierId, appliquer]);

  // Comme en v1 : tant qu'il est ouvert, le panneau se relit toutes les 30 s et au retour sur l'onglet, en silence.
  useEffect(() => {
    if (!dossierId) return;
    let actif = true;
    const relire = () => {
      if (document.visibilityState !== "visible") return;
      appelApi<DossierDetail>(`/api/dossiers/${dossierId}`)
        .then((charge) => actif && appliquer(charge))
        .catch(() => undefined);
    };
    const minuterie = window.setInterval(relire, 30_000);
    const surVisibilite = () => {
      if (document.visibilityState === "visible") relire();
    };
    document.addEventListener("visibilitychange", surVisibilite);
    return () => {
      actif = false;
      window.clearInterval(minuterie);
      document.removeEventListener("visibilitychange", surVisibilite);
    };
  }, [dossierId, appliquer]);

  const erreur = echec && echec.dossierId === dossierId ? echec.message : null;
  const affiche = detail && (dossierId === null || detail.id === dossierId) ? detail : null;

  return (
    <Sheet open={dossierId !== null} onOpenChange={(ouvert) => (ouvert ? undefined : onFermer())}>
      <SheetContent side="right" showCloseButton={false} className="gap-0 border-trait bg-fond p-0 text-texte data-[side=right]:w-full data-[side=right]:sm:max-w-[620px]">
        {affiche ? (
          <ContenuV2 key={`${affiche.id}:${demande?.cle ?? 0}`} detail={affiche} maintenant={maintenant} onFermer={onFermer} onMisAJour={appliquer} onRecharger={recharger} onArchive={onArchive} demande={demande} />
        ) : (
          <div className="flex h-full flex-col">
            <div className="flex items-center justify-between gap-3 border-b border-trait px-4 py-3">
              <SheetTitle className="text-corps-tel font-medium text-texte md:text-corps">{erreur ? "Dossier indisponible" : "Chargement du dossier…"}</SheetTitle>
              <button type="button" onClick={onFermer} aria-label="Fermer le dossier" className="flex h-11 w-11 items-center justify-center rounded-[8px] text-texte-3 hover:bg-surface hover:text-texte">
                <X size={20} aria-hidden />
              </button>
            </div>
            {erreur ? (
              <p className="px-4 py-6 text-corps-tel text-attention-texte md:text-corps">{erreur}</p>
            ) : (
              <div className="space-y-3 px-4 py-6" aria-hidden>
                {[70, 45, 90, 60].map((largeur) => (
                  <div key={largeur} className="h-4 animate-pulse rounded bg-surface-2 motion-reduce:animate-none" style={{ width: `${largeur}%` }} />
                ))}
              </div>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

/** Le numéro composable du dossier (`tel:`), ou null. */
function telephoneDe(detail: DossierDetail): { lisible: string; href: string } | null {
  const brut = detail.clientTelephone.replace(/[^\d+]/g, "");
  return brut.length >= 6 ? { lisible: detail.clientTelephone, href: `tel:${brut}` } : null;
}

/** Fait défiler jusqu'à la première cible présente ; en douceur, sauf si la personne a demandé moins de mouvement. */
function defilerVers(ids: readonly string[]): void {
  const element = ids.map((id) => document.getElementById(id)).find((e) => e !== null);
  element?.scrollIntoView({ block: "start", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
}

function ContenuV2({ detail, maintenant, onFermer, onMisAJour, onRecharger, onArchive, demande }: { detail: DossierDetail; maintenant: Date; onFermer: () => void; onMisAJour: (detail: DossierDetail) => void; onRecharger: () => Promise<void>; onArchive?: (dossierId: string) => void; demande: DemandeOuverture | DemandeOuvertureV2 | null }) {
  const routeur = useRouter();
  const instant = maintenant.getTime();
  // Mission 22 (A4) : le geste que la liste demande au panneau d'exécuter à l'ouverture.
  const gesteDemande = demande && "geste" in demande ? (demande.geste ?? null) : null;

  /* ── Rubriques : une seule ouverte d'office, celle de l'étape (ou celle du raccourci) ────────────────────────── */
  const [ouvertes, setOuvertes] = useState<Set<RubriqueV2>>(() => new Set([demande ? rubriqueDemandee(demande.rubrique) : rubriqueDeLEtape(detail.etape)]));
  const basculer = (r: RubriqueV2) =>
    setOuvertes((o) => {
      const suite = new Set(o);
      if (suite.has(r)) suite.delete(r);
      else suite.add(r);
      return suite;
    });
  const ouvrirRubrique = (r: RubriqueV2) => {
    setOuvertes((o) => new Set(o).add(r));
    window.setTimeout(() => defilerVers([`rubrique-${r}`]), 50);
  };

  /* ── Modales et feuilles (celles de la v1) ──────────────────────────────────────────────────────────────────── */
  const [generateur, setGenerateur] = useState<{ type: TypeDocument; cle: number; remplace?: DocumentVue; variante?: boolean } | null>(() => (demande?.devis === "nouveau" ? { type: "DEVIS", cle: 1 } : gesteDemande === "FACTURE" ? { type: "FACTURE", cle: 1 } : null));
  const [depotPdf, setDepotPdf] = useState(() => (demande?.devis === "pdf" ? 1 : 0));
  const [depotGmail, setDepotGmail] = useState<string | null>(() => (demande?.devis === "gmail" && demande.piece ? demande.piece : null));
  const [encaisser, setEncaisser] = useState(() => demande?.rubrique === "encaisser" || gesteDemande === "ENCAISSER");
  const [feuilleDate, setFeuilleDate] = useState(() => gesteDemande === "DATE_CHANTIER");
  const [modifierAction, setModifierAction] = useState(false);
  const [autresOuverts, setAutresOuverts] = useState(false);
  const [etapeDemandee, setEtapeDemandee] = useState<{ etape: EtapeDossier; cle: number } | null>(() => (demande?.rubrique === "etape" && demande.etape ? { etape: demande.etape, cle: 1 } : null));
  const [relectureMail, setRelectureMail] = useState<{ propositionId: string; cle: number } | null>(null);
  const faireDevis = () => setGenerateur((actuel) => ({ type: "DEVIS", cle: (actuel?.cle ?? 0) + 1 }));
  const ajouterDevis = () => setGenerateur((actuel) => ({ type: "DEVIS", cle: (actuel?.cle ?? 0) + 1, variante: true }));
  const deposerPdf = () => setDepotPdf((n) => n + 1);
  const demanderEtape = (etape: EtapeDossier) => {
    setEtapeDemandee((actuel) => ({ etape, cle: (actuel?.cle ?? 0) + 1 }));
    ouvrirRubrique("etapes");
  };

  // Un raccourci (`?rubrique=`, tâche) : le défilement vers la rubrique, et le curseur dans le champ de réponse pour « messages ».
  useEffect(() => {
    if (!demande) return;
    const minuterie = window.setTimeout(() => defilerVers(cibleDuDefilement(demande.rubrique)), 350);
    const focus = demande.rubrique === "messages" ? window.setTimeout(() => document.getElementById("reponse-espace")?.focus({ preventScroll: true }), 900) : 0;
    return () => {
      window.clearTimeout(minuterie);
      window.clearTimeout(focus);
    };
  }, [demande]);

  // « Faire le devis », « Ajouter un devis », « Déposer un devis PDF » depuis une adresse : le dossier s'ouvre dessus, une fois (comme en v1).
  useEffect(() => {
    const url = new URL(window.location.href);
    const voulu = url.searchParams.get("devis");
    const piece = url.searchParams.get("piece");
    if (voulu !== "nouveau" && voulu !== "variante" && voulu !== "pdf" && !(voulu === "gmail" && piece)) return;
    const premier = window.setTimeout(() => {
      if (voulu === "pdf") setDepotPdf((n) => n || 1);
      else if (voulu === "gmail") setDepotGmail((actuel) => actuel ?? piece);
      else setGenerateur((actuel) => actuel ?? { type: "DEVIS", cle: 1, variante: voulu === "variante" });
      url.searchParams.delete("devis");
      url.searchParams.delete("piece");
      window.history.replaceState(window.history.state, "", url.toString());
    }, 0);
    return () => window.clearTimeout(premier);
  }, []);

  /* ── Les tâches du dossier : mêmes gestes qu'Aujourd'hui ──────────────────────────────────────────────────── */
  const [masquees, setMasquees] = useState<Set<string>>(new Set());
  const taches = useMemo(() => (detail.taches ?? []).filter((t) => !masquees.has(t.id)), [detail.taches, masquees]);
  const ordre = useMemo(() => taches.map((t) => t.id), [taches]);
  const minuteries = useRef<number[]>([]);
  const relireApres = useCallback(() => {
    void onRecharger();
    minuteries.current.push(window.setTimeout(() => void onRecharger(), 4_500));
  }, [onRecharger]);
  useEffect(() => {
    const enAttente = minuteries.current;
    return () => {
      for (const m of enAttente) window.clearTimeout(m);
    };
  }, []);
  const masquer = useCallback((id: string) => setMasquees((m) => new Set(m).add(id)), []);
  const demasquer = useCallback(
    (id: string) =>
      setMasquees((m) => {
        const suite = new Set(m);
        suite.delete(id);
        return suite;
      }),
    []
  );
  const gestes = useGestesTaches({ ordre, relire: onRecharger, relireApres, masquer, demasquer });
  const { ouvert, fermerRaccourci } = gestes;

  // Une tâche du dossier qui « ouvre le dossier » (rubrique, devis, encaissement) : c'est ici, sans second panneau.
  useEffect(() => {
    if (!ouvert || ouvert.vue !== "DOSSIER") return;
    const minuterie = window.setTimeout(() => {
      if (ouvert.dossierId !== detail.id) routeur.push(`/dossiers?dossier=${encodeURIComponent(ouvert.dossierId)}`);
      else if (ouvert.demande) {
        const d = ouvert.demande;
        setOuvertes((o) => new Set(o).add(rubriqueDemandee(d.rubrique)));
        if (d.devis === "nouveau") setGenerateur((actuel) => ({ type: "DEVIS", cle: (actuel?.cle ?? 0) + 1 }));
        else if (d.devis === "pdf") setDepotPdf((n) => n + 1);
        else if (d.devis === "gmail" && d.piece) setDepotGmail(d.piece);
        if (d.rubrique === "encaisser") setEncaisser(true);
        const etape = d.etape;
        if (d.rubrique === "etape" && etape) setEtapeDemandee((actuel) => ({ etape, cle: (actuel?.cle ?? 0) + 1 }));
        window.setTimeout(() => defilerVers(cibleDuDefilement(d.rubrique)), 350);
      }
      fermerRaccourci();
    }, 0);
    return () => window.clearTimeout(minuterie);
  }, [ouvert, detail.id, routeur, fermerRaccourci]);

  /* ── Le bouton principal et les autres gestes ─────────────────────────────────────────────────────────────── */
  const tache = tachePrete(taches, maintenant);
  const espace = detail.espace ?? null;
  const principal = gestePrincipal({ detail, espace, tache, maintenant });
  const autres = autresGestes(detail, principal);
  const telephone = telephoneDe(detail);
  const noterAppel = () => noterDebutAppel(detail.origine?.type === "LEAD" ? detail.origine.id : `dossier:${detail.id}`, { nom: detail.clientNom, dossierId: detail.id });

  // « Relancer » et « Demander un avis » : la relance proposable du dossier (`GET /api/relances`, la source unique).
  const veutRelances = principal.genre === "RELANCER" || principal.genre === "AVIS";
  const cleDossier = `${detail.etape}:${detail.evenements.reduce((dernier, e) => (e.createdAt > dernier ? e.createdAt : dernier), "")}`;
  const [relances, setRelances] = useState<RelancesProposables | null>(null);
  useEffect(() => {
    if (!veutRelances) return;
    let actif = true;
    appelApi<RelancesProposables>(`/api/relances?dossierId=${encodeURIComponent(detail.id)}`)
      .then((lues) => actif && setRelances(lues))
      .catch(() => undefined);
    return () => {
      actif = false;
    };
  }, [veutRelances, detail.id, cleDossier]);
  const relanceProposable = relances ? relances.devis[0] ?? relances.photos[0] ?? relances.avis[0] ?? null : null;
  // Rien de proposable (délai pas écoulé) : relancer par téléphone, le lien tel: en bouton principal.
  const affiche: GestePrincipal = principal.genre === "RELANCER" && relances && !relanceProposable && telephone ? { genre: "APPEL", libelle: "Relancer par téléphone" } : principal;

  /**
   * « Relancer » / « Demander un avis » : la relance proposable (SMS, ou la relecture du mail en STOP), sinon l'espace
   * du client. Stable (`useCallback`) : la liste peut la demander à l'ouverture, une fois les relances lues.
   */
  const lancerRelance = useCallback(
    (genre: "RELANCER" | "AVIS"): void => {
      const apresSms = { onFini: ({ copie }: { copie: boolean }) => copie && relireApres() };
      const a = relances?.avis[0];
      if (genre === "RELANCER") {
        const d = relances?.devis[0];
        if (d && !d.stop) return ouvrirEcranSms({ proposition: d.sms ?? undefined, demande: d.sms ? undefined : ({ action: "RELANCE_DEVIS", dossierId: d.dossierId, relance: { documentId: d.documentId, rang: d.rang } } as DemandeEcranSms), ...apresSms });
        if (d?.mail) return setRelectureMail((actuel) => ({ propositionId: d.mail!.propositionId, cle: (actuel?.cle ?? 0) + 1 }));
        const p = relances?.photos[0];
        if (p) return ouvrirEcranSms({ proposition: p.sms ?? undefined, demande: p.sms ? undefined : ({ action: "RELANCE_PHOTOS", dossierId: p.dossierId, relance: { type: "PHOTOS", rang: p.rang } } as DemandeEcranSms), ...apresSms });
      }
      if (a) return ouvrirEcranSms({ proposition: a.sms ?? undefined, demande: a.sms ? undefined : ({ action: "RELANCE_AVIS", dossierId: a.dossierId, relance: { type: "AVIS", rang: a.rang } } as DemandeEcranSms), ...apresSms });
      // Pas encore lu, ou rien de proposable et pas de numéro : l'espace du client, où tout se voit.
      setOuvertes((o) => new Set(o).add("espace"));
      window.setTimeout(() => defilerVers(["rubrique-espace"]), 50);
    },
    [relances, relireApres]
  );

  // Mission 22 (A4) : la ligne de la liste a demandé « Relancer » ou « Demander un avis » : une fois les relances lues, une seule fois.
  const [relanceLancee, setRelanceLancee] = useState(false);
  useEffect(() => {
    if ((gesteDemande !== "RELANCER" && gesteDemande !== "AVIS") || relanceLancee || !relances) return;
    const minuterie = window.setTimeout(() => {
      setRelanceLancee(true);
      lancerRelance(gesteDemande);
    }, 0);
    return () => window.clearTimeout(minuterie);
  }, [gesteDemande, relanceLancee, relances, lancerRelance]);

  function executer(geste: GestePrincipal | AutreGeste): void {
    switch (geste.genre) {
      case "TACHE":
        return;
      case "APPEL":
        // Sans numéro composable : les coordonnées, où le numéro se corrige.
        return ouvrirRubrique("coordonnees");
      case "SIMULATEUR":
        return routeur.push(`/simulateur?dossier=${encodeURIComponent(detail.id)}`);
      case "PUBLIER":
        return ouvrirRubrique("simulations");
      case "DEVIS":
        return faireDevis();
      case "FACTURE":
        return setGenerateur((actuel) => ({ type: "FACTURE", cle: (actuel?.cle ?? 0) + 1 }));
      case "ENCAISSER":
        return setEncaisser(true);
      case "DATE_CHANTIER":
        return setFeuilleDate(true);
      case "ETAPE":
      case "REPRISE":
        return geste.etape ? demanderEtape(geste.etape) : ouvrirRubrique("etapes");
      case "RELANCER":
      case "AVIS":
        return lancerRelance(geste.genre);
      case "DEPOSER_PDF":
        return deposerPdf();
      case "PROCHAINE_ACTION":
        return setModifierAction(true);
      case "ARCHIVER":
        return ouvrirRubrique("archivage");
    }
  }

  const surbrillance = gestes.retour && ordre.includes(gestes.retour.id) ? gestes.retour.id : null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* 1. L'en-tête de situation */}
      <EnTeteSituation detail={detail} espace={espace} maintenant={maintenant} onModifierAction={() => setModifierAction((v) => !v)} onFermer={onFermer} />

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="flex flex-col gap-5 px-4 py-4">
          {modifierAction ? (
            <section aria-label="Modifier la prochaine action" className="rounded-[11px] border border-trait bg-surface p-4">
              <ProchaineActionEditeur
                key={`${detail.id}:${detail.prochaineAction}:${detail.prochaineActionDate}`}
                detail={detail}
                maintenant={maintenant}
                onMisAJour={(nouveau) => {
                  onMisAJour(nouveau);
                  setModifierAction(false);
                }}
              />
              <button type="button" onClick={() => setModifierAction(false)} className={cn(BOUTON_SECONDAIRE, "mt-3")}>
                Fermer
              </button>
            </section>
          ) : null}

          {/* 2. Le bouton principal, et les autres gestes repliés */}
          <section aria-label="Le geste à faire" className="flex flex-col gap-2">
            <BoutonGesteDossier geste={affiche} actions={gestes.actions} onGeste={executer} telephone={telephone} onAppel={noterAppel} disabled={affiche.tache ? gestes.occupees.has(affiche.tache.id) : false} />
            <button type="button" aria-expanded={autresOuverts} onClick={() => setAutresOuverts((v) => !v)} className={cn(BOUTON_SECONDAIRE, "justify-between")}>
              Autres gestes
              <ChevronDown size={18} aria-hidden className={cn("text-texte-3", autresOuverts && "rotate-180")} />
            </button>
            {autresOuverts ? (
              <ul className="overflow-hidden rounded-[11px] border border-trait bg-surface">
                {autres.map((g) => (
                  <li key={`${g.genre}:${g.etape ?? ""}`} className="border-t border-trait first:border-t-0">
                    <button
                      type="button"
                      onClick={() => {
                        setAutresOuverts(false);
                        executer(g);
                      }}
                      className={cn("flex min-h-11 w-full items-center px-4 py-2 text-left text-corps-tel text-texte hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none md:text-corps", g.genre === "ETAPE" && g.etape === "PERDU" && "text-retard-texte")}
                    >
                      {g.libelle}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>

          {/* 3. À faire ici */}
          <AFaireIci taches={taches} maintenant={instant} occupees={gestes.occupees} surbrillance={surbrillance} actions={gestes.actions} />

          {/* 4. Ce qui s'est passé ici */}
          <CeQuiSestPasseIci cible={{ dossier: detail.id, client: detail.client?.id ?? null }} cle={cleDossier} maintenant={instant} />

          {/* 5. Les rubriques */}
          <RubriquesDossier
            detail={detail}
            ouvertes={ouvertes}
            onBasculer={basculer}
            etapeDemandee={etapeDemandee}
            gestes={{
              onMisAJour,
              onRecharger,
              onArchive,
              onGenerer: (type) => setGenerateur((actuel) => ({ type, cle: (actuel?.cle ?? 0) + 1 })),
              onRefaire: (devis) => setGenerateur((actuel) => ({ type: "DEVIS", cle: (actuel?.cle ?? 0) + 1, remplace: devis })),
              onFaireDevis: faireDevis,
              onAjouterDevis: ajouterDevis,
              onDeposerPdf: deposerPdf,
            }}
          />
        </div>
      </div>

      {encaisser ? <ModalePaiement detail={detail} moyenParDefaut="VIREMENT" titre={detail.paiements.resteDu > 0 ? "Encaisser le solde" : "Encaisser l'acompte"} onFermer={() => setEncaisser(false)} onFait={onMisAJour} /> : null}
      {generateur ? (
        <GenerateurDocument
          key={generateur.cle}
          detail={detail}
          typeInitial={generateur.type}
          remplace={generateur.remplace ?? null}
          variante={generateur.variante ?? false}
          onFermer={() => setGenerateur(null)}
          onGenere={(nouveau) => {
            onMisAJour(nouveau);
            toast.success(generateur.type === "FACTURE" ? "Facture générée" : "Devis généré", { description: detail.clientNom });
          }}
        />
      ) : null}
      {depotPdf ? <ModaleDocumentExistant key={`depot-${depotPdf}`} detail={detail} depotDevis onFermer={() => setDepotPdf(0)} onMisAJour={onMisAJour} /> : null}
      {depotGmail ? <ModaleDocumentExistant key={`gmail-${depotGmail}`} detail={detail} depotDevis pieceGmail={depotGmail} onFermer={() => setDepotGmail(null)} onMisAJour={onMisAJour} /> : null}
      <FeuilleDateChantier
        dossierId={feuilleDate ? detail.id : null}
        onFini={(pose) => {
          setFeuilleDate(false);
          if (pose) relireApres();
        }}
      />
      {relectureMail ? (
        <RelectureMail
          key={relectureMail.cle}
          propositionId={relectureMail.propositionId}
          dossierId={detail.id}
          onFini={(fait) => {
            setRelectureMail(null);
            if (fait) relireApres();
          }}
        />
      ) : null}
      <FeuillesRaccourcis gestes={gestes} maintenant={instant} relireApres={relireApres} />
    </div>
  );
}
