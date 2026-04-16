// ============================================================================
// GMAIL HELPER — Génération d'URLs Gmail compose préremplies
// ============================================================================
// Pas d'OAuth requis : on ouvre Gmail web avec les champs déjà remplis.
// Pour les pièces jointes : on ouvre le PDF en parallèle, l'utilisateur le
// télécharge et le glisse-dépose dans Gmail.
// ============================================================================

import { formatEuros } from "@/lib/utils";

export function buildGmailComposeUrl({
  to,
  subject,
  body,
  cc,
}: {
  to?: string;
  subject: string;
  body: string;
  cc?: string;
}): string {
  const params = new URLSearchParams();
  params.set("view", "cm");
  params.set("fs", "1");
  if (to) params.set("to", to);
  if (cc) params.set("cc", cc);
  params.set("su", subject);
  params.set("body", body);
  return `https://mail.google.com/mail/?${params.toString()}`;
}

// ----------------------------------------------------------------------------
// Templates métier CoverSwap
// ----------------------------------------------------------------------------

export function emailDevisTemplate({
  prenomClient,
  numero,
  montant,
  acompte30,
  objet,
  expiresAt,
}: {
  prenomClient: string;
  numero: string;
  montant: number;
  acompte30: number;
  objet?: string | null;
  expiresAt: Date | string;
}) {
  const exp = new Date(expiresAt);
  const expFR = `${exp.getDate()}/${exp.getMonth() + 1}/${exp.getFullYear()}`;
  const objetTxt = objet ? ` pour votre projet "${objet}"` : "";

  const subject = `Votre devis CoverSwap n°${numero}`;

  const body = `Bonjour ${prenomClient},

Suite à notre échange, je vous transmets en pièce jointe le devis n°${numero}${objetTxt}.

Récapitulatif :
• Montant total TTC : ${formatEuros(montant)}
• Acompte à la signature (30%) : ${formatEuros(acompte30)}
• Devis valable jusqu'au ${expFR}

Pour valider votre commande, il vous suffit de :
1. Signer le devis avec la mention "Bon pour accord"
2. Régler l'acompte de ${formatEuros(acompte30)} par virement, chèque ou espèces

Coordonnées bancaires :
IBAN : FR76 1610 6700 2096 0145 0427 085
BIC : AGRIFRPP861

Je reste à votre disposition pour toute question.

Cordialement,

Lucas Villemin
CoverSwap — Rénovation adhésive premium
06 70 35 28 69
coverswap.contact@gmail.com
73 rue Simone Veil, 34470 Pérols`;

  return { subject, body };
}

export function emailRelanceDevisTemplate({
  prenomClient,
  numero,
}: {
  prenomClient: string;
  numero: string;
}) {
  return {
    subject: `Devis n°${numero} — Suivi`,
    body: `Bonjour ${prenomClient},

Je me permets de revenir vers vous concernant le devis n°${numero} que je vous ai transmis récemment.

Avez-vous eu l'occasion d'en prendre connaissance ? Je reste à votre disposition pour toute précision ou ajustement.

Très cordialement,

Lucas Villemin
CoverSwap
06 70 35 28 69`,
  };
}

export function emailFactureTemplate({
  prenomClient,
  numero,
  montant,
  type,
}: {
  prenomClient: string;
  numero: string;
  montant: number;
  type: "ACOMPTE" | "SOLDE" | "TOTAL";
}) {
  const labelType =
    type === "ACOMPTE" ? "facture d'acompte" : type === "SOLDE" ? "facture de solde" : "facture";
  return {
    subject: `${labelType.charAt(0).toUpperCase() + labelType.slice(1)} n°${numero} — CoverSwap`,
    body: `Bonjour ${prenomClient},

Veuillez trouver ci-joint la ${labelType} n°${numero} d'un montant de ${formatEuros(montant)}.

Coordonnées bancaires :
IBAN : FR76 1610 6700 2096 0145 0427 085
BIC : AGRIFRPP861

Cordialement,

Lucas Villemin
CoverSwap
06 70 35 28 69`,
  };
}
