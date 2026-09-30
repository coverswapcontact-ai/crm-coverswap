import { z } from "zod/v4";
import prisma from "@/lib/prisma";
import { passeComplete } from "@/lib/a-faire/detection";
import { alerter } from "@/lib/alertes/canaux";
import { CANAUX_PUSH } from "@/lib/alertes/configuration";
import { envoyerPushWeb } from "@/lib/alertes/pushweb";
import { relancerSynchro } from "@/lib/analytique/synchro";
import { LIBELLES_SOURCE_SYNCHRONISEE, SOURCES_SYNCHRONISEES } from "@/lib/analytique/suivi";
import { proposerFusions } from "@/lib/clients/doublons";
import { controlerCoherence, corrigerIncoherence } from "@/lib/coherence/controle";
import { ErreurMetier } from "@/lib/commun/erreurs";
import { accord, pluriel } from "@/lib/commun/format";
import { demanderSynchronisation } from "@/lib/drive/synchronisation";
import { accorderProjets, desactiverLien, regenererLien } from "@/lib/espace/gestion";
import { ouvrirEspace, ouvrirEspaceDuContact } from "@/lib/espace/liens";
import { marquerMessagesLus } from "@/lib/espace/messages";
import { gesteDeLucas, type GesteEspace } from "@/lib/espace/vue-crm";
import { deconnecterGoogle } from "@/lib/google/connexion";
import { archiverFil, classerALaMain, marquerLu, nePlusMontrer, remonter, synchroniserBoite } from "@/lib/mail/boite";
import { annulerSnooze, derangerMail, rangerMail, snoozer } from "@/lib/mail/v2";
import { toutNettoyer } from "@/lib/mail/vues";
import { demanderReleve } from "@/lib/messages/taches";
import { lancerEssaiMeta } from "@/lib/meta/essai";
import { rejouerLeadMeta } from "@/lib/meta/leads";
import { santeMeta } from "@/lib/meta/sante";
import { revoquerClient, revoquerJeton, revoquerTout } from "@/lib/oauth/serveur";
import { ecarterDoublon, fusionnerDoublon } from "@/lib/prospects/doublons";
import { MOTIFS_ANONYMISATION } from "@/lib/rgpd/propositions";
import { apercuAnonymisation } from "@/lib/rgpd/anonymisation";
import { anonymiserClient } from "@/lib/rgpd/conservation";
import { etatBanc, lancerBanc } from "@/lib/simulateur/banc/banc";
import { changerStatutSimulation, publierSimulations } from "@/lib/simulations/dossier";
import { publierPublication, retirerPublication } from "@/lib/site/publications";
import { annulerTache, relancerTache } from "@/lib/taches/file";
import { listerPropositions, rejeterProposition, validerProposition, vueProposition } from "@/lib/validation/service";
import { lireDateDictee } from "../agenda";
import { definirOutil, format, lien, type ResultatOutil } from "../definition";
import { cibler } from "./cible";
import { schemaCible } from "./lecture";
import { outilRattacherMail, outilRangerMail } from "./mail";

/**
 * Mission 17 (partie C) — les gestes de l'interface qui n'avaient pas d'outil (docs/MCP-COUVERTURE.md § 4.10 à 4.13) :
 * « publier » (simulations dans l'espace, publications du site), « traiter_mail » (la boîte), « geste_espace »
 * (l'espace client), « doublon » (leads et clients), « anonymiser_client » (RGPD) et « agir_systeme » (tâches de fond,
 * cohérence, synchronisations, Meta, banc, accès). Chaque geste appelle LA fonction de service de la route de l'écran,
 * avec les mêmes paramètres. Sensibilité par geste : ce qui part chez le client (mail, site public), touche l'argent,
 * est irréversible ou coupe un accès rend d'abord un aperçu, puis attend le jeton de confirmation.
 */

/* ── publier ────────────────────────────────────────────────────────── */

const schemaPublier = z.object({
  quoi: z.enum(["SIMULATION", "PUBLICATION"]).describe("SIMULATION : dans l'espace du client. PUBLICATION : une réalisation ou un avis sur coverswap.fr."),
  ids: z.array(z.string().min(1).max(40)).min(1).max(20).describe("Identifiants des simulations (lire_fiche, voir_simulations) ou des publications (lister PUBLICATIONS)."),
  retirer: z.boolean().optional().describe("Vrai : retirer (simulation masquée au client ; publication retirée du site). Réversible."),
  reafficher: z.boolean().optional().describe("SIMULATION : vrai pour réafficher aussi les simulations MASQUÉES demandées (le mail automatique part). Sans lui, seules les simulations en brouillon sont publiées."),
  sms: z.boolean().optional().describe("SIMULATION : prévenir aussi par SMS « vos simulations sont prêtes » (le SMS part)."),
  texte_sms: z.string().max(918).optional().describe("SIMULATION, avec sms : le texte relu par Lucas (à défaut, celui du catalogue)."),
});
type EntreePublier = z.output<typeof schemaPublier>;

async function simulationsDemandees(ids: string[]) {
  const brutes = await prisma.simulationEspace.findMany({ where: { id: { in: [...new Set(ids)] } }, select: { id: true, dossierId: true, statut: true, titre: true } });
  const noms = new Map((await prisma.dossier.findMany({ where: { id: { in: [...new Set(brutes.map((l) => l.dossierId))] } }, select: { id: true, clientNom: true } })).map((d) => [d.id, d.clientNom]));
  const lignes = brutes.map((l) => ({ ...l, dossier: { clientNom: noms.get(l.dossierId) ?? "?" } }));
  const inconnues = ids.filter((id) => !lignes.some((l) => l.id === id));
  return { lignes, inconnues };
}

async function planPublication(e: EntreePublier) {
  const { lignes, inconnues } = await simulationsDemandees(e.ids);
  const brouillons = lignes.filter((l) => l.statut === "BROUILLON");
  const masquees = lignes.filter((l) => l.statut === "MASQUEE");
  const publiees = lignes.filter((l) => l.statut === "PUBLIEE");
  return { lignes, inconnues, brouillons, masquees, reafficher: e.reafficher ? masquees : [], ignorees: e.reafficher ? [] : masquees, publiees };
}

const nomSimulation = (s: { id: string; titre: string | null; dossier: { clientNom: string } }) => `${s.titre ?? s.id} (${s.dossier.clientNom})`;

