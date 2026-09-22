import { estAdresseAutomatique } from "@/lib/messages/texte";

/**
 * Le tri de la boîte (mission 7). Fonction pure, testée : c'est ici que se
 * décide ce qui est rangé sans que Lucas le voie, et ce qui reste sous ses yeux.
 *
 * Quatre classes :
 * - CLIENT : un client, un lead ou un prospect connu (adresse exacte, ou fil
 *   déjà rattaché) ;
 * - ADMINISTRATIF : URSSAF, impôts, banque, assurance, bailleur, fournisseurs,
 *   partenaires ;
 * - HUMAIN : quelqu'un d'inconnu qui écrit (dont les demandes de devis) ;
 * - BRUIT : notifications techniques, plateformes, newsletters, promotions,
 *   confirmations automatiques sans action — RANGÉ d'office (réversible).
 *
 * La prudence va dans un seul sens : un inconnu qui ressemble à une demande
 * client n'est jamais rangé (un faux positif vaut mieux qu'un client perdu),
 * et dans le doute, un mail reste visible.
 */

export type ClasseMail = "CLIENT" | "ADMINISTRATIF" | "HUMAIN" | "BRUIT";
export type ActionRegle = "RANGER" | "NE_JAMAIS_RANGER" | "ADMINISTRATIF";

export type EntreeTriMail = {
  sens: "ENTRANT" | "SORTANT";
  de: string;
  deNom: string | null;
  a: string[];
  compte: string;
  objet: string | null;
  /** Début du texte (sans les citations) : de quoi reconnaître une demande. */
  texte: string | null;
  entetes: Record<string, string>;
  libelles: string[];
  pieces: { typeMime: string; nom: string }[];
  /** Règles de Lucas qui visent cet expéditeur (adresse exacte, puis domaine). */
  regles: ActionRegle[];
  /** Contact connu par son adresse exacte (fiche client, lead, prospect). */
  contact: { type: "CLIENT" | "LEAD" | "PROSPECT"; nom: string } | null;
  /** La conversation est déjà rattachée à un contact. */
  filDUnContact: boolean;
};

export type DecisionTriMail = {
  classe: ClasseMail;
  /** Rangé d'office : lu, libellé CoverSwap/Rangé, hors de la boîte de réception. */
  ranger: boolean;
  /** Un inconnu qui demande un devis ou un renseignement : il remonte, et devient un lead. */
  demandeClient: boolean;
  motif: string;
  par: "TRI" | "REGLE";
};

/** Des mots entiers, accents compris (le \b de JavaScript ne connaît pas « é »). */
const mots = (motif: string) => new RegExp(String.raw`(?<![\p{L}\d])(?:${motif})(?![\p{L}\d])`, "iu");

const domaineDe = (adresse: string) => (adresse.split("@")[1] ?? "").toLowerCase();

/** Le domaine ou l'un de ses parents est dans la liste (« mail.railway.app » → « railway.app »). */
function domaineDans(domaine: string, liste: readonly string[]): string | null {
  for (const candidat of liste) if (domaine === candidat || domaine.endsWith(`.${candidat}`)) return candidat;
  return null;
}

/** Notifications techniques et plateformes : jamais un client. */
export const DOMAINES_BRUIT = [
  "railway.app",
  "railway.com",
  "vercel.com",
  "github.com",
  "githubusercontent.com",
  "gitlab.com",
  "facebookmail.com",
  "meta.com",
  "business.facebook.com",
  "instagram.com",
  "zapier.com",
  "openai.com",
  "anthropic.com",
  "cloudflare.com",
  "resend.com",
  "resend.dev",
  "sentry.io",
  "notion.so",
  "canva.com",
  "figma.com",
  "linkedin.com",
  "pinterest.com",
  "tiktok.com",
  "youtube.com",
  "twitter.com",
  "x.com",
  "medium.com",
  "substack.com",
  "mailchimp.com",
  "sendinblue.com",
  "brevo.com",
  "hubspot.com",
  "calendly.com",
  "trello.com",
  "slack.com",
  "discord.com",
  "apple.com", // les notifications iCloud viennent d'apple.com ; « icloud.com » est une adresse de particulier (un client)
  "microsoft.com",
  "adobe.com",
] as const;

