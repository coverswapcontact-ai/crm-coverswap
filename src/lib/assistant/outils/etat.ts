import { z } from "zod/v4";
import prisma from "@/lib/prisma";
import { listeTaches } from "@/lib/a-faire/lecture";
import { compterMailATraiter } from "@/lib/a-faire/ecran";
import { carnetDeCommandes } from "@/lib/analytique/calculs";
import { auditerConnexions } from "@/lib/audit/connexions";
import { controlerCoherence } from "@/lib/coherence/controle";
import { pluriel } from "@/lib/commun/format";
import { lireCompteurs } from "@/lib/dossiers/compteurs";
import { anneeParis } from "@/lib/dossiers/dates";
import { numerosLibres } from "@/lib/dossiers/registre";
import { etatMiroir } from "@/lib/drive/synchronisation";
import { compterMessagesNonLus } from "@/lib/espace/messages";
import { chargerTableauFinances } from "@/lib/finances/tableau";
import { etatConnexionGoogle } from "@/lib/google/connexion";
import { reglagesMail } from "@/lib/mail/reglages-vue";
import { bilanTri } from "@/lib/mail/vues";
import { etatAgentMail } from "@/lib/messages/consultation";
import { etatBanc } from "@/lib/simulateur/banc/banc";
import { lirePrompt, listerPrompts, texteDeVersion } from "@/lib/simulateur/bibliotheque";
import { consommation } from "@/lib/simulateur/consommation";
import { etatFournisseur } from "@/lib/sms/fournisseurs";
import { listerCatalogue } from "@/lib/sms/modeles";
import { etatDesTaches } from "@/lib/taches/lecture";
import { definirOutil, format, lien, type ContexteOutil, type ResultatOutil } from "../definition";
import { sessionsRecentes } from "../execution";
import { outilListerOutils } from "./catalogue-outils";
import { outilSanteSysteme, santeSysteme } from "./lecture";
import { outilVoirParametres } from "./parametres";
import { outilVoirPublicite } from "./publicite";
import { outilVersionsConsignes } from "./reglages";

/**
 * Mission 17 (partie C) — « etat_crm » : l'état du système et de la configuration (docs/MCP-COUVERTURE.md § 4.7).
 *
 * Sans partie : EN UNE FOIS tout ce qui est ouvert — les tâches du jour, les alertes (santé et Analytique), l'argent en
 * attente (reste à encaisser, chèques à créditer, devis en attente, propositions à valider), les derniers événements
 * (passages et notes des dossiers, leads arrivés) et l'état des sources — pour que Claude sache où on en est sans
 * enchaîner dix appels. Avec une partie : un seul morceau, en détail. Lecture seule, jamais de secret.
 *
 * Remplace sante_systeme (SANTE), voir_parametres (PARAMETRES), versions_consignes (CONSIGNES_VERSIONS), lister_outils
 * (OUTILS) et voir_publicite (META, alias PUBLICITE).
 */

export const PARTIES_ETAT = ["SANTE", "META", "PUBLICITE", "PARAMETRES", "NUMEROTATION", "SMS", "MAIL", "CONSIGNES", "CONSIGNES_VERSIONS", "OUTILS", "TACHES_DE_FOND", "COHERENCE", "AUDIT", "SESSIONS", "CONNEXIONS", "ACCES", "PROMPTS", "BANC", "CONSOMMATION"] as const;
export type PartieEtat = (typeof PARTIES_ETAT)[number];