export const outilPublier = definirOutil({
  nom: "publier",
  titre: "Publier ou retirer (simulations, site)",
  description:
    "SIMULATION : publie dans l'espace du client les simulations EN BROUILLON demandées (le client reçoit le mail « votre simulation est prête » ; « sms » : le SMS aussi) — une simulation masquée n'est jamais republiée sans « reafficher: true », une déjà publiée est ignorée ; « retirer » la masque au client (elle reste dans le dossier). PUBLICATION : publie sur coverswap.fr une réalisation ou un avis (refusé sans l'accord écrit du client, sans photo après pour une réalisation, sans texte pour un avis) ; « retirer » l'enlève du site. Publier est sensible (part chez le client ou sur le site public) : aperçu, puis confirmation. Retirer est réversible.",
  niveau: "REVERSIBLE",
  schema: schemaPublier,
  masse: (e) => e.ids.length,
  sensible: (e) => !e.retirer,
  apercu: async (e) => {
    if (e.quoi === "PUBLICATION") {
      const lignes = await prisma.publicationSite.findMany({ where: { id: { in: e.ids } }, select: { id: true, titre: true, type: true, accordClientLe: true, photoApres: true, texte: true } });
      return `Je vais ${e.retirer ? "retirer du site" : "publier sur coverswap.fr"} : ${lignes.map((p) => `${p.type === "AVIS" ? "l'avis" : "la réalisation"} « ${p.titre} »${!e.retirer && !p.accordClientLe ? " (REFUSÉE : pas d'accord écrit du client)" : ""}`).join(", ") || "aucune publication connue"}.`;
    }
    const p = await planPublication(e);
    if (e.retirer) return `Je vais masquer au client ${pluriel(p.lignes.length, "simulation")} : ${p.lignes.map(nomSimulation).join(", ")}.`;
    const aPublier = [...p.brouillons, ...p.reafficher];
    return [
      aPublier.length ? `Je vais publier ${pluriel(aPublier.length, "simulation")} dans l'espace du client : ${aPublier.map(nomSimulation).join(", ")}. Le client recevra le mail automatique « votre simulation est prête »${e.sms ? ", et le SMS « vos simulations sont prêtes »" : ""}.` : "Aucune simulation à publier : rien ne partira.",
      p.ignorees.length ? `Ignorées car MASQUÉES (Lucas les avait retirées ; « reafficher: true » pour les remettre) : ${p.ignorees.map(nomSimulation).join(", ")}.` : "",
      p.publiees.length ? `Déjà publiées : ${p.publiees.map(nomSimulation).join(", ")}.` : "",
      p.inconnues.length ? `Inconnues : ${p.inconnues.join(", ")}.` : "",
    ].filter(Boolean).join("\n");
  },
  executer: async (e) => {
    if (e.quoi === "PUBLICATION") {
      const faites: string[] = [];
      for (const id of e.ids) {
        const p = e.retirer ? await retirerPublication(id) : await publierPublication(id);
        faites.push(`« ${p.titre} »`);
      }
      return { texte: `${pluriel(faites.length, "publication")} ${e.retirer ? accord(faites.length, "retirée") + " du site" : accord(faites.length, "publiée") + " sur coverswap.fr"} : ${faites.join(", ")}.`, liens: [lien("Site", "/site")] };
    }
    const p = await planPublication(e);
    if (p.inconnues.length) throw new ErreurMetier(`Simulation inconnue : ${p.inconnues.join(", ")}.`, 404);
    if (e.retirer) {
      for (const s of p.lignes) await changerStatutSimulation(s.dossierId, s.id, "masquer");
      return { texte: `${pluriel(p.lignes.length, "simulation masquée", "simulations masquées")} au client (elles restent dans le dossier ; « publier » avec reafficher les remet).`, donnees: { masquees: p.lignes.map((s) => s.id) }, liens: [...new Set(p.lignes.map((s) => s.dossierId))].map((d) => lien("Dossier", `/dossiers?dossier=${d}`)) };
    }
    const parDossier = new Map<string, string[]>();
    for (const s of p.brouillons) parDossier.set(s.dossierId, [...(parDossier.get(s.dossierId) ?? []), s.id]);
    const bilans: string[] = [];
    for (const [dossierId, ids] of parDossier) {
      const r = await publierSimulations(dossierId, ids, { prevenir: Boolean(e.sms), texte: e.texte_sms ?? null });
      bilans.push(`${pluriel(r.publiees, "simulation publiée", "simulations publiées")}${r.mail ? (r.mail.programme ? ", mail « votre simulation est prête » programmé" : `, pas de mail (${r.mail.raison ?? "rien de nouveau"})`) : ""}${e.sms ? (r.sms.envoye ? ", SMS envoyé" : `, SMS non envoyé (${r.sms.raison ?? "?"})`) : ""}`);
    }
    for (const s of p.reafficher) {
      await changerStatutSimulation(s.dossierId, s.id, "afficher");
      bilans.push(`« ${s.titre ?? s.id} » réaffichée (mail automatique)`);
    }
    const texte = [bilans.length ? bilans.join(" ; ") + "." : "Aucune simulation à publier.", p.ignorees.length ? `Masquées laissées telles quelles : ${p.ignorees.map(nomSimulation).join(", ")}.` : "", p.publiees.length ? `Déjà publiées : ${p.publiees.map(nomSimulation).join(", ")}.` : ""].filter(Boolean).join("\n");
    return { texte, donnees: { publiees: p.brouillons.map((s) => s.id), reaffichees: p.reafficher.map((s) => s.id), ignorees: p.ignorees.map((s) => s.id) }, liens: [...new Set(p.lignes.map((s) => s.dossierId))].map((d) => lien("Dossier", `/dossiers?dossier=${d}`)) };
  },
});

/* ── traiter_mail ───────────────────────────────────────────────────── */

export const GESTES_MAIL = ["LU", "NON_LU", "ARCHIVER", "DESARCHIVER", "RANGER", "DERANGER", "REMONTER", "NE_PLUS_MONTRER", "CLASSER", "SNOOZER", "ANNULER_SNOOZE", "RATTACHER", "TOUT_NETTOYER", "RELIRE_BOITE"] as const;

const schemaTraiterMail = schemaCible.extend({
  geste: z.enum(GESTES_MAIL).describe("LU, NON_LU ; ARCHIVER, DESARCHIVER (sort d'« À traiter » sans apprendre de règle) ; RANGER, DERANGER (lu + libellé Rangé, nourrit les règles) ; REMONTER (un mail rangé : l'expéditeur ne sera plus rangé) ; NE_PLUS_MONTRER (cet expéditeur, pour toujours ; refusé pour un client) ; CLASSER (classe CLIENT, ADMINISTRATIF, HUMAIN) ; SNOOZER (quand), ANNULER_SNOOZE ; RATTACHER (à un client, lead ou dossier : nom ou identifiant) ; TOUT_NETTOYER (archive et marque lu ce qui ne demande rien) ; RELIRE_BOITE (relire Gmail maintenant)."),
  messageIds: z.array(z.string().min(1).max(40)).max(100).optional().describe("Les mails visés ([mail:…] rendu par « lister » MAILS)."),
  expediteur: z.string().max(160).optional().describe("RANGER / DERANGER : par expéditeur (adresse exacte ou « @domaine »)."),
  classe: z.enum(["CLIENT", "ADMINISTRATIF", "HUMAIN"]).optional().describe("CLASSER : la classe (HUMAIN, « à lire », par défaut)."),
  pour_l_expediteur: z.boolean().optional().describe("CLASSER : pour tous les mails de cet expéditeur (règle posée)."),
  quand: z.string().max(60).optional().describe("SNOOZER : « demain 9h », « lundi », « dans une semaine », « 2026-10-01 14:00 »."),
  motif: z.string().max(200).optional().describe("RANGER : le motif gardé avec le rangement."),
});

const SANS_IDENTIFIANTS: readonly string[] = ["TOUT_NETTOYER", "RELIRE_BOITE"];

async function objetsDesMails(ids: string[]) {
  const lignes = await prisma.message.findMany({ where: { id: { in: ids } }, select: { id: true, objet: true, de: true, deNom: true } });
  return ids.map((id) => lignes.find((l) => l.id === id)).map((m, i) => (m ? `${m.deNom ?? m.de} — « ${m.objet ?? "(sans objet)"} »` : ids[i]));
}

