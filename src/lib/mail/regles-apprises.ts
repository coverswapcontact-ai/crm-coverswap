import prisma from "@/lib/prisma";
import { proposer } from "@/lib/validation/service";
import { contactParAdresse } from "./boite";
import type { ActionRegle } from "./tri";

/**
 * Règles apprises (mission 9) : trois gestes identiques à la main sur la même
 * adresse — rangée trois fois, classée trois fois pareil — et le CRM PROPOSE
 * une règle d'expéditeur, à valider dans l'onglet Mail, Paramètres ou par
 * Claude. Il ne la pose jamais seul. Rattacher une adresse ne demande pas de
 * règle : l'adresse va sur la fiche, ses prochains mails sont reconnus seuls.
 */

export const SEUIL_GESTES = 3;
export const TYPE_REGLE_TRI = "REGLE_TRI";

export type GestesAdresse = { adresse: string; ranges: number; administratif: number; humains: number };

/** La règle qu'appellent ces gestes (pur) : au seuil, une seule décision, la plus répétée. */
export function regleAppelee(g: GestesAdresse): { action: ActionRegle; motif: string } | null {
  const candidats: { action: ActionRegle; nombre: number; motif: string }[] = [
    { action: "RANGER", nombre: g.ranges, motif: `Rangé ${g.ranges} fois à la main` },
    { action: "ADMINISTRATIF", nombre: g.administratif, motif: `Classé ${g.administratif} fois en administratif` },
    { action: "NE_JAMAIS_RANGER", nombre: g.humains, motif: `Classé ${g.humains} fois comme un mail à lire` },
  ];
  const meilleur = candidats.filter((c) => c.nombre >= SEUIL_GESTES).sort((a, b) => b.nombre - a.nombre)[0];
  return meilleur ? { action: meilleur.action, motif: meilleur.motif } : null;
}

async function gestesSur(adresse: string): Promise<GestesAdresse> {
  const messages = await prisma.message.findMany({ where: { canal: "EMAIL", sens: "ENTRANT", de: adresse }, select: { rangePar: true, classePar: true, classe: true } });
  const aLaMain = (v: string | null) => v === "LUCAS" || v === "ASSISTANT";
  return {
    adresse,
    ranges: messages.filter((m) => aLaMain(m.rangePar)).length,
    administratif: messages.filter((m) => aLaMain(m.classePar) && m.classe === "ADMINISTRATIF").length,
    humains: messages.filter((m) => aLaMain(m.classePar) && (m.classe === "HUMAIN" || m.classe === "CLIENT")).length,
  };
}

/** Après un geste à la main sur un mail de cette adresse : faut-il proposer une règle ? Rend la proposition créée, ou null. */
export async function detecterRegleApprise(adresseBrute: string): Promise<{ propositionId: string; action: ActionRegle } | null> {
  const adresse = adresseBrute.trim().toLowerCase();
  if (!adresse.includes("@")) return null;
  const gestes = await gestesSur(adresse);
  const regle = regleAppelee(gestes);
  if (!regle) return null;
  // Déjà décidé, ou déjà proposé : rien.
  const existante = await prisma.regleExpediteur.findFirst({ where: { cible: adresse, archiveLe: null } });
  if (existante) return null;
  // Un client ne se range jamais d'office.
  if (regle.action === "RANGER" && (await contactParAdresse(adresse))?.type === "CLIENT") return null;
  const { id, creee } = await proposer({
    type: TYPE_REGLE_TRI,
    titre: `${regle.action === "RANGER" ? "Toujours ranger" : regle.action === "ADMINISTRATIF" ? "Toujours classer en administratif" : "Ne jamais ranger"} les mails de ${adresse}`,
    resume: `${regle.motif} : le CRM propose d'en faire une règle. Réversible dans Paramètres → Mail.`,
    contenu: { cible: adresse, action: regle.action, motif: regle.motif, gestes: gestes.ranges + gestes.administratif + gestes.humains, origine: "GESTES" },
    cleUnicite: `regle-tri:${adresse}:${regle.action}`,
  });
  return creee ? { propositionId: id, action: regle.action } : null;
}
