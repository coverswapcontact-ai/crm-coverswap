/**
 * Mission 25 (lot 5) — rejouer à blanc les derniers événements réels (réponses des clients, notes de Lucas) : ce que
 * les règles fixes et, si Lucas le demande, l'IA en feraient aujourd'hui — classe, réponse proposée et son contrôle,
 * rappel lu dans une note, « Où on en est ». Condition de fin du lot 5 : « 20 événements réels rejoués : aucun
 * brouillon de travers, « Où on en est » juste à chaque fois ».
 *
 * Rien n'est écrit dans les dossiers : ni journal, ni message préparé, ni rappel, ni espace ouvert (le lien de
 * l'espace s'écrit « [lien de son espace] »). Seuls les appels à l'IA laissent une trace, dans leur registre
 * (`AppelIa`, budget du mois), comme tout appel.
 */
import prisma from "@/lib/prisma";
import { estimerJetons } from "@/lib/ia/modele";
import { lireParametres } from "@/lib/parametres/service";
import { estNote, intentionDeReponse, textesDesNotes } from "./analyse";
import { estCodeMessage, type CodeMessage } from "./catalogue";
import { controlerOuEnEst, texteControle } from "./controleur";
import { chargerEtat } from "./etat";
import { horodatageCourt, jourCourt } from "./horaires";
import { analyserParIa, iaDisponible } from "./ia";
import { ouEnEstParRegles } from "./ou-en-est";
import { planifier } from "./planificateur";
import { lireSurcharges } from "./redaction";
import { classerMessage, LIBELLES_CLASSE, lireNote, type ClasseMessage } from "./regles";
import { lancementMessagerie } from "./suivis";
import { formuleBonjour, remplirTexte, texteDeLaListe } from "./texte";
import type { OuEnEst } from "./types";

export const EVENEMENTS_REJOUES = 20;
const LIEN_FICTIF = "[lien de son espace]";

export type EvenementRejoue = {
  suiviId: string;
  nom: string;
  le: string;
  genre: "MESSAGE" | "NOTE";
  texte: string;
  regles: { lecture: string; reponse: { code: string; texte: string } | null; ouEnEst: OuEnEst };
  ia: { lecture: string; reponse: string | null; ecart: string | null; ouEnEst: { situation: string; client: string } | null; ecartOuEnEst: string | null } | null;
};

export type Rejeu = { evenements: EvenementRejoue[]; ia: boolean; raisonSansIa: string | null; appels: number; cout: number };

/** Le coût estimé d'un rejeu avec l'IA (prix datés de Paramètres), pour l'annoncer avant de lancer. Null : IA non réglée. */
export async function estimerRejeu(maintenant: Date = new Date()): Promise<{ euros: number; raison: string | null } | null> {
  const dispo = await iaDisponible(maintenant);
  const prix = await lireParametres(["IA_PRIX_ENTREE", "IA_PRIX_SORTIE"], maintenant);
  if (typeof prix.IA_PRIX_ENTREE !== "number" || typeof prix.IA_PRIX_SORTIE !== "number") return null;
  // Une analyse : ≈ 9 000 caractères envoyés (consignes, schéma, dossier), 1 500 jetons de sortie au plus.
  const parAppel = (estimerJetons("x".repeat(9_000)) * prix.IA_PRIX_ENTREE + 1_500 * prix.IA_PRIX_SORTIE) / 1_000_000;
  return { euros: Math.round(parAppel * EVENEMENTS_REJOUES * 100) / 100, raison: dispo.ok ? null : dispo.raison };
}