export const outilTraiterMail = definirOutil({
  nom: "traiter_mail",
  titre: "Les gestes de la boîte mail",
  description:
    "Tous les gestes de l'onglet Mail, par la même fonction que l'écran : LU / NON_LU, ARCHIVER / DESARCHIVER (sortir d'« À traiter » sans créer de règle), RANGER / DERANGER (par identifiants, ou par expéditeur), REMONTER un mail rangé, NE_PLUS_MONTRER un expéditeur (définitif ; refusé pour l'adresse d'un client), CLASSER à la main (CLIENT, ADMINISTRATIF, HUMAIN ; pour_l_expediteur), SNOOZER jusqu'à « quand » / ANNULER_SNOOZE, RATTACHER le fil à un client, un lead ou un dossier (nom ou identifiant ; candidats si doute), TOUT_NETTOYER, RELIRE_BOITE. Réversible ; sensible (aperçu puis confirmation) pour NE_PLUS_MONTRER, TOUT_NETTOYER, un rangement par expéditeur, un classement pour l'expéditeur, ou plus de trois mails.",
  niveau: "REVERSIBLE",
  schema: schemaTraiterMail,
  masse: (e) => e.messageIds?.length ?? 0,
  sensible: (e) => e.geste === "NE_PLUS_MONTRER" || e.geste === "TOUT_NETTOYER" || Boolean(e.expediteur) || Boolean(e.pour_l_expediteur),
  apercu: async (e) => {
    if (e.geste === "TOUT_NETTOYER") return "Je vais « Tout nettoyer » : tout ce qui ne demande rien et traîne dans la boîte de réception est archivé et marqué lu (dans Gmail aussi). Rien de ce qui est « À traiter » n'est touché ; rien n'est supprimé.";
    if (e.expediteur) return (await outilRangerMail.apercu!({ expediteur: e.expediteur, motif: e.motif, annuler: e.geste === "DERANGER" }, { sessionId: "", commande: null, utilisateur: "", maintenant: new Date() }));
    const objets = await objetsDesMails(e.messageIds ?? []);
    const quoi: Record<string, string> = { NE_PLUS_MONTRER: "ne plus jamais montrer l'expéditeur de", CLASSER: `classer en ${(e.classe ?? "HUMAIN").toLowerCase()}${e.pour_l_expediteur ? " (et tous les mails de cet expéditeur)" : ""}` };
    return `Je vais ${quoi[e.geste] ?? `faire « ${e.geste} » sur`} ${pluriel(objets.length, "mail")} : ${objets.join(" · ")}.`;
  },
  executer: async (e, contexte) => {
    if (e.geste === "TOUT_NETTOYER") {
      const r = await toutNettoyer(contexte.maintenant);
      return { texte: `Boîte nettoyée : ${pluriel(r.archives, "message archivé", "messages archivés")} et marqués lus (rien de supprimé ; « À traiter » intact).`, donnees: r, liens: [lien("Mail", "/mail")] };
    }
    if (e.geste === "RELIRE_BOITE") {
      const bilan = await synchroniserBoite();
      return { texte: bilan.mode === "INACTIF" ? "Boîte non relue : la connexion Gmail n'est pas active (Paramètres → Connexions)." : `Boîte relue (${bilan.mode.toLowerCase()}) : ${pluriel(bilan.nouveaux, "nouveau mail", "nouveaux mails")}, ${pluriel(bilan.majLibelles, "libellé")} mis à jour.`, donnees: bilan, liens: [lien("Mail", "/mail")] };
    }
    if ((e.geste === "RANGER" || e.geste === "DERANGER") && e.expediteur) return outilRangerMail.executer({ expediteur: e.expediteur, motif: e.motif, annuler: e.geste === "DERANGER", messageIds: e.messageIds }, contexte);
    const ids = e.messageIds ?? [];
    if (!ids.length && !SANS_IDENTIFIANTS.includes(e.geste)) throw new ErreurMetier("Donne les identifiants des mails (messageIds).", 400);
    if (e.geste === "RATTACHER") {
      const bilans: ResultatOutil[] = [];
      for (const messageId of ids) {
        const r = await outilRattacherMail.executer({ messageId, dossierId: e.dossierId, clientId: e.clientId, leadId: e.leadId, nom: e.nom }, contexte);
        if (r.donnees && Array.isArray(r.donnees)) return r; // candidats : Lucas choisit.
        bilans.push(r);
      }
      return { texte: bilans.map((b) => b.texte).join("\n"), donnees: bilans.map((b) => b.donnees), liens: bilans.flatMap((b) => b.liens ?? []).slice(0, 3) };
    }
    let jusqua: Date | null = null;
    if (e.geste === "SNOOZER") {
      jusqua = e.quand ? lireDateDictee(e.quand, contexte.maintenant, 9) : null;
      if (!jusqua) throw new ErreurMetier("Quand ? (« demain 9h », « lundi », « dans une semaine »).", 400);
      if (jusqua <= contexte.maintenant) throw new ErreurMetier("Ce moment est déjà passé.", 400);
    }
    let ranges = 0;
    for (const id of ids) {
      switch (e.geste) {
        case "LU":
        case "NON_LU":
          await marquerLu(id, e.geste === "LU");
          break;
        case "ARCHIVER":
        case "DESARCHIVER":
          await archiverFil(id, e.geste === "ARCHIVER");
          break;
        case "REMONTER":
          await remonter(id);
          break;
        case "NE_PLUS_MONTRER":
          ranges += (await nePlusMontrer(id)).ranges;
          break;
        case "CLASSER":
          await classerALaMain(id, e.classe ?? "HUMAIN", e.pour_l_expediteur === true);
          break;
        case "RANGER":
          ranges += (e.motif ? await rangerMail(id, e.motif) : await rangerMail(id)).ranges;
          break;
        case "DERANGER":
          ranges += (await derangerMail(id)).remis;
          break;
        case "SNOOZER":
          await snoozer(id, jusqua!);
          break;
        case "ANNULER_SNOOZE":
          await annulerSnooze(id);
          break;
      }
    }
    const faits: Record<string, string> = {
      LU: "marqué lu",
      NON_LU: "marqué non lu",
      ARCHIVER: "archivé (sorti d'« À traiter »)",
      DESARCHIVER: "désarchivé",
      REMONTER: "remonté (son expéditeur ne sera plus rangé)",
      NE_PLUS_MONTRER: `rangé pour toujours avec son expéditeur (${pluriel(ranges, "message")} rangés)`,
      CLASSER: `classé ${(e.classe ?? "HUMAIN").toLowerCase()}${e.pour_l_expediteur ? ", pour tout l'expéditeur" : ""}`,
      RANGER: `rangé (${pluriel(ranges, "message")})`,
      DERANGER: `remis dans la boîte (${pluriel(ranges, "message")})`,
      SNOOZER: jusqua ? `remis au ${format.jour(jusqua)} à ${jusqua.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" })}` : "",
      ANNULER_SNOOZE: "sorti de « plus tard »",
    };
    return { texte: `${pluriel(ids.length, "mail")} : ${faits[e.geste]}.`, donnees: { geste: e.geste, messageIds: ids, jusqua: jusqua?.toISOString() ?? null }, liens: ids.length === 1 ? [lien("Ouvrir le mail", `/mail?mail=${ids[0]}`)] : [lien("Mail", "/mail")] };
  },
});

/* ── geste_espace ───────────────────────────────────────────────────── */

export const GESTES_ESPACE = ["OUVRIR", "DESACTIVER", "REACTIVER", "NOUVEAU_LIEN", "ACCORDER_SIMULATIONS", "ACCORDER_PROJET", "VALIDER_PROJET", "DEVALIDER_PROJET", "VALIDER_SIMULATION", "DEVALIDER_SIMULATION", "RETIRER_DEMANDE", "REINITIALISER", "RETIRER_ACCORD", "MARQUER_LUS", "RETIRER_PHOTO", "REMETTRE_PHOTO"] as const;

