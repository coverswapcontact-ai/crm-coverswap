import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { preparerBaseEssai } from "@/test/base-essai";

preparerBaseEssai();

/**
 * Mission 22 (A1) — le journal global « Depuis ta dernière visite » (lib/chronologie/journal.ts) sur une base
 * d'essai : chaque source rend sa phrase, le message d'espace n'est pas en double avec son événement jumeau, le bruit
 * est groupé, la période est bornée à 30 jours, les filtres et la pagination, le paramètre JOURNAL_VU_LE. Noms fictifs.
 */
let prisma: typeof import("@/lib/prisma").default;
let journal: typeof import("@/lib/chronologie/journal");
const ids: Record<string, string> = {};
const H = 3_600_000;
const J = 24 * H;
const maintenant = new Date();
/** La fin de la période lue : posée après la base d'essai (les lignes à `updatedAt` du moment sont alors toutes avant). */
let fin: Date;
const ilYA = (ms: number) => new Date(maintenant.getTime() - ms);

before(async () => {
  prisma = (await import("@/lib/prisma")).default;
  journal = await import("@/lib/chronologie/journal");

  ids.client = (await prisma.client.create({ data: { nom: "Nadia Essai", ville: "Lattes", source: "SITE_DEVIS", premierContactLe: ilYA(20 * J) } })).id;
  ids.lead = (await prisma.lead.create({ data: { prenom: "Omar", nom: "Appel", telephone: "0611000020", ville: "Sète", source: "META_ADS", typeProjet: "CUISINE" } })).id;
  ids.dossier = (await prisma.dossier.create({ data: { clientNom: "Nadia Essai", clientAdresse: "2 rue des Essais", clientCp: "34970", clientVille: "Lattes", clientTelephone: "0611000021", objet: "Cuisine", source: "ENTRANT", etape: "DEVIS_ENVOYE", clientId: ids.client, main: "CLIENT", mainLe: ilYA(5 * H), mainMotif: "Devis envoyé : en attente de sa réponse" } })).id;
  ids.dossierAutre = (await prisma.dossier.create({ data: { clientNom: "Paul Autre", clientAdresse: "3 rue des Essais", clientCp: "34000", clientVille: "Montpellier", clientTelephone: "0611000022", objet: "Dressing", source: "ENTRANT", etape: "QUALIFICATION" } })).id;

  // Mails : un reçu classé client, un reçu BRUIT (exclu), un envoyé (pas une source : jamais dans le journal).
  ids.mail = (await prisma.message.create({ data: { canal: "EMAIL", compte: "essai@exemple.test", identifiantCanal: "journal-1", filCanal: "fil-journal-1", sens: "ENTRANT", de: "nadia@exemple.test", deNom: "Nadia Essai", objet: "Une question sur le devis", extrait: "Le plan de travail est-il compris ?", recuLe: ilYA(2 * H), classe: "CLIENT", classePar: "TRI", clientId: ids.client, dossierId: ids.dossier } })).id;
  await prisma.message.create({ data: { canal: "EMAIL", compte: "essai@exemple.test", identifiantCanal: "journal-2", filCanal: "fil-journal-2", sens: "ENTRANT", de: "promo@exemple.test", deNom: "Promo", objet: "Offre du jour", recuLe: ilYA(2 * H), classe: "BRUIT", classePar: "TRI" } });
  await prisma.message.create({ data: { canal: "EMAIL", compte: "essai@exemple.test", identifiantCanal: "journal-3", filCanal: "fil-journal-1", sens: "SORTANT", de: "essai@exemple.test", a: JSON.stringify(["nadia@exemple.test"]), objet: "Re: Une question", recuLe: ilYA(1 * H), clientId: ids.client } });

  // Message d'espace et son événement jumeau : une seule ligne.
  const jumeau = await prisma.dossierEvenement.create({ data: { dossierId: ids.dossier, type: "ESPACE_MESSAGE", direction: "ENTRANT", contenu: "Message du client depuis son espace : « Peut-on avancer la pose ? »", createdAt: ilYA(3 * H) } });
  await prisma.messageEspace.create({ data: { dossierId: ids.dossier, auteur: "CLIENT", source: "MESSAGE", texte: "Peut-on avancer la pose ?", evenementId: jumeau.id, createdAt: ilYA(3 * H) } });

  // SMS : un reçu, un accusé automatique parti, un manuel (exclu : c'est un geste du gérant, tracé ailleurs).
  const conversation = await prisma.conversationSms.create({ data: { numero: "+33611000021", clientId: ids.client, nomAffiche: "Nadia Essai" } });
  await prisma.sms.create({ data: { conversationId: conversation.id, sens: "ENTRANT", texte: "Merci, je regarde ce soir", statut: "RECU", recuLe: ilYA(4 * H), createdAt: ilYA(4 * H), dossierId: ids.dossier, clientId: ids.client } });
  await prisma.sms.create({ data: { conversationId: conversation.id, sens: "SORTANT", texte: "Bien reçu, je vous réponds vite", statut: "ENVOYE", origine: "ACCUSE_AUTO", createdAt: ilYA(4 * H + 60_000), dossierId: ids.dossier, clientId: ids.client } });
  await prisma.sms.create({ data: { conversationId: conversation.id, sens: "SORTANT", texte: "Je passe demain", statut: "ENVOYE", origine: "MANUEL", createdAt: ilYA(4 * H + 120_000), dossierId: ids.dossier, clientId: ids.client } });

  // Événements : trois dépôts de photos (groupés), un devis envoyé (argent), un changement d'étape (phrase), un vieux (hors borne).
  for (let i = 0; i < 3; i++) await prisma.dossierEvenement.create({ data: { dossierId: ids.dossier, type: "ESPACE_PHOTOS", direction: "ENTRANT", contenu: `Le client a déposé ${i + 1} photo(s)`, createdAt: ilYA(6 * H + i * 60_000) } });
  await prisma.dossierEvenement.create({ data: { dossierId: ids.dossier, type: "DEVIS_ENVOYE", direction: "SORTANT", contenu: "Devis 2026-041 envoyé", metadata: JSON.stringify({ documentId: "doc-essai" }), createdAt: ilYA(7 * H) } });
  await prisma.dossierEvenement.create({ data: { dossierId: ids.dossierAutre, type: "CHANGEMENT_ETAPE", direction: "INTERNE", contenu: "Qualification → Simulation", metadata: JSON.stringify({ de: "QUALIFICATION", vers: "SIMULATION" }), createdAt: ilYA(8 * H) } });
  await prisma.dossierEvenement.create({ data: { dossierId: ids.dossierAutre, type: "NOTE_AJOUTEE", direction: "INTERNE", contenu: "Très vieille note", createdAt: ilYA(40 * J) } });
  // Un mail envoyé qui n'est pas une relance : exclu ; un SMS copié portant une relance : « Relance envoyée par SMS ».
  await prisma.dossierEvenement.create({ data: { dossierId: ids.dossier, type: "MAIL_ENVOYE", direction: "SORTANT", contenu: "Mail envoyé : réponse", metadata: "{}", createdAt: ilYA(9 * H) } });
  await prisma.dossierEvenement.create({ data: { dossierId: ids.dossier, type: "SMS_COPIE", direction: "SORTANT", contenu: "SMS copié : relance du devis", metadata: JSON.stringify({ relance: { documentId: "doc-essai" } }), createdAt: ilYA(9 * H) } });

  // Devis relu trois fois, appel noté, paiement reçu, notification partie, mail en échec.
  await prisma.document.create({ data: { dossierId: ids.dossier, type: "DEVIS", numero: "2026-041", objet: "Cuisine", lignes: "[]", totalHt: 1500, statut: "ENVOYE", consultations: 3, consulteLe: ilYA(10 * H) } });
  await prisma.noteAppel.create({ data: { leadId: ids.lead, appelLe: ilYA(11 * H), texte: "Intéressé, veut un devis", issue: "INTERESSE" } });
  await prisma.encaissement.create({ data: { dossierId: ids.dossier, clientId: ids.client, payeur: "Nadia Essai", montant: 450, moyen: "VIREMENT", recuLe: ilYA(12 * H) } });
  await prisma.envoiMail.create({ data: { cle: "notif:essai:1", nature: "NOTIFICATION", modele: "DEVIS_DISPONIBLE", statut: "ENVOYE", a: "nadia@exemple.test", objet: "Votre devis est disponible", texte: "…", envoyeLe: ilYA(13 * H), dossierId: ids.dossier } });
  await prisma.envoiMail.create({ data: { cle: "reponse:essai:2", nature: "REPONSE", statut: "ECHEC", a: "paul@exemple.test", objet: "Réponse", texte: "…", dossierId: ids.dossierAutre } });

  // Propositions : une à valider (gestes), une ignorée.
  ids.proposition = (await prisma.proposition.create({ data: { type: "ENVOI_MAIL", auteur: "SYSTEME:relances", titre: "Relance du devis Essai", contenu: JSON.stringify({ motif: "RELANCE_DEVIS", a: "nadia@exemple.test", objet: "Votre devis", texte: "Bonjour", documentIds: [] }), dossierId: ids.dossier, cleUnicite: "journal-relance" } })).id;
  await prisma.proposition.create({ data: { type: "ENVOI_MAIL", auteur: "SYSTEME:relances", titre: "Relance ignorée", contenu: "{}", statut: "REJETEE", decideLe: ilYA(14 * H), decidePar: "HUMAIN:essai", motifRejet: "INUTILE", dossierId: ids.dossierAutre, cleUnicite: "journal-ignoree" } });

  // Claude a modifié un dossier et un lead ; un humain a modifié un client (pas « Claude a … »).
  await prisma.modificationDossier.create({ data: { dossierId: ids.dossier, champs: JSON.stringify([{ champ: "dateChantier", libelle: "Date du chantier", texteAvant: "—", texteApres: "12 octobre" }]), par: "ASSISTANT:claude", commande: "décale la pose au 12 octobre" } });
  await prisma.modificationAssistant.create({ data: { entite: "LEAD", enregistrementId: ids.lead, nom: "Lead Omar Appel", champs: JSON.stringify([{ champ: "ville", libelle: "Ville", avant: "Sète", apres: "Agde" }]), par: "ASSISTANT:claude" } });
  await prisma.modificationAssistant.create({ data: { entite: "CLIENT", enregistrementId: ids.client, nom: "Client Nadia Essai", champs: "[]", par: "HUMAIN:essai" } });

  // Faits système : une tâche en échec définitif (deux fois le même type : groupées), un travail en échec, la sauvegarde
  // du jour, un travail réussi (battement, exclu), deux alertes non remises de la même origine (groupées), une remise.
  await prisma.tache.create({ data: { type: "envoyer-mail", cle: "journal-tache-1", statut: "ECHEC_DEFINITIF", derniereErreur: "SMTP injoignable", demandeePar: "SYSTEME:essai", termineLe: ilYA(15 * H) } });
  await prisma.tache.create({ data: { type: "envoyer-mail", cle: "journal-tache-2", statut: "ECHEC_DEFINITIF", derniereErreur: "SMTP injoignable", demandeePar: "SYSTEME:essai", termineLe: ilYA(16 * H) } });
  await prisma.planification.create({ data: { nom: "releve-mails", dernierStatut: "ECHEC", derniereErreur: "jeton expiré", dernierFin: ilYA(17 * H) } });
  await prisma.planification.create({ data: { nom: "sauvegarde-quotidienne", dernierStatut: "SUCCES", dernierFin: ilYA(18 * H) } });
  await prisma.planification.create({ data: { nom: "controle-coherence", dernierStatut: "SUCCES", dernierFin: ilYA(18 * H) } });
  await prisma.alerteEnvoi.create({ data: { origine: "lead-meta", abouti: false, pousse: false, resultats: "[]", createdAt: ilYA(19 * H) } });
  await prisma.alerteEnvoi.create({ data: { origine: "lead-meta", abouti: false, pousse: false, resultats: "[]", createdAt: ilYA(20 * H) } });
  await prisma.alerteEnvoi.create({ data: { origine: "sms-recu", abouti: true, pousse: true, resultats: "[]", createdAt: ilYA(20 * H) } });
  fin = new Date();
});

