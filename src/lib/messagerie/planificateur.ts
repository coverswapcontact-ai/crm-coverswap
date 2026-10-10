/**
 * Mission 25 — le planificateur : de l'état lu d'un dossier (ou d'un lead), les messages de la liste validée qui sont
 * voulus, avec leur clé, leur heure voulue et leur variante (cahier, § Les 40 messages, colonnes « Quand »). Pur et
 * rejouable : la même entrée rend les mêmes intentions ; la clé empêche d'en préparer deux fois une.
 *
 * Ce qu'il ne fait pas : les horaires, la garde de silence, les plafonds (garde.ts, moteur.ts) ; les réponses aux
 * messages du client, E3 et les réponses rapides (analyse.ts, gestes.ts : ils naissent d'un geste, pas d'un état).
 *
 * Les messages qui suivent un fait daté (A1, A2, P1, S1, S2, D1, D6, D8, C1, C3…) ne naissent que d'un fait postérieur
 * au lancement de la messagerie : rien n'est envoyé pour un devis mis en ligne la semaine d'avant. Les relances de
 * silence, elles, valent pour tous les dossiers ouverts (démarrage en douceur : moteur.ts).
 */
import { definitionMessage, type CodeMessage, type VarianteMessage } from "./catalogue";
import { instantParis, jourSuivant, momentParis, veilleA18h } from "./horaires";
import type { Annulation, EnvoiLu, EtatSuivi, Intention, MessageConnu } from "./types";

const MINUTE = 60_000;
const JOUR = 86_400_000;
const plus = (date: Date, jours: number, minutes = 0) => new Date(date.getTime() + jours * JOUR + minutes * MINUTE);
const max = (...dates: (Date | null | undefined)[]) => {
  const valides = dates.filter((d): d is Date => d instanceof Date && !Number.isNaN(d.getTime()));
  return valides.length ? new Date(Math.max(...valides.map((d) => d.getTime()))) : null;
};

/** Les sources d'un lead qui ont fait une demande (A1 : « Merci pour votre demande ! »). */
export const SOURCES_PREMIER_CONTACT = ["SITE_DEVIS", "SITE_SIMULATEUR", "SITE_CONTACT", "SITE_PRO", "META_ADS", "INSTAGRAM", "TIKTOK"];

/** Codes que le planificateur possède : seuls ceux-là sont annulés quand ils ne sont plus voulus. */
export const CODES_PLANIFIES: readonly CodeMessage[] = ["A1", "A2", "A4", "A5", "P1", "P2", "P3", "S1", "S2", "S3", "S4", "S5", "D1", "D2", "D3", "D4", "D5", "D6", "D7", "D8", "C1", "C2", "C3", "C4", "C5", "F1", "R1", "R2", "CC"];

/** Retard au-delà duquel une relance tardive n'est plus proposée (F1, R1, R2 sur de vieux dossiers). */
export const RETARD_MAX_JOURS = 45;
/** Horizon de préparation : un message voulu plus tard n'est pas encore écrit (il figure dans « la suite »). */
export const HORIZON_MS = JOUR;

const ETAPES_FERMEES = ["PERDU", "EN_PAUSE"];
const ETAPES_AVANT_DEVIS = ["QUALIFICATION", "SIMULATION"];
const ETAPES_DEVIS = ["DEVIS_ENVOYE", "RELANCE"];

export type PropositionEtape = { genre: "SANS_SUITE" | "PERDU"; raison: string };

export type Plan = {
  intentions: Intention[];
  annulations: Annulation[];
  /** La prochaine intention au-delà de l'horizon (pour « Où on en est »), ou null. */
  aVenir: Intention | null;
  /** Une proposition d'étape à valider (Un par un, « Propositions »). */
  proposition: PropositionEtape | null;
  /** Après la dernière relance d'une étape : un appel est la suite. */
  aAppeler: string | null;
};

/** Le dernier envoi d'un code (message confirmé de la messagerie, ou trace équivalente). */
function envoiDe(etat: EtatSuivi, code: string): EnvoiLu | null {
  const envois = etat.envois.filter((e) => e.code === code).sort((a, b) => b.le.getTime() - a.le.getTime());
  return envois[0] ?? null;
}

function messageDe(etat: EtatSuivi, cle: string): MessageConnu | null {
  return etat.messages.find((m) => m.cle === cle) ?? null;
}

