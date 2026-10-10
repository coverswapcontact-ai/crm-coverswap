/**
 * Mission 25 — la garde de silence (cahier, § Le moteur de relances) : avant qu'un message préparé devienne « à
 * envoyer », le moteur vérifie ces situations ; une seule suffit pour le retenir. Pur.
 *
 * - Les messages qui répondent à un geste du client (A1, S1, D6, D8, E1, E2, réponse proposée) passent la garde : seuls
 *   le STOP, la pause générale et la fenêtre de 8 h 30 à 21 h comptent.
 * - Les autres suivent les horaires de travail et les gardes dures : STOP, dossier perdu, en pause ou archivé (sauf R1
 *   et R2), « Pause relances », un message qui attend déjà la confirmation de Lucas pour ce client, un chantier chez
 *   lui ce jour-là.
 * - Les relances de silence ajoutent : le client attend la réponse de Lucas, un appel abouti depuis moins de 72 h, un
 *   échange du client depuis le dernier message (le délai repart de cet échange), un message envoyé il y a moins de
 *   48 h, trois relances déjà faites à cette étape, un mail de relance parti le même jour.
 */
import { definitionMessage, estCodeMessage, estReactif, type CodeMessage } from "./catalogue";
import { dateAbsolue, dansLaFenetreDeReponse, dansLesHorairesDeTravail, heurePermise, instantParis, jourCourt, jourSuivant, momentParis } from "./horaires";
import type { EtatSuivi } from "./types";

export type DecisionGarde =
  | { decision: "ENVOYER" }
  | { decision: "REPORTER"; jusqua: Date; motif: string }
  | { decision: "RETENIR"; motif: string }
  | { decision: "ANNULER"; motif: string };

export type MessageAGarder = { id: string; code: string; cle: string; canal: string; prevuLe: Date };

const HEURE = 3_600_000;
const JOUR = 24 * HEURE;
export const DELAI_ENTRE_RELANCES_MS = 48 * HEURE;
export const PAUSE_APRES_APPEL_MS = 72 * HEURE;
export const RELANCES_PAR_ETAPE = 3;
/** Le délai minimal d'une relance après un échange du client (« le délai repart de cet échange »). */
export const DELAI_APRES_ECHANGE_MS = 2 * JOUR;

const ETAPES_FERMEES = ["PERDU", "EN_PAUSE"];

