#!/usr/bin/env node
// Mission 22 (A6) — la base de démonstration de la v2, après `node seed.mjs` (facultatif : le script se suffit).
//
// Écrit un jeu de données FICTIVES ET NEUTRES (prénoms et noms génériques, villes génériques, numéros de la plage
// réservée à la fiction 06 39 98 xx xx, adresses inventées) qui couvre tout ce que le scénario de docs/COMMENT-TESTER-V2.md
// doit montrer : un contact à appeler, un rappel en retard, quatre dossiers à des étapes différentes (dont un chez le
// client avec un devis relu deux fois), une facture en retard, un chèque à créditer, une proposition en attente, un
// message d'espace non lu, une tâche de fond en échec, un appel noté. Rejouable : chaque élément n'est écrit qu'une
// fois (reconnu à son numéro, son nom, sa clé). Rien n'est supprimé.
//
//   DATABASE_URL=file:./essai-v2.db node scripts/demo-v2.mjs      (depuis la racine ; le chemin est relatif à prisma/)
//
// Les tâches d'Aujourd'hui se déduisent de ces données au passage des détecteurs : « Actualiser » dans Aujourd'hui,
// ou le passage automatique toutes les 15 minutes du serveur.
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const JOUR = 86_400_000;
const HEURE = 3_600_000;
const maintenant = new Date();
/** Les faits d'un autre jour sont datés d'une heure de bureau (9 h 30), pas de l'heure où le script tourne. */
const ancreDuJour = new Date(maintenant);
ancreDuJour.setHours(9, 30, 0, 0);
const ilYA = (jours, heures = 0) => new Date((jours >= 1 ? ancreDuJour : maintenant).getTime() - jours * JOUR - heures * HEURE);
const dans = (jours, heures = 0) => new Date(maintenant.getTime() + jours * JOUR + heures * HEURE);
/** Un jour à midi UTC, comme `dateDepuisJour` du CRM (une date de prochaine action est « au jour »). */
const jour = (decalageJours) => {
  const d = new Date(maintenant.getTime() + decalageJours * JOUR);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 12));
};
const annee = maintenant.getFullYear();

const ecrits = [];
const note = (quoi) => ecrits.push(quoi);

async function lead({ prenom, nom, ville, cp, telephone, source, statut, ...reste }) {
  const existant = await prisma.lead.findFirst({ where: { telephone } });
  if (existant) return existant;
  note(`contact ${prenom} ${nom}`);
  return prisma.lead.create({ data: { prenom, nom, ville, codePostal: cp, telephone, source, statut, typeProjet: "CUISINE", ...reste } });
}

async function client({ prenom, nom, ville, adresse, cp, telephone, email, source, depuis }) {
  const complet = `${prenom} ${nom}`;
  const existant = await prisma.client.findFirst({ where: { nom: complet, fusionneDansId: null } });
  if (existant) return existant;
  note(`client ${complet}`);
  return prisma.client.create({
    data: {
      categorie: "PARTICULIER",
      nom: complet,
      prenom,
      nomFamille: nom,
      adresse,
      codePostal: cp,
      ville,
      source,
      premierContactLe: depuis,
      createdAt: depuis,
      emails: email ? { create: [{ adresse: email, principale: true }] } : undefined,
      telephones: telephone ? { create: [{ numero: `+33${telephone.slice(1)}`, saisi: telephone, principal: true }] } : undefined,
    },
  });
}

