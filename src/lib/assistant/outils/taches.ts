import type { TacheAFaire } from "@prisma/client";
import { z } from "zod/v4";
import prisma from "@/lib/prisma";
import { ErreurMetier } from "@/lib/commun/erreurs";
import { pluriel } from "@/lib/commun/format";
import { LIBELLES_MOTIF_PERTE, MOTIFS_PERTE, type MotifPerte } from "@/lib/dossiers/constants";
import { motifPerteDansUnePhrase } from "@/lib/dossiers/perte";
import { lireObjet, messagesDeLaTache, texteOuNull } from "@/lib/a-faire/json";
import { listeTaches, planMinutes, tachesDuLot, versVue } from "@/lib/a-faire/lecture";
import { DELAI_EFFET_MS, annulerLot, annulerReponse, classerLot, repondreTache } from "@/lib/a-faire/reponses";
import {
  GROUPES_TYPE,
  LIBELLES_RAISON_PAS_A_FAIRE,
  LIBELLES_RAISON_PLUS_TARD,
  QUAND_PLUS_TARD,
  RAISONS_PAS_A_FAIRE,
  RAISONS_PLUS_TARD,
  type ListeTaches,
  type QuandPlusTard,
  type RaisonPasAFaire,
  type RaisonPlusTard,
  type TacheVue,
  type TypeTache,
} from "@/lib/a-faire/types";
import type { ActionSms, RelanceSms } from "@/lib/sms/catalogue";
import { lireDateDictee } from "../agenda";
import { adresseCrm, definirOutil, lien, type ResultatOutil } from "../definition";

/**
 * Mission 17 (partie A) : les tâches de Lucas, pilotées depuis l'assistant — « qu'est-ce que j'ai à faire ? »
 * (« taches »), « c'est fait », « plus tard », « pas à faire », « annule » (« repondre_tache »), « ajoute… »
 * (« ajouter_tache »). Aucune logique métier ici : la liste, les réponses et leurs effets vivent dans
 * `src/lib/a-faire/` (docs/TACHES.md). L'outil met en mots, donne pour chaque tâche le geste prêt (« appeler le
 * 06… », « ouvrir le devis prérempli : <lien> ») et, pour un SMS ou un mail, le texte prêt.
 */

/* ── Mise en mots ──────────────────────────────────────────────────────── */

const PARIS = "Europe/Paris";

/** « 45 minutes », « 1 h 15 ». */
export function dureeLisible(minutes: number): string {
  if (minutes < 60) return pluriel(minutes, "minute");
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${String(m).padStart(2, "0")}` : `${h} h`;
}

/** « jeudi 1er octobre à 9 h », « ce soir à 18 h » n'est pas dit : la date suffit, lue à voix haute. */
export function retourLisible(valeur: string | Date): string {
  const date = valeur instanceof Date ? valeur : new Date(valeur);
  const parties = new Intl.DateTimeFormat("fr-FR", { timeZone: PARIS, weekday: "long", day: "numeric", month: "long", hour: "numeric", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const partie = (type: Intl.DateTimeFormatPartTypes) => parties.find((p) => p.type === type)?.value ?? "";
  const jour = Number(partie("day"));
  const heure = Number(partie("hour"));
  const minutes = partie("minute").padStart(2, "0");
  return `${partie("weekday")} ${jour === 1 ? "1er" : jour} ${partie("month")} à ${heure} h${minutes === "00" ? "" : ` ${minutes}`}`;
}

/** Le lien absolu du CRM : un chemin relatif est préfixé, un lien externe gardé tel quel. */
export function lienAbsolu(chemin: string): string {
  return /^https?:\/\//.test(chemin) ? chemin : `${adresseCrm()}${chemin.startsWith("/") ? "" : "/"}${chemin}`;
}

/** Le lien de la tâche : celui du raccourci, sinon le dossier, le contact, ou la liste des tâches. */
export function lienDeLaTache(v: Pick<TacheVue, "raccourci" | "dossierId" | "leadId">): string {
  const href = v.raccourci.href?.trim();
  if (href) return lienAbsolu(href);
  if (v.raccourci.genre === "VALIDER") return lienAbsolu("/validation");
  if (v.raccourci.dossierId || v.dossierId) return lienAbsolu(`/dossiers?dossier=${v.raccourci.dossierId ?? v.dossierId}`);
  if (v.raccourci.leadId || v.leadId) return lienAbsolu(`/leads?lead=${v.raccourci.leadId ?? v.leadId}`);
  return lienAbsolu("/taches");
}

async function telephoneLisibleDe(telephone: string | null | undefined): Promise<string | null> {
  if (!telephone?.trim()) return null;
  const { telephoneLisible } = await import("@/lib/prospects/leads");
  return telephoneLisible(telephone);
}

/** Le raccourci en mots : le geste prêt, avec le lien absolu du CRM. */
export async function raccourciEnMots(v: Pick<TacheVue, "raccourci" | "dossierId" | "leadId">): Promise<string> {
  const r = v.raccourci;
  const url = lienDeLaTache(v);
  const telephone = await telephoneLisibleDe(r.telephone);
  switch (r.genre) {
    case "APPEL":
      return telephone ? `appeler le ${telephone} (puis noter l'appel) : ${url}` : `appeler (numéro absent de la fiche) : ${url}`;
    case "SMS":
      return `envoyer le SMS${telephone ? ` au ${telephone}` : ""} depuis l'écran SMS (copier vaut envoi) : ${url}`;
    case "MAIL":
      return `répondre au mail : ${url}`;
    case "ESPACE":
      return `répondre dans l'espace du client : ${url}`;
    case "SIMULATEUR":
      return `ouvrir le simulateur sur le dossier : ${url}`;
    case "DEVIS":
      return r.devis === "pdf" ? `déposer le PDF du devis : ${url}` : `ouvrir le devis prérempli : ${url}`;
    case "RELANCE_MAIL":
      return `relire le mail de relance et le valider : ${url}`;
    case "PLANIFIER":
      return `choisir la date du chantier dans les créneaux libres : ${url}`;
    case "ENCAISSER":
      return `saisir l'encaissement prérempli : ${url}`;
    case "VALIDER":
      return `valider ou ignorer la proposition : ${url}`;
    case "DOSSIER":
      return `ouvrir le dossier${r.rubrique ? ` (rubrique ${r.rubrique})` : ""} : ${url}`;
    case "LEAD":
      return `ouvrir la fiche du contact : ${url}`;
    case "COHERENCE":
      return `corriger en un geste : ${url}`;
    case "PAGE":
    default:
      return `${r.marche?.trim() || r.libelle.toLowerCase()} : ${url}`;
  }
}

