import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { preparerBaseEssai } from "@/test/base-essai";

/**
 * Mission 8 : la couche d'outils de l'assistant, sur une copie de base.
 * Refus attendus (suppression → archivage, facture sur un dossier non signé,
 * masse sans confirmation, client ambigu, plafond), journal avec la commande,
 * et les managers face à un calcul indépendant sur un jeu de données connu.
 */
preparerBaseEssai();
process.env.UPLOADS_DIR = mkdtempSync(path.join(tmpdir(), "coverswap-uploads-"));
for (const cle of ["META_PIXEL_ID", "META_ACCESS_TOKEN", "META_APP_SECRET", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_TOKEN_KEY", "NTFY_TOPIC", "TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID", "VAPID_PRIVATE_KEY", "RESEND_API_KEY", "ANTHROPIC_API_KEY"]) process.env[cle] = "";
process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3001";

let prisma: typeof import("@/lib/prisma").default;
let execution: typeof import("./execution");
let catalogue: typeof import("./catalogue");
let commercial: typeof import("./analyses/commercial");
let finances: typeof import("./analyses/finances");
let marketing: typeof import("./analyses/marketing");
let clientsAnalyse: typeof import("./analyses/clients");
let operations: typeof import("./analyses/operations");
let consignes: typeof import("./consignes");
let agenda: typeof import("./agenda");
let periodes: typeof import("./periodes");
let pointDuJour: typeof import("./outils/point-du-jour");
let transitions: typeof import("@/lib/dossiers/transitions");
let encaissements: typeof import("@/lib/encaissements/service");
let avecActeur: typeof import("@/lib/journal/contexte").avecActeur;
let session: import("./execution").Session;

const LUCAS = { acteur: "HUMAIN:lucas@coverswap.fr" };
let rang = 0;
async function lead(donnees: Record<string, unknown> = {}) {
  rang++;
  return prisma.lead.create({ data: { prenom: "Test", nom: `Lead${rang}`, telephone: `06 30 00 ${String(Math.floor(rang / 100)).padStart(2, "0")} ${String(rang % 100).padStart(2, "0")}`, email: `lead${rang}@exemple.fr`, ville: "Lattes", codePostal: "34970", source: "META_ADS", ...donnees } });
}
const appeler = (nom: string, entree: Record<string, unknown>, maintenant = new Date()) => {
  const outil = catalogue.outilParNom(nom);
  assert.ok(outil, `outil inconnu : ${nom}`);
  return execution.executerOutil(outil, entree, session, maintenant);
};
const LIGNES = [{ designation: "Revêtement adhésif — façades", quantite: 4, unite: "ml", prix_unitaire: 110 }];

before(async () => {
  prisma = (await import("@/lib/prisma")).default;
  execution = await import("./execution");
  catalogue = await import("./catalogue");
  commercial = await import("./analyses/commercial");
  finances = await import("./analyses/finances");
  marketing = await import("./analyses/marketing");
  clientsAnalyse = await import("./analyses/clients");
  operations = await import("./analyses/operations");
  consignes = await import("./consignes");
  agenda = await import("./agenda");
  periodes = await import("./periodes");
  pointDuJour = await import("./outils/point-du-jour");
  transitions = await import("@/lib/dossiers/transitions");
  encaissements = await import("@/lib/encaissements/service");
  avecActeur = (await import("@/lib/journal/contexte")).avecActeur;
  await (await import("@/lib/base/preparation")).preparerBase();
  session = await execution.ouvrirSession({ jetonId: "essai", clientNom: "Essai", utilisateur: "essai@local" });
});

after(async () => {
  await prisma.$disconnect();
});

describe("catalogue", () => {
  test("noms uniques, descriptions en français, niveaux posés ; mail, lien, facture, encaissement sont sensibles", () => {
    const noms = catalogue.CATALOGUE.map((o) => o.nom);
    assert.equal(new Set(noms).size, noms.length);
    for (const o of catalogue.CATALOGUE) {
      assert.match(o.nom, /^[a-z_]+$/, o.nom);
      assert.ok(o.description.length > 40, `${o.nom} : description trop courte`);
      assert.ok(["LECTURE", "REVERSIBLE", "SENSIBLE"].includes(o.niveau));
    }
    for (const nom of ["envoyer_document", "envoyer_lien_espace", "renouveler_lien", "saisir_encaissement", "annuler_encaissement", "envoyer_mail", "generer_document", "publier_simulation"]) {
      assert.equal(catalogue.outilParNom(nom)?.niveau, "SENSIBLE", nom);
    }
    const vue = catalogue.catalogueVue();
    assert.equal(vue.filter((o) => o.famille === "ANALYSE").length, 5);
    assert.ok(vue.filter((o) => o.famille === "LECTURE").length >= 10);
    assert.ok(vue.filter((o) => o.famille === "ECRITURE").length >= 18);
  });
});

describe("recherche, ambiguïté, refus", () => {
  let jean: { id: string };
  let marie: { id: string };
  let forestier: { id: string };
  let stella: { id: string };
  let piketty: { id: string };
  let dossierForestier: string;

  before(async () => {
    jean = await lead({ prenom: "Jean", nom: "Rousse", ville: "Montpellier", codePostal: "34000" });
    marie = await lead({ prenom: "Marie", nom: "Rousse" });
    forestier = await lead({ prenom: "Paul", nom: "Forestier", source: "SITE_DEVIS" });
    stella = await lead({ prenom: "Stella", nom: "Estelle" });
    piketty = await lead({ prenom: "Anne", nom: "Piketty" });
  });

  test("« chercher » tolère une faute et rend les deux Rousse", async () => {
    const r = await appeler("chercher", { texte: "Rouse" });
    const candidats = r.donnees as { leadId: string | null }[];
    assert.ok(candidats.some((c) => c.leadId === jean.id) && candidats.some((c) => c.leadId === marie.id), r.texte);
  });

  test("un nom ambigu rend les candidats, jamais un choix : lecture comme écriture, sans rien écrire", async () => {
    const fiche = await appeler("lire_fiche", { nom: "Rousse" });
    assert.match(fiche.texte, /Plusieurs contacts correspondent/);
    const avant = [await prisma.interaction.count(), await prisma.dossierNote.count(), await prisma.noteAppel.count()];
    const note = await appeler("ajouter_note", { nom: "Rousse", texte: "Rappelé ce matin", commande: "Mets une note sur Rousse" });
    assert.match(note.texte, /Plusieurs contacts correspondent/);
    assert.deepEqual([await prisma.interaction.count(), await prisma.dossierNote.count(), await prisma.noteAppel.count()], avant);
    const journal = await prisma.appelOutil.findFirst({ where: { outil: "ajouter_note", commande: "Mets une note sur Rousse" } });
    assert.equal(journal?.statut, "FAIT");
  });

  test("« Où en est le dossier Forestier ? » : ouverture du dossier puis fiche lisible", async () => {
    const ouverture = await appeler("ouvrir_dossier", { leadId: forestier.id, commande: "Ouvre le dossier Forestier" });
    dossierForestier = (ouverture.donnees as { dossierId: string }).dossierId;
    assert.ok(dossierForestier);
    const fiche = await appeler("lire_fiche", { nom: "Forestier" });
    assert.match(fiche.texte, /Forestier/);
    assert.doesNotMatch(fiche.texte, /^Refusé/);
    const dossier = await prisma.dossier.findUniqueOrThrow({ where: { id: dossierForestier } });
    assert.ok(dossier.ecriture?.includes("ASSISTANT:claude"), `acteur ASSISTANT attendu dans ${dossier.ecriture}`);
  });

  test("une note s'écrit avec l'acteur ASSISTANT et la commande d'origine dans le journal", async () => {
    const r = await appeler("ajouter_note", { nom: "Forestier", texte: "Mesures prises", commande: "Note sur Forestier : mesures prises" });
    assert.match(r.texte, /Note ajoutée/);
    const journal = await prisma.appelOutil.findFirst({ where: { outil: "ajouter_note", commande: "Note sur Forestier : mesures prises" } });
    assert.equal(journal?.statut, "FAIT");
    assert.ok(journal?.resume?.includes("Note ajoutée"));
    const note = await prisma.dossierNote.findFirst({ where: { dossierId: dossierForestier }, orderBy: { createdAt: "desc" } });
    assert.ok(note?.ecriture?.includes("ASSISTANT:claude"), `acteur ASSISTANT attendu dans ${note?.ecriture}`);
  });

  test("« supprimer » met à la corbeille (rien n'est effacé) ; « restaurer » remet", async () => {
    const r = await appeler("supprimer", { leads: [stella.id], motif: "test", commande: "Supprime Stella Estelle" });
    assert.match(r.texte, /^1 lead\(s\) à la corbeille \(motif : test\) : effacement le .* sauf « restaurer »/);
    const apres = await prisma.lead.findUniqueOrThrow({ where: { id: stella.id } });
    assert.ok(apres.archiveLe, "archivé");
    assert.match(apres.archiveMotif ?? "", /^Corbeille \(effacement le/);
    await appeler("restaurer", { leads: [stella.id] });
    assert.equal((await prisma.lead.findUniqueOrThrow({ where: { id: stella.id } })).archiveLe, null);
  });

  test("plus de trois éléments : aperçu, rien de fait ; puis confirmation ; un jeton ne sert qu'une fois et pour les mêmes paramètres", async () => {
    const ids = (await Promise.all([lead(), lead(), lead(), lead(), lead()])).map((l) => l.id);
    const apercu = await appeler("archiver", { leads: ids, motif: "doublon", commande: "Archive tous ces leads" });
    assert.ok(apercu.confirmation?.jeton, apercu.texte);
    assert.match(apercu.texte, /Rien n'a été fait/);
    assert.equal(await prisma.lead.count({ where: { id: { in: ids }, archiveLe: { not: null } } }), 0);
    const fait = await appeler("archiver", { leads: ids, motif: "doublon", confirmation: apercu.confirmation!.jeton, commande: "Archive tous ces leads" });
    assert.match(fait.texte, /5 lead\(s\) archivé\(s\)/);
    assert.equal(await prisma.lead.count({ where: { id: { in: ids }, archiveLe: { not: null } } }), 5);
    const rejoue = await appeler("archiver", { leads: ids, motif: "doublon", confirmation: apercu.confirmation!.jeton });
    assert.match(rejoue.texte, /^Refusé : Ce jeton de confirmation a déjà servi/);
    const autre = await appeler("archiver", { leads: ids, motif: "hors zone" });
    const change = await appeler("archiver", { leads: ids.slice(0, 4), motif: "hors zone", confirmation: autre.confirmation!.jeton });
    assert.match(change.texte, /^Refusé : Les paramètres ont changé/);
    await appeler("restaurer", { leads: ids, confirmation: "x" });
  });

  test("passer un dossier à « perdu » est sensible (aperçu puis confirmation) ; la reprise est réversible, le motif est gardé", async () => {
    const sans = await appeler("changer_etape", { dossierId: dossierForestier, vers: "PERDU" });
    assert.ok(sans.confirmation, "aperçu attendu");
    assert.equal((await prisma.dossier.findUniqueOrThrow({ where: { id: dossierForestier } })).etape, "QUALIFICATION", "rien de fait avant confirmation");
    // Mission 12 : sans motif, la confirmation est refusée et rien ne bouge.
    const refus = await appeler("changer_etape", { dossierId: dossierForestier, vers: "PERDU", confirmation: sans.confirmation!.jeton, commande: "Passe Forestier en perdu" }).catch((erreur: Error) => ({ texte: erreur.message, confirmation: undefined }));
    assert.match(refus.texte, /exige un motif/);
    assert.equal((await prisma.dossier.findUniqueOrThrow({ where: { id: dossierForestier } })).etape, "QUALIFICATION");
    const { MOTIFS_PERTE } = await import("@/lib/dossiers/constants");
    const avec = await appeler("changer_etape", { dossierId: dossierForestier, vers: "PERDU", motif_perte: MOTIFS_PERTE[0] });
    const fait = await appeler("changer_etape", { dossierId: dossierForestier, vers: "PERDU", motif_perte: MOTIFS_PERTE[0], confirmation: avec.confirmation!.jeton, commande: "Passe Forestier en perdu, trop cher" });
    assert.match(fait.texte, /passé de/);
    const d = await prisma.dossier.findUniqueOrThrow({ where: { id: dossierForestier } });
    assert.deepEqual([d.etape, d.motifPerte], ["PERDU", MOTIFS_PERTE[0]]);
    assert.ok(d.ecriture?.includes("ASSISTANT:claude"));
  });

  test("« Planifie un rappel de Madame Piketty jeudi 14h » : rappel posé à 14 h Paris un jeudi, Google Calendar absent dit sans casser", async () => {
    const maintenant = new Date();
    const r = await appeler("planifier", { nom: "Piketty", action: "Rappeler", quand: "jeudi 14h", commande: "Planifie un rappel de Madame Piketty jeudi 14h" }, maintenant);
    assert.match(r.texte, /^Planifié : Rappeler pour Anne Piketty/);
    assert.match(r.texte, /Pas inscrit dans Google Calendar/);
    const l = await prisma.lead.findUniqueOrThrow({ where: { id: piketty.id } });
    assert.ok(l.rappelLe);
    assert.equal(l.rappelLe!.toLocaleDateString("fr-FR", { weekday: "long", timeZone: "Europe/Paris" }), "jeudi");
    assert.equal(l.rappelLe!.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" }), "14:00");
    assert.equal(l.rappelLe!.toISOString(), agenda.lireDateDictee("jeudi 14h", maintenant)!.toISOString());
    assert.ok(l.ecriture?.includes("ASSISTANT:claude"));
  });

  test("dates dictées : jour de semaine, demain, ISO, heure Paris", () => {
    const mardi = new Date("2026-09-22T08:00:00Z");
    assert.equal(agenda.lireDateDictee("jeudi 14h", mardi)!.toISOString(), "2026-09-24T12:00:00.000Z");
    assert.equal(agenda.lireDateDictee("demain 10h30", mardi)!.toISOString(), "2026-09-23T08:30:00.000Z");
    assert.equal(agenda.lireDateDictee("2026-10-01 9h", mardi)!.toISOString(), "2026-10-01T07:00:00.000Z");
    assert.equal(agenda.lireDateDictee("mardi", mardi)!.toISOString(), "2026-09-22T08:00:00.000Z");
    assert.equal(agenda.lireDateDictee("mardi prochain 9h", mardi)!.toISOString(), "2026-09-29T07:00:00.000Z");
    assert.equal(agenda.lireDateDictee("un de ces jours", mardi), null);
  });
});

describe("facture et encaissement", () => {
  let dossierId: string;

  before(async () => {
    const jean = await lead({ prenom: "Jean-Marc", nom: "Rousseau", email: "jm@exemple.fr" });
    const ouverture = await appeler("ouvrir_dossier", { leadId: jean.id });
    dossierId = (ouverture.donnees as { dossierId: string }).dossierId;
    await prisma.dossier.update({ where: { id: dossierId }, data: { clientAdresse: "3 rue des Essais", clientCp: "34970", clientVille: "Lattes" } });
  });

  test("une facture ne se génère pas sur un dossier non signé ; un devis, si", async () => {
    const facture = await appeler("generer_document", { dossierId, type: "FACTURE", objet: "Cuisine", lignes: LIGNES });
    assert.ok(facture.confirmation, "sensible : aperçu");
    const refus = await appeler("generer_document", { dossierId, type: "FACTURE", objet: "Cuisine", lignes: LIGNES, confirmation: facture.confirmation!.jeton });
    assert.match(refus.texte, /^Refusé : Une facture ne se génère que sur un dossier signé/);
    assert.equal(await prisma.document.count({ where: { dossierId, type: "FACTURE" } }), 0);
    const devis = await appeler("generer_document", { dossierId, type: "DEVIS", objet: "Cuisine", lignes: LIGNES });
    assert.match(devis.texte, /total 440 €/);
    const fait = await appeler("generer_document", { dossierId, type: "DEVIS", objet: "Cuisine", lignes: LIGNES, confirmation: devis.confirmation!.jeton, commande: "Génère le devis de Rousseau" });
    assert.match(fait.texte, /^Devis .* émis pour Jean-Marc Rousseau : 440 €/);
    assert.equal(await prisma.document.count({ where: { dossierId, type: "DEVIS", numero: { not: null } } }), 1);
  });

  test("sur un dossier signé, la facture s'émet, puis l'encaissement (sensible) se saisit et se lit dans les finances", async () => {
    await avecActeur(LUCAS, () => transitions.changerEtape(dossierId, transitions.schemaChangementEtape.parse({ vers: "SIGNE", confirmations: { BON_POUR_ACCORD: true }, sansAcompte: { motif: "PAIEMENT_A_LA_FACTURE" } })));
    const apercu = await appeler("generer_document", { dossierId, type: "FACTURE", objet: "Cuisine", lignes: LIGNES });
    const fait = await appeler("generer_document", { dossierId, type: "FACTURE", objet: "Cuisine", lignes: LIGNES, confirmation: apercu.confirmation!.jeton, commande: "Génère la facture de Rousseau" });
    assert.match(fait.texte, /^Facture .* émise pour Jean-Marc Rousseau : 440 €/);
    const facture = await prisma.document.findFirstOrThrow({ where: { dossierId, type: "FACTURE", numero: { not: null } } });
    assert.ok(facture.ecriture?.includes("ASSISTANT:claude"));

    const envoi = await appeler("envoyer_document", { dossierId, documentId: facture.id });
    assert.ok(envoi.confirmation, "l'envoi par mail est sensible");
    assert.match(envoi.texte, /Je vais envoyer « Facture n° .* » à jm@exemple.fr/);

    const { encaissement } = await avecActeur(LUCAS, () => encaissements.enregistrerEncaissement({ dossierId, paiement: { montant: 440, moyen: "VIREMENT", recuLe: new Date().toISOString().slice(0, 10), reference: null } }));
    assert.ok(encaissement.id);
    const a = await finances.analyseFinanciere({ periode: "30_jours" });
    const { periode } = periodes.resoudrePeriode({ periode: "30_jours" });
    const independant = await prisma.encaissement.aggregate({ _sum: { montant: true }, where: { statut: "VALIDE", recuLe: { gte: periode.debut, lt: periode.fin } } });
    assert.equal(a.ca.actuel, Math.round((independant._sum.montant ?? 0) * 100) / 100);
    assert.ok(a.ca.actuel >= 440);
    assert.equal(a.versable.sur30Jours.plancherReserve, 3000);
  });
});

describe("managers : calculs purs face à un calcul indépendant", () => {
  test("entonnoir et taux", () => {
    const l = (x: Partial<import("./analyses/commercial").LeadCohorte>): import("./analyses/commercial").LeadCohorte => ({ id: "x", recuLe: new Date("2026-09-01T10:00:00Z"), source: "META_ADS", campagne: null, publicite: null, famille: "CUISINE", premierAppelLe: null, joignable: false, photos: false, simulation: false, devis: false, signe: false, encaisse: false, montantSigne: null, ...x });
    const cohorte = [
      l({ premierAppelLe: new Date("2026-09-01T10:30:00Z"), joignable: true, photos: true, simulation: true, devis: true, signe: true, montantSigne: 1200 }),
      l({ premierAppelLe: new Date("2026-09-02T10:00:00Z"), joignable: true, devis: true }),
      l({ premierAppelLe: new Date("2026-09-01T11:00:00Z") }),
      l({}),
    ];
    const e = commercial.entonnoirDe(cohorte);
    assert.deepEqual(e, { recus: 4, appeles: 3, joignables: 2, photos: 1, simulations: 1, devis: 2, signes: 1, encaisses: 0 });
    const t = commercial.tauxEntonnoir(e);
    assert.equal(t.appel, 0.75);
    assert.equal(t.joignable, Math.round((2 / 3) * 1000) / 1000);
    assert.equal(t.signature, 0.5);
    assert.equal(t.signatureSurLeads, 0.25);
    assert.equal(t.encaissement, 0);
    const delai = commercial.effetDelaiRappel(cohorte);
    assert.equal(delai.tranches.find((x) => x.tranche === "moins_1h")?.leads, 2);
    assert.equal(delai.tranches.find((x) => x.tranche === "moins_1h")?.tauxSignature, 0.5);
    assert.equal(delai.tranches.find((x) => x.tranche === "jamais_appele")?.leads, 1);
    assert.equal(delai.delaiMedianHeures, 1);
  });

  test("finances : encaissé par mois et famille, marge par chantier, projection", () => {
    const periode = periodes.resoudrePeriode({ du: "2026-08-01", au: "2026-09-30" }, new Date("2026-09-22T10:00:00Z")).periode;
    const enc = [
      { montant: 500, recuLe: new Date("2026-08-10T10:00:00Z"), dossierId: "d1", famille: "CUISINE", categorieClient: "PARTICULIER" },
      { montant: 1500, recuLe: new Date("2026-09-05T10:00:00Z"), dossierId: "d2", famille: "SDB", categorieClient: "PARTICULIER" },
      { montant: 999, recuLe: new Date("2026-07-05T10:00:00Z"), dossierId: "d0", famille: "CUISINE", categorieClient: "PARTICULIER" },
    ];
    const dep = [
      { montant: 100, payeeLe: new Date("2026-08-12T10:00:00Z"), dossierId: "d1", categorie: "MATIERE", horsChantier: false },
      { montant: 60, payeeLe: new Date("2026-09-01T10:00:00Z"), dossierId: null, categorie: "LOGICIELS", horsChantier: true },
    ];
    const fac = [{ dossierId: "d1", totalHt: 500, dateEmission: new Date("2026-08-09T10:00:00Z"), numero: "F1", client: "A" }];
    const f = finances.calculerFinances(enc, dep, fac, periode);
    assert.equal(f.encaisse, 2000);
    assert.deepEqual(f.parMois.map((m) => [m.cle, m.valeur]), [["2026-08", 500], ["2026-09", 1500]]);
    assert.deepEqual(f.parFamille.map((m) => [m.cle, m.valeur]), [["SDB", 1500], ["CUISINE", 500]]);
    assert.equal(f.depenses, 160);
    assert.equal(f.depensesChantier, 100);
    assert.deepEqual(f.marges.parChantier.map((m) => [m.dossierId, m.marge]), [["d1", 400]]);
    assert.equal(f.marges.tauxMoyen, 0.8);
    const p = finances.projeterTresorerie({ resteAEncaisser: [{ montant: 1000, attenduLe: new Date("2026-10-10T00:00:00Z") }, { montant: 700, attenduLe: null }], urssafProvision: 300, urssafEcheance: new Date("2026-10-31T00:00:00Z"), chargesFixesMensuelles: 60 }, new Date("2026-09-22T10:00:00Z"));
    assert.deepEqual(p.map((x) => [x.jours, x.entreesAttendues, x.sortiesConnues, x.solde]), [[30, 1700, 60, 1640], [60, 1700, 420, 1280], [90, 1700, 480, 1220]]);
    assert.equal(finances.lirePlancherReserve(consignes.CONSIGNES_DEFAUT), 3000);
    assert.equal(finances.lirePlancherReserve("rien"), null);
  });

  test("marketing : coût par lead, par devis, par chantier, retour sur dépense, qualité", () => {
    const l = (x: Partial<import("./analyses/marketing").LeadMarketing>): import("./analyses/marketing").LeadMarketing => ({ id: "x", recuLe: new Date(), source: "META_ADS", campagne: "C1", publicite: "P1", ville: "Lattes", codePostal: "34970", zone: "ZONE", occupation: null, joignable: false, appele: false, doublon: false, archive: false, archiveMotif: null, devis: false, signe: false, encaisse: 0, ...x });
    const leads = [
      ...Array.from({ length: 5 }, () => l({ appele: true, joignable: true })),
      l({ appele: true, joignable: true, devis: true, signe: true, encaisse: 1200 }),
      l({ appele: true, joignable: true, devis: true }),
      l({ appele: true, joignable: true, devis: true }),
      l({ archive: true, archiveMotif: "DOUBLON", doublon: true }),
      l({ archive: true, archiveMotif: "HORS_CIBLE", zone: "HORS_ZONE", occupation: "LOCATAIRE", appele: true }),
    ];
    const r = marketing.rendementDe(leads, 300);
    assert.deepEqual([r.leads, r.leadsUtiles, r.devis, r.signes, r.encaisse], [10, 8, 3, 1, 1200]);
    assert.deepEqual([r.coutParLead, r.coutParDevis, r.coutParChantier, r.retourSurDepense], [30, 100, 300, 4]);
    assert.equal(marketing.rendementDe(leads, null).coutParLead, null);
    const q = marketing.qualiteDe(leads);
    assert.deepEqual([q.appeles, q.joignables, q.horsZone, q.locataires, q.doublons, q.archives], [9, 8, 1, 1, 1, 2]);
  });

  test("clients : état d'un client, à réactiver après six mois", () => {
    const c = (dossiers: { etape: string; updatedAt: Date; encaisse?: number }[]): import("./analyses/clients").ClientLu => ({ id: "c", nom: "Client", categorie: "PARTICULIER", source: "META_ADS", ville: null, premierContactLe: new Date("2025-01-01"), espacePermanent: null, recommandations: 0, dossiers: dossiers.map((d, i) => ({ id: `d${i}`, etape: d.etape, famille: "CUISINE", updatedAt: d.updatedAt, dateChantier: null, encaisse: d.encaisse ?? 0, avis: null, espace: null })) });
    const maintenant = new Date("2026-09-22T10:00:00Z");
    assert.equal(clientsAnalyse.etatDuClient(c([])), "PROSPECT");
    assert.equal(clientsAnalyse.etatDuClient(c([{ etape: "DEVIS_ENVOYE", updatedAt: maintenant }])), "EN_COURS");
    assert.equal(clientsAnalyse.etatDuClient(c([{ etape: "ENCAISSE", updatedAt: maintenant }, { etape: "PLANIFIE", updatedAt: maintenant }])), "SIGNE");
    assert.equal(clientsAnalyse.etatDuClient(c([{ etape: "ENCAISSE", updatedAt: maintenant }, { etape: "PERDU", updatedAt: maintenant }])), "TERMINE");
    assert.equal(clientsAnalyse.etatDuClient(c([{ etape: "PERDU", updatedAt: maintenant }])), "PERDU");
    const vieux = c([{ etape: "ENCAISSE", updatedAt: new Date("2026-01-15T10:00:00Z"), encaisse: 800 }]);
    const recent = { ...c([{ etape: "ENCAISSE", updatedAt: new Date("2026-08-01T10:00:00Z") }]), id: "r" };
    const r = clientsAnalyse.aReactiver([vieux, recent], maintenant);
    assert.deepEqual(r.map((x) => [x.id, x.joursDepuis, x.encaisse]), [["c", 250, 800]]);
  });

  test("opérations : capacité des consignes, charge par semaine", () => {
    assert.equal(operations.lireCapaciteMensuelle(consignes.CONSIGNES_DEFAUT), 15);
    assert.equal(operations.lundiDe("2026-09-22"), "2026-09-21");
    assert.equal(operations.lundiDe("2026-09-27"), "2026-09-21");
    const charge = operations.chargeParSemaine([{ dateChantier: new Date("2026-09-23T08:00:00Z"), client: "A", etape: "PLANIFIE" }, { dateChantier: new Date("2026-09-30T08:00:00Z"), client: "B", etape: "PLANIFIE" }, { dateChantier: new Date("2026-10-01T08:00:00Z"), client: "C", etape: "CHANTIER" }], new Date("2026-09-22T10:00:00Z"), 8, 3);
    assert.deepEqual(charge.map((s) => [s.semaineDu, s.chantiers, s.capacite, s.reste]), [["2026-09-21", 1, 2, 1], ["2026-09-28", 2, 2, 0], ["2026-10-05", 0, 2, 2]]);
  });

  test("le manager commercial compte comme une requête indépendante sur la base", async () => {
    const a = await commercial.analyseCommerciale({ periode: "30_jours" });
    const { periode } = periodes.resoudrePeriode({ periode: "30_jours" });
    const recus = await prisma.lead.count({ where: { archiveLe: null, createdAt: { gte: periode.debut, lt: periode.fin } } });
    assert.equal(a.entonnoir.actuel.recus, recus);
    const signes = await prisma.lead.count({ where: { archiveLe: null, createdAt: { gte: periode.debut, lt: periode.fin }, dossiers: { some: { archiveLe: null, etape: { in: ["SIGNE", "PLANIFIE", "CHANTIER", "FACTURE", "ENCAISSE"] } } } } });
    assert.equal(a.entonnoir.actuel.signes, signes);
    assert.ok(a.entonnoir.actuel.signes >= 1);
    assert.equal(a.pertes.dossiersPerdus, await prisma.dossier.count({ where: { etape: "PERDU", perteLe: { gte: periode.debut, lt: periode.fin } } }));
    assert.ok(a.definitions.cohorte.length > 10);
  });

  test("les cinq managers et les outils de lecture répondent sans erreur, avec leurs définitions", async () => {
    for (const nom of ["manager_commercial", "manager_finances", "manager_marketing", "manager_clients", "manager_operations", "synthese", "ce_qui_m_attend", "leads_a_appeler", "dossiers_par_etape", "espaces_clients", "mails_a_traiter", "campagne", "sante_systeme"]) {
      const r = await appeler(nom, {});
      assert.ok(r.texte.length > 20, nom);
      assert.doesNotMatch(r.texte, /a échoué|^Refusé|Paramètres invalides/, `${nom} : ${r.texte.slice(0, 200)}`);
    }
    const ops = await operations.analyseOperations();
    assert.equal(ops.capacite.mensuelle, 15);
    const cl = await clientsAnalyse.analyseClients();
    assert.equal(cl.total, await prisma.client.count({ where: { archiveLe: null, fusionneDansId: null, anonymiseLe: null } }));
    const m = await marketing.analyseMarketing({ periode: "7_jours" });
    assert.ok(["DEPENSES_SAISIES", "PRORATA_CAMPAGNE", "INCONNUE"].includes(m.depense.origine));
  });

  test("le point du jour mémorise son heure : le suivant reprend là où il s'est arrêté", async () => {
    const t0 = new Date();
    const premier = await pointDuJour.calculerPointDuJour(t0, { depuis: null, memoriser: true });
    assert.equal(premier.premierPoint, true);
    const t1 = new Date(t0.getTime() + 60_000);
    const second = await pointDuJour.calculerPointDuJour(t1);
    assert.equal(second.premierPoint, false);
    assert.equal(second.depuis, t0.toISOString());
    const r = await appeler("point_du_jour", {});
    assert.match(r.texte, /^Point du/);
  });
});

describe("plafond d'écritures", () => {
  test("au-delà de 60 écritures dans l'heure, le serveur refuse et le journal le dit", async () => {
    const forestier = await prisma.lead.findFirstOrThrow({ where: { nom: "Forestier" } });
    await prisma.appelOutil.createMany({ data: Array.from({ length: 60 }, () => ({ sessionId: session.id, outil: "ajouter_note", niveau: "REVERSIBLE", statut: "FAIT", parametres: "{}", dureeMs: 1 })) });
    const r = await appeler("ajouter_note", { leadId: forestier.id, texte: "Une de trop" });
    assert.match(r.texte, /^Refusé : Plafond de sécurité/);
    const refus = await prisma.appelOutil.findFirst({ where: { statut: "REFUSE", erreur: { startsWith: "Plafond" } } });
    assert.ok(refus);
    const lecture = await appeler("lire_fiche", { leadId: forestier.id });
    assert.doesNotMatch(lecture.texte, /^Refusé/);
  });
});
