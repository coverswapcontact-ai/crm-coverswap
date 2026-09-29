import { LIBELLES_ISSUE } from "@/lib/commercial/constantes";
import { lireEtiquettes } from "@/lib/commercial/notes-appel";
import { aHeureParis } from "@/lib/commercial/quand";
import { estSansReponse, issueDuContenu, MOTIF_RAPPELER, sansLibelleIssue, type AppelLu } from "@/lib/commercial/sans-reponse";
import { heure, jourLong } from "@/lib/commun/format";
import type { EtapeDossier } from "@/lib/dossiers/constants";
import { ecrireNote } from "@/lib/dossiers/dossiers";
import type { BaseDonnees } from "@/lib/prisma";
import { STATUTS_LEAD_APRES_DEVIS } from "@/lib/prospects/constantes";
import { PREFIXE_CORBEILLE } from "@/lib/prospects/corbeille";
import type { MigrationDonnees } from "./index";

/**
 * Mission 14 (29/09/2026), partie 2 — les leads perdus. « Un lead qui ne
 * décroche pas sort de la liste par « Traiter » et je le perds. » Jouée une fois
 * au démarrage (sauvegarde automatique avant), idempotente.
 *
 * Candidats : les leads traités ou archivés depuis le 1er septembre, sauf perdus
 * (ils ont une destination), doublons en attente, archivés pour test, essai ou
 * doublon, et leads à la corbeille (supprimés par Lucas) ; retenus si leur
 * DERNIER appel est sans réponse ou « À rappeler » (échange, note d'appel ou
 * événement de dossier, le plus récent des trois) ou si une note contient
 * « rappeler » (écrit vite : « rapeller »…). Une note, c'est ce que Lucas écrit :
 * note d'appel, échange (note ou appel, sans le libellé d'issue mis en tête par
 * la fin d'appel), note de dossier — pas la demande du client (message, notes du
 * formulaire, notes de réception qui les recopient, note de reprise d'un dossier).
 *
 * Sans dossier ouvert : le lead est restauré, sorti de « traité », rappel
 * demain 18 h (heure de Paris) — ou le rappel qu'il avait déjà, s'il est prévu
 * plus tard —, et une note le dit. Avec un dossier vivant : le lead reste où il
 * est, le dossier prend « Rappeler » demain 18 h si sa prochaine action est vide
 * ou déjà un rappel (un rappel daté plus loin est gardé) ; sinon rien ne bouge.
 * Un lead qu'aucune liste ne montrerait (dossier perdu ou encaissé encore
 * ouvert, statut d'après devis) n'est pas touché. Tout ce qui ne bouge pas est
 * compté à part. Une ligne par lead dans les journaux (id et nom : les journaux
 * de Railway sont privés, le dépôt ne nomme personne).
 */

const NOM = "leads-a-rappeler-14-2";
/** 1er septembre 2026, minuit à Paris. */
const DEPUIS = new Date("2026-09-01T00:00:00+02:00");
const HEURE_RAPPEL = 18;
/** Début de la note écrite sur le lead remis : la trace qu'il a déjà été remis (rejouer ne réécrit rien). */
export const MARQUE_REMIS = "Remis dans « À rappeler » (mission 14)";
/** Début de la note écrite sur un dossier vivant : le lead ne change pas de liste, le rappel vit dans la prochaine action du dossier. */
export const MARQUE_DOSSIER = "Rappel posé (mission 14)";
/** Notes de réception écrites par le système avec les mots du client (formulaire, message) : pas une note de Lucas. */
const RECEPTION = /^(Lead reçu|Lead Meta Ads reçu|Nouvelle demande via|Nouvelle simulation|Nouveau contact du client)/;
/** Note de reprise d'un dossier ouvert depuis un lead : elle recopie la demande du client (les échanges sont lus à part). */
const REPRISE = /^Contact reçu le /;
/**
 * Motif d'archivage « Test » ou « Doublon » (libellé de la liste ou texte libre, dont « Doublon de … : fusionné »), ou
 * contact d'essai archivé par le CRM (« Contact d'essai Zapier… », « … de l'intégration Meta »), en mot entier, sans casse.
 */
const MOTIF_ECARTE = /\b(tests?|essais?|doublons?)\b/;
const ETAPES_SORTIES = ["PERDU", "ENCAISSE"];
/** Statuts de l'ancien CRM après le devis : la liste des leads ne les montre plus (`sansDossierActif`). */
const APRES_DEVIS: readonly string[] = STATUTS_LEAD_APRES_DEVIS;

const aplatir = (texte: string) => texte.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

type Trace = { le: Date; texte: string };

function lireIssue(metadata: string): string | null {
  try {
    const valeur: unknown = JSON.parse(metadata);
    const issue = valeur && typeof valeur === "object" ? (valeur as Record<string, unknown>).issue : null;
    return typeof issue === "string" ? issue : null;
  } catch {
    return null;
  }
}

