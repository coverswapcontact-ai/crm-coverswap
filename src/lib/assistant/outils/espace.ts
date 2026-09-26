import { z } from "zod/v4";
import { ErreurMetier } from "@/lib/commun/erreurs";
import { A_COMPLETER, compterMessagesNonLus, LIBELLES_SOURCE_MESSAGE, marquerMessagesLus, messagesEspace, repondreDansLEspace } from "@/lib/espace/messages";
import { CODES_LIEN_MAIL, proposerLienParSms } from "@/lib/mail/lien-espace";
import { definirOutil, format, lien } from "../definition";
import { cibler } from "./cible";
import { schemaCible } from "./lecture";
import { accord, pluriel } from "@/lib/commun/format";

/**
 * L'espace client depuis l'assistant (mission 10) : lire ce que les clients
 * écrivent dans leur espace (non lus d'abord), leur répondre dedans. Une
 * réponse est sensible : aperçu, confirmation de Lucas, puis le message part
 * dans l'espace et la notification par la mécanique existante.
 */

const ligneMessage = (m: { id: string; le: string; clientNom: string; auteur: string; source: keyof typeof LIBELLES_SOURCE_MESSAGE; texte: string; luLe: string | null; dossierId: string }) =>
  `${format.jourCourt(m.le)} ${new Date(m.le).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" })} · ${m.auteur === "LUCAS" ? "CoverSwap" : m.clientNom} (${LIBELLES_SOURCE_MESSAGE[m.source]}${m.auteur === "CLIENT" && !m.luLe ? ", NON LU" : m.auteur === "LUCAS" && !m.luLe ? ", pas encore vue par le client" : ""}) : « ${m.texte.length > 400 ? `${m.texte.slice(0, 400)}…` : m.texte} » [dossier:${m.dossierId}] [message:${m.id}]`;

export const outilMessagesEspace = definirOutil({
  nom: "messages_espace",
  titre: "Les messages des clients dans leur espace",
  description:
    "Ce que les clients ont écrit dans leur espace (« Écrire à CoverSwap », commentaire sur une simulation, demande d'autre proposition) et ce qui leur a été répondu. Par défaut : les messages NON LUS, tous clients. Avec une cible (nom ou identifiant) : le fil de ce client, réponses comprises. « marquer_lus » : vrai pour marquer lus les messages du client visé sans lui répondre. Pour répondre : « repondre_espace ».",
  niveau: "LECTURE",
  schema: schemaCible.extend({ tout: z.boolean().optional().describe("Vrai : tous les messages récents, lus compris (sans cible)."), limite: z.number().int().min(1).max(60).optional() }),
  executer: async (e) => {
    const cible = e.dossierId || e.clientId || e.leadId || e.nom;
    if (cible) {
      const r = await cibler(e);
      if (r.ambigu) return r.ambigu;
      if (!r.ids.dossierId) return { texte: `${r.ids.nom} n'a pas de dossier, donc pas d'espace ni de messages.` };
      const liste = await messagesEspace({ dossierId: r.ids.dossierId, limite: e.limite ?? 30 });
      if (liste.length === 0) return { texte: `Aucun message échangé avec ${r.ids.nom} dans son espace.`, liens: [lien("Dossier", `/dossiers?dossier=${r.ids.dossierId}`)] };
      const nonLus = liste.filter((m) => m.auteur === "CLIENT" && !m.luLe).length;
      return { texte: `${pluriel(liste.length, "message")} avec ${r.ids.nom}${nonLus ? `, ${pluriel(nonLus, "non lu")}` : ""} (du plus récent au plus ancien) :\n${liste.map(ligneMessage).join("\n")}`, donnees: { nonLus, messages: liste }, liens: [lien("Dossier", `/dossiers?dossier=${r.ids.dossierId}`)] };
    }
    const liste = await messagesEspace({ nonLus: !e.tout, limite: e.limite ?? 30 });
    const total = await compterMessagesNonLus();
    if (liste.length === 0) return { texte: e.tout ? "Aucun message d'espace récent." : "Aucun message d'espace non lu.", donnees: { nonLus: total, messages: [] } };
    return { texte: `${e.tout ? `${pluriel(liste.length, "message récent", "messages récents")}, ${pluriel(total, "non lu")}` : `${pluriel(total, "message non lu", "messages non lus")}`} :\n${liste.map(ligneMessage).join("\n")}`, donnees: { nonLus: total, messages: liste }, liens: [lien("Espaces clients", "/espaces")] };
  },
});

export const outilMarquerMessagesLus = definirOutil({
  nom: "marquer_messages_lus",
  titre: "Marquer lus les messages d'espace d'un client",
  description: "Marque lus les messages qu'un client a écrits dans son espace, sans lui répondre (Lucas l'a appelé, ou a répondu autrement). Réversible par nature : ils restent dans le fil.",
  niveau: "REVERSIBLE",
  schema: schemaCible,
  executer: async (e) => {
    const r = await cibler(e);
    if (r.ambigu) return r.ambigu;
    if (!r.ids.dossierId) throw new ErreurMetier(`${r.ids.nom} n'a pas de dossier.`, 409);
    const n = await marquerMessagesLus(r.ids.dossierId);
    return { texte: n ? `${pluriel(n, "message")} de ${r.ids.nom} ${accord(n, "marqué lu", "marqués lus")}.` : `Aucun message non lu chez ${r.ids.nom}.`, liens: [lien("Dossier", `/dossiers?dossier=${r.ids.dossierId}`)] };
  },
});