/** Le jour « J » à 9 h 30 (CC : le message « comme convenu » du jour du rappel). */
function auMatin(date: Date): Date {
  return instantParis(momentParis(date).jour, 9 * 60 + 30);
}

/** Le jour même à 18 h (C3, « le soir même »), ou tout de suite s'il est plus tard. */
function leSoir(date: Date): Date {
  const soir = instantParis(momentParis(date).jour, 18 * 60);
  return soir.getTime() > date.getTime() ? soir : date;
}

export function planifier(etat: EtatSuivi, precedent: { dateChantier?: string | null } | null, maintenant: Date): Plan {
  const voulues: Intention[] = [];
  // La clé suit le suivi, pas le dossier : un lead qui reçoit son dossier garde ses messages (le suivi passe au dossier).
  const cible = `suivi:${etat.suiviId}`;
  const lancement = etat.lancement;
  const apresLancement = (date: Date | null | undefined) => Boolean(date && date.getTime() >= lancement.getTime());
  const ajouter = (code: CodeMessage, cle: string, voulu: Date | null, raison: string, extra: Partial<Intention> = {}) => {
    if (!voulu) return;
    voulues.push({ code, cle, voulu, variante: "defaut", raison, ...extra });
  };
  const etape = etat.dossier?.etape ?? null;
  const dossierFerme = Boolean(etat.dossier && (etat.dossier.archive || ETAPES_FERMEES.includes(etat.dossier.etape)));
  const leadFerme = Boolean(!etat.dossier && etat.lead && (etat.lead.archive || etat.lead.statut === "PERDU"));
  const ferme = dossierFerme || leadFerme;
  const zone: VarianteMessage = etat.zone === "PROCHE" ? "proche" : etat.zone === "LOIN" ? "loin" : "defaut";
  const geste = etat.dernierGesteClientLe;
  let proposition: PropositionEtape | null = null;
  let aAppeler: string | null = null;

  if (!ferme) {
    // ── Premier contact ────────────────────────────────────────────────────
    const lead = etat.lead;
    if (lead && SOURCES_PREMIER_CONTACT.includes(lead.source) && apresLancement(lead.creeLe) && lead.priorite !== "A_ECARTER") {
      const joint = etat.appels.some((a) => a.repondu && a.le.getTime() >= lead.creeLe.getTime());
      const dejaEcrit = etat.envois.some((e) => e.code !== "A1" && e.le.getTime() >= lead.creeLe.getTime() - 5 * MINUTE);
      if (!joint && !dejaEcrit) ajouter("A1", `A1:lead:${lead.id}`, lead.creeLe, `Nouveau lead (${lead.source === "META_ADS" ? "Meta" : "site"}) du ${momentParis(lead.creeLe).jour.slice(8, 10)}/${momentParis(lead.creeLe).jour.slice(5, 7)}`);
    }
    // Appels sans réponse d'affilée depuis le dernier appel abouti.
    const dernierAbouti = [...etat.appels].reverse().find((a) => a.repondu);
    const sansReponse = etat.appels.filter((a) => !a.repondu && (!dernierAbouti || a.le.getTime() > dernierAbouti.le.getTime()));
    if (!geste || !sansReponse.length || geste.getTime() < sansReponse[0].le.getTime()) {
      const [premier, second, troisieme] = sansReponse;
      if (premier && apresLancement(premier.le)) ajouter("A2", `A2:${cible}`, plus(premier.le, 0, 2), "Premier appel sans réponse");
      if (second && apresLancement(second.le)) {
        const a2 = envoiDe(etat, "A2")?.le ?? messageDe(etat, `A2:${cible}`)?.prevuLe ?? premier.le;
        ajouter("A4", `A4:${cible}`, max(plus(second.le, 0, 2), instantParis(jourSuivant(momentParis(a2).jour), 9 * 60)), "Deuxième appel sans réponse");
      }
      if (troisieme && apresLancement(troisieme.le)) {
        const a4 = envoiDe(etat, "A4")?.le ?? messageDe(etat, `A4:${cible}`)?.prevuLe ?? second.le;
        ajouter("A5", `A5:${cible}`, max(plus(troisieme.le, 0, 2), plus(a4, 2)), "Troisième appel sans réponse");
      }
      const a5 = envoiDe(etat, "A5");
      if (a5 && maintenant.getTime() >= plus(a5.le, 2).getTime() && (!geste || geste.getTime() < a5.le.getTime())) {
        proposition = { genre: "SANS_SUITE", raison: "Trois appels et trois messages sans réponse : le passer « Sans suite » ?" };
      }
    }

    // ── Photos ─────────────────────────────────────────────────────────────
    const avantDevis = !etape || ETAPES_AVANT_DEVIS.includes(etape);
    const sansPhoto = etat.photos.nombre === 0;
    const sansSimulation = etat.simulations.length === 0 && !etat.simulationFaiteSurLeSite;
    const interesse = [...etat.appels].reverse().find((a) => a.repondu && a.issue === "INTERESSE");
    if (interesse && apresLancement(interesse.le) && sansPhoto && avantDevis) ajouter("P1", `P1:${cible}`, interesse.le, "Appel noté « Intéressé », pas encore de photos");
    if (avantDevis && sansPhoto && sansSimulation) {
      const p1 = envoiDe(etat, "P1");
      const a1 = envoiDe(etat, "A1");
      const lienCommunique = Boolean(p1 || etat.espace?.lienCommunique);
      const reference = max(p1?.le, a1?.le, !p1 && !a1 && etat.espace?.lienCommunique ? etat.espace.lienEmisLe : null);
      if (reference) ajouter("P2", `P2:${cible}`, plus(reference, 2), "Toujours aucune photo", { variante: lienCommunique && etat.espace ? "apresP1" : "defaut" });
      const p2 = envoiDe(etat, "P2");
      if (p2) ajouter("P3", `P3:${cible}`, plus(p2.le, 4), "Toujours aucune photo après P2", { variante: zone });
      const p3 = envoiDe(etat, "P3");
      if (p3 && maintenant.getTime() >= plus(p3.le, 2).getTime()) aAppeler = "plus de relance photos";
    }

    // ── Simulation ─────────────────────────────────────────────────────────
    if (!sansPhoto && etat.photos.premiereLe && apresLancement(etat.photos.premiereLe) && etat.simulations.length === 0 && avantDevis) {
      ajouter("S1", `S1:${cible}`, etat.photos.premiereLe, `Photos reçues (${etat.photos.nombre})`);
    }
    const publiees = etat.simulations.filter((s) => s.source !== "SITE").sort((a, b) => a.publieeLe.getTime() - b.publieeLe.getTime());
    if (publiees.length && (!etape || ETAPES_AVANT_DEVIS.includes(etape)) && !etat.devis.length) {
      const derniere = publiees[publiees.length - 1];
      const lot = publiees.filter((s) => derniere.publieeLe.getTime() - s.publieeLe.getTime() <= 2 * 3_600_000);
      const idLot = lot[0].id;
      const smsDabord = etat.faits.canalPrefere === "SMS_DABORD";
      if (apresLancement(derniere.publieeLe)) {
        ajouter("S2", `S2:${idLot}`, derniere.publieeLe, lot.length > 1 ? `${lot.length} simulations publiées` : "Simulation publiée", {
          variante: smsDabord ? "smsDabord" : lot.length > 1 ? "plusieurs" : "defaut",
          simulationId: smsDabord ? derniere.id : null,
          valeurs: { nombre: String(lot.length) },
        });
      }
      const s2 = envoiDe(etat, "S2");
      const referenceS2 = s2?.le ?? derniere.publieeLe;
      const vue = max(...lot.map((s) => s.vueLe), etat.simulationsVuesLe && etat.simulationsVuesLe.getTime() >= derniere.publieeLe.getTime() ? etat.simulationsVuesLe : null);
      const retourApresVue = Boolean(vue && geste && geste.getTime() > vue.getTime());
      if (!vue && !smsDabord) ajouter("S3", `S3:${idLot}`, plus(referenceS2, 2), "Simulation jamais ouverte");
      const baseS4 = smsDabord ? s2?.le ?? null : vue;
      if (baseS4 && !retourApresVue) {
        ajouter("S4", `S4:${idLot}`, plus(baseS4, 4), smsDabord ? "Simulation envoyée en image, sans retour" : "Simulation vue, sans retour");
        if (envoiDe(etat, "S4")) ajouter("S5", `S5:${idLot}`, plus(baseS4, 10), "Toujours aucun retour sur la simulation", { variante: zone });
        const s5 = envoiDe(etat, "S5");
        if (s5 && maintenant.getTime() >= plus(s5.le, 2).getTime()) aAppeler = "plus de relance simulation";
      }
    }

    // ── Devis ──────────────────────────────────────────────────────────────
    const devis = [...etat.devis].sort((a, b) => b.enLigneLe.getTime() - a.enLigneLe.getTime())[0];
    if (devis && !etat.accord) {
      if (apresLancement(devis.enLigneLe) && !etat.devis.some((d) => d.id !== devis.id && messageDe(etat, `D1:${d.id}`) && Math.abs(d.enLigneLe.getTime() - devis.enLigneLe.getTime()) < JOUR)) {
        ajouter("D1", `D1:${devis.id}`, devis.enLigneLe, `Devis ${devis.numero ?? ""} mis en ligne`.replace("  ", " "));
      }
      if (!etape || ETAPES_DEVIS.includes(etape)) {
        const reference = envoiDe(etat, "D1")?.le ?? devis.enLigneLe;
        const d2 = envoiDe(etat, "D2");
        if (devis.consultations === 0) ajouter("D2", `D2:${devis.id}`, plus(reference, 2), "Devis jamais ouvert");
        else if (devis.premiereOuvertureLe && !d2 && (!geste || geste.getTime() < devis.premiereOuvertureLe.getTime())) {
          ajouter("D3", `D3:${devis.id}`, plus(devis.premiereOuvertureLe, 4), `Devis ouvert ${devis.consultations} fois, sans réponse`);
        }
        ajouter("D4", `D4:${devis.id}`, plus(reference, 10), "Toujours rien sur le devis");
        ajouter("D5", `D5:${devis.id}`, plus(reference, 21), "Toujours rien sur le devis, trois semaines après");
        const d5 = envoiDe(etat, "D5");
        if (d5 && maintenant.getTime() >= plus(d5.le, 7).getTime() && (!geste || geste.getTime() < d5.le.getTime())) {
          proposition = { genre: "PERDU", raison: "Sans nouvelles une semaine après le message « dossier en pause » : le passer en Perdu ?" };
        }
      }
    }
    if (etat.accord) {
      if (apresLancement(etat.accord.le)) ajouter("D6", `D6:${etat.accord.id}`, etat.accord.le, "Accord donné en ligne");
      if (!etat.acompte && (!etape || etape === "SIGNE")) ajouter("D7", `D7:${etat.accord.id}`, plus(etat.accord.le, 3), "Accord sans acompte");
    }
    if (etat.acompte && apresLancement(etat.acompte.le)) {
      ajouter("D8", `D8:${etat.acompte.id}`, etat.acompte.le, "Acompte encaissé", { variante: etat.dossier?.dateChantier ? "defaut" : "sansDate" });
    }

    // ── Chantier ───────────────────────────────────────────────────────────
    const chantier = etat.dossier?.dateChantier ?? null;
    const avantChantier = !etape || ["SIGNE", "PLANIFIE"].includes(etape);
    if (chantier && chantier.getTime() > maintenant.getTime() && avantChantier) {
      const jour = momentParis(chantier).jour;
      const cleDate = `${jour}${etat.dossier?.heureChantier != null ? `T${etat.dossier.heureChantier}` : ""}`;
      const avant = precedent?.dateChantier ?? null;
      if (precedent && avant !== cleDate) {
        ajouter("C1", `C1:${cible}:${cleDate}`, maintenant, avant ? "Date du chantier déplacée" : "Date du chantier fixée", { variante: etat.dossier?.heureChantier != null ? "defaut" : "sansHeure" });
      }
      ajouter("C2", `C2:${cible}:${jour}`, veilleA18h(jour), "Veille du chantier", { variante: etat.dossier?.heureChantier != null ? "defaut" : "sansHeure" });
    }
  }

  // ── Après le chantier (même dossier encaissé) ────────────────────────────
  const fini = etat.chantierFiniLe;
  if (fini && !dossierFerme) {
    if (apresLancement(fini)) ajouter("C3", `C3:${cible}`, leSoir(fini), "Chantier terminé");
    if (!etat.avisLe) {
      ajouter("C4", `C4:${cible}`, plus(fini, 5), "Fin du chantier il y a 5 jours, pas d'avis");
      const c4 = envoiDe(etat, "C4");
      if (c4) ajouter("C5", `C5:${cible}`, plus(c4.le, 7), "Toujours pas d'avis");
    }
    ajouter("F1", `F1:${cible}`, plus(fini, 183), "Six mois après la pose");
  }

  // ── Dossiers perdus : R1 et R2 aux dates prévues, rien d'autre ───────────
  const perte = etat.dossier?.etape === "PERDU" ? { le: etat.dossier.perteLe, motif: etat.dossier.motifPerte } : !etat.dossier && etat.lead?.statut === "PERDU" ? { le: etat.lead.perteLe, motif: etat.lead.motifPerte } : null;
  if (perte?.le && !etat.dossier?.archive && !(etat.lead?.archive && !etat.dossier)) {
    if (perte.motif === "PRIX") ajouter("R1", `R1:${cible}`, plus(perte.le, 60), "Perdu pour « trop cher » il y a 60 jours");
    if (etat.consentementCommercial) ajouter("R2", `R2:${cible}`, plus(perte.le, 182), "Perdu depuis six mois, accord pour les messages");
  }

  // ── « Comme convenu » : le jour du rappel posé (va signer, rappel daté) ───
  if (!ferme && etat.pause?.motif === "COMME_CONVENU") {
    ajouter("CC", `CC:${cible}:${momentParis(etat.pause.jusquau).jour}`, auMatin(etat.pause.jusquau), "Rappel daté : comme convenu", { variante: etat.devis.length ? "devis" : "defaut" });
  }

  // Une relance tardive sur un vieux dossier (six mois, soixante jours) n'est plus proposée au-delà de 45 jours de retard.
  const tardives = new Set(["F1", "R1", "R2"]);
  const retenues = voulues.filter((i) => !(tardives.has(i.code) && maintenant.getTime() - i.voulu.getTime() > RETARD_MAX_JOURS * JOUR));
  // Déjà fait par une autre trace (SMS copié, mail de relance) : pas deux fois le même code au même client.
  const nouvelles = retenues.filter((i) => !messageDe(etat, i.cle) && !(definitionMessage(i.code as CodeMessage).nature !== "REACTIF" && envoiDe(etat, i.code) && ["A1", "A2", "A4", "A5", "P1", "P2", "P3", "S1", "C3", "C4", "C5", "F1", "R1", "R2"].includes(i.code)));
  const prochaines = nouvelles.filter((i) => i.voulu.getTime() <= maintenant.getTime() + HORIZON_MS);
  const aVenir = nouvelles.filter((i) => i.voulu.getTime() > maintenant.getTime() + HORIZON_MS).sort((a, b) => a.voulu.getTime() - b.voulu.getTime())[0] ?? null;

  // Les messages ouverts qui ne sont plus voulus : annulés, avec la raison.
  const cles = new Set(retenues.map((i) => i.cle));
  const annulations: Annulation[] = etat.messages
    .filter((m) => ["PREVU", "A_ENVOYER", "A_VALIDER"].includes(m.statut) && (CODES_PLANIFIES as readonly string[]).includes(m.code) && !cles.has(m.cle))
    .map((m) => ({ messageId: m.id, motif: motifObsolete(m.code, etat, ferme) }));

  return { intentions: prochaines, annulations, aVenir, proposition: ferme ? null : proposition, aAppeler: ferme ? null : aAppeler };
}

/** Pourquoi un message préparé n'a plus lieu d'être (une phrase pour le journal). */
export function motifObsolete(code: string, etat: EtatSuivi, ferme: boolean): string {
  if (ferme) return etat.dossier?.etape === "PERDU" || etat.lead?.statut === "PERDU" ? "le dossier est perdu" : etat.dossier?.etape === "EN_PAUSE" ? "le dossier est en pause" : "le dossier est archivé";
  if (code.startsWith("A")) return "le client a été joint";
  if (code.startsWith("P") || code === "S1") return etat.photos.nombre > 0 ? "les photos sont arrivées" : "plus d'actualité à cette étape";
  if (code.startsWith("S")) return etat.devis.length ? "un devis est en ligne" : "la simulation a été vue ou a eu un retour";
  if (code === "D2") return "le devis a été ouvert";
  if (code.startsWith("D")) return etat.accord ? "l'accord est donné" : "le devis a changé";
  if (code.startsWith("C")) return "la date du chantier a changé";
  if (code === "CC") return "le rappel a été déplacé ou levé";
  return "plus d'actualité";
}
