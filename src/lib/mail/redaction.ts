import prisma from "@/lib/prisma";
import { ErreurMetier } from "@/lib/commun/erreurs";
import { EMETTEUR } from "@/lib/dossiers/constants";
import { IaIndisponible, appelerModele } from "@/lib/ia/modele";
import { MODES_REGLEMENT, VALIDITE_DEVIS_JOURS } from "@/lib/pdf/conditions";
import { FAMILLES } from "@/lib/prestations/prestations";
import { tarifsDesPrestations } from "@/lib/prestations/tarifs";
import { lireListe } from "@/lib/messages/stockage";
import { objetSansPrefixes, retirerCitations } from "@/lib/messages/texte";
import { contexteDuContact, contexteDuMail, type ContexteClient } from "./contexte";

/**
 * « Rédiger avec l'IA » (mission 7) : jamais pré-rempli, seulement quand Lucas
 * le demande, avec une consigne facultative. Le modèle reçoit ce qui sert à
 * écrire, rassemblé depuis les sources uniques du CRM (fiche, projets, étapes,
 * qui a la main, fil et échanges, notes d'appel, devis et paiements,
 * simulations, prestations, tarifs, conditions) — pas d'adresse, pas de
 * téléphone du client.
 *
 * Il n'invente jamais : une GARDE relit le brouillon et remplace tout montant,
 * toute date, tout délai absent des faits (ou de la consigne) par
 * « [à compléter] ». Le brouillon se modifie ; rien ne part sans le clic de
 * Lucas. Brouillon de l'IA, version envoyée et contexte sont gardés
 * (`BrouillonMail`) : la matière pour améliorer l'IA plus tard.
 */

export const A_COMPLETER = "[à compléter]";
const USAGE = "REDACTION_MAIL";

/* ── Guide de style (sa voix) ──────────────────────────────────────── */

export const GUIDE_STYLE_DEFAUT = `Vouvoiement toujours. Ton professionnel et chaleureux, direct, sans jargon.
Ouverture : « Bonjour {prénom}, » (« Bonjour, » si le prénom est inconnu).
Phrases courtes ; 4 à 8 lignes en général ; une idée par paragraphe.
Clôture : « Bien cordialement, » puis la signature sur trois lignes :
Lucas Villemin
CoverSwap
${EMETTEUR.telephone}`;

export type GuideStyle = { texte: string; source: "DEFAUT" | "MAILS" | "LUCAS"; majLe: string | null; analyse: { mails: number; longueurMoyenne: number | null } | null };

export async function lireGuideStyle(): Promise<GuideStyle> {
  const ligne = await prisma.reglageTexte.findUnique({ where: { cle: "GUIDE_STYLE" } });
  if (!ligne) return { texte: GUIDE_STYLE_DEFAUT, source: "DEFAUT", majLe: null, analyse: null };
  try {
    const lu = JSON.parse(ligne.valeur) as Omit<GuideStyle, "majLe">;
    return { ...lu, majLe: ligne.updatedAt.toISOString() };
  } catch {
    return { texte: ligne.valeur, source: "LUCAS", majLe: ligne.updatedAt.toISOString(), analyse: null };
  }
}

export async function enregistrerGuideStyle(texte: string, par: string, source: GuideStyle["source"] = "LUCAS", analyse: GuideStyle["analyse"] = null): Promise<void> {
  const propre = texte.trim().slice(0, 4000);
  if (propre.length < 20) throw new ErreurMetier("Le guide de style est trop court.", 400);
  const valeur = JSON.stringify({ texte: propre, source, analyse });
  await prisma.reglageTexte.upsert({ where: { cle: "GUIDE_STYLE" }, create: { cle: "GUIDE_STYLE", valeur, par }, update: { valeur, par } });
}

/** Ce qui identifie une personne dans un texte (adresses, numéros, liens) : retiré avant d'envoyer ses mails à l'IA. */
function anonymiser(texte: string): string {
  return texte
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[adresse]")
    .replace(/(?:\+33\s?|0)[1-9](?:[\s.-]?\d{2}){4}/g, "[téléphone]")
    .replace(/https?:\/\/\S+/g, "[lien]");
}

/**
 * Son guide de style, tiré de ses mails envoyés (les 30 plus récents, écrits
 * par lui — pas les notifications) : formules, longueur, ton. Adresses,
 * numéros et liens retirés avant l'envoi au modèle. Modifiable ensuite.
 */