/** Adresses Google qui ne sont que des notifications (Google Ads, Maps Platform, sécurité, Workspace…) : « noreply » où qu'il soit. */
const LOCALES_GOOGLE_BRUIT = /(^|[._+-])(no-?reply|googleads|adwords|calendar-notification)([._+-]|$)/i;

/** Administration, banques, assurances, fournisseurs et partenaires connus. */
export const DOMAINES_ADMINISTRATIF = [
  "urssaf.fr",
  "autoentrepreneur.urssaf.fr",
  "impots.gouv.fr",
  "dgfip.finances.gouv.fr",
  "finances.gouv.fr",
  "net-entreprises.fr",
  "service-public.fr",
  "entreprendre.service-public.fr",
  "inpi.fr",
  "infogreffe.fr",
  "cfe-metiers.com",
  "artisanat.fr",
  "cma-france.fr",
  "cma-occitanie.fr",
  "ameli.fr",
  "caf.fr",
  "pole-emploi.fr",
  "francetravail.fr",
  "chorus-pro.gouv.fr",
  "qonto.com",
  "shine.fr",
  "shine.co",
  "boursorama.fr",
  "boursobank.com",
  "credit-agricole.fr",
  "ca-languedoc.fr",
  "bnpparibas.com",
  "bnpparibas.net",
  "societegenerale.fr",
  "lcl.fr",
  "caisse-epargne.fr",
  "banquepopulaire.fr",
  "labanquepostale.fr",
  "creditmutuel.fr",
  "cic.fr",
  "revolut.com",
  "n26.com",
  "hellobank.fr",
  "ing.fr",
  "fortuneo.fr",
  "memo-bank.fr",
  "stripe.com",
  "sumup.com",
  "paypal.fr",
  "paypal.com",
  "axa.fr",
  "maif.fr",
  "macif.fr",
  "allianz.fr",
  "generali.fr",
  "groupama.fr",
  "matmut.fr",
  "hiscox.fr",
  "april.fr",
  "mma.fr",
  "maaf.fr",
  "gmf.fr",
  "smabtp.fr",
  "orus.eu",
  "ovh.com",
  "ovhcloud.com",
  "ovh.net",
  // Pas « orange.fr », « free.fr », « sfr.fr » : ce sont aussi les adresses de milliers de particuliers (des clients).
  // Leurs factures d'opérateur restent reconnues par l'objet (« Votre facture… »).
  "bouyguestelecom.fr",
  "edf.fr",
  "engie.com",
  "totalenergies.fr",
  "coverstyl.com",
  "cover-styl.com",
  "fldtech.fr",
  "fld-tech.fr",
  "fldtech.com",
] as const;

/** Objet (ou début du texte) qui dit une affaire administrative. */
const MOTS_ADMINISTRATIF = mots(String.raw`urssaf|imp[oô]ts?|d[ée]claration (?:de chiffre|trimestrielle|mensuelle|de revenus)|cotisations?|avis d'[ée]ch[ée]ance|[ée]ch[ée]ancier|pr[ée]l[èe]vements?|relev[ée] de compte|attestations?|mise en demeure|quittance|loyers?|bail|sinistre|contrat d'assurance|facture n|votre facture|fournisseurs?|bon de commande|commande n°|tva`);

/** Ce qui ressemble à une demande client (devis, rénovation, rendez-vous) : ne se range jamais. */
const MOTS_DEMANDE = mots(String.raw`devis|tarifs?|prix|combien|estimation|chiffrage|r[ée]nov\p{L}*|relook\p{L}*|cuisines?|salles? de bains?|salles? d'eau|meubles?|fa[çc]ades?|placards?|dressing|plan de travail|cr[ée]dences?|adh[ée]sifs?|covering|pellicul\p{L}*|rev[êe]tements?|chantiers?|rendez-vous|rdv|interventions?|disponibilit[ée]s?|photos? de (?:ma|mon|notre|nos)|recouvr\p{L}*`);