async function dossier(personne, { objet, etape, prestations, ouvertIlYA, main, mainLe, mainMotif, prochaineAction, prochaineActionDate, montantEstime, dateChantier, evenements }) {
  const existant = await prisma.dossier.findFirst({ where: { clientNom: personne.nom, objet } });
  if (existant) return existant;
  note(`dossier ${personne.nom} — ${objet}`);
  const cree = await prisma.dossier.create({
    data: {
      clientId: personne.id,
      clientNom: personne.nom,
      clientAdresse: personne.adresse ?? "",
      clientCp: personne.codePostal ?? "",
      clientVille: personne.ville ?? "",
      clientEmail: personne.email ?? null,
      clientTelephone: personne.telephone ?? "",
      objet,
      source: "ENTRANT",
      etape,
      prestations: JSON.stringify(prestations),
      prestationsLe: ilYA(ouvertIlYA),
      prestationsPar: "LUCAS",
      createdAt: ilYA(ouvertIlYA),
      main,
      mainLe,
      mainMotif,
      prochaineAction: prochaineAction ?? null,
      prochaineActionDate: prochaineActionDate ?? null,
      montantEstime: montantEstime ?? null,
      dateChantier: dateChantier ?? null,
    },
  });
  await prisma.dossierEvenement.createMany({
    data: [
      { dossierId: cree.id, type: "CHANGEMENT_ETAPE", direction: "INTERNE", contenu: "Dossier ouvert : Qualification", metadata: JSON.stringify({ de: null, vers: "QUALIFICATION", nature: "OUVERTURE" }), createdAt: ilYA(ouvertIlYA) },
      ...evenements.map((e) => ({ dossierId: cree.id, direction: "INTERNE", metadata: "{}", ...e })),
    ],
  });
  return cree;
}

async function document(dossierId, { type, numero, statut, totalHt, objet, emisIlYA, consultations, acomptePct, echeance }) {
  const existant = await prisma.document.findFirst({ where: { type, numero } });
  if (existant) return existant;
  note(`${type.toLowerCase()} ${numero}`);
  const emis = ilYA(emisIlYA);
  const cree = await prisma.document.create({
    data: {
      dossierId,
      type,
      numero,
      dateEmission: emis,
      objet,
      lignes: JSON.stringify([{ type: "PRESTATION", designation: objet, quantite: 1, unite: "forfait", prixUnitaire: totalHt }]),
      totalHt,
      acomptePct: acomptePct ?? null,
      statut,
      origine: "CRM",
      visibleEspace: true,
      consultations: consultations ?? 0,
      consulteLe: consultations ? ilYA(1, 3) : null,
      echeanceLe: echeance ?? null,
      createdAt: emis,
    },
  });
  // Le registre des numéros, lu par Argent (factures à encaisser) et par le contrôle de numérotation.
  const famille = type === "DEVIS" ? "" : "F";
  const rang = Number(numero.split("-").pop());
  await prisma.numeroDocument.upsert({
    where: { cle: `${famille}:${annee}:${rang}` },
    update: {},
    create: { cle: `${famille}:${annee}:${rang}`, numero, famille, annee, rang, type, origine: "CRM", documentId: cree.id, emisLe: emis, destinataire: (await prisma.dossier.findUnique({ where: { id: dossierId }, select: { clientNom: true } }))?.clientNom ?? null, montant: totalHt },
  });
  return cree;
}

async function encaissement(personne, dossierLie, { montant, moyen, reference, recuIlYA, factureId }) {
  if (await prisma.encaissement.findFirst({ where: { reference } })) return;
  note(`paiement ${reference}`);
  const registre = factureId ? await prisma.numeroDocument.findUnique({ where: { documentId: factureId } }) : null;
  await prisma.encaissement.create({
    data: {
      clientId: personne.id,
      dossierId: dossierLie.id,
      payeur: personne.nom,
      montant,
      moyen,
      reference,
      recuLe: ilYA(recuIlYA),
      statut: "VALIDE",
      affectations: registre ? { create: [{ numeroDocumentId: registre.id, montant, statut: "ACTIVE" }] } : undefined,
    },
  });
}