export async function genererGuideStyle(par: string): Promise<GuideStyle> {
  const envoyes = await prisma.message.findMany({
    where: { canal: "EMAIL", sens: "SORTANT", automatique: false },
    orderBy: { recuLe: "desc" },
    take: 60,
    select: { objet: true, contenu: { select: { texte: true } } },
  });
  const textes = envoyes
    .map((m) => retirerCitations(m.contenu?.texte ?? "").trim())
    .filter((t) => t.length >= 40)
    .slice(0, 30)
    .map((t) => anonymiser(t).slice(0, 1500));
  if (textes.length < 3) throw new ErreurMetier("Trop peu de mails envoyés dans le CRM pour en tirer votre style (il en faut au moins 3). Gardez le guide par défaut, ou écrivez le vôtre.", 409);
  const longueurMoyenne = Math.round(textes.reduce((total, t) => total + t.split(/\s+/).length, 0) / textes.length);
  const { donnees } = await appelerModele({
    usage: "GUIDE_STYLE",
    systeme:
      "Tu analyses les mails qu'un artisan (CoverSwap, rénovation par revêtements adhésifs) a écrits à ses clients, pour en tirer un guide de style que suivra un assistant qui rédige pour lui. Français. Décris sa manière, pas le contenu : formules d'ouverture et de clôture exactes qu'il emploie, signature, longueur habituelle, ton, tournures récurrentes, ce qu'il évite. Vouvoiement obligatoire, même s'il tutoie parfois. Pas de données personnelles.",
    message: `Ses mails envoyés (${textes.length}), du plus récent au plus ancien :\n\n${textes.map((t, i) => `--- Mail ${i + 1} ---\n${t}`).join("\n\n")}`,
    outil: {
      nom: "rendre_guide",
      description: "Rend le guide de style.",
      schema: { type: "object", properties: { guide: { type: "string", description: "Le guide, 8 à 15 lignes, à la deuxième personne (« Ouvrez par… »), directement utilisable." } }, required: ["guide"] },
    },
    jetonsSortieMax: 900,
  });
  const guide = typeof (donnees as { guide?: unknown })?.guide === "string" ? String((donnees as { guide: string }).guide) : "";
  if (guide.trim().length < 40) throw new ErreurMetier("L'IA n'a pas rendu de guide lisible : réessayez, ou écrivez-le vous-même.", 502);
  await enregistrerGuideStyle(guide, par, "MAILS", { mails: textes.length, longueurMoyenne });
  return lireGuideStyle();
}

/* ── La garde : rien d'inventé ─────────────────────────────────────── */

const MOIS = "janvier|février|fevrier|mars|avril|mai|juin|juillet|août|aout|septembre|octobre|novembre|décembre|decembre";
const JOURS = "lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche";

const normaliserMontant = (brut: string): number | null => {
  const propre = brut.replace(/[\s\u202f\u00a0]/g, "").replace(/\.(?=\d{3}(?:\D|$))/g, "").replace(",", ".");
  const valeur = Number(propre);
  return Number.isFinite(valeur) ? Math.round(valeur * 100) / 100 : null;
};

