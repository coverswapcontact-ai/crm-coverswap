/**
 * Mission 25 — écrire un message préparé à partir d'une intention : texte de la liste (ou celui que Lucas a modifié
 * dans Paramètres → SMS), variables, variante qui convient, canal (SMS, sinon mail, sinon espace), mention STOP au
 * premier SMS, personnalisation par l'IA (contrôlée), heure permise, mode. Une écriture idempotente par clé.
 */
import prisma from "@/lib/prisma";
import { lireParametre } from "@/lib/parametres/service";
import { quandLisible } from "@/lib/commercial/quand";
import { definitionMessage, estCodeMessage, estReactif, variantesDe, type CodeMessage, type ModeMessage, type VariableMessage, type VarianteMessage } from "./catalogue";
import { texteControle } from "./controleur";
import { heureEnLettres, heurePermise, jourEnLettres, momentParis, quandRappelLisible, quandReponseLisible } from "./horaires";
import { personnaliserParIa } from "./ia";
import { avecStopSiPremier, formuleBonjour, remplirTexte, texteDeLaListe, type ValeursMessage } from "./texte";
import type { CanalMessage, EtatSuivi, Intention, StatutMessage } from "./types";

/** Les textes modifiés par Lucas (Paramètres → SMS) et les modes réglés, par code de ligne (« P3 », « P3.proche »). */
export type Surcharges = { textes: Record<string, string>; modes: Record<string, ModeMessage> };

export async function lireSurcharges(): Promise<Surcharges> {
  const lignes = await prisma.modeleSms.findMany({ where: { archiveLe: null }, select: { code: true, texte: true, mode: true } });
  const textes: Record<string, string> = {};
  const modes: Record<string, ModeMessage> = {};
  for (const l of lignes) {
    const base = l.code.split(".")[0];
    if (!estCodeMessage(base)) continue;
    if (l.texte.trim()) textes[l.code] = l.texte;
    if (l.mode === "AUTO" || l.mode === "VALIDATION" || l.mode === "DESACTIVE") modes[base] = l.mode;
  }
  return { textes, modes };
}

/** Le lien de l'espace du client pour un dossier (l'espace s'ouvre s'il le faut), ou null. */
export async function lienEspaceDuDossier(dossierId: string | null): Promise<string | null> {
  if (!dossierId) return null;
  try {
    const { ouvrirEspace, lienPourLeProjet } = await import("@/lib/espace/liens");
    const { espace } = await ouvrirEspace(dossierId);
    return await lienPourLeProjet(espace);
  } catch (erreur) {
    console.error(`[messagerie] lien de l'espace du dossier ${dossierId} indisponible :`, erreur);
    return null;
  }
}

