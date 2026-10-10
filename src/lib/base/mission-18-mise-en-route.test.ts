import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { preparerBaseEssai } from "@/test/base-essai";

preparerBaseEssai();
process.env.UPLOADS_DIR = mkdtempSync(path.join(tmpdir(), "coverswap-m18-mise-en-route-"));
process.env.NEXTAUTH_SECRET = "secret-de-session-pour-les-essais";
process.env.SITE_URL = "https://coverswap.fr";
process.env.TACHES_DESACTIVEES = "1";

/**
 * Mission 18 — la migration « mise-en-route-18 » : sur une base vide, rien ; sur des données d'avant la partie B
 * (fabriquées comme elles sont en base : écritures directes, sans événement), UN contrôle étendu (perdus et archivés
 * compris), les réparations sûres appliquées, les corrections sensibles laissées (au détecteur de tâches pour un dossier
 * vivant, en tâche à moi pour un dossier perdu ou archivé), le compte par règle lisible dans le journal et dans
 * `etat_crm` SANTE. Jamais de mail au client, de conversion Meta ni de changement d'étape ; rejouée, elle ne répare
 * plus rien et ne recrée aucune tâche. État vérifié des deux côtés (`etatDesDeuxCotes`). Rien ne sort du poste : réseau
 * coupé ; Meta « configuré » avec des valeurs factices le temps de la migration (une conversion demandée serait mise en
 * file, jamais envoyée : tâches de fond coupées).
 */

let prisma: typeof import("@/lib/prisma").default;
let avecActeur: typeof import("@/lib/journal/contexte").avecActeur;
let liens: typeof import("@/lib/espace/liens");
let controle: typeof import("@/lib/coherence/controle");
let m: typeof import("@/lib/base/migrations/mission-18-mise-en-route");
let lecture: typeof import("@/lib/assistant/outils/lecture");
let etatDesDeuxCotes: typeof import("@/test/etat-dossier").etatDesDeuxCotes;

const MIGRATION = { acteur: "MIGRATION:mise-en-route-18", origine: "essai" };
const ATTENTE_ACCORD = "Attendre l'accord du client sur le devis";
const LIGNES = JSON.stringify([{ type: "PRESTATION", designation: "Recouvrement de 12 façades", quantite: 10, unite: "ml", prixUnitaire: 150 }]);
const appelsReseau: string[] = [];
const fetchOriginal = globalThis.fetch;

const executer = () => avecActeur(MIGRATION, () => m.miseEnRoute18(prisma));

async function contact(prenom: string) {
  const lead = await prisma.lead.create({ data: { prenom, nom: "Essai", email: `${prenom.toLowerCase()}.mr18@example.test`, telephone: `+3363${Math.floor(Math.random() * 9e7 + 1e7)}`, ville: "Lattes", codePostal: "34970", source: "SITE_FORMULAIRE", statut: "CONTACTE" } });
  const ouvert = await liens.ouvrirEspaceDuContact(lead.id);
  return { leadId: lead.id, dossierId: ouvert.dossierId, espaceId: ouvert.espace.id };
}
type Contact = Awaited<ReturnType<typeof contact>>;

/** Le lien du client (espace permanent) et son projet dans l'espace : révoqués ou non. */
async function espaceOuvert(c: Contact) {
  const projet = await prisma.espaceClient.findUniqueOrThrow({ where: { id: c.espaceId }, select: { revoqueLe: true, permanent: { select: { revoqueLe: true } } } });
  return { projet: projet.revoqueLe === null, lien: projet.permanent ? projet.permanent.revoqueLe === null : projet.revoqueLe === null };
}

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
  avecActeur = (await import("@/lib/journal/contexte")).avecActeur;
  liens = await import("@/lib/espace/liens");
  controle = await import("@/lib/coherence/controle");
  m = await import("@/lib/base/migrations/mission-18-mise-en-route");
  lecture = await import("@/lib/assistant/outils/lecture");
  etatDesDeuxCotes = (await import("@/test/etat-dossier")).etatDesDeuxCotes;
  await (await import("@/lib/base/preparation")).preparerBase();
});
after(async () => {
  globalThis.fetch = fetchOriginal;
  assert.deepEqual(appelsReseau, [], "aucun appel réseau");
  await prisma.$disconnect();
});