export const outilRepondreEspace = definirOutil({
  nom: "repondre_espace",
  titre: "Répondre à un client dans son espace",
  description:
    "Envoie une réponse dans l'espace du client (onglet Contact) et le prévient par la notification de l'espace (mail, si son adresse est connue). Le texte est le tien, d'après ce que Lucas a dit : court, vouvoiement, sans prix ni date qui ne soient pas dans le CRM — écris « [à compléter] » pour ce qui manque : l'envoi est alors bloqué. Sensible : aperçu, puis confirmation de Lucas. Les messages du client sont marqués lus et la main lui passe.",
  niveau: "SENSIBLE",
  schema: schemaCible.extend({ texte: z.string().min(2).max(2000).describe("La réponse, telle qu'elle sera lue par le client.") }),
  apercu: async (e) => {
    const r = await cibler(e);
    if (r.ambigu) return r.ambigu.texte;
    if (!r.ids.dossierId) return `${r.ids.nom} n'a pas de dossier ni d'espace : rien ne peut partir.`;
    if (A_COMPLETER.test(e.texte)) return `La réponse à ${r.ids.nom} contient « [à compléter] » : elle ne partira pas en l'état. Complète-la d'abord :\n« ${e.texte} »`;
    return `Je vais répondre à ${r.ids.nom} dans son espace (onglet Contact), et il sera prévenu par la notification de l'espace :\n« ${e.texte.trim()} »`;
  },
  executer: async (e, contexte) => {
    const r = await cibler(e);
    if (r.ambigu) return r.ambigu;
    if (!r.ids.dossierId) throw new ErreurMetier(`${r.ids.nom} n'a pas de dossier ni d'espace : ouvre-les d'abord (« ouvrir_dossier », « lien_espace »).`, 409);
    const envoi = await repondreDansLEspace(r.ids.dossierId, e.texte, { commande: contexte.commande });
    return {
      texte: `Réponse envoyée dans l'espace de ${envoi.clientNom} : « ${envoi.message.texte} ». ${envoi.notification.programme ? "Notification par mail programmée." : `Pas de notification par mail : ${envoi.notification.raison ?? "raison inconnue"} — dis-le à Lucas (un SMS ou un appel peut prendre le relais).`}${envoi.messagesLus ? ` ${pluriel(envoi.messagesLus, "message du client marqué lu", "messages du client marqués lus")}.` : ""}`,
      donnees: { message: envoi.message, notification: envoi.notification, lien: envoi.lien },
      liens: [lien("Dossier", `/dossiers?dossier=${r.ids.dossierId}`)],
    };
  },
});

export const outilLienEspace = definirOutil({
  nom: "lien_espace",
  titre: "Le lien de l'espace et le SMS prêt à copier (rien d'envoyé)",
  description:
    "Pour un lead sans e-mail (Meta) ou quand Lucas préfère le SMS : ouvre l'espace du client (et son dossier s'il manque), n'envoie RIEN, et rend le lien et le texte du SMS prêt à copier, avec la phrase du code : LIEN_ESPACE (après un appel intéressé : déposer les photos), INJOIGNABLE_LIEN (« j'ai essayé de vous joindre »), LIEN_ESPACE_RAPPEL (renvoyer le lien). Tracé dans le dossier « lien communiqué par SMS » ; la main passe au client. Pour envoyer par mail : « envoyer_lien_espace ».",
  niveau: "REVERSIBLE",
  schema: schemaCible.extend({ code: z.enum(CODES_LIEN_MAIL).optional().describe("LIEN_ESPACE par défaut.") }),
  executer: async (e) => {
    const r = await cibler(e);
    if (r.ambigu) return r.ambigu;
    const p = await proposerLienParSms({ dossierId: r.ids.dossierId, leadId: r.ids.leadId, code: e.code ?? "LIEN_ESPACE" });
    return {
      texte: `Espace ${p.nouveau ? "ouvert" : "déjà ouvert"} pour ${r.ids.nom}${p.telephone ? ` (${p.telephone})` : ""}. Rien n'a été envoyé : voici le lien et le SMS à copier.\nLien : ${p.lien}\nSMS :\n${p.sms}${p.email ? `\n(Il a aussi un e-mail : « envoyer_lien_espace » peut l'envoyer par mail.)` : ""}`,
      donnees: { dossierId: p.dossierId, lien: p.lien, sms: p.sms, telephone: p.telephone, code: p.code, nouveau: p.nouveau },
      liens: [lien("Dossier", `/dossiers?dossier=${p.dossierId}`)],
    };
  },
});

export const OUTILS_ESPACE_LECTURE = [outilMessagesEspace];
export const OUTILS_ESPACE_ECRITURE = [outilMarquerMessagesLus, outilRepondreEspace, outilLienEspace];
