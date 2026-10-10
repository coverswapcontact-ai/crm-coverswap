import { z } from "zod/v4";
import prisma from "@/lib/prisma";
import { ErreurMetier } from "@/lib/commun/erreurs";
import { creerLienDepot } from "@/lib/fichiers-depot/jetons";
import { MINUTES_VALIDITE_LIEN } from "@/lib/fichiers-depot/types";
import { chargerEtat } from "@/lib/messagerie/etat";
import { dateAbsolue } from "@/lib/messagerie/horaires";
import { ouEnEstParRegles } from "@/lib/messagerie/ou-en-est";
import { planifier } from "@/lib/messagerie/planificateur";
import { libelleDuCode } from "@/lib/messagerie/redaction";
import { lancementMessagerie, suiviPour } from "@/lib/messagerie/suivis";
import { LIBELLES_RAISON_NON_ENVOI, RAISONS_NON_ENVOI, type OuEnEst } from "@/lib/messagerie/types";
import { definirOutil, lien, type ResultatOutil } from "../definition";
import { cibler, type Ids } from "./cible";
import { schemaCible } from "./lecture";

/**
 * Mission 25 (lot 7) — la messagerie pilotée depuis Claude : les mêmes gestes que les boutons (cahier, § Les outils MCP).
 * Rien n'est envoyé par ces outils : ils rapportent (un SMS parti du téléphone de Lucas, la réponse d'un client, une
 * note) et préparent (la messagerie analyse et propose la suite). Alignés sur les outils existants : `noter_sms` reste
 * pour un SMS écrit hors de la messagerie, `noter_appel` pour un appel, `lire_fiche` pour tout le dossier.
 *
 * - file_du_jour : ce qui est à faire maintenant, dans l'ordre du mode « Un par un », avec le texte de chaque message ;
 * - confirmer_envoi : « Envoyé à Mme X à 14 h 20 », avec le texte réellement envoyé s'il a changé ;
 * - noter_reponse_client : le texte du client et son heure (ses photos par un lien de dépôt) ; l'analyse suit ;
 * - noter_note : une note après appel ou un contexte ; l'analyse suit (rappel, pause « va signer », faits) ;
 * - reponse_proposee : la réponse préparée pour un client ;
 * - reporter_message : plus tard (1 h, 3 h, demain 9 h 30, ou une date) ;
 * - non_envoye : un message refusé, avec la raison ;
 * - pause_client : relances en pause jusqu'à une date (ou reprises) ;
 * - ou_en_est : « Où on en est » et les dix dernières lignes du journal d'un dossier ou d'un lead.
 */

const schemaMessage = {
  message_id: z.string().max(40).optional().describe("Identifiant du message préparé (rendu par « file_du_jour » ou « reponse_proposee »). À défaut : la cible."),
  cible: schemaCible.optional().describe("Le client (nom ou identifiant) : son seul message en attente est choisi ; s'il en a plusieurs, l'outil les liste."),
};

const OUVERTS = ["PREVU", "A_ENVOYER", "A_VALIDER"];
const extrait = (texte: string, n = 160) => (texte.length > n ? `${texte.slice(0, n - 1)}…` : texte);
const heureParis = (date: Date) => date.toLocaleTimeString("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit" }).replace(":", " h ");

/** Le suivi d'une cible (créé s'il manque, comme à l'ouverture de sa conversation), ou le résultat « plusieurs candidats ». */
async function suiviDe(cible: z.output<typeof schemaCible>): Promise<{ suivi: NonNullable<Awaited<ReturnType<typeof suiviPour>>>; ids: Ids } | { ambigu: ResultatOutil }> {
  const c = await cibler(cible);
  if (c.ambigu) return { ambigu: c.ambigu };
  const suivi = await suiviPour({ dossierId: c.ids.dossierId ?? undefined, leadId: c.ids.dossierId ? undefined : (c.ids.leadId ?? undefined) }, { geste: true });
  if (!suivi) throw new ErreurMetier(`${c.ids.nom} n'a ni dossier ni lead : pas de conversation à suivre.`, 404);
  return { suivi, ids: c.ids };
}