const schemaGesteEspace = schemaCible.extend({
  geste: z.enum(GESTES_ESPACE),
  nombre: z.number().int().min(1).max(20).optional().describe("ACCORDER_SIMULATIONS (3 par défaut) ; ACCORDER_PROJET (1 à 5, 1 par défaut)."),
  mail: z.boolean().optional().describe("NOUVEAU_LIEN : envoyer le nouveau lien par mail (vrai par défaut)."),
  texte: z.string().max(600).optional().describe("NOUVEAU_LIEN : la phrase du mail, relue par Lucas."),
  simulation_id: z.string().max(40).optional().describe("VALIDER_SIMULATION : la simulation retenue à la place du client."),
  etape: z.enum(["PROJET", "SIMULATIONS", "DEVIS"]).optional().describe("REINITIALISER : l'étape que le client refait."),
  motif: z.string().max(500).optional().describe("RETIRER_ACCORD, DESACTIVER : le motif."),
  photo_id: z.string().max(80).optional().describe("RETIRER_PHOTO / REMETTRE_PHOTO."),
});
type EntreeGesteEspace = z.output<typeof schemaGesteEspace>;

const GESTES_SENSIBLES_ESPACE: readonly string[] = ["DESACTIVER", "REINITIALISER", "RETIRER_ACCORD"];

async function espaceCible(e: EntreeGesteEspace) {
  const r = await cibler(e);
  if (r.ambigu) return { ambigu: r.ambigu } as const;
  const ids = r.ids!;
  const espace = ids.dossierId ? await prisma.espaceClient.findFirst({ where: { dossierId: ids.dossierId }, select: { id: true, permanentId: true } }) : null;
  const permanentId = espace?.permanentId ?? (ids.clientId ? (await prisma.espacePermanent.findUnique({ where: { clientId: ids.clientId }, select: { id: true } }))?.id ?? null : null);
  return { ids, permanentId } as const;
}

const exigerDossier = (ids: { dossierId: string | null; nom: string }) => {
  if (!ids.dossierId) throw new ErreurMetier(`${ids.nom} n'a pas de dossier, donc pas d'espace de projet.`, 409);
  return ids.dossierId;
};
const exigerPermanent = (permanentId: string | null, nom: string) => {
  if (!permanentId) throw new ErreurMetier(`${nom} n'a pas encore d'espace client : « geste_espace » OUVRIR l'ouvre.`, 409);
  return permanentId;
};

export const outilGesteEspace = definirOutil({
  nom: "geste_espace",
  titre: "Les gestes de Lucas sur l'espace client",
  description:
    "Tous les gestes du panneau Espace (dossier) et de l'écran Espaces, par la même fonction : OUVRIR l'espace sans rien noter ni envoyer (rend le lien) ; DESACTIVER le lien (le client lit « lien désactivé », rien n'est effacé ; sensible) ; REACTIVER (nouveau lien sans mail) ; NOUVEAU_LIEN (l'ancien meurt ; mail vrai par défaut, avec la phrase « texte » : sensible) ; ACCORDER_SIMULATIONS (nombre, ≈ 0,20 $ l'image : au-delà de 3, sensible) ; ACCORDER_PROJET (un projet en cours de plus, 1 à 5) ; VALIDER_PROJET / DEVALIDER_PROJET à sa place ; VALIDER_SIMULATION (simulation_id) / DEVALIDER_SIMULATION ; RETIRER_DEMANDE (d'autre proposition) ; REINITIALISER une étape (PROJET, SIMULATIONS, DEVIS : sensible, le client la refait) ; RETIRER_ACCORD (bon pour accord ; sensible) ; MARQUER_LUS ses messages sans répondre ; RETIRER_PHOTO / REMETTRE_PHOTO (photo_id). Chaque geste est écrit dans l'historique du dossier « par Lucas ».",
  niveau: "REVERSIBLE",
  schema: schemaGesteEspace,
  sensible: (e) => GESTES_SENSIBLES_ESPACE.includes(e.geste) || (e.geste === "NOUVEAU_LIEN" && e.mail !== false) || (e.geste === "ACCORDER_SIMULATIONS" && (e.nombre ?? 3) > 3),
  apercu: async (e) => {
    const c = await espaceCible(e);
    if ("ambigu" in c) return c.ambigu!.texte;
    const nom = c.ids.nom;
    switch (e.geste) {
      case "DESACTIVER":
        return `Je vais désactiver le lien de l'espace de ${nom} (tous ses projets) : il lira « lien désactivé ». Rien n'est effacé ; un nouveau lien le rouvre.${e.motif ? ` Motif : ${e.motif}.` : ""}`;
      case "NOUVEAU_LIEN":
        return `Je vais émettre un nouveau lien d'espace pour ${nom} (l'ancien ne fonctionnera plus)${e.mail !== false ? ` et le lui envoyer par mail${e.texte ? ` avec la phrase : « ${e.texte} »` : ""}` : ""}.`;
      case "ACCORDER_SIMULATIONS": {
        const nombre = e.nombre ?? 3;
        return `Je vais accorder ${nombre} simulations de plus à ${nom} (≈ ${(nombre * 0.2).toFixed(2).replace(".", ",")} $ d'images si elles sont toutes faites).`;
      }
      case "REINITIALISER":
        return `Je vais réinitialiser l'étape « ${e.etape ?? "?"} » de l'espace de ${nom} : le client la refera (ce qu'il avait saisi reste gardé dans l'historique).`;
      case "RETIRER_ACCORD": {
        const acc = c.ids.dossierId ? await prisma.accordDevis.findFirst({ where: { dossierId: c.ids.dossierId, retireLe: null }, orderBy: { createdAt: "desc" } }) : null;
        return acc ? `Je vais retirer le bon pour accord de ${nom} sur le devis ${acc.numeroDevis ?? ""} (donné le ${format.jourCourt(acc.createdAt)} par ${acc.nomSignataire})${e.motif ? ` — motif : ${e.motif}` : ""}. La preuve reste gardée ; le dossier revient à « Devis envoyé ».` : `Aucun bon pour accord en vigueur chez ${nom} : rien ne sera fait.`;
      }
      default:
        return `Je vais faire « ${e.geste} » sur l'espace de ${nom}.`;
    }
  },
  executer: async (e) => {
    const c = await espaceCible(e);
    if ("ambigu" in c) return c.ambigu!;
    const { ids } = c;
    const nom = ids.nom;
    const liensDossier = ids.dossierId ? [lien("Dossier", `/dossiers?dossier=${ids.dossierId}`)] : [lien("Espaces clients", "/espaces")];
    const geste = async (g: GesteEspace, texte: string): Promise<ResultatOutil> => {
      await gesteDeLucas(exigerDossier(ids), g);
      return { texte, liens: liensDossier };
    };
    switch (e.geste) {
      case "OUVRIR": {
        const ouvert = ids.dossierId ? await ouvrirEspace(ids.dossierId) : ids.leadId ? await ouvrirEspaceDuContact(ids.leadId) : null;
        if (!ouvert) throw new ErreurMetier(`${nom} n'a ni dossier ni lead : ouvre d'abord un dossier.`, 409);
        return { texte: `Espace ${ouvert.nouveau ? "ouvert" : "déjà ouvert"} pour ${nom}. Rien n'a été envoyé ni noté. Lien : ${ouvert.lien}`, donnees: { lien: ouvert.lien, nouveau: ouvert.nouveau, dossierId: ids.dossierId ?? ("dossierId" in ouvert ? ouvert.dossierId : null) }, liens: liensDossier };
      }
      case "DESACTIVER":
        await desactiverLien(exigerPermanent(c.permanentId, nom), e.motif);
        return { texte: `Lien de l'espace de ${nom} désactivé : il lit « lien désactivé ». Rien n'est effacé ; « REACTIVER » ou « NOUVEAU_LIEN » le rouvre.`, liens: liensDossier };
      case "REACTIVER":
      case "NOUVEAU_LIEN": {
        const mail = e.geste === "NOUVEAU_LIEN" && e.mail !== false;
        const r = await regenererLien(exigerPermanent(c.permanentId, nom), { mail, texte: e.texte ?? null });
        return { texte: `Nouveau lien émis pour ${nom}${r.mail ? ", mail envoyé" : " (rien d'envoyé)"}. L'ancien ne fonctionne plus. Lien : ${r.lien}`, donnees: { lien: r.lien, mail: r.mail }, liens: liensDossier };
      }
      case "ACCORDER_SIMULATIONS":
        return geste({ geste: "accorder", nombre: e.nombre ?? 3 }, `${pluriel(e.nombre ?? 3, "simulation accordée", "simulations accordées")} à ${nom}.`);
      case "ACCORDER_PROJET": {
        const r = await accorderProjets(exigerPermanent(c.permanentId, nom), Math.min(e.nombre ?? 1, 5));
        return { texte: `${nom} peut avoir ${pluriel(r.projetsAccordes, "projet de plus", "projets de plus")} en cours dans son espace.`, donnees: r, liens: liensDossier };
      }
      case "VALIDER_PROJET":
        return geste({ geste: "valider-projet" }, `Projet de ${nom} validé à sa place.`);
      case "DEVALIDER_PROJET":
        return geste({ geste: "devalider-projet" }, `Projet de ${nom} dévalidé : il peut le modifier.`);
      case "VALIDER_SIMULATION":
        if (!e.simulation_id) throw new ErreurMetier("Quelle simulation ? (simulation_id)", 400);
        return geste({ geste: "valider-simulation", simulationId: e.simulation_id }, `Simulation validée à la place de ${nom}.`);
      case "DEVALIDER_SIMULATION":
        return geste({ geste: "devalider-simulation" }, `Choix de simulation de ${nom} dévalidé.`);
      case "RETIRER_DEMANDE":
        return geste({ geste: "retirer-demande" }, `Demande d'autre proposition de ${nom} retirée.`);
      case "REINITIALISER":
        if (!e.etape) throw new ErreurMetier("Quelle étape ? (PROJET, SIMULATIONS, DEVIS)", 400);
        return geste({ geste: "reinitialiser", etape: e.etape }, `Étape « ${e.etape} » de l'espace de ${nom} réinitialisée : le client la refait.`);
      case "RETIRER_ACCORD":
        return geste({ geste: "retirer-accord", motif: e.motif ?? "" }, `Bon pour accord retiré chez ${nom} : preuve gardée, dossier revenu à « Devis envoyé ».`);
      case "MARQUER_LUS": {
        const n = await marquerMessagesLus(exigerDossier(ids));
        return { texte: n ? `${pluriel(n, "message")} de ${nom} ${accord(n, "marqué lu", "marqués lus")}.` : `Aucun message non lu chez ${nom}.`, donnees: { marques: n }, liens: liensDossier };
      }
      case "RETIRER_PHOTO":
      case "REMETTRE_PHOTO":
        if (!e.photo_id) throw new ErreurMetier("Quelle photo ? (photo_id)", 400);
        return geste({ geste: e.geste === "RETIRER_PHOTO" ? "retirer-photo" : "remettre-photo", photoId: e.photo_id }, `Photo ${e.geste === "RETIRER_PHOTO" ? "retirée de" : "remise dans"} l'espace de ${nom}.`);
    }
  },
});