after(async () => {
  await prisma.$disconnect();
});

const tout = () => journal.journal({ depuis: ilYA(2 * J), jusqua: fin, parPage: 200 });
const trouver = (entrees: import("@/lib/chronologie/journal").EntreeJournal[], motif: RegExp) => entrees.find((e) => motif.test(e.titre));

describe("journal : chaque source rend une phrase, jamais une ligne brute", () => {
  test("mail reçu hors bruit (le BRUIT et le mail envoyé n'y sont pas), avec la personne et le lien vers la boîte", async () => {
    const { entrees } = await tout();
    const mail = trouver(entrees, /^Mail reçu de Nadia Essai — Une question sur le devis$/);
    assert.ok(mail);
    assert.deepEqual([mail.filtre, mail.clientNom, mail.lien, mail.direction, mail.messageId], ["CLIENTS", "Nadia Essai", `/mail?mail=${ids.mail}`, "ENTRANT", ids.mail]);
    assert.equal(entrees.filter((e) => /Offre du jour|Re: Une question/.test(e.titre)).length, 0);
  });

  test("message d'espace : une seule ligne, l'événement jumeau du dossier est dédoublonné", async () => {
    const { entrees } = await tout();
    const lignes = entrees.filter((e) => /avancer la pose/.test(`${e.titre} ${e.texte}`));
    assert.equal(lignes.length, 1);
    assert.deepEqual([lignes[0].id.startsWith("message-espace:"), lignes[0].titre, lignes[0].texte, lignes[0].lien], [true, "Message du client depuis son espace", "« Peut-on avancer la pose ? »", `/dossiers?dossier=${ids.dossier}`]);
  });

  test("SMS reçu et accusé automatique parti ; le SMS manuel du gérant n'est pas une ligne", async () => {
    const { entrees } = await tout();
    assert.equal(trouver(entrees, /^SMS reçu$/)?.texte, "« Merci, je regarde ce soir »");
    assert.ok(trouver(entrees, /^Accusé de réception envoyé par SMS$/));
    assert.equal(entrees.filter((e) => /Je passe demain/.test(e.texte ?? "")).length, 0);
  });

  test("le bruit est groupé : trois dépôts de photos = une ligne avec 3 occurrences, la plus récente", async () => {
    const { entrees } = await tout();
    const photos = entrees.filter((e) => e.type === "ESPACE_PHOTOS");
    assert.equal(photos.length, 1);
    assert.deepEqual([photos[0].occurrences, photos[0].titre, photos[0].texte], [3, "Photos déposées par le client", "Le client a déposé 1 photo(s)"]);
  });

  test("devis envoyé → ARGENT ; changement d'étape en phrase ; relance par SMS copié ; mail envoyé sans relance exclu", async () => {
    const { entrees } = await tout();
    assert.equal(trouver(entrees, /^Devis envoyé$/)?.filtre, "ARGENT");
    assert.equal(trouver(entrees, /^Passé en Simulation$/)?.clientNom, "Paul Autre");
    assert.ok(trouver(entrees, /^Relance du devis envoyée par SMS$/));
    assert.equal(entrees.filter((e) => e.type === "MAIL_ENVOYE").length, 0);
    for (const e of entrees) assert.ok(!/^[A-Z_]+$/.test(e.titre), `ligne brute : ${e.titre}`);
  });

  test("devis relu N fois (compteur du devis), appel noté, main passée au client, paiement reçu en argent", async () => {
    const { entrees } = await tout();
    assert.equal(trouver(entrees, /^Devis 2026-041 relu 3 fois$/)?.filtre, "CLIENTS");
    assert.deepEqual([trouver(entrees, /^Appel — /)?.titre, trouver(entrees, /^Appel — /)?.lien, trouver(entrees, /^Appel — /)?.clientNom], ["Appel — Intéressé", `/leads?lead=${ids.lead}`, "Omar Appel"]);
    assert.equal(trouver(entrees, /^La main est passée au client$/)?.texte, "Devis envoyé : en attente de sa réponse");
    const paiement = trouver(entrees, /^Paiement reçu : 450 € par virement$/);
    assert.deepEqual([paiement?.filtre, paiement?.famille], ["ARGENT", "PAIEMENT"]);
    assert.equal(entrees.filter((e) => e.type === "ENCAISSEMENT_ENREGISTRE").length, 1, "le paiement n'est pas en double avec son événement");
  });

  test("notification partie (clients) et mail non parti (système) ; propositions : à valider avec ses gestes, ignorée", async () => {
    const { entrees } = await tout();
    assert.equal(trouver(entrees, /^Notification envoyée par mail : « Votre devis est disponible »$/)?.filtre, "CLIENTS");
    assert.equal(trouver(entrees, /^Mail non parti : « Réponse »$/)?.filtre, "SYSTEME");
    const aValider = trouver(entrees, /^À valider : Relance du devis Essai$/);
    assert.deepEqual([aValider?.gestes, aValider?.lien, aValider?.filtre], [{ valider: `/api/validation/${ids.proposition}/valider`, ignorer: `/api/validation/${ids.proposition}/rejeter` }, `/validation?proposition=${ids.proposition}`, "CLIENTS"]);
    assert.equal(trouver(entrees, /^Proposition ignorée : Relance ignorée$/)?.gestes, undefined);
  });

  test("« Claude a modifié » (dossier et lead, système, acteur Claude) ; la modification d'un humain n'y est pas", async () => {
    const { entrees } = await tout();
    const dossier = trouver(entrees, /^Claude a modifié le dossier$/);
    assert.deepEqual([dossier?.texte, dossier?.acteur, dossier?.filtre, dossier?.clientNom], ["Date du chantier : — → 12 octobre", "Claude", "SYSTEME", "Nadia Essai"]);
    assert.equal(trouver(entrees, /^Claude a modifié Lead Omar Appel$/)?.texte, "Ville : Sète → Agde");
    assert.equal(entrees.filter((e) => /Nadia Essai$/.test(e.titre) && e.type === "MODIFICATION_ASSISTANT").length, 0);
  });

  test("faits système : échec définitif groupé par type, travail en échec, sauvegarde du jour ; battements et alertes remises exclus", async () => {
    const { entrees } = await tout();
    const echec = trouver(entrees, /^Tâche de fond en échec définitif : envoyer-mail$/);
    assert.deepEqual([echec?.occurrences, echec?.texte, echec?.filtre], [2, "SMTP injoignable", "SYSTEME"]);
    assert.equal(trouver(entrees, /^Travail périodique en échec : releve-mails$/)?.texte, "jeton expiré");
    assert.ok(trouver(entrees, /^Sauvegarde du jour faite$/));
    assert.equal(entrees.filter((e) => /controle-coherence/.test(e.titre)).length, 0);
    const alertes = entrees.filter((e) => e.type === "ALERTE_NON_REMISE");
    assert.deepEqual([alertes.length, alertes[0]?.occurrences, alertes[0]?.titre], [1, 2, "Alerte non remise (lead-meta) : aucun canal n'a abouti"]);
  });
});