/** Le texte prêt d'un SMS ou d'un mail, lu tel quel à Lucas. */
export type TextePret =
  | { canal: "SMS"; texte: string; telephone: string | null; code: string | null; source: "DETECTEUR" | "CATALOGUE" }
  | { canal: "SMS"; texte: null; ecran: string; source: "ECRAN_SMS" }
  | { canal: "MAIL"; texte: string; objet: string; a: string; propositionId: string; source: "PROPOSITION" };

/** Les actions du SMS qui n'ouvrent ni espace ni dossier : les seules calculées ici (une lecture n'écrit rien). Mission 18 (A4) : la réactivation, sans lien. */
const ACTIONS_SMS_SANS_ECRITURE = ["PAS_DE_REPONSE", "A_RAPPELER", "RELANCE_DEVIS", "REACTIVATION"];

const propositionDe = (v: Pick<TacheVue, "raccourci" | "donnees">) => texteOuNull(v.donnees.propositionId) ?? texteOuNull(v.raccourci.propositionId);

/**
 * Le texte prêt : pour un SMS, celui que le détecteur a posé (`donnees.texteSms`), sinon celui du catalogue
 * (`proposerSms`) quand l'action n'ouvre ni espace ni dossier — sinon « texte prêt dans l'écran SMS » ; pour un mail
 * (proposition d'envoi en attente), l'objet et le texte de la proposition. Rien n'est écrit.
 */
export async function textePret(v: TacheVue, maintenant: Date): Promise<TextePret | null> {
  const propositionId = propositionDe(v);
  if (propositionId) {
    const proposition = await prisma.proposition.findUnique({ where: { id: propositionId }, select: { type: true, statut: true, contenu: true } });
    if (proposition?.statut === "EN_ATTENTE") {
      const contenu = lireObjet(proposition.contenu);
      if (proposition.type === "ENVOI_MAIL" && typeof contenu.texte === "string") {
        return { canal: "MAIL", texte: contenu.texte, objet: String(contenu.objet ?? ""), a: String(contenu.a ?? ""), propositionId, source: "PROPOSITION" };
      }
      if (proposition.type === "ENVOI_SMS" && typeof contenu.texte === "string") return { canal: "SMS", texte: contenu.texte, telephone: null, code: texteOuNull(contenu.modele), source: "DETECTEUR" };
    }
  }
  const demande = v.raccourci.sms ?? null;
  const texteSms = texteOuNull(v.donnees.texteSms);
  if (texteSms) return { canal: "SMS", texte: texteSms, telephone: await telephoneLisibleDe(v.raccourci.telephone), code: texteOuNull(v.donnees.codeSms), source: "DETECTEUR" };
  if (v.raccourci.genre !== "SMS" && !demande) return null;
  if (demande && ACTIONS_SMS_SANS_ECRITURE.includes(demande.action)) {
    try {
      const { proposerSms } = await import("@/lib/sms/proposition");
      const sms = await proposerSms({ action: demande.action as ActionSms, leadId: demande.leadId ?? v.leadId, dossierId: demande.dossierId ?? v.dossierId, relance: (demande.relance ?? null) as RelanceSms | null }, maintenant);
      return { canal: "SMS", texte: sms.texte, telephone: await telephoneLisibleDe(sms.telephone), code: sms.code, source: "CATALOGUE" };
    } catch {
      // Contact ou devis introuvable : l'écran SMS dira pourquoi.
    }
  }
  return { canal: "SMS", texte: null, ecran: lienDeLaTache(v), source: "ECRAN_SMS" };
}

function ligneTextePret(t: TextePret | null): string | null {
  if (!t) return null;
  if (t.canal === "MAIL") return `mail prêt pour ${t.a || "le client"}, objet « ${t.objet} » : « ${t.texte.length > 700 ? `${t.texte.slice(0, 700)}…` : t.texte} »`;
  if (t.texte === null) return `texte prêt dans l'écran SMS : ${t.ecran}`;
  return `SMS prêt${t.telephone ? ` (au ${t.telephone})` : ""} : « ${t.texte} »`;
}

export type TacheLue = TacheVue & { faire: string; lien: string; textePret: TextePret | null };

/** La tâche avec son geste en mots, son lien absolu et son texte prêt. */
export async function lireEnMots(v: TacheVue, maintenant: Date, avecTexte = true): Promise<TacheLue> {
  return { ...v, faire: await raccourciEnMots(v), lien: lienDeLaTache(v), textePret: avecTexte ? await textePret(v, maintenant) : null };
}

const LIBELLE_REPONSE = { FAIT: "faite", PLUS_TARD: "reportée", PAS_A_FAIRE: "écartée" } as const;

/** « 1. Faire le devis · Bloch — simulation validée le 28/09, 10 min [tache:<id>] », puis le geste et le texte prêt. */
export function ligneTache(t: TacheLue, rang: number, maintenant: Date, detail = true): string {
  const extras: string[] = [];
  if (t.statut === "PLUS_TARD" && t.plusTardJusqua && Date.parse(t.plusTardJusqua) > maintenant.getTime()) extras.push(`revient ${retourLisible(t.plusTardJusqua)}`);
  else if (t.revenueLe || (t.statut === "PLUS_TARD" && t.plusTardJusqua)) extras.push("revenue d'un « plus tard »");
  if ((t.statut === "FAITE" || t.statut === "PAS_A_FAIRE") && t.reponse) {
    const raison = t.reponseRaison ? LIBELLES_RAISON_PAS_A_FAIRE[t.reponseRaison as RaisonPasAFaire] : null;
    extras.push(`${LIBELLE_REPONSE[t.reponse]}${t.reponduParLisible ? ` par ${t.reponduParLisible}` : ""}${raison ? ` (${raison.toLowerCase()})` : t.reponseTexte ? ` (${t.reponseTexte})` : ""}`);
  }
  const tete = `${rang}. ${t.titre} — ${t.raison}, ${t.dureeMin} min${extras.length ? ` · ${extras.join(" · ")}` : ""} [tache:${t.id}]`;
  if (!detail) return tete;
  const texte = ligneTextePret(t.textePret);
  return [tete, `   → ${t.faire}`, texte ? `   ${texte}` : null].filter(Boolean).join("\n");
}