/* ── doublon ────────────────────────────────────────────────────────── */

const schemaDoublon = z.object({
  nature: z.enum(["LEAD", "CLIENT"]),
  action: z.enum(["LISTER", "FUSIONNER", "ECARTER", "CHERCHER"]).describe("LISTER les doublons signalés ; FUSIONNER (sensible) ; ECARTER (ce n'est pas la même personne) ; CHERCHER (clients : chercher les doublons maintenant, chaque paire devient une proposition)."),
  id: z.string().max(40).optional().describe("LEAD : le lead signalé comme doublon. CLIENT : la proposition de fusion ([proposition:…])."),
  conserver: z.enum(["A", "B"]).optional().describe("CLIENT FUSIONNER : la fiche à conserver (A ou B ; à défaut, celle que la proposition retient)."),
  motif: z.enum(["PERSONNES_DIFFERENTES", "MEME_FOYER"]).optional().describe("CLIENT ECARTER."),
  commentaire: z.string().max(300).optional(),
});

async function descriptionFusionLead(id: string): Promise<string> {
  const lead = await prisma.lead.findUnique({ where: { id }, select: { prenom: true, nom: true, telephone: true, email: true, doublonDe: true, doublonMotif: true, doublonTraiteLe: true } });
  if (!lead) throw new ErreurMetier("Lead introuvable.", 404);
  if (!lead.doublonDe) throw new ErreurMetier("Aucun doublon signalé pour ce contact.", 400);
  const ancien = await prisma.lead.findUnique({ where: { id: lead.doublonDe }, select: { prenom: true, nom: true, telephone: true, email: true } });
  return `${`${lead.prenom} ${lead.nom}`.trim()} (${lead.telephone || "sans numéro"}${lead.email ? `, ${lead.email}` : ""}) sera fusionné dans ${ancien ? `${`${ancien.prenom} ${ancien.nom}`.trim()} (${ancien.telephone || "sans numéro"})` : "le contact d'origine"}${lead.doublonMotif ? ` — ${lead.doublonMotif}` : ""}`;
}