const MONTANT = /(\d{1,3}(?:[\s\u202f\u00a0.]\d{3})+(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)\s?(?:€|euros?\b|EUR\b)/gi;
const POURCENT = /(\d{1,3}(?:[.,]\d{1,2})?)\s?%/g;
const DATE_CHIFFRES = /\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/g;
const DATE_LETTRES = new RegExp(String.raw`(?<![\p{L}\d])(?:(?:${JOURS})\s+)?\d{1,2}(?:er)?\s+(?:${MOIS})(?:\s+\d{4})?(?![\p{L}\d])`, "giu");
const JOUR_SEUL = new RegExp(String.raw`(?<![\p{L}\d])(?:${JOURS}|demain|après-demain|apres-demain|la semaine prochaine|ce week-end|ce weekend)(?![\p{L}\d])`, "giu");
const DELAI = new RegExp(String.raw`(?<![\p{L}\d])\d+(?:[.,]\d+)?\s?(?:h(?:eures?)?|jours?|semaines?|mois|ans?|minutes?|min)(?![\p{L}\d])`, "giu");
const HEURE = /\b\d{1,2}\s?h\s?\d{2}\b/g;
const LIEN = /https?:\/\/[^\s<>"')\]]+/gi;

export type Garde = { texte: string; corrections: string[] };

/**
 * Relit un brouillon : chaque montant, pourcentage, date, jour, délai, heure
 * ou lien doit se trouver dans les sources (faits du CRM, consigne, fil du
 * mail) ; sinon il est remplacé par « [à compléter] ». Pure : testée telle quelle.
 */
export function garderBrouillon(texte: string, sources: string): Garde {
  const corrections: string[] = [];
  const bas = sources.toLowerCase().replace(/[\u202f\u00a0]/g, " ");
  const montantsPermis = new Set<number>();
  for (const correspondance of sources.matchAll(MONTANT)) {
    const v = normaliserMontant(correspondance[1]);
    if (v !== null) montantsPermis.add(v);
  }
  const pourcentsPermis = new Set<number>();
  for (const correspondance of sources.matchAll(POURCENT)) {
    const v = normaliserMontant(correspondance[1]);
    if (v !== null) pourcentsPermis.add(v);
  }
  let resultat = texte.replace(MONTANT, (tout, nombre: string) => {
    const v = normaliserMontant(nombre);
    if (v !== null && montantsPermis.has(v)) return tout;
    corrections.push(`Montant « ${tout.trim()} » absent du CRM`);
    return A_COMPLETER;
  });
  resultat = resultat.replace(POURCENT, (tout, nombre: string) => {
    const v = normaliserMontant(nombre);
    if (v !== null && pourcentsPermis.has(v)) return tout;
    corrections.push(`Pourcentage « ${tout.trim()} » absent du CRM`);
    return A_COMPLETER;
  });
  const verifierTexte = (motif: RegExp, quoi: string) => {
    resultat = resultat.replace(motif, (tout: string) => {
      const cle = tout.toLowerCase().replace(/[\u202f\u00a0]/g, " ").replace(/\s+/g, " ").trim();
      if (bas.includes(cle)) return tout;
      corrections.push(`${quoi} « ${tout.trim()} » ${quoi === "Date" || quoi === "Heure" ? "absente" : "absent"} du CRM et de votre consigne`);
      return A_COMPLETER;
    });
  };
  verifierTexte(DATE_LETTRES, "Date");
  verifierTexte(DATE_CHIFFRES, "Date");
  verifierTexte(HEURE, "Heure");
  verifierTexte(DELAI, "Délai");
  verifierTexte(JOUR_SEUL, "Jour");
  resultat = resultat.replace(LIEN, (tout: string) => {
    const propre = tout.replace(/[.,;:!?]+$/, "");
    if (sources.includes(propre)) return tout;
    corrections.push(`Lien « ${propre} » absent du CRM`);
    return `${A_COMPLETER}${tout.slice(propre.length)}`;
  });
  return { texte: resultat, corrections };
}

/* ── Les faits donnés au modèle ────────────────────────────────────── */

const euros = (montant: number) => `${montant.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
const dateLongue = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Paris" }) : null);
const dateCourte = (d: Date) => d.toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" });

function faitsDuContexte(contexte: ContexteClient | null) {
  if (!contexte) return { client: null, projets: [], notesAppel: [] };
  return {
    client: { prenom: contexte.contact.prenom, nom: contexte.contact.nom, ville: contexte.contact.ville, type: contexte.contact.type === "CLIENT" ? "client" : "prospect (lead)" },
    projets: contexte.projets.map((p) => ({
      projet: p.nom,
      etape: p.etapeLibelle,
      quiALaMain: p.main === "MOI" || p.main === "A_RELANCER" ? "CoverSwap (à nous d'agir)" : p.main === "CLIENT" ? "le client" : "personne (terminé)",
      raison: p.mainMotif,
      prochaineAction: p.prochaineAction,
      prochaineActionLe: dateLongue(p.prochaineActionDate),
      dateChantier: dateLongue(p.dateChantier),
      devis: p.devis ? { numero: p.devis.numero, montantTTC: euros(p.devis.totalTtc), statut: p.devis.statut, signeLe: dateLongue(p.devis.signeLe), lectures: p.devis.consultations } : null,
      paiement: p.paiement ? { total: euros(p.paiement.total), recu: euros(p.paiement.recu), reste: euros(p.paiement.reste), acompte: p.paiement.acompte !== null ? euros(p.paiement.acompte) : null, acomptePourcentage: p.paiement.acomptePct !== null ? `${p.paiement.acomptePct} %` : null, acompteRecu: p.paiement.acompteRecu, regle: p.paiement.regle } : null,
      simulations: { publieesParCoverSwap: p.simulations.publiees, creeesParLeClient: p.simulations.faitesParLeClient, choixDuClient: p.simulations.choisie },
      espaceClient: p.espace ? { etat: p.espace.etat, ceQuilLuiReste: p.espace.resteAFaire, derniereVisite: dateLongue(p.espace.derniereVisite) } : "pas encore d'espace",
    })),
    notesAppel: contexte.notesAppel.slice(0, 3).map((n) => ({ le: dateLongue(n.le), note: n.texte, etiquettes: n.etiquettes, issue: n.issue })),
  };
}

async function faitsEntreprise() {
  const tarifs = (await tarifsDesPrestations()).filter((t) => t.prixUnitaire !== null && t.explicite);
  return {
    entreprise: { nom: "CoverSwap", signataire: "Lucas Villemin", telephone: EMETTEUR.telephone, metier: "Rénovation par revêtements adhésifs (films Cover Styl') : cuisines, salles de bain, meubles, locaux professionnels. Sans travaux lourds." },
    prestations: FAMILLES.map((f) => `${f.libelle} : ${f.sousParties.map((sp) => sp.libelle.toLowerCase()).join(", ")}`),
    tarifs: tarifs.map((t) => ({ prestation: `${t.familleLibelle} — ${t.libelle}`, prix: `${euros(t.prixUnitaire!)}${t.unite ? ` / ${t.unite}` : ""}` })),
    conditions: [`Paiements acceptés : ${MODES_REGLEMENT.replace(/^Paiement par /, "").toLowerCase()}`, `Un devis est valable ${VALIDITE_DEVIS_JOURS} jours à compter de sa date d'émission`, "Le pourcentage d'acompte figure sur chaque devis (voir le devis du client)"],
  };
}