type MessageVise = { id: string; suiviId: string; code: string; statut: string; texte: string; nom: string };

/** Le message visé : par son identifiant, ou le seul message ouvert de la cible (sinon la liste, sans choisir). */
async function messageVise(e: { message_id?: string; cible?: z.output<typeof schemaCible> }, statuts: string[] = OUVERTS): Promise<{ message: MessageVise; ambigu?: undefined } | { message?: undefined; ambigu: ResultatOutil }> {
  const nomDu = async (suiviId: string) => (await prisma.suivi.findUnique({ where: { id: suiviId }, select: { nom: true } }))?.nom ?? "ce client";
  if (e.message_id) {
    const message = await prisma.messagePrepare.findUnique({ where: { id: e.message_id } });
    if (!message) throw new ErreurMetier("Message introuvable : redemande « file_du_jour ».", 404);
    return { message: { ...message, nom: await nomDu(message.suiviId) } };
  }
  if (!e.cible) throw new ErreurMetier("Indique le message (message_id) ou le client (cible).", 400);
  const r = await suiviDe(e.cible);
  if ("ambigu" in r) return { ambigu: r.ambigu };
  const ouverts = await prisma.messagePrepare.findMany({ where: { suiviId: r.suivi.id, statut: { in: statuts } }, orderBy: { prevuLe: "asc" } });
  if (!ouverts.length) throw new ErreurMetier(`Aucun message en attente pour ${r.ids.nom}.`, 404);
  if (ouverts.length > 1) {
    return {
      ambigu: {
        texte: `${r.ids.nom} a ${ouverts.length} messages en attente, je ne choisis pas à ta place :\n${ouverts.map((m) => `- ${m.id} · ${libelleDuCode(m.code)} · « ${extrait(m.texte, 90)} »`).join("\n")}\nDis-moi lequel (ou rappelle l'outil avec son message_id).`,
        donnees: ouverts.map((m) => ({ id: m.id, code: m.code, texte: m.texte, statut: m.statut })),
      },
    };
  }
  return { message: { ...ouverts[0], nom: r.ids.nom } };
}

const lignesOuEnEst = (o: OuEnEst | null) => (o ? `📍 ${o.situation}\n👤 ${o.client}\n➡️ ${o.suite}` : "Pas encore lu par la messagerie.");

/* ── file_du_jour ──────────────────────────────────────────────── */

const TITRES = { REPONSE: "Réponse à traiter", MESSAGE: "Message à envoyer", APPEL: "Appel à passer", PROPOSITION: "À valider" } as const;

const outilFileDuJour = definirOutil({
  nom: "file_du_jour",
  titre: "La file du jour de la messagerie",
  description:
    "Ce qui est à faire maintenant dans la messagerie, dans l'ordre du mode « Un par un » : les réponses des clients à traiter, puis les messages dont l'heure est passée (ceux d'hier non confirmés en tête), puis les appels à passer, puis les propositions à valider. Pour chaque carte : le client, « Où on en est », le message du client s'il y en a un, et le texte du message préparé avec son identifiant (pour « confirmer_envoi », « reporter_message », « non_envoye »). Lecture seule : rien n'est envoyé.",
  niveau: "LECTURE",
  schema: z.object({}),
  executer: async (_e, contexte) => {
    const { fileDuJour } = await import("@/lib/messagerie/vues");
    const { cartes, compteurs, pause } = await fileDuJour(contexte.maintenant);
    if (!cartes.length) return { texte: `${pause ? "La messagerie est en pause (rien n'est préparé). " : ""}Tout est traité pour aujourd'hui : rien n'attend.`, donnees: { cartes: [], compteurs, pause }, liens: [lien("Messagerie", "/messagerie")] };
    const morceaux = cartes.map((c, i) =>
      [
        `${i + 1}. ${TITRES[c.genre]} — ${c.nom}`,
        c.ouEnEst ? `   📍 ${c.ouEnEst.situation}` : null,
        c.dernierMessageClient ? `   Le client : « ${extrait(c.dernierMessageClient.texte)} »` : null,
        c.message ? `   ${libelleDuCode(c.message.code)} (${c.message.canal}, id ${c.message.id}) : « ${c.message.texte} »` : `   ${c.raison}`,
      ]
        .filter(Boolean)
        .join("\n")
    );
    return {
      texte: `${pause ? "Messagerie en pause. " : ""}File du jour : ${compteurs.REPONSE} réponse(s), ${compteurs.MESSAGE} message(s), ${compteurs.APPEL} appel(s), ${compteurs.PROPOSITION} à valider.\n\n${morceaux.join("\n\n")}\n\nRien n'est envoyé d'ici : Lucas envoie depuis son téléphone, puis tu confirmes avec « confirmer_envoi ».`,
      donnees: { cartes, compteurs, pause },
      liens: [lien("Un par un", "/messagerie?vue=un-par-un")],
    };
  },
});

