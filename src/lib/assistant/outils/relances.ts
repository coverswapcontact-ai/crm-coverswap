import { z } from "zod/v4";
import { ErreurMetier } from "@/lib/commun/erreurs";
import { listerRelances, relancerDevis } from "@/lib/relances/service";
import { annulerProposition, listerPropositions, validerProposition } from "@/lib/validation/service";
import { definirOutil, format, lien } from "../definition";
import { cibler } from "./cible";
import { schemaCible } from "./lecture";

/**
 * Les relances de devis (mission 11) : ce que le CRM propose de relancer (et
 * pourquoi pas encore), relancer un dossier maintenant (le mail de relance,
 * relu, envoyé sous confirmation), annuler une relance proposée.
 */

export const outilVoirRelances = definirOutil({
  nom: "voir_relances",
  titre: "Les relances de devis : proposées, faites, à venir",
  description:
    "Pour chaque devis envoyé sans réponse : depuis combien de jours, combien de relances déjà faites (2 au plus par devis), la relance proposée en attente de validation s'il y en a une, ou quand la prochaine deviendra proposable (délai paramétré DELAI_RELANCE_DEVIS), et ce qui empêche une relance (pas d'adresse e-mail, client qui a refusé les mails). Rien n'est envoyé.",
  niveau: "LECTURE",
  schema: z.object({}),
  executer: async ({}, contexte) => {
    const r = await listerRelances(contexte.maintenant);
    if (r.devis.length === 0) return { texte: `Aucun devis en attente de réponse.${r.delai === null ? " Le délai de relance (DELAI_RELANCE_DEVIS) n'est pas renseigné : aucune relance ne sera proposée." : ""}`, donnees: r, liens: [lien("À valider", "/validation")] };
    const lignes = r.devis.map((d) => {
      const etat = d.propositionEnAttente ? `relance n° ${d.relancesFaites + 1} PROPOSÉE, à valider [proposition:${d.propositionEnAttente.id}]` : d.refusMail ? "pas de mail (le client a refusé les mails) : relancer par téléphone" : !d.adresse ? "pas d'adresse e-mail : relancer par téléphone ou SMS" : d.relancesFaites >= 2 ? "2 relances faites : plus de relance par mail" : d.prochaineProposableLe && new Date(d.prochaineProposableLe) > contexte.maintenant ? `prochaine relance proposable le ${format.jourCourt(new Date(d.prochaineProposableLe))}` : "relance proposable (à la prochaine passe, ou tout de suite par « relancer »)";
      return `- ${d.clientNom} : devis ${d.numero} de ${format.euros(d.totalHt)}, envoyé il y a ${d.joursDepuisEmission} jour(s), ${d.relancesFaites} relance(s) faite(s)${d.derniereRelanceLe ? ` (dernière le ${format.jourCourt(new Date(d.derniereRelanceLe))})` : ""} — ${etat} [dossier:${d.dossierId}]`;
    });
    return { texte: [`${r.devis.length} devis en attente de réponse${r.delai !== null ? ` (délai de relance : ${r.delai} jours)` : " (délai de relance non renseigné : rien n'est proposé automatiquement)"} :`, ...lignes].join("\n"), donnees: r, liens: [lien("À valider", "/validation"), lien("Dossiers", "/dossiers")] };
  },
});

export const outilRelancer = definirOutil({
  nom: "relancer",
  titre: "Relancer un devis par mail, maintenant",
  description:
    "Envoie la relance du devis d'un dossier sans attendre le délai : le mail est celui du CRM (relu dans l'aperçu), parti avec le devis en historique. Refusé si le client a refusé les mails, sans adresse, ou après 2 relances. Sensible : aperçu du mail puis confirmation.",
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

export const outilAnnulerRelance = definirOutil({
  nom: "annuler_relance",
  titre: "Annuler une relance proposée",
  description: "Rejette une relance de devis proposée et pas encore envoyée (identifiant de proposition rendu par « voir_relances »), avec un motif. Rien n'est envoyé ; la même relance ne sera pas reproposée.",
  niveau: "REVERSIBLE",
  schema: z.object({ propositionId: z.string().max(40), motif: z.string().trim().max(300).optional() }),
  executer: async (e) => {
    const p = (await listerPropositions({ statuts: ["EN_ATTENTE"], type: "ENVOI_MAIL", limite: 500 })).find((x) => x.id === e.propositionId && (x.contenu as { motif?: string }).motif === "RELANCE_DEVIS");
    if (!p) throw new ErreurMetier("Aucune relance proposée en attente avec cet identifiant (« voir_relances » les liste).", 404);
    await annulerProposition(p.id, e.motif ?? "Annulée depuis l'assistant");
    return { texte: `Relance annulée : « ${p.titre} ». Rien n'a été envoyé.`, donnees: { propositionId: p.id, dossierId: p.dossierId }, liens: p.dossierId ? [lien("Dossier", `/dossiers?dossier=${p.dossierId}`)] : [] };
  },
});

export const OUTILS_RELANCES_LECTURE = [outilVoirRelances];
export const OUTILS_RELANCES_ECRITURE = [outilRelancer, outilAnnulerRelance];