type Cible = { messageId?: string | null; clientId?: string | null; leadId?: string | null; dossierId?: string | null };

async function rassembler(cible: Cible) {
  const message = cible.messageId ? await prisma.message.findUnique({ where: { id: cible.messageId }, include: { contenu: true } }) : null;
  if (cible.messageId && !message) throw new ErreurMetier("Mail introuvable.", 404);
  const contexte = message ? await contexteDuMail(message.id) : await contexteDuContact({ clientId: cible.clientId, leadId: cible.leadId });
  const fil = message?.filCanal
    ? await prisma.message.findMany({ where: { canal: "EMAIL", filCanal: message.filCanal }, orderBy: { recuLe: "asc" }, include: { contenu: { select: { texte: true } } } })
    : message
      ? [message]
      : [];
  const adresses = contexte?.contact.emails ?? (message ? [message.sens === "ENTRANT" ? message.de : (lireListe(message.a)[0] ?? "")] : []);
  const precedents = adresses.length
    ? await prisma.message.findMany({
        where: { canal: "EMAIL", automatique: false, OR: [{ de: { in: adresses } }, ...adresses.map((a) => ({ a: { contains: a } }))], ...(message?.filCanal ? { NOT: { filCanal: message.filCanal } } : {}) },
        orderBy: { recuLe: "desc" },
        take: 3,
        select: { recuLe: true, sens: true, objet: true, extrait: true },
      })
    : [];
  const destinataire = message ? (message.sens === "ENTRANT" ? message.de : (lireListe(message.a)[0] ?? null)) : (contexte?.contact.emails[0] ?? null);
  const dossierId = cible.dossierId ?? message?.dossierId ?? (contexte?.projets.length === 1 ? contexte.projets[0].dossierId : null);
  return { message, contexte, fil, precedents, destinataire, dossierId };
}

export type BrouillonVue = { id: string; a: string | null; objet: string; texte: string; manques: string[]; corrections: string[]; coutEuros: number; enReponseA: string | null; dossierId: string | null };

const CONSIGNES = `Tu rédiges un mail pour Lucas Villemin, artisan de CoverSwap, à un de ses clients ou prospects. Français.

RÈGLES NON NÉGOCIABLES
1. Tu n'inventes JAMAIS : un prix, un montant, une date, un jour, une heure, un délai ne viennent QUE des faits fournis ou de la consigne de Lucas. S'il manque une information, écris exactement « [à compléter] » à sa place, et ajoute-la à la liste « manques ».
2. Vouvoiement toujours. Ton professionnel et chaleureux. Pas de promesse que les faits ne permettent pas.
3. Tu réponds à ce que le client a écrit (dernier message reçu) et tu suis la consigne de Lucas si elle existe.
4. Pas d'objet inventé pour une réponse : l'objet reste celui de la conversation.
5. Signature : celle du guide de style (CoverSwap). Pas de formule creuse, pas de liste à puces sauf si c'est plus clair.
6. N'écris ni adresse mail, ni numéro de téléphone du client, ni lien : seulement le téléphone de CoverSwap si utile.

GUIDE DE STYLE DE LUCAS (sa voix, à suivre)
`;

