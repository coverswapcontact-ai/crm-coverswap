import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, beforeEach, describe, test } from "node:test";
import { preparerBaseEssai } from "@/test/base-essai";

preparerBaseEssai();
process.env.UPLOADS_DIR = mkdtempSync(path.join(tmpdir(), "coverswap-m25-ia-"));
process.env.TACHES_DESACTIVEES = "1";
process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3001";
process.env.NEXTAUTH_SECRET = "secret-des-essais-de-la-messagerie";
// Une clé factice : le faux modèle répond, aucun appel ne part (comme mail-v2.test.ts).
process.env.ANTHROPIC_API_KEY = "cle-factice-qui-ne-doit-jamais-servir";

/**
 * Mission 25 (lot 5) — l'IA de la messagerie, avec un faux modèle (aucun appel payant) : l'analyse d'une réponse du
 * client (faits, ligne de journal, deux lignes de « Où on en est », réponse proposée en Validation), le contrôleur qui
 * écarte une réponse avec un prix et des lignes avec une date relative, la personnalisation d'un « comme convenu »
 * (gardée, ou écartée pour « gratuit »), le brouillon de la zone de saisie, le registre `AppelIa`, l'alerte à 80 % du
 * plafond (une fois) et le passage aux règles fixes au plafond. Clients fictifs (plage 06 39 98).
 */

type Demande = import("@/lib/ia/modele").DemandeModele & { usage?: string };
type Reponse = import("@/lib/ia/modele").ReponseModele;

let prisma: typeof import("@/lib/prisma").default;
let analyse: typeof import("./analyse");
let gestes: typeof import("./gestes");
let suivis: typeof import("./suivis");
let horaires: typeof import("./horaires");
let modele: typeof import("@/lib/ia/modele");
let parametres: typeof import("@/lib/parametres/service");

const alertes: import("./alertes").AlerteMessagerie[] = [];
const demandes: Demande[] = [];
/** Ce que le faux modèle rend, selon l'outil demandé (et le message, pour l'analyse). */
let repondre: (demande: Demande, entree: Record<string, unknown>) => unknown = () => ({});
let jetons = { entree: 2_000, sortie: 300 };

let horloge: Date;
let numero = 50;

async function leadAvecA1(prenom: string) {
  const lead = await prisma.lead.create({ data: { prenom, nom: "Fiction", telephone: `06399800${numero++}`, ville: "Lattes", source: "META_ADS", typeProjet: "CUISINE" } });
  const suiviId = (await suivis.suiviPour({ leadId: lead.id }))!.id;
  await analyse.analyserSuivi(suiviId, horloge);
  const a1 = await prisma.messagePrepare.findFirstOrThrow({ where: { suiviId, code: "A1" } });
  await gestes.confirmerEnvoi(a1.id, {}, new Date(horloge.getTime() + 60_000));
  return { lead, suiviId };
}

before(async () => {
  prisma = (await import("@/lib/prisma")).default;
  for (const cle of ["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID", "NTFY_TOPIC", "RESEND_API_KEY", "CRM_ESSAI_LOCAL"]) process.env[cle] = "";
  await (await import("@/lib/base/preparation")).preparerBase();
  analyse = await import("./analyse");
  gestes = await import("./gestes");
  suivis = await import("./suivis");
  horaires = await import("./horaires");
  modele = await import("@/lib/ia/modele");
  parametres = await import("@/lib/parametres/service");
  (await import("./alertes")).definirAlertesEssai((a) => alertes.push(a));
  modele.definirFournisseurIaEssai(async (demande): Promise<Reponse> => {
    demandes.push(demande);
    let entree: Record<string, unknown> = {};
    try {
      entree = JSON.parse(demande.message) as Record<string, unknown>;
    } catch {
      // message non JSON : rien à lire
    }
    return { donnees: repondre(demande, entree), jetonsEntree: jetons.entree, jetonsSortie: jetons.sortie };
  });
  const depuis = new Date("2026-01-01");
  for (const [cle, valeur] of [["IA_CRM_ACTIVE", "ACTIVE"], ["IA_MESSAGERIE", "ACTIVE"], ["IA_MODELE", "claude-haiku-5-5"], ["IA_PRIX_ENTREE", 1], ["IA_PRIX_SORTIE", 5], ["IA_BUDGET_MENSUEL", 50], ["IA_MESSAGERIE_BUDGET", 10]] as const) {
    await parametres.enregistrerParametre({ cle, valeur, valableDu: depuis, source: "essai" });
  }
  suivis.oublierLancement();
  await parametres.enregistrerParametre({ cle: "MESSAGERIE_LANCEMENT", valeur: new Date(Date.now() - 60_000).toISOString(), valableDu: depuis, source: "essai" });
  let jour = horaires.momentParis(new Date(Date.now() + 86_400_000)).jour;
  while (![2, 3].includes(horaires.semaineDuJour(jour)) || horaires.estFerie(jour)) jour = horaires.jourSuivant(jour);
  horloge = horaires.instantParis(jour, 10 * 60);
});

