import { createHash, randomBytes } from "node:crypto";
import { z } from "zod/v4";
import prisma from "@/lib/prisma";
import { alerter } from "@/lib/alertes/canaux";
import { ErreurMetier } from "@/lib/commun/erreurs";
import { jourParis } from "@/lib/dossiers/dates";
import { avecActeur } from "@/lib/journal/contexte";
import type { ContexteOutil, DefinitionOutil, NiveauOutil, ResultatOutil } from "./definition";

/**
 * Le moteur qui exécute un outil de l'assistant (mission 8), quel que soit
 * l'appelant (serveur MCP aujourd'hui, assistant intégré demain) :
 * validation des paramètres, garde-fous (confirmation des actions sensibles
 * et des actions en masse, plafond d'écritures par heure), journal de chaque
 * appel dans la session, et acteur `ASSISTANT:claude` sur toute écriture,
 * avec la commande d'origine.
 */

export const ACTEUR_ASSISTANT = "ASSISTANT:claude";
export const PLAFOND_ECRITURES_PAR_HEURE = 60;
/** Au-delà de ce nombre d'éléments, une action devient sensible (aperçu, puis confirmation). */
export const SEUIL_MASSE = 3;
const CONFIRMATION_MINUTES = 15;
const PARAMETRES_MAX = 4000;

/** Paramètres communs ajoutés à tout outil d'écriture : la commande de Lucas, et le jeton de confirmation. */
export const schemaCommun = z.object({
  commande: z.string().max(500).nullable().optional().describe("La phrase de Lucas, telle qu'il l'a dite : elle entre dans le journal du CRM."),
  confirmation: z.string().max(64).nullable().optional().describe("Action sensible : le jeton rendu par l'aperçu, pour exécuter au second appel."),
});

export type Session = { id: string; utilisateur: string };

/** Une session par jeton et par jour : c'est elle que l'écran Tâches de fond montre. */
export async function ouvrirSession(entree: { jetonId: string | null; clientNom: string | null; utilisateur: string; maintenant?: Date }): Promise<Session> {
  const maintenant = entree.maintenant ?? new Date();
  const jour = jourParis(maintenant);
  const jetonId = entree.jetonId ?? "sans-jeton";
  const session = await prisma.sessionAssistant.upsert({
    where: { jour_jetonId: { jour, jetonId } },
    create: { jour, jetonId, clientNom: entree.clientNom },
    update: { ...(entree.clientNom ? { clientNom: entree.clientNom } : {}) },
    select: { id: true },
  });
  return { id: session.id, utilisateur: entree.utilisateur };
}

const empreinteDe = (outil: string, entree: unknown) => createHash("sha256").update(`${outil}\n${JSON.stringify(entree)}`).digest("hex");

function tronquer(valeur: unknown): string {
  const json = JSON.stringify(valeur ?? {});
  return json.length > PARAMETRES_MAX ? `${json.slice(0, PARAMETRES_MAX)}…` : json;
}

async function journaliser(session: Session, outil: string, niveau: NiveauOutil, parametres: unknown, commande: string | null, statut: "FAIT" | "APERCU" | "REFUSE" | "ERREUR", resume: string | null, erreur: string | null, debut: number, ecriture: boolean): Promise<void> {
  await prisma.$transaction([
    prisma.appelOutil.create({ data: { sessionId: session.id, outil, niveau, parametres: tronquer(parametres), commande: commande?.slice(0, 500) ?? null, statut, resume: resume?.slice(0, 600) ?? null, erreur: erreur?.slice(0, 600) ?? null, dureeMs: Date.now() - debut } }),
    prisma.sessionAssistant.update({ where: { id: session.id }, data: { dernierAppelLe: new Date(), appels: { increment: 1 }, ...(ecriture && statut === "FAIT" ? { ecritures: { increment: 1 } } : {}) } }),
  ]).catch((e) => console.error("[assistant] journal :", e));
}