const schemaEtat = z.object({
  partie: z.enum(PARTIES_ETAT).optional().describe("À défaut : tout ce qui est ouvert, en une fois. SANTE (ex-sante_systeme), META ou PUBLICITE (ex-voir_publicite), PARAMETRES (ex-voir_parametres, historique complet), NUMEROTATION (compteurs, numéros libres du registre), SMS (catalogue avec texte de départ, fournisseur), MAIL (guide de style, modèles, règles posées et proposées, bilan du tri), CONSIGNES (textes, sections, défauts), CONSIGNES_VERSIONS (ex-versions_consignes), OUTILS (ex-lister_outils : registre, empreinte), TACHES_DE_FOND (file avec identifiants), COHERENCE (clé et correction), AUDIT (connexions), SESSIONS (appels de l'assistant), CONNEXIONS (Google, Drive, agent mail), ACCES (applications et jetons), PROMPTS (bibliothèque du simulateur), BANC, CONSOMMATION (OpenAI)."),
  groupe: z.string().max(40).optional().describe("PARAMETRES : un groupe (ou « SMS »)."),
  automatismes: z.boolean().optional().describe("PARAMETRES : seulement les interrupteurs."),
  texte: z.enum(["consignes", "positionnement"]).optional().describe("CONSIGNES_VERSIONS / CONSIGNES : lequel (consignes par défaut)."),
  famille: z.enum(["LECTURE", "ANALYSE", "MAIL", "ECRITURE"]).optional().describe("OUTILS : une famille."),
  interroger_meta: z.boolean().optional().describe("META : vérifier aussi auprès de Meta (appel réseau)."),
  jours: z.number().int().min(1).max(90).optional().describe("META : fenêtre des résultats."),
  type: z.string().max(40).optional().describe("PROMPTS : un type de surface (cuisine, credence…) pour sa version en service et son historique."),
  version: z.number().int().min(1).optional().describe("PROMPTS (avec type) : lire une ancienne version."),
  limite: z.number().int().min(1).max(100).optional(),
});
type EntreeEtat = z.output<typeof schemaEtat>;

const JOUR = 86_400_000;
const court = (texte: string | null | undefined, n: number) => (!texte ? "" : texte.length > n ? `${texte.slice(0, n)}…` : texte);

/* ── Tout, en une fois ──────────────────────────────────────────────── */