/** « 151 anciens leads à classer · environ 2 h 31 [lot:anciens-leads] ». */
const ligneLot = (l: ListeTaches["lots"][number]) => `${l.libelle} · environ ${dureeLisible(l.dureeMin)} [lot:${l.cle}]`;

/** La phrase d'en-tête : « 7 tâches aujourd'hui, environ 45 minutes. » et la suite. */
export function enteteListe(liste: ListeTaches): string {
  const c = liste.compteurs;
  const tete = c.aujourdhui ? `${pluriel(c.aujourdhui, "tâche")} aujourd'hui, environ ${dureeLisible(c.minutesAujourdhui)}.` : "Rien à faire aujourd'hui.";
  const suite = [
    c.plusTard ? `${c.plusTard} plus tard` : null,
    c.enLot ? `${c.enLot} en lot (${pluriel(liste.lots.length, "lot")})` : null,
    c.faitAujourdhui ? `${pluriel(c.faitAujourdhui, "faite", "faites")} aujourd'hui` : null,
    liste.demain ? `${pluriel(liste.demain, "revient", "reviennent")} demain` : null,
  ].filter(Boolean);
  return suite.length ? `${tete} Ensuite : ${suite.join(", ")}.` : tete;
}

/**
 * La liste en texte lisible (ce_qui_m_attend, point_du_jour) : l'en-tête, les tâches d'aujourd'hui (titre, raison,
 * durée, geste), les lots, les premières de « plus tard », ce qui est fait aujourd'hui.
 */
export async function texteListe(liste: ListeTaches, maintenant: Date, options: { plusTard?: number; fait?: number; detail?: boolean } = {}): Promise<{ texte: string; aujourdhui: TacheLue[] }> {
  const detail = options.detail ?? true;
  const aujourdhui = await Promise.all(liste.aujourdhui.map((v) => lireEnMots(v, maintenant, detail)));
  const plusTard = await Promise.all(liste.plusTard.slice(0, options.plusTard ?? 5).map((v) => lireEnMots(v, maintenant, false)));
  const fait = await Promise.all(liste.faitAujourdhui.slice(0, options.fait ?? 5).map((v) => lireEnMots(v, maintenant, false)));
  const parties = [
    enteteListe(liste),
    ...aujourdhui.map((t, i) => ligneTache(t, i + 1, maintenant, detail)),
    liste.lots.length ? `En lot : ${liste.lots.map(ligneLot).join(" · ")}.` : null,
    plusTard.length ? `Plus tard (${liste.compteurs.plusTard}) :\n${plusTard.map((t, i) => ligneTache(t, i + 1, maintenant, false)).join("\n")}` : null,
    fait.length ? `Fait aujourd'hui (${liste.compteurs.faitAujourdhui}) :\n${fait.map((t, i) => ligneTache(t, i + 1, maintenant, false)).join("\n")}` : null,
  ];
  return { texte: parties.filter(Boolean).join("\n"), aujourdhui };
}

/* ── taches ────────────────────────────────────────────────────────────── */

export const VUES_TACHES = ["AUJOURDHUI", "TOUT", "PAR_TYPE", "MINUTES", "PLUS_TARD", "FAIT", "LOTS"] as const;

/**
 * Vue TOUT (ex-« ce_qui_m_attend ») : la liste entière des tâches (aujourd'hui avec le geste et le texte prêt, lots,
 * plus tard, fait aujourd'hui), puis les mails à traiter (le compteur de l'onglet Mail), les propositions à valider et
 * les messages d'espace non lus.
 */
async function vueTout(maintenant: Date): Promise<ResultatOutil> {
  const [{ listerVue }, { compterMailATraiter }, { compterMessagesNonLus }] = await Promise.all([import("@/lib/mail/vues"), import("@/lib/a-faire/ecran"), import("@/lib/espace/messages")]);
  const [liste, mails, mailsATraiter, messagesNonLus, propositionsEnAttente] = await Promise.all([
    listeTaches(maintenant),
    listerVue("A_TRAITER", { limite: 50 }),
    compterMailATraiter(maintenant),
    compterMessagesNonLus(),
    prisma.proposition.count({ where: { statut: "EN_ATTENTE", archiveLe: null } }),
  ]);
  const { texte: texteTaches, aujourdhui } = await texteListe(liste, maintenant);
  const texte = [
    texteTaches,
    `Aussi : ${pluriel(mailsATraiter, "mail")} à traiter, ${pluriel(propositionsEnAttente, "proposition")} à valider (cartes de mise à jour, relances, règles), ${pluriel(messagesNonLus, "message d'espace non lu", "messages d'espace non lus")}${messagesNonLus ? " (« lister » MESSAGES_ESPACE)" : ""}.`,
    mails.lignes.length ? `Mails à traiter : ${mails.lignes.slice(0, 8).map((m) => `${m.correspondant.nom ?? m.correspondant.adresse} — ${m.objet ?? "(sans objet)"}${m.mention ? ` (${m.mention.toLowerCase()})` : ""}`).join(" · ")}` : "",
  ].filter(Boolean).join("\n");
  return {
    texte,
    donnees: {
      vue: "TOUT",
      genereLe: liste.genereLe,
      compteurs: { ...liste.compteurs, demain: liste.demain, mailsATraiter, messagesEspaceNonLus: messagesNonLus, propositionsEnAttente },
      aujourdhui,
      lots: liste.lots,
      plusTard: liste.plusTard,
      faitAujourdhui: liste.faitAujourdhui,
      mails: mails.lignes.slice(0, 20),
    },
    liens: [lien("Tâches", "/taches"), lien("Mail", "/mail"), ...(propositionsEnAttente ? [lien("À valider", "/validation")] : [])],
  };
}

