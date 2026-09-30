import prisma from "@/lib/prisma";
import { pluriel } from "@/lib/commun/format";
import { RANGS_PRIORITE } from "@/lib/mail/priorite";
import { conversations, filtrerVue, type LigneMail } from "@/lib/mail/vues";
import type { Detection, NiveauTache, SujetTache } from "../types";
import { entreGuillemets, jourEtMois, moment, nomLisible, paquets, plusAncienne, raccourcir, titreTache } from "./libelles";
import { cleTache, type Detecteur } from "./types";

/**
 * Mission 17 (partie A) : détecteur MAIL — les fils de la boîte pro « À traiter » (mail/vues.ts : `conversations`
 * puis `filtrerVue(…, "A_TRAITER")`, la même règle que l'onglet Mail). Pour chaque fil :
 * - administratif (Stripe, fournisseurs…) → LIRE_MAIL « Lire · Expéditeur », niveau 5, clé `LIRE_MAIL:fil:<fil>` ;
 * - sinon → REPONDRE, sur le sujet le plus précis que portent ses messages : `REPONDRE:dossier:<id>` (un message
 *   rattaché à un dossier vivant), sinon `REPONDRE:lead:<id>`, `REPONDRE:client:<id>`, `REPONDRE:fil:<fil>` — la même
 *   clé que l'espace et les SMS (fusion par le moteur) ; plusieurs fils d'un même sujet font UNE tâche (tous leurs
 *   mails dans `donnees.messageIds`). « Répondre · Nom », niveau 1 (réclamation, client ou contact connu ; 3 pour un
 *   inconnu) ; un fil où Lucas a écrit en dernier (« Sans réponse depuis N jours ») → « Relancer par mail · Nom »,
 *   niveau 2. Montant : le devis en attente du contact (`priorite.montant`).
 * Un fil reporté (snooze à venir) n'est pas dans « À traiter » : le moteur passe alors la tâche « Plus tard »
 * (achevement.ts). Le « Revenu » de l'onglet Mail colle jusqu'à l'archivage : un fil revenu auquel Lucas a répondu
 * DEPUIS le report n'est plus rendu (sa tâche est cochée « réponse partie le … »).
 * `donnees.messageIds` porte UN message par fil (le dernier) : l'effet archive ou reporte le fil entier
 * (mail/boite.ts › archiverFil, mail/v2.ts › snoozer), un identifiant par message ferait autant d'archivages.
 * Lecture seule.
 */

type MessageDuFil = { id: string; filCanal: string | null; sens: string; automatique: boolean; recuLe: Date; lu: boolean; rangeLe: Date | null; snoozeLe: Date | null; dossierId: string | null; leadId: string | null; clientId: string | null };

/** Les messages des fils « À traiter », groupés par fil (`filCanal ?? id`, la clé de mail/vues.ts), du plus ancien au plus récent. */
async function messagesDesFils(fils: readonly string[]): Promise<Map<string, MessageDuFil[]>> {
  const parFil = new Map<string, MessageDuFil[]>();
  for (const paquet of paquets(fils)) {
    const lignes = await prisma.message.findMany({
      where: { canal: "EMAIL", OR: [{ filCanal: { in: paquet } }, { filCanal: null, id: { in: paquet } }] },
      orderBy: { recuLe: "asc" },
      select: { id: true, filCanal: true, sens: true, automatique: true, recuLe: true, lu: true, rangeLe: true, snoozeLe: true, dossierId: true, leadId: true, clientId: true },
    });
    for (const m of lignes) {
      const fil = m.filCanal ?? m.id;
      parFil.set(fil, [...(parFil.get(fil) ?? []), m]);
    }
  }
  return parFil;
}

const dernier = <T>(liste: readonly T[], condition: (x: T) => boolean): T | undefined => [...liste].reverse().find(condition);
const plusRecente = (dates: (Date | null | undefined)[]): Date | null => dates.reduce<Date | null>((max, d) => (d && (!max || d.getTime() > max.getTime()) ? d : max), null);

/** Une tâche vue sur un fil, avant le regroupement par clé. */
type Vue = { detection: Detection; fil: string; recuLe: Date };

function lireMail(l: LigneMail, messages: MessageDuFil[]): Vue {
  const entrants = messages.filter((m) => m.sens === "ENTRANT");
  const nonLus = entrants.filter((m) => !m.lu && !m.rangeLe);
  const depuis = nonLus[0]?.recuLe ?? entrants.at(-1)?.recuLe ?? new Date(l.recuLe);
  const expediteur = raccourcir(l.correspondant.nom || l.correspondant.adresse, 40);
  return {
    fil: l.fil,
    recuLe: new Date(l.recuLe),
    detection: {
      cle: `LIRE_MAIL:fil:${l.fil}`,
      type: "LIRE_MAIL",
      source: "MAIL",
      sujet: { type: "SYSTEME", id: null },
      titre: titreTache("Lire", expediteur || "expéditeur inconnu"),
      raison: l.revenu ? `${raccourcir(l.objet, 60) || "(sans objet)"} · revenu du report` : raccourcir(l.objet, 80) || "(sans objet)",
      niveau: 5,
      depuis,
      raccourci: { genre: "MAIL", libelle: "Lire", messageId: l.messageId, href: `/mail?mail=${l.messageId}` },
      donnees: { messageId: l.messageId, messageIds: [l.messageId] },
    },
  };
}