export async function etatGlobal(contexte: ContexteOutil): Promise<ResultatOutil> {
  const maintenant = contexte.maintenant;
  const { texteListe } = await import("./taches");
  const depuis = new Date(maintenant.getTime() - 2 * JOUR);
  const [liste, sante, finances, carnet, propositions, mails, messagesEspace, evenements, leads] = await Promise.all([
    listeTaches(maintenant),
    santeSysteme(maintenant),
    chargerTableauFinances(anneeParis(maintenant), maintenant).catch(() => null),
    carnetDeCommandes().catch(() => []),
    prisma.proposition.findMany({ where: { statut: { in: ["EN_ATTENTE", "ECHEC"] } }, orderBy: { createdAt: "desc" }, take: 50, select: { id: true, type: true, titre: true, statut: true } }),
    compterMailATraiter(maintenant),
    compterMessagesNonLus(),
    prisma.dossierEvenement.findMany({ where: { createdAt: { gte: depuis }, type: { notIn: ["MAIL_RECU"] } }, orderBy: { createdAt: "desc" }, take: 15, select: { dossierId: true, type: true, contenu: true, createdAt: true, dossier: { select: { clientNom: true } } } }),
    prisma.lead.findMany({ where: { createdAt: { gte: depuis } }, orderBy: { createdAt: "desc" }, take: 15, select: { id: true, prenom: true, nom: true, ville: true, source: true, typeProjet: true, createdAt: true } }),
  ]);
  const { texte: texteTaches, aujourdhui } = await texteListe(liste, maintenant, { plusTard: 3, fait: 3 });
  const enAttente = propositions.filter((p) => p.statut === "EN_ATTENTE");
  const enEchec = propositions.filter((p) => p.statut === "ECHEC");
  const montantCarnet = Math.round(carnet.reduce((t, c) => t + c.montant, 0) * 100) / 100;
  const alertes = [
    ...sante.taches.enEchec.map((t) => `tâche de fond en échec : ${t.libelle}${t.erreur ? ` (${court(t.erreur, 80)})` : ""}`),
    ...sante.taches.travauxEnEchec.map((t) => `travail périodique en échec : ${t.nom}`),
    ...(sante.google?.coupee ? ["Google COUPÉ : reconnecter dans Paramètres"] : []),
    ...(sante.agendaApi.activee ? [] : ["API Google Calendar non activée : les rappels attendent"]),
    ...(sante.meta && sante.meta.etat !== "COMPLETE" ? [`Meta : ${sante.meta.message}`] : []),
    ...(sante.disque && sante.disque.niveau !== "OK" ? [`disque ${sante.disque.pourcentUtilise} % utilisé`] : []),
    ...(sante.coherence?.incoherences.length ? [`${pluriel(sante.coherence.incoherences.length, "incohérence")} (etat_crm COHERENCE)`] : []),
    ...sante.alertesAnalytique.map((a) => `Analytique : ${a.texte}`),
    ...sante.alertes.map((a) => `[${a.gravite}] ${a.titre} — ${a.detail}`),
    ...enEchec.map((p) => `proposition en échec : ${p.titre} [proposition:${p.id}]`),
  ];
  const sources = sante.analytique?.sources ?? [];
  const texte = [
    `État du CRM au ${format.jour(maintenant)} :`,
    `TÂCHES DU JOUR\n${texteTaches}`,
    `Aussi : ${pluriel(mails, "mail")} à traiter, ${pluriel(enAttente.length, "proposition")} à valider, ${pluriel(messagesEspace, "message d'espace non lu", "messages d'espace non lus")}.`,
    `ALERTES (${alertes.length})\n${alertes.length ? alertes.map((a) => `- ${a}`).join("\n") : "Aucune alerte."}`,
    `ARGENT EN ATTENTE\n${finances ? `- Reste à encaisser : ${format.euros(finances.encours.total)} sur ${pluriel(finances.encours.lignes.length, "facture")}${finances.encours.lignes.length ? ` (${finances.encours.lignes.slice(0, 5).map((l) => `${l.numero} ${l.client} ${format.euros(l.reste)}${l.joursRetard ? `, ${l.joursRetard} j de retard` : ""}`).join(" · ")})` : ""}.\n- Chèques à créditer : ${finances.cheques.length ? finances.cheques.map((c) => `${c.payeur} ${format.euros(c.montant)} [encaissement:${c.id}]`).join(" · ") : "aucun"}.` : "- Tableau des finances illisible (paramètres manquants ?)."}\n- Devis en attente de réponse (carnet) : ${format.euros(montantCarnet)} sur ${pluriel(carnet.length, "devis", "devis")}${carnet.length ? ` (${carnet.slice(0, 6).map((c) => `${c.client} ${format.euros(c.montant)}${c.relances ? `, ${pluriel(c.relances, "relance")}` : ""} [dossier:${c.dossierId}]`).join(" · ")})` : ""}.`,
    `DERNIERS ÉVÉNEMENTS (48 h)\n${leads.length ? `- ${pluriel(leads.length, "lead arrivé", "leads arrivés")} : ${leads.map((l) => `${`${l.prenom} ${l.nom}`.trim()}${l.ville ? ` (${l.ville})` : ""}, ${l.source}, ${format.jourCourt(l.createdAt)} [lead:${l.id}]`).join(" · ")}` : "- Aucun lead arrivé."}\n${evenements.length ? evenements.map((ev) => `- ${format.jourCourt(ev.createdAt)} ${ev.dossier.clientNom} : ${court(ev.contenu.replace(/\s+/g, " "), 140)} [dossier:${ev.dossierId}]`).join("\n") : "- Aucun événement de dossier."}`,
    `SOURCES\n- Google : ${sante.google ? (sante.google.coupee ? "COUPÉ" : `jeton ${sante.google.niveau.toLowerCase()}`) : "non connecté"} · Meta : ${sante.meta?.message ?? "inconnu"} · IA : ${sante.ia ? (sante.ia.active ? "active" : `inactive (${sante.ia.raison ?? "réglages"})`) : "inconnue"}${sources.length ? ` · Analytique : ${sources.map((s) => `${s.source} ${s.etat.toLowerCase()}`).join(", ")}` : ""}.`,
    "Pour le détail : etat_crm avec une partie (SANTE, TACHES_DE_FOND, COHERENCE…), « lister » pour une liste, « taches » pour répondre à une tâche.",
  ].join("\n\n");
  return {
    texte,
    donnees: {
      taches: { compteurs: liste.compteurs, demain: liste.demain, aujourdhui, lots: liste.lots },
      alertes,
      sante,
      argent: { resteAEncaisser: finances?.encours.total ?? null, factures: finances?.encours.lignes ?? [], cheques: finances?.cheques ?? [], carnet: { montant: montantCarnet, devis: carnet } },
      propositions: { enAttente: enAttente.length, enEchec },
      mailsATraiter: mails,
      messagesEspaceNonLus: messagesEspace,
      evenements: evenements.map((e) => ({ dossierId: e.dossierId, client: e.dossier.clientNom, type: e.type, contenu: e.contenu, le: e.createdAt.toISOString() })),
      leads: leads.map((l) => ({ id: l.id, nom: `${l.prenom} ${l.nom}`.trim(), ville: l.ville, source: l.source, projet: l.typeProjet, le: l.createdAt.toISOString() })),
      sources,
    },
    liens: [lien("Tâches", "/taches"), lien("Tâches de fond", "/taches-de-fond"), lien("Finances", "/finances")],
  };
}