export const outilTaches = definirOutil({
  nom: "taches",
  titre: "Les tâches de Lucas (ce qu'il a à faire)",
  description:
    "La liste unique de ce que Lucas a à faire, dans l'ordre du CRM (argent en jeu, puis chaud, production, système, ménage ; à niveau égal le plus gros montant, puis le plus ancien). Réponse à « qu'est-ce que j'ai à faire ? », « c'est quoi la suite ? », « j'ai 20 minutes, je fais quoi ? » (minutes). Vues : AUJOURDHUI (défaut : les 10 du jour), TOUT (« qu'est-ce qui m'attend ? » : la liste entière — aujourd'hui, lots, plus tard, fait —, puis les mails à traiter, les propositions à valider et les messages d'espace non lus), PAR_TYPE (regroupées : appels, devis…), MINUTES (le meilleur ensemble qui tient dans N minutes : « 3 appels · 10 min »), PLUS_TARD (le reste et les reportées, avec leur retour), FAIT (fait ou écarté aujourd'hui), LOTS (le ménage en lot ; « lot » = sa clé [lot:…] pour « Revoir un par un » : les tâches du lot, chacune avec son identifiant ; « Tout classer » : « repondre_tache » tache « lot:<clé> »). Chaque tâche a son identifiant [tache:…], son geste prêt (« appeler le 06… », « ouvrir le devis prérempli : lien ») et, pour un SMS ou un mail, le TEXTE PRÊT à lire tel quel. Lis à Lucas le titre et la raison, jamais l'identifiant ; garde l'identifiant de la dernière tâche citée : « c'est fait » → « repondre_tache » avec cet identifiant.",
  niveau: "LECTURE",
  schema: z.object({
    vue: z.enum(VUES_TACHES).optional().describe("AUJOURDHUI (défaut), TOUT, PAR_TYPE, MINUTES, PLUS_TARD, FAIT ou LOTS."),
    lot: z.string().max(80).optional().describe("La clé d'un lot de ménage ([lot:…] rendu par la vue LOTS) : ses tâches, une par une."),
    minutes: z.number().int().min(5).max(240).optional().describe("« J'ai N minutes » : le temps dont Lucas dispose (vue MINUTES, implicite si donné seul)."),
  }),
  executer: async (e, contexte) => {
    const maintenant = contexte.maintenant;
    const vue = e.vue ?? (e.minutes ? "MINUTES" : "AUJOURDHUI");
    const liens = [lien("Tâches", "/taches")];
    if (vue === "MINUTES") {
      const plan = await planMinutes(e.minutes ?? 15, maintenant);
      const taches = await Promise.all(plan.taches.map((v) => lireEnMots(v, maintenant)));
      const texte = plan.taches.length
        ? [`Avec ${dureeLisible(plan.minutes)} : ${plan.groupes.map((g) => g.libelle).join(", ")} (${plan.utilisees} min sur ${plan.minutes}).`, ...taches.map((t, i) => ligneTache(t, i + 1, maintenant))].join("\n")
        : `Rien ne tient en ${dureeLisible(plan.minutes)}${(await listeTaches(maintenant)).compteurs.aujourdhui ? " : la plus courte des tâches du jour prend plus de temps" : " : aucune tâche à faire"}.`;
      return { texte, donnees: { vue, genereLe: maintenant.toISOString(), minutes: plan.minutes, utilisees: plan.utilisees, groupes: plan.groupes, taches }, liens };
    }
    if (e.lot) {
      const cle = e.lot.trim().replace(/^\[?lot:/i, "").replace(/\]$/, "");
      const taches = await Promise.all((await tachesDuLot(cle, maintenant)).map((v) => lireEnMots(v, maintenant, false)));
      const texte = taches.length ? [`Lot ${cle} : ${pluriel(taches.length, "tâche")} (« repondre_tache » une par une, ou tache « lot:${cle} » FAIT pour tout classer) :`, ...taches.map((t, i) => ligneTache(t, i + 1, maintenant))].join("\n") : `Rien dans le lot ${cle}.`;
      return { texte, donnees: { vue: "LOTS", lot: cle, taches }, liens };
    }
    if (vue === "TOUT") return vueTout(maintenant);
    const liste = await listeTaches(maintenant);
    const base = { vue, genereLe: liste.genereLe, compteurs: liste.compteurs, demain: liste.demain };
    switch (vue) {
      case "AUJOURDHUI": {
        const taches = await Promise.all(liste.aujourdhui.map((v) => lireEnMots(v, maintenant)));
        const texte = [enteteListe(liste), ...taches.map((t, i) => ligneTache(t, i + 1, maintenant))].join("\n");
        return { texte, donnees: { ...base, taches, lots: liste.lots }, liens };
      }
      case "PAR_TYPE": {
        const ouvertes = [...liste.aujourdhui, ...liste.plusTard.filter((v) => v.statut === "A_FAIRE" || !v.plusTardJusqua || Date.parse(v.plusTardJusqua) <= maintenant.getTime())];
        const taches = await Promise.all(ouvertes.map((v) => lireEnMots(v, maintenant)));
        const groupes = new Map<string, TacheLue[]>();
        for (const t of taches) {
          const nom = GROUPES_TYPE[t.type as TypeTache]?.[1] ?? t.type;
          groupes.set(nom, [...(groupes.get(nom) ?? []), t]);
        }
        const texte = taches.length
          ? [
              `${pluriel(taches.length, "tâche")} à faire, environ ${dureeLisible(taches.reduce((s, t) => s + t.dureeMin, 0))}, par type :`,
              ...[...groupes.entries()].map(([nom, liste]) => `${nom.charAt(0).toUpperCase()}${nom.slice(1)} (${liste.length} · ${liste.reduce((s, t) => s + t.dureeMin, 0)} min) :\n${liste.map((t, i) => ligneTache(t, i + 1, maintenant)).join("\n")}`),
            ].join("\n")
          : "Rien à faire.";
        return { texte, donnees: { ...base, groupes: [...groupes.entries()].map(([nom, liste]) => ({ nom, nombre: liste.length, minutes: liste.reduce((s, t) => s + t.dureeMin, 0), taches: liste })) }, liens };
      }
      case "PLUS_TARD": {
        const taches = await Promise.all(liste.plusTard.map((v) => lireEnMots(v, maintenant)));
        const texte = taches.length ? [`${pluriel(taches.length, "tâche")} plus tard${liste.demain ? `, dont ${liste.demain} qui ${liste.demain > 1 ? "reviennent" : "revient"} demain` : ""} :`, ...taches.map((t, i) => ligneTache(t, i + 1, maintenant))].join("\n") : "Rien dans « plus tard ».";
        return { texte, donnees: { ...base, taches }, liens };
      }
      case "FAIT": {
        const taches = await Promise.all(liste.faitAujourdhui.map((v) => lireEnMots(v, maintenant, false)));
        const texte = taches.length ? [`${pluriel(taches.length, "tâche")} faite${taches.length > 1 ? "s" : ""} ou écartée${taches.length > 1 ? "s" : ""} aujourd'hui :`, ...taches.map((t, i) => ligneTache(t, i + 1, maintenant, false))].join("\n") : "Rien de fait aujourd'hui pour l'instant.";
        return { texte, donnees: { ...base, taches }, liens };
      }
      case "LOTS": {
        const texte = liste.lots.length ? [`${pluriel(liste.lots.length, "lot")} de ménage (« Tout classer » ou « Revoir un par un » dans l'onglet Tâches) :`, ...liste.lots.map((l) => `- ${ligneLot(l)}`)].join("\n") : "Aucun lot à classer.";
        return { texte, donnees: { ...base, lots: liste.lots }, liens };
      }
    }
  },
});