/* ── confirmer_envoi ───────────────────────────────────────────── */

const outilConfirmerEnvoi = definirOutil({
  nom: "confirmer_envoi",
  titre: "Confirmer l'envoi d'un message préparé",
  description:
    "Lucas dit avoir envoyé un message préparé par la messagerie (« Envoyé à Mme X à 14 h 20 ») : le message passe « Envoyé », entre dans sa conversation et son dossier (comme le bouton ✅ Envoyé), et la messagerie prépare la suite. « texte » : le texte réellement envoyé, s'il l'a modifié ; « heure » : le moment de l'envoi (ISO 8601), sinon maintenant. Rien n'est envoyé par cet outil. Pour un SMS écrit hors de la messagerie : « noter_sms ».",
  niveau: "REVERSIBLE",
  schema: z.object({ ...schemaMessage, texte: z.string().trim().max(1600).optional().describe("Le texte réellement envoyé, s'il diffère du texte préparé."), heure: z.iso.datetime({ offset: true }).optional().describe("Le moment de l'envoi, ISO 8601 ; sinon maintenant.") }),
  executer: async (e, contexte) => {
    const v = await messageVise(e, [...OUVERTS, "NON_ENVOYE"]);
    if (v.ambigu) return v.ambigu;
    const { confirmerEnvoi } = await import("@/lib/messagerie/gestes");
    const le = e.heure ? new Date(e.heure) : contexte.maintenant;
    if (le.getTime() > contexte.maintenant.getTime() + 60_000) throw new ErreurMetier("L'heure d'envoi est dans le futur : redis-moi quand le message est parti.", 400);
    const r = await confirmerEnvoi(v.message.id, { texte: e.texte ?? null, le, origine: "ASSISTANT" }, contexte.maintenant);
    if ("deja" in r && r.deja) return { texte: `${libelleDuCode(v.message.code)} pour ${v.message.nom} était déjà noté envoyé.`, donnees: { messageId: v.message.id } };
    return {
      texte: `Noté : ${libelleDuCode(v.message.code)} envoyé à ${v.message.nom} à ${heureParis(le)}${e.texte ? " (texte modifié, gardé tel quel)" : ""}. La messagerie prépare la suite.`,
      donnees: { messageId: v.message.id, suiviId: v.message.suiviId, envoyeLe: le.toISOString() },
      liens: [lien(`Conversation de ${v.message.nom}`, `/messagerie?suivi=${v.message.suiviId}`)],
    };
  },
});

/* ── noter_reponse_client ──────────────────────────────────────── */

