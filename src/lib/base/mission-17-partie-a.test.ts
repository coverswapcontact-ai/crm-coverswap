import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { preparerBaseEssai } from "@/test/base-essai";

preparerBaseEssai();
process.env.UPLOADS_DIR = mkdtempSync(path.join(tmpdir(), "coverswap-m17a-"));

/**
 * Mission 17 (partie A) — la migration de mise en route « taches-a-faire-17-a » : inoffensive sur une base vide ;
 * chaque décision du 29/09 appliquée au seul candidat net retrouvé par empreinte ; deux candidats → rien (« ambigu ») ;
 * les tâches à moi de la reprise créées une fois, en lot ; rejouable sans effet. Les empreintes réelles ne sont jamais
 * éprouvées ici : la table est passée en paramètre, calculée sur des noms fictifs.
 */

let prisma: typeof import("@/lib/prisma").default;
let avecActeur: typeof import("@/lib/journal/contexte").avecActeur;
let m: typeof import("@/lib/base/migrations/mission-17-partie-a");
let lecture: typeof import("@/lib/a-faire/lecture");
let quand: typeof import("@/lib/commercial/quand");
let dates: typeof import("@/lib/dossiers/dates");

const MIGRATION = { acteur: "MIGRATION:taches-a-faire-17-a", origine: "essai" };
const J = 86_400_000;
const fetchOriginal = globalThis.fetch;
let numero = 0;
const suivant = () => ++numero;

type Empreintes = import("@/lib/base/migrations/mission-17-partie-a").Empreintes;
const fictives = (): Empreintes => ({
  jr: { initiales: "J. R.", empreintes: [m.empreinteNom("Julien Rivière"), m.empreinteNom("Rivière")] },
  lb: { initiales: "L. B.", empreintes: [m.empreinteNom("Lina Bertin"), m.empreinteNom("Bertin")] },
  cm: { initiales: "C. M.", empreintes: [m.empreinteNom("Camille Morel"), m.empreinteNom("Morel")] },
  fldTech: { initiales: "A. T.", empreintes: [m.empreinteNom("Atelier Tessier")] },
});

const executer = (maintenant: Date, empreintes: Empreintes) => avecActeur(MIGRATION, () => m.miseEnRoute(prisma, { maintenant, empreintes }));

async function uneFiche(nom: string, champs: Record<string, unknown> = {}) {
  return prisma.client.create({ data: { nom, source: "ENTRANT", premierContactLe: new Date(Date.now() - 30 * J), ...champs } });
}
async function unDossier(clientNom: string, champs: Record<string, unknown> = {}) {
  return prisma.dossier.create({ data: { clientNom, clientAdresse: "1 rue des Essais", clientCp: "34000", clientVille: "Montpellier", clientTelephone: `+3362${String(300000 + suivant()).padStart(7, "0")}`, objet: "Cuisine", source: "ENTRANT", ...champs } });
}
async function unLead(prenom: string, nom: string, champs: Record<string, unknown> = {}) {
  return prisma.lead.create({ data: { prenom, nom, telephone: `+3361${String(300000 + suivant()).padStart(7, "0")}`, ville: "Lattes", source: "META_ADS", ...champs } });
}
async function unMail(sens: "ENTRANT" | "SORTANT", recuLe: Date, lien: Record<string, string>) {
  const n = suivant();
  return prisma.message.create({ data: { canal: "EMAIL", compte: "contact@coverswap.fr", identifiantCanal: `essai-m17a-${n}`, filCanal: `fil-m17a-${n}`, sens, de: sens === "ENTRANT" ? `client${n}@exemple.fr` : "contact@coverswap.fr", objet: "Votre projet", recuLe, statut: "RATTACHE", classe: "CLIENT", ...lien } });
}
const tache = (cle: string) => prisma.tacheAFaire.findUnique({ where: { cle } });

before(async () => {
  process.env.NEXTAUTH_SECRET = "secret-de-session-pour-les-essais";
  process.env.SITE_URL = "https://coverswap.fr";
  process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3001";
  globalThis.fetch = (async (url: unknown) => {
    throw new Error(`Aucune requête réseau dans les essais (${String(url)})`);
  }) as typeof fetch;
  prisma = (await import("@/lib/prisma")).default;
  avecActeur = (await import("@/lib/journal/contexte")).avecActeur;
  m = await import("@/lib/base/migrations/mission-17-partie-a");
  lecture = await import("@/lib/a-faire/lecture");
  quand = await import("@/lib/commercial/quand");
  dates = await import("@/lib/dossiers/dates");
  await (await import("@/lib/base/preparation")).preparerBase();
});