/* ── Retrouver une tâche ───────────────────────────────────────────────── */

const MOTS_VIDES = new Set(["le", "la", "les", "l", "de", "du", "des", "d", "a", "au", "aux", "un", "une", "et", "pour", "avec", "sur", "en", "ma", "mon", "mes", "sa", "son", "ses", "c", "est", "tache", "taches", "ce", "cette"]);
const plier = (texte: string) => texte.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export type Recherche = { tache: TacheAFaire; candidats?: undefined } | { tache?: undefined; candidats: TacheAFaire[] };

/**
 * La tâche désignée : par son identifiant (« tache:… » accepté), sinon par son titre approché parmi les tâches
 * ouvertes (à faire, plus tard) — ou, pour « ANNULER », parmi celles qui ont une réponse à défaire. Un seul candidat,
 * ou la liste des candidats (jamais un choix à la place de Lucas).
 */
export async function retrouverTache(designation: string, pourAnnuler: boolean): Promise<Recherche> {
  const brut = designation.trim().replace(/^\[?tache:/i, "").replace(/\]$/, "");
  if (/^[a-z0-9]{12,40}$/i.test(brut)) {
    const parId = await prisma.tacheAFaire.findUnique({ where: { id: brut } });
    if (parId && !parId.archiveLe) return { tache: parId };
  }
  const mots = plier(designation).split(" ").filter((m) => m.length >= 2 && !MOTS_VIDES.has(m));
  if (!mots.length) return { candidats: [] };
  const lignes = await prisma.tacheAFaire.findMany({ where: pourAnnuler ? { precedent: { not: null } } : { statut: { in: ["A_FAIRE", "PLUS_TARD"] } }, orderBy: { updatedAt: "desc" }, take: 2000 });
  const complets = lignes.filter((l) => {
    const cible = ` ${plier(`${l.titre} ${l.raison} ${l.lotLibelle ?? ""}`)} `;
    return mots.every((m) => cible.includes(m));
  });
  if (complets.length === 1) return { tache: complets[0] };
  const exacts = complets.filter((l) => plier(l.titre) === plier(designation));
  if (exacts.length === 1) return { tache: exacts[0] };
  return { candidats: complets.slice(0, 10) };
}

function texteCandidats(designation: string, candidats: TacheAFaire[], pourAnnuler: boolean): ResultatOutil {
  if (!candidats.length) {
    return { texte: `Aucune tâche ${pourAnnuler ? "avec une réponse à annuler" : "ouverte"} ne correspond à « ${designation} ». Relis la liste (« taches ») et rappelle avec l'identifiant de la tâche.` };
  }
  return {
    texte: `Plusieurs tâches correspondent à « ${designation} », je ne choisis pas à ta place :\n${candidats.map((c) => `- ${c.titre} — ${c.raison} [tache:${c.id}]`).join("\n")}\nDemande à Lucas laquelle, puis rappelle avec son identifiant.`,
    donnees: candidats.map((c) => ({ id: c.id, titre: c.titre, raison: c.raison, statut: c.statut, type: c.type })),
  };
}

/* ── repondre_tache ────────────────────────────────────────────────────── */

const REPONSES_OUTIL = ["FAIT", "PLUS_TARD", "PAS_A_FAIRE", "ANNULER"] as const;
const QUAND_EN_MOTS: Record<string, QuandPlusTard> = { "ce soir": "CE_SOIR", "demain": "DEMAIN", "demain matin": "DEMAIN", "lundi": "LUNDI", "semaine": "SEMAINE", "dans une semaine": "SEMAINE", "la semaine prochaine": "SEMAINE" };

/** « Plus tard » : CE_SOIR, DEMAIN, LUNDI, SEMAINE, ou une date dictée (« jeudi », « le 12 », « 14 octobre ») lue à 9 h. */
export function lireQuand(quand: string | undefined, maintenant: Date): { quand?: QuandPlusTard; date?: string } {
  if (!quand?.trim()) return {};
  const code = quand.trim().toUpperCase().replace(/[\s-]+/g, "_");
  if ((QUAND_PLUS_TARD as readonly string[]).includes(code)) return { quand: code as QuandPlusTard };
  const enMots = QUAND_EN_MOTS[plier(quand)];
  if (enMots) return { quand: enMots };
  const date = lireDateDictee(quand, maintenant, 9);
  if (!date) throw new ErreurMetier(`Je ne comprends pas « ${quand} » : dis ce soir, demain, lundi, dans une semaine, ou une date (« jeudi », « le 12 », « 14 octobre »).`, 400);
  return { date: date.toISOString() };
}