async function ecrituresDeLHeure(maintenant: Date): Promise<number> {
  return prisma.appelOutil.count({ where: { niveau: { not: "LECTURE" }, statut: "FAIT", createdAt: { gte: new Date(maintenant.getTime() - 3_600_000) } } });
}

/** Le plafond est atteint : refus, et une alerte (une seule par heure). */
async function refuserAuPlafond(maintenant: Date): Promise<never> {
  const deja = await prisma.appelOutil.count({ where: { statut: "REFUSE", erreur: { startsWith: "Plafond" }, createdAt: { gte: new Date(maintenant.getTime() - 3_600_000) } } });
  if (deja === 0) {
    await alerter(
      { titre: "Assistant : plafond d'écritures atteint", texte: `Plus de ${PLAFOND_ECRITURES_PAR_HEURE} écritures en une heure depuis l'application Claude : les suivantes sont refusées jusqu'à la prochaine heure. Vérifier le journal (Tâches de fond → Assistant).`, lien: "/taches", urgence: 4 },
      { origine: "assistant-plafond" }
    ).catch(() => undefined);
  }
  throw new ErreurMetier(`Plafond de sécurité : plus de ${PLAFOND_ECRITURES_PAR_HEURE} écritures en une heure. Rien de plus ne sera fait avant la prochaine heure ; Lucas est prévenu.`, 429);
}

/**
 * Exécute un outil avec tous les garde-fous. Rend un résultat lisible ; une
 * erreur métier (refus, paramètre invalide, ambiguïté) est rendue comme un
 * texte, jamais comme une exception : Claude doit pouvoir la lire.
 */