/** Confirmations automatiques sans action. */
const MOTS_CONFIRMATION = mots(String.raw`confirmation|confirm[ée]e?|votre commande|order|receipt|re[çc]u de paiement|bienvenue|welcome|v[ée]rifiez votre|verify your|code de v[ée]rification|verification code|mot de passe|password|nouvelle connexion|new sign-?in|alerte de s[ée]curit[ée]|security alert|newsletter|webinar|promo|offre sp[ée]ciale`);

const CATEGORIES_MASSE = ["CATEGORY_PROMOTIONS", "CATEGORY_SOCIAL"];
const CATEGORIES_NOTIFICATION = ["CATEGORY_UPDATES", "CATEGORY_FORUMS"];

/** Le signal de perte de lead du site (« 🚨 CONTACT NON ENREGISTRÉ CRM ») ne se range jamais. */
const ALERTE_LEAD_PERDU = /contact non enregistr[ée]/i;

export function trierMail(entree: EntreeTriMail): DecisionTriMail {
  const de = entree.de.toLowerCase();
  const domaine = domaineDe(de);
  const objet = entree.objet ?? "";
  const debut = `${objet}\n${(entree.texte ?? "").slice(0, 1500)}`;
  const entetes = entree.entetes;
  const liste = Boolean(entetes["list-unsubscribe"] || entetes["list-id"]);
  const masse = /^(bulk|list|junk)$/i.test((entetes.precedence ?? "").trim());
  const automatique = Boolean(entetes["auto-submitted"] && !/^no$/i.test(entetes["auto-submitted"].trim())) || Boolean(entetes["x-autoreply"]);
  const categorieMasse = entree.libelles.some((l) => CATEGORIES_MASSE.includes(l));
  const categorieNotification = entree.libelles.some((l) => CATEGORIES_NOTIFICATION.includes(l));
  const adresseAutomatique = estAdresseAutomatique(de);
  const pdf = entree.pieces.some((piece) => piece.typeMime === "application/pdf");
  // Une confirmation automatique (commande, compte, inscription) sans facture ne demande rien : ce n'est pas de l'administratif.
  const confirmationAutomatique = adresseAutomatique && MOTS_CONFIRMATION.test(objet) && !/factur|invoice/i.test(objet);
  const jamaisRanger = entree.regles.includes("NE_JAMAIS_RANGER");
  const decision = (classe: ClasseMail, motif: string, extra: Partial<DecisionTriMail> = {}): DecisionTriMail => {
    const base: DecisionTriMail = { classe, ranger: classe === "BRUIT", demandeClient: false, motif, par: "TRI", ...extra };
    // « Toujours voir cet expéditeur » (remonté à la main) : jamais rangé, quoi que disent les signaux.
    if (jamaisRanger && base.classe === "BRUIT") return { ...base, classe: "HUMAIN", ranger: false, motif: `${motif} Mais vous avez demandé de toujours voir cet expéditeur.` };
    return jamaisRanger ? { ...base, ranger: false } : base;
  };

  /* Envoyé depuis la boîte : jamais rangé. */
  if (entree.sens === "SORTANT") {
    if (entree.contact || entree.filDUnContact) return decision("CLIENT", "Mail envoyé à un contact connu.");
    const admin = entree.a.some((adresse) => domaineDans(domaineDe(adresse), DOMAINES_ADMINISTRATIF));
    return decision(admin ? "ADMINISTRATIF" : "HUMAIN", admin ? "Mail envoyé à un organisme ou un fournisseur." : "Mail envoyé à une personne qui n'est pas encore dans le CRM.");
  }

  /* Les décisions de Lucas passent avant tout. */
  if (entree.regles.includes("RANGER") && !jamaisRanger) {
    return { classe: "BRUIT", ranger: true, demandeClient: false, motif: "Vous avez demandé de ne plus voir cet expéditeur.", par: "REGLE" };
  }
  if (entree.regles.includes("ADMINISTRATIF")) return { classe: "ADMINISTRATIF", ranger: false, demandeClient: false, motif: "Expéditeur que vous avez classé en administratif.", par: "REGLE" };

  /* Un contact connu : toujours visible, dans Clients. */
  if (entree.contact) {
    const qui = entree.contact.type === "CLIENT" ? "client" : entree.contact.type === "LEAD" ? "lead" : "prospect";
    return decision("CLIENT", `Adresse de ${entree.contact.nom} (${qui}).`);
  }
  if (entree.filDUnContact) return decision("CLIENT", "Conversation déjà rattachée à un contact.");

  /* Le site signale un contact perdu : c'est une demande client, jamais du bruit. */
  if (ALERTE_LEAD_PERDU.test(objet)) {
    return decision("HUMAIN", "Le site signale une demande qui n'a pas atteint le CRM : à traiter.", { demandeClient: false, ranger: false });
  }

  /* Administratif : organismes, banques, assurances, fournisseurs, partenaires. */
  const domaineAdmin = domaineDans(domaine, DOMAINES_ADMINISTRATIF);
  if (domaineAdmin && !categorieMasse) return decision("ADMINISTRATIF", `Expéditeur administratif ou fournisseur (${domaineAdmin}).`);
  if (!categorieMasse && !liste && !confirmationAutomatique && MOTS_ADMINISTRATIF.test(objet)) return decision("ADMINISTRATIF", "L'objet parle d'une affaire administrative (facture, cotisation, déclaration…).");
  if (pdf && /factur|invoice|re[çc]u|receipt|avis|attestation/i.test(`${objet} ${entree.pieces.map((p) => p.nom).join(" ")}`)) {
    return decision("ADMINISTRATIF", "Une facture ou un justificatif est joint.");
  }

  /* Une demande qui ressemble à un client : jamais rangée, même envoyée par un formulaire. */
  const demande = MOTS_DEMANDE.test(debut);
  const plateforme = domaineDans(domaine, DOMAINES_BRUIT);
  const bruitGoogle = domaine === "google.com" && LOCALES_GOOGLE_BRUIT.test(de.split("@")[0] ?? "");
  const masseOuListe = categorieMasse || liste || masse;
  if (demande && !plateforme && !bruitGoogle && !masseOuListe) {
    // Envoyé par un formulaire ou un service automatique : visible, mais l'expéditeur n'est pas la personne — pas de lead d'office.
    if (adresseAutomatique) return decision("HUMAIN", "Parle de devis ou de rendez-vous, envoyé par un service automatique : à lire (créez le lead à la main si c'est un client).", { ranger: false });
    return decision("HUMAIN", "Un inconnu qui parle de devis, de rénovation ou de rendez-vous : à lire.", { demandeClient: true, ranger: false });
  }

  /* Bruit : plateformes, notifications, newsletters, promotions, confirmations automatiques. */
  if (plateforme) return decision("BRUIT", `Notification de plateforme (${plateforme}).`);
  if (bruitGoogle) return decision("BRUIT", "Notification Google (Ads, sécurité, services).");
  if (categorieMasse && (liste || masse)) return decision("BRUIT", "Newsletter ou promotion (classée par Gmail, lien de désinscription).");
  if (liste || masse) return decision("BRUIT", "Envoi de masse (lien de désinscription).");
  if (automatique) return decision("BRUIT", "Réponse ou envoi automatique.");
  if (adresseAutomatique && (categorieNotification || categorieMasse || MOTS_CONFIRMATION.test(objet))) return decision("BRUIT", "Confirmation ou notification automatique, sans action attendue.");
  if (adresseAutomatique) return decision("BRUIT", "Adresse d'envoi automatique (noreply, notifications).");
  if (categorieMasse) return decision("BRUIT", "Classé par Gmail en Promotions ou Réseaux sociaux.");

  /* Dans le doute : visible. */
  if (demande) return decision("HUMAIN", "Parle de devis ou de rénovation : à lire.", { demandeClient: true, ranger: false });
  return decision("HUMAIN", "Expéditeur inconnu du CRM : à lire.");
}

/** « a@b.fr » → [« a@b.fr », « @b.fr »] : ce qu'une règle d'expéditeur peut viser. */
export function ciblesDe(adresse: string): string[] {
  const propre = adresse.trim().toLowerCase();
  const domaine = domaineDe(propre);
  return domaine ? [propre, `@${domaine}`] : [propre];
}