const schemaRepondre = z.object({
  tache: z.string().min(1).max(200).describe("L'identifiant de la tâche (rendu par « taches » : celui de la dernière tâche citée), ou à défaut son titre tel que Lucas le dit (« le devis Bloch ») ; « lot:<clé> » pour un lot de ménage entier (FAIT = « Tout classer », ANNULER = défaire ce classement)."),
  reponse: z.enum(REPONSES_OUTIL).describe("FAIT, PLUS_TARD, PAS_A_FAIRE, ou ANNULER (défait la dernière réponse et son effet quand c'est possible)."),
  quand: z.string().max(60).optional().describe("PLUS_TARD : CE_SOIR, DEMAIN, LUNDI, SEMAINE, ou une date dictée (« jeudi », « le 12 », « 14 octobre à 14h »)."),
  raison: z.string().max(40).optional().describe(`PLUS_TARD (facultatif) : ${RAISONS_PLUS_TARD.join(", ")}. PAS_A_FAIRE (obligatoire) : ${RAISONS_PAS_A_FAIRE.join(", ")} — selon le type de tâche ; AUTRE avec « texte ».`),
  texte: z.string().max(500).optional().describe("Une précision libre (obligatoire pour la raison AUTRE)."),
  motif_perte: z.enum(MOTIFS_PERTE).optional().describe("CLIENT_PERDU : PRIX, CONCURRENT, SANS_REPONSE, PROJET_ABANDONNE, HORS_ZONE, DELAI, AUTRE (+ precision)."),
  precision: z.string().max(500).optional().describe("Précision du motif de perte (obligatoire pour AUTRE)."),
  le: z.string().max(40).optional().describe("ANNULER un lot : l'instant du classement rendu par « Tout classer » (à défaut, le dernier classement du lot)."),
});
type EntreeRepondre = z.output<typeof schemaRepondre>;

type PropositionLue = { id: string; type: string; titre: string; statut: string; contenu: Record<string, unknown>; sensible: boolean };

async function propositionDeLaTache(tache: TacheAFaire): Promise<PropositionLue | null> {
  const id = texteOuNull(lireObjet(tache.donnees).propositionId) ?? texteOuNull(lireObjet(tache.raccourci).propositionId);
  if (!id) return null;
  const p = await prisma.proposition.findUnique({ where: { id } });
  if (!p) return null;
  const { vueProposition } = await import("@/lib/validation/service");
  return { id: p.id, type: p.type, titre: p.titre, statut: p.statut, contenu: lireObjet(p.contenu), sensible: vueProposition(p).sensible };
}

/** « Fait » sur une VALIDER dont la proposition en attente envoie un mail, un SMS, ou est sensible (argent, client). */
async function validationSensible(tache: TacheAFaire): Promise<PropositionLue | null> {
  if (tache.type !== "VALIDER") return null;
  const p = await propositionDeLaTache(tache);
  return p && p.statut === "EN_ATTENTE" && (p.sensible || p.type === "ENVOI_MAIL" || p.type === "ENVOI_SMS") ? p : null;
}

/** « Pas à faire » client perdu qui passe un lead en sans suite ou un dossier en perdu. */
const pertePrevue = (tache: TacheAFaire, e: EntreeRepondre) => e.reponse === "PAS_A_FAIRE" && e.raison?.trim().toUpperCase() === "CLIENT_PERDU" && Boolean(e.motif_perte) && Boolean(tache.dossierId || tache.leadId);

const DELAI_SECONDES = Math.round(DELAI_EFFET_MS / 1000);

/** Ce que la perte va toucher : le dossier (le sien, ou celui du contact), sinon le contact. */
async function descriptionPerte(tache: TacheAFaire, motif: MotifPerte, precision: string | null): Promise<string> {
  const motifLisible = motifPerteDansUnePhrase(motif, precision);
  const dossierId = tache.dossierId ?? (tache.leadId ? (await prisma.dossier.findFirst({ where: { leadId: tache.leadId, archiveLe: null }, orderBy: { createdAt: "desc" }, select: { id: true } }))?.id : null);
  if (dossierId) {
    const d = await prisma.dossier.findUnique({ where: { id: dossierId }, select: { clientNom: true } });
    return `le dossier de ${d?.clientNom ?? "ce client"} passera à « Perdu » (motif : ${motifLisible}) — irréversible d'ici, il faudrait le reprendre depuis son étape`;
  }
  const l = tache.leadId ? await prisma.lead.findUnique({ where: { id: tache.leadId }, select: { prenom: true, nom: true } }) : null;
  const nom = l ? `${l.prenom} ${l.nom}`.trim() : "";
  return `le contact${nom ? ` ${nom}` : ""} sera classé sans suite (motif : ${motifLisible}) ; « ANNULER » le remet dans les listes`;
}

/**
 * Ce que la réponse va faire sur la source, en mots (le même calcul que `reponses.ts › effetsDe`, pour le dire à
 * Lucas) : proposition validée ou ignorée, fil archivé ou reporté, messages de l'espace lus, appel noté, prochaine action
 * levée, perte.
 */
async function effetsEnMots(tache: TacheAFaire, e: EntreeRepondre, jusqua: Date | null): Promise<string[]> {
  const raccourci = lireObjet(tache.raccourci);
  const donnees = lireObjet(tache.donnees);
  const effets: string[] = [];
  const proposition = await propositionDeLaTache(tache);
  const enAttente = proposition?.statut === "EN_ATTENTE";
  if (tache.type === "VALIDER" && proposition) {
    if (enAttente && e.reponse === "FAIT") {
      const c = proposition.contenu;
      if (proposition.type === "ENVOI_MAIL") effets.push(`la proposition « ${proposition.titre} » sera validée : le mail${c.motif === "RELANCE_DEVIS" ? " de relance" : ""} partira à ${String(c.a ?? "?")} (objet « ${String(c.objet ?? "")} ») tout de suite, et ne se rattrape pas une fois parti`);
      else if (proposition.type === "ENVOI_SMS") effets.push(`la proposition « ${proposition.titre} » sera validée : le SMS partira au client tout de suite, et ne se rattrape pas une fois parti`);
      else effets.push(`la proposition « ${proposition.titre} » sera validée et appliquée${proposition.sensible ? " (elle touche l'argent ou le client)" : ""} — une validation ne se défait pas d'ici`);
    } else if (enAttente && e.reponse === "PAS_A_FAIRE") effets.push(`la proposition « ${proposition.titre} » sera ignorée`);
  } else {
    if (proposition && enAttente && e.reponse !== "PLUS_TARD") effets.push(`la proposition « ${proposition.titre} » sera ignorée (${e.reponse === "FAIT" || e.raison?.trim().toUpperCase() === "DEJA_FAIT" ? "déjà fait autrement" : "inutile"})`);
    const mails = messagesDeLaTache(raccourci, donnees);
    if (mails.length) effets.push(e.reponse === "PLUS_TARD" && jusqua ? `le fil du mail sera reporté jusqu'à ${retourLisible(jusqua)}` : e.reponse === "PLUS_TARD" ? "" : "le fil du mail sera archivé");
  }
  const depuisLEspace = tache.type === "REPONDRE" && (tache.source === "ESPACE_MESSAGES" || raccourci.genre === "ESPACE");
  if ((texteOuNull(donnees.espaceDossierId) || (depuisLEspace && tache.dossierId)) && e.reponse !== "PLUS_TARD") {
    effets.push(`les messages de l'espace seront marqués lus (${e.reponse === "FAIT" ? "répondu hors du CRM" : "pas de réponse à faire"})`);
  }
  if (e.reponse === "FAIT" && (tache.type === "APPELER" || tache.type === "RAPPELER") && tache.leadId) effets.push("l'appel sera noté sur la fiche");
  if (e.reponse !== "PLUS_TARD" && tache.type === "PROCHAINE_ACTION" && tache.dossierId && texteOuNull(donnees.poseeLe)) effets.push("la prochaine action posée à la main sera retirée du dossier (il revient au suivi normal)");
  if (pertePrevue(tache, e)) effets.push(await descriptionPerte(tache, e.motif_perte!, e.precision?.trim() || null));
  return effets.filter(Boolean);
}

