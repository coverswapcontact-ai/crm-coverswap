import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import { preparerBaseEssai } from "@/test/base-essai";

preparerBaseEssai();

let prisma: typeof import("@/lib/prisma").default;
let avecActeur: typeof import("@/lib/journal/contexte").avecActeur;
let file: typeof import("@/lib/taches/file");
let executeur: typeof import("@/lib/taches/executeur");
let registre: typeof import("@/lib/taches/registre");

const HUMAIN = { acteur: "HUMAIN:essai@coverswap.fr" };
let appels: { type: string; charge: unknown }[] = [];
let echecsRestants = 0;
let ressourceCoupee = false;

before(async () => {
  prisma = (await import("@/lib/prisma")).default;
  avecActeur = (await import("@/lib/journal/contexte")).avecActeur;
  file = await import("@/lib/taches/file");
  executeur = await import("@/lib/taches/executeur");
  registre = await import("@/lib/taches/registre");
  await (await import("@/lib/base/preparation")).preparerBase();

  registre.enregistrerTraitement("ESSAI_SUCCES", {
    libelle: "Essai",
    acteur: "SYSTEME:essai",
    executer: async (charge) => {
      appels.push({ type: "ESSAI_SUCCES", charge });
      const lead = await prisma.lead.create({
        data: { nom: "Tache", prenom: "Essai", telephone: "0600000000", ville: "Pérols" },
      });
      return { leadId: lead.id };
    },
  });
  registre.enregistrerTraitement("ESSAI_ECHEC_PASSAGER", {
    libelle: "Essai qui échoue puis réussit",
    acteur: "SYSTEME:essai",
    tentativesMax: 3,
    executer: async () => {
      if (echecsRestants > 0) {
        echecsRestants--;
        throw new Error("Réseau indisponible");
      }
      return "ok";
    },
  });
  registre.enregistrerTraitement("ESSAI_ECHEC_DEFINITIF", {
    libelle: "Essai en échec définitif",
    acteur: "SYSTEME:essai",
    executer: async () => {
      throw new registre.ErreurDefinitive("Accès révoqué");
    },
  });
  registre.enregistrerTraitement("ESSAI_ATTENTE", {
    libelle: "Essai qui attend une ressource extérieure",
    acteur: "SYSTEME:essai",
    tentativesMax: 2,
    executer: async () => {
      if (ressourceCoupee) throw new registre.AttenteExterne("Google coupé : reconnecter le compte dans Paramètres", 60_000);
      return "repris";
    },
  });
  registre.enregistrerTraitement("ESSAI_LENT", {
    libelle: "Essai trop lent",
    acteur: "SYSTEME:essai",
    delaiMaxMs: 50,
    executer: (_charge, { signal }) =>
      new Promise((resoudre) => {
        const minuterie = setTimeout(resoudre, 5_000);
        signal.addEventListener("abort", () => clearTimeout(minuterie));
      }),
  });
});

beforeEach(() => {
  appels = [];
  echecsRestants = 0;
  ressourceCoupee = false;
});

after(async () => {
  await prisma.$disconnect();
});

async function tache(cle: string) {
  const trouvee = await prisma.tache.findUnique({ where: { cle } });
  assert.ok(trouvee, `tâche ${cle} absente`);
  return trouvee;
}

/** Rend la tâche due tout de suite (simule l'écoulement du temps). */
async function avancerHorloge(cle: string) {
  await prisma.tache.update({ where: { cle }, data: { prochainEssaiLe: new Date(Date.now() - 1000) } });
}