/* ── Les parties ────────────────────────────────────────────────────── */

async function partie(e: EntreeEtat, contexte: ContexteOutil): Promise<ResultatOutil> {
  const limite = e.limite;
  switch (e.partie!) {
    case "SANTE":
      return outilSanteSysteme.executer({}, contexte);
    case "META":
    case "PUBLICITE":
      return outilVoirPublicite.executer({ interroger_meta: e.interroger_meta, jours: e.jours }, contexte);
    case "PARAMETRES": {
      const r = await outilVoirParametres.executer({ groupe: e.groupe, automatismes: e.automatismes }, contexte);
      if (e.automatismes || e.groupe === "SMS") return r;
      // L'historique complet (PA3) : toutes les valeurs, pas seulement les cinq dernières.
      const { parametresPourEcran } = await import("@/lib/parametres/service");
      const tous = (await parametresPourEcran(contexte.maintenant)).filter((p) => !e.groupe || p.groupe === e.groupe);
      const historiques = tous.filter((p) => p.historique.length > 1).map((p) => `${p.cle} : ${p.historique.map((h) => `${JSON.stringify(h.valeur)} du ${format.jourCourt(new Date(h.valableDu))}${h.source ? ` (${h.source})` : ""}`).join(" → ")}`);
      return { ...r, texte: `${r.texte}${historiques.length ? `\n\nHistorique complet :\n${historiques.join("\n")}` : ""}`, donnees: { ...(r.donnees as object), historiques: tous.map((p) => ({ cle: p.cle, historique: p.historique })) } };
    }
    case "NUMEROTATION": {
      const [compteurs, libres] = await Promise.all([lireCompteurs(contexte.maintenant), numerosLibres()]);
      return { texte: `Numérotation : ${compteurs.map((c) => `${c.libelle} ${c.annee} : prochain ${c.prochain}${c.valeur !== null ? ` (dernier attribué ${c.valeur})` : ""}, plus haut inscrit ${c.plusHautRegistre}`).join(" ; ")}.\nNuméros libres du registre (émis hors CRM, sans document) : ${libres.length ? libres.slice(0, limite ?? 30).map((n) => `${n.numero} (${n.type.toLowerCase()}${n.destinataire ? `, ${n.destinataire}` : ""}${n.montant !== null ? `, ${format.euros(n.montant)}` : ""}) [registre:${n.id}]`).join(" · ") : "aucun"}.`, donnees: { compteurs, libres }, liens: [lien("Paramètres → Facturation", "/parametres#facturation")] };
    }
    case "SMS": {
      const [modeles, fournisseur] = await Promise.all([listerCatalogue(), Promise.resolve(etatFournisseur())]);
      return {
        texte: `Fournisseur SMS : ${fournisseur.nom ?? "AUCUN (aucun SMS ne peut partir)"}${fournisseur.expediteur ? `, expéditeur « ${fournisseur.expediteur} »` : ""}${fournisseur.bidirectionnel ? ", reçoit les réponses" : ""}${fournisseur.aPoser.length ? ` ; variables à poser : ${fournisseur.aPoser.join(", ")}` : ""}${fournisseur.remarque ? ` (${fournisseur.remarque})` : ""}.\nCatalogue (${modeles.length}) :\n${modeles.map((m) => `- ${m.code} — ${m.libelle}${m.automatique ? (m.actif ? " (automatique, actif)" : " (automatique, COUPÉ)") : ""} : « ${m.texte} »${m.defaut !== m.texte ? ` — texte de départ : « ${m.defaut} »` : ""}`).join("\n")}`,
        donnees: { fournisseur, modeles },
        liens: [lien("Paramètres → SMS", "/parametres#sms")],
      };
    }
    case "MAIL": {
      const [reglages, bilan] = await Promise.all([reglagesMail(), bilanTri(contexte.maintenant)]);
      return {
        texte: [
          `Guide de style : ${court(JSON.stringify(reglages.guide), 1200)}`,
          `Modèles de notification (${reglages.modeles.length}) :\n${reglages.modeles.map((m) => `- ${m.evenement} — ${m.libelle} : ${m.actif ? "actif" : "COUPÉ"} ; objet « ${m.objet} » ; phrase « ${court(m.phrase, 200)} » ; bouton « ${m.bouton} »`).join("\n")}`,
          `Règles d'expéditeur posées (${reglages.regles.length}) : ${reglages.regles.map((r) => `${r.cible} → ${r.action}${r.motif ? ` (${r.motif})` : ""} [regle:${r.id}]`).join(" · ") || "aucune"}.`,
          `Règles proposées : ${reglages.proposees.map((p) => `${p.titre} [proposition:${p.id}]`).join(" · ") || "aucune"}.`,
          `Bilan du tri : ${court(JSON.stringify(bilan), 1500)}`,
        ].join("\n"),
        donnees: { reglages, bilan },
        liens: [lien("Paramètres → Mail", "/parametres#mail")],
      };
    }
    case "CONSIGNES": {
      const { vueConsignes } = await import("../vues-parametres");
      const v = await vueConsignes();
      const cle = e.texte ?? "consignes";
      const courant = v[cle];
      const sections = (courant.texte.match(/^## .+$/gm) ?? []).map((s) => s.slice(3));
      return { texte: `${cle === "consignes" ? "Consignes" : "Positionnement"} : ${courant.source === "LUCAS" ? `texte de Lucas${courant.majLe ? `, modifié le ${format.jourCourt(courant.majLe)}` : ""}` : "texte par défaut"} ; ${pluriel(v.versions[cle].length, "version")}. Sections : ${sections.join(" · ") || "aucune"}.\nTexte en service :\n${courant.texte}\n\nTexte par défaut (« Revenir au défaut ») :\n${v.defauts[cle]}`, donnees: { texte: courant, defaut: v.defauts[cle], sections, versions: v.versions[cle] }, liens: [lien("Paramètres → Assistant", "/parametres#assistant")] };
    }
    case "CONSIGNES_VERSIONS":
      return outilVersionsConsignes.executer({ texte: e.texte ?? "consignes", limite }, contexte);
    case "OUTILS":
      return outilListerOutils.executer({ famille: e.famille }, contexte);
    case "TACHES_DE_FOND": {
      const t = await etatDesTaches();
      const lignes = t.taches.slice(0, limite ?? 40).map((x) => `- ${x.libelle} (${x.type}) : ${x.statut.toLowerCase()}${x.tentatives ? `, ${pluriel(x.tentatives, "tentative")}` : ""}${x.derniereErreur ? ` — ${court(x.derniereErreur, 120)}` : ""}${x.resume ? ` — ${court(x.resume, 120)}` : ""} [tache-de-fond:${x.id}]`);
      return { texte: `Tâches de fond : ${Object.entries(t.compteurs).map(([s, n]) => `${s.toLowerCase()} ${n}`).join(", ")}.\n${lignes.join("\n") || "File vide."}\nPlanifications : ${t.planifications.map((p) => `${p.nom}${p.dernierStatut ? ` (${p.dernierStatut.toLowerCase()})` : ""}`).join(" · ") || "aucune"}.\nRelancer ou annuler : « agir_systeme » RELANCER_TACHE / ANNULER_TACHE avec l'identifiant.`, donnees: t, liens: [lien("Tâches de fond", "/taches-de-fond")] };
    }
    case "COHERENCE": {
      const r = await controlerCoherence();
      return { texte: r.incoherences.length ? `${pluriel(r.incoherences.length, "incohérence")} sur ${r.dossiersControles} dossiers :\n${r.incoherences.map((i) => `- [${i.gravite}] ${i.client} : ${i.constat}${i.correction ? ` — « Corriger » : ${i.correction}` : " — à régler à la main"} [cle:${i.cle}]${i.dossierId ? ` [dossier:${i.dossierId}]` : ""}`).join("\n")}\nCorriger : « agir_systeme » CORRIGER_INCOHERENCE avec la clé.` : `Cohérence : rien à signaler (${r.dossiersControles} dossiers contrôlés).`, donnees: r, liens: [lien("Tâches de fond", "/taches-de-fond")] };
    }
    case "AUDIT": {
      const a = await auditerConnexions();
      return { texte: `Audit des connexions (${a.alertes} alerte${a.alertes > 1 ? "s" : ""}) :\n${a.maillons.map((m) => `- ${m.libelle} : ${m.etat} — ${m.constat}${m.aFaire ? ` (à faire : ${m.aFaire})` : ""}`).join("\n")}`, donnees: a, liens: [lien("Tâches de fond", "/taches-de-fond")] };
    }
    case "SESSIONS": {
      const s = await sessionsRecentes(limite ?? 10);
      return { texte: s.length ? s.map((x) => `- ${x.jour} ${x.clientNom ?? "?"} : ${pluriel(x.appels, "appel")}, ${pluriel(x.ecritures, "écriture")}${x.derniers.length ? ` ; derniers : ${x.derniers.slice(0, 6).map((a) => `${a.outil} ${a.statut.toLowerCase()}`).join(", ")}` : ""}`).join("\n") : "Aucune session de l'assistant.", donnees: s, liens: [lien("Tâches de fond", "/taches-de-fond")] };
    }
    case "CONNEXIONS": {
      const [google, drive, agent] = await Promise.all([etatConnexionGoogle(), etatMiroir(), etatAgentMail(contexte.maintenant)]);
      return { texte: `Google : ${google.connexion ? `connecté (${google.connexion.compte}, depuis le ${format.jourCourt(google.connexion.depuis)})${google.connexion.derniereErreur ? `, dernière erreur : ${court(google.connexion.derniereErreur, 120)}` : ""}` : google.configuree ? "non connecté" : `non configuré (${google.manquantes.join(", ")})`}${google.agenda ? ", agenda accordé" : ""}.\nMiroir Drive : ${drive.actif ? `actif (${drive.compte ?? "?"}), ${drive.aJour}/${drive.elements} à jour${drive.enErreur.length ? `, ${drive.enErreur.length} en erreur` : ""}${drive.dernierPassage ? `, dernier passage ${format.jourCourt(drive.dernierPassage)}` : ""}` : "inactif"}.\nAgent mail : ${court(JSON.stringify(agent), 600)}`, donnees: { google, drive, agent }, liens: [lien("Paramètres", "/parametres")] };
    }
    case "ACCES": {
      const { vueAcces } = await import("../vues-parametres");
      const v = await vueAcces();
      return { texte: `Adresse MCP : ${v.adresseMcp}. ${pluriel(v.acces.connexionsActives, "connexion active", "connexions actives")}.\n${v.acces.clients.map((c) => `- ${c.nom} (${c.origine})${c.revoqueLe ? " RÉVOQUÉE" : ""} [application:${c.id}] : ${c.connexions.map((j) => `${j.utilisateur} ${j.active ? "active" : "inactive"}, dernier usage ${j.dernierUsageLe ? format.jourCourt(j.dernierUsageLe) : "jamais"} [jeton:${j.id}]`).join(" · ") || "aucun jeton"}`).join("\n")}\nRévoquer : « agir_systeme » REVOQUER_ACCES.`, donnees: { adresseMcp: v.adresseMcp, acces: v.acces }, liens: [lien("Paramètres → Assistant", "/parametres#assistant")] };
    }
    case "PROMPTS": {
      if (e.type) {
        if (e.version) {
          const texte = await texteDeVersion(e.type, e.version);
          return { texte: `Prompt ${e.type}, version ${e.version} :\n${texte}`, donnees: { type: e.type, version: e.version, texte } };
        }
        const p = await lirePrompt(e.type);
        return { texte: `Prompt ${p.libelle} (${p.typeSurface}) : version ${p.versionCourante} en service, mise à jour le ${format.jourCourt(p.misAJourLe)} ; zones ${p.zones.join(", ")}.\nVersions : ${p.versions.map((v) => `v${v.numero}${v.courante ? " (en service)" : ""} ${format.jourCourt(v.le)}${v.note ? ` « ${v.note} »` : ""}`).join(" · ")}\nTexte en service :\n${p.texte}`, donnees: p, liens: [lien("Prompts", `/simulateur/prompts`)] };
      }
      const prompts = await listerPrompts();
      return { texte: `${pluriel(prompts.length, "prompt")} du simulateur :\n${prompts.map((p) => `- ${p.libelle} (${p.typeSurface}) : v${p.versionCourante}, ${pluriel(p.versions.length, "version")}`).join("\n")}`, donnees: prompts.map((p) => ({ typeSurface: p.typeSurface, libelle: p.libelle, versionCourante: p.versionCourante, versions: p.versions.length, misAJourLe: p.misAJourLe })), liens: [lien("Prompts", "/simulateur/prompts")] };
    }
    case "BANC": {
      const b = await etatBanc();
      return { texte: `Banc : ${pluriel(b.cas.length, "cas")}, ${b.total.rendus} rendus (${b.total.prets} prêts, ${b.total.enCours} en cours, ${b.total.echecs} en échec), ${b.total.coutDollars.toFixed(2)} $ dépensés. Une campagne complète : ${b.estimation.rendus} rendus, ${b.estimation.totalMin.toFixed(2)} à ${b.estimation.totalMax.toFixed(2)} $. Cas : ${b.cas.map((c) => `${c.id}${c.photo ? "" : " (photo introuvable)"}`).join(", ")}. Lancer : « agir_systeme » LANCER_BANC (aperçu du coût, puis confirmation).`, donnees: { cas: b.cas.map((c) => ({ id: c.id, photo: Boolean(c.photo), zones: c.zonesLibelles })), estimation: b.estimation, total: b.total, rendus: b.rendus.slice(0, 40) }, liens: [lien("Banc", "/simulateur/banc")] };
    }
    case "CONSOMMATION": {
      const c = await consommation(contexte.maintenant);
      return { texte: `Consommation OpenAI du mois : ${c.mois.total.toFixed(2)} $ (site ${c.mois.site.toFixed(2)}, CRM ${c.mois.crm.toFixed(2)}, espace ${c.mois.espace.toFixed(2)}), ${pluriel(c.mois.generations, "génération")}, ${pluriel(c.mois.echecs, "échec")}. ${c.solde ? `Solde estimé ${c.solde.estime.toFixed(2)} $ (≈ ${c.solde.simulationsRestantes} simulations), relevé ${c.solde.releve.toFixed(2)} $ le ${format.jourCourt(c.solde.releveLe)}.` : "Aucun relevé de solde."}${c.creditEpuise ? ` CRÉDIT ÉPUISÉ depuis le ${format.jourCourt(c.creditEpuise.le)}.` : ""}${c.reelOpenAI ? ` Réel OpenAI : ${c.reelOpenAI.mois.toFixed(2)} $ (lu le ${format.jourCourt(c.reelOpenAI.lu)}).` : ""}`, donnees: c, liens: [lien("Simulateur", "/simulateur")] };
    }
  }
}

export const outilEtatCrm = definirOutil({
  nom: "etat_crm",
  titre: "L'état du CRM (en une fois, ou par partie)",
  description:
    "Sans partie : EN UNE FOIS tout ce qui est ouvert — les tâches du jour (avec le geste et le texte prêt), les alertes (tâches de fond, Google, Meta, disque, cohérence, Analytique, alertes du CRM, propositions en échec), l'argent en attente (reste à encaisser par facture, chèques à créditer, devis en attente de réponse), les derniers événements (48 h : leads arrivés, événements des dossiers) et l'état des sources. L'état du CRM en un appel ; pour le point du matin : « point_du_jour » ; pour la liste de ce que Lucas a à faire : « taches ». Avec « partie » : SANTE (tout va bien ?), META (chaîne des leads Meta et campagne ; « interroger_meta »), PARAMETRES (paramètres par groupe avec l'historique complet, automatismes, catalogue SMS), NUMEROTATION (compteurs, numéros libres), SMS (catalogue, texte de départ, fournisseur), MAIL (guide, modèles, règles, bilan du tri), CONSIGNES (texte, sections, défaut), CONSIGNES_VERSIONS (historique), OUTILS (registre et empreinte : si l'application dit « not registered », reconnecter le connecteur), TACHES_DE_FOND (file avec identifiants), COHERENCE (clé et correction), AUDIT, SESSIONS, CONNEXIONS, ACCES, PROMPTS (« type », « version »), BANC, CONSOMMATION. Jamais de secret.",
  niveau: "LECTURE",
  schema: schemaEtat,
  executer: async (e, contexte) => (e.partie ? partie(e, contexte) : etatGlobal(contexte)),
});

/** Anciens outils de lecture que « etat_crm » remplace (docs/MCP-COUVERTURE.md § 4.14). */
export const REMPLACES_PAR_ETAT = ["sante_systeme", "voir_parametres", "versions_consignes", "lister_outils", "voir_publicite"] as const;

export const OUTILS_ETAT = [outilEtatCrm];