beforeEach(() => {
  alertes.length = 0;
  demandes.length = 0;
  jetons = { entree: 2_000, sortie: 300 };
});

after(async () => {
  modele.definirFournisseurIaEssai(null);
  (await import("./alertes")).definirAlertesEssai(null);
  await prisma.$disconnect();
});

/** L'analyse que le faux modèle rend pour le premier message du client reçu dans la demande. */
function analyseDuModele(champs: { classe: string; reponse?: string | null; alerte?: string | null; situation: string; client: string; journal: string; faits?: Record<string, unknown> }) {
  return (demande: Demande, entree: Record<string, unknown>) => {
    if (demande.outil.nom !== "rendre_analyse") return { texte: null };
    const messages = (entree.nouveaux_messages_du_client ?? []) as { id: string }[];
    return {
      faits: champs.faits ?? {},
      journal: champs.journal,
      situation: champs.situation,
      client: champs.client,
      messages: messages.map((m) => ({ id: m.id, classe: champs.classe, reponse: champs.reponse ?? null, alerte: champs.alerte ?? null, rappel: null })),
      notes: [],
    };
  };
}

describe("Mission 25 (lot 5) — l'analyse par l'IA", () => {
  test("une réponse du client : faits, journal et « Où on en est » de l'IA, réponse proposée en Validation, appel enregistré", async () => {
    const { suiviId } = await leadAvecA1("Inès");
    repondre = analyseDuModele({
      classe: "QUESTION_GENERALE",
      reponse: "Bonjour Inès, oui, le revêtement supporte très bien la chaleur d'une cuisine. Voulez-vous que nous en parlions par téléphone avec votre mari ?",
      journal: "Hésite entre chêne clair et blanc mat ; son mari décide ; question sur la chaleur",
      situation: "Lead Meta, premier SMS envoyé, a répondu par SMS.",
      client: "Hésite chêne clair / blanc mat ; son mari décide.",
      faits: { teintesEvoquees: ["chêne clair", "blanc mat"], decideur: "son mari" },
    });
    const recu = new Date(horloge.getTime() + 10 * 60_000);
    await gestes.rapporterReponse({ suiviId, texte: "On hésite entre le chêne clair et le blanc mat, c'est mon mari qui décide. Ça tient à la chaleur ?", recuLe: recu }, new Date(recu.getTime() + 60_000));
    await analyse.analyserSuivi(suiviId, new Date(recu.getTime() + 3 * 60_000));

    assert.equal(demandes.filter((d) => d.outil.nom === "rendre_analyse").length, 1, "une analyse pour l'événement");
    const suivi = await prisma.suivi.findUniqueOrThrow({ where: { id: suiviId } });
    const faits = JSON.parse(suivi.faits) as { teintesEvoquees: string[]; decideur: string | null };
    assert.deepEqual(faits.teintesEvoquees.slice(0, 2), ["chêne clair", "blanc mat"]);
    assert.equal(faits.decideur, "son mari");
    const ouEnEst = JSON.parse(suivi.ouEnEst) as { situation: string; client: string; suite: string; par: string };
    assert.equal(ouEnEst.par, "IA");
    assert.equal(ouEnEst.client, "Hésite chêne clair / blanc mat ; son mari décide.");
    assert.ok(ouEnEst.suite.length > 0, "la suite vient toujours des règles");
    const journal = await prisma.ligneJournalSuivi.findMany({ where: { suiviId }, orderBy: { le: "asc" } });
    assert.ok(journal.some((l) => l.acteur === "IA" && l.texte === "Hésite entre chêne clair et blanc mat ; son mari décide ; question sur la chaleur"));
    const reponse = await prisma.messagePrepare.findFirstOrThrow({ where: { suiviId, code: "REPONSE" } });
    assert.match(reponse.texte, /^Bonjour Inès, oui, le revêtement supporte très bien la chaleur/);
    assert.equal(reponse.mode, "VALIDATION", "une réponse écrite par l'IA attend toujours l'accord");
    const appel = await prisma.appelIa.findFirstOrThrow({ where: { usage: "MESSAGERIE_ANALYSE" }, orderBy: { createdAt: "desc" } });
    assert.equal(appel.modele, "claude-haiku-5-5");
    assert.ok((appel.coutEuros ?? 0) > 0);
  });

  test("le contrôleur : une réponse avec un prix est écartée (Q6 part, l'écart au journal), des lignes avec « demain » aussi", async () => {
    const { suiviId } = await leadAvecA1("Jade");
    repondre = analyseDuModele({
      classe: "PRIX",
      reponse: "Bonjour Jade, comptez environ 1 200 € pour une cuisine de cette taille.",
      alerte: "Jade demande le prix pour sa cuisine.",
      journal: "Demande le prix",
      situation: "Lead Meta, demande le prix.",
      client: "Veut un prix, rappel demain.",
    });
    const recu = new Date(horloge.getTime() + 20 * 60_000);
    await gestes.rapporterReponse({ suiviId, texte: "C'est combien pour une cuisine de 4 mètres ?", recuLe: recu }, new Date(recu.getTime() + 60_000));
    await analyse.analyserSuivi(suiviId, new Date(recu.getTime() + 3 * 60_000));

    const prepares = await prisma.messagePrepare.findMany({ where: { suiviId, reponse: true } });
    assert.ok(!prepares.some((m) => /1 200/.test(m.texte)), "aucun prix ne part");
    const q6 = prepares.find((m) => m.code === "Q6");
    assert.ok(q6, prepares.map((m) => m.code).join(", "));
    assert.match(q6.raison ?? "", /texte de l'IA écarté : Un montant que le CRM n'a pas donné/);
    assert.ok(alertes.some((a) => /demande le prix/.test(a.titre) && a.texte === "Jade demande le prix pour sa cuisine."), "l'alerte reprend la phrase de l'IA");
    const ouEnEst = JSON.parse((await prisma.suivi.findUniqueOrThrow({ where: { id: suiviId } })).ouEnEst) as { client: string; par: string };
    assert.notEqual(ouEnEst.par, "IA", "« demain » : les lignes des règles restent");
    assert.ok(!/demain/.test(ouEnEst.client));
  });

  test("« comme convenu » personnalisé : le texte de l'IA s'il passe, sinon le texte validé et l'écart", async () => {
    const { lead, suiviId } = await leadAvecA1("Lou");
    const { chargerEtat } = await import("./etat");
    const { rediger, lireSurcharges } = await import("./redaction");
    const suivi = await prisma.suivi.findUniqueOrThrow({ where: { id: suiviId } });
    await prisma.suivi.update({ where: { id: suiviId }, data: { faits: JSON.stringify({ ...JSON.parse(suivi.faits), teintesFavorites: ["chêne clair"] }) } });
    const lu = { ...(await prisma.suivi.findUniqueOrThrow({ where: { id: suiviId } })) };
    const { etat } = await chargerEtat(lu, await suivis.lancementMessagerie(horloge), horloge);
    const intention = { code: "CC", cle: `CC:essai:${lead.id}`, voulu: horloge, variante: "defaut" as const, raison: "Rappel « va signer »" };

    repondre = (d) => (d.outil.nom === "rendre_texte" ? { texte: "Bonjour Lou, comme convenu, je reviens vers vous pour votre cuisine en chêne clair. Avez-vous pu y réfléchir ?" } : {});
    const garde = await rediger(etat, intention, await lireSurcharges(), horloge);
    assert.ok(!("refus" in garde));
    assert.equal(garde.ia, true);
    assert.equal(garde.texte, "Bonjour Lou, comme convenu, je reviens vers vous pour votre cuisine en chêne clair. Avez-vous pu y réfléchir ?");
    assert.equal(garde.texteValide, "Bonjour Lou, comme convenu, je reviens vers vous pour votre projet de cuisine. Avez-vous pu y réfléchir ?");
    assert.equal(garde.mode, "VALIDATION");

    repondre = (d) => (d.outil.nom === "rendre_texte" ? { texte: "Bonjour Lou, comme convenu, je reviens vers vous : la pose est gratuite cette semaine. Avez-vous pu y réfléchir ?" } : {});
    const ecarte = await rediger(etat, intention, await lireSurcharges(), horloge);
    assert.ok(!("refus" in ecarte));
    assert.equal(ecarte.ia, false);
    assert.equal(ecarte.texte, ecarte.texteValide);
    assert.match(ecarte.ecartControle ?? "", /« gratuite » est interdit/);
    assert.ok(demandes.every((d) => d.outil.nom !== "rendre_texte" || !/06 ?39/.test(d.message)), "le numéro du client n'est jamais envoyé au modèle");
  });

  test("le brouillon de la zone de saisie : contrôlé (un jour inventé est écarté), sinon proposé", async () => {
    const { suiviId } = await leadAvecA1("Maé");
    repondre = (d) => (d.outil.nom === "rendre_texte" ? { texte: "Bonjour Maé, je peux passer jeudi avec les échantillons." } : {});
    const refuse = await gestes.redigerAvecIa(suiviId, horloge);
    assert.equal(refuse.texte, null);
    assert.match(refuse.raison ?? "", /Brouillon écarté : Une date, un jour ou un créneau/);
    repondre = (d) => (d.outil.nom === "rendre_texte" ? { texte: "Bonjour Maé, merci pour votre message ! Je regarde votre projet et je reviens vers vous très vite." } : {});
    const propose = await gestes.redigerAvecIa(suiviId, horloge);
    assert.equal(propose.texte, "Bonjour Maé, merci pour votre message ! Je regarde votre projet et je reviens vers vous très vite.");
    assert.equal(await prisma.appelIa.count({ where: { usage: "MESSAGERIE_REDACTION" } }), 2);
  });
});

