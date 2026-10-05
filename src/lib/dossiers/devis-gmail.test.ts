import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { preparerBaseEssai } from "@/test/base-essai";

preparerBaseEssai();
process.env.UPLOADS_DIR = mkdtempSync(path.join(tmpdir(), "coverswap-devis-gmail-"));
for (const cle of ["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID", "NTFY_TOPIC", "NTFY_TOKEN", "RESEND_API_KEY", "META_PIXEL_ID", "META_ACCESS_TOKEN", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"]) process.env[cle] = ""; // vide, pas supprimée : Prisma reprendrait la valeur de .env
process.env.NEXTAUTH_SECRET = "secret-de-session-pour-les-essais";
process.env.SITE_URL = "https://coverswap.fr";
process.env.TACHES_DESACTIVEES = "1";

/**
 * Mission 18 (B3, écart 3) : un devis envoyé depuis Gmail, hors du CRM. Ses PDF sont gardés, une tâche « Enregistrer
 * comme devis envoyé » le dit, et le geste (même fonction que l'outil « ajouter_fichier » : `deposerDocument` avec la
 * pièce du mail) dépose le devis, avance l'étape et lance les relances depuis la date du mail. Un envoi du CRM n'est
 * jamais pris pour un devis Gmail. Chaque cas se lit des deux côtés (`etatDesDeuxCotes`). Rien ne sort du poste : les
 * pièces sont posées « conservées » comme après leur téléchargement, aucun envoyeur n'est appelé.
 */

let prisma: typeof import("@/lib/prisma").default;
let avecActeur: typeof import("@/lib/journal/contexte").avecActeur;
let liens: typeof import("@/lib/espace/liens");
let documents: typeof import("./documents");
let transitions: typeof import("./transitions");
let depot: typeof import("./depot-document");
let gmail: typeof import("./devis-gmail");
let rattachement: typeof import("@/lib/mail/rattachement");
let relances: typeof import("@/lib/relances/service");
let fichiers: typeof import("@/lib/fichiers/stockage");
let enregistrement: typeof import("@/lib/fichiers-depot/enregistrement");
let dossiers: typeof import("./dossiers");
let etatDesDeuxCotes: typeof import("@/test/etat-dossier").etatDesDeuxCotes;

const LUCAS = { acteur: "HUMAIN:lucas@coverswap.fr" };
const JOUR = 24 * 60 * 60_000;
const PDF = Buffer.from("%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n", "latin1");
const ligne = (designation: string, quantite: number, prixUnitaire: number) => ({ type: "PRESTATION" as const, designation, sousDesignation: undefined, quantite, unite: "ml" as const, prixUnitaire });
let suivant = 0;

async function contact(prenom: string) {
  const email = `${prenom.toLowerCase()}.gmail@example.test`;
  const lead = await prisma.lead.create({ data: { prenom, nom: "Essai", telephone: `+3362${Math.floor(Math.random() * 9e7 + 1e7)}`, ville: "Lattes", codePostal: "34970", source: "META_ADS", email } });
  const ouvert = await liens.ouvrirEspaceDuContact(lead.id);
  await prisma.dossier.update({ where: { id: ouvert.dossierId }, data: { clientEmail: email } });
  await avecActeur(LUCAS, () => transitions.changerEtape(ouvert.dossierId, { vers: "SIMULATION" }));
  // Le client a choisi : l'espace a posé « Préparer le devis » (le devis envoyé le remplace).
  await prisma.dossier.update({ where: { id: ouvert.dossierId }, data: { prochaineAction: "Préparer le devis (simulation choisie)" } });
  const dossier = await prisma.dossier.findUniqueOrThrow({ where: { id: ouvert.dossierId }, select: { clientId: true } });
  return { leadId: lead.id, dossierId: ouvert.dossierId, clientId: dossier.clientId!, nom: `${prenom} Essai`, email };
}

type Contact = Awaited<ReturnType<typeof contact>>;

/** Un mail parti de la boîte Gmail chez ce client, avec un PDF ; `conserve` : comme après la file MAIL_PDF_SORTANTS. */
async function mailParti(c: Contact, options: { nom: string; il_y_a?: number; objet?: string; identifiant?: string; conserve?: boolean; sens?: "SORTANT" | "ENTRANT"; range?: boolean; contenu?: Buffer }) {
  suivant++;
  const recuLe = new Date(Date.now() - (options.il_y_a ?? JOUR));
  const sortant = (options.sens ?? "SORTANT") === "SORTANT";
  const message = await prisma.message.create({
    data: {
      canal: "EMAIL",
      compte: "contact@coverswap.fr",
      identifiantCanal: options.identifiant ?? `gmail-essai-${suivant}`,
      filCanal: `fil-essai-${suivant}`,
      sens: sortant ? "SORTANT" : "ENTRANT",
      de: sortant ? "contact@coverswap.fr" : c.email,
      a: JSON.stringify([sortant ? c.email : "contact@coverswap.fr"]),
      objet: options.objet ?? "Votre devis CoverSwap",
      extrait: "Bonjour, voici le devis.",
      recuLe,
      classe: "CLIENT",
      statut: "RATTACHE",
      clientId: c.clientId,
      ...(options.range === false ? {} : { dossierId: c.dossierId }),
    },
  });
  const fichier = options.conserve === false ? null : await fichiers.enregistrerFichier("messages", new File([new Uint8Array(options.contenu ?? PDF)], options.nom, { type: "application/pdf" }), recuLe);
  const piece = await prisma.pieceMessage.create({
    data: { messageId: message.id, rang: 1, nom: options.nom, typeMime: "application/pdf", taille: PDF.length, partie: "1", statut: fichier ? "CONSERVEE" : "A_CONSERVER", fichierId: fichier?.id ?? null },
  });
  return { messageId: message.id, pieceId: piece.id, recuLe };
}

const tachesDe = (etat: Awaited<ReturnType<typeof etatDesDeuxCotes>>, type: string) => etat.taches.filter((t) => t.type === type);

before(async () => {
  prisma = (await import("@/lib/prisma")).default;
  avecActeur = (await import("@/lib/journal/contexte")).avecActeur;
  liens = await import("@/lib/espace/liens");
  documents = await import("./documents");
  transitions = await import("./transitions");
  depot = await import("./depot-document");
  gmail = await import("./devis-gmail");
  rattachement = await import("@/lib/mail/rattachement");
  relances = await import("@/lib/relances/service");
  fichiers = await import("@/lib/fichiers/stockage");
  enregistrement = await import("@/lib/fichiers-depot/enregistrement");
  dossiers = await import("./dossiers");
  etatDesDeuxCotes = (await import("@/test/etat-dossier")).etatDesDeuxCotes;
  await (await import("@/lib/base/preparation")).preparerBase();
});
after(async () => {
  await prisma.$disconnect();
});

describe("devis envoyé depuis Gmail (mission 18, B3)", () => {
  test("le nom du fichier : un devis (numéro lu), jamais une facture ni une date", () => {
    assert.equal(gmail.numeroDevine("Devis-2026-012-DUPONT.pdf"), "2026-012");
    assert.equal(gmail.numeroDevine("devis 2026_7.pdf"), "2026-007");
    assert.equal(gmail.numeroDevine("scan-2026-10-05.pdf"), null);
    assert.equal(gmail.numeroDevine("F2026-012.pdf"), null);
    assert.equal(gmail.evoqueUnDevis("Devis cuisine.pdf"), true);
    assert.equal(gmail.evoqueUnDevis("2026-031.pdf"), true);
    assert.equal(gmail.evoqueUnDevis("Facture-F2026-004.pdf"), false);
    assert.equal(gmail.evoqueUnDevis("F2026-004.pdf"), false);
    assert.equal(gmail.evoqueUnDevis("CGV-CoverSwap.pdf"), false);
  });

  test("mail parti de Gmail avec un PDF : PDF gardé, tâche en un geste ; le geste dépose, avance l'étape, relance depuis le mail ; rejoué, rien ne bouge", async () => {
    const c = await contact("Depot");
    // Le tri range le mail dans le dossier et met les PDF en file (un mail reçu, lui, ne passe pas par cette file).
    const parti = await mailParti(c, { nom: "Devis-2026-901-ESSAI.pdf", conserve: false, range: false });
    const decision = { decision: { classe: "CLIENT" } } as unknown as Parameters<typeof rattachement.suitesDuTri>[1];
    await rattachement.suitesDuTri(parti.messageId, decision);
    assert.equal((await prisma.message.findUniqueOrThrow({ where: { id: parti.messageId } })).dossierId, c.dossierId);
    const file = await prisma.tache.findUnique({ where: { cle: `mail-pdf-sortants:${parti.messageId}` } });
    assert.equal(file?.type, rattachement.TYPE_TACHE_PDF_SORTANTS);
    // (Reçu avant l'envoi : le mail parti lui répond, la main n'est pas épinglée « Répondre à ».)
    const recu = await mailParti(c, { nom: "Devis-fournisseur.pdf", sens: "ENTRANT", conserve: false, range: false, il_y_a: 2 * JOUR });
    await rattachement.suitesDuTri(recu.messageId, decision);
    assert.equal(await prisma.tache.count({ where: { cle: `mail-pdf-sortants:${recu.messageId}` } }), 0);

    // Pas encore conservé : rien à proposer (le geste a besoin du fichier).
    assert.equal(tachesDe(await etatDesDeuxCotes(c.dossierId), "ENREGISTRER_DEVIS").length, 0);
    const fichier = await fichiers.enregistrerFichier("messages", new File([new Uint8Array(PDF)], "Devis-2026-901-ESSAI.pdf", { type: "application/pdf" }), parti.recuLe);
    await prisma.pieceMessage.update({ where: { id: parti.pieceId }, data: { statut: "CONSERVEE", fichierId: fichier.id } });

    const avant = await etatDesDeuxCotes(c.dossierId);
    assert.equal(avant.etape, "SIMULATION");
    assert.deepEqual(avant.relances, { proposables: [], devis: [] });
    const [tache] = tachesDe(avant, "ENREGISTRER_DEVIS");
    assert.equal(tache.cle, `ENREGISTRER_DEVIS:dossier:${c.dossierId}:${parti.pieceId}`);
    assert.equal(tache.titre, `Enregistrer comme devis envoyé · ${c.nom}`);
    assert.match(tache.raison, /^« Devis-2026-901-ESSAI\.pdf » envoyé depuis Gmail le \d\d\/\d\d à depot\.gmail@example\.test : pas encore dans le CRM/);
    const ligneTache = await prisma.tacheAFaire.findUniqueOrThrow({ where: { cle: tache.cle } });
    const raccourci = JSON.parse(ligneTache.raccourci) as { genre: string; devis: string; pieceId: string; href: string };
    assert.deepEqual([raccourci.genre, raccourci.devis, raccourci.pieceId], ["DEVIS", "gmail", parti.pieceId]);
    assert.equal(raccourci.href, `/dossiers?dossier=${c.dossierId}&devis=gmail&piece=${parti.pieceId}`);

    // La modale préremplie : numéro lu dans le nom, date du mail.
    const prerempli = await gmail.lireDevisGmail(c.dossierId, parti.pieceId);
    assert.deepEqual([prerempli.numero, prerempli.devisCrm, prerempli.messageId], ["2026-901", null, parti.messageId]);

    // Le geste : la route de la modale, et l'outil « ajouter_fichier », appellent deposerDocument avec la pièce du mail.
    const resultat = await avecActeur(LUCAS, () => depot.deposerDocument(c.dossierId, { type: "DEVIS", statut: "ENVOYE", numero: "2026-901", montant: 3200, inscrire_au_registre: true, source: { message_id: parti.messageId, piece_id: parti.pieceId } }));
    assert.equal(resultat.nature, "DOCUMENT");
    if (resultat.nature !== "DOCUMENT") return;
    assert.deepEqual(resultat.gmail, { nature: "DEPOSE", deja: false });
    const devis = await prisma.document.findUniqueOrThrow({ where: { id: resultat.documentId } });
    assert.deepEqual([devis.numero, devis.statut, devis.visibleEspace, devis.origine, devis.totalHt], ["2026-901", "ENVOYE", true, "REPRISE", 3200]);
    assert.ok(devis.pdfPath, "le PDF du mail est celui du devis");
    const evenement = await prisma.dossierEvenement.findFirstOrThrow({ where: { dossierId: c.dossierId, type: "DEVIS_ENVOYE" } });
    assert.deepEqual(JSON.parse(evenement.metadata), { documentId: devis.id, canal: "GMAIL", messageId: parti.messageId, pieceId: parti.pieceId, envoyeLe: parti.recuLe.toISOString() });
    assert.equal(await prisma.envoiMail.count({ where: { dossierId: c.dossierId } }), 0, "aucun mail ne part : le client a déjà le devis");

    const etat = await etatDesDeuxCotes(c.dossierId);
    assert.equal(etat.etape, "DEVIS_ENVOYE");
    assert.deepEqual([etat.main, etat.mainCalculee, etat.mainMotif], ["CLIENT", "CLIENT", "Devis envoyé : en attente de sa réponse"]);
    assert.equal(etat.prochaineAction, "Attendre l'accord du client sur le devis");
    assert.equal(etat.statutLead, "DEVIS_ENVOYE");
    assert.equal(etat.etapeEspace, "DEVIS");
    // Les relances partent du mail (hier), pas du dépôt (maintenant).
    const { jours } = await relances.lireDelaiRelance();
    assert.deepEqual(etat.relances.devis.map((r) => [r.numero, r.rang]), [["2026-901", 1]]);
    assert.equal(new Date(etat.relances.devis[0].le!).getTime(), parti.recuLe.getTime() + jours * JOUR);
    assert.equal(relances.referenceDuDevis({ dateEmission: devis.dateEmission!, createdAt: devis.createdAt }, { le: parti.recuLe, depuisLeMail: true }).getTime(), parti.recuLe.getTime());
    assert.equal(tachesDe(etat, "ENREGISTRER_DEVIS").length, 0);
    const cochee = await prisma.tacheAFaire.findUniqueOrThrow({ where: { cle: tache.cle } });
    assert.equal(cochee.statut, "FAITE");
    assert.match(cochee.reponseTexte ?? "", /^coché par le CRM : devis 2026-901 enregistré comme envoyé depuis Gmail à \d\d:\d\d$/);

    // Rejoué (double clic, outil relancé) : rien ne bouge.
    const encore = await avecActeur(LUCAS, () => depot.deposerDocument(c.dossierId, { type: "DEVIS", statut: "ENVOYE", numero: "2026-901", montant: 3200, inscrire_au_registre: true, source: { message_id: parti.messageId, piece_id: parti.pieceId } }));
    assert.equal(encore.nature === "DOCUMENT" && encore.gmail?.deja, true);
    assert.equal(await prisma.document.count({ where: { dossierId: c.dossierId, type: "DEVIS" } }), 1);
    assert.equal(await prisma.dossierEvenement.count({ where: { dossierId: c.dossierId, type: "DEVIS_ENVOYE" } }), 1);
    assert.deepEqual(await etatDesDeuxCotes(c.dossierId), etat);
  });

  test("devis du CRM généré masqué, puis envoyé depuis Gmail : passé « Envoyé » sans second dépôt, les deux tâches cochées ; une action posée à la main reste", async () => {
    const c = await contact("Crm");
    const { document: genere } = await avecActeur(LUCAS, () =>
      documents.genererDocument(c.dossierId, documents.schemaGeneration.parse({ type: "DEVIS", objet: "Recouvrement cuisine", lignes: [ligne("Revêtement adhésif — façades", 8, 140)], noteMl: true, acomptePct: 30, remplaceDocumentId: null, notifier: false }))
    );
    assert.equal(genere.visibleEspace, false);
    await avecActeur(LUCAS, () => dossiers.modifierDossier(c.dossierId, { prochaineAction: "Rappeler vendredi pour le devis" }));
    const parti = await mailParti(c, { nom: `Devis-${genere.numero}-CRM-ESSAI.pdf`, il_y_a: 0 }); // juste après la génération

    const avant = await etatDesDeuxCotes(c.dossierId);
    assert.equal(avant.etape, "SIMULATION");
    assert.equal(tachesDe(avant, "ENVOYER_DEVIS").length, 1);
    const [tache] = tachesDe(avant, "ENREGISTRER_DEVIS");
    assert.ok(tache, "jamais écartée par une action posée à la main");
    assert.match(tache.raison, new RegExp(`^devis ${genere.numero} du CRM envoyé depuis Gmail`));
    assert.deepEqual((await gmail.lireDevisGmail(c.dossierId, parti.pieceId)).devisCrm, { id: genere.id, numero: genere.numero });

    // Pas de montant à saisir : c'est le devis du CRM, son PDF reste le sien.
    const resultat = await avecActeur(LUCAS, () => depot.deposerDocument(c.dossierId, { type: "DEVIS", numero: genere.numero!, source: { message_id: parti.messageId, piece_id: parti.pieceId } }));
    assert.equal(resultat.nature === "DOCUMENT" && resultat.gmail?.nature, "ENVOYE");
    assert.equal(await prisma.document.count({ where: { dossierId: c.dossierId, type: "DEVIS" } }), 1);
    const devis = await prisma.document.findUniqueOrThrow({ where: { id: genere.id } });
    assert.deepEqual([devis.statut, devis.visibleEspace, devis.pdfPath], ["ENVOYE", true, genere.pdfPath]);

    const etat = await etatDesDeuxCotes(c.dossierId);
    assert.deepEqual([etat.etape, etat.main, etat.etapeEspace], ["DEVIS_ENVOYE", "CLIENT", "DEVIS"]);
    assert.deepEqual([etat.prochaineAction, etat.actionManuelle], ["Rappeler vendredi pour le devis", "Rappeler vendredi pour le devis"]);
    assert.equal(new Date(etat.relances.devis[0].le!).getTime(), parti.recuLe.getTime() + (await relances.lireDelaiRelance()).jours * JOUR);
    assert.equal(tachesDe(etat, "ENVOYER_DEVIS").length, 0);
    assert.equal(tachesDe(etat, "ENREGISTRER_DEVIS").length, 0);
    assert.equal((await prisma.tacheAFaire.findUniqueOrThrow({ where: { cle: tache.cle } })).statut, "FAITE");
  });

  test("un envoi du CRM n'est jamais pris pour un devis Gmail ; un PDF ancien, une facture ou un devis déjà déposé non plus", async () => {
    const c = await contact("Exclus");
    // Envoi programmé par le CRM sans identifiant Gmail (« crm: »), puis relu.
    await mailParti(c, { nom: "Devis-2026-911-ESSAI.pdf", identifiant: "crm:essai-envoi" });
    // Relevé de Gmail avec son propre identifiant : même objet et même destinataire qu'un envoi programmé du CRM…
    await prisma.envoiMail.create({ data: { cle: "essai:devis-gmail", nature: "NOUVEAU", statut: "ENVOYE", a: c.email, objet: "Devis 2026-912", texte: "Voici le devis." } });
    await mailParti(c, { nom: "Devis-2026-912-ESSAI.pdf", objet: "Devis 2026-912" });
    // … ou qu'un mail de proposition (bouton « Envoyer par mail », outil « envoyer_document ») tracé dans le dossier.
    await prisma.dossierEvenement.create({ data: { dossierId: c.dossierId, type: "MAIL_ENVOYE", direction: "SORTANT", contenu: "Envoi du devis à exclus.gmail@example.test : « Devis 2026-913 »", metadata: JSON.stringify({ propositionId: "essai", motif: "ENVOI_DEVIS", a: c.email, documentIds: [] }) } });
    await mailParti(c, { nom: "Devis-2026-913-ESSAI.pdf", objet: "Devis 2026-913" });
    // Plus de 30 jours, une facture.
    await mailParti(c, { nom: "Devis-2026-914-ESSAI.pdf", il_y_a: 40 * JOUR });
    await mailParti(c, { nom: "Facture-F2026-915.pdf" });
    // Sans numéro lisible, mais un devis est entré dans le dossier après le mail : c'est celui-là.
    await mailParti(c, { nom: "devis-cuisine.pdf", il_y_a: 3 * JOUR });
    await avecActeur(LUCAS, () => depot.deposerDocument(c.dossierId, { type: "DEVIS", numero: "2026-916", montant: 1800, inscrire_au_registre: true, source: { contenu_base64: PDF.toString("base64"), nom: "devis.pdf" } }));

    assert.deepEqual(await gmail.devisGmailNonEnregistres(prisma, { dossierIds: [c.dossierId] }), []);
    const etat = await etatDesDeuxCotes(c.dossierId);
    assert.equal(tachesDe(etat, "ENREGISTRER_DEVIS").length, 0);
    // Le dépôt d'une pièce reçue (mail ENTRANT) reste un dépôt ordinaire, sans « Devis envoyé » daté d'un mail.
    const recu = await mailParti(c, { nom: "Devis-2026-917-ESSAI.pdf", sens: "ENTRANT" });
    const ordinaire = await avecActeur(LUCAS, () => depot.deposerDocument(c.dossierId, { type: "DEVIS", numero: "2026-917", montant: 900, inscrire_au_registre: true, source: { message_id: recu.messageId, piece_id: recu.pieceId } }));
    assert.equal(ordinaire.nature === "DOCUMENT" && ordinaire.gmail, undefined);
    assert.equal(await prisma.dossierEvenement.count({ where: { dossierId: c.dossierId, type: "DEVIS_ENVOYE", metadata: { contains: '"canal":"GMAIL"' } } }), 0);

    // Un faux PDF : refusé avant toute écriture — aucun numéro inscrit, l'étape ne bouge pas, la tâche reste.
    const etapeAvant = (await prisma.dossier.findUniqueOrThrow({ where: { id: c.dossierId } })).etape;
    const faux = await mailParti(c, { nom: "Devis-2026-918-ESSAI.pdf", contenu: Buffer.from("pas un pdf") });
    await assert.rejects(
      avecActeur(LUCAS, () => depot.deposerDocument(c.dossierId, { type: "DEVIS", numero: "2026-918", montant: 900, inscrire_au_registre: true, source: { message_id: faux.messageId, piece_id: faux.pieceId } })),
      /n'est pas un PDF/
    );
    assert.equal(await prisma.numeroDocument.count({ where: { numero: "2026-918" } }), 0);
    assert.equal((await prisma.dossier.findUniqueOrThrow({ where: { id: c.dossierId } })).etape, etapeAvant);
    assert.equal(tachesDe(await etatDesDeuxCotes(c.dossierId), "ENREGISTRER_DEVIS").length, 1);
  });

  test("outil « ajouter_fichier » avec la pièce du mail : le même enregistrement (devis envoyé depuis Gmail)", async () => {
    const c = await contact("Outil");
    const parti = await mailParti(c, { nom: "Devis-2026-921-ESSAI.pdf" });
    const resultat = await avecActeur(LUCAS, () =>
      enregistrement.enregistrerFichierRecu({ entite: "DOSSIER", id: c.dossierId }, "DEVIS", { contenu: PDF, nom: "Devis-2026-921-ESSAI.pdf" }, { voie: "PIECE_MAIL", origine: `mail ${parti.messageId}`, document: { numero: "2026-921", montant: 2400, inscrire_au_registre: true }, pieceMail: { messageId: parti.messageId, pieceId: parti.pieceId } })
    );
    assert.match(resultat.destination, /^devis 2026-921 enregistré comme envoyé depuis Gmail, au dossier de Outil Essai.* : relances comptées depuis le mail$/);
    const etat = await etatDesDeuxCotes(c.dossierId);
    assert.deepEqual([etat.etape, etat.main, etat.prochaineAction, etat.etapeEspace], ["DEVIS_ENVOYE", "CLIENT", "Attendre l'accord du client sur le devis", "DEVIS"]);
    assert.equal(tachesDe(etat, "ENREGISTRER_DEVIS").length, 0);
  });

  test("relecture : « ajouter_fichier » avec la pièce du mail d'un devis du CRM, sans montant : enregistré comme envoyé (comme l'écran), jamais rangé « à compléter »", async () => {
    const c = await contact("Sansmontant");
    const { document: genere } = await avecActeur(LUCAS, () =>
      documents.genererDocument(c.dossierId, documents.schemaGeneration.parse({ type: "DEVIS", objet: "Recouvrement cuisine", lignes: [ligne("Revêtement adhésif — façades", 8, 140)], noteMl: true, acomptePct: 30, remplaceDocumentId: null, notifier: false }))
    );
    const nom = `Devis-${genere.numero}-ESSAI.pdf`;
    const parti = await mailParti(c, { nom, il_y_a: 0 });
    const resultat = await avecActeur(LUCAS, () =>
      enregistrement.enregistrerFichierRecu({ entite: "DOSSIER", id: c.dossierId }, "DEVIS", { contenu: PDF, nom }, { voie: "PIECE_MAIL", origine: `mail ${parti.messageId}`, document: { numero: genere.numero! }, pieceMail: { messageId: parti.messageId, pieceId: parti.pieceId } })
    );
    assert.ok(resultat.destination.startsWith(`devis ${genere.numero} enregistré comme envoyé depuis Gmail (devis du CRM passé « Envoyé »)`), resultat.destination);
    assert.equal(resultat.aCompleter, false);
    assert.equal(await prisma.document.count({ where: { dossierId: c.dossierId, type: "DEVIS" } }), 1, "pas de second dépôt");
    const devis = await prisma.document.findUniqueOrThrow({ where: { id: genere.id } });
    assert.deepEqual([devis.statut, devis.visibleEspace], ["ENVOYE", true]);
    const etat = await etatDesDeuxCotes(c.dossierId);
    assert.deepEqual([etat.etape, etat.main, etat.prochaineAction, etat.statutLead, etat.etapeEspace], ["DEVIS_ENVOYE", "CLIENT", "Attendre l'accord du client sur le devis", "DEVIS_ENVOYE", "DEVIS"]);
    assert.equal(tachesDe(etat, "ENVOYER_DEVIS").length + tachesDe(etat, "ENREGISTRER_DEVIS").length, 0);

    // Sans devis du CRM de ce numéro, le montant reste exigé (même règle que l'écran) : rien n'est rangé en silence.
    const autre = await mailParti(c, { nom: "Devis-2026-955-ESSAI.pdf", il_y_a: 0 });
    await assert.rejects(
      avecActeur(LUCAS, () => enregistrement.enregistrerFichierRecu({ entite: "DOSSIER", id: c.dossierId }, "DEVIS", { contenu: PDF, nom: "Devis-2026-955-ESSAI.pdf" }, { voie: "PIECE_MAIL", origine: `mail ${autre.messageId}`, document: { numero: "2026-955" }, pieceMail: { messageId: autre.messageId, pieceId: autre.pieceId } })),
      /montant HT est obligatoire/
    );
  });
});