/** Le texte d'une intention, rempli sans rien ouvrir ni écrire (le lien de l'espace reste symbolique). */
function texteDeLIntention(intention: { code: string; variante: string; valeurs?: Record<string, string> }, prenom: string | null, piece: Parameters<typeof remplirTexte>[2], surcharges: Record<string, string>): string {
  if (!estCodeMessage(intention.code)) return intention.valeurs?.texte ?? "";
  return remplirTexte(texteDeLaListe(intention.code as CodeMessage, intention.variante as never, surcharges), { bonjour: formuleBonjour(prenom), lien: LIEN_FICTIF, lien_avis: LIEN_FICTIF, quand_rappel: "dans la journée", quand_reponse: "demain matin", ...(intention.valeurs ?? {}) }, piece).texte;
}

/**
 * Les `nombre` derniers événements réels (deux au plus par client, pour varier), rejoués par les règles et, si `ia`,
 * par l'IA (si elle est disponible : sinon la raison).
 */
export async function rejouerEvenements(options: { nombre?: number; ia?: boolean } = {}, maintenant: Date = new Date()): Promise<Rejeu> {
  const nombre = Math.min(Math.max(options.nombre ?? EVENEMENTS_REJOUES, 1), 40);
  const lancement = await lancementMessagerie(maintenant);
  const surcharges = await lireSurcharges();
  const dispo = options.ia ? await iaDisponible(maintenant) : null;
  const avecIa = Boolean(options.ia && dispo?.ok);
  // Le registre date les appels à l'heure réelle : on compte ceux faits depuis le début du rejeu.
  const debutReel = new Date();
  const evenements: EvenementRejoue[] = [];

  const suivis = await prisma.suivi.findMany({ where: { dernierEchangeLe: { not: null } }, orderBy: { dernierEchangeLe: "desc" }, take: 120 });
  for (const suivi of suivis) {
    if (evenements.length >= nombre) break;
    const { etat, histoire } = await chargerEtat(suivi, lancement, maintenant);
    const messages = [...etat.messagesClient].sort((a, b) => b.le.getTime() - a.le.getTime()).slice(0, 2).map((m) => ({ genre: "MESSAGE" as const, id: m.id, le: m.le, texte: m.texte, canal: m.canal, photos: m.photos }));
    const notesBrutes = histoire.filter(estNote).sort((a, b) => b.le.getTime() - a.le.getTime()).slice(0, 1);
    const textes = notesBrutes.length ? await textesDesNotes(notesBrutes.map((n) => n.cle)) : new Map<string, string>();
    const notes = notesBrutes.map((n) => ({ genre: "NOTE" as const, id: n.cle, le: n.le, texte: (textes.get(n.cle) ?? n.texte).replace(/^Appel — [^:]*:?\s*/, "") }));
    const choisis = [...messages, ...notes].filter((e) => e.texte.trim().length > 1).sort((a, b) => b.le.getTime() - a.le.getTime()).slice(0, 2);
    if (!choisis.length) continue;
    const ouEnEst = ouEnEstParRegles(etat, planifier(etat, null, maintenant), maintenant).ouEnEst;
    const journal = (await prisma.ligneJournalSuivi.findMany({ where: { suiviId: suivi.id }, orderBy: { le: "desc" }, take: 10, select: { le: true, acteur: true, texte: true } })).map((l) => `${horodatageCourt(l.le)} · ${l.acteur} · ${l.texte}`);
    const echanges = [...etat.envois.map((e) => ({ le: e.le, t: `Lucas (${e.canal}) : ${e.texte ?? e.code ?? ""}` })), ...etat.messagesClient.map((m) => ({ le: m.le, t: `Client (${m.canal}) : ${m.texte}` }))]
      .sort((a, b) => a.le.getTime() - b.le.getTime())
      .map((x) => `${horodatageCourt(x.le)} ${x.t.slice(0, 300)}`);

    for (const evenement of choisis) {
      if (evenements.length >= nombre) break;
      let lecture: string;
      let reponse: EvenementRejoue["regles"]["reponse"] = null;
      if (evenement.genre === "MESSAGE") {
        const classe: ClasseMessage = evenement.photos ? "PHOTOS" : classerMessage(evenement.texte, { photos: evenement.photos });
        lecture = LIBELLES_CLASSE[classe];
        if (classe !== "MERCI" && classe !== "STOP") {
          const intention = classe === "PHOTOS" ? { code: "S1", variante: "defaut" } : await intentionDeReponse(etat, classe, evenement, null, null, maintenant, surcharges, etat.cible.dossierId ? LIEN_FICTIF : null, true);
          if (intention) reponse = { code: intention.code, texte: texteDeLIntention(intention as { code: string; variante: string; valeurs?: Record<string, string> }, etat.prenom, etat.piece, surcharges.textes) };
        }
      } else {
        const note = lireNote(evenement.texte, maintenant);
        const morceaux = [
          note.rappel ? `rappel le ${jourCourt(note.rappel.le)}${note.rappel.motif === "COMME_CONVENU" ? " (va signer : pause et « comme convenu »)" : ""}` : null,
          note.faits.teintesEvoquees?.length ? `teinte ${note.faits.teintesEvoquees.join(", ")}` : null,
          note.faits.decideur ? `décide avec ${note.faits.decideur}` : null,
          note.sensible ? "note sensible (Validation)" : null,
        ].filter(Boolean);
        lecture = morceaux.length ? morceaux.join(" ; ") : "rien de daté";
      }

      let ia: EvenementRejoue["ia"] = null;
      if (avecIa) {
        const resultat = await analyserParIa(
          {
            etat,
            journal,
            echanges,
            messages: evenement.genre === "MESSAGE" ? [{ id: evenement.id, le: evenement.le, texte: evenement.texte, canal: evenement.canal }] : [],
            notes: evenement.genre === "NOTE" ? [{ id: evenement.id, le: evenement.le, texte: evenement.texte }] : [],
            permis: [],
            lienEspace: null,
          },
          maintenant
        );
        if (resultat) {
          const m = resultat.messages[0];
          const n = resultat.notes[0];
          const valide = texteDeLIntention({ code: "Q6", variante: "defaut" }, etat.prenom, etat.piece, surcharges.textes);
          const controle = m?.reponse ? texteControle(m.reponse, valide, { lienAttendu: null, premierContact: false, prenom: etat.prenom, permis: [] }) : null;
          const lignes = resultat.situation && resultat.client ? { situation: resultat.situation, client: resultat.client } : null;
          const ecartsLignes = lignes ? controlerOuEnEst(lignes) : [{ detail: "Pas de lignes rendues." }];
          ia = {
            lecture: m ? LIBELLES_CLASSE[m.classe] : n ? [n.rappel ? `rappel le ${jourCourt(n.rappel.le)}` : null, n.vaSigner ? "va signer" : null, n.sensible ? "sensible" : null].filter(Boolean).join(" ; ") || "rien de daté" : "—",
            reponse: m?.reponse ?? null,
            ecart: controle && !controle.ia ? controle.ecart : null,
            ouEnEst: lignes,
            ecartOuEnEst: ecartsLignes.length ? ecartsLignes.map((e) => e.detail).join(" ") : null,
          };
        } else ia = { lecture: "IA indisponible pour cet événement", reponse: null, ecart: null, ouEnEst: null, ecartOuEnEst: null };
      }
      evenements.push({ suiviId: suivi.id, nom: etat.nom, le: evenement.le.toISOString(), genre: evenement.genre, texte: evenement.texte.slice(0, 600), regles: { lecture, reponse, ouEnEst }, ia });
    }
  }

  const appels = avecIa ? await prisma.appelIa.findMany({ where: { usage: "MESSAGERIE_ANALYSE", createdAt: { gte: debutReel } }, select: { coutEuros: true } }) : [];
  return {
    evenements,
    ia: avecIa,
    raisonSansIa: options.ia && !avecIa ? (dispo?.raison ?? "IA indisponible.") : null,
    appels: appels.length,
    cout: Math.round(appels.reduce((t, a) => t + (a.coutEuros ?? 0), 0) * 10_000) / 10_000,
  };
}