describe("Mission 25 (lot 5) — le rejeu à blanc des derniers événements", () => {
  test("règles puis IA : la lecture, la réponse et le verdict du contrôleur ; rien n'est écrit dans les dossiers ; le coût annoncé", async () => {
    const { estimerRejeu, rejouerEvenements } = await import("./rejeu");
    const maintenant = new Date(horloge.getTime() + 2 * 3_600_000);
    const lou = await prisma.suivi.findFirstOrThrow({ where: { nom: { startsWith: "Lou" } } });
    await gestes.ajouterNote({ suiviId: lou.id, texte: "Rappeler le 20/10, elle signe avec son mari" }, new Date(maintenant.getTime() - 60_000));
    const avant = { journal: await prisma.ligneJournalSuivi.count(), messages: await prisma.messagePrepare.count(), suivis: JSON.stringify(await prisma.suivi.findMany({ select: { ouEnEst: true, faits: true, curseur: true }, orderBy: { id: "asc" } })) };

    const regles = await rejouerEvenements({ nombre: 6 }, maintenant);
    assert.equal(regles.ia, false);
    assert.ok(regles.evenements.length >= 3, `${regles.evenements.length} événements`);
    const prix = regles.evenements.find((e) => e.texte.startsWith("C'est combien"))!;
    assert.equal(prix.genre, "MESSAGE");
    assert.equal(prix.regles.lecture, "le prix");
    assert.equal(prix.regles.reponse?.code, "Q6");
    assert.equal(prix.regles.reponse?.texte, "Bien reçu, je regarde et je reviens vers vous très vite.");
    assert.ok(prix.regles.ouEnEst.situation && prix.regles.ouEnEst.suite, "« Où on en est » jamais vide");
    assert.equal(prix.ia, null);
    const note = regles.evenements.find((e) => e.genre === "NOTE")!;
    assert.match(note.regles.lecture, /^rappel le \S+ \(va signer : pause et « comme convenu »\) ; décide avec son mari$/);

    repondre = analyseDuModele({ classe: "PRIX", reponse: "Bonjour, comptez 1 200 € pour votre cuisine.", journal: "Demande le prix", situation: "Lead Meta, rappel demain.", client: "Veut un prix." });
    const appels = await prisma.appelIa.count({ where: { usage: "MESSAGERIE_ANALYSE" } });
    const ia = await rejouerEvenements({ nombre: 6, ia: true }, maintenant);
    assert.equal(ia.ia, true);
    assert.equal(ia.appels, ia.evenements.length, "une analyse par événement");
    assert.equal(await prisma.appelIa.count({ where: { usage: "MESSAGERIE_ANALYSE" } }), appels + ia.evenements.length);
    const prixIa = ia.evenements.find((e) => e.texte.startsWith("C'est combien"))!;
    assert.match(prixIa.ia?.ecart ?? "", /montant/);
    assert.match(prixIa.ia?.ecartOuEnEst ?? "", /« demain »/);

    assert.equal(await prisma.ligneJournalSuivi.count(), avant.journal, "aucune ligne de journal");
    assert.equal(await prisma.messagePrepare.count(), avant.messages, "aucun message préparé");
    assert.equal(JSON.stringify(await prisma.suivi.findMany({ select: { ouEnEst: true, faits: true, curseur: true }, orderBy: { id: "asc" } })), avant.suivis, "aucun suivi modifié");
    const estimation = await estimerRejeu(maintenant);
    assert.ok(estimation && estimation.euros > 0 && estimation.raison === null, JSON.stringify(estimation));
  });
});

