"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import type { DemandeEcranSms } from "@/components/pilotage/sms/EcranSms";
import { ouvrirEcranSms } from "@/components/pilotage/sms/EcranSms";
import { ErreurApi, envoyerJson, messageErreur } from "@/components/pilotage/client";
import { noterDebutAppel } from "@/components/pilotage/NotesAppel";
import type { DemandeOuverture } from "@/app/(pilotage)/dossiers/_components/PanneauDossier";
import type { ActionsLigne } from "@/app/(pilotage)/taches/_components/LigneTache";
import type { EtapeReponse } from "@/app/(pilotage)/taches/_components/FeuilleReponse";
import { estRubriqueDossier } from "@/lib/dossiers/constants";
import type { EntreeReponse, ResultatAnnulation, ResultatReponse } from "@/lib/a-faire/reponses";
import type { TacheVue } from "@/lib/a-faire/types";
import { nomDuTitre } from "@/lib/a-faire/affichage";
import { messageReponse } from "@/lib/v2/aujourdhui";
import { estSensible, propositionDe, raccourciDe } from "@/lib/v2/geste-pret";
import { memoriserReprendre } from "../reprendre-client";
import { toastAnnulable } from "./toastAnnulable";

/**
 * Mission 22 (A2) — le contrôleur des gestes d'Aujourd'hui, extrait de l'écran v1 (`EcranTaches.tsx`, intouché) :
 * répondre (Fait, Plus tard, Pas à faire : masque la tâche tout de suite, écrit la réponse, répond par une ligne et
 * « Annuler » 5 s), annuler, lancer (l'action du raccourci, sur place : appel, SMS, mail, espace, devis, encaissement,
 * simulateur, relance, date du chantier, validation, lead, cohérence, page), appeler (le lien tel:), ouvrir la fiche,
 * corriger, commencer (la mesure du temps réel) et noter le retour (`sessionStorage["taches:position"]`). Les états :
 * occupées, ouvert (le panneau ou la feuille affichée), réponse (la feuille Fait / Plus tard / Pas à faire), retour,
 * traitées (la série en cours). Les panneaux eux-mêmes : `PanneauxRaccourcis`.
 */
export type Ouvert =
  | { vue: "DOSSIER"; dossierId: string; demande: DemandeOuverture | null }
  | { vue: "MAIL"; messageId: string }
  | { vue: "LEAD"; leadId: string }
  | { vue: "RELANCE"; propositionId: string; dossierId: string }
  | { vue: "PLANIFIER"; dossierId: string };

export type Retour = { id: string; suivante: string | null };
export type DemandeReponse = { tache: TacheVue; etape: EtapeReponse; cle: number };

export const CLE_POSITION = "taches:position";

const ajouter = (ensemble: Set<string>, id: string) => new Set(ensemble).add(id);
const retirer = (ensemble: Set<string>, id: string) => {
  const suivant = new Set(ensemble);
  suivant.delete(id);
  return suivant;
};

/** La mesure du temps réel : sans attendre, sans bruit (ni compteurs relus, ni message en cas d'échec). */
export function commencer(id: string): void {
  void fetch(`/api/a-faire/${id}/commencer`, { method: "POST", keepalive: true }).catch(() => undefined);
}