/** Le lien d'avis : la fiche Google (Paramètres), sinon l'espace du client sur « Après le chantier ». */
async function lienAvis(dossierId: string | null, maintenant: Date): Promise<string | null> {
  const google = await lireParametre("MESSAGERIE_LIEN_AVIS", maintenant);
  if (typeof google === "string" && /^https:\/\//.test(google.trim())) return google.trim();
  const espace = await lienEspaceDuDossier(dossierId);
  return espace ? `${espace}#apres` : null;
}

/** Le canal : SMS sur un mobile (pas en STOP), sinon le mail, sinon l'espace du client. */
export function canalDe(etat: EtatSuivi): { canal: CanalMessage; destinataire: string | null } | null {
  if (etat.mobile && etat.telephone && !etat.stop) return { canal: "SMS", destinataire: etat.telephone };
  if (etat.email && !etat.stop) return { canal: "MAIL", destinataire: etat.email };
  if (etat.cible.dossierId && !etat.stop) return { canal: "ESPACE", destinataire: null };
  return null;
}

export type Brouillon = {
  code: string;
  cle: string;
  canal: CanalMessage;
  destinataire: string | null;
  texte: string;
  texteValide: string;
  variante: VarianteMessage;
  prevuLe: Date;
  mode: ModeMessage;
  reponse: boolean;
  raison: string;
  ia: boolean;
  ecartControle: string | null;
  simulationId: string | null;
  sourceId: string | null;
};

/** Les variantes à essayer, dans l'ordre, quand une variable manque (heure inconnue, date pas fixée). */
const REPLIS: Partial<Record<VarianteMessage, VarianteMessage[]>> = { defaut: ["sansHeure", "sansDate"], smsDabord: ["plusieurs", "defaut"], plusieurs: ["defaut"], apresP1: ["defaut"], proche: ["defaut"] };

/**
 * Le brouillon d'une intention de la liste, ou une raison de ne pas le préparer (variable impossible à remplir, ni
 * mobile ni e-mail…). N'écrit rien.
 */
export async function rediger(etat: EtatSuivi, intention: Intention, surcharges: Surcharges, maintenant: Date): Promise<Brouillon | { refus: string }> {
  const destination = canalDe(etat);
  if (!destination) return { refus: etat.stop ? "STOP : plus aucun message" : "ni mobile, ni e-mail, ni espace" };
  const code = intention.code;
  const reponse = estReactif(code) || Boolean(intention.reponse);
  const prevuLe = heurePermise(intention.voulu.getTime() < maintenant.getTime() ? maintenant : intention.voulu, reponse ? "REACTIF" : "TRAVAIL", intention.cle);

  if (!estCodeMessage(code)) {
    const texte = intention.valeurs?.texte ?? "";
    if (!texte.trim()) return { refus: "texte vide" };
    return { code, cle: intention.cle, ...destination, texte, texteValide: texte, variante: "defaut", prevuLe, mode: "VALIDATION", reponse, raison: intention.raison, ia: false, ecartControle: null, simulationId: null, sourceId: intention.sourceId ?? null };
  }
  const definition = definitionMessage(code);
  const besoin = new Set<VariableMessage>(Object.values(definition.textes).flatMap((t) => (t.match(/\{(\w+)\}/g) ?? []).map((v) => v.slice(1, -1) as VariableMessage)));
  const valeurs: ValeursMessage = { bonjour: formuleBonjour(etat.prenom) };
  if (besoin.has("lien")) valeurs.lien = await lienEspaceDuDossier(etat.cible.dossierId);
  if (besoin.has("lien_avis")) valeurs.lien_avis = await lienAvis(etat.cible.dossierId, maintenant);
  if (besoin.has("quand_rappel")) valeurs.quand_rappel = quandRappelLisible(prevuLe);
  if (besoin.has("quand_reponse")) valeurs.quand_reponse = quandReponseLisible(maintenant);
  if (besoin.has("quand")) valeurs.quand = intention.valeurs?.quand ?? (etat.rappel ? quandLisible(etat.rappel.le, maintenant) : null);
  if (etat.dossier?.dateChantier) {
    valeurs.date_chantier = jourEnLettres(momentParis(etat.dossier.dateChantier).jour);
    if (etat.dossier.heureChantier != null) valeurs.heure = heureEnLettres(etat.dossier.heureChantier);
  }
  if (intention.valeurs?.nombre) valeurs.nombre = intention.valeurs.nombre;
  if (intention.valeurs?.creneau_1) valeurs.creneau_1 = intention.valeurs.creneau_1;
  if (intention.valeurs?.creneau_2) valeurs.creneau_2 = intention.valeurs.creneau_2;

  // La variante voulue, puis ses replis si une variable manque.
  const possibles = variantesDe(code);
  const essais = [intention.variante, ...(REPLIS[intention.variante] ?? []), "defaut" as VarianteMessage].filter((v, i, t) => possibles.includes(v) && t.indexOf(v) === i);
  let choisie: { variante: VarianteMessage; texte: string } | null = null;
  let manque: VariableMessage[] = [];
  for (const variante of essais) {
    const { texte, manquantes } = remplirTexte(texteDeLaListe(code, variante, surcharges.textes), valeurs, etat.piece);
    if (!manquantes.length) {
      choisie = { variante, texte };
      break;
    }
    manque = manquantes;
  }
  if (!choisie) return { refus: `variable impossible à remplir : {${manque.join("}, {")}}` };

  let texteValide = choisie.texte;
  if (destination.canal === "SMS") texteValide = avecStopSiPremier(texteValide, etat.premierSms && !/\bstop\b/i.test(texteValide));
  let texte = texteValide;
  let ia = false;
  let ecart: string | null = null;
  if (definition.personnalisable) {
    const propose = await personnaliserParIa({ code, texteValide: choisie.texte, etat }, maintenant);
    if (propose && propose.trim() !== choisie.texte.trim()) {
      const controle = texteControle(propose, choisie.texte, {
        lienAttendu: definition.lien === "ESPACE" ? valeurs.lien ?? null : definition.lien === "AVIS" ? valeurs.lien_avis ?? null : null,
        premierContact: Boolean(definition.premierContact),
        prenom: etat.prenom,
        permis: Object.values(valeurs).filter((v): v is string => typeof v === "string"),
      });
      ia = controle.ia;
      ecart = controle.ecart;
      if (controle.ia) texte = destination.canal === "SMS" ? avecStopSiPremier(controle.texte, etat.premierSms) : controle.texte;
    }
  }
  const mode: ModeMessage = surcharges.modes[code] ?? (etat.validationForcee || etat.faits.sensible ? "VALIDATION" : definition.mode);
  return {
    code,
    cle: intention.cle,
    ...destination,
    texte,
    texteValide,
    variante: choisie.variante,
    prevuLe,
    mode: mode === "AUTO" && (etat.validationForcee || etat.faits.sensible) ? "VALIDATION" : mode,
    reponse,
    raison: intention.raison,
    ia,
    ecartControle: ecart,
    simulationId: intention.simulationId ?? null,
    sourceId: intention.sourceId ?? null,
  };
}

/** Écrit le message (une fois par clé). Rend l'identifiant, ou null si la clé existait déjà. */
export async function ecrireMessage(suiviId: string, brouillon: Brouillon, statut: StatutMessage, options: { douceur?: boolean; motif?: string | null } = {}): Promise<string | null> {
  try {
    const cree = await prisma.messagePrepare.create({
      data: {
        suiviId,
        code: brouillon.code,
        cle: brouillon.cle,
        canal: brouillon.canal,
        destinataire: brouillon.destinataire,
        texte: brouillon.texte,
        texteValide: brouillon.texteValide,
        variante: brouillon.variante,
        prevuLe: brouillon.prevuLe,
        statut,
        mode: brouillon.mode,
        reponse: brouillon.reponse,
        douceur: Boolean(options.douceur),
        raison: brouillon.raison,
        motif: options.motif ?? null,
        ia: brouillon.ia,
        ecartControle: brouillon.ecartControle,
        simulationId: brouillon.simulationId,
        sourceId: brouillon.sourceId,
      },
    });
    return cree.id;
  } catch (erreur) {
    if ((erreur as { code?: string }).code === "P2002") return null;
    throw erreur;
  }
}

export function libelleDuCode(code: string): string {
  if (code === "REPONSE") return "Réponse proposée";
  if (code === "LIBRE") return "Message libre";
  return estCodeMessage(code) ? `${code} · ${definitionMessage(code as CodeMessage).libelle}` : code;
}
