import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { preparerBaseEssai } from "@/test/base-essai";

preparerBaseEssai();

/**
 * Mission 12 : « perdu » exige un motif — sur un dossier (écran, assistant,
 * code), sur un lead (« sans suite », note d'appel « pas intéressé ») — et le
 * motif remonte dans l'analyse commerciale (dossiers et leads confondus).
 */

let prisma: typeof import("@/lib/prisma").default;
let transitions: typeof import("./transitions");
let entrants: typeof import("@/lib/prospects/entrants");
let appels: typeof import("@/lib/commercial/appels");
let commercial: typeof import("@/lib/assistant/analyses/commercial");
let avecActeur: typeof import("@/lib/journal/contexte").avecActeur;
const LUCAS = { acteur: "HUMAIN:lucas@coverswap.fr" };

async function dossierEssai(nom: string) {
  return (await prisma.dossier.create({ data: { clientNom: nom, clientAdresse: "1 rue des Essais", clientCp: "34000", clientVille: "Montpellier", clientTelephone: "0600000010", objet: "Cuisine", source: "ENTRANT", etape: "DEVIS_ENVOYE" } })).id;
}

before(async () => {
  prisma = (await import("@/lib/prisma")).default;
  transitions = await import("./transitions");
  entrants = await import("@/lib/prospects/entrants");
  appels = await import("@/lib/commercial/appels");
  commercial = await import("@/lib/assistant/analyses/commercial");
  avecActeur = (await import("@/lib/journal/contexte")).avecActeur;
  await (await import("@/lib/base/preparation")).preparerBase();
});
after(async () => {
  await prisma.$disconnect();
});

describe("motif de perte obligatoire", () => {
  test("dossier : sans motif refusé, « autre » sans précision refusé, avec motif accepté et figé", async () => {
    const id = await dossierEssai("Perte Dossier");
    await assert.rejects(avecActeur(LUCAS, () => transitions.changerEtape(id, { vers: "PERDU" })), /Motif de perte obligatoire/);
    await assert.rejects(avecActeur(LUCAS, () => transitions.changerEtape(id, { vers: "PERDU", motifPerte: "AUTRE" })), /Précise le motif/);
    assert.equal((await prisma.dossier.findUniqueOrThrow({ where: { id } })).etape, "DEVIS_ENVOYE", "rien n'a bougé");
    await avecActeur(LUCAS, () => transitions.changerEtape(id, { vers: "PERDU", motifPerte: "HORS_ZONE" }));
    const d = await prisma.dossier.findUniqueOrThrow({ where: { id } });
    assert.deepEqual([d.etape, d.motifPerte, d.perteEtape], ["PERDU", "HORS_ZONE", "DEVIS_ENVOYE"]);
    assert.ok(d.perteLe);
  });

  test("lead : « sans suite » sans motif refusé ; avec motif, la perte est datée et l'échange le dit ; retour en « contacté » efface la perte", async () => {
    const lead = await prisma.lead.create({ data: { prenom: "Perte", nom: "Lead", telephone: "0600000011", ville: "Lattes", source: "AUTRE" } });
    await assert.rejects(avecActeur(LUCAS, () => entrants.modifierEntrant(lead.id, entrants.schemaModificationEntrant.parse({ statut: "PERDU" }))), /Motif obligatoire pour classer sans suite/);
    await assert.rejects(avecActeur(LUCAS, () => entrants.modifierEntrant(lead.id, entrants.schemaModificationEntrant.parse({ statut: "PERDU", motifPerte: "AUTRE", motif: "" }))), /Précise le motif/);
    await avecActeur(LUCAS, () => entrants.modifierEntrant(lead.id, entrants.schemaModificationEntrant.parse({ statut: "PERDU", motifPerte: "PRIX", motif: "trouve ça trop cher" })));
    let l = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
    assert.deepEqual([l.statut, l.motifPerte, l.perteCommentaire], ["PERDU", "PRIX", "trouve ça trop cher"]);
    assert.ok(l.perteLe);
    const echange = await prisma.interaction.findFirst({ where: { leadId: lead.id }, orderBy: { createdAt: "desc" } });
    assert.match(echange?.contenu ?? "", /Statut : Sans suite \(Trop cher — trouve ça trop cher\)/);
    await avecActeur(LUCAS, () => entrants.modifierEntrant(lead.id, entrants.schemaModificationEntrant.parse({ statut: "CONTACTE" })));
    l = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
    assert.deepEqual([l.statut, l.motifPerte, l.perteLe], ["CONTACTE", null, null]);
  });

  test("note d'appel « pas intéressé » : le lead passe perdu avec un motif (projet abandonné)", async () => {
    const lead = await prisma.lead.create({ data: { prenom: "Pas", nom: "Intéressé", telephone: "0600000012", ville: "Lattes", source: "AUTRE" } });
    await avecActeur(LUCAS, () => appels.noterAppel({ leadId: lead.id, issue: "PAS_INTERESSE", contenu: "Ne veut plus de travaux" } as unknown as Parameters<typeof appels.noterAppel>[0]));
    const l = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
    assert.deepEqual([l.statut, l.motifPerte, l.perteCommentaire], ["PERDU", "PROJET_ABANDONNE", "Pas intéressé (appel)"]);
  });

  test("manager_commercial : les motifs des dossiers et des leads perdus se cumulent", async () => {
    const analyse = await commercial.analyseCommerciale({ periode: "30_jours" } as Parameters<typeof commercial.analyseCommerciale>[0]);
    const pertes = analyse.pertes as { dossiersPerdus: number; leadsPerdus: number; parMotif: { cle: string; valeur: number }[] };
    assert.ok(pertes.dossiersPerdus >= 1 && pertes.leadsPerdus >= 1, JSON.stringify(pertes));
    const motif = (cle: string) => pertes.parMotif.find((m) => m.cle === cle)?.valeur ?? 0;
    assert.ok(motif("HORS_ZONE") >= 1 && motif("PRIX") >= 0 && motif("PROJET_ABANDONNE") >= 1, JSON.stringify(pertes.parMotif));
  });
});