describe("mise en file", () => {
  test("une même clé ne produit qu'une tâche, jamais rejouée une fois terminée (mode UNIQUE)", async () => {
    await avecActeur(HUMAIN, () => file.mettreEnFile({ type: "ESSAI_SUCCES", cle: "unique-1", charge: { n: 1 } }));
    await avecActeur(HUMAIN, () => file.mettreEnFile({ type: "ESSAI_SUCCES", cle: "unique-1", charge: { n: 2 } }));
    assert.equal(await prisma.tache.count({ where: { cle: "unique-1" } }), 1);
    assert.equal((await tache("unique-1")).demandeePar, HUMAIN.acteur);

    await executeur.executerTour();
    assert.equal((await tache("unique-1")).statut, "TERMINEE");
    await file.mettreEnFile({ type: "ESSAI_SUCCES", cle: "unique-1" });
    assert.equal((await tache("unique-1")).statut, "TERMINEE");
    assert.equal(appels.length, 1);
  });

  test("mode RECONCILIATION : une tâche terminée est rejouée avec la nouvelle charge", async () => {
    await file.mettreEnFile({ type: "ESSAI_SUCCES", cle: "reco-1", charge: { version: 1 }, mode: "RECONCILIATION" });
    await executeur.executerTour();
    await file.mettreEnFile({ type: "ESSAI_SUCCES", cle: "reco-1", charge: { version: 2 }, mode: "RECONCILIATION" });
    assert.equal((await tache("reco-1")).statut, "EN_ATTENTE");
    await executeur.executerTour();
    assert.deepEqual(
      appels.map((appel) => appel.charge),
      [{ version: 1 }, { version: 2 }]
    );
  });

  test("mise en file dans une transaction annulée : aucune tâche", async () => {
    await assert.rejects(
      prisma.$transaction(async (tx) => {
        await file.mettreEnFile({ type: "ESSAI_SUCCES", cle: "annulee-1" }, tx);
        throw new Error("échec volontaire");
      })
    );
    assert.equal(await prisma.tache.count({ where: { cle: "annulee-1" } }), 0);
  });
});

describe("exécution", () => {
  test("succès : résultat gardé, écritures attribuées au traitement", async () => {
    await file.mettreEnFile({ type: "ESSAI_SUCCES", cle: "succes-1" });
    await executeur.executerTour();
    const terminee = await tache("succes-1");
    assert.equal(terminee.statut, "TERMINEE");
    assert.equal(terminee.tentatives, 1);
    const { leadId } = JSON.parse(terminee.resultat!);
    const [ligne] = await prisma.$queryRawUnsafe<{ acteur: string; origine: string; requete: string }[]>(
      `SELECT acteur, origine, requete FROM "JournalModification" WHERE "enregistrementId" = ?`,
      leadId
    );
    assert.equal(ligne.acteur, "SYSTEME:essai");
    assert.equal(ligne.origine, "tache:ESSAI_SUCCES");
    assert.equal(ligne.requete, terminee.id);
  });

  test("panne passagère : nouvel essai différé, puis succès quand le réseau revient", async () => {
    echecsRestants = 1;
    await file.mettreEnFile({ type: "ESSAI_ECHEC_PASSAGER", cle: "passager-1" });
    await executeur.executerTour();
    const enAttente = await tache("passager-1");
    assert.equal(enAttente.statut, "EN_ATTENTE");
    assert.equal(enAttente.tentatives, 1);
    assert.match(enAttente.derniereErreur ?? "", /Réseau indisponible/);
    assert.ok(enAttente.prochainEssaiLe.getTime() > Date.now() + 20_000);

    await executeur.executerTour(); // pas encore dû
    assert.equal((await tache("passager-1")).tentatives, 1);

    await avancerHorloge("passager-1");
    await executeur.executerTour();
    const terminee = await tache("passager-1");
    assert.equal(terminee.statut, "TERMINEE");
    assert.equal(terminee.derniereErreur, null);
  });

  test("échecs répétés : abandon après le nombre maximal de tentatives", async () => {
    echecsRestants = 10;
    await file.mettreEnFile({ type: "ESSAI_ECHEC_PASSAGER", cle: "repete-1" });
    for (let i = 0; i < 3; i++) {
      await avancerHorloge("repete-1");
      await executeur.executerTour();
    }
    const abandonnee = await tache("repete-1");
    assert.equal(abandonnee.statut, "ECHEC_DEFINITIF");
    assert.equal(abandonnee.tentatives, 3);
  });

  test("erreur définitive : abandon immédiat, puis relance et annulation à la main", async () => {
    await file.mettreEnFile({ type: "ESSAI_ECHEC_DEFINITIF", cle: "definitif-1" });
    await executeur.executerTour();
    const echouee = await tache("definitif-1");
    assert.equal(echouee.statut, "ECHEC_DEFINITIF");
    assert.equal(echouee.tentatives, 1);

    await file.relancerTache(echouee.id);
    assert.equal((await tache("definitif-1")).statut, "EN_ATTENTE");
    await file.annulerTache(echouee.id);
    assert.equal((await tache("definitif-1")).statut, "ANNULEE");
    await assert.rejects(() => file.annulerTache(echouee.id), /Seule une tâche/);
  });

  test("ressource extérieure coupée (Google, mission 7) : la tâche attend sans perdre d'essai, puis reprend", async () => {
    ressourceCoupee = true;
    await file.mettreEnFile({ type: "ESSAI_ATTENTE", cle: "attente-1" });
    for (let i = 0; i < 5; i++) {
      await avancerHorloge("attente-1");
      await executeur.executerTour();
    }
    const enAttente = await tache("attente-1");
    assert.equal(enAttente.statut, "EN_ATTENTE", "jamais abandonnée, même au-delà du nombre maximal de tentatives");
    assert.equal(enAttente.tentatives, 0);
    assert.match(enAttente.derniereErreur ?? "", /^\[en attente\] Google coupé/);
    assert.ok(enAttente.prochainEssaiLe.getTime() > Date.now() + 50_000);

    ressourceCoupee = false;
    await avancerHorloge("attente-1");
    await executeur.executerTour();
    assert.equal((await tache("attente-1")).statut, "TERMINEE");
  });

  test("délai dépassé : la tentative est abandonnée et reprogrammée", async () => {
    await file.mettreEnFile({ type: "ESSAI_LENT", cle: "lent-1" });
    await executeur.executerTour();
    const reprogrammee = await tache("lent-1");
    assert.equal(reprogrammee.statut, "EN_ATTENTE");
    assert.match(reprogrammee.derniereErreur ?? "", /Délai maximal dépassé/);
  });

  test("processus tombé en pleine exécution : la tâche est reprise à l'expiration du bail", async () => {
    await file.mettreEnFile({ type: "ESSAI_SUCCES", cle: "bail-1" });
    await prisma.tache.update({
      where: { cle: "bail-1" },
      data: { statut: "EN_COURS", tentatives: 1, verrouJusqua: new Date(Date.now() - 1000) },
    });
    await executeur.executerTour();
    const reprise = await tache("bail-1");
    assert.equal(reprise.statut, "TERMINEE");
    assert.equal(reprise.tentatives, 2);
  });

  test("type inconnu : échec définitif explicite", async () => {
    await file.mettreEnFile({ type: "TYPE_DISPARU", cle: "inconnu-1" });
    await executeur.executerTour();
    const echouee = await tache("inconnu-1");
    assert.equal(echouee.statut, "ECHEC_DEFINITIF");
    assert.match(echouee.derniereErreur ?? "", /Type de tâche inconnu/);
  });
});