describe("Mission 25 (lot 5) — le plafond de la messagerie", () => {
  test("80 % : une alerte, une seule ; au plafond : les règles fixes, aucun appel", async () => {
    const { iaDisponible, surveillerBudget } = await import("./ia");
    await parametres.enregistrerParametre({ cle: "IA_MESSAGERIE_BUDGET", valeur: 1, valableDu: new Date("2026-01-02"), source: "essai" });
    const avant = (await iaDisponible(horloge)).depense;
    // Le reste du mois jusqu'à 0,79 € : une ligne d'appel déjà faite (registre).
    await prisma.appelIa.create({ data: { usage: "MESSAGERIE_ANALYSE", modele: "claude-haiku-5-5", coutEuros: Math.max(0, 0.79 - avant), dureeMs: 900, statut: "REUSSI", createdAt: horloge } });
    const { suiviId } = await leadAvecA1("Noé");
    jetons = { entree: 10_000, sortie: 2_000 }; // 0,02 € l'appel : 0,79 → 0,81
    repondre = analyseDuModele({ classe: "AUTRE", journal: "Message reçu", situation: "Lead Meta, a répondu.", client: "Rien de neuf." });
    const recu = new Date(horloge.getTime() + 30 * 60_000);
    await gestes.rapporterReponse({ suiviId, texte: "D'accord, merci pour l'info, je regarde ce soir avec mon conjoint", recuLe: recu }, new Date(recu.getTime() + 60_000));
    await analyse.analyserSuivi(suiviId, new Date(recu.getTime() + 3 * 60_000));
    assert.deepEqual(alertes.filter((a) => a.origine === "messagerie-budget").map((a) => a.titre), ["IA de la messagerie : 80 % du budget du mois"]);
    await surveillerBudget(0.81, 0.02, 1);
    assert.equal(alertes.filter((a) => a.origine === "messagerie-budget").length, 1, "le seuil n'est franchi qu'une fois");

    await prisma.appelIa.create({ data: { usage: "MESSAGERIE_ANALYSE", modele: "claude-haiku-5-5", coutEuros: 0.2, dureeMs: 900, statut: "REUSSI", createdAt: horloge } });
    const dispo = await iaDisponible(new Date(recu.getTime() + 4 * 60_000));
    assert.equal(dispo.ok, false);
    assert.match(dispo.raison ?? "", /Plafond de la messagerie atteint/);
    const appels = await prisma.appelIa.count();
    const second = new Date(recu.getTime() + 20 * 60_000);
    await gestes.rapporterReponse({ suiviId, texte: "Vous pouvez me rappeler jeudi après-midi ?", recuLe: second }, new Date(second.getTime() + 60_000));
    const resultat = await analyse.analyserSuivi(suiviId, new Date(second.getTime() + 3 * 60_000));
    assert.equal(resultat.ia, false, "au plafond, les règles fixes");
    assert.equal(await prisma.appelIa.count(), appels, "aucun appel de plus");
    assert.ok((await prisma.messagePrepare.findMany({ where: { suiviId, reponse: true } })).some((m) => m.code === "E3"), "les règles répondent quand même (rappel jeudi)");
  });
});