describe("journal : période, filtres, pagination, compteurs", () => {
  test("depuis est borné à 30 jours : la vieille note n'y est pas, même demandée ; le tri est du plus récent au plus ancien", async () => {
    const r = await journal.journal({ depuis: ilYA(90 * J), jusqua: fin, parPage: 200 });
    assert.equal(r.entrees.filter((e) => /Très vieille note/.test(e.texte ?? "")).length, 0);
    assert.ok(new Date(r.depuis).getTime() >= fin.getTime() - 30 * J - 1000);
    for (let i = 1; i < r.entrees.length; i++) assert.ok(r.entrees[i - 1].le >= r.entrees[i].le);
    assert.deepEqual(journal.bornerPeriode(new Date(fin.getTime() + J), fin).depuis, fin, "jamais après jusqua");
  });

  test("filtres : ARGENT seul, puis CLIENTS + SYSTEME ; les compteurs restent ceux de toute la période", async () => {
    const complet = await tout();
    const argent = await journal.journal({ depuis: ilYA(2 * J), jusqua: fin, filtres: ["ARGENT"], parPage: 200 });
    assert.ok(argent.total >= 2);
    assert.ok(argent.entrees.every((e) => e.filtre === "ARGENT"));
    assert.deepEqual(argent.compteurs, complet.compteurs);
    const sansArgent = await journal.journal({ depuis: ilYA(2 * J), jusqua: fin, filtres: ["CLIENTS", "SYSTEME"], parPage: 200 });
    assert.equal(sansArgent.total + argent.total, complet.total);
    assert.equal(complet.compteurs.CLIENTS + complet.compteurs.ARGENT + complet.compteurs.SYSTEME, complet.total);
  });

  test("pagination : 5 par page, les pages se suivent sans trou ni doublon ; une page trop loin ramène à la dernière", async () => {
    const complet = await tout();
    const vus: string[] = [];
    const premiere = await journal.journal({ depuis: ilYA(2 * J), jusqua: fin, page: 1, parPage: 5 });
    assert.deepEqual([premiere.entrees.length, premiere.pages], [5, Math.ceil(complet.total / 5)]);
    for (let p = 1; p <= premiere.pages; p++) vus.push(...(await journal.journal({ depuis: ilYA(2 * J), jusqua: fin, page: p, parPage: 5 })).entrees.map((e) => e.id));
    assert.deepEqual(vus, complet.entrees.map((e) => e.id));
    assert.equal((await journal.journal({ depuis: ilYA(2 * J), jusqua: fin, page: 99, parPage: 5 })).page, premiere.pages);
  });

  test("depuisDerniereVisite sans paramètre : 48 h ; après « Tout vu », depuis l'instant posé (JOURNAL_VU_LE), et plus rien", async () => {
    const avant = await journal.depuisDerniereVisite(fin);
    assert.equal(avant.vuLe, null);
    assert.ok(Math.abs(avant.depuis.getTime() - (fin.getTime() - 48 * H)) < 1000);
    assert.equal(avant.total, (await tout()).total);
    assert.equal(journal.phraseCompteurs(avant.compteurs), `${avant.total} faits (clients ${avant.compteurs.CLIENTS}, argent ${avant.compteurs.ARGENT}, système ${avant.compteurs.SYSTEME})`);

    const vu = await journal.marquerJournalVu(new Date(fin.getTime() + 500), "essai");
    const apres = await journal.depuisDerniereVisite(new Date(fin.getTime() + 1000));
    assert.deepEqual([apres.vuLe?.toISOString(), apres.depuis.toISOString(), apres.total], [vu.toISOString(), vu.toISOString(), 0]);
    const lignes = await prisma.parametre.findMany({ where: { cle: "JOURNAL_VU_LE" } });
    assert.deepEqual([lignes.length, JSON.parse(lignes[0].valeur), lignes[0].source], [1, vu.toISOString(), "essai"]);
    // Un second « Tout vu » ajoute une ligne (historique), ne remplace rien.
    await journal.marquerJournalVu(new Date(fin.getTime() + 2000));
    assert.equal(await prisma.parametre.count({ where: { cle: "JOURNAL_VU_LE" } }), 2);
  });
});