export async function executerOutil<E extends Record<string, unknown>>(definition: DefinitionOutil<E>, entreeBrute: unknown, session: Session, maintenant: Date = new Date()): Promise<ResultatOutil> {
  const debut = Date.now();
  const brut = (entreeBrute && typeof entreeBrute === "object" ? entreeBrute : {}) as Record<string, unknown>;
  const commun = schemaCommun.safeParse(brut);
  const commande = commun.success ? (commun.data.commande?.trim() || null) : null;
  const confirmation = commun.success ? (commun.data.confirmation?.trim() || null) : null;
  const { commande: _c, confirmation: _j, ...reste } = brut;
  void _c;
  void _j;
  const ecriture = definition.niveau !== "LECTURE";
  const contexte: ContexteOutil = { sessionId: session.id, commande, utilisateur: session.utilisateur, maintenant };

  const validation = definition.schema.safeParse(reste);
  if (!validation.success) {
    const message = validation.error.issues.map((i) => `${i.path.join(".") || "paramètres"} : ${i.message}`).join(" ; ");
    await journaliser(session, definition.nom, definition.niveau, reste, commande, "REFUSE", null, `Paramètres invalides — ${message}`, debut, ecriture);
    return { texte: `Paramètres invalides pour « ${definition.titre} » : ${message}.` };
  }
  const entree = validation.data;

  try {
    const masse = definition.masse?.(entree) ?? 0;
    const sensible = definition.niveau === "SENSIBLE" || masse > SEUIL_MASSE || Boolean(definition.sensible?.(entree));
    if (sensible && !confirmation) {
      const apercu = definition.apercu ? await definition.apercu(entree, contexte) : `Je vais exécuter « ${definition.titre} » avec ces paramètres : ${JSON.stringify(entree)}.`;
      const jeton = randomBytes(9).toString("base64url");
      const expireLe = new Date(maintenant.getTime() + CONFIRMATION_MINUTES * 60_000);
      await prisma.confirmationAssistant.create({ data: { id: jeton, outil: definition.nom, empreinte: empreinteDe(definition.nom, entree), apercu: apercu.slice(0, 4000), expireLe, sessionId: session.id } });
      const texte = `${apercu}\n\nRien n'a été fait. Si Lucas confirme, rappelle « ${definition.nom} » avec les mêmes paramètres et confirmation = « ${jeton} » (valable ${CONFIRMATION_MINUTES} minutes).`;
      await journaliser(session, definition.nom, definition.niveau, entree, commande, "APERCU", apercu, null, debut, ecriture);
      return { texte, confirmation: { jeton, expireLe: expireLe.toISOString() } };
    }
    if (sensible && confirmation) {
      const ligne = await prisma.confirmationAssistant.findUnique({ where: { id: confirmation } });
      if (!ligne || ligne.outil !== definition.nom) throw new ErreurMetier("Jeton de confirmation inconnu pour cet outil : refais l'aperçu.", 400);
      if (ligne.utiliseLe) throw new ErreurMetier("Ce jeton de confirmation a déjà servi : refais l'aperçu.", 409);
      if (ligne.expireLe < maintenant) throw new ErreurMetier("Jeton de confirmation expiré (15 minutes) : refais l'aperçu.", 409);
      if (ligne.empreinte !== empreinteDe(definition.nom, entree)) throw new ErreurMetier("Les paramètres ont changé depuis l'aperçu : refais l'aperçu avec les nouveaux.", 409);
      await prisma.confirmationAssistant.update({ where: { id: ligne.id }, data: { utiliseLe: maintenant } });
    }
    if (ecriture && (await ecrituresDeLHeure(maintenant)) >= PLAFOND_ECRITURES_PAR_HEURE) await refuserAuPlafond(maintenant);

    const origine = `mcp:${definition.nom}${commande ? ` — ${commande.slice(0, 160)}` : ""}`;
    const resultat = await avecActeur({ acteur: ACTEUR_ASSISTANT, origine, requete: session.id }, () => definition.executer(entree, contexte));
    await journaliser(session, definition.nom, definition.niveau, entree, commande, "FAIT", resultat.texte, null, debut, ecriture);
    return resultat;
  } catch (erreur) {
    if (erreur instanceof ErreurMetier) {
      await journaliser(session, definition.nom, definition.niveau, entree, commande, "REFUSE", null, erreur.message, debut, ecriture);
      return { texte: `Refusé : ${erreur.message}` };
    }
    const message = erreur instanceof Error ? erreur.message : String(erreur);
    console.error(`[assistant] ${definition.nom} :`, erreur);
    await journaliser(session, definition.nom, definition.niveau, entree, commande, "ERREUR", null, message, debut, ecriture);
    return { texte: `L'outil « ${definition.titre} » a échoué : ${message}. Rien n'est perdu ; réessaie ou dis-le à Lucas.` };
  }
}

/* ── Lecture pour l'écran Tâches de fond ────────────────────────────── */

export type SessionVue = { id: string; jour: string; clientNom: string | null; dernierAppelLe: string | null; appels: number; ecritures: number; derniers: { le: string; outil: string; niveau: string; statut: string; commande: string | null; resume: string | null; erreur: string | null; dureeMs: number }[] };

export async function sessionsRecentes(limite = 10): Promise<SessionVue[]> {
  const sessions = await prisma.sessionAssistant.findMany({ orderBy: { updatedAt: "desc" }, take: limite });
  const appels = await prisma.appelOutil.findMany({ where: { sessionId: { in: sessions.map((s) => s.id) } }, orderBy: { createdAt: "desc" }, take: 300 });
  return sessions.map((s) => ({
    id: s.id,
    jour: s.jour,
    clientNom: s.clientNom,
    dernierAppelLe: s.dernierAppelLe?.toISOString() ?? null,
    appels: s.appels,
    ecritures: s.ecritures,
    derniers: appels
      .filter((a) => a.sessionId === s.id)
      .slice(0, 40)
      .map((a) => ({ le: a.createdAt.toISOString(), outil: a.outil, niveau: a.niveau, statut: a.statut, commande: a.commande, resume: a.resume, erreur: a.erreur, dureeMs: a.dureeMs })),
  }));
}