/** Le passage de la note autour de « rappeler », sur une ligne, pour dire pourquoi le lead revient. */
function extrait(texte: string): string {
  const ligne = texte.replace(/\s+/g, " ").trim();
  const trouve = MOTIF_RAPPELER.exec(ligne);
  if (!trouve) return ligne.slice(0, 80);
  const debut = Math.max(0, trouve.index - 40);
  const fin = Math.min(ligne.length, trouve.index + trouve[0].length + 40);
  return `${debut > 0 ? "…" : ""}${ligne.slice(debut, fin).trim()}${fin < ligne.length ? "…" : ""}`;
}

const plusRecent = <T extends { le: Date }>(liste: T[]): T | null => liste.reduce<T | null>((choisi, x) => (!choisi || x.le.getTime() > choisi.le.getTime() ? x : choisi), null);

export async function remettreARappeler(client: BaseDonnees, maintenant: Date = new Date()): Promise<Record<string, number>> {
  const rappel = aHeureParis(maintenant, 1, HEURE_RAPPEL);
  const quandRappel = `Rappel le ${jourLong(rappel)} à ${HEURE_RAPPEL} h.`;

  // Lecture avec les archivés : le `where` de premier niveau parle de `archiveLe` (les `include` ne sont pas filtrés).
  const leads = await client.lead.findMany({
    where: { OR: [{ traiteLe: { gte: DEPUIS } }, { archiveLe: { gte: DEPUIS } }] },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      prenom: true,
      nom: true,
      statut: true,
      doublonDe: true,
      doublonTraiteLe: true,
      archiveMotif: true,
      rappelLe: true,
      interactions: { where: { archiveLe: null, type: { in: ["APPEL", "NOTE"] } }, select: { type: true, contenu: true, createdAt: true } },
      notesAppel: { where: { archiveLe: null }, select: { appelLe: true, texte: true, etiquettes: true, issue: true } },
      dossiers: {
        select: {
          id: true,
          etape: true,
          archiveLe: true,
          createdAt: true,
          prochaineAction: true,
          prochaineActionDate: true,
          evenements: { where: { archiveLe: null, type: "APPEL" }, select: { contenu: true, metadata: true, survenuLe: true, createdAt: true } },
          notes: { where: { archiveLe: null }, select: { contenu: true, createdAt: true } },
        },
      },
    },
  });

  let remis = 0;
  let remisRappelGarde = 0;
  let rappelsSurDossier = 0;
  let dossiersRappelGarde = 0;
  let dossiersAutreAction = 0;
  let horsListes = 0;
  let ecartes = 0;
  let dejaRemis = 0;
  let nonConcernes = 0;
  for (const lead of leads) {
    const nom = `${lead.prenom} ${lead.nom}`.trim();
    const motif = aplatir(lead.archiveMotif ?? "");
    // Un doublon en attente de décision (même règle que la liste) : un signalement écarté — « ce n'est pas la même
    // personne » — garde `doublonDe` mais n'est pas un doublon ; le doublon fusionné est écarté par son motif d'archivage.
    const doublon = Boolean(lead.doublonDe) && !lead.doublonTraiteLe;
    if (lead.statut === "PERDU" || doublon || MOTIF_ECARTE.test(motif) || lead.archiveMotif?.startsWith(PREFIXE_CORBEILLE)) {
      ecartes++;
      continue;
    }
    const notesDossiers = lead.dossiers.flatMap((d) => d.notes);
    if (lead.interactions.some((i) => i.type === "NOTE" && i.contenu.startsWith(MARQUE_REMIS)) || notesDossiers.some((n) => n.contenu.startsWith(MARQUE_DOSSIER))) {
      dejaRemis++;
      continue;
    }

    // Le dernier appel, tous supports confondus.
    const appels: (AppelLu & { le: Date })[] = [
      ...lead.interactions.filter((i) => i.type === "APPEL").map((i) => ({ le: i.createdAt, texte: i.contenu, issue: issueDuContenu(i.contenu) })),
      ...lead.notesAppel.map((n) => ({ le: n.appelLe, texte: n.texte, issue: n.issue, etiquettes: lireEtiquettes(n.etiquettes) })),
      ...lead.dossiers.flatMap((d) => d.evenements.map((e) => ({ le: e.survenuLe ?? e.createdAt, texte: e.contenu, issue: lireIssue(e.metadata) }))),
    ];
    const dernier = plusRecent(appels);
    // Ce que Lucas a écrit, la plus récente qui demande un rappel. Le libellé « À rappeler » que la fin d'appel met en
    // tête d'un échange ou d'une note de dossier est une issue, lue par la règle du dernier appel : il est retiré ici.
    const notes: Trace[] = [
      ...lead.interactions.filter((i) => !RECEPTION.test(i.contenu)).map((i) => ({ le: i.createdAt, texte: i.type === "APPEL" ? sansLibelleIssue(i.contenu) : i.contenu })),
      ...lead.notesAppel.map((n) => ({ le: n.appelLe, texte: n.texte })),
      ...notesDossiers.filter((n) => !REPRISE.test(n.contenu)).map((n) => ({ le: n.createdAt, texte: sansLibelleIssue(n.contenu) })),
    ];
    const aRappeler = plusRecent(notes.filter((n) => MOTIF_RAPPELER.test(n.texte)));
    const raison =
      dernier && estSansReponse(dernier)
        ? "dernier appel sans réponse"
        : dernier?.issue === "A_RAPPELER"
          ? `dernier appel « ${LIBELLES_ISSUE.A_RAPPELER} »`
          : aRappeler
            ? `note « ${extrait(aRappeler.texte)} »`
            : null;
    if (!raison) {
      nonConcernes++;
      continue;
    }

    const ouverts = lead.dossiers.filter((d) => !d.archiveLe);
    const vivant = ouverts.filter((d) => !ETAPES_SORTIES.includes(d.etape)).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
    if (!vivant && (ouverts.length > 0 || APRES_DEVIS.includes(lead.statut))) {
      // Déjà une destination (dossier perdu ou encaissé encore ouvert, statut d'après devis) : aucune liste de leads ne le
      // montrerait (même règle que `sansDossierActif`). Rien n'est écrit ; Lucas tranche au cas par cas d'après les journaux.
      horsListes++;
      const ou = ouverts[0] ? `dossier ${ouverts[0].id} à l'étape ${ouverts[0].etape}` : `statut ${lead.statut}`;
      console.info(`[migration ${NOM}] ${lead.id} ${nom} : laissé, hors des listes de leads (${ou}) — ${raison}`);
      continue;
    }

    if (vivant) {
      // Le lead reste où il est : le rappel vit sur le dossier (sa prochaine action), sauf si Lucas y a prévu autre chose.
      const action = vivant.prochaineAction?.trim() ?? "";
      if (action && !/^rappeler/i.test(action)) {
        dossiersAutreAction++;
        console.info(`[migration ${NOM}] ${lead.id} ${nom} : dossier ${vivant.id} gardé (« ${action} »)`);
        continue;
      }
      if (vivant.prochaineActionDate && vivant.prochaineActionDate.getTime() > rappel.getTime()) {
        // Un rappel déjà daté plus loin (date choisie par Lucas, projet lointain) : il est gardé tel quel.
        dossiersRappelGarde++;
        console.info(`[migration ${NOM}] ${lead.id} ${nom} : dossier ${vivant.id}, rappel déjà prévu ${vivant.prochaineActionDate.toISOString()}, gardé`);
        continue;
      }
      await client.$transaction(async (tx) => {
        await tx.dossier.update({ where: { id: vivant.id }, data: { prochaineAction: "Rappeler", prochaineActionDate: rappel } });
        await ecrireNote(tx, vivant.id, { etape: vivant.etape as EtapeDossier, contenu: `${MARQUE_DOSSIER} : ${raison}. ${quandRappel}` });
      });
      rappelsSurDossier++;
      console.info(`[migration ${NOM}] ${lead.id} ${nom} → rappel ${rappel.toISOString()} sur le dossier ${vivant.id}`);
      continue;
    }

    // Un rappel déjà prévu plus tard que demain 18 h (date choisie par Lucas) est gardé : le lead revient avec sa date.
    const garde = lead.rappelLe && lead.rappelLe.getTime() > rappel.getTime() ? lead.rappelLe : null;
    const rappelDuLead = garde ?? rappel;
    const contenu = `${MARQUE_REMIS} : ${raison}. ${garde ? `Rappel déjà prévu le ${jourLong(garde)} à ${heure(garde)} : gardé.` : quandRappel}`;
    await client.$transaction(async (tx) => {
      await tx.lead.update({ where: { id: lead.id }, data: { traiteLe: null, archiveLe: null, archiveMotif: null, rappelLe: rappelDuLead } });
      await tx.interaction.create({ data: { leadId: lead.id, type: "NOTE", contenu } });
    });
    if (garde) remisRappelGarde++;
    else remis++;
    console.info(`[migration ${NOM}] ${lead.id} ${nom} → rappel ${rappelDuLead.toISOString()}${garde ? " (déjà prévu, gardé)" : ""}`);
  }

  return { examines: leads.length, remis, remisRappelGarde, rappelsSurDossier, dossiersRappelGarde, dossiersAutreAction, horsListes, ecartes, dejaRemis, nonConcernes };
}

export const migrationLeadsARappeler14: MigrationDonnees = {
  nom: NOM,
  description:
    "Leads traités ou archivés depuis le 1er septembre dont le dernier appel est sans réponse ou « À rappeler », ou qu'une note demande de rappeler : remis dans « À rappeler » (ou rappel posé sur leur dossier vivant), rappel demain 18 h sauf rappel déjà prévu plus tard",
  executer: (client) => remettreARappeler(client),
};