/** « lot:anciens-leads » → la clé du lot ; sinon null. */
const cleDuLot = (designation: string) => /^\[?lot:([a-z0-9:_-]{1,80})\]?$/i.exec(designation.trim())?.[1] ?? null;

async function repondreAuLot(cle: string, e: EntreeRepondre, maintenant: Date): Promise<ResultatOutil> {
  const liens = [lien("Tâches", "/taches")];
  if (e.reponse === "FAIT") {
    const r = await classerLot(cle, maintenant);
    return { texte: `Lot ${cle} classé : ${pluriel(r.classees, "tâche classée", "tâches classées")}${r.effets ? ` (${pluriel(r.effets, "contact classé", "contacts classés")} sans suite, motif « plus de réponse », dans 6 secondes)` : ""}${r.laissees ? ` ; ${pluriel(r.laissees, "laissée", "laissées")} à revoir une par une (contact qui a un dossier)` : ""}. Pour annuler : « repondre_tache » tache « lot:${cle} », reponse ANNULER, le « ${r.le} ».`, donnees: { lot: cle, ...r, annuler: { outil: "repondre_tache", tache: `lot:${cle}`, reponse: "ANNULER", le: r.le } }, liens };
  }
  if (e.reponse === "ANNULER") {
    const r = await annulerLot(cle, maintenant, e.le);
    return { texte: `Classement du lot ${cle} annulé : ${pluriel(r.restaurees, "tâche revenue", "tâches revenues")}.${r.nonDefaits.length ? ` Pas défait (à reprendre à la main) : ${r.nonDefaits.join(" ; ")}.` : ""}`, donnees: { lot: cle, ...r }, liens };
  }
  throw new ErreurMetier("Un lot se classe en entier (FAIT) ou s'annule (ANNULER) ; pour « plus tard » ou « pas à faire », réponds tâche par tâche (« taches » lot).", 400);
}

const phraseEffets = (effets: string[], quand: string) => (effets.length ? ` ${quand} : ${effets.join(" ; ")}.` : "");