export const detecteurMail: Detecteur = {
  source: "MAIL",
  async detecter({ maintenant }) {
    const lignes = filtrerVue(await conversations(maintenant), "A_TRAITER");
    if (lignes.length === 0) return [];
    const parFil = await messagesDesFils(lignes.map((l) => l.fil));
    const dossierIds = [...new Set([...parFil.values()].flat().map((m) => m.dossierId).filter((id): id is string => Boolean(id)))];
    // Les dossiers vivants (l'extension du journal écarte les archivés) et leur nom.
    const dossiers = new Map<string, { clientNom: string; clientId: string | null; leadId: string | null }>();
    for (const paquet of paquets(dossierIds)) {
      for (const d of await prisma.dossier.findMany({ where: { id: { in: paquet } }, select: { id: true, clientNom: true, clientId: true, leadId: true } })) dossiers.set(d.id, d);
    }

    const vues: Vue[] = [];
    for (const l of lignes) {
      const messages = parFil.get(l.fil) ?? [];
      if (l.classe === "ADMINISTRATIF") {
        vues.push(lireMail(l, messages));
        continue;
      }
      const entrants = messages.filter((m) => m.sens === "ENTRANT");
      const dernierEntrant = entrants.at(-1) ?? null;
      const dernierSortant = dernier(messages, (m) => m.sens === "SORTANT" && !m.automatique) ?? null;
      if (l.revenu) {
        // « Revenu » colle dans l'onglet Mail : répondu depuis le report (ou depuis le dernier mail reçu), il n'y a plus rien à faire.
        const repere = plusRecente([dernierEntrant?.recuLe, ...messages.map((m) => m.snoozeLe)]);
        if (dernierSortant && repere && dernierSortant.recuLe.getTime() > repere.getTime()) continue;
      }
      const relance = Boolean(dernierSortant && (!dernierEntrant || dernierSortant.recuLe.getTime() > dernierEntrant.recuLe.getTime()));

      const messageDossier = dernier(messages, (m) => Boolean(m.dossierId && dossiers.has(m.dossierId)));
      const dossier = messageDossier ? dossiers.get(messageDossier.dossierId!)! : null;
      const leadId = dernier(messages, (m) => Boolean(m.leadId))?.leadId ?? dossier?.leadId ?? null;
      const clientId = dernier(messages, (m) => Boolean(m.clientId))?.clientId ?? dossier?.clientId ?? null;
      const dossierId = messageDossier?.dossierId ?? null;
      const sujet: SujetTache = dossierId ? { type: "DOSSIER", id: dossierId } : leadId ? { type: "LEAD", id: leadId } : clientId ? { type: "CLIENT", id: clientId } : { type: "SYSTEME", id: null };
      const cle = sujet.type === "SYSTEME" ? `REPONDRE:fil:${l.fil}` : cleTache("REPONDRE", sujet);
      const nom = dossier?.clientNom ?? l.contact?.nom ?? l.correspondant.nom ?? l.correspondant.adresse;
      const connu = sujet.type !== "SYSTEME" || l.classe === "CLIENT";
      const niveau: NiveauTache = relance ? 2 : connu || l.priorite.rang === RANGS_PRIORITE.RECLAMATION ? 1 : 3;
      // Dates absolues (relecture) : un « il y a 2 h » réécrivait la tâche à chaque passage.
      const quoi = l.revenu ? "revenu du report" : relance && dernierSortant ? `sans réponse depuis le ${jourEtMois(dernierSortant.recuLe)}` : `reçu ${moment(dernierEntrant?.recuLe ?? new Date(l.recuLe))}`;
      vues.push({
        fil: l.fil,
        recuLe: new Date(l.recuLe),
        detection: {
          cle,
          type: "REPONDRE",
          source: "MAIL",
          sujet,
          ...(sujet.type === "SYSTEME" ? {} : { dossierId, leadId, clientId }),
          titre: titreTache(relance ? "Relancer par mail" : "Répondre", nomLisible(nom, "expéditeur inconnu")),
          raison: `${entreGuillemets(l.objet)} · ${quoi}`,
          niveau,
          montant: l.priorite.montant,
          depuis: (relance ? dernierSortant?.recuLe : dernierEntrant?.recuLe) ?? new Date(l.recuLe),
          raccourci: { genre: "MAIL", libelle: relance ? "Relancer" : "Répondre", messageId: l.messageId, href: `/mail?mail=${l.messageId}&repondre=1` },
          donnees: { messageId: l.messageId, messageIds: [l.messageId] },
        },
      });
    }
    return regrouper(vues);
  },
};

/**
 * Une tâche par clé : plusieurs fils du même sujet (deux conversations d'un même client) n'en font qu'une. Le fil le
 * plus urgent (niveau, puis le plus récent) donne titre, raison et raccourci ; tous les fils sont dans `messageIds`.
 */
function regrouper(vues: readonly Vue[]): Detection[] {
  const parCle = new Map<string, Vue[]>();
  for (const v of vues) parCle.set(v.detection.cle, [...(parCle.get(v.detection.cle) ?? []), v]);
  return [...parCle.values()].map((groupe) => {
    if (groupe.length === 1) return groupe[0].detection;
    const [tete] = [...groupe].sort((a, b) => a.detection.niveau - b.detection.niveau || b.recuLe.getTime() - a.recuLe.getTime());
    const montants = groupe.map((v) => v.detection.montant).filter((m): m is number => typeof m === "number");
    const messageIds = [...new Set(groupe.flatMap((v) => (v.detection.donnees?.messageIds as string[] | undefined) ?? []))];
    return {
      ...tete.detection,
      raison: `${tete.detection.raison} · ${pluriel(groupe.length, "conversation")}`,
      montant: montants.length ? Math.max(...montants) : null,
      depuis: plusAncienne(groupe.map((v) => v.detection.depuis)),
      donnees: { ...tete.detection.donnees, messageIds },
    };
  });
}
