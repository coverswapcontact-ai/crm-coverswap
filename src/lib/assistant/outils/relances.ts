import { z } from "zod/v4";
import { ErreurMetier } from "@/lib/commun/erreurs";
import { relancesPhotosProposables } from "@/lib/relances/photos";
import { listerRelances, relancerDevis, type DevisARelancer } from "@/lib/relances/service";
import { validerProposition } from "@/lib/validation/service";
import { definirOutil, format, lien } from "../definition";
import { cibler } from "./cible";
import { schemaCible } from "./lecture";
import { pluriel } from "@/lib/commun/format";

/**
 * Les relances de devis (mission 11) : ce que le CRM propose de relancer (et
 * pourquoi pas encore), relancer un dossier maintenant (le mail de relance,
 * relu, envoyé sous confirmation), annuler une relance proposée. Mission 14
 * (partie 6) : une relance proposable donne toujours le SMS à copier (le client
 * sans e-mail compris) et, s'il y en a une, la proposition de mail à valider ;
 * les espaces ouverts sans photo ni simulation ont leur relance photos.
 */

const PARTICIPES: Record<string, string> = { REJETEE: "rejeté", ANNULEE: "annulé", EXPIREE: "expiré" };

/** L'état d'une ligne de « voir_relances » : SMS à copier et mail pour une relance proposable, sinon ce qui l'attend. */
function etatDuDevis(d: DevisARelancer, maintenant: Date): string {
  if (d.relancesFaites >= 2) return "2 relances faites : plus de relance";
  const traite = d.mailTraite;
  if (traite?.statut === "VALIDEE") return `mail de relance n° ${d.rang} validé, en cours d'envoi [proposition:${traite.propositionId}] : la relance est faite`;
  const mailEnAttente = d.mail ? `relance n° ${d.rang} PROPOSÉE, à valider [proposition:${d.mail.propositionId}]` : null;
  const sansMail = d.refusMail ? "le client a refusé les mails" : !d.adresse ? "pas d'adresse e-mail" : null;
  if (!d.proposable) {
    if (mailEnAttente) return mailEnAttente;
    const date = d.prochaineProposableLe && new Date(d.prochaineProposableLe) > maintenant ? `prochaine relance proposable le ${format.jourCourt(new Date(d.prochaineProposableLe))}` : "relance proposable";
    if (d.stop) return `${date} (${sansMail ? `ni mail (${sansMail}) ni SMS (a répondu STOP) : par téléphone` : "par mail seulement : a répondu STOP"})`;
    return sansMail ? `${date} (par SMS : ${sansMail})` : date;
  }
  const sms = d.stop ? "Pas de SMS : il a répondu STOP" : d.sms ? `SMS (${d.sms.code}) : « ${d.sms.texte} »` : "SMS indisponible (voir la fiche du dossier)";
  let mail: string;
  if (mailEnAttente) mail = `Mail : ${mailEnAttente}`;
  else if (traite?.statut === "ECHEC") mail = `Mail de relance en échec [proposition:${traite.propositionId}] : le réessayer depuis « À valider »${d.stop ? "" : ", ou copier le SMS (qui l'annule)"}`;
  else if (traite || sansMail) {
    // Le mail de ce rang n'est jamais reproposé (clé unique) : le SMS seul, ou le téléphone pour un numéro en STOP.
    const pourquoi = traite ? `Mail de ce rang déjà ${PARTICIPES[traite.statut] ?? "traité"} : pas de nouveau mail` : `Pas de mail : ${sansMail}`;
    mail = `${pourquoi}${d.stop ? ", relancer par téléphone" : ", le SMS suffit"}`;
  } else mail = "Mail : proposé à la prochaine passe (ou tout de suite par « relancer »)";
  return `relance n° ${d.rang} proposable. ${sms}. ${mail}`;
}