/** Les messages préparés en réponse (ouverts) d'un suivi, en texte. */
async function reponsesPreparees(suiviId: string): Promise<{ texte: string; donnees: { id: string; code: string; texte: string; statut: string }[] }> {
  const ouverts = await prisma.messagePrepare.findMany({ where: { suiviId, statut: { in: OUVERTS }, reponse: true }, orderBy: { prevuLe: "asc" } });
  return {
    texte: ouverts.length ? ouverts.map((m) => `${libelleDuCode(m.code)} (id ${m.id}${m.statut === "PREVU" ? `, prévu le ${dateAbsolue(m.prevuLe)}` : ""}) : « ${m.texte} »`).join("\n") : "aucune réponse préparée",
    donnees: ouverts.map((m) => ({ id: m.id, code: m.code, texte: m.texte, statut: m.statut })),
  };
}

const outilNoterReponseClient = definirOutil({
  nom: "noter_reponse_client",
  titre: "Noter la réponse d'un client",
  description:
    "Lucas rapporte ce qu'un client a répondu (SMS reçu sur son téléphone, réponse orale rapportée) : le texte et l'heure entrent dans sa conversation et son dossier (comme « Sa réponse » dans la messagerie), un STOP est reconnu, et la messagerie analyse tout de suite et prépare la réponse (rendue ici). « photos » : le client a envoyé des photos — l'outil rend un lien de dépôt pour son dossier (30 minutes) que Lucas ouvre sur son téléphone. Rien n'est envoyé au client.",
  niveau: "REVERSIBLE",
  schema: z.object({
    cible: schemaCible,
    texte: z.string().trim().max(1600).optional().describe("Le texte du client, mot pour mot si possible."),
    heure: z.iso.datetime({ offset: true }).optional().describe("Quand le client a écrit, ISO 8601 ; sinon maintenant."),
    photos: z.boolean().optional().describe("Le client a envoyé des photos : un lien de dépôt est rendu pour les ranger dans son dossier."),
  }),
  executer: async (e, contexte) => {
    if (!e.texte && !e.photos) throw new ErreurMetier("Donne le texte du client, ou dis qu'il a envoyé des photos.", 400);
    const r = await suiviDe(e.cible);
    if ("ambigu" in r) return r.ambigu;
    const morceaux: string[] = [];
    const recuLe = e.heure ? new Date(e.heure) : contexte.maintenant;
    if (e.texte) {
      const { rapporterReponse } = await import("@/lib/messagerie/gestes");
      await rapporterReponse({ suiviId: r.suivi.id, texte: e.texte, recuLe }, contexte.maintenant);
      morceaux.push(`Réponse de ${r.ids.nom} notée (reçue à ${heureParis(recuLe)}).`);
    }
    let depot: string | null = null;
    if (e.photos) {
      const cible = r.suivi.dossierId ? { entite: "DOSSIER" as const, id: r.suivi.dossierId } : r.suivi.leadId ? { entite: "LEAD" as const, id: r.suivi.leadId } : null;
      const cree = await creerLienDepot({ cible, type: "PHOTO_AVANT", creePar: contexte.utilisateur, maintenant: contexte.maintenant });
      depot = lien("Lien de dépôt des photos (sur le téléphone)", cree.chemin).href;
      morceaux.push(`Ses photos : ouvre ce lien sur ton téléphone et choisis-les (valable ${MINUTES_VALIDITE_LIEN} minutes, un seul envoi) : ${depot}. La messagerie verra les photos à leur arrivée (remerciement S1, simulation à faire).`);
    }
    const reponses = await reponsesPreparees(r.suivi.id);
    const vue = await (await import("@/lib/messagerie/vues")).ouEnEstDuSuivi(r.suivi.id);
    morceaux.push(`Réponse préparée : ${reponses.texte}.`, `Où on en est :\n${lignesOuEnEst(vue?.ouEnEst ?? null)}`);
    return { texte: morceaux.join("\n"), donnees: { suiviId: r.suivi.id, reponses: reponses.donnees, depot }, liens: [lien(`Conversation de ${r.ids.nom}`, `/messagerie?suivi=${r.suivi.id}`)] };
  },
});

/* ── noter_note ────────────────────────────────────────────────── */