/** Rédige un brouillon à la demande de Lucas. Rien n'est envoyé ; le brouillon est gardé avec ce que l'IA savait. */
export async function redigerBrouillon(cible: Cible & { consigne?: string | null }): Promise<BrouillonVue> {
  const consigne = cible.consigne?.trim().slice(0, 500) || null;
  const { message, contexte, fil, precedents, destinataire, dossierId } = await rassembler(cible);
  if (!message && !contexte) throw new ErreurMetier("Choisissez un mail ou un client à qui écrire.", 400);
  const guide = await lireGuideStyle();
  const aujourdhui = new Date().toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Paris" });
  const faits = {
    aujourdhui,
    ...(await faitsEntreprise()),
    ...faitsDuContexte(contexte),
    conversation: fil.slice(-6).map((m) => ({ sens: m.sens === "ENTRANT" ? "reçu du client" : "envoyé par CoverSwap", le: dateCourte(m.recuLe), objet: m.objet, texte: retirerCitations(m.contenu?.texte ?? m.extrait ?? "").slice(0, 1500) })),
    echangesPrecedents: precedents.map((m) => ({ le: dateCourte(m.recuLe), sens: m.sens === "ENTRANT" ? "reçu" : "envoyé", objet: m.objet, extrait: m.extrait })),
  };
  const objetReponse = message ? `Re: ${objetSansPrefixes(message.objet) || "votre message"}` : null;
  const demande = `${consigne ? `CONSIGNE DE LUCAS : ${consigne}\n\n` : "Pas de consigne : réponds au dernier message du client, simplement et utilement.\n\n"}FAITS (seule source autorisée) :\n${JSON.stringify(faits, null, 1)}`;
  let appel: Awaited<ReturnType<typeof appelerModele>>;
  try {
    appel = await appelerModele({
      usage: USAGE,
      systeme: `${CONSIGNES}${guide.texte}`,
      message: demande,
      outil: {
        nom: "rediger_mail",
        description: "Rend le mail rédigé.",
        schema: {
          type: "object",
          properties: {
            objet: { type: "string", description: "Objet (pour un nouveau mail ; ignoré pour une réponse)." },
            texte: { type: "string", description: "Le mail complet : salutation, corps, formule de fin, signature." },
            manques: { type: "array", items: { type: "string" }, description: "Chaque information absente des faits, remplacée par [à compléter]." },
          },
          required: ["texte", "manques"],
        },
      },
      jetonsSortieMax: 1200,
    });
  } catch (erreur) {
    if (erreur instanceof IaIndisponible) throw new ErreurMetier(`Rédaction par l'IA indisponible : ${erreur.message}`, 409);
    throw erreur;
  }
  const sortie = appel.donnees as { objet?: string; texte?: string; manques?: string[] };
  if (typeof sortie?.texte !== "string" || !sortie.texte.trim()) throw new ErreurMetier("L'IA n'a pas rendu de mail : réessayez.", 502);
  // La garde : tout montant, date ou délai absent des faits ou de la consigne devient « [à compléter] ».
  const sources = `${JSON.stringify(faits)}\n${consigne ?? ""}`;
  const garde = garderBrouillon(sortie.texte.trim(), sources);
  const objet = objetReponse ?? (sortie.objet?.trim() || "Votre projet CoverSwap");
  const manques = [...new Set([...(Array.isArray(sortie.manques) ? sortie.manques.filter((m) => typeof m === "string") : []), ...garde.corrections.map((c) => c.split(" absent")[0])])];
  const brouillon = await prisma.brouillonMail.create({
    data: {
      messageId: message?.id ?? null,
      clientId: contexte?.contact.clientId ?? cible.clientId ?? null,
      leadId: contexte?.contact.leadId ?? cible.leadId ?? null,
      dossierId,
      a: destinataire,
      consigne,
      objetIa: objet,
      texteIa: garde.texte,
      manques: JSON.stringify(manques),
      corrections: JSON.stringify(garde.corrections),
      contexte: JSON.stringify(faits),
      appelIaId: appel.appelId,
      coutEuros: appel.coutEuros,
    },
  });
  return { id: brouillon.id, a: destinataire, objet, texte: garde.texte, manques, corrections: garde.corrections, coutEuros: appel.coutEuros, enReponseA: message?.sens === "ENTRANT" ? message.id : (fil.filter((m) => m.sens === "ENTRANT").at(-1)?.id ?? null), dossierId };
}