export const outilRepondreTache = definirOutil({
  nom: "repondre_tache",
  titre: "Répondre à une tâche (fait, plus tard, pas à faire, annuler)",
  description:
    "La réponse de Lucas à une tâche de sa liste. « C'est fait » → FAIT avec l'identifiant de la DERNIÈRE tâche citée (rendu par « taches ») ; « plus tard », « demain », « jeudi », « le 12 » → PLUS_TARD avec quand ; « pas à faire », « laisse tomber » → PAS_A_FAIRE avec la raison (DEJA_FAIT, CLIENT_LE_FAIT, PAS_PERTINENT, PAS_DE_REPONSE_A_FAIRE pour un mail, CLIENT_PERDU avec motif_perte, AUTRE avec texte) ; « annule » → ANNULER (remet la tâche comme avant et défait l'effet quand c'est possible). Un lot de ménage entier : tache « lot:<clé> », FAIT = « Tout classer » (sensible : aperçu puis confirmation), ANNULER = le défaire. Sans identifiant, le titre approché est cherché parmi les tâches ouvertes : plusieurs candidats → demande laquelle, ne choisis jamais. L'effet sur la source part 6 secondes après (proposition validée ou ignorée, fil archivé ou reporté, messages lus, appel noté, prochaine action levée). Sensible (aperçu puis confirmation) quand l'effet touche le client ou l'argent : « Fait » sur une validation qui envoie un mail ou un SMS ou touche un montant, « client perdu » qui passe un contact sans suite ou un dossier perdu.",
  niveau: "REVERSIBLE",
  schema: schemaRepondre,
  sensible: async (e) => {
    if (cleDuLot(e.tache)) return e.reponse === "FAIT";
    if (e.reponse !== "FAIT" && e.reponse !== "PAS_A_FAIRE") return false;
    const { tache } = await retrouverTache(e.tache, false);
    if (!tache) return false;
    return e.reponse === "FAIT" ? Boolean(await validationSensible(tache)) : pertePrevue(tache, e);
  },
  apercu: async (e, contexte) => {
    const lot = cleDuLot(e.tache);
    if (lot) {
      const taches = await tachesDuLot(lot, contexte.maintenant);
      const contacts = taches.filter((t) => t.type === "CLASSER_LEAD").length;
      return `Je vais classer tout le lot ${lot} : ${pluriel(taches.length, "tâche")} passent « pas à faire »${contacts ? `, dont ${pluriel(contacts, "ancien contact classé", "anciens contacts classés")} sans suite (motif « plus de réponse » ; un contact qui a un dossier est laissé)` : ""}. « ANNULER » sur le lot défait ce classement.`;
    }
    const { tache } = await retrouverTache(e.tache, false);
    if (!tache) return `Je vais répondre « ${e.reponse} » à la tâche « ${e.tache} ».`;
    const effets = await effetsEnMots(tache, e, null);
    const tete = e.reponse === "FAIT" ? `Je vais marquer « ${tache.titre} » comme faite.` : `Je vais écarter « ${tache.titre} » : client perdu.`;
    const quand = e.reponse === "FAIT" ? "Dès ta confirmation" : `${DELAI_SECONDES} secondes après ta confirmation`;
    return `${tete}${phraseEffets(effets, quand)} Ensuite, « ANNULER » remet la tâche comme avant, mais ne rattrape ni un mail parti ni une validation.`;
  },
  executer: async (e, contexte) => {
    const maintenant = contexte.maintenant;
    const lot = cleDuLot(e.tache);
    if (lot) return repondreAuLot(lot, e, maintenant);
    const pourAnnuler = e.reponse === "ANNULER";
    const trouvee = await retrouverTache(e.tache, pourAnnuler);
    if (!trouvee.tache) return texteCandidats(e.tache, trouvee.candidats, pourAnnuler);
    const tache = trouvee.tache;
    const liens = [lien("Tâches", "/taches")];
    const commentAnnuler = `Pour annuler : « repondre_tache » avec tache « ${tache.id} » et reponse ANNULER.`;

    if (e.reponse === "ANNULER") {
      const r = await annulerReponse(tache.id, maintenant);
      const etat = r.tache.statut === "A_FAIRE" ? "de nouveau à faire" : r.tache.statut === "PLUS_TARD" ? "de nouveau reportée" : `de nouveau ${LIBELLE_REPONSE[r.tache.reponse ?? "FAIT"]}`;
      const texte = [
        `Annulé : « ${r.tache.titre} » est ${etat}.`,
        r.effetAnnule ? "L'effet n'était pas encore parti : il ne partira pas." : "",
        r.defaits.length ? `Défait : ${r.defaits.join(", ")}.` : "",
        r.nonDefaits.length ? `Pas défait (à reprendre à la main) : ${r.nonDefaits.join(" ; ")}.` : "",
      ].filter(Boolean).join(" ");
      return { texte, donnees: r, liens };
    }

    // « Fait » sur une validation sensible, confirmé par Lucas (aperçu puis jeton) : la proposition est validée ici,
    // comme par « valider_proposition » (repondreTache refuse de valider une proposition sensible sans l'écran « À valider »).
    const sensible = e.reponse === "FAIT" ? await validationSensible(tache) : null;
    let validation: { statut: string; erreur: string | null } | null = null;
    if (sensible) {
      const { appliquerProposition } = await import("@/lib/mail/appliquer");
      const { vueProposition } = await import("@/lib/validation/service");
      let vue: Awaited<ReturnType<typeof appliquerProposition>>;
      try {
        vue = await appliquerProposition(sensible.id);
      } catch (erreur) {
        // Validée mais l'exécution a échoué (mail non parti…) : la proposition le garde ; sinon, le refus tel quel.
        const relue = await prisma.proposition.findUnique({ where: { id: sensible.id } });
        if (!relue || relue.statut === "EN_ATTENTE") throw erreur;
        vue = vueProposition(relue);
        vue.erreurExecution ??= erreur instanceof Error ? erreur.message : String(erreur);
      }
      validation = { statut: vue.statut, erreur: vue.erreurExecution ?? null };
      if (vue.statut !== "EXECUTEE" && vue.statut !== "VALIDEE") {
        return { texte: `La proposition « ${sensible.titre} » est validée mais n'a pas abouti (${vue.erreurExecution ?? vue.statut.toLowerCase()}) : la tâche reste à faire. Regarde « À valider ».`, donnees: { tache: versVue(tache), proposition: vue }, liens: [...liens, lien("À valider", "/validation")] };
      }
    }

    const { quand, date } = e.reponse === "PLUS_TARD" ? lireQuand(e.quand, maintenant) : {};
    const effetsPrevus = sensible ? [] : await effetsEnMots(tache, e, null);
    const r = await repondreTache(
      tache.id,
      {
        reponse: e.reponse,
        ...(quand ? { quand } : {}),
        ...(date ? { date } : {}),
        ...(e.raison?.trim() ? { raison: e.raison.trim().toUpperCase() } : {}),
        ...(e.texte?.trim() ? { texte: e.texte.trim() } : {}),
        ...(e.motif_perte ? { motifPerte: e.motif_perte } : {}),
        ...(e.precision?.trim() ? { precisionPerte: e.precision.trim() } : {}),
      },
      maintenant
    );
    const effets = e.reponse === "PLUS_TARD" && r.tache.plusTardJusqua ? await effetsEnMots(tache, e, new Date(r.tache.plusTardJusqua)) : effetsPrevus;
    let tete: string;
    if (e.reponse === "FAIT") tete = `C'est noté : « ${r.tache.titre} » est faite.${sensible ? ` Proposition « ${sensible.titre} » validée${validation?.statut === "EXECUTEE" ? " et exécutée" : " (exécution en cours)"}.` : ""}`;
    else if (e.reponse === "PLUS_TARD") {
      const raison = r.tache.reponseRaison ? LIBELLES_RAISON_PLUS_TARD[r.tache.reponseRaison as RaisonPlusTard] : null;
      tete = `« ${r.tache.titre} » reportée : elle revient ${r.tache.plusTardJusqua ? retourLisible(r.tache.plusTardJusqua) : "plus tard"}${raison ? ` (${raison.toLowerCase()})` : ""}, ou plus tôt si le client se manifeste.`;
    } else {
      const raison = r.tache.reponseRaison ? LIBELLES_RAISON_PAS_A_FAIRE[r.tache.reponseRaison as RaisonPasAFaire] : null;
      tete = `« ${r.tache.titre} » écartée${raison ? ` (${raison.toLowerCase()}${r.tache.reponseTexte && r.tache.reponseRaison !== "CLIENT_PERDU" ? ` : ${r.tache.reponseTexte}` : ""})` : ""}.${e.motif_perte ? ` Motif de perte : ${LIBELLES_MOTIF_PERTE[e.motif_perte].toLowerCase()}.` : ""}`;
    }
    const regle = r.regle?.creee ? ` C'est la troisième fois en 30 jours pour cette raison : je propose une règle (à valider par Lucas : « valider_proposition » [proposition:${r.regle.propositionId}]).` : "";
    const texte = `${tete}${r.effet ? phraseEffets(effets, `Dans ${DELAI_SECONDES} secondes`) : ""}${regle} ${commentAnnuler}`;
    return { texte, donnees: { tache: r.tache, effet: r.effet, regle: r.regle, effets, validation, annuler: { outil: "repondre_tache", tache: tache.id, reponse: "ANNULER" } }, liens };
  },
});

/* ── ajouter_tache ─────────────────────────────────────────────────────── */

export const OUTILS_TACHES_LECTURE = [outilTaches];
export const OUTILS_TACHES_ECRITURE = [outilRepondreTache];