const outilNoterNote = definirOutil({
  nom: "noter_note",
  titre: "Ajouter une note à un dossier (messagerie)",
  description:
    "Une note après un appel, ou un contexte (« intéressée, veut du chêne clair », « signe dans 2 semaines », « son mari décide ») : la note entre dans le dossier (ou le lead) et la messagerie l'analyse tout de suite — rappel daté posé, pause et « comme convenu » si le client va signer, teintes et décideur rangés dans les faits, « Où on en est » à jour, suite préparée. Rien n'est envoyé. Pour noter un appel avec son issue : « noter_appel ».",
  niveau: "REVERSIBLE",
  schema: z.object({ cible: schemaCible, texte: z.string().trim().min(2).max(4000).describe("La note, telle que Lucas l'a dite.") }),
  executer: async (e, contexte) => {
    const r = await suiviDe(e.cible);
    if ("ambigu" in r) return r.ambigu;
    const { ajouterNote } = await import("@/lib/messagerie/gestes");
    const { analyserSuivi } = await import("@/lib/messagerie/analyse");
    await ajouterNote({ suiviId: r.suivi.id, texte: e.texte }, contexte.maintenant);
    const analyse = await analyserSuivi(r.suivi.id, contexte.maintenant);
    const prepares = analyse.crees.length ? await prisma.messagePrepare.findMany({ where: { id: { in: analyse.crees } } }) : [];
    const journal = await prisma.ligneJournalSuivi.findMany({ where: { suiviId: r.suivi.id, cle: { startsWith: "analyse:" } }, orderBy: { le: "desc" }, take: 1 });
    return {
      texte: [
        `Note ajoutée pour ${r.ids.nom}.`,
        journal[0] ? `Lue : ${journal[0].texte}.` : null,
        prepares.length ? `Préparé : ${prepares.map((m) => `${libelleDuCode(m.code)} (${m.statut === "PREVU" ? `prévu le ${dateAbsolue(m.prevuLe)}` : "prêt"})`).join(", ")}.` : null,
        `Où on en est :\n${lignesOuEnEst(analyse.ouEnEst)}`,
      ]
        .filter(Boolean)
        .join("\n"),
      donnees: { suiviId: r.suivi.id, prepares: prepares.map((m) => ({ id: m.id, code: m.code, statut: m.statut, prevuLe: m.prevuLe.toISOString() })), ouEnEst: analyse.ouEnEst },
      liens: [lien(`Conversation de ${r.ids.nom}`, `/messagerie?suivi=${r.suivi.id}`)],
    };
  },
});

/* ── reponse_proposee ──────────────────────────────────────────── */

/** Le suivi existant d'une cible, sans rien créer (outils de lecture). */
async function suiviExistant(ids: Ids) {
  return prisma.suivi.findFirst({ where: { OR: [...(ids.dossierId ? [{ dossierId: ids.dossierId }] : []), ...(ids.leadId ? [{ leadId: ids.leadId }] : [])] } });
}

const outilReponseProposee = definirOutil({
  nom: "reponse_proposee",
  titre: "La réponse préparée pour un client",
  description:
    "La réponse que la messagerie a préparée pour un client après avoir analysé son dernier message (texte contrôlé, son identifiant pour « confirmer_envoi »), et ce que le client a écrit. L'analyse passe 90 secondes après le dernier message d'une rafale : s'il n'y a encore rien, réessaie dans un instant. Lecture seule.",
  niveau: "LECTURE",
  schema: z.object({ cible: schemaCible }),
  executer: async (e) => {
    const c = await cibler(e.cible);
    if (c.ambigu) return c.ambigu;
    const suivi = await suiviExistant(c.ids);
    if (!suivi) return { texte: `Pas encore de conversation suivie pour ${c.ids.nom} : aucune réponse préparée.`, donnees: { reponses: [] } };
    const reponses = await reponsesPreparees(suivi.id);
    const dernier = suivi.dernierSens === "CLIENT" && suivi.dernierExtrait ? `Le client a écrit : « ${suivi.dernierExtrait} »\n` : "";
    return { texte: `${dernier}Réponse préparée pour ${c.ids.nom} : ${reponses.texte}.`, donnees: { suiviId: suivi.id, reponses: reponses.donnees }, liens: [lien(`Conversation de ${c.ids.nom}`, `/messagerie?suivi=${suivi.id}`)] };
  },
});