describe("travaux périodiques", () => {
  test("passage dû, pas avant ; échecs comptés ; travail inactif ignoré", async () => {
    let passages = 0;
    let echouer = false;
    let actif = true;
    registre.enregistrerTravailPeriodique({
      nom: "essai-periodique",
      libelle: "Essai périodique",
      acteur: "SYSTEME:essai",
      intervalleMs: 60 * 60_000,
      estActif: () => actif,
      executer: async () => {
        passages++;
        if (echouer) throw new Error("Service indisponible");
      },
    });

    await executeur.executerTour();
    assert.equal(passages, 1);
    await executeur.executerTour();
    assert.equal(passages, 1, "pas de second passage avant l'intervalle");

    const rendreDu = () =>
      prisma.planification.update({
        where: { nom: "essai-periodique" },
        data: { prochainPassage: new Date(Date.now() - 1000) },
      });

    echouer = true;
    await rendreDu();
    await executeur.executerTour();
    let etat = await prisma.planification.findUniqueOrThrow({ where: { nom: "essai-periodique" } });
    assert.equal(etat.dernierStatut, "ECHEC");
    assert.equal(etat.echecsConsecutifs, 1);

    actif = false;
    await rendreDu();
    await executeur.executerTour();
    etat = await prisma.planification.findUniqueOrThrow({ where: { nom: "essai-periodique" } });
    assert.equal(etat.dernierStatut, "IGNORE");
    assert.equal(passages, 2);
  });
});