export const outilDoublon = definirOutil({
  nom: "doublon",
  titre: "Les doublons de leads et de clients",
  description:
    "LEAD : LISTER les contacts signalés comme doublons ; FUSIONNER (id du lead signalé : son historique, ses simulations et photos rejoignent le contact d'origine, il est archivé ; sensible, aperçu puis confirmation) ; ECARTER (« ce n'est pas la même personne »). CLIENT : CHERCHER les fiches en double (chaque paire devient une proposition à valider) ; LISTER les propositions de fusion ; FUSIONNER (id de la proposition, « conserver » A ou B : l'autre fiche est archivée, dossiers, leads et coordonnées rejoignent celle-ci ; sans « défusion » : sensible) ; ECARTER (motif PERSONNES_DIFFERENTES ou MEME_FOYER).",
  niveau: "REVERSIBLE",
  schema: schemaDoublon,
  sensible: (e) => e.action === "FUSIONNER",
  apercu: async (e) => {
    if (!e.id) throw new ErreurMetier("Donne l'identifiant (id).", 400);
    if (e.nature === "LEAD") return `Je vais fusionner ce doublon : ${await descriptionFusionLead(e.id)}. Irréversible en pratique.`;
    const brut = await prisma.proposition.findUnique({ where: { id: e.id } });
    if (!brut || brut.type !== "FUSION_CLIENTS") throw new ErreurMetier("Proposition de fusion introuvable.", 404);
    const p = vueProposition(brut);
    const conserver = e.conserver ?? (p.contenu.conserver as string);
    return `Je vais fusionner deux fiches client : ${p.titre}\n${p.resume ?? ""}\nFiche conservée : ${conserver}. L'autre est archivée ; ses dossiers, leads et coordonnées rejoignent la fiche conservée. Pas de « défusion ».`;
  },
  executer: async (e) => {
    if (e.nature === "LEAD") {
      if (e.action === "LISTER") {
        const leads = await prisma.lead.findMany({ where: { doublonDe: { not: null }, doublonTraiteLe: null }, orderBy: { createdAt: "desc" }, take: 50, select: { id: true, prenom: true, nom: true, telephone: true, doublonDe: true, doublonMotif: true } });
        return { texte: leads.length ? `${pluriel(leads.length, "doublon signalé", "doublons signalés")} :\n${leads.map((l) => `- ${`${l.prenom} ${l.nom}`.trim()} (${l.telephone || "sans numéro"}) — ${l.doublonMotif ?? "doublon probable"} [lead:${l.id}] → [lead:${l.doublonDe}]`).join("\n")}` : "Aucun doublon de lead signalé.", donnees: leads };
      }
      if (e.action === "CHERCHER") throw new ErreurMetier("Les doublons de leads sont signalés à l'arrivée : « LISTER » les montre.", 400);
      if (!e.id) throw new ErreurMetier("Donne l'identifiant du lead signalé (id).", 400);
      if (e.action === "ECARTER") {
        await ecarterDoublon(e.id);
        return { texte: "Signalement écarté : ce n'est pas la même personne.", liens: [lien("Lead", `/leads?lead=${e.id}`)] };
      }
      const r = await fusionnerDoublon(e.id);
      return { texte: `Doublon fusionné : ${pluriel(r.simulations, "simulation")} et ${pluriel(r.photos, "photo")} rejoignent le contact d'origine${r.dossiersArchives ? `, ${pluriel(r.dossiersArchives, "dossier vide archivé", "dossiers vides archivés")}` : ""}.`, donnees: r, liens: r.dossierId ? [lien("Dossier", `/dossiers?dossier=${r.dossierId}`)] : [] };
    }
    if (e.action === "CHERCHER") {
      const nouvelles = await proposerFusions();
      return { texte: nouvelles ? `${pluriel(nouvelles, "nouvelle paire", "nouvelles paires")} de fiches en double, proposées à la fusion (« doublon » CLIENT LISTER).` : "Aucune nouvelle paire de fiches en double.", donnees: { nouvelles }, liens: [lien("À valider", "/validation")] };
    }
    if (e.action === "LISTER") {
      const propositions = await listerPropositions({ type: "FUSION_CLIENTS", statuts: ["EN_ATTENTE"], limite: 100 });
      return { texte: propositions.length ? `${pluriel(propositions.length, "fusion proposée", "fusions proposées")} :\n${propositions.map((p) => `- ${p.titre} (conserver ${String(p.contenu.conserver)} par défaut)${p.resume ? ` — ${p.resume.replace(/\n/g, " / ")}` : ""} [proposition:${p.id}]`).join("\n")}` : "Aucune fusion de clients en attente.", donnees: propositions };
    }
    if (!e.id) throw new ErreurMetier("Donne l'identifiant de la proposition de fusion (id).", 400);
    if (e.action === "ECARTER") {
      const p = await rejeterProposition(e.id, { motif: e.motif ?? "PERSONNES_DIFFERENTES", commentaire: e.commentaire ?? null });
      return { texte: `Fusion écartée : ${p.titre}.`, donnees: p };
    }
    const p = await validerProposition(e.id, e.conserver ? { conserver: e.conserver } : undefined);
    return { texte: `Fiches fusionnées (${p.statut.toLowerCase()}) : ${p.titre}.`, donnees: p, liens: p.liens.map((l) => lien(l.libelle, l.href)) };
  },
});

/* ── anonymiser_client ──────────────────────────────────────────────── */

export const outilAnonymiserClient = definirOutil({
  nom: "anonymiser_client",
  titre: "Anonymiser une fiche client (RGPD)",
  description:
    "Anonymise définitivement une fiche client (droit à l'effacement, durée de conservation écoulée) : nom, coordonnées, notes, mails, photos effacés ; les documents émis et les encaissements gardés (obligation comptable), sous pseudonyme. Refusé tant qu'un dossier est en cours. Toujours sensible : l'aperçu dit ce qui sera effacé, gardé, et ce qui bloque ; puis confirmation. Motif : DEMANDE_PERSONNE, DUREE_ECOULEE ou AUTRE (commentaire obligatoire).",
  niveau: "SENSIBLE",
  schema: schemaCible.extend({ motif: z.enum(MOTIFS_ANONYMISATION), commentaire: z.string().trim().max(500).optional() }),
  apercu: async (e) => {
    const r = await cibler(e, "CLIENT");
    if (r.ambigu) return r.ambigu.texte;
    if (!r.ids.clientId) throw new ErreurMetier(`${r.ids.nom} n'a pas de fiche client.`, 409);
    const a = await apercuAnonymisation(r.ids.clientId);
    return [
      `Je vais ANONYMISER la fiche de ${r.ids.nom} (réf. ${a.reference}) — définitif, motif ${e.motif}${e.commentaire ? ` (${e.commentaire})` : ""}.`,
      `Effacé : ${pluriel(a.efface.dossiers, "dossier")}, ${pluriel(a.efface.photos, "photo")}, ${pluriel(a.efface.mails, "mail")}, ${pluriel(a.efface.notes, "note")}, ${pluriel(a.efface.leads, "lead")}, ${pluriel(a.efface.propositions, "proposition")}.`,
      `Gardé (obligation comptable) : ${pluriel(a.garde.documentsEmis, "document émis", "documents émis")}, ${pluriel(a.garde.encaissements, "encaissement")}.`,
      a.adresses.length || a.telephones.length ? `À traiter à la main hors du CRM : ${[...a.adresses, ...a.telephones].join(", ")}.` : "",
      a.bloquants.length ? `BLOQUÉ, rien ne sera fait : ${a.bloquants.join(" ")}` : "",
    ].filter(Boolean).join("\n");
  },
  executer: async (e) => {
    const r = await cibler(e, "CLIENT");
    if (r.ambigu) return r.ambigu;
    if (!r.ids.clientId) throw new ErreurMetier(`${r.ids.nom} n'a pas de fiche client.`, 409);
    const p = await anonymiserClient(r.ids.clientId, { motif: e.motif, commentaire: e.commentaire ?? null, confirmation: true });
    return { texte: `Fiche anonymisée (${p.statut.toLowerCase()}). Les documents émis et les encaissements restent, sous pseudonyme.`, donnees: { propositionId: p.id, statut: p.statut }, liens: [lien("Fiche client", `/clients/${r.ids.clientId}`)] };
  },
});

/* ── agir_systeme ───────────────────────────────────────────────────── */

export const ACTIONS_SYSTEME = ["DETECTER_TACHES", "RELANCER_TACHE", "ANNULER_TACHE", "CORRIGER_INCOHERENCE", "RELANCER_SYNCHRO", "SYNCHRONISER_DRIVE", "VERIFIER_DRIVE", "RELEVER_MAILS", "ESSAI_META", "TESTER_NOTIFICATION", "REJOUER_META", "LANCER_BANC", "REVOQUER_ACCES", "DECONNECTER_GOOGLE"] as const;

/** Les corrections de cohérence qui déplacent un dossier d'étape (Signé, Simulation) ou touchent un devis : sensibles. */
const CORRECTIONS_SENSIBLES = new Set(["ACCORD_SANS_SIGNATURE", "PAIEMENT_AVANT_SIGNATURE", "DEVIS_ACCEPTE_AVANT_SIGNE", "SIGNE_SANS_DEVIS_ACCEPTE", "ETAPE_ET_SOLDE", "PROJET_VALIDE_SANS_AVANCER"]);