export function useGestesTaches({ ordre, relire, relireApres, masquer, demasquer }: { ordre: readonly string[]; relire: () => Promise<void>; relireApres: () => void; masquer: (id: string) => void; demasquer: (id: string) => void }) {
  const routeur = useRouter();
  const [occupees, setOccupees] = useState<Set<string>>(new Set());
  const [retour, setRetour] = useState<Retour | null>(null);
  const [reponse, setReponse] = useState<DemandeReponse | null>(null);
  const [ouvert, setOuvert] = useState<Ouvert | null>(null);
  const [traitees, setTraitees] = useState<Set<string>>(new Set());

  const suivanteDe = useCallback(
    (id: string) => {
      const rang = ordre.indexOf(id);
      return rang >= 0 ? (ordre.slice(rang + 1)[0] ?? null) : null;
    },
    [ordre]
  );

  /* ── Revenir au même endroit ─────────────────────────────────────── */

  function noterRetour(tache: TacheVue) {
    const position = { id: tache.id, suivante: suivanteDe(tache.id), y: window.scrollY };
    setRetour({ id: position.id, suivante: position.suivante });
    try {
      sessionStorage.setItem(CLE_POSITION, JSON.stringify(position));
    } catch {
      // stockage indisponible : la surbrillance reste, pas le défilement après une navigation
    }
  }

  // Retour d'un écran quitté par un raccourci (simulateur, page du CRM) : le défilement et la surbrillance reviennent.
  useEffect(() => {
    const minuterie = window.setTimeout(() => {
      let position: (Retour & { y: number }) | null = null;
      try {
        position = JSON.parse(sessionStorage.getItem(CLE_POSITION) ?? "null") as (Retour & { y: number }) | null;
        sessionStorage.removeItem(CLE_POSITION);
      } catch {
        position = null;
      }
      if (!position?.id) return;
      setRetour({ id: position.id, suivante: position.suivante ?? null });
      window.scrollTo({ top: Number(position.y) || 0 });
    }, 0);
    return () => window.clearTimeout(minuterie);
  }, []);

  /* ── Répondre ────────────────────────────────────────────────────── */

  async function annuler(tache: TacheVue) {
    try {
      const resultat = await envoyerJson<ResultatAnnulation>(`/api/a-faire/${tache.id}/annuler`, "POST");
      demasquer(tache.id);
      setTraitees((t) => retirer(t, tache.id));
      toast.success("Annulé", { description: resultat.nonDefaits.length ? `Ne se défait pas : ${resultat.nonDefaits.join(" ; ")}.` : tache.titre });
      void relire();
    } catch (erreur) {
      toast.error("Annulation impossible", { description: messageErreur(erreur) });
    }
  }

  async function repondre(tache: TacheVue, entree: EntreeReponse) {
    setReponse(null);
    const suivante = suivanteDe(tache.id);
    setOccupees((o) => ajouter(o, tache.id));
    masquer(tache.id);
    setTraitees((t) => ajouter(t, tache.id));
    try {
      const resultat = await envoyerJson<ResultatReponse>(`/api/a-faire/${tache.id}/reponse`, "POST", entree);
      setRetour({ id: tache.id, suivante });
      toastAnnulable(messageReponse(tache, entree, resultat.tache, Date.now()), () => void annuler(tache), tache.titre);
      if (resultat.regle?.creee) toast.info("Une règle est proposée", { description: "La même raison revient souvent : elle attend ta décision dans « À valider »." });
      relireApres();
    } catch (erreur) {
      demasquer(tache.id);
      setTraitees((t) => retirer(t, tache.id));
      const propositionId = propositionDe(tache);
      if (erreur instanceof ErreurApi && erreur.status === 409 && propositionId) {
        toast.error("À valider avec son aperçu", { description: messageErreur(erreur), action: { label: "Ouvrir", onClick: () => routeur.push(`/validation?proposition=${encodeURIComponent(propositionId)}`) } });
      } else {
        toast.error("Réponse non enregistrée", { description: messageErreur(erreur) });
      }
    } finally {
      setOccupees((o) => retirer(o, tache.id));
    }
  }

  const demanderReponse = (tache: TacheVue, etape: EtapeReponse) => setReponse({ tache, etape, cle: Date.now() });

  /* ── Les raccourcis : l'action, sur place ───────────────────────── */

  const fermerRaccourci = useCallback(() => {
    setOuvert(null);
    relireApres();
  }, [relireApres]);

  async function corriger(tache: TacheVue): Promise<void> {
    const cle = tache.raccourci.cleCoherence;
    if (!cle) return ouvrirFiche(tache);
    setOccupees((o) => ajouter(o, tache.id));
    try {
      const resultat = await envoyerJson<{ corrigee: boolean; message: string }>("/api/coherence/corriger", "POST", { cle });
      if (resultat.corrigee) toast.success("Corrigé", { description: resultat.message });
      else toast.info(resultat.message);
      relireApres();
    } catch (erreur) {
      toast.error("Correction impossible", { description: messageErreur(erreur) });
    } finally {
      setOccupees((o) => retirer(o, tache.id));
    }
  }

  function aller(href: string) {
    if (/^https?:\/\//.test(href)) window.open(href, "_blank", "noopener,noreferrer");
    else routeur.push(href);
  }

  /** Un panneau de dossier qui s'ouvre d'ici : la mémoire « Reprendre » le note (l'adresse ne change pas). */
  function ouvrirDossier(dossierId: string, demande: DemandeOuverture | null) {
    memoriserReprendre({ chemin: `/dossiers?dossier=${encodeURIComponent(dossierId)}`, titre: "le dossier ouvert", dossierId });
    setOuvert({ vue: "DOSSIER", dossierId, demande });
  }

  /** La fiche de la tâche (le toucher de la ligne) : le dossier, le contact, le mail ; sinon l'action elle-même. */
  function ouvrirFiche(tache: TacheVue): void {
    const r = raccourciDe(tache);
    const dossierId = r.dossierId ?? tache.dossierId;
    const leadId = r.leadId ?? tache.leadId;
    if (r.genre === "MAIL" || r.genre === "ESPACE" || r.genre === "DOSSIER" || r.genre === "DEVIS" || r.genre === "ENCAISSER" || r.genre === "LEAD") return lancer(tache);
    noterRetour(tache);
    if (dossierId) ouvrirDossier(dossierId, null);
    else if (leadId) setOuvert({ vue: "LEAD", leadId });
    else if (r.href && r.genre !== "APPEL") aller(r.href);
    else demanderReponse(tache, "choix");
  }

  function lancer(tache: TacheVue): void {
    const r = raccourciDe(tache);
    const dossierId = r.dossierId ?? tache.dossierId;
    const leadId = r.leadId ?? tache.leadId;
    const messageId = r.messageId ?? (Array.isArray(tache.donnees.messageIds) && typeof tache.donnees.messageIds[0] === "string" ? tache.donnees.messageIds[0] : null);
    const dossier = (demande: Omit<DemandeOuverture, "cle"> | null): void => (dossierId ? ouvrirDossier(dossierId, demande ? { ...demande, cle: Date.now() } : null) : ouvrirFiche(tache));
    commencer(tache.id);
    noterRetour(tache);
    switch (r.genre) {
      case "APPEL":
        // Sans numéro lisible : la fiche (le numéro s'y corrige).
        return ouvrirFiche(tache);
      case "SMS":
        if (!r.sms) return ouvrirFiche(tache);
        return ouvrirEcranSms({ demande: r.sms as DemandeEcranSms, onFini: ({ copie }) => copie && relireApres() });
      case "MAIL":
        if (messageId) return setOuvert({ vue: "MAIL", messageId });
        return r.href ? aller(r.href) : ouvrirFiche(tache);
      case "ESPACE":
        return dossier({ rubrique: "messages" });
      case "DOSSIER":
        return dossier(estRubriqueDossier(r.rubrique) ? { rubrique: r.rubrique } : null);
      case "DEVIS":
        if (r.devis === "gmail" && r.pieceId) return dossier({ rubrique: "devis", devis: "gmail", piece: r.pieceId });
        return dossier({ rubrique: "devis", devis: r.devis === "pdf" ? "pdf" : "nouveau" });
      case "ENCAISSER":
        return dossier({ rubrique: "encaisser" });
      case "SIMULATEUR":
        return aller(r.href ?? (dossierId ? `/simulateur?dossier=${dossierId}` : "/simulateur"));
      case "RELANCE_MAIL":
        if (r.propositionId && dossierId) return setOuvert({ vue: "RELANCE", propositionId: r.propositionId, dossierId });
        if (r.propositionId) return aller(`/validation?proposition=${encodeURIComponent(r.propositionId)}`);
        return ouvrirFiche(tache);
      case "PLANIFIER":
        if (dossierId) return setOuvert({ vue: "PLANIFIER", dossierId });
        return ouvrirFiche(tache);
      case "VALIDER":
        // Garde : raccourciDe a déjà changé une proposition sensible en « Relire et valider ».
        return estSensible(tache) ? undefined : void repondre(tache, { reponse: "FAIT" });
      case "LEAD":
        if (leadId) return setOuvert({ vue: "LEAD", leadId });
        return r.href ? aller(r.href) : demanderReponse(tache, "choix");
      case "COHERENCE":
        return void corriger(tache);
      case "PAGE":
        // Une page externe s'ouvre par son lien (nouvel onglet) ; une page du CRM ici.
        if (r.href && !r.externe) aller(r.href);
        return;
    }
  }

  function appeler(tache: TacheVue) {
    const dossierId = tache.raccourci.dossierId ?? tache.dossierId;
    const leadId = tache.raccourci.leadId ?? tache.leadId;
    commencer(tache.id);
    noterRetour(tache);
    // La fin d'appel à 4 boutons revient au retour dans l'application ; `depuisFile` : pas de « Suivant » des Leads.
    if (leadId || dossierId) noterDebutAppel(leadId ?? `dossier:${dossierId}`, { nom: nomDuTitre(tache.titre), dossierId, depuisFile: true });
  }

  const actions: ActionsLigne = {
    onPrincipal: lancer,
    onAppel: appeler,
    onOuvrir: ouvrirFiche,
    onMenu: (tache) => demanderReponse(tache, "choix"),
    // Une proposition sensible : « Fait » (balayage, mode Commencer) ouvre son aperçu, rien ne se valide d'un geste.
    onFait: (tache) => (estSensible(tache) ? lancer(tache) : void repondre(tache, { reponse: "FAIT" })),
    onPlusTard: (tache) => demanderReponse(tache, "plusTard"),
    onIgnorer: (tache) => void repondre(tache, { reponse: "PAS_A_FAIRE", raison: "PAS_PERTINENT" }),
  };

  const ajouterTraitee = useCallback((id: string) => setTraitees((t) => ajouter(t, id)), []);
  const viderTraitees = useCallback(() => setTraitees(new Set()), []);

  return { occupees, retour, setRetour, reponse, setReponse, ouvert, traitees, ajouterTraitee, viderTraitees, noterRetour, repondre, annuler, lancer, appeler, ouvrirFiche, corriger, demanderReponse, fermerRaccourci, actions };
}

export type GestesTaches = ReturnType<typeof useGestesTaches>;