describe("mise en route de la mission 18", () => {
  test("base vide : passée au démarrage sans rien faire, inscrite en dernier, après la migration de B11", async () => {
    const passee = await prisma.migrationDonnees.findUnique({ where: { nom: m.NOM_MIGRATION_MR_18 } });
    assert.ok(passee, "passée au démarrage (preparerBase)");
    assert.deepEqual(JSON.parse(passee.resume), { dossiersControles: 0, trouves: 0, repares: 0, taches: 0, detecteur: 0, echecs: 0 });
    assert.deepEqual(await executer(), { dossiersControles: 0, trouves: 0, repares: 0, taches: 0, detecteur: 0, echecs: 0 });
    const noms = (await import("@/lib/base/migrations")).MIGRATIONS_DONNEES.map((x) => x.nom);
    // Mission 25 (lot 3) : « sms-sans-presentation-25 » la suit désormais ; elle reste après « etats-en-double-18 ».
    assert.ok(noms.indexOf(m.NOM_MIGRATION_MR_18) > noms.indexOf("etats-en-double-18") && noms.includes("etats-en-double-18"), noms.join(", "));
    assert.ok(noms.indexOf("sms-sans-presentation-25") > noms.indexOf(m.NOM_MIGRATION_MR_18), noms.join(", "));
    assert.equal(await prisma.tacheAFaire.count(), 0);
  });

  test("un cas par règle : réparations sûres appliquées, sensibles au détecteur (vivant) ou en tâche à moi (perdu, archivé) ; aucun envoi, aucune étape bougée ; rejouée sans effet", async () => {
    // Vivants, réparations sûres.
    const attente = await contact("Attente"); // « Attendre l'accord » sans aucun devis → effacée
    await prisma.dossier.update({ where: { id: attente.dossierId }, data: { prochaineAction: ATTENTE_ACCORD } });
    const posee = await contact("Posee"); // la même, posée à la main → jamais signalée, gardée
    await prisma.dossier.update({ where: { id: posee.dossierId }, data: { prochaineAction: ATTENTE_ACCORD, prochaineActionManuelle: ATTENTE_ACCORD, prochaineActionManuelleLe: new Date() } });
    const perimee = await contact("Perimee"); // « Préparer le devis (simulation choisie) » sans simulation validée → effacée
    await prisma.dossier.update({ where: { id: perimee.dossierId }, data: { prochaineAction: "Préparer le devis (simulation choisie)" } });
    // Relecture : « … autre proposition … » posée à la main (aucune demande en attente) → jamais périmée, gardée.
    const PROPOSITION = "Lui faire une autre proposition en teinte chêne (vu au téléphone)";
    const proposition = await contact("Proposition");
    await prisma.dossier.update({ where: { id: proposition.dossierId }, data: { prochaineAction: PROPOSITION, prochaineActionManuelle: PROPOSITION, prochaineActionManuelleLe: new Date() } });
    const main = await contact("Main"); // le client a écrit, la main affichée est restée « chez le client » → à moi
    await prisma.dossierEvenement.create({ data: { dossierId: main.dossierId, type: "ESPACE_MESSAGE", direction: "ENTRANT", contenu: "Bonjour, pouvez-vous me rappeler ?" } });
    await prisma.dossier.update({ where: { id: main.dossierId }, data: { main: "CLIENT", mainMotif: "écrite à la main" } });
    const choix = await contact("Choix"); // choix d'une simulation qu'il ne voit plus → dévalidé
    await prisma.espaceClient.update({ where: { id: choix.espaceId }, data: { choix: JSON.stringify({ mode: "UNE", simulationId: "simulation-absente" }), choixLe: new Date() } });
    // B12 : un lead resté « Devis demandé » sur un dossier en Qualification (ancienne base) → aligné sur « Contacté ».
    const demande = await contact("Demande");
    await prisma.lead.update({ where: { id: demande.leadId }, data: { statut: "DEVIS_DEMANDE" } });
    // Vivant, correction sensible (l'étape changerait) : laissée au détecteur ; le statut du lead, sûr, est aligné.
    const chantier = await contact("Chantier");
    const dateChantier = new Date(Date.now() + 20 * 86_400_000);
    await prisma.dossier.update({ where: { id: chantier.dossierId }, data: { etape: "SIGNE", dateChantier } });
    // Relecture : vivant, correction sensible, mais une prochaine action posée à la main en vigueur — le moteur des tâches
    // écarterait la détection : une tâche à moi, pas « au détecteur ».
    const commande = await contact("Commande");
    await prisma.dossier.update({ where: { id: commande.dossierId }, data: { etape: "SIGNE", dateChantier, prochaineAction: "Commander les adhésifs", prochaineActionManuelle: "Commander les adhésifs", prochaineActionManuelleLe: new Date() } });
    // Perdu il y a plus de 90 jours : lead resté « contacté », lien de l'espace actif → lead PERDU, lien désactivé.
    const IL_Y_A_100_JOURS = new Date(Date.now() - 100 * 86_400_000);
    const perdu = await contact("Perdu");
    await prisma.dossier.update({ where: { id: perdu.dossierId }, data: { etape: "PERDU", perteLe: IL_Y_A_100_JOURS } });
    // Relecture : perdu aujourd'hui — le lien attend la révocation automatique (90 jours) : seul le lead est aligné.
    const perduRecent = await contact("Recent");
    await prisma.dossier.update({ where: { id: perduRecent.dossierId }, data: { etape: "PERDU", perteLe: new Date() } });
    // Archivé il y a plus de 90 jours, en « Signé » sans devis accepté (sensible) et projet resté ouvert (sûr) → projet
    // fermé, lien désactivé, tâche à moi.
    const archive = await contact("Archive");
    await prisma.dossier.update({ where: { id: archive.dossierId }, data: { etape: "SIGNE" } });
    const devisArchive = await prisma.document.create({ data: { dossierId: archive.dossierId, type: "DEVIS", numero: "D-MR18-1", dateEmission: new Date(), objet: "Cuisine", lignes: LIGNES, totalHt: 1500, acomptePct: 30, statut: "GENERE" } });
    await prisma.dossier.update({ where: { id: archive.dossierId }, data: { archiveLe: IL_Y_A_100_JOURS } });

    const avant = Object.fromEntries(await Promise.all([attente, posee, perimee, proposition, main, choix, demande, chantier, commande].map(async (c) => [c.dossierId, await etatDesDeuxCotes(c.dossierId, { taches: false })] as const)));
    const vus = (await controle.controlerCoherence({ etendu: true })).incoherences;
    const codes = (c: Contact) => vus.filter((i) => i.dossierId === c.dossierId).map((i) => i.code).sort();
    assert.deepEqual(codes(attente), ["ATTENTE_ACCORD_SANS_DEVIS"]);
    assert.deepEqual(codes(posee), []);
    assert.deepEqual(codes(perimee), ["PROCHAINE_ACTION_PERIMEE"]);
    assert.deepEqual(codes(proposition), [], "une action posée à la main n'est jamais « périmée »");
    assert.deepEqual(codes(main), ["MAIN_DECALEE"]);
    assert.deepEqual(codes(choix), ["CHOIX_SANS_SIMULATION"]);
    assert.deepEqual(codes(demande), ["STATUT_DU_LEAD"]);
    assert.deepEqual(codes(chantier), ["DATE_CHANTIER_EN_SIGNE", "STATUT_DU_LEAD"]);
    assert.deepEqual(codes(commande), ["DATE_CHANTIER_EN_SIGNE", "STATUT_DU_LEAD"]);
    assert.deepEqual(codes(perdu), ["ESPACE_ACTIF_DOSSIER_CLOS", "STATUT_DU_LEAD"]);
    assert.deepEqual(codes(perduRecent), ["STATUT_DU_LEAD"], "passer en « Perdu » n'est pas une incohérence de l'espace");
    assert.deepEqual(codes(archive), ["ESPACE_ACTIF_DOSSIER_CLOS", "SIGNE_SANS_DEVIS_ACCEPTE"]);
    // Le contrôle ordinaire (celui du détecteur) ne lit ni le statut du lead d'un perdu ni l'archivé en « Signé ».
    const ordinaire = (await controle.controlerCoherence()).incoherences.map((i) => i.cle);
    assert.ok(!ordinaire.includes(`STATUT_DU_LEAD:${perdu.dossierId}`) && !ordinaire.includes(`SIGNE_SANS_DEVIS_ACCEPTE:${archive.dossierId}`));

    const etapes = () => prisma.dossierEvenement.count({ where: { type: "CHANGEMENT_ETAPE" } });
    const mails = () => prisma.envoiMail.count();
    const conversions = () => prisma.tache.count({ where: { cle: { startsWith: "meta-conversion:" } } });
    const traces = () => prisma.dossierEvenement.count({ where: { type: "COHERENCE_CORRIGEE" } });
    process.env.META_PIXEL_ID = "pixel-essai";
    process.env.META_ACCESS_TOKEN = "jeton-essai";
    const [etapesAvant, mailsAvant, conversionsAvant, tracesAvant] = await Promise.all([etapes(), mails(), conversions(), traces()]);
    const r = await executer();
    const [etapesApres, mailsApres, conversionsApres, tracesApres] = await Promise.all([etapes(), mails(), conversions(), traces()]);
    process.env.META_PIXEL_ID = "";
    process.env.META_ACCESS_TOKEN = "";

    assert.deepEqual(r, {
      dossiersControles: 12,
      trouves: 14,
      repares: 11,
      taches: 2,
      detecteur: 1,
      echecs: 0,
      "trouves.ATTENTE_ACCORD_SANS_DEVIS": 1,
      "repares.ATTENTE_ACCORD_SANS_DEVIS": 1,
      "trouves.PROCHAINE_ACTION_PERIMEE": 1,
      "repares.PROCHAINE_ACTION_PERIMEE": 1,
      "trouves.MAIN_DECALEE": 1,
      "repares.MAIN_DECALEE": 1,
      "trouves.CHOIX_SANS_SIMULATION": 1,
      "repares.CHOIX_SANS_SIMULATION": 1,
      "trouves.STATUT_DU_LEAD": 5,
      "repares.STATUT_DU_LEAD": 5,
      "trouves.ESPACE_ACTIF_DOSSIER_CLOS": 2,
      "repares.ESPACE_ACTIF_DOSSIER_CLOS": 2,
      "trouves.DATE_CHANTIER_EN_SIGNE": 2,
      "detecteur.DATE_CHANTIER_EN_SIGNE": 1,
      "taches.DATE_CHANTIER_EN_SIGNE": 1,
      "trouves.SIGNE_SANS_DEVIS_ACCEPTE": 1,
      "taches.SIGNE_SANS_DEVIS_ACCEPTE": 1,
    });
    assert.equal(etapesApres, etapesAvant, "aucune étape ne bouge");
    assert.equal(mailsApres, mailsAvant, "aucun mail");
    assert.equal(conversionsApres, conversionsAvant, "aucune conversion Meta");
    assert.equal(tracesApres - tracesAvant, r.repares, "chaque réparation laisse sa trace COHERENCE_CORRIGEE");

    // Les deux côtés, dossier par dossier.
    const attenteApres = await etatDesDeuxCotes(attente.dossierId);
    assert.equal(attenteApres.prochaineAction, null);
    assert.deepEqual([attenteApres.etape, attenteApres.etapeEspace, attenteApres.main, attenteApres.statutLead], [avant[attente.dossierId].etape, avant[attente.dossierId].etapeEspace, avant[attente.dossierId].main, "CONTACTE"]);
    assert.equal(attenteApres.main, attenteApres.mainCalculee);
    assert.deepEqual(attenteApres.relances.proposables, []);
    const poseeApres = await etatDesDeuxCotes(posee.dossierId);
    assert.deepEqual([poseeApres.prochaineAction, poseeApres.actionManuelle], [ATTENTE_ACCORD, ATTENTE_ACCORD], "une action posée à la main n'est jamais touchée");
    assert.equal((await etatDesDeuxCotes(perimee.dossierId)).prochaineAction, null);
    const propositionApres = await etatDesDeuxCotes(proposition.dossierId);
    assert.deepEqual([propositionApres.prochaineAction, propositionApres.actionManuelle], [PROPOSITION, PROPOSITION], "gardée : jamais effacée par la mise en route");
    assert.equal(propositionApres.main, propositionApres.mainCalculee);
    // La correction elle-même la refuse (l'assistant, le bouton « Corriger » d'un ancien rapport).
    await assert.rejects(
      controle.appliquerCorrection({ cle: `PROCHAINE_ACTION_PERIMEE:${proposition.dossierId}`, code: "PROCHAINE_ACTION_PERIMEE", gravite: "MOYENNE", dossierId: proposition.dossierId, leadId: proposition.leadId, client: "Proposition Essai", constat: "", correction: "Effacer cette prochaine action" }),
      /posée à la main/
    );
    assert.equal((await prisma.dossier.findUniqueOrThrow({ where: { id: proposition.dossierId } })).prochaineAction, PROPOSITION);
    const mainApres = await etatDesDeuxCotes(main.dossierId);
    assert.deepEqual([mainApres.main, mainApres.mainCalculee, mainApres.etape], ["MOI", "MOI", avant[main.dossierId].etape]);
    const choixApres = await etatDesDeuxCotes(choix.dossierId);
    assert.equal((await prisma.espaceClient.findUniqueOrThrow({ where: { id: choix.espaceId } })).choixLe, null);
    // L'espace disait « devis en préparation » sur une simulation que le client ne voit plus ; il revient à ses photos.
    assert.deepEqual([avant[choix.dossierId].etapeEspace, choixApres.etape, choixApres.etapeEspace], ["ATTENTE_DEVIS", avant[choix.dossierId].etape, "PHOTOS"]);
    const demandeApres = await etatDesDeuxCotes(demande.dossierId);
    assert.deepEqual(
      [demandeApres.statutLead, demandeApres.etape, demandeApres.etapeEspace, demandeApres.prochaineAction, demandeApres.main],
      ["CONTACTE", "QUALIFICATION", avant[demande.dossierId].etapeEspace, avant[demande.dossierId].prochaineAction, avant[demande.dossierId].main],
      "seul le statut du lead change"
    );
    assert.deepEqual(demandeApres.relances.proposables, avant[demande.dossierId].relances.proposables);
    const chantierApres = await etatDesDeuxCotes(chantier.dossierId);
    assert.deepEqual([chantierApres.etape, chantierApres.statutLead, chantierApres.etapeEspace], ["SIGNE", "SIGNE", avant[chantier.dossierId].etapeEspace], "Signé → Planifié est sensible : jamais d'office");
    assert.ok(
      chantierApres.taches.some((t) => t.cle === `COHERENCE:DATE_CHANTIER_EN_SIGNE:${chantier.dossierId}` && t.statut === "A_FAIRE"),
      `le détecteur la remonte (« Corriger ») : ${JSON.stringify(chantierApres.taches)}`
    );
    const perduApres = await etatDesDeuxCotes(perdu.dossierId, { taches: false });
    assert.deepEqual([perduApres.etape, perduApres.statutLead], ["PERDU", "PERDU"]);
    assert.deepEqual(await espaceOuvert(perdu), { projet: true, lien: false }, "lien coupé, projet gardé (rien n'est effacé)");
    const recentApres = await etatDesDeuxCotes(perduRecent.dossierId, { taches: false });
    assert.deepEqual([recentApres.etape, recentApres.statutLead], ["PERDU", "PERDU"]);
    assert.deepEqual(await espaceOuvert(perduRecent), { projet: true, lien: true }, "perdu aujourd'hui : le lien reste (la révocation automatique le fermera)");
    // Le dossier à l'action posée à la main : une tâche à moi, l'étape et l'action gardées, aucune tâche du détecteur.
    const commandeApres = await etatDesDeuxCotes(commande.dossierId);
    assert.deepEqual([commandeApres.etape, commandeApres.prochaineAction, commandeApres.actionManuelle, commandeApres.statutLead], ["SIGNE", "Commander les adhésifs", "Commander les adhésifs", "SIGNE"]);
    assert.equal(commandeApres.main, commandeApres.mainCalculee);
    assert.deepEqual(
      commandeApres.taches.filter((t) => /DATE_CHANTIER_EN_SIGNE/.test(t.cle)).map((t) => [t.cle, t.type, t.titre]),
      [[m.cleTacheCoherence18(`DATE_CHANTIER_EN_SIGNE:${commande.dossierId}`), "MANUELLE", "Corriger · Commande Essai"]],
      "le détecteur l'aurait écartée (action en vigueur) : la tâche à moi la dit"
    );
    const archiveApres = await prisma.dossier.findUniqueOrThrow({ where: { id: archive.dossierId }, select: { etape: true, archiveLe: true } });
    assert.equal(archiveApres.etape, "SIGNE");
    assert.equal((await prisma.document.findUniqueOrThrow({ where: { id: devisArchive.id } })).statut, "GENERE", "le devis n'est pas touché (correction sensible)");
    assert.deepEqual(await espaceOuvert(archive), { projet: false, lien: false });

    // La tâche à moi de l'archivé : en lot « coherence-18 », avec la correction proposée, jamais appliquée.
    const tache = await prisma.tacheAFaire.findUniqueOrThrow({ where: { cle: m.cleTacheCoherence18(`SIGNE_SANS_DEVIS_ACCEPTE:${archive.dossierId}`) } });
    assert.deepEqual([tache.type, tache.source, tache.statut, tache.lot, tache.dossierId, tache.leadId, tache.titre], ["MANUELLE", "MANUELLE", "A_FAIRE", "coherence-18", archive.dossierId, archive.leadId, "Corriger · Archive Essai"]);
    assert.match(JSON.parse(tache.donnees).constat, /Correction proposée : Noter le dernier devis « accepté » \(à décider : jamais appliquée d'office\)/);
    // Une passe des tâches ne la coche pas (une tâche à moi ne se coche jamais par absence).
    await (await import("@/lib/a-faire/detection")).passeComplete(new Date());
    assert.equal((await prisma.tacheAFaire.findUniqueOrThrow({ where: { id: tache.id } })).statut, "A_FAIRE");

    // Rejouée : plus rien à réparer, aucune tâche recréée.
    const encore = await executer();
    assert.deepEqual([encore.repares, encore.taches, encore.echecs, encore.trouves], [0, 0, 0, 3]);
    assert.deepEqual([encore["trouves.DATE_CHANTIER_EN_SIGNE"], encore["trouves.SIGNE_SANS_DEVIS_ACCEPTE"]], [2, 1]);
    assert.equal(await prisma.tacheAFaire.count({ where: { lot: m.LOT_COHERENCE_18.cle } }), 2);
    assert.equal(await traces(), tracesApres);

    // Lisible après le déploiement : etat_crm SANTE, ligne « Dernières migrations » (le résumé tel que le démarrage l'écrit).
    await prisma.migrationDonnees.update({ where: { nom: m.NOM_MIGRATION_MR_18 }, data: { executeeLe: new Date(Date.now() + 1000), resume: JSON.stringify(r) } });
    const sante = await lecture.outilSanteSysteme.executer({}, { maintenant: new Date() } as never);
    const ligne = sante.texte.split("\n").find((l) => l.startsWith("Dernières migrations : "));
    assert.ok(ligne, sante.texte);
    assert.match(ligne, /mise-en-route-18 le \d\d\/\d\d(\/\d{4})? : 12 dossiers contrôlés, 14 écarts trouvés, 11 réparés, 2 tâches à moi, 1 au détecteur, 0 échec \(/);
    assert.match(ligne, /STATUT_DU_LEAD 5 trouvés, 5 réparés/);
    assert.match(ligne, /SIGNE_SANS_DEVIS_ACCEPTE 1 trouvé, 0 réparé, 1 en tâche/);
    assert.match(ligne, /DATE_CHANTIER_EN_SIGNE 2 trouvés, 0 réparé, 1 en tâche, 1 au détecteur/);
  });

  test("texte d'une migration, initiales des journaux, codes laissés au filet", () => {
    assert.equal(lecture.texteMigration({ nom: "etats-en-double-18", executeeLe: new Date("2026-10-05T10:00:00Z"), resume: JSON.stringify({ espacesLus: 0, consultations: 2 }) }).replace(/ le .*? :/, " le … :"), "etats-en-double-18 le … : consultations 2");
    assert.equal(lecture.texteMigration({ nom: "x", executeeLe: new Date(), resume: "illisible" }).replace(/ le .*? :/, " le … :"), "x le … : rien à faire");
    assert.equal(m.initiales("Sixtine Essai"), "S. E.");
    assert.equal(m.initiales("jean-pierre  de la Roche"), "J. P. D. L. R.");
    assert.equal(m.initiales(""), "?");
    // Le rangement des simulations du site est fait par le filet des 15 minutes (même fonction) ; jamais une correction sensible appliquée.
    assert.deepEqual([...m.CODES_LAISSES_AU_FILET], ["SIMULATIONS_HORS_DOSSIER"]);
    assert.ok(!controle.CORRECTIONS_SENSIBLES.has("SIMULATIONS_HORS_DOSSIER"));
  });
});