const schemaAgirSysteme = z.object({
  action: z.enum(ACTIONS_SYSTEME),
  id: z.string().max(80).optional().describe("RELANCER_TACHE / ANNULER_TACHE : la tâche de fond ([tache-de-fond:…], etat_crm TACHES_DE_FOND)."),
  cle: z.string().max(120).optional().describe("CORRIGER_INCOHERENCE : la clé ([cle:…], etat_crm COHERENCE)."),
  source: z.enum(SOURCES_SYNCHRONISEES).optional().describe("RELANCER_SYNCHRO : META, GOOGLE_ADS, SEARCH_CONSOLE, FICHE_GOOGLE."),
  notifier: z.boolean().optional().describe("ESSAI_META : avec la notification (vrai par défaut)."),
  canal: z.enum(["ALERTES", "APPAREIL"]).optional().describe("TESTER_NOTIFICATION : tous les canaux d'alerte (défaut) ou les appareils abonnés (push web)."),
  leadgen_id: z.string().max(80).optional().describe("REJOUER_META : un lead Meta ; à défaut, tous ceux qui attendent (sensible)."),
  cas: z.string().max(40).optional().describe("LANCER_BANC : un cas ; à défaut, tous."),
  variante: z.string().max(40).optional().describe("LANCER_BANC : une variante (V1, V2) ; à défaut, toutes."),
  application_id: z.string().max(2000).optional().describe("REVOQUER_ACCES : une application ([application:…], etat_crm ACCES)."),
  jeton_id: z.string().max(40).optional().describe("REVOQUER_ACCES : un jeton ([jeton:…])."),
  tout: z.boolean().optional().describe("REVOQUER_ACCES : tout révoquer (coupe aussi cette session)."),
});
type EntreeAgirSysteme = z.output<typeof schemaAgirSysteme>;

async function coutDuBanc(e: EntreeAgirSysteme): Promise<{ texte: string; min: number }> {
  const b = await etatBanc();
  const cas = b.cas.filter((c) => c.photo && (!e.cas || c.id === e.cas));
  let total = 0;
  let rendus = 0;
  for (const c of cas) {
    const parVariante = b.estimation.parCas[c.id] ?? {};
    for (const [variante, cout] of Object.entries(parVariante)) {
      if (e.variante && variante !== e.variante) continue;
      total += cout;
      rendus++;
    }
  }
  const complet = !e.cas && !e.variante;
  return { texte: complet ? `${b.estimation.rendus} rendus, entre ${b.estimation.totalMin.toFixed(2)} et ${b.estimation.totalMax.toFixed(2)} $` : `${pluriel(rendus, "rendu")}, ≈ ${total.toFixed(2)} $`, min: complet ? b.estimation.totalMin : total };
}