export function garder(etat: EtatSuivi, message: MessageAGarder, maintenant: Date): DecisionGarde {
  const code = message.code;
  const reactif = estReactif(code);
  const definition = estCodeMessage(code) ? definitionMessage(code as CodeMessage) : null;
  const relance = definition?.nature === "RELANCE";

  if (etat.stop) return { decision: "ANNULER", motif: "STOP : plus aucun message à ce client" };

  if (reactif) {
    if (dansLaFenetreDeReponse(maintenant)) return { decision: "ENVOYER" };
    return { decision: "REPORTER", jusqua: heurePermise(maintenant, "REACTIF", message.cle), motif: "hors de la fenêtre de 8 h 30 à 21 h" };
  }

  const ferme = Boolean(etat.dossier && (etat.dossier.archive || ETAPES_FERMEES.includes(etat.dossier.etape))) || Boolean(!etat.dossier && etat.lead && (etat.lead.archive || etat.lead.statut === "PERDU"));
  if (ferme && code !== "R1" && code !== "R2") return { decision: "ANNULER", motif: etat.dossier?.etape === "EN_PAUSE" ? "dossier en pause" : "dossier perdu ou archivé" };

  if (!dansLesHorairesDeTravail(maintenant)) return { decision: "REPORTER", jusqua: heurePermise(maintenant, "TRAVAIL", message.cle), motif: "hors des horaires" };

  if (etat.pause && etat.pause.jusquau.getTime() > maintenant.getTime() && code !== "CC") {
    return { decision: "REPORTER", jusqua: heurePermise(instantParis(momentParis(etat.pause.jusquau).jour, 9 * 60 + 30), "TRAVAIL", message.cle), motif: `pause jusqu'au ${jourCourt(etat.pause.jusquau)}` };
  }

  const enAttente = etat.messages.find((m) => m.id !== message.id && (m.statut === "A_ENVOYER" || m.statut === "A_VALIDER"));
  if (enAttente) return { decision: "REPORTER", jusqua: new Date(maintenant.getTime() + HEURE), motif: `un message (${enAttente.code}) attend déjà ta confirmation` };

  const chantier = etat.dossier?.dateChantier;
  if (chantier && momentParis(chantier).jour === momentParis(maintenant).jour && !["C1", "C2", "C3"].includes(code)) {
    return { decision: "REPORTER", jusqua: heurePermise(instantParis(jourSuivant(momentParis(maintenant).jour), 9 * 60 + 30), "TRAVAIL", message.cle), motif: "chantier chez ce client aujourd'hui" };
  }

  if (!relance) return { decision: "ENVOYER" };

  // Après un rappel daté (« va signer »), « comme convenu » passe d'abord : les relances attendent qu'il soit parti.
  const commeConvenu = etat.messages.find((m) => m.code === "CC" && ["PREVU", "A_ENVOYER", "A_VALIDER"].includes(m.statut));
  if (commeConvenu) return { decision: "REPORTER", jusqua: heurePermise(new Date(Math.max(commeConvenu.prevuLe.getTime(), maintenant.getTime()) + JOUR), "TRAVAIL", message.cle), motif: "« comme convenu » passe d'abord" };

  if (etat.attendReponse) return { decision: "REPORTER", jusqua: new Date(maintenant.getTime() + JOUR), motif: "le client attend ta réponse : c'est toi qu'on relance" };

  const appelAbouti = [...etat.appels].reverse().find((a) => a.repondu);
  if (appelAbouti && maintenant.getTime() - appelAbouti.le.getTime() < PAUSE_APRES_APPEL_MS) {
    const fin = new Date(appelAbouti.le.getTime() + PAUSE_APRES_APPEL_MS);
    return { decision: "REPORTER", jusqua: heurePermise(fin, "TRAVAIL", message.cle), motif: `appel le ${dateAbsolue(appelAbouti.le)}` };
  }

  const dernierEnvoi = [...etat.envois].sort((a, b) => b.le.getTime() - a.le.getTime())[0] ?? null;
  const geste = etat.dernierGesteClientLe;
  if (geste && (!dernierEnvoi || geste.getTime() > dernierEnvoi.le.getTime()) && maintenant.getTime() - geste.getTime() < DELAI_APRES_ECHANGE_MS) {
    const reprise = heurePermise(new Date(geste.getTime() + DELAI_APRES_ECHANGE_MS), "TRAVAIL", message.cle);
    return { decision: "REPORTER", jusqua: reprise, motif: `le client a répondu le ${jourCourt(geste)}` };
  }
  if (dernierEnvoi && maintenant.getTime() - dernierEnvoi.le.getTime() < DELAI_ENTRE_RELANCES_MS) {
    return { decision: "REPORTER", jusqua: heurePermise(new Date(dernierEnvoi.le.getTime() + DELAI_ENTRE_RELANCES_MS), "TRAVAIL", message.cle), motif: "un message est parti il y a moins de 48 h" };
  }
  const etape = definition?.etape;
  if (etape) {
    const faites = etat.envois.filter((e) => e.relance && e.etape === etape).length;
    if (faites >= RELANCES_PAR_ETAPE) return { decision: "RETENIR", motif: `${faites} relances déjà faites à cette étape` };
  }
  const mailDuJour = etat.envois.some((e) => e.canal === "MAIL" && e.relance && momentParis(e.le).jour === momentParis(maintenant).jour);
  if (mailDuJour && message.canal === "SMS") return { decision: "REPORTER", jusqua: heurePermise(instantParis(jourSuivant(momentParis(maintenant).jour), 9 * 60 + 30), "TRAVAIL", message.cle), motif: "un mail de relance est parti aujourd'hui" };

  return { decision: "ENVOYER" };
}