export const outilVoirRelances = definirOutil({
  nom: "voir_relances",
  titre: "Les relances : devis (proposées, faites, à venir) et espaces sans photo",
  description:
    "Pour chaque devis envoyé sans réponse : depuis combien de jours, combien de relances déjà faites (mail ou SMS, 2 au plus par devis), et quand la prochaine devient proposable (délai paramétré DELAI_RELANCE_DEVIS). Une relance proposable donne le SMS à copier (toujours, même sans e-mail, sauf numéro en STOP) et la proposition de mail à valider s'il y en a une ; un mail de relance validé et pas encore parti vaut relance faite. Puis les relances photos : espaces ouverts depuis DELAI_RELANCE_PHOTOS jours sans photo ni simulation, avec le SMS du lien à copier. Rien n'est envoyé : Lucas copie le SMS (la copie compte la relance).",
  niveau: "LECTURE",
  schema: z.object({}),
  executer: async ({}, contexte) => {
    const [r, photos] = await Promise.all([listerRelances(contexte.maintenant), relancesPhotosProposables(contexte.maintenant)]);
    const donnees = { ...r, photos };
    const lignesPhotos = photos.map(
      (p) =>
        `- ${p.clientNom} : espace ouvert il y a ${pluriel(p.joursDepuisOuverture, "jour")}, ni photo ni simulation — relance photos n° ${p.rang}${p.lienCommunique ? "" : " (lien jamais envoyé)"}. ${p.sms ? `SMS (${p.sms.code}) : « ${p.sms.texte} »` : "SMS indisponible (voir la fiche du dossier)"} [dossier:${p.dossierId}]`
    );
    const blocPhotos = lignesPhotos.length ? ["", `${pluriel(photos.length, "relance photos proposable", "relances photos proposables")} :`, ...lignesPhotos] : [];
    if (r.devis.length === 0) return { texte: [`Aucun devis en attente de réponse (délai de relance : ${r.delai} jours${r.delaiParDefaut ? ", valeur par défaut" : ""}).`, ...blocPhotos].join("\n"), donnees, liens: [lien("À valider", "/validation")] };
    const lignes = r.devis.map(
      (d) =>
        `- ${d.clientNom} : devis ${d.numero} de ${format.euros(d.totalHt)}, envoyé il y a ${pluriel(d.joursDepuisEmission, "jour")}, ${pluriel(d.relancesFaites, "relance faite", "relances faites")}${d.derniereRelanceLe ? ` (dernière le ${format.jourCourt(new Date(d.derniereRelanceLe))})` : ""} — ${etatDuDevis(d, contexte.maintenant)} [dossier:${d.dossierId}]`
    );
    return { texte: [`${r.devis.length} devis en attente de réponse (délai de relance : ${r.delai} jours${r.delaiParDefaut ? ", valeur par défaut tant que DELAI_RELANCE_DEVIS n'est pas renseigné" : ""}) :`, ...lignes, ...blocPhotos].join("\n"), donnees, liens: [lien("À valider", "/validation"), lien("Dossiers", "/dossiers")] };
  },
});

export const outilRelancer = definirOutil({
  nom: "relancer",
  titre: "Relancer un devis par mail, maintenant",
  description:
    "Envoie la relance du devis d'un dossier par mail, sans attendre le délai : le mail est celui du CRM (relu dans l'aperçu), parti avec le devis en historique. Refusé si le client a refusé les mails, sans adresse (le SMS de relance est alors dans « lister » RELANCES), si le mail de ce rang a déjà été validé, rejeté, annulé ou a expiré (il n'est jamais reproposé), ou après 2 relances (mail ou SMS). Sensible : aperçu du mail puis confirmation.",
  niveau: "SENSIBLE",
  schema: schemaCible.extend({ documentId: z.string().max(40).optional().describe("Le devis à relancer ; à défaut le dernier devis envoyé du dossier.") }),
  apercu: async (e, contexte) => {
    const r = await cibler(e, "DOSSIER");
    if (r.ambigu) return r.ambigu.texte;
    if (!r.ids.dossierId) throw new ErreurMetier(`${r.ids.nom} n'a pas de dossier.`, 409);
    const p = await relancerDevis(r.ids.dossierId, { maintenant: contexte.maintenant, forcer: true, documentId: e.documentId, apercuSeulement: true });
    return `Je vais envoyer à ${p.a} la relance n° ${p.rang} du devis ${p.numero} de ${r.ids.nom} :\nObjet : ${p.objet}\n${p.texte}`;
  },
  executer: async (e, contexte) => {
    const r = await cibler(e, "DOSSIER");
    if (r.ambigu) return r.ambigu;
    if (!r.ids.dossierId) throw new ErreurMetier(`${r.ids.nom} n'a pas de dossier.`, 409);
    const p = await relancerDevis(r.ids.dossierId, { maintenant: contexte.maintenant, forcer: true, documentId: e.documentId });
    await validerProposition(p.propositionId);
    return { texte: `Relance n° ${p.rang} du devis ${p.numero} envoyée à ${p.a} (${r.ids.nom}). Inscrite dans l'historique du dossier.`, donnees: { propositionId: p.propositionId, rang: p.rang, numero: p.numero, dossierId: r.ids.dossierId }, liens: [lien("Dossier", `/dossiers?dossier=${r.ids.dossierId}`)] };
  },
});

export const OUTILS_RELANCES_ECRITURE = [outilRelancer];