/* ── reporter_message ──────────────────────────────────────────── */

const outilReporterMessage = definirOutil({
  nom: "reporter_message",
  titre: "Reporter un message préparé",
  description:
    "Plus tard : un message préparé revient dans 1 h, dans 3 h, demain à 9 h 30 (prochain jour travaillé), ou à une date donnée (ISO 8601), comme le bouton « Plus tard ». Le report est noté au journal. Rien n'est envoyé.",
  niveau: "REVERSIBLE",
  schema: z.object({ ...schemaMessage, quand: z.string().trim().max(40).describe("« 1H », « 3H », « DEMAIN », ou une date-heure ISO 8601 à venir.") }),
  executer: async (e, contexte) => {
    const v = await messageVise(e);
    if (v.ambigu) return v.ambigu;
    const quand = ["1H", "3H", "DEMAIN"].includes(e.quand.toUpperCase()) ? (e.quand.toUpperCase() as "1H" | "3H" | "DEMAIN") : new Date(e.quand);
    if (quand instanceof Date && Number.isNaN(quand.getTime())) throw new ErreurMetier("« quand » : 1H, 3H, DEMAIN ou une date ISO 8601.", 400);
    const { reporterMessage } = await import("@/lib/messagerie/gestes");
    const { prevuLe } = await reporterMessage(v.message.id, quand, contexte.maintenant);
    return { texte: `${libelleDuCode(v.message.code)} pour ${v.message.nom} reporté au ${dateAbsolue(prevuLe)}.`, donnees: { messageId: v.message.id, prevuLe: prevuLe.toISOString() } };
  },
});

/* ── non_envoye ────────────────────────────────────────────────── */

const outilNonEnvoye = definirOutil({
  nom: "non_envoye",
  titre: "Ne pas envoyer un message préparé",
  description: `Un message préparé que Lucas n'enverra pas, avec la raison (${RAISONS_NON_ENVOI.map((r) => `${r} : ${LIBELLES_RAISON_NON_ENVOI[r]}`).join(" ; ")} — « commentaire » obligatoire pour AUTRE). « Déjà fait par téléphone » compte comme un contact. Noté au journal ; la messagerie en tient compte pour la suite.`,
  niveau: "REVERSIBLE",
  schema: z.object({ ...schemaMessage, raison: z.enum(RAISONS_NON_ENVOI), commentaire: z.string().trim().max(200).optional() }),
  executer: async (e, contexte) => {
    const v = await messageVise(e);
    if (v.ambigu) return v.ambigu;
    const { nePasEnvoyer } = await import("@/lib/messagerie/gestes");
    const { motif } = await nePasEnvoyer(v.message.id, e.raison, e.commentaire ?? null, contexte.maintenant);
    return { texte: `${libelleDuCode(v.message.code)} pour ${v.message.nom} : non envoyé (${motif.charAt(0).toLowerCase()}${motif.slice(1)}).`, donnees: { messageId: v.message.id, motif } };
  },
});

/* ── pause_client ──────────────────────────────────────────────── */

