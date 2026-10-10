/**
 * Mission 25 (lot 3) — les textes et les modes de la liste, tels que Lucas les règle dans Paramètres → SMS.
 *
 * Une ligne `ModeleSms` par texte modifié (code « P3 » pour le texte par défaut, « P3.proche » pour une variante) et
 * par mode réglé (sur la ligne du code). Une ligne au texte vide ne porte qu'un mode : le texte validé s'applique, et
 * suit la liste si elle change. « Revenir au texte de départ » vide le texte, il ne supprime rien. Le moteur lit le
 * tout par `lireSurcharges` (redaction.ts).
 */
import prisma from "@/lib/prisma";
import { ErreurMetier } from "@/lib/commun/erreurs";
import {
  CATALOGUE_MESSAGES,
  LIBELLES_VARIANTE,
  codeModele,
  definitionMessage,
  estCodeMessage,
  lireCodeModele,
  variantesDe,
  type CodeMessage,
  type GroupeMessage,
  type ModeMessage,
  type NatureMessage,
  type VariableMessage,
  type VarianteMessage,
} from "./catalogue";
import { apercuDuTexte, texteDeDepart, variablesPermises } from "./apercu";

export type TexteDeLaListe = {
  /** Code de la ligne : « P3 », « P3.proche ». */
  cle: string;
  variante: VarianteMessage;
  libelle: string;
  /** Le texte validé le 10/10. */
  depart: string;
  /** Le texte en vigueur (celui de Lucas s'il l'a modifié). */
  texte: string;
  modifie: boolean;
  variables: VariableMessage[];
};

export type MessageDeLaListe = {
  code: CodeMessage;
  groupe: GroupeMessage;
  libelle: string;
  quand: string;
  nature: NatureMessage;
  /** Le mode validé le 10/10 (mode Android). */
  modeListe: Exclude<ModeMessage, "DESACTIVE">;
  /** Le mode en vigueur. */
  mode: ModeMessage;
  textes: TexteDeLaListe[];
};

const ordreDe = (code: string) => 1000 + CATALOGUE_MESSAGES.findIndex((m) => m.code === code);

export async function listerMessagesDeLaListe(): Promise<MessageDeLaListe[]> {
  const lignes = await prisma.modeleSms.findMany({ where: { archiveLe: null }, select: { code: true, texte: true, mode: true } });
  const parCle = new Map(lignes.map((l) => [l.code, l]));
  return CATALOGUE_MESSAGES.map((m) => {
    const code = m.code as CodeMessage;
    const mode = parCle.get(code)?.mode;
    return {
      code,
      groupe: m.groupe,
      libelle: m.libelle,
      quand: m.quand,
      nature: m.nature,
      modeListe: m.mode,
      mode: mode === "AUTO" || mode === "VALIDATION" || mode === "DESACTIVE" ? mode : m.mode,
      textes: variantesDe(code).map((variante) => {
        const cle = codeModele(code, variante);
        const depart = texteDeDepart(code, variante);
        const ecrit = parCle.get(cle)?.texte.trim() ?? "";
        return { cle, variante, libelle: LIBELLES_VARIANTE[variante], depart, texte: ecrit || depart, modifie: Boolean(ecrit) && ecrit !== depart, variables: variablesPermises(code, variante) };
      }),
    };
  });
}

/** La ligne d'un code de la liste (créée vide au besoin : elle ne porte alors ni texte ni mode). */
async function ligneDe(cle: string, libelle: string) {
  return prisma.modeleSms.upsert({ where: { code: cle }, update: {}, create: { code: cle, libelle: libelle.slice(0, 120), texte: "", automatique: false, ordre: ordreDe(cle.split(".")[0]) } });
}

/**
 * Le texte d'un code ou d'une variante. `null`, ou le texte de départ : revenir au texte validé (la ligne garde un texte
 * vide). Refuse ce qui ne pourrait pas partir juste (variable inconnue, lien manquant) ; le reste est signalé à l'écran.
 */
export async function modifierTexteDeLaListe(cle: string, texte: string | null): Promise<MessageDeLaListe> {
  const lu = lireCodeModele(cle);
  if (!lu) throw new ErreurMetier("Message de la liste inconnu.", 404);
  const definition = definitionMessage(lu.code);
  const propre = (texte ?? "").trim();
  const depart = texteDeDepart(lu.code, lu.variante);
  if (propre && propre !== depart) {
    const { erreurs } = apercuDuTexte(lu.code, lu.variante, propre);
    if (erreurs.length) throw new ErreurMetier(erreurs.join(" "), 400);
  }
  const ligne = await ligneDe(cle, `${lu.code} — ${definition.libelle}${lu.variante === "defaut" ? "" : ` (${LIBELLES_VARIANTE[lu.variante]})`}`);
  const nouveau = propre === depart ? "" : propre;
  if (ligne.texte !== nouveau) await prisma.modeleSms.update({ where: { id: ligne.id }, data: { texte: nouveau } });
  return (await listerMessagesDeLaListe()).find((m) => m.code === lu.code)!;
}

/** Le mode d'un code (mode Android ; « Désactivé » vaut aussi en mode Manuel : rien n'est préparé). `null` : celui de la liste. */
export async function modifierModeDeLaListe(code: string, mode: ModeMessage | null): Promise<MessageDeLaListe> {
  if (!estCodeMessage(code)) throw new ErreurMetier("Message de la liste inconnu.", 404);
  const definition = definitionMessage(code);
  if (definition.nature === "RAPIDE") throw new ErreurMetier("Une réponse rapide part seulement quand tu la choisis : elle n'a pas de mode.", 400);
  const ligne = await ligneDe(code, `${code} — ${definition.libelle}`);
  const nouveau = mode === definition.mode ? null : mode;
  if (ligne.mode !== nouveau) await prisma.modeleSms.update({ where: { id: ligne.id }, data: { mode: nouveau } });
  return (await listerMessagesDeLaListe()).find((m) => m.code === code)!;
}
