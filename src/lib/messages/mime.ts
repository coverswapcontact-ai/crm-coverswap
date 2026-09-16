import { randomBytes } from "node:crypto";

/**
 * Construction d'un mail MIME (RFC 5322 / 2045) pour l'envoi par la boîte
 * Gmail : texte en UTF-8, pièces jointes, en-têtes de réponse (fil conservé).
 * Aucun retour à la ligne n'entre dans un en-tête : pas d'injection d'en-tête
 * possible depuis un objet ou un nom.
 */

export type PieceMime = { nom: string; type: string; contenu: Buffer };

export type MailMime = {
  de: string;
  deNom?: string | null;
  a: string;
  objet: string;
  texte: string;
  repondreA?: string | null;
  enReponseA?: string | null;
  references?: string | null;
  pieces?: PieceMime[];
};

const sansRetour = (valeur: string) => valeur.replace(/[\r\n]+/g, " ").trim();

/** Mot encodé (RFC 2047) si la valeur n'est pas en ASCII imprimable ; découpé pour rester sous 76 caractères. */
export function encoderEnTete(valeur: string): string {
  const propre = sansRetour(valeur);
  if (/^[\x20-\x7e]*$/.test(propre)) return propre;
  const mots: string[] = [];
  let courant = "";
  for (const caractere of propre) {
    // 45 octets donnent 60 caractères en base64 : le mot encodé reste sous 75.
    if (Buffer.byteLength(courant + caractere, "utf8") > 45) {
      mots.push(courant);
      courant = "";
    }
    courant += caractere;
  }
  if (courant) mots.push(courant);
  return mots.map((mot) => `=?UTF-8?B?${Buffer.from(mot, "utf8").toString("base64")}?=`).join("\r\n ");
}

function adresseAvecNom(adresse: string, nom?: string | null): string {
  const propre = sansRetour(adresse);
  if (!nom) return propre;
  const nomPropre = sansRetour(nom);
  const encode = /^[\x20-\x7e]*$/.test(nomPropre) ? `"${nomPropre.replace(/["\\]/g, "")}"` : encoderEnTete(nomPropre);
  return `${encode} <${propre}>`;
}

function base64EnLignes(contenu: Buffer): string {
  return (contenu.toString("base64").match(/.{1,76}/g) ?? []).join("\r\n");
}

/** Nom de fichier en paramètre MIME (RFC 2231) : accents et espaces permis. */
function parametreNom(nom: string): string {
  const propre = sansRetour(nom).replace(/["\\]/g, "_") || "piece-jointe";
  const ascii = propre.replace(/[^\x20-\x7e]/g, "_");
  return `filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(propre)}`;
}

export function construireMime(mail: MailMime): Buffer {
  const entetes = [
    `From: ${adresseAvecNom(mail.de, mail.deNom)}`,
    `To: ${sansRetour(mail.a)}`,
    `Subject: ${encoderEnTete(mail.objet)}`,
    "MIME-Version: 1.0",
  ];
  if (mail.repondreA && mail.repondreA.toLowerCase() !== mail.de.toLowerCase()) entetes.push(`Reply-To: ${sansRetour(mail.repondreA)}`);
  if (mail.enReponseA) {
    entetes.push(`In-Reply-To: ${sansRetour(mail.enReponseA)}`);
    entetes.push(`References: ${sansRetour([mail.references, mail.enReponseA].filter(Boolean).join(" "))}`);
  }

  const texte = `Content-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${base64EnLignes(Buffer.from(mail.texte.replace(/\r?\n/g, "\r\n"), "utf8"))}`;
  if (!mail.pieces?.length) return Buffer.from(`${entetes.join("\r\n")}\r\n${texte}\r\n`, "utf8");

  const separateur = `coverswap-${randomBytes(12).toString("hex")}`;
  const parties = [
    texte,
    ...mail.pieces.map(
      (piece) =>
        `Content-Type: ${sansRetour(piece.type)}\r\nContent-Disposition: attachment; ${parametreNom(piece.nom)}\r\nContent-Transfer-Encoding: base64\r\n\r\n${base64EnLignes(piece.contenu)}`
    ),
  ];
  return Buffer.from(
    `${entetes.join("\r\n")}\r\nContent-Type: multipart/mixed; boundary="${separateur}"\r\n\r\n${parties.map((partie) => `--${separateur}\r\n${partie}\r\n`).join("")}--${separateur}--\r\n`,
    "utf8"
  );
}