after(async () => {
  globalThis.fetch = fetchOriginal;
  await prisma.$disconnect();
});

describe("Mission 17 (partie A) — mise en route des tâches de Lucas", () => {
  test("empreintes : nom normalisé (accents, ordre des mots), 16 caractères ; la table réelle n'a que des empreintes", () => {
    assert.equal(m.empreinteNom("Julien Rivière"), m.empreinteNom("riviere  JULIEN"));
    assert.match(m.empreinteNom("Rivière"), /^[0-9a-f]{16}$/);
    for (const cle of m.DECISIONS_29_09) {
      const sujet = m.EMPREINTES_29_09[cle];
      assert.equal(sujet.empreintes.length, 2, `${cle} : nom complet et nom de famille (ou deux graphies)`);
      for (const e of sujet.empreintes) assert.match(e, /^[0-9a-f]{16}$/);
    }
    assert.ok(m.EMPREINTES_29_09.fldTech.empreintes.includes(m.empreinteNom("FLD Tech")));
    assert.equal(new Set(m.POINTS_REPRISE.map((p) => p.slug)).size, m.POINTS_REPRISE.length, "slugs uniques");
    assert.equal(lecture.libelleDuLot(2, m.LOT_REPRISE.libelle, m.LOT_REPRISE.cle), "2 points restants des missions 15 et 16");
    assert.equal(lecture.libelleDuLot(1, m.LOT_REPRISE.libelle, m.LOT_REPRISE.cle), "1 point restant des missions 15 et 16");
  });

  test("base vide : passée au démarrage sans rien écrire, et rejouée sans échec", async () => {
    const passee = await prisma.migrationDonnees.findUnique({ where: { nom: m.NOM_MIGRATION_17_A } });
    assert.ok(passee, "jouée par preparerBase");
    assert.ok(Object.values(JSON.parse(passee.resume ?? "{}") as Record<string, number>).every((n) => n === 0));
    const r = await executer(new Date(), fictives());
    assert.ok(Object.values(r).every((n) => n === 0), JSON.stringify(r));
    assert.equal(await prisma.tacheAFaire.count(), 0);
    const noms = (await import("@/lib/base/migrations")).MIGRATIONS_DONNEES.map((x) => x.nom);
    assert.equal(noms.at(-1), m.NOM_MIGRATION_17_A, "ajoutée en fin de liste");
  });

  test("chaque décision appliquée au seul candidat net ; tâches à moi en lot, une fois ; rejouable sans effet", async () => {
    const maintenant = new Date();
    // J. R. : sa fiche et son dossier (prochaine action sur le visuel), une tâche à moi, un mail à traiter.
    const ficheJR = await uneFiche("Julien Rivière", { prenom: "Julien", nomFamille: "Rivière" });
    const dossierJR = await unDossier("Julien Rivière", { clientId: ficheJR.id, etape: "SIMULATION", prochaineAction: "Il modifie le visuel de sa cuisine" });
    await prisma.tacheAFaire.create({
      data: { cle: "MANUELLE:essai-jr", type: "MANUELLE", source: "MANUELLE", sujetType: "DOSSIER", sujetId: dossierJR.id, dossierId: dossierJR.id, clientId: ficheJR.id, titre: "Revoir le visuel", raison: "ajoutée à la main", niveau: 3, depuis: new Date(maintenant.getTime() - J), dureeMin: 5 },
    });
    const mailJR = await unMail("ENTRANT", new Date(maintenant.getTime() - 2 * J), { dossierId: dossierJR.id, clientId: ficheJR.id });
    // Un homonyme au seul nom de famille, sans prochaine action sur le visuel : écarté par le garde-fou.
    const homonyme = await unDossier("Rivière", { etape: "QUALIFICATION", prochaineAction: "Poser le devis" });
    // L. B. : un dossier en simulation.
    const ficheLB = await uneFiche("Lina Bertin", { prenom: "Lina", nomFamille: "Bertin" });
    const dossierLB = await unDossier("Lina Bertin", { clientId: ficheLB.id, etape: "SIMULATION" });
    // C. M. : un lead récent jamais appelé, deux mails partis le 29/09.
    const leadCM = await unLead("Camille", "Morel", { createdAt: new Date(maintenant.getTime() - 2 * J) });
    await unMail("SORTANT", new Date("2026-09-29T07:00:00.000Z"), { leadId: leadCM.id });
    const mailCM = await unMail("SORTANT", new Date("2026-09-29T14:30:00.000Z"), { leadId: leadCM.id });
    // FLD Tech (ici une entreprise fictive) : un dossier signé sans date, un autre en qualification.
    const ficheFLD = await uneFiche("Atelier Tessier", { categorie: "DONNEUR_ORDRE", source: "SOUS_TRAITANCE" });
    const signe = await unDossier("Atelier Tessier", { clientId: ficheFLD.id, source: "SOUS_TRAITANCE", etape: "SIGNE" });
    const autre = await unDossier("Atelier Tessier", { clientId: ficheFLD.id, source: "SOUS_TRAITANCE", etape: "QUALIFICATION" });
    // Un ancien lead, contacté sans suite il y a trois mois.
    await unLead("Odile", "Ancienne", { createdAt: new Date(maintenant.getTime() - 90 * J), dernierAppelLe: new Date(maintenant.getTime() - 85 * J) });

    const r = await executer(maintenant, fictives());
    assert.deepEqual(
      { jr: r.jr, lb: r.lb, cm: r.cm, fldTech: r.fldTech, ambigus: r.ambigus, introuvables: r.introuvables, decisionsEchouees: r.decisionsEchouees, passeEchouee: r.passeEchouee, anciensLeads: r.anciensLeads, filsArchives: r.filsArchives },
      { jr: 1, lb: 1, cm: 1, fldTech: 1, ambigus: 0, introuvables: 0, decisionsEchouees: 0, passeEchouee: 0, anciensLeads: 1, filsArchives: 1 }
    );
    assert.ok(r.tachesCreees >= 1);

    // J. R.
    const jr = await prisma.dossier.findUniqueOrThrow({ where: { id: dossierJR.id } });
    assert.equal(jr.prochaineAction, m.TEXTE_JR);
    assert.equal(jr.prochaineActionManuelle, m.TEXTE_JR);
    assert.equal(jr.prochaineActionPar, "HUMAIN:lucas (29/09)");
    assert.equal(dates.jourParis(jr.prochaineActionDate!), dates.jourParis(quand.aHeureParis(maintenant, 7, 12)));
    assert.equal(jr.main, "CLIENT", "la main passe au client (il faut attendre)");
    const aMoi = await tache("MANUELLE:essai-jr");
    assert.equal(aMoi?.statut, "PLUS_TARD");
    assert.equal(aMoi?.reponseRaison, "ATTEND_CLIENT");
    assert.equal(aMoi?.reponseTexte, "J'attends sa modification visuelle");
    assert.equal(aMoi?.reponduPar, m.ACTEUR_MIGRATION_17_A);
    assert.equal(aMoi?.plusTardJusqua?.getTime(), quand.aHeureParis(maintenant, 7, 9).getTime());
    assert.equal(JSON.parse(aMoi!.precedent!).avant.statut, "A_FAIRE", "« Annuler » possible");
    assert.ok((await prisma.message.findUniqueOrThrow({ where: { id: mailJR.id } })).traiteLe, "fil archivé");
    assert.equal((await prisma.dossier.findUniqueOrThrow({ where: { id: homonyme.id } })).prochaineAction, "Poser le devis", "homonyme intact");
    // Ses autres tâches (réponse au mail…) : cochées par le CRM, prochaine action en vigueur ; le « Plus tard » est gardé.
    for (const t of await prisma.tacheAFaire.findMany({ where: { dossierId: dossierJR.id, type: { not: "MANUELLE" } } })) {
      assert.notEqual(t.statut, "A_FAIRE", `${t.type} ne reste pas à faire`);
    }

    // L. B.
    const simulation = await tache(`SIMULATION:dossier:${dossierLB.id}`);
    assert.equal(simulation?.statut, "PAS_A_FAIRE");
    assert.equal(simulation?.reponseRaison, "CLIENT_LE_FAIT");
    assert.equal(simulation?.reponseTexte, "elle fait sa simulation elle-même");
    const lb = await prisma.dossier.findUniqueOrThrow({ where: { id: dossierLB.id } });
    assert.equal(lb.prochaineAction, m.TEXTE_LB);
    assert.equal(lb.prochaineActionManuelle, m.TEXTE_LB);
    assert.equal(lb.prochaineActionDate, null);
    assert.equal(lb.main, "CLIENT");

    // C. M.
    assert.equal((await prisma.lead.findUniqueOrThrow({ where: { id: leadCM.id } })).dernierContactLe?.getTime(), mailCM.recuLe.getTime(), "la date de son dernier mail du 29/09");
    const appel = await tache(`APPELER:lead:${leadCM.id}`);
    assert.equal(appel?.statut, "FAITE");
    assert.equal(appel?.reponseTexte, "contactée par mail le 29/09");
    assert.equal(appel?.reponduPar, m.ACTEUR_MIGRATION_17_A);

    // FLD Tech
    const date = await tache(`DATE_CHANTIER:dossier:${signe.id}`);
    assert.equal(date?.statut, "FAITE");
    assert.equal(date?.reponseTexte, "réglé (Lucas, 29/09)");
    assert.equal(await tache(`DATE_CHANTIER:dossier:${autre.id}`), null);

    // Ancien lead : dans le lot.
    assert.equal(await prisma.tacheAFaire.count({ where: { lot: "anciens-leads", type: "CLASSER_LEAD" } }), 1);

    // Tâches à moi de la reprise : une par point, sauf ceux déjà couverts par une tâche du CRM.
    const reprise = await prisma.tacheAFaire.findMany({ where: { cle: { startsWith: "MANUELLE:reprise-" } } });
    assert.equal(reprise.length, r.manuelles);
    let couverts = 0;
    for (const p of m.POINTS_REPRISE) if (p.couvertPar && (await tache(p.couvertPar)) && !(await tache(m.cleReprise(p.slug)))) couverts++;
    assert.equal(r.manuelles + couverts, m.POINTS_REPRISE.length);
    assert.ok(reprise.some((t) => t.cle === m.cleReprise("connecteur-claude")), "connecteur Claude");
    for (const t of reprise) {
      assert.equal(t.type, "MANUELLE");
      assert.equal(t.lot, "reprise");
      assert.equal(t.lotLibelle, m.LOT_REPRISE.libelle);
    }
    const banc = reprise.find((t) => t.cle === m.cleReprise("banc-comparaison"));
    assert.deepEqual(JSON.parse(banc!.donnees).condition, { code: "BANC_LANCE" });

    // Rejouée : plus rien à faire.
    const avant = await prisma.tacheAFaire.findMany({ orderBy: { cle: "asc" }, select: { cle: true, statut: true, updatedAt: true } });
    const r2 = await executer(new Date(maintenant.getTime() + 60_000), fictives());
    assert.ok(Object.values(r2).every((n) => n === 0), `rejouée sans effet : ${JSON.stringify(r2)}`);
    const apres = await prisma.tacheAFaire.findMany({ orderBy: { cle: "asc" }, select: { cle: true, statut: true, updatedAt: true } });
    assert.deepEqual(
      apres.map((t) => [t.cle, t.statut]),
      avant.map((t) => [t.cle, t.statut])
    );
    assert.equal(await prisma.tacheAFaire.count({ where: { cle: { startsWith: "MANUELLE:reprise-" } } }), r.manuelles, "créées une fois");
  });

  test("deux candidats nets : rien n'est fait (ambigu) ; aucun candidat : introuvable", async () => {
    const maintenant = new Date();
    const fiche = await uneFiche("Hugo Vasseur", { prenom: "Hugo", nomFamille: "Vasseur" });
    const premier = await unDossier("Hugo Vasseur", { clientId: fiche.id, etape: "SIMULATION", prochaineAction: "Attendre le visuel" });
    const second = await unDossier("Vasseur", { etape: "QUALIFICATION", prochaineAction: "Refaire le visuel" });
    const r = await executer(maintenant, {
      jr: { initiales: "H. V.", empreintes: [m.empreinteNom("Hugo Vasseur"), m.empreinteNom("Vasseur")] },
      lb: { initiales: "N. A.", empreintes: [m.empreinteNom("Nina Absente"), m.empreinteNom("Absente")] },
    });
    assert.equal(r.ambigus, 1);
    assert.equal(r.introuvables, 1);
    assert.equal(r.jr, 0);
    assert.equal(r.lb, 0);
    for (const d of [premier, second]) {
      const lu = await prisma.dossier.findUniqueOrThrow({ where: { id: d.id } });
      assert.equal(lu.prochaineAction, d.prochaineAction, "prochaine action intacte");
      assert.equal(lu.prochaineActionManuelle, null);
    }
  });
});