export const outilAgirSysteme = definirOutil({
  nom: "agir_systeme",
  titre: "Les gestes techniques (tâches de fond, cohérence, synchronisations, Meta, banc, accès)",
  description:
    "DETECTER_TACHES (« Actualiser » : une passe de tous les détecteurs) ; RELANCER_TACHE / ANNULER_TACHE (id d'une tâche de fond ; annuler est sensible : un envoi peut ne jamais partir) ; CORRIGER_INCOHERENCE (cle ; sensible quand la correction change une étape ou un devis) ; RELANCER_SYNCHRO d'une source de l'Analytique ; SYNCHRONISER_DRIVE, VERIFIER_DRIVE ; RELEVER_MAILS ; ESSAI_META (faux lead ESSAI, notifier) ; TESTER_NOTIFICATION (ALERTES : tous les canaux ; APPAREIL : push web) ; REJOUER_META (un leadgen_id, ou tous : sensible, des SMS d'accusé peuvent partir) ; LANCER_BANC (cas, variante : coût d'images OpenAI, aperçu du coût puis confirmation) ; REVOQUER_ACCES (application_id, jeton_id ou tout : sensible) ; DECONNECTER_GOOGLE (sensible). Les états se lisent par « etat_crm ».",
  niveau: "REVERSIBLE",
  schema: schemaAgirSysteme,
  sensible: async (e) => {
    if (["ANNULER_TACHE", "LANCER_BANC", "REVOQUER_ACCES", "DECONNECTER_GOOGLE"].includes(e.action)) return true;
    if (e.action === "REJOUER_META") return !e.leadgen_id;
    if (e.action === "CORRIGER_INCOHERENCE" && e.cle) {
      const i = (await controlerCoherence()).incoherences.find((x) => x.cle === e.cle);
      return Boolean(i && CORRECTIONS_SENSIBLES.has(i.code));
    }
    return false;
  },
  apercu: async (e) => {
    switch (e.action) {
      case "ANNULER_TACHE": {
        const t = e.id ? await prisma.tache.findUnique({ where: { id: e.id }, select: { type: true, statut: true, derniereErreur: true } }) : null;
        return t ? `Je vais annuler la tâche de fond ${t.type} (${t.statut.toLowerCase()}${t.derniereErreur ? ` : ${t.derniereErreur.slice(0, 120)}` : ""}). Si c'est un envoi, il ne partira jamais.` : "Tâche de fond introuvable : rien ne sera fait.";
      }
      case "CORRIGER_INCOHERENCE": {
        const i = (await controlerCoherence()).incoherences.find((x) => x.cle === e.cle);
        return i ? `Je vais corriger l'incohérence « ${i.constat} » (${i.client}) : ${i.correction ?? "à régler à la main (refusé)"}.` : "Cette incohérence n'existe plus : rien ne sera fait.";
      }
      case "REJOUER_META": {
        const sante = await santeMeta({ interrogerMeta: false });
        return `Je vais rejouer ${pluriel(sante.echecs.leads.length, "lead Meta en attente", "leads Meta en attente")} (reçus mais pas dans le CRM). Un SMS d'accusé de réception peut partir pour chacun.`;
      }
      case "LANCER_BANC": {
        const cout = await coutDuBanc(e);
        return `Je vais lancer le banc${e.cas ? ` pour le cas ${e.cas}` : ""}${e.variante ? `, variante ${e.variante}` : ""} : ${cout.texte} d'images OpenAI.`;
      }
      case "REVOQUER_ACCES":
        return e.tout ? "Je vais révoquer TOUS les accès de l'assistant (applications et jetons) : cette session sera coupée aussi ; il faudra reconnecter le connecteur." : `Je vais révoquer ${e.application_id ? `l'application ${e.application_id} (tous ses jetons)` : `le jeton ${e.jeton_id ?? "?"}`}.`;
      case "DECONNECTER_GOOGLE":
        return "Je vais déconnecter le compte Google : Gmail, agenda et Drive ne seront plus lus ni écrits jusqu'à la reconnexion (dans Paramètres, par Lucas).";
      default:
        return `Je vais faire « ${e.action} ».`;
    }
  },
  executer: async (e, contexte) => {
    switch (e.action) {
      case "DETECTER_TACHES": {
        const bilan = await passeComplete(contexte.maintenant);
        const r = bilan.reconciliation;
        return { texte: `Tâches actualisées : ${pluriel(r.crees + r.rouvertes, "nouvelle", "nouvelles")}, ${pluriel(r.cochees, "cochée par le CRM", "cochées par le CRM")}.`, donnees: { nouvelles: r.crees + r.rouvertes, cochees: r.cochees, reconciliation: r }, liens: [lien("Tâches", "/taches")] };
      }
      case "RELANCER_TACHE":
      case "ANNULER_TACHE": {
        if (!e.id) throw new ErreurMetier("Quelle tâche de fond ? (id, rendu par etat_crm TACHES_DE_FOND)", 400);
        try {
          if (e.action === "RELANCER_TACHE") await relancerTache(e.id);
          else await annulerTache(e.id);
        } catch (erreur) {
          throw new ErreurMetier(erreur instanceof Error ? erreur.message : "Geste impossible.", 409);
        }
        return { texte: e.action === "RELANCER_TACHE" ? "Tâche de fond remise en file." : "Tâche de fond annulée.", liens: [lien("Tâches de fond", "/taches-de-fond")] };
      }
      case "CORRIGER_INCOHERENCE": {
        if (!e.cle) throw new ErreurMetier("Quelle incohérence ? (cle, rendue par etat_crm COHERENCE)", 400);
        const r = await corrigerIncoherence(e.cle);
        return { texte: r.corrigee ? `Corrigé : ${r.message}` : r.message, donnees: r, liens: [lien("Tâches de fond", "/taches-de-fond")] };
      }
      case "RELANCER_SYNCHRO": {
        if (!e.source) throw new ErreurMetier("Quelle source ? (META, GOOGLE_ADS, SEARCH_CONSOLE, FICHE_GOOGLE)", 400);
        const tache = await relancerSynchro(e.source);
        return { texte: `Synchronisation « ${LIBELLES_SOURCE_SYNCHRONISEE[e.source]} » mise en file : l'état de la source et les chiffres changent dès qu'elle a abouti (quelques minutes au plus).`, donnees: { tache }, liens: [lien("Analytique", "/analytique")] };
      }
      case "SYNCHRONISER_DRIVE":
      case "VERIFIER_DRIVE":
        await demanderSynchronisation(e.action === "VERIFIER_DRIVE");
        return { texte: e.action === "VERIFIER_DRIVE" ? "Vérification du miroir Drive mise en file (élément par élément)." : "Synchronisation du miroir Drive mise en file.", liens: [lien("Paramètres", "/parametres")] };
      case "RELEVER_MAILS":
        await demanderReleve();
        return { texte: "Relevé de la boîte mail mis en file (tâche de fond).", liens: [lien("Mail", "/mail")] };
      case "ESSAI_META": {
        const rapport = await lancerEssaiMeta({ notifier: e.notifier !== false });
        return { texte: `Essai Meta ${rapport.ok ? "réussi" : "EN ÉCHEC"} : ${rapport.etapes.map((x) => JSON.stringify(x)).join(" · ").slice(0, 800)}`, donnees: rapport, liens: [lien("Analytique — Publicité", "/analytique?onglet=publicite")] };
      }
      case "TESTER_NOTIFICATION": {
        if (e.canal === "APPAREIL") {
          const resultat = await envoyerPushWeb({ titre: "Notifications actives", texte: "Cet appareil recevra les nouveaux leads, les SMS des clients et leurs gestes dans leur espace.", lien: "/leads", etiquette: "essai" }, { application: "crm" });
          return { texte: `Notification d'essai aux appareils : ${resultat.ok ? "envoyée" : `échec (${resultat.detail ?? (resultat.configure ? "?" : "aucun appareil ou clé VAPID absente")})`}.`, donnees: resultat };
        }
        const resultats = await alerter({ titre: "Essai de notification CoverSwap", texte: ["Essai lancé depuis l'assistant (chaîne des leads Meta).", "Si ce message apparaît sur votre téléphone, ce canal fonctionne : un vrai lead vous préviendra de la même façon."].join("\n\n"), lien: `${(process.env.NEXT_PUBLIC_APP_URL || "https://crm.coverswap.fr").replace(/\/$/, "")}/analytique?onglet=publicite`, libelleLien: "Ouvrir la chaîne des leads Meta", telephone: "+33612345678", urgence: 4 }, { origine: "essai" });
        const pousse = resultats.some((r) => r.ok && CANAUX_PUSH.includes(r.canal));
        return { texte: `Notification d'essai : ${resultats.map((r) => `${r.canal} ${r.ok ? "ok" : "échec"}`).join(", ") || "aucun canal"}${pousse ? " — le téléphone doit sonner." : " — AUCUNE notification poussée : le téléphone ne sonne pas."}`, donnees: { resultats, pousseRecue: pousse } };
      }
      case "REJOUER_META": {
        const cibles = e.leadgen_id ? [e.leadgen_id] : (await santeMeta({ interrogerMeta: false })).echecs.leads.map((l) => l.leadgenId);
        const resultats: { leadgenId: string; ok: boolean; erreur?: string }[] = [];
        for (const leadgenId of cibles) {
          try {
            await rejouerLeadMeta(leadgenId);
            resultats.push({ leadgenId, ok: true });
          } catch (erreur) {
            resultats.push({ leadgenId, ok: false, erreur: erreur instanceof Error ? erreur.message : "échec" });
          }
        }
        const ok = resultats.filter((r) => r.ok).length;
        return { texte: cibles.length ? `${pluriel(ok, "lead Meta rejoué", "leads Meta rejoués")} sur ${cibles.length}${resultats.some((r) => !r.ok) ? ` ; échecs : ${resultats.filter((r) => !r.ok).map((r) => `${r.leadgenId} (${r.erreur})`).join(", ")}` : ""}.` : "Aucun lead Meta en attente.", donnees: { rejoues: ok, resultats } };
      }
      case "LANCER_BANC": {
        const r = await lancerBanc({ cas: e.cas ?? null, variante: e.variante ?? null });
        return { texte: `Banc lancé (campagne ${r.campagneId}) : ${pluriel(r.lances.length, "rendu")} en file${r.ignores.length ? ` ; ignorés : ${r.ignores.map((i) => `${i.cas}${i.variante ? ` ${i.variante}` : ""} (${i.raison})`).join(", ")}` : ""}.`, donnees: r, liens: [lien("Banc", "/simulateur/banc")] };
      }
      case "REVOQUER_ACCES": {
        const motif = "Révoqué par Lucas (assistant)";
        if (e.tout) {
          const n = await revoquerTout(motif);
          return { texte: `Tous les accès révoqués (${pluriel(n, "jeton")}). Il faudra reconnecter le connecteur.` };
        }
        if (e.application_id) await revoquerClient(e.application_id, motif);
        else if (e.jeton_id) await revoquerJeton(e.jeton_id, motif);
        else throw new ErreurMetier("Quoi révoquer ? (application_id, jeton_id ou tout)", 400);
        return { texte: e.application_id ? "Application révoquée (tous ses jetons)." : "Jeton révoqué.", liens: [lien("Paramètres → Assistant", "/parametres#assistant")] };
      }
      case "DECONNECTER_GOOGLE":
        await deconnecterGoogle();
        return { texte: "Compte Google déconnecté : la connexion reste dans l'historique, datée. Lucas reconnecte depuis Paramètres.", liens: [lien("Paramètres", "/parametres")] };
    }
  },
});

/** Les outils de ce fichier, et ceux qu'ils remplacent (docs/MCP-COUVERTURE.md § 4.14). */
export const OUTILS_GESTES = [outilPublier, outilTraiterMail, outilGesteEspace, outilDoublon, outilAnonymiserClient, outilAgirSysteme];
export const REMPLACES_PAR_GESTES = {
  publier: ["publier_simulation", "masquer_simulation"],
  traiter_mail: ["ranger_mail", "snoozer_mail", "rattacher_mail"],
  geste_espace: ["renouveler_lien", "accorder_simulations", "marquer_messages_lus", "retirer_accord"],
  doublon: [],
  anonymiser_client: [],
  agir_systeme: [],
} as const;
