import { alerter, type ResultatCanal } from "@/lib/alertes/canaux";
import { LIBELLES_PRIORITE, type Priorite } from "./priorite";
import { LIBELLES_TYPE_PROJET, libelleSourceLead } from "./constantes";

/**
 * Push d'une demande venue du site (simulateur, devis, contact) : même promesse
 * que pour un lead Meta — le téléphone sonne, avec le numéro en bouton d'appel.
 * Avant le 21/09/2026 ces demandes ne déclenchaient qu'un mail.
 *
 * Le lien mène au dossier quand la demande en a ouvert un (simulation), à la
 * fiche du lead sinon.
 */
export async function notifierDemandeDuSite(demande: {
  leadId: string;
  dossierId?: string | null;
  prenom: string;
  nom: string;
  telephone: string;
  ville: string | null;
  typeProjet: string;
  source: string;
  campagne?: string | null;
  nouveau: boolean;
  simulations: number;
  photos: number;
  message?: string | null;
  priorite?: { classe: Priorite; motif: string } | null;
}): Promise<ResultatCanal[]> {
  const base = (process.env.NEXT_PUBLIC_APP_URL || "https://crm.coverswap.fr").replace(/\/$/, "");
  const classe = demande.priorite?.classe ?? null;
  const devis = demande.source === "SITE_DEVIS";
  const prenom = demande.prenom && demande.prenom !== "Inconnu" ? demande.prenom : demande.nom;
  const quoi = demande.simulations > 0 ? "Simulation sur le site" : devis ? "Demande de devis" : libelleSourceLead(demande.source);
  const lignes = [
    `${demande.prenom !== "Inconnu" ? demande.prenom : ""} ${demande.nom !== "Inconnu" ? demande.nom : ""}`.trim() || "Contact sans nom",
    demande.telephone ? `📞 ${demande.telephone}` : "Téléphone non communiqué",
    `Projet : ${LIBELLES_TYPE_PROJET[demande.typeProjet] ?? demande.typeProjet}${demande.ville ? ` · ${demande.ville}` : ""}`,
    demande.priorite ? `${LIBELLES_PRIORITE[demande.priorite.classe].toUpperCase()} — ${demande.priorite.motif}` : null,
    demande.simulations > 0 ? `${demande.simulations} simulation(s) — ${demande.dossierId ? "dossier ouvert, photos rangées" : "à retrouver sur sa fiche"}` : null,
    demande.photos > 0 ? `${demande.photos} photo(s) jointe(s)` : null,
    demande.campagne ? `Campagne : ${demande.campagne}` : null,
    demande.message ? `« ${demande.message.slice(0, 160)} »` : null,
    demande.nouveau ? null : "Ce contact existait déjà : la demande a été rattachée à sa fiche.",
  ].filter(Boolean) as string[];

  return alerter(
    {
      titre: `${classe === "PRIORITAIRE" ? "PRIORITAIRE — " : classe === "A_ECARTER" ? "Hors zone — " : ""}${quoi} — ${prenom}${demande.ville ? ` (${demande.ville})` : ""}`,
      texte: lignes.join("\n"),
      lien: demande.dossierId ? `${base}/dossiers?dossier=${demande.dossierId}` : `${base}/leads?lead=${demande.leadId}`,
      libelleLien: demande.dossierId ? "Ouvrir le dossier" : "Ouvrir la fiche",
      telephone: demande.telephone || undefined,
      urgence: classe === "PRIORITAIRE" || devis ? 5 : classe === "A_ECARTER" || classe === "SECONDAIRE" ? 3 : 4,
    },
    { origine: "lead-site" }
  );
}