async function main() {
  // ── Personnes ──────────────────────────────────────────────────────────────
  // Un contact jamais appelé, arrivé il y a deux heures (« À appeler », la tâche « Appeler » d'Aujourd'hui).
  await lead({ prenom: "Camille", nom: "Durand", ville: "Montpellier", cp: "34000", telephone: "0639980001", source: "SITE_DEVIS", statut: "NOUVEAU", createdAt: ilYA(0, 2), message: "Bonjour, je voudrais un devis pour les façades de ma cuisine (environ 6 m)." });
  // Un rappel en retard : appelé il y a trois jours, rappel prévu hier 18 h, pas encore rappelé.
  const aRappeler = await lead({ prenom: "Julien", nom: "Moreau", ville: "Lattes", cp: "34970", telephone: "0639980002", source: "META_ADS", statut: "CONTACTE", createdAt: ilYA(4), dernierAppelLe: ilYA(3), rappelLe: new Date(ilYA(1).setUTCHours(16, 0, 0, 0)), tentatives: 0 });
  // Un contact plus ancien, à appeler aussi (la liste « À appeler » a deux lignes).
  await lead({ prenom: "Sophie", nom: "Bernard", ville: "Nîmes", cp: "30000", telephone: "0639980003", source: "SITE_SIMULATEUR", statut: "NOUVEAU", createdAt: ilYA(1, -8) });

  // D'autres contacts à appeler (la liste dépasse cinq lignes : « Voir les N autres »).
  const autres = [
    ["Maxime", "Richard", "Béziers", "34500", "0639980004", "SITE_CONTACT", 0, 5],
    ["Chloé", "Mercier", "Castelnau-le-Lez", "34170", "0639980005", "META_ADS", 0, 9],
    ["Romain", "Thomas", "Sète", "34200", "0639980006", "SITE_DEVIS", 2, 0],
    ["Pauline", "Girard", "Lunel", "34400", "0639980007", "ORGANIQUE", 3, 4],
    ["Quentin", "Martin", "Juvignac", "34990", "0639980008", "SITE_SIMULATEUR", 5, 0],
  ];
  for (const [prenom, nom, ville, cp, telephone, source, j, h] of autres) {
    await lead({ prenom, nom, ville, cp, telephone, source, statut: "NOUVEAU", createdAt: ilYA(j, h) });
  }
  // Un contact sans suite (motif noté) et un archivé : les segments « Sans suite » et « Archivés » ne sont pas vides.
  await lead({ prenom: "Nicolas", nom: "Fournier", ville: "Nîmes", cp: "30000", telephone: "0639980009", source: "META_ADS", statut: "PERDU", createdAt: ilYA(15), dernierAppelLe: ilYA(13), motifPerte: "TROP_CHER", perteLe: ilYA(13), tentatives: 0 });
  await lead({ prenom: "Laura", nom: "Bonnet", ville: "Montpellier", cp: "34000", telephone: "0639980010", source: "SITE_CONTACT", statut: "NOUVEAU", createdAt: ilYA(30), archiveLe: ilYA(28), archiveMotif: "Test" });

  if (!(await prisma.noteAppel.findFirst({ where: { leadId: aRappeler.id } }))) {
    note("appel noté");
    await prisma.noteAppel.create({ data: { leadId: aRappeler.id, appelLe: ilYA(1, 4), texte: "Intéressé par un rendu chêne clair, veut comparer avec un autre devis.", etiquettes: JSON.stringify(["VEUT_REFLECHIR"]), issue: "A_RAPPELER" } });
  }

  // ── Clients et dossiers ────────────────────────────────────────────────────
  const marie = await client({ prenom: "Marie", nom: "Petit", ville: "Montpellier", adresse: "12 rue des Lilas", cp: "34000", telephone: "0639980011", email: "marie.petit@exemple.test", source: "SITE_DEVIS", depuis: ilYA(10) });
  const thomas = await client({ prenom: "Thomas", nom: "Roux", ville: "Castelnau-le-Lez", adresse: "4 allée des Platanes", cp: "34170", telephone: "0639980012", email: null, source: "SITE_CONTACT", depuis: ilYA(1) });
  const lea = await client({ prenom: "Léa", nom: "Garcia", ville: "Lattes", adresse: "8 impasse des Oliviers", cp: "34970", telephone: "0639980013", email: "lea.garcia@exemple.test", source: "RECOMMANDATION", depuis: ilYA(20) });
  const hugo = await client({ prenom: "Hugo", nom: "Lambert", ville: "Nîmes", adresse: "27 avenue des Cévennes", cp: "30000", telephone: "0639980014", email: "hugo.lambert@exemple.test", source: "META_ADS", depuis: ilYA(45) });

  // 1. Chez le client : devis envoyé il y a quatre jours, relu deux fois, à relancer demain ; un message non lu.
  const dMarie = await dossier(marie, {
    objet: "Façades de cuisine en chêne clair",
    etape: "DEVIS_ENVOYE",
    prestations: { CUISINE: ["facades-hautes", "facades-basses", "plan-de-travail"] },
    ouvertIlYA: 10,
    main: "CLIENT",
    mainLe: ilYA(4, 1),
    mainMotif: "Devis envoyé : en attente de sa réponse",
    prochaineAction: "Relancer",
    prochaineActionDate: jour(1),
    montantEstime: 2400,
    evenements: [
      { type: "NOTE_AJOUTEE", contenu: "Appel : veut un rendu chêne clair, cuisine en L d'environ 6 m.", createdAt: ilYA(8) },
      { type: "CHANGEMENT_ETAPE", contenu: "Photos reçues, visuels à préparer", metadata: JSON.stringify({ de: "QUALIFICATION", vers: "SIMULATION", nature: "SUIVANTE" }), createdAt: ilYA(7) },
      { type: "ESPACE_SIMULATION_CHOISIE", direction: "ENTRANT", contenu: "Simulation choisie par le client : chêne clair", createdAt: ilYA(5) },
      { type: "DEVIS_GENERE", contenu: `Devis ${annee}-101 généré`, metadata: JSON.stringify({ envoye: true }), createdAt: ilYA(4, 1) },
      { type: "CHANGEMENT_ETAPE", contenu: "Devis prêt et transmis au client", metadata: JSON.stringify({ de: "SIMULATION", vers: "DEVIS_ENVOYE", nature: "SUIVANTE" }), createdAt: ilYA(4, 1) },
      { type: "DEVIS_ENVOYE", direction: "SORTANT", contenu: `Devis ${annee}-101 envoyé par mail`, createdAt: ilYA(4, 1) },
    ],
  });
  await document(dMarie.id, { type: "DEVIS", numero: `${annee}-101`, statut: "ENVOYE", totalHt: 2380, objet: "Façades de cuisine en chêne clair", emisIlYA: 4, consultations: 2, acomptePct: 30 });
  if (!(await prisma.espaceClient.findUnique({ where: { code: "demo-marie" } }))) {
    note("espace client");
    await prisma.espaceClient.create({ data: { code: "demo-marie", dossierId: dMarie.id, expireLe: dans(60), premierAccesLe: ilYA(6), dernierAccesLe: ilYA(1, 3), nbAcces: 5, devisConsultations: 2, devisConsulteLe: ilYA(1, 3), createdAt: ilYA(7) } });
  }
  if (!(await prisma.messageEspace.findFirst({ where: { dossierId: dMarie.id, auteur: "CLIENT" } }))) {
    note("message d'espace");
    await prisma.messageEspace.create({ data: { dossierId: dMarie.id, auteur: "CLIENT", source: "MESSAGE", texte: "Bonjour, le plan de travail est-il compris dans le devis ? Merci.", createdAt: ilYA(0, 3) } });
  }

  // 2. À moi : demande du site d'hier, à appeler aujourd'hui.
  await dossier(thomas, {
    objet: "Salle de bain",
    etape: "QUALIFICATION",
    prestations: { SDB: ["meuble-vasque"] },
    ouvertIlYA: 1,
    main: "MOI",
    mainLe: ilYA(1),
    mainMotif: "Demande du site : le rappeler",
    prochaineAction: "Appeler : demande de devis",
    prochaineActionDate: jour(0),
    montantEstime: 900,
    evenements: [{ type: "ESPACE_DEMANDE_SITE", direction: "ENTRANT", contenu: "Demande de devis depuis le site : salle de bain, meuble vasque", createdAt: ilYA(1) }],
  });

  // 3. Signé il y a six jours, acompte reçu par chèque (à créditer), date de chantier à fixer.
  const dLea = await dossier(lea, {
    objet: "Cuisine complète, façades et crédence",
    etape: "SIGNE",
    prestations: { CUISINE: ["facades-hautes", "facades-basses", "credence"] },
    ouvertIlYA: 20,
    main: "MOI",
    mainLe: ilYA(6),
    mainMotif: "Devis signé : fixer la date du chantier",
    prochaineAction: "Fixer la date du chantier",
    prochaineActionDate: jour(-2),
    montantEstime: 1800,
    evenements: [
      { type: "DEVIS_GENERE", contenu: `Devis ${annee}-098 généré`, metadata: JSON.stringify({ envoye: true }), createdAt: ilYA(12) },
      { type: "DEVIS_ENVOYE", direction: "SORTANT", contenu: `Devis ${annee}-098 envoyé par mail`, createdAt: ilYA(12) },
      { type: "CHANGEMENT_ETAPE", contenu: "Devis prêt et transmis au client", metadata: JSON.stringify({ de: "QUALIFICATION", vers: "DEVIS_ENVOYE", nature: "SUIVANTE" }), createdAt: ilYA(12) },
      { type: "ESPACE_DEVIS_ACCEPTE", direction: "ENTRANT", contenu: `Bon pour accord donné dans l'espace client sur le devis ${annee}-098`, createdAt: ilYA(6) },
      { type: "CHANGEMENT_ETAPE", contenu: "Bon pour accord reçu", metadata: JSON.stringify({ de: "DEVIS_ENVOYE", vers: "SIGNE", nature: "SUIVANTE" }), createdAt: ilYA(6) },
    ],
  });
  await document(dLea.id, { type: "DEVIS", numero: `${annee}-098`, statut: "ACCEPTE", totalHt: 1800, objet: "Cuisine complète, façades et crédence", emisIlYA: 12, acomptePct: 30 });
  if (!(await prisma.encaissement.findFirst({ where: { reference: "4471023", moyen: "CHEQUE" } }))) {
    note("chèque à créditer");
    await prisma.encaissement.create({ data: { clientId: lea.id, dossierId: dLea.id, payeur: lea.nom, montant: 540, moyen: "CHEQUE", reference: "4471023", recuLe: ilYA(12), statut: "VALIDE", note: "Acompte de 30 % remis en main propre" } });
    await prisma.dossierEvenement.create({ data: { dossierId: dLea.id, type: "ENCAISSEMENT_ENREGISTRE", direction: "INTERNE", contenu: "Acompte de 540 € reçu par chèque", metadata: "{}", createdAt: ilYA(12) } });
  }

  // 4. Facturé il y a 25 jours, rien reçu : la facture est en retard (Argent en rouge).
  const dHugo = await dossier(hugo, {
    objet: "Meubles de salon",
    etape: "FACTURE",
    prestations: { MEUBLES: ["meuble-tv", "bibliotheque"] },
    ouvertIlYA: 45,
    main: "MOI",
    mainLe: ilYA(25),
    mainMotif: "Facture envoyée : à encaisser",
    prochaineAction: "Encaisser",
    prochaineActionDate: jour(-10),
    montantEstime: 1840,
    evenements: [
      { type: "CHANGEMENT_ETAPE", contenu: "Pose commencée", metadata: JSON.stringify({ de: "PLANIFIE", vers: "CHANTIER", nature: "SUIVANTE" }), createdAt: ilYA(28) },
      { type: "FACTURE_GENEREE", contenu: `Facture F-${annee}-044 générée`, createdAt: ilYA(25) },
      { type: "CHANGEMENT_ETAPE", contenu: "Pose terminée, facture émise", metadata: JSON.stringify({ de: "CHANTIER", vers: "FACTURE", nature: "SUIVANTE" }), createdAt: ilYA(25) },
    ],
  });
  await document(dHugo.id, { type: "DEVIS", numero: `${annee}-090`, statut: "ACCEPTE", totalHt: 1840, objet: "Meubles de salon", emisIlYA: 40, acomptePct: 30 });
  await document(dHugo.id, { type: "FACTURE", numero: `F-${annee}-044`, statut: "ENVOYE", totalHt: 1840, objet: "Meubles de salon", emisIlYA: 25, echeance: ilYA(25) });

  // 5 à 7. Un chantier planifié, un chantier en cours, un dossier encaissé : la liste « Chez moi » dépasse cinq lignes.
  const anna = await client({ prenom: "Anna", nom: "Lefebvre", ville: "Pérols", adresse: "3 rue des Mimosas", cp: "34470", telephone: "0639980015", email: "anna.lefebvre@exemple.test", source: "BOUCHE_A_OREILLE", depuis: ilYA(30) });
  const dAnna = await dossier(anna, {
    objet: "Crédence et plan de travail",
    etape: "PLANIFIE",
    prestations: { CUISINE: ["plan-de-travail", "credence"] },
    ouvertIlYA: 30,
    main: "MOI",
    mainLe: ilYA(3),
    mainMotif: "Chantier planifié : préparer la pose",
    prochaineAction: "Commander la matière",
    prochaineActionDate: jour(2),
    montantEstime: 1150,
    dateChantier: jour(9),
    evenements: [
      { type: "DEVIS_GENERE", contenu: `Devis ${annee}-095 généré`, metadata: JSON.stringify({ envoye: true }), createdAt: ilYA(16) },
      { type: "CHANGEMENT_ETAPE", contenu: "Bon pour accord reçu", metadata: JSON.stringify({ de: "DEVIS_ENVOYE", vers: "SIGNE", nature: "SUIVANTE" }), createdAt: ilYA(8) },
      { type: "CHANGEMENT_ETAPE", contenu: "Date de pose convenue avec le client", metadata: JSON.stringify({ de: "SIGNE", vers: "PLANIFIE", nature: "SUIVANTE" }), createdAt: ilYA(3) },
    ],
  });
  await document(dAnna.id, { type: "DEVIS", numero: `${annee}-095`, statut: "ACCEPTE", totalHt: 1150, objet: "Crédence et plan de travail", emisIlYA: 16, acomptePct: 30 });
  await encaissement(anna, dAnna, { montant: 345, moyen: "VIREMENT", reference: "VIR-ACOMPTE-095", recuIlYA: 7 });

  const paul = await client({ prenom: "Paul", nom: "Marchand", ville: "Mauguio", adresse: "19 chemin des Vignes", cp: "34130", telephone: "0639980016", email: null, source: "SITE_DEVIS", depuis: ilYA(40) });
  const dPaul = await dossier(paul, {
    objet: "Portes de placard du couloir",
    etape: "CHANTIER",
    prestations: { SDB: ["portes-placard"] },
    ouvertIlYA: 40,
    main: "MOI",
    mainLe: ilYA(1),
    mainMotif: "Chantier en cours : facturer à la fin",
    prochaineAction: "Facturer",
    prochaineActionDate: jour(1),
    montantEstime: 760,
    dateChantier: jour(-1),
    evenements: [
      { type: "DEVIS_GENERE", contenu: `Devis ${annee}-093 généré`, metadata: JSON.stringify({ envoye: true }), createdAt: ilYA(20) },
      { type: "CHANGEMENT_ETAPE", contenu: "Bon pour accord reçu", metadata: JSON.stringify({ de: "DEVIS_ENVOYE", vers: "SIGNE", nature: "SUIVANTE" }), createdAt: ilYA(14) },
      { type: "CHANGEMENT_ETAPE", contenu: "Date de pose convenue avec le client", metadata: JSON.stringify({ de: "SIGNE", vers: "PLANIFIE", nature: "SUIVANTE" }), createdAt: ilYA(12) },
      { type: "CHANGEMENT_ETAPE", contenu: "Pose commencée", metadata: JSON.stringify({ de: "PLANIFIE", vers: "CHANTIER", nature: "SUIVANTE" }), createdAt: ilYA(1) },
    ],
  });
  await document(dPaul.id, { type: "DEVIS", numero: `${annee}-093`, statut: "ACCEPTE", totalHt: 760, objet: "Portes de placard du couloir", emisIlYA: 20, acomptePct: 30 });
  await encaissement(paul, dPaul, { montant: 228, moyen: "VIREMENT", reference: "VIR-ACOMPTE-093", recuIlYA: 13 });

  const ines = await client({ prenom: "Inès", nom: "Rousseau", ville: "Montpellier", adresse: "41 boulevard des Arceaux", cp: "34000", telephone: "0639980017", email: "ines.rousseau@exemple.test", source: "RECOMMANDATION", depuis: ilYA(60) });
  const dInes = await dossier(ines, {
    objet: "Façades de cuisine, effet pierre",
    etape: "ENCAISSE",
    prestations: { CUISINE: ["facades-hautes", "facades-basses"] },
    ouvertIlYA: 60,
    main: null,
    mainLe: null,
    mainMotif: null,
    montantEstime: 2100,
    dateChantier: jour(-20),
    evenements: [
      { type: "CHANGEMENT_ETAPE", contenu: "Pose terminée, facture émise", metadata: JSON.stringify({ de: "CHANTIER", vers: "FACTURE", nature: "SUIVANTE" }), createdAt: ilYA(19) },
      { type: "FACTURE_GENEREE", contenu: `Facture F-${annee}-041 générée`, createdAt: ilYA(19) },
      { type: "ENCAISSEMENT_ENREGISTRE", contenu: "Solde de 2 100 € reçu par virement", createdAt: ilYA(9) },
      { type: "CHANGEMENT_ETAPE", contenu: "Solde reçu, dossier terminé", metadata: JSON.stringify({ de: "FACTURE", vers: "ENCAISSE", nature: "SUIVANTE" }), createdAt: ilYA(9) },
    ],
  });
  const fInes = await document(dInes.id, { type: "FACTURE", numero: `F-${annee}-041`, statut: "ENVOYE", totalHt: 2100, objet: "Façades de cuisine, effet pierre", emisIlYA: 19, echeance: ilYA(19) });
  await encaissement(ines, dInes, { montant: 2100, moyen: "VIREMENT", reference: "VIR-SOLDE-041", recuIlYA: 9, factureId: fInes.id });

  // La règle de datation des chèques (sinon Argent demande de la renseigner avant toute liste).
  if (!(await prisma.parametre.findFirst({ where: { cle: "DATE_RECETTE_CHEQUE" } }))) {
    note("règle des chèques");
    await prisma.parametre.create({ data: { cle: "DATE_RECETTE_CHEQUE", valeur: JSON.stringify("RECEPTION"), valableDu: ilYA(90), source: "démonstration" } });
  }

  // ── À valider, système ─────────────────────────────────────────────────────
  await prisma.proposition.upsert({
    where: { cleUnicite: "demo-v2-note-marie" },
    update: {},
    create: {
      type: "NOTE_DOSSIER",
      statut: "EN_ATTENTE",
      auteur: "AGENT:mail",
      titre: `Ajouter une note au dossier de ${marie.nom}`,
      resume: "Le client écrit qu'il préfère un plan de travail effet pierre plutôt que le chêne.",
      raisonnement: "Un mail du client le dit en toutes lettres ; la note garde la trace dans le dossier.",
      confiance: 0.9,
      contenu: JSON.stringify({ dossierId: dMarie.id, texte: "Préfère un plan de travail effet pierre plutôt que le chêne (mail du client)." }),
      cleUnicite: "demo-v2-note-marie",
      dossierId: dMarie.id,
      clientId: marie.id,
      createdAt: ilYA(0, 5),
    },
  });
  await prisma.tache.upsert({
    where: { cle: "demo-v2:mail-envoi-echec" },
    update: {},
    create: { type: "MAIL_ENVOI", cle: "demo-v2:mail-envoi-echec", charge: JSON.stringify({ objet: "Devis disponible" }), statut: "ECHEC_DEFINITIF", tentatives: 8, tentativesMax: 8, prochainEssaiLe: ilYA(0, 2), commenceLe: ilYA(0, 2), termineLe: ilYA(0, 2), derniereErreur: "Serveur de mail injoignable (démonstration)", demandeePar: "SYSTEME:demo-v2", createdAt: ilYA(0, 6) },
  });

  console.log(ecrits.length ? `[démo v2] écrit : ${ecrits.join(", ")}` : "[démo v2] déjà en place, rien écrit");
  console.log(`[démo v2] contacts ${await prisma.lead.count()}, clients ${await prisma.client.count()}, dossiers ${await prisma.dossier.count()}, documents ${await prisma.document.count()}, propositions en attente ${await prisma.proposition.count({ where: { statut: "EN_ATTENTE" } })}`);
}

main()
  .catch((erreur) => {
    console.error("[démo v2] échec :", erreur instanceof Error ? erreur.message : erreur);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