const outilPauseClient = definirOutil({
  nom: "pause_client",
  titre: "Mettre en pause les relances d'un client",
  description:
    "Les relances d'un client en pause jusqu'à une date (« il rappelle après ses vacances ») : rien ne lui est préparé d'ici là, puis tout reprend. Sans date : les relances reprennent tout de suite. Les réponses à ses messages restent préparées. Noté au journal.",
  niveau: "REVERSIBLE",
  schema: z.object({ cible: schemaCible, jusqua: z.iso.date().optional().describe("Le jour de reprise (AAAA-MM-JJ) ; absent : reprendre maintenant."), motif: z.string().trim().max(80).optional() }),
  executer: async (e, contexte) => {
    const r = await suiviDe(e.cible);
    if ("ambigu" in r) return r.ambigu;
    const { instantParis } = await import("@/lib/messagerie/horaires");
    const jusquau = e.jusqua ? instantParis(e.jusqua, 9 * 60 + 30) : null;
    const { mettreEnPause } = await import("@/lib/messagerie/gestes");
    const analyse = await mettreEnPause({ suiviId: r.suivi.id, jusquau, motif: e.motif ?? null }, contexte.maintenant);
    return {
      texte: `${jusquau ? `Relances de ${r.ids.nom} en pause jusqu'au ${dateAbsolue(jusquau, { heure: false })}.` : `Relances de ${r.ids.nom} reprises.`}\nOù on en est :\n${lignesOuEnEst(analyse.ouEnEst)}`,
      donnees: { suiviId: r.suivi.id, jusquau: jusquau?.toISOString() ?? null },
    };
  },
});

/* ── ou_en_est ─────────────────────────────────────────────────── */

const outilOuEnEst = definirOutil({
  nom: "ou_en_est",
  titre: "Où on en est avec un client",
  description:
    "« Où on en est » d'un dossier ou d'un lead — trois lignes : la situation, le client, la suite (dates absolues, faits seulement) — et les dix dernières lignes de son journal (Client, Toi, IA, CRM). Pour tout le dossier : « lire_fiche ». Lecture seule.",
  niveau: "LECTURE",
  schema: z.object({ cible: schemaCible }),
  executer: async (e, contexte) => {
    const c = await cibler(e.cible);
    if (c.ambigu) return c.ambigu;
    const suivi = await suiviExistant(c.ids);
    const { ouEnEstDuSuivi } = await import("@/lib/messagerie/vues");
    const vue = suivi?.analyseLe ? await ouEnEstDuSuivi(suivi.id) : null;
    let ouEnEst = vue?.ouEnEst ?? null;
    if (!ouEnEst) {
      // Jamais lu par la messagerie : la règle, calculée sans rien écrire.
      const lu = { id: suivi?.id ?? "lecture", leadId: c.ids.dossierId ? null : c.ids.leadId, dossierId: c.ids.dossierId, clientId: c.ids.clientId, faits: suivi?.faits ?? "{}", pauseJusquau: null, pauseMotif: null, stopLe: null, demarrageDoux: false, validationForcee: false };
      const { etat } = await chargerEtat(lu, await lancementMessagerie(contexte.maintenant), contexte.maintenant);
      ouEnEst = ouEnEstParRegles(etat, planifier(etat, null, contexte.maintenant), contexte.maintenant).ouEnEst;
    }
    const journal = vue?.journal ?? [];
    return {
      texte: `Où on en est avec ${c.ids.nom} :\n${lignesOuEnEst(ouEnEst)}${journal.length ? `\n\nJournal (le plus récent en haut) :\n${journal.map((l) => `- ${dateAbsolue(new Date(l.le))} · ${l.acteur === "TOI" ? "Toi" : l.acteur === "CLIENT" ? "Client" : l.acteur} · ${l.texte}`).join("\n")}` : ""}`,
      donnees: { suiviId: suivi?.id ?? null, ouEnEst, journal },
      liens: suivi ? [lien(`Conversation de ${c.ids.nom}`, `/messagerie?suivi=${suivi.id}`)] : [],
    };
  },
});

export const OUTILS_MESSAGERIE_LECTURE = [outilFileDuJour, outilReponseProposee, outilOuEnEst];
export const OUTILS_MESSAGERIE_ECRITURE = [outilConfirmerEnvoi, outilNoterReponseClient, outilNoterNote, outilReporterMessage, outilNonEnvoye, outilPauseClient];
