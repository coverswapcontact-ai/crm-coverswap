import { Prisma } from "@prisma/client";
import { ErreurMetier } from "@/lib/commun/erreurs";
import { MESSAGE_JOURNAL_IMMUABLE, MODELES_IMMUABLES, TABLE_JOURNAL, messageSuppression, messagesRefus } from "./declencheurs";

/** Écriture refusée par la base (déclencheur) : son message, en français, part tel quel à l'interface. */
export class EcritureRefusee extends ErreurMetier {
  constructor(message: string) {
    super(message, 409);
    this.name = "EcritureRefusee";
  }
}

const OPERATIONS_MODIFICATION = new Set(["update", "updateMany", "upsert"]);

const MESSAGES_CONNUS = [
  MESSAGE_JOURNAL_IMMUABLE,
  ...[...MODELES_IMMUABLES.keys()].flatMap(messagesRefus),
  ...Prisma.dmmf.datamodel.models.map((modele) => messageSuppression(modele.name)),
];

// Champs par lesquels une écriture pose un lien : relations et clés étrangères.
const CHAMPS_DE_LIEN = new Map(
  Prisma.dmmf.datamodel.models.map((modele) => [
    modele.name,
    new Set(modele.fields.flatMap((champ) => (champ.kind === "object" ? [champ.name, ...(champ.relationFromFields ?? [])] : []))),
  ])
);

/** Message d'un déclencheur, quand le pilote le transmet (SQL brut, pilote libsql). */
function messageTransmis(texte: string): string | null {
  const brut = /Code: `1811`\. Message: `([\s\S]+)`\s*$/.exec(texte);
  if (brut) return brut[1];
  return MESSAGES_CONNUS.find((message) => texte.includes(message)) ?? null;
}

/**
 * Traduit le refus d'un déclencheur en EcritureRefusee.
 *
 * Le moteur SQLite de Prisma rapporte toute erreur levée par un déclencheur
 * (RAISE) comme « Foreign key constraint violated », sans son message. Pour une
 * opération de modèle, le message est donc retrouvé depuis la règle du modèle :
 * une modification refusée sur un modèle immuable, qui ne pose aucun lien, ne
 * peut venir que de son déclencheur. Les autres erreurs repartent inchangées.
 */
export function traduireRefus(erreur: unknown, modele?: string, operation?: string, args?: unknown): unknown {
  if (!(erreur instanceof Error) || erreur instanceof ErreurMetier) return erreur;
  const transmis = messageTransmis(erreur.message);
  if (transmis) return new EcritureRefusee(transmis);
  if (!(erreur instanceof Prisma.PrismaClientKnownRequestError) || erreur.code !== "P2003" || !modele || !operation) {
    return erreur;
  }

  if (modele === TABLE_JOURNAL) return new EcritureRefusee(MESSAGE_JOURNAL_IMMUABLE);
  if (MODELES_IMMUABLES.has(modele) && OPERATIONS_MODIFICATION.has(operation)) {
    const donnees = (args as { data?: unknown; update?: unknown } | undefined)?.[operation === "upsert" ? "update" : "data"];
    const liens = CHAMPS_DE_LIEN.get(modele);
    const poseUnLien = typeof donnees === "object" && donnees !== null && Object.keys(donnees).some((champ) => liens?.has(champ));
    // Plusieurs règles possibles (colonnes figées, changements interdits) : toutes sont citées.
    const messages = messagesRefus(modele);
    if (poseUnLien) messages.push("Un lien pointe vers un enregistrement introuvable.");
    return new EcritureRefusee(messages.join(" Ou : "));
  }
  return new EcritureRefusee("Enregistrement impossible : un lien pointe vers un enregistrement introuvable. Recharge la page puis réessaie.");
}
