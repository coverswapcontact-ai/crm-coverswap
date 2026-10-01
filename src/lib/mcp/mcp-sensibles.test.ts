import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { preparerBaseEssai } from "@/test/base-essai";

preparerBaseEssai();
process.env.UPLOADS_DIR = mkdtempSync(path.join(tmpdir(), "coverswap-mcp-sensibles-"));
for (const cle of ["META_PIXEL_ID", "META_ACCESS_TOKEN", "META_APP_SECRET", "META_VERIFY_TOKEN", "META_PAGE_ACCESS_TOKEN", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_TOKEN_KEY", "NTFY_TOPIC", "TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID", "VAPID_PRIVATE_KEY", "VAPID_PUBLIC_KEY", "RESEND_API_KEY", "OPENAI_ADMIN_KEY", "OPENAI_API_KEY"]) process.env[cle] = "";
process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3001";
process.env.SITE_URL = "https://coverswap.fr";
process.env.NEXTAUTH_SECRET = "secret-de-session-pour-les-essais";
process.env.TACHES_DESACTIVEES = "1";

/**
 * Mission 17 (partie C) — aperçu et confirmation sur TOUTES les actions sensibles. Le test parcourt le catalogue :
 * chaque outil marqué sensible (niveau SENSIBLE, règle `sensible` par cas, ou `masse` au-delà de trois éléments), et
 * pour « modifier » et « creer » chaque entité dont un cas est sensible, doit avoir ici au moins un cas. Chaque cas,
 * appelé SANS jeton, doit rendre un aperçu (« Rien n'a été fait » et un jeton) et n'écrire RIEN : aucune ligne du
 * journal des modifications (qui copie toute écriture métier, déclencheurs de la base), hors la mécanique de
 * l'assistant (journal des appels, jeton, session). Base d'essai, noms fictifs, aucun réseau.
 */

type ResultatOutil = import("@/lib/assistant/definition").ResultatOutil;
type Cas = { outil: string; entite?: string; libelle: string; entree: () => Promise<Record<string, unknown>> };

let prisma: typeof import("@/lib/prisma").default;
let execution: typeof import("@/lib/assistant/execution");
let catalogue: typeof import("@/lib/assistant/catalogue");
let avecActeur: typeof import("@/lib/journal/contexte").avecActeur;
let session: import("@/lib/assistant/execution").Session;
const appelsReseau: string[] = [];
const fetchOriginal = globalThis.fetch;
const LUCAS = { acteur: "HUMAIN:lucas@coverswap.fr" };
const MECANIQUE = ["AppelOutil", "ConfirmationAssistant", "SessionAssistant"];
const PDF = Buffer.from("%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n");
const ids: Record<string, string> = {};

const appeler = (nom: string, entree: Record<string, unknown>): Promise<ResultatOutil> => execution.executerOutil(catalogue.outilParNom(nom)!, entree, session, new Date());

async function lead(prenom: string, donnees: Record<string, unknown> = {}) {
  return prisma.lead.create({ data: { prenom, nom: "Sensible", telephone: `06140${String(Object.keys(ids).length).padStart(5, "0")}`, email: `${prenom.toLowerCase()}@exemple.test`, ville: "Lattes", source: "SITE_DEVIS", typeProjet: "CUISINE", ...donnees } });
}

/** Les cas sensibles : un par outil au moins, et un par entité sensible de « modifier » et « creer ». */
const CAS: Cas[] = [
  { outil: "generer_document", libelle: "émettre un devis", entree: async () => ({ dossierId: ids.dossier, type: "DEVIS", objet: "Cuisine", lignes: [{ designation: "Façades", quantite: 2, unite: "ml", prix_unitaire: 100 }] }) },
  { outil: "envoyer_document", libelle: "envoyer un devis par mail", entree: async () => ({ dossierId: ids.dossier, documentId: ids.devis }) },
  { outil: "envoyer_lien_espace", libelle: "envoyer le lien de l'espace", entree: async () => ({ leadId: ids.leadSansDossier }) },
  { outil: "saisir_encaissement", libelle: "saisir un paiement", entree: async () => ({ dossierId: ids.dossier, montant: 50 }) },
  { outil: "annuler_encaissement", libelle: "annuler un paiement", entree: async () => ({ encaissementId: ids.encaissement, motif: "DOUBLON" }) },
  { outil: "annuler_encaissement", libelle: "rejeter un chèque", entree: async () => ({ encaissementId: ids.encaissement, nature: "REJETER", motif: "SANS_PROVISION" }) },
  { outil: "envoyer_mail", libelle: "envoyer un mail", entree: async () => ({ a: "client@exemple.test", objet: "Bonjour", texte: "Bonjour, à bientôt." }) },
  { outil: "annuler_document", libelle: "annuler un devis", entree: async () => ({ dossierId: ids.dossier, documentId: ids.repris }) },
  { outil: "relancer", libelle: "relancer un devis", entree: async () => ({ dossierId: ids.dossier }) },
  { outil: "repondre_espace", libelle: "répondre dans l'espace", entree: async () => ({ dossierId: ids.dossierEspace, texte: "Bonjour, c'est noté." }) },
  { outil: "anonymiser_client", libelle: "anonymiser une fiche", entree: async () => ({ clientId: ids.client, motif: "DEMANDE_PERSONNE" }) },
  { outil: "valider_proposition", libelle: "valider un mail proposé", entree: async () => ({ propositionIds: [ids.propositionMail] }) },
  { outil: "valider_proposition", libelle: "plus de trois propositions", entree: async () => ({ propositionIds: ids.notes.split(",") }) },
  { outil: "ignorer_proposition", libelle: "plus de trois propositions", entree: async () => ({ propositionIds: ids.notes.split(",") }) },
  { outil: "repondre_tache", libelle: "tout classer un lot", entree: async () => ({ tache: "lot:sensible-lot", reponse: "FAIT" }) },
  { outil: "changer_etape", libelle: "passer perdu", entree: async () => ({ dossierId: ids.dossier, vers: "PERDU", motif_perte: "PRIX" }) },
  { outil: "changer_etape", libelle: "encaissé avec le solde", entree: async () => ({ dossierId: ids.dossier, vers: "ENCAISSE", solde: { montant: 100 } }) },
  { outil: "archiver", libelle: "plus de trois leads", entree: async () => ({ leads: ids.leadsMasse.split(","), motif: "doublon" }) },
  { outil: "restaurer", libelle: "plus de trois leads", entree: async () => ({ leads: ids.leadsMasse.split(",") }) },
  { outil: "supprimer", libelle: "effacement définitif", entree: async () => ({ leads: [ids.leadSansDossier], motif: "doublon", definitif: true }) },
  { outil: "classer_mail", libelle: "plus de trois mails", entree: async () => ({ mails: ids.mails.split(",").map((messageId) => ({ messageId, intention: "INFORMATION" })) }) },
  { outil: "traiter_mail", libelle: "ne plus montrer un expéditeur", entree: async () => ({ geste: "NE_PLUS_MONTRER", messageIds: [ids.mails.split(",")[0]] }) },
  { outil: "traiter_mail", libelle: "ranger par expéditeur", entree: async () => ({ geste: "RANGER", expediteur: "@promo.test" }) },
  { outil: "traiter_mail", libelle: "tout nettoyer", entree: async () => ({ geste: "TOUT_NETTOYER" }) },
  { outil: "geste_espace", libelle: "désactiver le lien", entree: async () => ({ geste: "DESACTIVER", dossierId: ids.dossierEspace }) },
  { outil: "geste_espace", libelle: "nouveau lien par mail", entree: async () => ({ geste: "NOUVEAU_LIEN", dossierId: ids.dossierEspace }) },
  // Relecture adverse : sans mail aussi, l'ancien lien meurt (comme l'ex-« renouveler_lien », toujours sensible).
  { outil: "geste_espace", libelle: "nouveau lien sans mail", entree: async () => ({ geste: "NOUVEAU_LIEN", dossierId: ids.dossierEspace, mail: false }) },
  { outil: "geste_espace", libelle: "réactiver (nouveau lien)", entree: async () => ({ geste: "REACTIVER", dossierId: ids.dossierEspace }) },
  { outil: "geste_espace", libelle: "réinitialiser une étape", entree: async () => ({ geste: "REINITIALISER", dossierId: ids.dossierEspace, etape: "PROJET" }) },
  { outil: "geste_espace", libelle: "accorder plus de trois simulations", entree: async () => ({ geste: "ACCORDER_SIMULATIONS", dossierId: ids.dossierEspace, nombre: 5 }) },
  { outil: "publier", libelle: "publier une simulation", entree: async () => ({ quoi: "SIMULATION", ids: [ids.simulation] }) },
  { outil: "publier", libelle: "publier une réalisation", entree: async () => ({ quoi: "PUBLICATION", ids: [ids.publication] }) },
  { outil: "doublon", libelle: "fusionner un doublon de lead", entree: async () => ({ nature: "LEAD", action: "FUSIONNER", id: ids.doublon }) },
  { outil: "agir_systeme", libelle: "déconnecter Google", entree: async () => ({ action: "DECONNECTER_GOOGLE" }) },
  { outil: "agir_systeme", libelle: "révoquer tous les accès", entree: async () => ({ action: "REVOQUER_ACCES", tout: true }) },
  { outil: "agir_systeme", libelle: "rejouer tous les leads Meta", entree: async () => ({ action: "REJOUER_META" }) },
  { outil: "agir_systeme", libelle: "rejouer UN lead Meta (son SMS d'accusé peut partir)", entree: async () => ({ action: "REJOUER_META", leadgen_id: "999000111" }) },
  { outil: "noter_appel", libelle: "pas intéressé : le dossier passe en Perdu", entree: async () => ({ dossierId: ids.dossier, issue: "PAS_INTERESSE", motif_perte: "PRIX" }) },
  { outil: "noter_appel", libelle: "pas intéressé : le lead passe sans suite", entree: async () => ({ leadId: ids.leadSansDossier, issue: "PAS_INTERESSE", motif_perte: "DELAI" }) },
  { outil: "archiver", libelle: "retirer un tarif", entree: async () => ({ elements: [{ entite: "TARIF", id: ids.tarif }], motif: "plus vendu" }) },
  { outil: "restaurer", libelle: "remettre un tarif", entree: async () => ({ elements: [{ entite: "TARIF", id: ids.tarif }] }) },
  { outil: "agir_systeme", libelle: "lancer le banc", entree: async () => ({ action: "LANCER_BANC" }) },
  { outil: "ajouter_fichier", libelle: "un devis repris (numéro, montant)", entree: async () => ({ cible: { entite: "DOSSIER", id: ids.dossier }, type: "DEVIS", numero: "2026-951", montant: 800, inscrire_au_registre: true, source: { base64: PDF.toString("base64"), nom: "devis.pdf" } }) },
  { outil: "ranger_fichier", libelle: "retirer la photo d'une réalisation publiée", entree: async () => ({ fichier: ids.fichierPublication, retirer: true }) },
  { outil: "lien_depot", libelle: "déposer sur une réalisation publiée", entree: async () => ({ cible: { entite: "PUBLICATION", id: ids.publicationPubliee }, type: "PHOTO_APRES" }) },
  { outil: "preparer_simulation", libelle: "générer par l'API", entree: async () => ({ dossierId: ids.dossierEspace, mode: "API", teintes: [{ zone: "meubles hauts", teinte: "AB02" }] }) },
  { outil: "annuler_modification", libelle: "défaire un montant estimé", entree: async () => ({ modification_id: ids.modificationMontant }) },
  // « modifier » : chaque entité dont un cas est sensible.
  { outil: "modifier", entite: "LEAD", libelle: "lead sans suite", entree: async () => ({ entite: "LEAD", id: ids.leadSansDossier, champs: { statut: "PERDU", motif_perte: "PRIX" } }) },
  { outil: "modifier", entite: "DOSSIER", libelle: "montant estimé", entree: async () => ({ entite: "DOSSIER", id: ids.dossier, champs: { montant_estime: 4321 } }) },
  { outil: "modifier", entite: "DOSSIER", libelle: "changer de fiche client", entree: async () => ({ entite: "DOSSIER", id: ids.dossier, champs: { client_id: ids.client } }) },
  { outil: "modifier", entite: "DOCUMENT", libelle: "montant d'un document repris", entree: async () => ({ entite: "DOCUMENT", id: ids.repris, champs: { montant: 999 } }) },
  { outil: "modifier", entite: "ENCAISSEMENT", libelle: "montant d'un paiement", entree: async () => ({ entite: "ENCAISSEMENT", id: ids.encaissement, champs: { montant: 61 } }) },
  { outil: "modifier", entite: "TARIF", libelle: "prix d'un tarif", entree: async () => ({ entite: "TARIF", id: ids.tarif, champs: { prix_unitaire: 77 } }) },
  { outil: "modifier", entite: "SOUS_PARTIE", libelle: "prix d'une sous-partie", entree: async () => ({ entite: "SOUS_PARTIE", id: "ilot", champs: { prix_unitaire: 88 } }) },
  { outil: "modifier", entite: "PUBLICATION", libelle: "titre d'une réalisation publiée", entree: async () => ({ entite: "PUBLICATION", id: ids.publicationPubliee, champs: { titre: "Cuisine refaite à Lattes" } }) },
  { outil: "modifier", entite: "PARAMETRE", libelle: "réserve de trésorerie", entree: async () => ({ entite: "PARAMETRE", id: "TRESORERIE_RESERVE", champs: { valeur: 4100 } }) },
  { outil: "modifier", entite: "COMPTEUR", libelle: "prochain numéro de devis", entree: async () => ({ entite: "COMPTEUR", id: "DEVIS", champs: { prochain: "2026-500" } }) },
  { outil: "modifier", entite: "AUTOMATISME", libelle: "couper un mail automatique", entree: async () => ({ entite: "AUTOMATISME", id: "NOTIF_DEVIS_DISPONIBLE", champs: { actif: false } }) },
  { outil: "modifier", entite: "MODELE_SMS", libelle: "texte d'un SMS", entree: async () => ({ entite: "MODELE_SMS", id: "A_RAPPELER", champs: { texte: "Merci, je vous rappelle {quand}. Lucas" } }) },
  { outil: "modifier", entite: "MODELE_MAIL", libelle: "phrase d'un mail", entree: async () => ({ entite: "MODELE_MAIL", id: "DEVIS_DISPONIBLE", champs: { phrase: "Votre devis vous attend dans votre espace." } }) },
  { outil: "modifier", entite: "GUIDE_STYLE", libelle: "guide de style", entree: async () => ({ entite: "GUIDE_STYLE", champs: { texte: "Court, direct, vouvoiement." } }) },
  { outil: "modifier", entite: "CONSIGNES", libelle: "consignes", entree: async () => ({ entite: "CONSIGNES", champs: { mode: "ajouter_section", section: "Essai sensible", contenu: "- rien" } }) },
  { outil: "modifier", entite: "POSITIONNEMENT", libelle: "positionnement", entree: async () => ({ entite: "POSITIONNEMENT", champs: { mode: "ajouter_section", section: "Essai sensible", contenu: "- rien" } }) },
  { outil: "modifier", entite: "PROMPT_SIMULATION", libelle: "prompt du simulateur", entree: async () => ({ entite: "PROMPT_SIMULATION", id: "cuisine", champs: { texte: `${(await (await import("@/lib/simulateur/bibliotheque")).lirePrompt("cuisine")).texte}\nNe change rien d'autre que les teintes.` } }) },
  // « creer » : chaque entité dont un cas est sensible.
  { outil: "creer", entite: "DOSSIER", libelle: "dossier créé signé", entree: async () => ({ entite: "DOSSIER", champs: { client_nom: "Créé Signé", objet: "Cuisine", source: "ENTRANT", etape: "SIGNE" } }) },
  { outil: "creer", entite: "TARIF", libelle: "nouveau tarif", entree: async () => ({ entite: "TARIF", champs: { designation: "Tarif sensible", unite: "ml", prix_unitaire: 90 } }) },
  { outil: "creer", entite: "REGLE_EXPEDITEUR", libelle: "règle d'expéditeur", entree: async () => ({ entite: "REGLE_EXPEDITEUR", champs: { cible: "@promo.test", action: "RANGER" } }) },
  { outil: "creer", entite: "REPRISE", libelle: "reprise d'un dossier", entree: async () => ({ entite: "REPRISE", champs: { dossier: { client_nom: "Repris Sensible", objet: "Cuisine" }, etape: "SIGNE" } }) },
];

before(async () => {
  globalThis.fetch = (async (entree: string | URL | Request, init?: RequestInit) => {
    const url = typeof entree === "string" ? entree : entree instanceof URL ? entree.href : entree.url;
    if (!/^https?:\/\/(localhost|127\.0\.0\.1)/.test(url) && !url.startsWith("data:")) {
      appelsReseau.push(url);
      throw new Error(`réseau coupé pendant les essais : ${url}`);
    }
    return fetchOriginal(entree, init);
  }) as typeof fetch;
  prisma = (await import("@/lib/prisma")).default;
  execution = await import("@/lib/assistant/execution");
  catalogue = await import("@/lib/assistant/catalogue");
  avecActeur = (await import("@/lib/journal/contexte")).avecActeur;
  await (await import("@/lib/base/preparation")).preparerBase();
  (await import("@/lib/simulateur/catalogue")).definirCatalogueEssai([{ id: "AB02", nom: "Cafe Latte", famille: "couleur", categorie: "Color", finition: "Soft", image: "https://ssi.s3.fr-par.scw.cloud/cover-styl/web/ab02.jpg", tags: ["couleur"] }]);
  session = await execution.ouvrirSession({ jetonId: null, clientNom: "essai", utilisateur: "essai@local" });
  const sharp = (await import("sharp")).default;
  const jpeg = async (r: number) => new File([new Uint8Array(await sharp({ create: { width: 320, height: 240, channels: 3, background: { r, g: 100, b: 100 } } }).jpeg().toBuffer())], "photo.jpg", { type: "image/jpeg" });

  await avecActeur(LUCAS, async () => {
    // Un dossier avec un devis émis, une adresse mail, un paiement.
    const dossier = await prisma.dossier.create({ data: { clientNom: "Dossier Sensible", clientAdresse: "1 rue des Essais", clientCp: "34970", clientVille: "Lattes", clientTelephone: "0614000001", clientEmail: "dossier.sensible@exemple.test", objet: "Cuisine", source: "ENTRANT", etape: "DEVIS_ENVOYE" } });
    ids.dossier = dossier.id;
    const { genererDocument } = await import("@/lib/dossiers/documents");
    const devis = (await genererDocument(dossier.id, { type: "DEVIS", objet: "Cuisine", lignes: [{ type: "PRESTATION", designation: "Façades", quantite: 2, unite: "ml", prixUnitaire: 100 }], noteMl: true, acomptePct: 30, remplaceDocumentId: null, libelleVariante: null, notifier: false } as never)) as { document: { id: string } };
    ids.devis = devis.document.id;
    const { enregistrerEncaissement } = await import("@/lib/encaissements/service");
    ids.encaissement = (await enregistrerEncaissement({ dossierId: dossier.id, paiement: { montant: 60, moyen: "CHEQUE", recuLe: new Date().toISOString().slice(0, 10), reference: null } })).encaissement.id;
    const { enregistrerDocumentExistant } = await import("@/lib/dossiers/documents-existants");
    const repris = (await enregistrerDocumentExistant(dossier.id, { type: "DEVIS", numero: "2025-888", montant: 700, dateEmission: "2025-05-01", statut: "ENVOYE", objet: "Repris", inscrireAuRegistre: true } as never)) as { documentId?: string; document?: { id: string } };
    ids.repris = repris.documentId ?? repris.document!.id;

    // Un client (fiche) et des leads.
    ids.client = (await prisma.client.create({ data: { nom: "Client Sensible", source: "AUTRE", premierContactLe: new Date() } })).id;
    ids.leadSansDossier = (await lead("Sansdossier")).id;
    ids.leadsMasse = (await Promise.all([1, 2, 3, 4].map((n) => lead(`Masse${n}`)))).map((l) => l.id).join(",");
    const origine = await lead("Origine");
    ids.doublon = (await lead("Doublon", { doublonDe: origine.id, doublonMotif: "même numéro" })).id;

    // Un espace (dossier, simulation en brouillon, photo avant).
    const { ouvrirEspaceDuContact } = await import("@/lib/espace/liens");
    const avecEspace = await lead("Espace");
    const ouvert = await ouvrirEspaceDuContact(avecEspace.id);
    ids.dossierEspace = ouvert.dossierId;
    const { ajouterPhoto } = await import("@/lib/dossiers/dossiers");
    await ajouterPhoto(ouvert.dossierId, await jpeg(150), false);
    const { deposerSimulationDossier } = await import("@/lib/simulations/dossier");
    ids.simulation = (await deposerSimulationDossier(ouvert.dossierId, await jpeg(90), { titre: "Brouillon", source: "MANUEL" })).id;

    // Le site : une réalisation à publier (accord écrit), une déjà publiée avec sa photo déposée.
    ids.publication = (await prisma.publicationSite.create({ data: { type: "REALISATION", titre: "Cuisine à publier", ville: "Lattes", photoApres: "photos-apres/a.jpg", accordClientLe: new Date(), dossierId: ouvert.dossierId } })).id;
    ids.publicationPubliee = (await prisma.publicationSite.create({ data: { type: "REALISATION", titre: "Cuisine publiée", ville: "Lattes", photoApres: "photos-apres/b.jpg", accordClientLe: new Date(), publieLe: new Date(), dossierId: ouvert.dossierId } })).id;
    ids.fichierPublication = (await prisma.fichierDepose.create({ data: { voie: "BASE64", nom: "apres.jpg", typeMime: "image/jpeg", taille: 10, empreinte: "e", type: "PHOTO_APRES", cibleEntite: "PUBLICATION", cibleId: ids.publicationPubliee, cibleNom: "« Cuisine publiée »", photoChemin: "photos-apres/b.jpg" } })).id;

    // Mails, propositions, un tarif, un lot de tâches.
    ids.mails = (await Promise.all([1, 2, 3, 4].map((n) => prisma.message.create({ data: { canal: "EMAIL", compte: "coverswap.contact@gmail.com", identifiantCanal: `sensible-${n}`, sens: "ENTRANT", de: `promo${n}@promo.test`, objet: `Promo ${n}`, recuLe: new Date(), dansBoite: true } })))).map((m) => m.id).join(",");
    ids.propositionMail = (await prisma.proposition.create({ data: { type: "ENVOI_MAIL", auteur: "SYSTEME:relances", titre: "Relance proposée", contenu: JSON.stringify({ motif: "RELANCE_DEVIS", a: "dossier.sensible@exemple.test", objet: "Votre devis", texte: "Bonjour", documentIds: [] }), dossierId: dossier.id } })).id;
    const { proposer } = await import("@/lib/validation/service");
    ids.notes = (await avecActeur({ acteur: "AGENT:mail" }, () => Promise.all([1, 2, 3, 4].map((n) => proposer({ type: "NOTE_DOSSIER", titre: `Note ${n}`, contenu: { dossierId: dossier.id, texte: `Note ${n}` }, dossierId: dossier.id }))))).map((p) => p.id).join(",");
    const { creerPreset } = await import("@/lib/dossiers/presets");
    ids.tarif = ((await creerPreset({ designation: "Tarif d'essai", unite: "ml", prixUnitaire: 70 } as never)) as { id: string }).id;
    const moteur = await import("@/lib/a-faire/moteur");
    await moteur.reconcilier([1, 2].map((n) => ({ cle: `CLASSER_LEAD:systeme:sensible-${n}`, type: "CLASSER_LEAD", source: "COHERENCE", niveau: 5, depuis: new Date(), titre: `Classer · ${n}`, raison: "essai", raccourci: { genre: "PAGE", libelle: "Ouvrir", href: "/leads" }, sujet: { type: "SYSTEME", id: null }, lot: { cle: "sensible-lot", libelle: "tâche d'essai|tâches d'essai" } })) as never, { sources: ["COHERENCE"], maintenant: new Date() });
  });
  // Les automatismes se posent à leur première lecture (écran Paramètres) : déjà lus ici, comme à l'écran.
  await (await import("@/lib/automatismes/interrupteurs")).listerAutomatismes();
  // Une modification sensible déjà faite (montant estimé), à défaire.
  const apercu = await appeler("modifier", { entite: "DOSSIER", id: ids.dossierEspace, champs: { montant_estime: 2500 } });
  const fait = await appeler("modifier", { entite: "DOSSIER", id: ids.dossierEspace, champs: { montant_estime: 2500 }, confirmation: apercu.confirmation!.jeton });
  ids.modificationMontant = (fait.donnees as { modifications: string[] }).modifications[0];
});

after(async () => {
  globalThis.fetch = fetchOriginal;
  await prisma.$disconnect();
});

describe("toutes les actions sensibles : aperçu, jeton, rien d'écrit", () => {
  test("chaque outil sensible du catalogue (niveau, règle par cas, masse) et chaque entité sensible de « modifier » et « creer » a son cas ici", async () => {
    const { REGISTRE_ENTITES } = await import("@/lib/assistant/entites");
    const outils = new Set(CAS.map((c) => c.outil));
    const manquants = catalogue.CATALOGUE.filter((o) => o.niveau === "SENSIBLE" || o.sensible || o.masse).map((o) => o.nom).filter((nom) => !outils.has(nom));
    assert.deepEqual(manquants, [], `outils sensibles sans cas : ${manquants.join(", ")}`);
    const entitesModifier = Object.values(REGISTRE_ENTITES).filter((d) => d.modifier?.sensible).map((d) => d.code);
    const entitesCreer = Object.values(REGISTRE_ENTITES).filter((d) => d.creer?.sensible).map((d) => d.code);
    const couvertes = (outil: string) => new Set(CAS.filter((c) => c.outil === outil).map((c) => c.entite));
    assert.deepEqual(entitesModifier.filter((e) => !couvertes("modifier").has(e)), [], "entités sensibles de « modifier » sans cas");
    assert.deepEqual(entitesCreer.filter((e) => !couvertes("creer").has(e)), [], "entités sensibles de « creer » sans cas");
  });

  for (const cas of CAS) {
    test(`${cas.outil}${cas.entite ? ` ${cas.entite}` : ""} — ${cas.libelle} : aperçu et jeton, aucune écriture`, async () => {
      const entree = await cas.entree();
      const depuis = new Date();
      const avantAppels = await prisma.appelOutil.count();
      const r = await appeler(cas.outil, entree);
      assert.ok(r.confirmation?.jeton, `jeton attendu : ${r.texte.slice(0, 400)}`);
      assert.match(r.texte, /Rien n'a été fait\. Si Lucas confirme, rappelle/);
      const ecritures = await prisma.journalModification.findMany({ where: { horodatage: { gte: depuis }, modele: { notIn: MECANIQUE } }, select: { modele: true, operation: true } });
      assert.deepEqual(ecritures, [], `l'aperçu a écrit : ${JSON.stringify(ecritures)}`);
      // L'aperçu est journalisé comme tel (APERCU), jamais comme une exécution.
      const appel = await prisma.appelOutil.findFirstOrThrow({ where: { outil: cas.outil }, orderBy: { createdAt: "desc" } });
      assert.equal(appel.statut, "APERCU");
      assert.equal(await prisma.appelOutil.count(), avantAppels + 1);
    });
  }

  test("aucun appel réseau", () => {
    assert.deepEqual(appelsReseau, []);
  });
});
